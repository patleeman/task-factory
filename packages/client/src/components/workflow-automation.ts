import type { QueueStatus, WorkspaceAutomationSettings } from '@pi-factory/shared'

export function syncAutomationSettingsWithQueue(
  settings: WorkspaceAutomationSettings,
  queueStatus: QueueStatus | null,
): WorkspaceAutomationSettings {
  return {
    backlogToReady: settings.backlogToReady,
    readyToExecuting: queueStatus?.enabled ?? settings.readyToExecuting,
  }
}
