export type ActiveSessionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';

export interface ActiveSessionLike {
  taskId: string;
  workspaceId: string;
  status: ActiveSessionStatus;
  startTime: string;
  endTime?: string;
}

export interface ExecutionSnapshot {
  taskId: string;
  workspaceId: string;
  status: ActiveSessionStatus;
  startTime: string;
  endTime?: string;
  isRunning: boolean;
}

function toExecutionSnapshot(session: ActiveSessionLike): ExecutionSnapshot {
  return {
    taskId: session.taskId,
    workspaceId: session.workspaceId,
    status: session.status,
    startTime: session.startTime,
    endTime: session.endTime,
    isRunning: session.status === 'running',
  };
}

export function buildExecutionSnapshots(
  sessions: ActiveSessionLike[],
  workspaceId?: string,
): ExecutionSnapshot[] {
  const workspaceSessions = workspaceId
    ? sessions.filter((session) => session.workspaceId === workspaceId)
    : sessions;

  return workspaceSessions.map(toExecutionSnapshot);
}
