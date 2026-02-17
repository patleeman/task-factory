import type { ServerEvent } from '@task-factory/shared';
import { createSystemEvent } from './activity-service.js';
import type { TaskStateSnapshot } from './state-contract.js';

export interface TaskStateTransitionMetadata {
  kind: 'state-transition';
  source: string;
  reason?: string;
  from: TaskStateSnapshot;
  to: TaskStateSnapshot;
}

export interface LogTaskStateTransitionOptions {
  workspaceId: string;
  taskId: string;
  from: TaskStateSnapshot;
  to: TaskStateSnapshot;
  source: string;
  reason?: string;
  broadcastToWorkspace?: (event: ServerEvent) => void;
}

function snapshotsEqual(a: TaskStateSnapshot, b: TaskStateSnapshot): boolean {
  return a.mode === b.mode
    && a.phase === b.phase
    && a.planningStatus === b.planningStatus;
}

function formatStateSnapshot(snapshot: TaskStateSnapshot): string {
  return `<state>${snapshot.phase}</state> <mode>${snapshot.mode}</mode> <planning_status>${snapshot.planningStatus}</planning_status>`;
}

/**
 * Persist and optionally broadcast a structured task state transition event.
 *
 * The human-visible message is intentionally compact (XML-like tags), while
 * full transition details are carried in metadata for machine parsing.
 */
export async function logTaskStateTransition(options: LogTaskStateTransitionOptions): Promise<void> {
  const { workspaceId, taskId, from, to, source, reason, broadcastToWorkspace } = options;

  if (snapshotsEqual(from, to)) {
    return;
  }

  const metadata: TaskStateTransitionMetadata = {
    kind: 'state-transition',
    source,
    reason,
    from,
    to,
  };

  const entry = await createSystemEvent(
    workspaceId,
    taskId,
    'phase-change',
    formatStateSnapshot(to),
    metadata as unknown as Record<string, unknown>,
  );

  broadcastToWorkspace?.({ type: 'activity:entry', entry });
}
