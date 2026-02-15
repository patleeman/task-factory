import { describe, expect, it } from 'vitest';
import { syncAutomationSettingsWithQueue } from '../../client/src/components/workflow-automation';

describe('workflow automation settings synchronization', () => {
  it('syncs ready→executing toggle state from live queue status when enabled', () => {
    const settings = syncAutomationSettingsWithQueue(
      {
        readyLimit: 25,
        executingLimit: 2,
        backlogToReady: true,
        readyToExecuting: false,
      },
      {
        workspaceId: 'workspace-1',
        enabled: true,
        currentTaskId: null,
        tasksInReady: 0,
        tasksInExecuting: 0,
      },
    );

    expect(settings).toEqual({
      readyLimit: 25,
      executingLimit: 2,
      backlogToReady: true,
      readyToExecuting: true,
    });
  });

  it('syncs ready→executing toggle state from live queue status when disabled', () => {
    const settings = syncAutomationSettingsWithQueue(
      {
        readyLimit: 25,
        executingLimit: 2,
        backlogToReady: true,
        readyToExecuting: true,
      },
      {
        workspaceId: 'workspace-1',
        enabled: false,
        currentTaskId: null,
        tasksInReady: 3,
        tasksInExecuting: 1,
      },
    );

    expect(settings).toEqual({
      readyLimit: 25,
      executingLimit: 2,
      backlogToReady: true,
      readyToExecuting: false,
    });
  });

  it('keeps persisted ready→executing setting when queue status is unavailable', () => {
    const settings = syncAutomationSettingsWithQueue(
      {
        readyLimit: 10,
        executingLimit: 1,
        backlogToReady: false,
        readyToExecuting: false,
      },
      null,
    );

    expect(settings).toEqual({
      readyLimit: 10,
      executingLimit: 1,
      backlogToReady: false,
      readyToExecuting: false,
    });
  });
});
