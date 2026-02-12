import { describe, expect, it } from 'vitest';
import type { Task } from '@pi-factory/shared';
import { shouldResumeInterruptedPlanning } from '../src/task-service.js';

function createTask(overrides: Partial<Task['frontmatter']> = {}): Task {
  const now = new Date().toISOString();

  return {
    id: 'TEST-1',
    frontmatter: {
      id: 'TEST-1',
      title: 'Test task',
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
    filePath: '/tmp/workspace/.pi/tasks/test-1.md',
  };
}

describe('shouldResumeInterruptedPlanning', () => {
  it('returns true when planning was running and no plan was saved', () => {
    const task = createTask({ planningStatus: 'running', plan: undefined });
    expect(shouldResumeInterruptedPlanning(task)).toBe(true);
  });

  it('returns false when a plan already exists', () => {
    const task = createTask({
      planningStatus: 'running',
      plan: {
        goal: 'Goal',
        steps: ['step 1'],
        validation: ['validate'],
        cleanup: [],
        generatedAt: new Date().toISOString(),
      },
    });

    expect(shouldResumeInterruptedPlanning(task)).toBe(false);
  });

  it('returns true for a legacy backlog task that has no plan yet', () => {
    const task = createTask({ planningStatus: undefined, plan: undefined, phase: 'backlog' });
    expect(shouldResumeInterruptedPlanning(task)).toBe(true);
  });

  it('returns false when planning is not running anymore', () => {
    const task = createTask({ planningStatus: 'completed', plan: undefined });
    expect(shouldResumeInterruptedPlanning(task)).toBe(false);
  });
});
