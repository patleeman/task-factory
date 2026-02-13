export type ActiveSessionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';

export interface ActiveSessionLike {
  taskId: string;
  workspaceId: string;
  status: ActiveSessionStatus;
  startTime: string;
  endTime?: string;
  awaitingUserInput?: boolean;
}

export interface ExecutionSnapshot {
  taskId: string;
  workspaceId: string;
  status: ActiveSessionStatus;
  startTime: string;
  endTime?: string;
  isRunning: boolean;
  awaitingInput: boolean;
}

function toExecutionSnapshot(session: ActiveSessionLike): ExecutionSnapshot {
  const awaitingInput = session.status === 'idle' && session.awaitingUserInput === true;

  return {
    taskId: session.taskId,
    workspaceId: session.workspaceId,
    status: session.status,
    startTime: session.startTime,
    endTime: session.endTime,
    isRunning: session.status === 'running',
    awaitingInput,
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
