import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANNING_GUARDRAILS } from '@task-factory/shared';
import { buildPlanningPrompt, buildPlanningResumePrompt, resolvePlanningGuardrails } from '../src/agent-execution-service.js';

describe('DEFAULT_PLANNING_GUARDRAILS', () => {
  it('uses a 30-minute timeout and a 100-tool-call budget', () => {
    expect(DEFAULT_PLANNING_GUARDRAILS).toEqual({
      timeoutMs: 1_800_000,
      maxToolCalls: 100,
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
    })).toEqual({
      timeoutMs: 120_000,
      maxToolCalls: 12,
    });
  });

  it('falls back for invalid timeout/tool values and formats timeout messaging from the fallback', () => {
    const resolved = resolvePlanningGuardrails({
      timeoutMs: -1,
      maxToolCalls: 0,
    });

    expect(resolved).toEqual(DEFAULT_PLANNING_GUARDRAILS);
    expect(`Planning timed out after ${Math.round(resolved.timeoutMs / 1000)} seconds`).toBe(
      'Planning timed out after 1800 seconds',
    );
  });

  it('ignores legacy maxReadBytes settings without failing', () => {
    const resolved = resolvePlanningGuardrails({
      timeoutMs: 200_000,
      maxToolCalls: 8,
      maxReadBytes: 90_000,
    } as any);

    expect(resolved).toEqual({
      timeoutMs: 200_000,
      maxToolCalls: 8,
    });
  });
});

describe('planning prompt guardrail guidance', () => {
  it('includes explicit tool budget guidance without read-budget text in the initial prompt', () => {
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
      },
    );

    expect(prompt).toContain('at most 9 tool calls');
    expect(prompt).not.toContain('total read output');
    expect(prompt).not.toContain('about 88KB');
  });

  it('includes explicit tool budget guidance without read-budget text in the resume prompt', () => {
    const prompt = buildPlanningResumePrompt(
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
      },
    );

    expect(prompt).toContain('at most 9 tool calls');
    expect(prompt).not.toContain('total read output');
    expect(prompt).not.toContain('about 88KB');
  });
});
