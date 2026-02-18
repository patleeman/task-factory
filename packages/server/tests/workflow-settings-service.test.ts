import { describe, expect, it } from 'vitest';
import {
  applyWorkflowPatchToWorkspaceConfig,
  buildWorkspaceWorkflowSettingsResponse,
  normalizePiFactorySettingsPayload,
  parseWorkspaceWorkflowPatch,
} from '../src/workflow-settings-service.js';
import type { WorkspaceConfig } from '@task-factory/shared';

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

  it('normalizes reusable model profiles in global settings payloads', () => {
    const result = normalizePiFactorySettingsPayload({
      modelProfiles: [
        {
          id: 'deep-think',
          name: 'Deep Think',
          planningModelConfig: {
            provider: 'openai',
            modelId: 'gpt-5.3',
            thinkingLevel: 'xhigh',
          },
          executionModelConfig: {
            provider: 'anthropic',
            modelId: 'claude-sonnet-4.6',
            thinkingLevel: 'medium',
          },
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        modelProfiles: [
          {
            id: 'deep-think',
            name: 'Deep Think',
            planningModelConfig: {
              provider: 'openai',
              modelId: 'gpt-5.3',
              thinkingLevel: 'xhigh',
            },
            executionModelConfig: {
              provider: 'anthropic',
              modelId: 'claude-sonnet-4.6',
              thinkingLevel: 'medium',
            },
            modelConfig: {
              provider: 'anthropic',
              modelId: 'claude-sonnet-4.6',
              thinkingLevel: 'medium',
            },
          },
        ],
      },
    });
  });

  it('rejects malformed model profile entries', () => {
    const missingName = normalizePiFactorySettingsPayload({
      modelProfiles: [
        {
          id: 'missing-name',
          planningModelConfig: { provider: 'openai', modelId: 'gpt-5.3' },
          executionModelConfig: { provider: 'openai', modelId: 'gpt-5.3' },
        } as any,
      ],
    });

    expect(missingName.ok).toBe(false);
    if (!missingName.ok) {
      expect(missingName.error).toContain('modelProfiles[0].name');
    }

    const missingExecution = normalizePiFactorySettingsPayload({
      modelProfiles: [
        {
          id: 'missing-exec',
          name: 'Missing Exec',
          planningModelConfig: { provider: 'openai', modelId: 'gpt-5.3' },
        } as any,
      ],
    });

    expect(missingExecution.ok).toBe(false);
    if (!missingExecution.ok) {
      expect(missingExecution.error).toContain('modelProfiles[0].executionModelConfig');
    }

    const duplicateIds = normalizePiFactorySettingsPayload({
      modelProfiles: [
        {
          id: 'shared-id',
          name: 'One',
          planningModelConfig: { provider: 'openai', modelId: 'gpt-5.3' },
          executionModelConfig: { provider: 'openai', modelId: 'gpt-5.3' },
        },
        {
          id: 'shared-id',
          name: 'Two',
          planningModelConfig: { provider: 'openai', modelId: 'gpt-5.3' },
          executionModelConfig: { provider: 'openai', modelId: 'gpt-5.3' },
        },
      ],
    });

    expect(duplicateIds.ok).toBe(false);
    if (!duplicateIds.ok) {
      expect(duplicateIds.error).toContain('modelProfiles[1].id must be unique');
    }
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

  it('applies explicit ready→executing disable patches to both workflowAutomation and queueProcessing', () => {
    const globalDefaults = {
      readyLimit: 25,
      executingLimit: 2,
      backlogToReady: false,
      readyToExecuting: true,
    };

    const patchResult = applyWorkflowPatchToWorkspaceConfig(
      createWorkspaceConfig({
        workflowAutomation: {
          backlogToReady: false,
          readyToExecuting: true,
        },
        queueProcessing: { enabled: true },
      }),
      {
        readyToExecuting: false,
      },
      globalDefaults,
    );

    expect(patchResult.nextConfig.workflowAutomation?.readyToExecuting).toBe(false);
    expect(patchResult.nextConfig.queueProcessing).toEqual({ enabled: false });
    expect(patchResult.effective.readyToExecuting).toBe(false);
  });

  it('applies explicit ready→executing enable patches to both workflowAutomation and queueProcessing', () => {
    const globalDefaults = {
      readyLimit: 25,
      executingLimit: 2,
      backlogToReady: false,
      readyToExecuting: false,
    };

    const patchResult = applyWorkflowPatchToWorkspaceConfig(
      createWorkspaceConfig({
        workflowAutomation: {
          backlogToReady: false,
          readyToExecuting: false,
        },
        queueProcessing: { enabled: false },
      }),
      {
        readyToExecuting: true,
      },
      globalDefaults,
    );

    expect(patchResult.nextConfig.workflowAutomation?.readyToExecuting).toBe(true);
    expect(patchResult.nextConfig.queueProcessing).toEqual({ enabled: true });
    expect(patchResult.effective.readyToExecuting).toBe(true);
  });
});
