type QueueKickHandler = (workspaceId: string) => void;

let queueKickHandler: QueueKickHandler | null = null;

export function registerQueueKickHandler(handler: QueueKickHandler): void {
  queueKickHandler = handler;
}

export function requestQueueKick(workspaceId: string): void {
  if (!queueKickHandler) {
    return;
  }

  try {
    queueKickHandler(workspaceId);
  } catch (err) {
    console.error(`[QueueKickCoordinator] Failed to kick queue for workspace ${workspaceId}:`, err);
  }
}
