import type { Phase } from '@task-factory/shared';

export interface AwaitingInputSessionLike {
  workspaceId: string;
  taskId: string;
  awaitingUserInput?: boolean;
}

export interface WorkspaceAttentionSummary {
  workspaceId: string;
  awaitingInputCount: number;
}

export function buildWorkspaceAttentionSummary(
  workspaceIds: string[],
  taskPhaseByWorkspace: Map<string, Map<string, Phase>>,
  sessions: AwaitingInputSessionLike[],
): WorkspaceAttentionSummary[] {
  const awaitingInputCounts = new Map<string, number>();
  for (const workspaceId of workspaceIds) {
    awaitingInputCounts.set(workspaceId, 0);
  }

  for (const session of sessions) {
    if (!session.awaitingUserInput) {
      continue;
    }

    const phaseByTask = taskPhaseByWorkspace.get(session.workspaceId);
    const taskPhase = phaseByTask?.get(session.taskId);
    if (taskPhase !== 'executing') {
      continue;
    }

    awaitingInputCounts.set(
      session.workspaceId,
      (awaitingInputCounts.get(session.workspaceId) || 0) + 1,
    );
  }

  return workspaceIds.map((workspaceId) => ({
    workspaceId,
    awaitingInputCount: awaitingInputCounts.get(workspaceId) || 0,
  }));
}
