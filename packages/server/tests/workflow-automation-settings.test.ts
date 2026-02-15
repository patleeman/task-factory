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
    expect(defaults.readyLimit).toBe(25);
  });

  it('resolves global workflow defaults from settings payload values', () => {
    const defaults = resolveGlobalWorkflowSettings({
      readyLimit: 30,
      executingLimit: 3,
      backlogToReady: true,
      readyToExecuting: false,
    });

    expect(defaults).toEqual({
      readyLimit: 30,
      executingLimit: 3,
      backlogToReady: true,
      readyToExecuting: false,
    });
  });

  it('inherits workspace workflow values from global defaults when overrides are unset', () => {
    const settings = resolveWorkspaceWorkflowSettings(
      createBaseConfig(),
      {
        readyLimit: 24,
        executingLimit: 2,
        backlogToReady: true,
        readyToExecuting: false,
      },
    );

    expect(settings).toEqual({
      readyLimit: 24,
      executingLimit: 2,
      backlogToReady: true,
      readyToExecuting: false,
    });
  });

  it('prefers workspace overrides over global defaults for slots and automation', () => {
    const settings = resolveWorkspaceWorkflowSettings(
      createBaseConfig({
        wipLimits: {
          ready: 7,
          executing: 1,
        },
        workflowAutomation: {
          backlogToReady: false,
          readyToExecuting: true,
        },
      }),
      {
        readyLimit: 30,
        executingLimit: 3,
        backlogToReady: true,
        readyToExecuting: false,
      },
    );

    expect(settings).toEqual({
      readyLimit: 7,
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
      readyLimit: undefined,
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

  it('resolves ready and executing WIP limits from workflow settings', () => {
    const config = createBaseConfig({
      wipLimits: {
        ready: 9,
        complete: null,
      },
    });

    const globalDefaults = {
      readyLimit: 25,
      executingLimit: 2,
      backlogToReady: false,
      readyToExecuting: true,
    };

    expect(resolveWorkspaceWipLimit(config, 'ready', globalDefaults)).toBe(9);
    expect(resolveWorkspaceWipLimit(config, 'executing', globalDefaults)).toBe(2);
    expect(resolveWorkspaceWipLimit(config, 'complete', globalDefaults)).toBeNull();
    expect(resolveWorkspaceWipLimit(createBaseConfig(), 'ready', undefined)).toBe(25);
  });

  it('applies ready-slot threshold semantics used by manual move checks', () => {
    const readyLimit = resolveWorkspaceWipLimit(createBaseConfig(), 'ready', undefined);
    if (readyLimit === null) {
      throw new Error('Expected a finite ready limit');
    }

    const canMoveIntoReady = (tasksInReady: number): boolean => tasksInReady < readyLimit;

    expect(canMoveIntoReady(24)).toBe(true);
    expect(canMoveIntoReady(25)).toBe(false);
  });
});
