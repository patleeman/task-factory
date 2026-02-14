import { describe, expect, it } from 'vitest';
import { getWorkspaceAutomationSettings, type WorkspaceConfig } from '@pi-factory/shared';

describe('getWorkspaceAutomationSettings', () => {
  function createBaseConfig(overrides: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
    return {
      taskLocations: ['.pi/tasks'],
      defaultTaskLocation: '.pi/tasks',
      ...overrides,
    };
  }

  it('defaults both automation flags to false when unset', () => {
    const settings = getWorkspaceAutomationSettings(createBaseConfig());

    expect(settings).toEqual({
      backlogToReady: false,
      readyToExecuting: false,
    });
  });

  it('keeps backward compatibility by reading ready→executing from legacy queueProcessing', () => {
    const settings = getWorkspaceAutomationSettings(createBaseConfig({
      queueProcessing: { enabled: true },
    }));

    expect(settings).toEqual({
      backlogToReady: false,
      readyToExecuting: true,
    });
  });

  it('prefers explicit workflowAutomation values over legacy queueProcessing values', () => {
    const settings = getWorkspaceAutomationSettings(createBaseConfig({
      queueProcessing: { enabled: true },
      workflowAutomation: {
        backlogToReady: true,
        readyToExecuting: false,
      },
    }));

    expect(settings).toEqual({
      backlogToReady: true,
      readyToExecuting: false,
    });
  });
});
