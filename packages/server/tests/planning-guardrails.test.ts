import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANNING_GUARDRAILS } from '@pi-factory/shared';
import { buildPlanningPrompt, resolvePlanningGuardrails } from '../src/agent-execution-service.js';

describe('resolvePlanningGuardrails', () => {
  it('returns defaults when settings are missing', () => {
    expect(resolvePlanningGuardrails(undefined)).toEqual(DEFAULT_PLANNING_GUARDRAILS);
  });

  it('accepts valid explicit values', () => {
    expect(resolvePlanningGuardrails({
      timeoutMs: 120_000,
      maxToolCalls: 12,
      maxReadBytes: 65_536,
    })).toEqual({
      timeoutMs: 120_000,
      maxToolCalls: 12,
      maxReadBytes: 65_536,
    });
  });

  it('falls back for invalid values', () => {
    expect(resolvePlanningGuardrails({
      timeoutMs: -1,
      maxToolCalls: 0,
      maxReadBytes: Number.NaN,
    })).toEqual(DEFAULT_PLANNING_GUARDRAILS);
  });
});

describe('buildPlanningPrompt guardrail guidance', () => {
  it('includes explicit tool/read budgets', () => {
    const prompt = buildPlanningPrompt(
      {
        id: 'PIFA-65',
        frontmatter: {
          title: 'Speed up planning',
          acceptanceCriteria: [],
        },
        content: 'Avoid long planning loops.',
      } as any,
      '',
      null,
      {
        timeoutMs: 120_000,
        maxToolCalls: 9,
        maxReadBytes: 90_000,
      },
    );

    expect(prompt).toContain('at most 9 tool calls');
    expect(prompt).toContain('about 88KB');
  });
});
