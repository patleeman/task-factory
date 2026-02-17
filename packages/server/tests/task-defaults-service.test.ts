import { describe, expect, it } from 'vitest';
import { DEFAULT_POST_EXECUTION_SKILLS, DEFAULT_PRE_EXECUTION_SKILLS, type TaskDefaults } from '@task-factory/shared';
import {
  applyTaskDefaultsToRequest,
  getBuiltInTaskDefaults,
  parseTaskDefaultsPayload,
  resolveTaskDefaults,
  validateTaskDefaults,
} from '../src/task-defaults-service.js';

const AVAILABLE_MODELS = [
  { provider: 'anthropic', id: 'claude-sonnet-4', reasoning: true },
  { provider: 'openai', id: 'gpt-4o', reasoning: false },
];

const AVAILABLE_SKILLS: Array<{ id: string; hooks: Array<'pre' | 'post'> }> = [
  { id: 'checkpoint', hooks: ['post'] },
  { id: 'code-review', hooks: ['post'] },
  { id: 'update-docs', hooks: ['post'] },
  { id: 'security-review', hooks: ['post'] },
  { id: 'tdd-test-first', hooks: ['pre'] },
];

describe('validateTaskDefaults', () => {
  it('accepts valid planning and execution model configs with update-docs in post skills', () => {
    const defaults: TaskDefaults = {
      planningModelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
        thinkingLevel: 'minimal',
      },
      executionModelConfig: {
        provider: 'openai',
        modelId: 'gpt-4o',
      },
      modelConfig: {
        provider: 'openai',
        modelId: 'gpt-4o',
      },
      preExecutionSkills: [],
      postExecutionSkills: ['checkpoint', 'code-review', 'update-docs'],
    };

    expect(validateTaskDefaults(defaults, AVAILABLE_MODELS, AVAILABLE_SKILLS)).toEqual({ ok: true });
  });

  it('rejects invalid planning model provider/model pair', () => {
    const defaults: TaskDefaults = {
      planningModelConfig: {
        provider: 'anthropic',
        modelId: 'gpt-4o',
      },
      executionModelConfig: undefined,
      modelConfig: undefined,
      preExecutionSkills: [],
      postExecutionSkills: ['checkpoint'],
    };

    const result = validateTaskDefaults(defaults, AVAILABLE_MODELS, AVAILABLE_SKILLS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Planning model');
      expect(result.error).toContain('not available');
    }
  });

  it('rejects thinking levels for non-reasoning execution models', () => {
    const defaults: TaskDefaults = {
      planningModelConfig: undefined,
      executionModelConfig: {
        provider: 'openai',
        modelId: 'gpt-4o',
        thinkingLevel: 'high',
      },
      modelConfig: {
        provider: 'openai',
        modelId: 'gpt-4o',
        thinkingLevel: 'high',
      },
      preExecutionSkills: [],
      postExecutionSkills: ['checkpoint'],
    };

    const result = validateTaskDefaults(defaults, AVAILABLE_MODELS, AVAILABLE_SKILLS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Execution thinking level');
      expect(result.error).toContain('reasoning models');
    }
  });

  it('accepts xhigh thinking level for reasoning planning models', () => {
    const defaults: TaskDefaults = {
      planningModelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
        thinkingLevel: 'xhigh',
      },
      executionModelConfig: undefined,
      modelConfig: undefined,
      preExecutionSkills: [],
      postExecutionSkills: ['checkpoint'],
    };

    expect(validateTaskDefaults(defaults, AVAILABLE_MODELS, AVAILABLE_SKILLS)).toEqual({ ok: true });
  });

  it('rejects unknown post-execution skill IDs', () => {
    const defaults: TaskDefaults = {
      planningModelConfig: undefined,
      executionModelConfig: undefined,
      modelConfig: undefined,
      preExecutionSkills: [],
      postExecutionSkills: ['checkpoint', 'not-a-real-skill'],
    };

    const result = validateTaskDefaults(defaults, AVAILABLE_MODELS, AVAILABLE_SKILLS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Unknown post-execution skills');
    }
  });

  it('rejects unknown pre-execution skill IDs', () => {
    const defaults: TaskDefaults = {
      planningModelConfig: undefined,
      executionModelConfig: undefined,
      modelConfig: undefined,
      preExecutionSkills: ['not-a-real-skill'],
      postExecutionSkills: ['checkpoint'],
    };

    const result = validateTaskDefaults(defaults, AVAILABLE_MODELS, AVAILABLE_SKILLS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Unknown pre-execution skills');
    }
  });

  it('rejects pre-execution defaults that reference post-only skills', () => {
    const defaults: TaskDefaults = {
      planningModelConfig: undefined,
      executionModelConfig: undefined,
      modelConfig: undefined,
      preExecutionSkills: ['checkpoint'],
      postExecutionSkills: ['code-review'],
    };

    const result = validateTaskDefaults(defaults, AVAILABLE_MODELS, AVAILABLE_SKILLS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('do not support pre hook');
      expect(result.error).toContain('checkpoint');
    }
  });

  it('rejects post-execution defaults that reference pre-only skills', () => {
    const defaults: TaskDefaults = {
      planningModelConfig: undefined,
      executionModelConfig: undefined,
      modelConfig: undefined,
      preExecutionSkills: [],
      postExecutionSkills: ['tdd-test-first'],
    };

    const result = validateTaskDefaults(defaults, AVAILABLE_MODELS, AVAILABLE_SKILLS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('do not support post hook');
      expect(result.error).toContain('tdd-test-first');
    }
  });
});

