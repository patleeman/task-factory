import { describe, expect, it } from 'vitest';
import type { Task } from '@pi-factory/shared';
import { applyWrapper, getWrapper, reloadWrappers } from '../src/execution-wrapper-service.js';
import { reloadPostExecutionSkills } from '../src/post-execution-skills.js';

function createTask(overrides: Partial<Task['frontmatter']> = {}): Task {
  const now = new Date().toISOString();

  return {
    id: 'TEST-66',
    frontmatter: {
      id: 'TEST-66',
      title: 'TDD wrapper test task',
      phase: 'backlog',
      created: now,
      updated: now,
      workspace: '/tmp/workspace',
      project: 'workspace',
      blockedCount: 0,
      blockedDuration: 0,
      acceptanceCriteria: [],
      testingInstructions: [],
      commits: [],
      order: 0,
      attachments: [],
      blocked: { isBlocked: false },
      ...overrides,
    },
    content: 'Test content',
    history: [],
    filePath: '/tmp/workspace/.pi/tasks/test-66.md',
  };
}

describe('execution wrapper service', () => {
  it('discovers tdd-workflow wrapper with valid skill references', () => {
    const wrappers = reloadWrappers();
    const wrapper = wrappers.find((item) => item.id === 'tdd-workflow');

    expect(wrapper).toBeDefined();
    expect(wrapper?.name.trim().length).toBeGreaterThan(0);
    expect(wrapper?.description.trim().length).toBeGreaterThan(0);
    expect(wrapper?.preExecutionSkills).toEqual(['tdd-test-first']);
    expect(wrapper?.postExecutionSkills).toEqual(['tdd-verify-tests']);

    const discoveredSkillIds = new Set(reloadPostExecutionSkills().map((skill) => skill.id));
    for (const skillId of [...(wrapper?.preExecutionSkills ?? []), ...(wrapper?.postExecutionSkills ?? [])]) {
      expect(discoveredSkillIds.has(skillId)).toBe(true);
    }
  });

  it('returns tdd-workflow via getWrapper and applies it to task skill arrays', () => {
    const wrapper = getWrapper('tdd-workflow');
    expect(wrapper).toBeDefined();

    const task = createTask({
      preExecutionSkills: ['some-pre-skill'],
      postExecutionSkills: ['some-post-skill'],
    });

    const updated = applyWrapper(task, 'tdd-workflow');

    expect(updated.frontmatter.preExecutionSkills).toEqual(['tdd-test-first']);
    expect(updated.frontmatter.postExecutionSkills).toEqual(['tdd-verify-tests']);
  });
});
