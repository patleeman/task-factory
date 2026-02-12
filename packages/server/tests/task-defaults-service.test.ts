import { describe, expect, it } from 'vitest';
import { DEFAULT_POST_EXECUTION_SKILLS, type TaskDefaults } from '@pi-factory/shared';
import {
  applyTaskDefaultsToRequest,
  getBuiltInTaskDefaults,
  resolveTaskDefaults,
  validateTaskDefaults,
} from '../src/task-defaults-service.js';

const AVAILABLE_MODELS = [
  { provider: 'anthropic', id: 'claude-sonnet-4', reasoning: true },
  { provider: 'openai', id: 'gpt-4o', reasoning: false },
];

const AVAILABLE_SKILLS = ['checkpoint', 'code-review', 'security-review'];

describe('validateTaskDefaults', () => {
  it('accepts valid provider/model pairs', () => {
    const defaults: TaskDefaults = {
      modelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
        thinkingLevel: 'minimal',
      },
      postExecutionSkills: ['checkpoint', 'code-review'],
    };

    expect(validateTaskDefaults(defaults, AVAILABLE_MODELS, AVAILABLE_SKILLS)).toEqual({ ok: true });
  });

  it('rejects provider/model mismatches', () => {
    const defaults: TaskDefaults = {
      modelConfig: {
        provider: 'anthropic',
        modelId: 'gpt-4o',
      },
      postExecutionSkills: ['checkpoint'],
    };

    const result = validateTaskDefaults(defaults, AVAILABLE_MODELS, AVAILABLE_SKILLS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not available');
    }
  });

  it('rejects thinking levels for non-reasoning models', () => {
    const defaults: TaskDefaults = {
      modelConfig: {
        provider: 'openai',
        modelId: 'gpt-4o',
        thinkingLevel: 'high',
      },
      postExecutionSkills: ['checkpoint'],
    };

    const result = validateTaskDefaults(defaults, AVAILABLE_MODELS, AVAILABLE_SKILLS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('reasoning models');
    }
  });

  it('accepts xhigh thinking level for reasoning models', () => {
    const defaults: TaskDefaults = {
      modelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
        thinkingLevel: 'xhigh',
      },
      postExecutionSkills: ['checkpoint'],
    };

    expect(validateTaskDefaults(defaults, AVAILABLE_MODELS, AVAILABLE_SKILLS)).toEqual({ ok: true });
  });

  it('rejects unknown post-execution skill IDs', () => {
    const defaults: TaskDefaults = {
      modelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
      },
      postExecutionSkills: ['checkpoint', 'not-a-real-skill'],
    };

    const result = validateTaskDefaults(defaults, AVAILABLE_MODELS, AVAILABLE_SKILLS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Unknown post-execution skills');
    }
  });
});

describe('resolveTaskDefaults', () => {
  it('falls back to built-in defaults when taskDefaults are missing', () => {
    expect(resolveTaskDefaults(null)).toEqual(getBuiltInTaskDefaults());
  });

  it('falls back to built-in skills when settings are malformed', () => {
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
    expect(resolved.modelConfig).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4',
      thinkingLevel: 'medium',
    });
  });
});

describe('applyTaskDefaultsToRequest', () => {
  it('applies saved defaults when request omits modelConfig and skills', () => {
    const defaults: TaskDefaults = {
      modelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
        thinkingLevel: 'low',
      },
      postExecutionSkills: ['checkpoint', 'code-review'],
    };

    const applied = applyTaskDefaultsToRequest({ content: 'Implement feature' }, defaults);

    expect(applied.modelConfig).toEqual(defaults.modelConfig);
    expect(applied.postExecutionSkills).toEqual(defaults.postExecutionSkills);
  });

  it('preserves explicit request values over defaults', () => {
    const defaults: TaskDefaults = {
      modelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
        thinkingLevel: 'low',
      },
      postExecutionSkills: ['checkpoint', 'code-review'],
    };

    const applied = applyTaskDefaultsToRequest({
      content: 'Implement feature',
      modelConfig: {
        provider: 'openai',
        modelId: 'gpt-4o',
      },
      postExecutionSkills: ['security-review'],
    }, defaults);

    expect(applied.modelConfig).toEqual({ provider: 'openai', modelId: 'gpt-4o' });
    expect(applied.postExecutionSkills).toEqual(['security-review']);
  });
});
