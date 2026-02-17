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

import type { Task, ServerEvent, QueueStatus, Workspace } from '@task-factory/shared';
import { randomUUID } from 'crypto';
import { resolveWorkspaceWorkflowSettings } from '@task-factory/shared';
import { getWorkspaceById, getTasksDir, listWorkspaces, updateWorkspaceConfig } from './workspace-service.js';
import { discoverTasks, moveTaskToPhase } from './task-service.js';
import { loadGlobalWorkflowSettings } from './workflow-settings-service.js';
import { executeTask, hasLiveExecutionSession, stopTaskExecution } from './agent-execution-service.js';
import { createSystemEvent } from './activity-service.js';
import { logger } from './logger.js';
import { buildTaskStateSnapshot } from './state-contract.js';
import { logTaskStateTransition } from './state-transition.js';
import { registerQueueKickHandler } from './queue-kick-coordinator.js';

// =============================================================================
// Constants
// =============================================================================

const POLL_INTERVAL_MS = 30_000; // Safety poll every 30 seconds



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
    const workspace = await getWorkspaceById(this.workspaceId);
    let tasksInReady = 0;
    let tasksInExecuting = 0;

    if (workspace) {
      const tasksDir = getTasksDir(workspace);
      const tasks = discoverTasks(tasksDir, { scope: 'active' });
      tasksInReady = tasks.filter(t => t.frontmatter.phase === 'ready').length;
      tasksInExecuting = tasks.filter(t => t.frontmatter.phase === 'executing').length;
    }

    return {
      workspaceId: this.workspaceId,
      enabled: this.enabled,
      currentTaskId: this.currentTaskId,
      tasksInReady,
      tasksInExecuting,
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

  private async processNext(generation: number): Promise<void> {
    if (!this.isGenerationActive(generation) || this.processing) return;
    this.processing = true;

    try {
      const workspace = await getWorkspaceById(this.workspaceId);
      if (!workspace || !this.isGenerationActive(generation)) return;

      const tasksDir = getTasksDir(workspace);
      const tasks = discoverTasks(tasksDir);
      if (!this.isGenerationActive(generation)) return;

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

      const nextTask = readyTasks[readyTasks.length - 1];
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
        onComplete: (success) => {
          void this.handleTaskComplete(task.id, success, attemptId);
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
      setTimeout(() => this.kick(), 5000);
    }
  }

  private async handleTaskComplete(taskId: string, success: boolean, attemptId: string): Promise<void> {
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
