import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Task } from '@pi-factory/shared';
import {
  canMoveToPhase,
  createTask as createTaskFile,
  deleteTask,
  discoverTasks,
  moveTaskToPhase,
  parseTaskContent,
  shouldResumeInterruptedPlanning,
  updateTask,
} from '../src/task-service.js';

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

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

function createTempWorkspace(): { workspacePath: string; tasksDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'pi-factory-task-service-'));
  tempRoots.push(root);

  const workspacePath = join(root, 'workspace');
  const tasksDir = join(workspacePath, '.pi', 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  return { workspacePath, tasksDir };
}

function extractTaskNumber(taskId: string): number {
  return Number.parseInt(taskId.split('-').at(-1) ?? '', 10);
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

describe('task ordering', () => {
  it('creates new backlog tasks at the end (right)', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const first = createTaskFile(workspacePath, tasksDir, {
      title: 'First task',
      content: 'first',
      acceptanceCriteria: ['done'],
    });

    const second = createTaskFile(workspacePath, tasksDir, {
      title: 'Second task',
      content: 'second',
      acceptanceCriteria: ['done'],
    });

    expect(first.frontmatter.order).toBe(0);
    expect(second.frontmatter.order).toBe(first.frontmatter.order + 1);

    const backlogIds = discoverTasks(tasksDir)
      .filter((task) => task.frontmatter.phase === 'backlog')
      .map((task) => task.id);

    expect(backlogIds).toEqual([first.id, second.id]);
  });

  it('inserts moved tasks at the start of the destination phase', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const first = createTaskFile(workspacePath, tasksDir, {
      title: 'First task',
      content: 'first',
      acceptanceCriteria: ['done'],
    });

    const second = createTaskFile(workspacePath, tasksDir, {
      title: 'Second task',
      content: 'second',
      acceptanceCriteria: ['done'],
    });

    let tasks = discoverTasks(tasksDir);
    const firstLive = tasks.find((task) => task.id === first.id)!;
    moveTaskToPhase(firstLive, 'ready', 'user', 'move first to ready', tasks);

    tasks = discoverTasks(tasksDir);
    const secondLive = tasks.find((task) => task.id === second.id)!;
    moveTaskToPhase(secondLive, 'ready', 'user', 'move second to ready', tasks);

    const readyTasks = discoverTasks(tasksDir).filter((task) => task.frontmatter.phase === 'ready');

    expect(readyTasks.map((task) => task.id)).toEqual([second.id, first.id]);
    expect(readyTasks[0].frontmatter.order).toBeLessThan(readyTasks[1].frontmatter.order);
  });
});

describe('task id generation', () => {
  it('does not reuse task IDs after deleting an existing task', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const first = createTaskFile(workspacePath, tasksDir, {
      title: 'First task',
      content: 'first',
      acceptanceCriteria: ['done'],
    });

    const second = createTaskFile(workspacePath, tasksDir, {
      title: 'Second task',
      content: 'second',
      acceptanceCriteria: ['done'],
    });

    deleteTask(second);

    const third = createTaskFile(workspacePath, tasksDir, {
      title: 'Third task',
      content: 'third',
      acceptanceCriteria: ['done'],
    });

    expect(third.id).not.toBe(second.id);
    expect(extractTaskNumber(third.id)).toBe(extractTaskNumber(second.id) + 1);
    expect(extractTaskNumber(first.id)).toBeLessThan(extractTaskNumber(second.id));
  });

  it('keeps incrementing even when all prior tasks are deleted', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const first = createTaskFile(workspacePath, tasksDir, {
      title: 'Only task',
      content: 'single',
      acceptanceCriteria: ['done'],
    });

    deleteTask(first);

    const second = createTaskFile(workspacePath, tasksDir, {
      title: 'Replacement task',
      content: 'replacement',
      acceptanceCriteria: ['done'],
    });

    expect(extractTaskNumber(second.id)).toBe(extractTaskNumber(first.id) + 1);
  });
});

