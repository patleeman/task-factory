import { describe, expect, it } from 'vitest';
import { DEFAULT_POST_EXECUTION_SKILLS, type TaskDefaults } from '@task-factory/shared';
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
      defaultModelProfileId: 'profile-team-default',
      prePlanningSkills: ['plan-context'],
      preExecutionSkills: ['checkpoint'],
      postExecutionSkills: ['checkpoint', 'code-review', 'update-docs'],
    };

    const formDefaults = buildCreateTaskFormDefaults(defaults);

    expect(formDefaults).toEqual({
      selectedPrePlanningSkillIds: ['plan-context'],
      selectedPreSkillIds: ['checkpoint'],
      selectedSkillIds: ['checkpoint', 'code-review', 'update-docs'],
      selectedModelProfileId: 'profile-team-default',
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

  it('includes update-docs in selected post skills when defaults use built-in post skill list', () => {
    const defaults: TaskDefaults = {
      planningModelConfig: undefined,
      executionModelConfig: undefined,
      modelConfig: undefined,
      prePlanningSkills: [],
      preExecutionSkills: [],
      postExecutionSkills: [...DEFAULT_POST_EXECUTION_SKILLS],
    };

    const formDefaults = buildCreateTaskFormDefaults(defaults);

    expect(formDefaults.selectedSkillIds).toContain('update-docs');
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
      prePlanningSkills: [],
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
