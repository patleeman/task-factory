import { describe, expect, it } from 'vitest';
import {
  buildLaneItems,
  buildLaneTokens,
  findDisplayIndexForSkill,
  parseLaneTokens,
  WRAPPER_MARKER_TOKEN,
} from '../../client/src/components/execution-pipeline-lane-model';

describe('execution pipeline editor wrapper lane modeling', () => {
  it('builds lane items with wrapper start/end markers inside lanes', () => {
    const preItems = buildLaneItems(['tdd-test-first'], 0, true);
    const postItems = buildLaneItems(['tdd-verify-tests'], 1, true);

    expect(preItems.map((item) => item.type)).toEqual(['marker', 'skill']);
    expect(postItems.map((item) => item.type)).toEqual(['skill', 'marker']);
  });

  it('supports skills before and after wrapper markers in token parsing', () => {
    const basePreTokens = buildLaneTokens(['tdd-test-first'], 0, true);

    const beforeMarker = [...basePreTokens];
    beforeMarker.splice(0, 0, 'security-review');

    expect(parseLaneTokens(beforeMarker, true)).toEqual({
      skillIds: ['security-review', 'tdd-test-first'],
      markerIndex: 1,
    });

    const afterMarker = [...basePreTokens];
    afterMarker.splice(2, 0, 'wrapup');

    expect(parseLaneTokens(afterMarker, true)).toEqual({
      skillIds: ['tdd-test-first', 'wrapup'],
      markerIndex: 0,
    });
  });

  it('keeps plain skill ordering unchanged when no wrapper marker is active', () => {
    expect(buildLaneItems(['checkpoint', 'code-review'], 0, false).map((item) => item.type)).toEqual([
      'skill',
      'skill',
    ]);

    expect(parseLaneTokens(['checkpoint', 'code-review'], false)).toEqual({
      skillIds: ['checkpoint', 'code-review'],
      markerIndex: 0,
    });
  });

  it('clamps and recovers marker placement for boundary token states', () => {
    expect(buildLaneTokens(['checkpoint'], 99, true)).toEqual(['checkpoint', WRAPPER_MARKER_TOKEN]);

    expect(parseLaneTokens(['checkpoint', 'wrapup'], true)).toEqual({
      skillIds: ['checkpoint', 'wrapup'],
      markerIndex: 2,
    });
  });

  it('resolves dragged skill display indexes when marker tokens are present', () => {
    const tokens = ['tdd-test-first', WRAPPER_MARKER_TOKEN, 'tdd-verify-tests'];

    expect(findDisplayIndexForSkill(tokens, {
      skillId: 'tdd-verify-tests',
      fromSkillIndex: 1,
      fromDisplayIndex: 2,
    })).toBe(2);

    expect(findDisplayIndexForSkill(tokens, {
      skillId: 'tdd-verify-tests',
      fromSkillIndex: 1,
      fromDisplayIndex: 0,
    })).toBe(2);

    expect(findDisplayIndexForSkill(tokens, {
      skillId: 'missing-skill',
      fromSkillIndex: 99,
      fromDisplayIndex: 99,
    })).toBe(-1);
  });
});
