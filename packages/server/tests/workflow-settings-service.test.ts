import { describe, expect, it } from 'vitest';
import {
  applyWorkflowPatchToWorkspaceConfig,
  buildWorkspaceWorkflowSettingsResponse,
  normalizePiFactorySettingsPayload,
  parseWorkspaceWorkflowPatch,
} from '../src/workflow-settings-service.js';
import type { WorkspaceConfig } from '@pi-factory/shared';

function createWorkspaceConfig(overrides: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
  return {
    taskLocations: ['.taskfactory/tasks'],
    defaultTaskLocation: '.taskfactory/tasks',
    ...overrides,
  };
}

describe('workflow-settings-service', () => {
  it('validates global workflow defaults payload ranges and types', () => {
    const invalidBody = normalizePiFactorySettingsPayload('bad' as unknown as Record<string, unknown>);
    expect(invalidBody.ok).toBe(false);

    const invalid = normalizePiFactorySettingsPayload({
      workflowDefaults: {
        readyLimit: '2' as unknown as number,
      },
    });

    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error).toContain('workflowDefaults.readyLimit');
    }

    const invalidExecuting = normalizePiFactorySettingsPayload({
      workflowDefaults: {
        executingLimit: '2' as unknown as number,
      },
    });

    expect(invalidExecuting.ok).toBe(false);
    if (!invalidExecuting.ok) {
      expect(invalidExecuting.error).toContain('workflowDefaults.executingLimit');
    }

    const valid = normalizePiFactorySettingsPayload({
      workflowDefaults: {
        readyLimit: 25,
        executingLimit: 2,
        backlogToReady: true,
        readyToExecuting: false,
      },
    });

    expect(valid).toEqual({
      ok: true,
      value: {
        workflowDefaults: {
          readyLimit: 25,
          executingLimit: 2,
          backlogToReady: true,
          readyToExecuting: false,
        },
      },
    });
  });

  it('rejects empty workspace workflow patch payloads', () => {
    const result = parseWorkspaceWorkflowPatch({});

    expect(result).toEqual({
      ok: false,
      error: 'At least one workflow setting must be provided',
    });
  });

  it('accepts workspace workflow patch values and supports null to inherit', () => {
    const result = parseWorkspaceWorkflowPatch({
      readyLimit: 3,
      executingLimit: null,
      backlogToReady: true,
      readyToExecuting: null,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        readyLimit: 3,
        executingLimit: null,
        backlogToReady: true,
        readyToExecuting: null,
      },
    });
  });

  it('builds workspace automation API responses with legacy + effective + override fields', () => {
    const response = buildWorkspaceWorkflowSettingsResponse(
      createWorkspaceConfig({
        wipLimits: {
          ready: 4,
        },
        workflowAutomation: {
          backlogToReady: true,
        },
      }),
      {
        workspaceId: 'workspace-1',
        enabled: true,
        currentTaskId: null,
        tasksInReady: 0,
        tasksInExecuting: 0,
      },
      {
        readyLimit: 25,
        executingLimit: 2,
        backlogToReady: false,
        readyToExecuting: true,
      },
    );

    expect(response.settings).toEqual({
      backlogToReady: true,
      readyToExecuting: true,
    });

    expect(response.effective).toEqual({
      readyLimit: 4,
      executingLimit: 2,
      backlogToReady: true,
      readyToExecuting: true,
    });

    expect(response.overrides).toEqual({
      readyLimit: 4,
      executingLimit: undefined,
      backlogToReady: true,
      readyToExecuting: undefined,
    });
  });

  it('applies patch overrides and clears legacy queueProcessing when ready→executing inherits global defaults', () => {
    const globalDefaults = {
      readyLimit: 25,
      executingLimit: 2,
      backlogToReady: false,
      readyToExecuting: true,
    };

    const patchResult = applyWorkflowPatchToWorkspaceConfig(
      createWorkspaceConfig({
        wipLimits: {
          ready: 4,
          executing: 1,
        },
        workflowAutomation: {
          backlogToReady: true,
          readyToExecuting: false,
        },
        queueProcessing: { enabled: false },
      }),
      {
        readyLimit: null,
        executingLimit: 5,
        backlogToReady: null,
        readyToExecuting: null,
      },
      globalDefaults,
    );

    expect(patchResult.nextConfig.wipLimits?.ready).toBeUndefined();
    expect(patchResult.nextConfig.wipLimits?.executing).toBe(5);
    expect(patchResult.nextConfig.workflowAutomation?.backlogToReady).toBeUndefined();
    expect(patchResult.nextConfig.workflowAutomation?.readyToExecuting).toBeUndefined();
    expect(patchResult.nextConfig.queueProcessing).toBeUndefined();

    expect(patchResult.effective).toEqual({
      readyLimit: 25,
      executingLimit: 5,
      backlogToReady: false,
      readyToExecuting: true,
    });
  });
});
