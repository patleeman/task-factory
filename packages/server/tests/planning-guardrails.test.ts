import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANNING_GUARDRAILS } from '@pi-factory/shared';
import { buildPlanningPrompt, resolvePlanningGuardrails } from '../src/agent-execution-service.js';

describe('DEFAULT_PLANNING_GUARDRAILS', () => {
  it('uses a 30-minute timeout without changing tool/read budgets', () => {
    expect(DEFAULT_PLANNING_GUARDRAILS).toEqual({
      timeoutMs: 1_800_000,
      maxToolCalls: 40,
      maxReadBytes: 180_000,
    });
  });
});

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

  it('falls back for invalid values and formats timeout messaging from the fallback', () => {
    const resolved = resolvePlanningGuardrails({
      timeoutMs: -1,
      maxToolCalls: 0,
      maxReadBytes: Number.NaN,
    });

    expect(resolved).toEqual(DEFAULT_PLANNING_GUARDRAILS);
    expect(`Planning timed out after ${Math.round(resolved.timeoutMs / 1000)} seconds`).toBe(
      'Planning timed out after 1800 seconds',
    );
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
