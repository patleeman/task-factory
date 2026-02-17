import { describe, expect, it } from 'vitest';
import type { TaskDefaults } from '@task-factory/shared';
import { buildCreateTaskFormDefaults } from '../../client/src/components/task-default-form';

describe('create-task form defaults', () => {
  it('maps workspace task defaults to create-task form state', () => {
    const defaults: TaskDefaults = {
      planningModelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
        thinkingLevel: 'low',
      },
      executionModelConfig: {
        provider: 'openai',
        modelId: 'gpt-4o',
      },
      modelConfig: {
        provider: 'openai',
        modelId: 'gpt-4o',
      },
      preExecutionSkills: ['checkpoint'],
      postExecutionSkills: ['checkpoint', 'code-review'],
    };

    const formDefaults = buildCreateTaskFormDefaults(defaults);

    expect(formDefaults).toEqual({
      selectedPreSkillIds: ['checkpoint'],
      selectedSkillIds: ['checkpoint', 'code-review'],
      planningModelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
        thinkingLevel: 'low',
      },
      executionModelConfig: {
        provider: 'openai',
        modelId: 'gpt-4o',
      },
    });
  });

  it('falls back to legacy modelConfig when executionModelConfig is absent', () => {
    const defaults: TaskDefaults = {
      planningModelConfig: undefined,
      executionModelConfig: undefined,
      modelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
        thinkingLevel: 'medium',
      },
      preExecutionSkills: [],
      postExecutionSkills: ['checkpoint'],
    };

    const formDefaults = buildCreateTaskFormDefaults(defaults);

    expect(formDefaults.executionModelConfig).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4',
      thinkingLevel: 'medium',
    });
  });
});
