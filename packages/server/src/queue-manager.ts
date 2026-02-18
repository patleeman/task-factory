// =============================================================================
// Queue Manager
// =============================================================================
// Manages continuous task queue processing per workspace.
// Runs as a background process on the server — independent of client connections.
//
// When enabled for a workspace, the queue manager:
//   1. Watches for tasks in the "ready" phase
//   2. Picks the next task (FIFO) and moves it to "executing"
//   3. Starts agent execution via the Pi SDK
//   4. When execution completes, moves the task to "complete"
//   5. Immediately picks the next ready task (continuous flow)
//
// The queue manager respects WIP limits and uses FIFO ordering.
// It recovers gracefully from server restarts by detecting orphaned executing tasks.

import type {
  ExecutionBreakerCategory,
  QueueExecutionBreakerStatus,
  QueueStatus,
  ServerEvent,
  Task,
  Workspace,
} from '@task-factory/shared';
import { randomUUID } from 'crypto';
import { resolveWorkspaceWorkflowSettings } from '@task-factory/shared';
import { getWorkspaceById, getTasksDir, listWorkspaces, updateWorkspaceConfig } from './workspace-service.js';
import { discoverTasks, moveTaskToPhase } from './task-service.js';
import { loadGlobalWorkflowSettings } from './workflow-settings-service.js';
import {
  executeTask,
  hasLiveExecutionSession,
  stopTaskExecution,
  type ExecutionCompletionDetails,
} from './agent-execution-service.js';
import { createSystemEvent } from './activity-service.js';
import { logger } from './logger.js';
import { buildTaskStateSnapshot } from './state-contract.js';
import { logTaskStateTransition } from './state-transition.js';
import { registerQueueKickHandler } from './queue-kick-coordinator.js';

// =============================================================================
// Constants
// =============================================================================

const POLL_INTERVAL_MS = 30_000; // Safety poll every 30 seconds
const START_RETRY_DELAY_MS = 5_000;

