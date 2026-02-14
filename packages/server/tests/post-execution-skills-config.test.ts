import { describe, expect, it } from 'vitest';
import type { PostExecutionSkill } from '@pi-factory/shared';
import { applySkillConfigOverrides } from '../src/post-execution-skills.js';

function createSkill(): PostExecutionSkill {
  return {
    id: 'templated-skill',
    name: 'templated-skill',
    description: 'Template test skill',
    type: 'loop',
    hooks: ['post'],
    maxIterations: 2,
    doneSignal: 'HOOK_DONE',
    promptTemplate: 'Use {{style}} tone. Max {{max-iterations}} tries. End with {{done-signal}}.',
    path: '/tmp/templated-skill',
    source: 'user',
    metadata: {},
    configSchema: [
      {
        key: 'style',
        label: 'Style',
        type: 'string',
        default: 'concise',
        description: 'Response style',
      },
    ],
  };
}

describe('applySkillConfigOverrides', () => {
  it('injects defaults into prompt template when no task overrides are provided', () => {
    const skill = createSkill();
    const applied = applySkillConfigOverrides(skill, undefined);

    expect(applied.promptTemplate).toBe('Use concise tone. Max 2 tries. End with HOOK_DONE.');
    expect(applied.maxIterations).toBe(2);
    expect(applied.doneSignal).toBe('HOOK_DONE');
  });

  it('applies per-task overrides for prompt template and loop controls', () => {
    const skill = createSkill();
    const applied = applySkillConfigOverrides(skill, {
      style: 'detailed',
      'max-iterations': '5',
      'done-signal': 'FINISHED',
    });

    expect(applied).not.toBe(skill);
    expect(applied.promptTemplate).toBe('Use detailed tone. Max 5 tries. End with FINISHED.');
    expect(applied.maxIterations).toBe(5);
    expect(applied.doneSignal).toBe('FINISHED');
  });

  it('ignores invalid max iteration overrides and keeps existing value', () => {
    const skill = createSkill();
    const applied = applySkillConfigOverrides(skill, {
      'max-iterations': 'not-a-number',
    });

    expect(applied.maxIterations).toBe(skill.maxIterations);
    expect(applied.promptTemplate).toContain('Max not-a-number tries.');
  });
});
