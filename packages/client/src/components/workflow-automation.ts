import type { QueueStatus, WorkspaceWorkflowSettings } from '@pi-factory/shared'

export function syncAutomationSettingsWithQueue(
  settings: WorkspaceWorkflowSettings,
  queueStatus: QueueStatus | null,
): WorkspaceWorkflowSettings {
  return {
    ...settings,
    readyToExecuting: queueStatus?.enabled ?? settings.readyToExecuting,
  }
}

export function isFactoryRunningState(
  settings: Pick<WorkspaceWorkflowSettings, 'backlogToReady' | 'readyToExecuting'>,
  liveExecutionCount: number,
): boolean {
  return settings.backlogToReady || settings.readyToExecuting || liveExecutionCount > 0
}