describe('acceptance criteria normalization', () => {
  it('strips empty acceptance criteria when creating tasks', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const created = createTaskFile(workspacePath, tasksDir, {
      title: 'Normalize criteria on create',
      content: 'create task',
      acceptanceCriteria: ['', '  first criterion  ', '   ', 'second criterion'],
    });

    expect(created.frontmatter.acceptanceCriteria).toEqual(['first criterion', 'second criterion']);

    const persisted = discoverTasks(tasksDir).find((task) => task.id === created.id)!;
    expect(persisted.frontmatter.acceptanceCriteria).toEqual(['first criterion', 'second criterion']);
  });

  it('strips empty acceptance criteria when updating tasks', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const created = createTaskFile(workspacePath, tasksDir, {
      title: 'Normalize criteria on update',
      content: 'update task',
      acceptanceCriteria: ['existing'],
    });

    const updated = updateTask(created, {
      acceptanceCriteria: ['  ', '\t', '  keep me  ', ''],
    });

    expect(updated.frontmatter.acceptanceCriteria).toEqual(['keep me']);

    const persisted = discoverTasks(tasksDir).find((task) => task.id === created.id)!;
    expect(persisted.frontmatter.acceptanceCriteria).toEqual(['keep me']);
  });

  it('strips empty acceptance criteria when parsing task files', () => {
    const now = new Date().toISOString();
    const rawTask = `---
id: TEST-RAW
phase: backlog
created: ${now}
updated: ${now}
workspace: /tmp/workspace
project: workspace
acceptanceCriteria:
  - ""
  - "   "
  - Keep this
testingInstructions: []
commits: []
attachments: []
blocked:
  isBlocked: false
---

Body`;

    const parsed = parseTaskContent(rawTask, '/tmp/test-raw.md');

    expect(parsed.frontmatter.acceptanceCriteria).toEqual(['Keep this']);
  });

  it('normalizes YAML object-style criteria into readable text', () => {
    const now = new Date().toISOString();
    const rawTask = `---
id: TEST-OBJ
phase: backlog
created: ${now}
updated: ${now}
workspace: /tmp/workspace
project: workspace
acceptanceCriteria:
  - Criterion with colon: still valid text
testingInstructions: []
commits: []
attachments: []
blocked:
  isBlocked: false
---

Body`;

    const parsed = parseTaskContent(rawTask, '/tmp/test-obj.md');

    expect(parsed.frontmatter.acceptanceCriteria).toEqual(['Criterion with colon: still valid text']);
  });
});

describe('canMoveToPhase', () => {
  it.each(['backlog', 'ready', 'executing', 'complete'] as const)(
    'allows moving from %s to archived',
    (phase) => {
      const task = createTask({ phase });
      const result = canMoveToPhase(task, 'archived');

      expect(result).toEqual({ allowed: true });
    },
  );

  it('allows moving directly from backlog to complete', () => {
    const task = createTask({ phase: 'backlog' });
    const result = canMoveToPhase(task, 'complete');

    expect(result).toEqual({ allowed: true });
  });

  it('keeps non-archive constraints (backlog -> executing is rejected)', () => {
    const task = createTask({ phase: 'backlog' });
    const result = canMoveToPhase(task, 'executing');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Cannot move from backlog to executing');
  });

  it('blocks move to executing when planning is still running', () => {
    const task = createTask({
      phase: 'ready',
      acceptanceCriteria: ['all good'],
      planningStatus: 'running',
      plan: undefined,
    });

    const result = canMoveToPhase(task, 'executing');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Task planning is still running');
  });

  it('only allows unarchive from archived to backlog', () => {
    const archivedTask = createTask({ phase: 'archived' });

    expect(canMoveToPhase(archivedTask, 'backlog')).toEqual({ allowed: true });

    const blocked = canMoveToPhase(archivedTask, 'ready');
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('Cannot move from archived to ready');
  });

  it('preserves the ready phase acceptance criteria guard', () => {
    const missingCriteria = createTask({ phase: 'backlog', acceptanceCriteria: [] });
    const blocked = canMoveToPhase(missingCriteria, 'ready');

    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('Task must have acceptance criteria before moving to Ready');

    const withCriteria = createTask({ phase: 'backlog', acceptanceCriteria: ['has AC'] });
    expect(canMoveToPhase(withCriteria, 'ready')).toEqual({ allowed: true });
  });

  it('blocks move to ready when criteria are only empty strings', () => {
    const whitespaceOnly = createTask({ phase: 'backlog', acceptanceCriteria: ['   ', '\t', ''] });
    const blocked = canMoveToPhase(whitespaceOnly, 'ready');

    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('Task must have acceptance criteria before moving to Ready');
  });
});
