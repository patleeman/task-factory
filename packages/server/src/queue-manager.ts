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

import type { Task, ServerEvent, QueueStatus, Workspace } from '@pi-factory/shared';
import { DEFAULT_WIP_LIMITS, getWorkspaceAutomationSettings } from '@pi-factory/shared';
import { getWorkspaceById, getTasksDir, listWorkspaces, updateWorkspaceConfig } from './workspace-service.js';
import { discoverTasks, moveTaskToPhase } from './task-service.js';
import { executeTask, hasRunningSession } from './agent-execution-service.js';
import { createSystemEvent } from './activity-service.js';
import { logger } from './logger.js';
import { buildTaskStateSnapshot } from './state-contract.js';
import { logTaskStateTransition } from './state-transition.js';

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

  constructor(workspaceId: string, broadcastFn: (event: ServerEvent) => void) {
    this.workspaceId = workspaceId;
    this.broadcastFn = broadcastFn;
  }

  async start(): Promise<void> {
    if (this.enabled) return;
    this.enabled = true;
    logger.info(`[QueueManager] Started for workspace ${this.workspaceId}`);
    await this.broadcastStatus();

    // Safety poll — ensures we don't miss events
    this.pollTimer = setInterval(() => this.kick(), POLL_INTERVAL_MS);

    // Immediately try to process
    this.kick();
  }

  async stop(): Promise<void> {
    this.enabled = false;
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
    void this.processNext();
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
      const tasks = discoverTasks(tasksDir);
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

  private async processNext(): Promise<void> {
    if (!this.enabled || this.processing) return;
    this.processing = true;

    try {
      const workspace = await getWorkspaceById(this.workspaceId);
      if (!workspace) return;

      const tasksDir = getTasksDir(workspace);
      const tasks = discoverTasks(tasksDir);

      const executingTasks = tasks.filter(t => t.frontmatter.phase === 'executing');
      const wipLimit = workspace.config.wipLimits?.executing ?? DEFAULT_WIP_LIMITS.executing ?? 1;

      // Check for orphaned executing tasks (no active session — e.g. after server restart)
      // Only resume orphans that haven't been attempted recently (avoid infinite retry loops
      // for tasks that keep failing). Orphans are tasks in 'executing' with no running session.
      const orphanedTasks = executingTasks.filter(t => !hasRunningSession(t.id));

      // Count active (running) tasks toward WIP limit
      const activeTasks = executingTasks.filter(t => hasRunningSession(t.id));

      if (orphanedTasks.length > 0 && activeTasks.length < wipLimit) {
        const orphan = orphanedTasks[0];

        // If the orphan was recently started (within last 2 minutes), it likely failed —
        // move it back to ready instead of endlessly retrying
        const lastStarted = orphan.frontmatter.started
          ? new Date(orphan.frontmatter.started).getTime()
          : 0;
        const recentlyStarted = Date.now() - lastStarted < 2 * 60 * 1000;

        if (recentlyStarted) {
          logger.info(`[QueueManager] Orphaned task ${orphan.id} failed recently — moving back to ready`);
          const fromState = buildTaskStateSnapshot(orphan.frontmatter);
          moveTaskToPhase(orphan, 'ready', 'system', 'Moved back to ready after execution failure', tasks);

          await logTaskStateTransition({
            workspaceId: this.workspaceId,
            taskId: orphan.id,
            from: fromState,
            to: buildTaskStateSnapshot(orphan.frontmatter),
            source: 'queue:orphan-reset',
            reason: 'Moved back to ready after execution failure',
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
            'Task moved back to ready after execution failure (will retry from queue)'
          );
          // Fall through to pick up next ready task below
        } else {
          logger.info(`[QueueManager] Resuming orphaned task: ${orphan.id}`);
          this.currentTaskId = orphan.id;
          await this.broadcastStatus();

          createSystemEvent(
            this.workspaceId,
            orphan.id,
            'phase-change',
            'Queue manager resuming orphaned task after server restart'
          );

          await this.startExecution(orphan, workspace);
          return;
        }
      }

      // Check if we're at WIP capacity
      if (activeTasks.length >= wipLimit) {
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
      await this.startExecution(nextTask, workspace);
    } catch (err) {
      logger.error('[QueueManager] Error processing queue:', err);
    } finally {
      this.processing = false;
    }
  }

  private async startExecution(task: Task, workspace: Workspace): Promise<void> {
    try {
      await executeTask({
        task,
        workspaceId: this.workspaceId,
        workspacePath: workspace.path,
        broadcastToWorkspace: (event) => this.broadcastFn(event),
        onComplete: (success) => {
          void this.handleTaskComplete(task.id, success);
        },
      });
    } catch (err) {
      logger.error(`[QueueManager] Failed to start execution for ${task.id}:`, err);
      this.currentTaskId = null;
      await this.broadcastStatus();
      // Retry after delay
      setTimeout(() => this.kick(), 5000);
    }
  }

  private async handleTaskComplete(taskId: string, success: boolean): Promise<void> {
    logger.info(`[QueueManager] Task ${taskId} completed (success: ${success})`);
    this.currentTaskId = null;

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
): Promise<QueueStatus> {
  const manager = getOrCreateManager(workspaceId, broadcastFn);
  await manager.start();
  await persistQueueEnabled(workspaceId, true);
  return manager.getStatus();
}

export async function stopQueueProcessing(workspaceId: string): Promise<QueueStatus> {
  const manager = managers.get(workspaceId);
  if (manager) {
    await manager.stop();
    await persistQueueEnabled(workspaceId, false);
    return manager.getStatus();
  }

  await persistQueueEnabled(workspaceId, false);
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
    const tasks = discoverTasks(tasksDir);
    tasksInReady = tasks.filter(t => t.frontmatter.phase === 'ready').length;
    tasksInExecuting = tasks.filter(t => t.frontmatter.phase === 'executing').length;
    enabled = getWorkspaceAutomationSettings(workspace.config).readyToExecuting;
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

  for (const workspace of workspaces) {
    const automation = getWorkspaceAutomationSettings(workspace.config);
    if (automation.readyToExecuting) {
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

  const currentAutomation = getWorkspaceAutomationSettings(workspace.config);
  await updateWorkspaceConfig(workspace, {
    queueProcessing: { enabled },
    workflowAutomation: {
      backlogToReady: currentAutomation.backlogToReady,
      readyToExecuting: enabled,
    },
  });
}
