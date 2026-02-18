import type { ServerEvent, Task } from '@task-factory/shared';
import { listWorkspaces, getTasksDir } from './workspace-service.js';
import { discoverTasks, moveTaskToPhase } from './task-service.js';
import { createSystemEvent } from './activity-service.js';
import { logger } from './logger.js';
import { hasLiveExecutionSession } from './agent-execution-service.js';
import {
  clearExecutionLease,
  getExecutionLeaseTtlMs,
  isExecutionLeaseFresh,
  loadExecutionLeases,
  type ExecutionLease,
} from './execution-lease-service.js';

export interface StartupExecutionRecoveryResult {
  inspectedTaskCount: number;
  recoveredTaskIds: string[];
  skippedFreshTaskIds: string[];
}

export interface RecoverStaleExecutingSessionsOptions {
  broadcastToWorkspace?: (workspaceId: string, event: ServerEvent) => void;
  nowMs?: number;
  ttlMs?: number;
}

function formatStaleReason(lease: ExecutionLease | undefined, nowMs: number, ttlMs: number): string {
  if (!lease) {
    return 'missing lease metadata';
  }

  const heartbeatMs = Date.parse(lease.lastHeartbeatAt);
  if (!Number.isFinite(heartbeatMs) || heartbeatMs <= 0) {
    return `invalid lease heartbeat timestamp (owner=${lease.ownerId})`;
  }

  const ageMs = Math.max(0, nowMs - heartbeatMs);
  return `lease heartbeat expired (${ageMs}ms > ${ttlMs}ms, owner=${lease.ownerId})`;
}

function recoverTaskToReady(task: Task, allTasks: Task[]): void {
  moveTaskToPhase(
    task,
    'ready',
    'system',
    'Recovered stale executing session after startup',
    allTasks,
  );
}

export async function recoverStaleExecutingSessionsOnStartup(
  options: RecoverStaleExecutingSessionsOptions = {},
): Promise<StartupExecutionRecoveryResult> {
  const nowMs = options.nowMs ?? Date.now();
  const ttlMs = options.ttlMs ?? getExecutionLeaseTtlMs();
  const recoveredTaskIds: string[] = [];
  const skippedFreshTaskIds: string[] = [];
  let inspectedTaskCount = 0;

  const workspaces = await listWorkspaces();

  for (const workspace of workspaces) {
    const tasks = discoverTasks(getTasksDir(workspace));
    const executingTasks = tasks.filter((task) => task.frontmatter.phase === 'executing');

    if (executingTasks.length === 0) {
      continue;
    }

    const leases = await loadExecutionLeases(workspace.path);

    for (const task of executingTasks) {
      inspectedTaskCount += 1;

      if (hasLiveExecutionSession(task.id)) {
        skippedFreshTaskIds.push(task.id);
        continue;
      }

      const lease = leases[task.id];
      if (isExecutionLeaseFresh(lease, { nowMs, ttlMs })) {
        skippedFreshTaskIds.push(task.id);
        continue;
      }

      recoverTaskToReady(task, tasks);
      recoveredTaskIds.push(task.id);

      const recoveredAt = new Date(nowMs).toISOString();
      const staleReason = formatStaleReason(lease, nowMs, ttlMs);
      const message = `Recovered stale executing session at ${recoveredAt}; moved task back to ready (${staleReason}).`;

      const entry = await createSystemEvent(
        workspace.id,
        task.id,
        'phase-change',
        message,
        {
          kind: 'startup-stale-execution-recovery',
          recoveredAt,
          staleReason,
          ttlMs,
          ownerId: lease?.ownerId,
          leaseLastHeartbeatAt: lease?.lastHeartbeatAt,
        },
      );

      options.broadcastToWorkspace?.(workspace.id, { type: 'activity:entry', entry });

      await clearExecutionLease(workspace.path, task.id);

      logger.info(`[Startup] Recovered stale executing task ${task.id} in workspace ${workspace.name}`);
    }
  }

  if (recoveredTaskIds.length > 0) {
    logger.info(`[Startup] Recovered ${recoveredTaskIds.length} stale executing task(s)`);
  }

  return {
    inspectedTaskCount,
    recoveredTaskIds,
    skippedFreshTaskIds,
  };
}