function readPositiveIntEnv(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

const EXECUTION_BREAKER_THRESHOLD = readPositiveIntEnv(
  'PI_FACTORY_EXECUTION_BREAKER_THRESHOLD',
  3,
);
const EXECUTION_BREAKER_BURST_WINDOW_MS = readPositiveIntEnv(
  'PI_FACTORY_EXECUTION_BREAKER_BURST_WINDOW_MS',
  2 * 60 * 1000,
);
const EXECUTION_BREAKER_COOLDOWN_MS = readPositiveIntEnv(
  'PI_FACTORY_EXECUTION_BREAKER_COOLDOWN_MS',
  5 * 60 * 1000,
);

type BreakerKey = string;

interface ProviderModelKey {
  provider: string;
  modelId: string;
}

interface OpenExecutionBreaker {
  category: ExecutionBreakerCategory;
  openedAtMs: number;
  retryAtMs: number;
  failureCount: number;
  errorMessage: string;
}

interface ExecutionBreakerTracker {
  key: ProviderModelKey;
  failureTimestampsMs: number[];
  open: OpenExecutionBreaker | null;
}

// =============================================================================
// Queue Manager Class
// =============================================================================

class QueueManager {
  private workspaceId: string;
  private enabled = false;
  private currentTaskId: string | null = null;
  private processing = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private broadcastFn: (event: ServerEvent) => void;
  private executionAttempts = new Map<string, string>();
  private lifecycleGeneration = 0;
  private executionBreakers = new Map<BreakerKey, ExecutionBreakerTracker>();
  private lastBlockedNoticeRetryAtByKey = new Map<BreakerKey, number>();

  constructor(workspaceId: string, broadcastFn: (event: ServerEvent) => void) {
    this.workspaceId = workspaceId;
    this.broadcastFn = broadcastFn;
  }

  async start(): Promise<void> {
    if (this.enabled) return;
    this.enabled = true;
    this.advanceLifecycleGeneration();
    logger.info(`[QueueManager] Started for workspace ${this.workspaceId}`);
    await this.broadcastStatus();

    // Safety poll — ensures we don't miss events
    this.pollTimer = setInterval(() => this.kick(), POLL_INTERVAL_MS);

    // Immediately try to process
    this.kick();
  }

  async stop(): Promise<void> {
    this.enabled = false;
    this.advanceLifecycleGeneration();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info(`[QueueManager] Stopped for workspace ${this.workspaceId}`);
    await this.broadcastStatus();
  }

  /** Trigger queue processing. Idempotent — safe to call frequently. */
  kick(): void {
    if (!this.enabled || this.processing) return;
    const generation = this.lifecycleGeneration;
    void this.processNext(generation);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async getStatus(): Promise<QueueStatus> {
    this.clearExpiredExecutionBreakers({ emitEvents: false });

    const workspace = await getWorkspaceById(this.workspaceId);
    let tasksInReady = 0;
    let tasksInExecuting = 0;

    if (workspace) {
      const tasksDir = getTasksDir(workspace);
      const tasks = discoverTasks(tasksDir, { scope: 'active' });
      tasksInReady = tasks.filter(t => t.frontmatter.phase === 'ready').length;
      tasksInExecuting = tasks.filter(t => t.frontmatter.phase === 'executing').length;
    }

    const executionBreakers = this.getOpenExecutionBreakers();

    return {
      workspaceId: this.workspaceId,
      enabled: this.enabled,
      currentTaskId: this.currentTaskId,
      tasksInReady,
      tasksInExecuting,
      ...(executionBreakers.length > 0 ? { executionBreakers } : {}),
    };
  }

  private async broadcastStatus(): Promise<void> {
    this.broadcastFn({ type: 'queue:status', status: await this.getStatus() });
  }

  private beginExecutionAttempt(taskId: string): string {
    const attemptId = randomUUID();
    this.executionAttempts.set(taskId, attemptId);
    return attemptId;
  }

  private isCurrentExecutionAttempt(taskId: string, attemptId: string): boolean {
    return this.executionAttempts.get(taskId) === attemptId;
  }

  private clearExecutionAttempt(taskId: string, attemptId: string): void {
    if (this.isCurrentExecutionAttempt(taskId, attemptId)) {
      this.executionAttempts.delete(taskId);
    }
  }

  private advanceLifecycleGeneration(): void {
    this.lifecycleGeneration += 1;
  }

  private isGenerationActive(generation: number): boolean {
    return this.enabled && this.lifecycleGeneration === generation;
  }

  private wasTaskStartedRecently(task: Task): boolean {
    const startedAt = task.frontmatter.started ? new Date(task.frontmatter.started).getTime() : 0;
    if (!startedAt) {
      return false;
    }

    return Date.now() - startedAt < 2 * 60 * 1000;
  }

  private async emitSystemEvent(
    taskId: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const entry = await createSystemEvent(
        this.workspaceId,
        taskId,
        'phase-change',
        message,
        metadata,
      );

      if (entry) {
        this.broadcastFn({ type: 'activity:entry', entry });
      }
    } catch (err) {
      logger.warn('[QueueManager] Failed to emit system event', err);
    }
  }

  private getTaskExecutionModelKey(task: Task): ProviderModelKey | null {
    const modelConfig = task.frontmatter.executionModelConfig ?? task.frontmatter.modelConfig;
    if (!modelConfig?.provider || !modelConfig?.modelId) {
      return null;
    }

    return {
      provider: modelConfig.provider,
      modelId: modelConfig.modelId,
    };
  }

  private toBreakerKey(key: ProviderModelKey): BreakerKey {
    return `${key.provider}::${key.modelId}`;
  }

  private classifyFailureCategory(errorMessage: string): ExecutionBreakerCategory | null {
    const message = errorMessage.toLowerCase();

    if (/auth|unauthoriz|forbidden|invalid api key|no api key|credential|login/i.test(message)) {
      return 'auth';
    }

    if (/quota|insufficient quota|billing|credits|payment required/i.test(message)) {
      return 'quota';
    }

    if (/429|rate.?limit|too many requests|overloaded|retry delay/i.test(message)) {
      return 'rate_limit';
    }

    return null;
  }

  private getOrCreateExecutionBreakerTracker(key: ProviderModelKey): ExecutionBreakerTracker {
    const breakerKey = this.toBreakerKey(key);
    const existing = this.executionBreakers.get(breakerKey);
    if (existing) {
      return existing;
    }

    const tracker: ExecutionBreakerTracker = {
      key,
      failureTimestampsMs: [],
      open: null,
    };
    this.executionBreakers.set(breakerKey, tracker);
    return tracker;
  }

  private formatRetryTime(retryAtMs: number): string {
    return new Date(retryAtMs).toISOString();
  }

  private clearExpiredExecutionBreakers(options?: { emitEvents?: boolean }): boolean {
    const now = Date.now();
    const emitEvents = options?.emitEvents ?? false;
    let changed = false;

    for (const [breakerKey, tracker] of this.executionBreakers.entries()) {
      const open = tracker.open;
      if (!open || open.retryAtMs > now) {
        continue;
      }

      tracker.open = null;
      tracker.failureTimestampsMs = [];
      this.lastBlockedNoticeRetryAtByKey.delete(breakerKey);
      changed = true;

      if (emitEvents) {
        void this.emitSystemEvent(
          '',
          `Execution breaker auto-closed for ${tracker.key.provider}/${tracker.key.modelId}. Queue dispatch resumed.`,
          {
            provider: tracker.key.provider,
            modelId: tracker.key.modelId,
            action: 'auto_close',
          },
        );
      }
    }

    return changed;
  }

  private getOpenExecutionBreakers(nowMs = Date.now()): QueueExecutionBreakerStatus[] {
    const statuses: QueueExecutionBreakerStatus[] = [];

    for (const tracker of this.executionBreakers.values()) {
      const open = tracker.open;
      if (!open || open.retryAtMs <= nowMs) {
        continue;
      }

      statuses.push({
        provider: tracker.key.provider,
        modelId: tracker.key.modelId,
        category: open.category,
        openedAt: new Date(open.openedAtMs).toISOString(),
        retryAt: new Date(open.retryAtMs).toISOString(),
        remainingMs: Math.max(0, open.retryAtMs - nowMs),
        failureCount: open.failureCount,
        threshold: EXECUTION_BREAKER_THRESHOLD,
        cooldownMs: EXECUTION_BREAKER_COOLDOWN_MS,
      });
    }

    statuses.sort((a, b) => a.retryAt.localeCompare(b.retryAt));
    return statuses;
  }

  private openExecutionBreaker(
    key: ProviderModelKey,
    category: ExecutionBreakerCategory,
    failureCount: number,
    errorMessage: string,
  ): void {
    const now = Date.now();
    const tracker = this.getOrCreateExecutionBreakerTracker(key);
    const retryAtMs = now + EXECUTION_BREAKER_COOLDOWN_MS;

    tracker.open = {
      category,
      openedAtMs: now,
      retryAtMs,
      failureCount,
      errorMessage,
    };

    void this.emitSystemEvent(
      '',
      `Execution breaker opened for ${key.provider}/${key.modelId} (${category}). Retry after ${this.formatRetryTime(retryAtMs)}.`,
      {
        provider: key.provider,
        modelId: key.modelId,
        category,
        retryAt: new Date(retryAtMs).toISOString(),
        failureCount,
        threshold: EXECUTION_BREAKER_THRESHOLD,
        burstWindowMs: EXECUTION_BREAKER_BURST_WINDOW_MS,
        cooldownMs: EXECUTION_BREAKER_COOLDOWN_MS,
        errorMessage,
        action: 'open',
      },
    );

    void this.broadcastStatus();

    setTimeout(() => this.kick(), EXECUTION_BREAKER_COOLDOWN_MS + 25);
  }

  private recordExecutionFailure(
    key: ProviderModelKey,
    errorMessage: string,
  ): void {
    const category = this.classifyFailureCategory(errorMessage);
    if (!category) {
      return;
    }

    const tracker = this.getOrCreateExecutionBreakerTracker(key);
    if (tracker.open && tracker.open.retryAtMs > Date.now()) {
      return;
    }

    const now = Date.now();
    tracker.failureTimestampsMs = tracker.failureTimestampsMs
      .filter((timestampMs) => now - timestampMs <= EXECUTION_BREAKER_BURST_WINDOW_MS);
    tracker.failureTimestampsMs.push(now);

    if (tracker.failureTimestampsMs.length >= EXECUTION_BREAKER_THRESHOLD) {
      this.openExecutionBreaker(key, category, tracker.failureTimestampsMs.length, errorMessage);
    }
  }

  private resetExecutionFailureBurst(task: Task): void {
    const key = this.getTaskExecutionModelKey(task);
    if (!key) {
      return;
    }

    const tracker = this.executionBreakers.get(this.toBreakerKey(key));
    if (!tracker) {
      return;
    }

    tracker.failureTimestampsMs = [];
  }

  private isExecutionBlocked(task: Task): QueueExecutionBreakerStatus | null {
    const key = this.getTaskExecutionModelKey(task);
    if (!key) {
      return null;
    }

    const tracker = this.executionBreakers.get(this.toBreakerKey(key));
    if (!tracker?.open) {
      return null;
    }

    const now = Date.now();
    if (tracker.open.retryAtMs <= now) {
      tracker.open = null;
      tracker.failureTimestampsMs = [];
      return null;
    }

    return {
      provider: key.provider,
      modelId: key.modelId,
      category: tracker.open.category,
      openedAt: new Date(tracker.open.openedAtMs).toISOString(),
      retryAt: new Date(tracker.open.retryAtMs).toISOString(),
      remainingMs: Math.max(0, tracker.open.retryAtMs - now),
      failureCount: tracker.open.failureCount,
      threshold: EXECUTION_BREAKER_THRESHOLD,
      cooldownMs: EXECUTION_BREAKER_COOLDOWN_MS,
    };
  }

  private maybeEmitBlockedExecutionNotice(task: Task, blocked: QueueExecutionBreakerStatus): void {
    const breakerKey = `${blocked.provider}::${blocked.modelId}`;
    const retryAtMs = Date.parse(blocked.retryAt);
    const lastNoticeRetryAtMs = this.lastBlockedNoticeRetryAtByKey.get(breakerKey);
    if (lastNoticeRetryAtMs === retryAtMs) {
      return;
    }

    this.lastBlockedNoticeRetryAtByKey.set(breakerKey, retryAtMs);
    void this.emitSystemEvent(
      task.id,
      `Execution blocked by breaker for ${blocked.provider}/${blocked.modelId} (${blocked.category}). Retry after ${blocked.retryAt}.`,
      {
        provider: blocked.provider,
        modelId: blocked.modelId,
        category: blocked.category,
        retryAt: blocked.retryAt,
        taskId: task.id,
        action: 'blocked',
      },
    );
  }

  clearExecutionBreakersForManualResume(): number {
    this.clearExpiredExecutionBreakers({ emitEvents: false });

    let cleared = 0;
    for (const [breakerKey, tracker] of this.executionBreakers.entries()) {
      if (!tracker.open) {
        continue;
      }

      tracker.open = null;
      tracker.failureTimestampsMs = [];
      this.lastBlockedNoticeRetryAtByKey.delete(breakerKey);
      cleared += 1;

      void this.emitSystemEvent(
        '',
        `Execution breaker manually cleared for ${tracker.key.provider}/${tracker.key.modelId}. Queue resume requested.`,
        {
          provider: tracker.key.provider,
          modelId: tracker.key.modelId,
          action: 'manual_resume',
        },
      );
    }

    if (cleared > 0) {
      void this.broadcastStatus();
    }

    return cleared;
  }

  private async processNext(generation: number): Promise<void> {
    if (!this.isGenerationActive(generation) || this.processing) return;
    this.processing = true;

    try {
      const workspace = await getWorkspaceById(this.workspaceId);
      if (!workspace || !this.isGenerationActive(generation)) return;

      const tasksDir = getTasksDir(workspace);
      const tasks = discoverTasks(tasksDir);
      if (!this.isGenerationActive(generation)) return;

      const breakersChanged = this.clearExpiredExecutionBreakers({ emitEvents: true });
      if (breakersChanged) {
        await this.broadcastStatus();
      }

      const executingTasks = tasks.filter(t => t.frontmatter.phase === 'executing');
      const globalWorkflowDefaults = loadGlobalWorkflowSettings();
      const workflowSettings = resolveWorkspaceWorkflowSettings(workspace.config, globalWorkflowDefaults);
      const wipLimit = workflowSettings.executingLimit;

      // Check for orphaned executing tasks (no live execution session — e.g. after
      // stop/start cycles, restart, or interrupted/idle executions). Recover every
      // orphan in this cycle by either resuming one task or moving tasks back to ready.
      const orphanedTasks = executingTasks.filter(t => !hasLiveExecutionSession(t.id));
      const activeTaskCount = executingTasks.length - orphanedTasks.length;
      const availableResumeSlots = Math.max(0, wipLimit - activeTaskCount);

      const resumableOrphan = availableResumeSlots > 0
        ? orphanedTasks.find((task) => !this.wasTaskStartedRecently(task)) || null
        : null;

      for (const orphan of orphanedTasks) {
        if (!this.isGenerationActive(generation)) {
          return;
        }

        this.executionAttempts.delete(orphan.id);
        const stoppedLingeringSession = await stopTaskExecution(orphan.id);
        if (stoppedLingeringSession) {
          logger.info(`[QueueManager] Stopped lingering session before orphan recovery for ${orphan.id}`);
        }

        if (!this.isGenerationActive(generation)) {
          return;
        }

        if (resumableOrphan?.id === orphan.id) {
          continue;
        }

        const recentlyStarted = this.wasTaskStartedRecently(orphan);
        const resetReason = recentlyStarted
          ? 'Moved back to ready after execution failure'
          : 'Moved back to ready for orphan recovery';

        logger.info(
          recentlyStarted
            ? `[QueueManager] Orphaned task ${orphan.id} failed recently — moving back to ready`
            : `[QueueManager] Orphaned task ${orphan.id} has no live session — moving back to ready`,
        );

        const fromState = buildTaskStateSnapshot(orphan.frontmatter);
        moveTaskToPhase(orphan, 'ready', 'system', resetReason, tasks);

        await logTaskStateTransition({
          workspaceId: this.workspaceId,
          taskId: orphan.id,
          from: fromState,
          to: buildTaskStateSnapshot(orphan.frontmatter),
          source: 'queue:orphan-reset',
          reason: resetReason,
          broadcastToWorkspace: (event) => this.broadcastFn(event),
        });

        this.broadcastFn({
          type: 'task:moved',
          task: orphan,
          from: 'executing',
          to: 'ready',
        });

        createSystemEvent(
          this.workspaceId,
          orphan.id,
          'phase-change',
          recentlyStarted
            ? 'Task moved back to ready after execution failure (will retry from queue)'
            : 'Task moved back to ready for orphan recovery',
        );
      }

      if (resumableOrphan) {
        if (!this.isGenerationActive(generation)) {
          return;
        }

        logger.info(`[QueueManager] Resuming orphaned task: ${resumableOrphan.id}`);
        this.currentTaskId = resumableOrphan.id;
        await this.broadcastStatus();

        createSystemEvent(
          this.workspaceId,
          resumableOrphan.id,
          'phase-change',
          'Queue manager resuming orphaned task after interruption',
        );

        const attemptId = this.beginExecutionAttempt(resumableOrphan.id);
        await this.startExecution(resumableOrphan, workspace, attemptId, generation);
        return;
      }

      // Check if we're at WIP capacity
      const runningExecutingTasks = tasks.filter((candidate) => (
        candidate.frontmatter.phase === 'executing' && hasLiveExecutionSession(candidate.id)
      ));

      if (runningExecutingTasks.length >= wipLimit) {
        return; // At capacity — wait for current to finish
      }

      // Find the next ready task using FIFO.
      // Tasks enter ready on the left (lower order), so the oldest ready task is
      // at the right edge (highest order).
      const readyTasks = tasks
        .filter(t => t.frontmatter.phase === 'ready')
        .filter(t => !(t.frontmatter.planningStatus === 'running' && !t.frontmatter.plan))
        .sort((a, b) => {
          const orderDiff = (a.frontmatter.order ?? 0) - (b.frontmatter.order ?? 0);
          if (orderDiff !== 0) return orderDiff;

          // Keep FIFO behavior for equal-order legacy data by placing newer
          // tasks first, so the oldest task remains at the end/right pick.
          return new Date(b.frontmatter.created).getTime() - new Date(a.frontmatter.created).getTime();
        });

      if (readyTasks.length === 0) {
        return; // Nothing to do
      }

      if (!this.isGenerationActive(generation)) {
        return;
      }

      let nextTask: Task | null = null;
      for (let index = readyTasks.length - 1; index >= 0; index -= 1) {
        const candidate = readyTasks[index];
        const blocked = this.isExecutionBlocked(candidate);
        if (blocked) {
          this.maybeEmitBlockedExecutionNotice(candidate, blocked);
          continue;
        }

        nextTask = candidate;
        break;
      }

      if (!nextTask) {
        await this.broadcastStatus();
        return;
      }

      logger.info(`[QueueManager] Picking up task: ${nextTask.id} (${nextTask.frontmatter.title})`);

      // Move to executing
      const fromState = buildTaskStateSnapshot(nextTask.frontmatter);
      moveTaskToPhase(nextTask, 'executing', 'system', 'Queue manager auto-assigned', tasks);
      this.currentTaskId = nextTask.id;

      await logTaskStateTransition({
        workspaceId: this.workspaceId,
        taskId: nextTask.id,
        from: fromState,
        to: buildTaskStateSnapshot(nextTask.frontmatter),
        source: 'queue:auto-assigned',
        reason: 'Queue manager started execution',
        broadcastToWorkspace: (event) => this.broadcastFn(event),
      });

      this.broadcastFn({
        type: 'task:moved',
        task: nextTask,
        from: 'ready',
        to: 'executing',
      });

      createSystemEvent(
        this.workspaceId,
        nextTask.id,
        'phase-change',
        'Queue manager started execution'
      );

      await this.broadcastStatus();
      const attemptId = this.beginExecutionAttempt(nextTask.id);
      await this.startExecution(nextTask, workspace, attemptId, generation);
    } catch (err) {
      logger.error('[QueueManager] Error processing queue:', err);
    } finally {
      this.processing = false;
    }
  }

  private async startExecution(task: Task, workspace: Workspace, attemptId: string, generation: number): Promise<void> {
    if (!this.isGenerationActive(generation)) {
      this.clearExecutionAttempt(task.id, attemptId);
      if (this.currentTaskId === task.id) {
        this.currentTaskId = null;
      }
      return;
    }

    try {
      await executeTask({
        task,
        workspaceId: this.workspaceId,
        workspacePath: workspace.path,
        broadcastToWorkspace: (event) => this.broadcastFn(event),
        onComplete: (success, details) => {
          void this.handleTaskComplete(task.id, success, attemptId, details);
        },
      });
    } catch (err) {
      logger.error(`[QueueManager] Failed to start execution for ${task.id}:`, err);
      this.clearExecutionAttempt(task.id, attemptId);
      if (this.currentTaskId === task.id) {
        this.currentTaskId = null;
      }

      if (!this.isGenerationActive(generation)) {
        return;
      }

      await this.broadcastStatus();
      // Retry after delay
      setTimeout(() => this.kick(), START_RETRY_DELAY_MS);
    }
  }

  private async handleTaskComplete(
    taskId: string,
    success: boolean,
    attemptId: string,
    details?: ExecutionCompletionDetails,
  ): Promise<void> {
    if (!this.isCurrentExecutionAttempt(taskId, attemptId)) {
      logger.info(`[QueueManager] Ignoring stale completion callback for task ${taskId}`);
      return;
    }

    logger.info(`[QueueManager] Task ${taskId} completed (success: ${success})`);
    this.clearExecutionAttempt(taskId, attemptId);
    if (this.currentTaskId === taskId) {
      this.currentTaskId = null;
    }

    // Re-read task from disk (it may have been modified during execution)
    const workspace = await getWorkspaceById(this.workspaceId);
    if (workspace) {
      const tasksDir = getTasksDir(workspace);
      const tasks = discoverTasks(tasksDir);
      const currentTask = tasks.find(t => t.id === taskId);

      if (currentTask && currentTask.frontmatter.phase === 'executing') {
        if (success) {
          this.resetExecutionFailureBurst(currentTask);

          const fromState = buildTaskStateSnapshot(currentTask.frontmatter);
          moveTaskToPhase(currentTask, 'complete', 'system', 'Execution completed successfully', tasks);

          await logTaskStateTransition({
            workspaceId: this.workspaceId,
            taskId: currentTask.id,
            from: fromState,
            to: buildTaskStateSnapshot(currentTask.frontmatter),
            source: 'queue:execution-complete',
            reason: 'Execution completed successfully',
            broadcastToWorkspace: (event) => this.broadcastFn(event),
          });

          this.broadcastFn({
            type: 'task:moved',
            task: currentTask,
            from: 'executing',
            to: 'complete',
          });
        } else {
          const modelKey = this.getTaskExecutionModelKey(currentTask);
          if (modelKey && details?.errorMessage) {
            this.recordExecutionFailure(modelKey, details.errorMessage);
          }
        }
        // On failure, leave in executing for manual intervention
      }
    }

    await this.broadcastStatus();

    // Process next task after a short delay (let events settle)
    setTimeout(() => this.kick(), 1000);
  }
}

// =============================================================================
// Queue Manager Registry
// =============================================================================

const managers = new Map<string, QueueManager>();

function getOrCreateManager(
  workspaceId: string,
  broadcastFn: (event: ServerEvent) => void,
): QueueManager {
  let manager = managers.get(workspaceId);
  if (!manager) {
    manager = new QueueManager(workspaceId, broadcastFn);
    managers.set(workspaceId, manager);
  }
  return manager;
}

// =============================================================================
// Public API
// =============================================================================

export async function startQueueProcessing(
  workspaceId: string,
  broadcastFn: (event: ServerEvent) => void,
  options?: { persist?: boolean },
): Promise<QueueStatus> {
  const manager = getOrCreateManager(workspaceId, broadcastFn);
  manager.clearExecutionBreakersForManualResume();
  await manager.start();
  if (options?.persist !== false) {
    await persistQueueEnabled(workspaceId, true);
  }
  return manager.getStatus();
}

export async function stopQueueProcessing(
  workspaceId: string,
  options?: { persist?: boolean },
): Promise<QueueStatus> {
  const manager = managers.get(workspaceId);
  if (manager) {
    await manager.stop();
    if (options?.persist !== false) {
      await persistQueueEnabled(workspaceId, false);
    }
    return manager.getStatus();
  }

  if (options?.persist !== false) {
    await persistQueueEnabled(workspaceId, false);
  }
  return getQueueStatus(workspaceId);
}

export async function getQueueStatus(workspaceId: string): Promise<QueueStatus> {
  const manager = managers.get(workspaceId);
  if (manager) {
    return manager.getStatus();
  }

  // No manager — return status from disk state
  const workspace = await getWorkspaceById(workspaceId);
  let tasksInReady = 0;
  let tasksInExecuting = 0;
  let enabled = false;

  if (workspace) {
    const tasksDir = getTasksDir(workspace);
    const tasks = discoverTasks(tasksDir, { scope: 'active' });
    tasksInReady = tasks.filter(t => t.frontmatter.phase === 'ready').length;
    tasksInExecuting = tasks.filter(t => t.frontmatter.phase === 'executing').length;

    const globalWorkflowDefaults = loadGlobalWorkflowSettings();
    const workflowSettings = resolveWorkspaceWorkflowSettings(workspace.config, globalWorkflowDefaults);
    enabled = workflowSettings.readyToExecuting;
  }

  return {
    workspaceId,
    enabled,
    currentTaskId: null,
    tasksInReady,
    tasksInExecuting,
  };
}

/** Kick the queue for a specific workspace (e.g. after a task moves to ready). */
export function kickQueue(workspaceId: string): void {
  const manager = managers.get(workspaceId);
  manager?.kick();
}

// Register queue kicks from other modules through an explicit coordination boundary.
registerQueueKickHandler(kickQueue);

/** Kick all active queue managers (e.g. after any execution completes). */
export function kickAllQueues(): void {
  for (const manager of managers.values()) {
    manager.kick();
  }
}

// =============================================================================
// Initialization (called on server startup)
// =============================================================================

/**
 * Resume queue processing for all workspaces that had it enabled.
 * Call this once on server startup.
 */
export async function initializeQueueManagers(
  broadcastForWorkspace: (workspaceId: string, event: ServerEvent) => void,
): Promise<void> {
  const workspaces = await listWorkspaces();
  const globalWorkflowDefaults = loadGlobalWorkflowSettings();

  for (const workspace of workspaces) {
    const workflowSettings = resolveWorkspaceWorkflowSettings(workspace.config, globalWorkflowDefaults);
    if (workflowSettings.readyToExecuting) {
      logger.info(`[QueueManager] Resuming queue processing for workspace: ${workspace.name}`);
      const manager = getOrCreateManager(
        workspace.id,
        (event) => broadcastForWorkspace(workspace.id, event),
      );
      await manager.start();
    }
  }
}

// =============================================================================
// Persistence
// =============================================================================

async function persistQueueEnabled(workspaceId: string, enabled: boolean): Promise<void> {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) return;

  const workflowAutomation = {
    ...(workspace.config.workflowAutomation ?? {}),
    readyToExecuting: enabled,
  };

  await updateWorkspaceConfig(workspace, {
    queueProcessing: { enabled },
    workflowAutomation,
  });
}