describe('resolveTaskDefaults', () => {
  it('falls back to built-in defaults when taskDefaults are missing', () => {
    expect(resolveTaskDefaults(null)).toEqual(getBuiltInTaskDefaults());
  });

  it('includes update-docs in built-in post-execution skills', () => {
    expect(getBuiltInTaskDefaults().postExecutionSkills).toContain('update-docs');
  });

  it('falls back to built-in skills when settings are malformed and maps legacy modelConfig to executionModelConfig', () => {
    const resolved = resolveTaskDefaults({
      taskDefaults: {
        modelConfig: {
          provider: 'anthropic',
          modelId: 'claude-sonnet-4',
          thinkingLevel: 'medium',
        },
        postExecutionSkills: 'invalid',
      } as any,
    } as any);

    expect(resolved.postExecutionSkills).toEqual(DEFAULT_POST_EXECUTION_SKILLS);
    expect(resolved.preExecutionSkills).toEqual(DEFAULT_PRE_EXECUTION_SKILLS);
    expect(resolved.executionModelConfig).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4',
      thinkingLevel: 'medium',
    });
    expect(resolved.modelConfig).toEqual(resolved.executionModelConfig);
  });
});

describe('parseTaskDefaultsPayload', () => {
  it('parses planning and execution model configs', () => {
    const parsed = parseTaskDefaultsPayload({
      planningModelConfig: { provider: 'anthropic', modelId: 'claude-sonnet-4', thinkingLevel: 'low' },
      executionModelConfig: { provider: 'openai', modelId: 'gpt-4o' },
      preExecutionSkills: ['checkpoint'],
      postExecutionSkills: ['checkpoint', 'code-review'],
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.planningModelConfig).toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4', thinkingLevel: 'low' });
      expect(parsed.value.executionModelConfig).toEqual({ provider: 'openai', modelId: 'gpt-4o' });
      expect(parsed.value.modelConfig).toEqual({ provider: 'openai', modelId: 'gpt-4o' });
    }
  });

  it('uses legacy modelConfig as execution model when executionModelConfig is missing', () => {
    const parsed = parseTaskDefaultsPayload({
      modelConfig: { provider: 'openai', modelId: 'gpt-4o' },
      postExecutionSkills: ['checkpoint'],
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.executionModelConfig).toEqual({ provider: 'openai', modelId: 'gpt-4o' });
      expect(parsed.value.modelConfig).toEqual({ provider: 'openai', modelId: 'gpt-4o' });
    }
  });
});

describe('applyTaskDefaultsToRequest', () => {
  it('applies saved defaults when request omits models and skills', () => {
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

    const applied = applyTaskDefaultsToRequest({ content: 'Implement feature' }, defaults);

    expect(applied.planningModelConfig).toEqual(defaults.planningModelConfig);
    expect(applied.executionModelConfig).toEqual(defaults.executionModelConfig);
    expect(applied.modelConfig).toEqual(defaults.executionModelConfig);
    expect(applied.preExecutionSkills).toEqual(defaults.preExecutionSkills);
    expect(applied.postExecutionSkills).toEqual(defaults.postExecutionSkills);
  });

  it('preserves explicit request planning/execution models over defaults', () => {
    const defaults: TaskDefaults = {
      planningModelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
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

    const applied = applyTaskDefaultsToRequest({
      content: 'Implement feature',
      planningModelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
        thinkingLevel: 'minimal',
      },
      executionModelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
      },
      preExecutionSkills: [],
      postExecutionSkills: ['security-review'],
    }, defaults);

    expect(applied.planningModelConfig).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4',
      thinkingLevel: 'minimal',
    });
    expect(applied.executionModelConfig).toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4' });
    expect(applied.modelConfig).toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4' });
    expect(applied.preExecutionSkills).toEqual([]);
    expect(applied.postExecutionSkills).toEqual(['security-review']);
  });

  it('treats legacy request.modelConfig as execution model override', () => {
    const defaults: TaskDefaults = {
      planningModelConfig: undefined,
      executionModelConfig: {
        provider: 'openai',
        modelId: 'gpt-4o',
      },
      modelConfig: {
        provider: 'openai',
        modelId: 'gpt-4o',
      },
      preExecutionSkills: [],
      postExecutionSkills: ['checkpoint'],
    };

    const applied = applyTaskDefaultsToRequest({
      content: 'Implement feature',
      modelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
      },
    }, defaults);

    expect(applied.executionModelConfig).toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4' });
    expect(applied.modelConfig).toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4' });
  });
});
