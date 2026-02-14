import { describe, expect, it } from 'vitest';
import {
  buildLaneItems,
  buildLaneTokens,
  findDisplayIndexForSkill,
  parseLaneTokens,
} from '../../client/src/components/execution-pipeline-lane-model';

describe('execution pipeline lane modeling', () => {
  it('builds lane items without wrapper markers', () => {
    const preItems = buildLaneItems(['tdd-test-first']);
    const postItems = buildLaneItems(['tdd-verify-tests']);

    expect(preItems.map((item) => item.type)).toEqual(['skill']);
    expect(postItems.map((item) => item.type)).toEqual(['skill']);
  });

  it('keeps plain skill ordering unchanged in token parsing', () => {
    expect(buildLaneTokens(['checkpoint', 'code-review'])).toEqual(['checkpoint', 'code-review']);

    expect(parseLaneTokens(['checkpoint', 'code-review'])).toEqual({
      skillIds: ['checkpoint', 'code-review'],
    });
  });

  it('resolves dragged skill indexes using display and fallback indexes', () => {
    const tokens = ['tdd-test-first', 'tdd-verify-tests'];

    expect(findDisplayIndexForSkill(tokens, {
      skillId: 'tdd-verify-tests',
      fromSkillIndex: 1,
      fromDisplayIndex: 1,
    })).toBe(1);

    expect(findDisplayIndexForSkill(tokens, {
      skillId: 'tdd-verify-tests',
      fromSkillIndex: 1,
      fromDisplayIndex: 0,
    })).toBe(1);

    expect(findDisplayIndexForSkill(tokens, {
      skillId: 'missing-skill',
      fromSkillIndex: 99,
      fromDisplayIndex: 99,
    })).toBe(-1);
  });
});
