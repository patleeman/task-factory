import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKFLOW_SETTINGS,
  getWorkspaceAutomationSettings,
  getWorkspaceWorkflowOverrides,
  resolveGlobalWorkflowSettings,
  resolveWorkspaceWipLimit,
  resolveWorkspaceWorkflowSettings,
  type WorkspaceConfig,
} from '@pi-factory/shared';

describe('workflow settings resolution', () => {
  function createBaseConfig(overrides: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
    return {
      taskLocations: ['.pi/tasks'],
      defaultTaskLocation: '.pi/tasks',
      ...overrides,
    };
  }

  it('falls back to built-in global workflow defaults when unset', () => {
    const defaults = resolveGlobalWorkflowSettings(undefined);

    expect(defaults).toEqual(DEFAULT_WORKFLOW_SETTINGS);
  });

  it('resolves global workflow defaults from settings payload values', () => {
    const defaults = resolveGlobalWorkflowSettings({
      executingLimit: 3,
      backlogToReady: true,
      readyToExecuting: false,
    });

    expect(defaults).toEqual({
      executingLimit: 3,
      backlogToReady: true,
      readyToExecuting: false,
    });
  });

  it('inherits workspace workflow values from global defaults when overrides are unset', () => {
    const settings = resolveWorkspaceWorkflowSettings(
      createBaseConfig(),
      {
        executingLimit: 2,
        backlogToReady: true,
        readyToExecuting: false,
      },
    );

    expect(settings).toEqual({
      executingLimit: 2,
      backlogToReady: true,
      readyToExecuting: false,
    });
  });

  it('prefers workspace overrides over global defaults for slots and automation', () => {
    const settings = resolveWorkspaceWorkflowSettings(
      createBaseConfig({
        wipLimits: {
          executing: 1,
        },
        workflowAutomation: {
          backlogToReady: false,
          readyToExecuting: true,
        },
      }),
      {
        executingLimit: 3,
        backlogToReady: true,
        readyToExecuting: false,
      },
    );

    expect(settings).toEqual({
      executingLimit: 1,
      backlogToReady: false,
      readyToExecuting: true,
    });
  });

  it('keeps backward compatibility by reading ready→executing from legacy queueProcessing', () => {
    const overrides = getWorkspaceWorkflowOverrides(createBaseConfig({
      queueProcessing: { enabled: false },
    }));

    expect(overrides).toEqual({
      executingLimit: undefined,
      backlogToReady: undefined,
      readyToExecuting: false,
    });

    expect(getWorkspaceAutomationSettings(createBaseConfig({
      queueProcessing: { enabled: false },
    }))).toEqual({
      backlogToReady: false,
      readyToExecuting: false,
    });
  });

  it('treats ready as unlimited and still resolves executing + other phase limits', () => {
    const config = createBaseConfig({
      wipLimits: {
        ready: 1,
        complete: null,
      },
    });

    const globalDefaults = {
      executingLimit: 2,
      backlogToReady: false,
      readyToExecuting: true,
    };

    expect(resolveWorkspaceWipLimit(config, 'ready', globalDefaults)).toBeNull();
    expect(resolveWorkspaceWipLimit(config, 'executing', globalDefaults)).toBe(2);
    expect(resolveWorkspaceWipLimit(config, 'complete', globalDefaults)).toBeNull();
  });
});
