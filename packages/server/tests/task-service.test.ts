import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
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
  getTaskDir,
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
    filePath: '/tmp/workspace/.pi/tasks/test-1/task.yaml',
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

  it('inserts moved tasks at the start of ready', () => {
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

  it('inserts moved tasks at the start of executing', () => {
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
    moveTaskToPhase(tasks.find((task) => task.id === first.id)!, 'ready', 'user', 'first to ready', tasks);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((task) => task.id === first.id)!, 'executing', 'user', 'first to executing', tasks);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((task) => task.id === second.id)!, 'ready', 'user', 'second to ready', tasks);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((task) => task.id === second.id)!, 'executing', 'user', 'second to executing', tasks);

    const executingTasks = discoverTasks(tasksDir).filter((task) => task.frontmatter.phase === 'executing');

    expect(executingTasks.map((task) => task.id)).toEqual([second.id, first.id]);
    expect(executingTasks[0].frontmatter.order).toBeLessThan(executingTasks[1].frontmatter.order);
  });

  it('inserts moved tasks at the start of complete', () => {
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
    moveTaskToPhase(tasks.find((task) => task.id === first.id)!, 'ready', 'user', 'first to ready', tasks);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((task) => task.id === first.id)!, 'executing', 'user', 'first to executing', tasks);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((task) => task.id === first.id)!, 'complete', 'user', 'first to complete', tasks);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((task) => task.id === second.id)!, 'ready', 'user', 'second to ready', tasks);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((task) => task.id === second.id)!, 'executing', 'user', 'second to executing', tasks);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((task) => task.id === second.id)!, 'complete', 'user', 'second to complete', tasks);

    const completeTasks = discoverTasks(tasksDir).filter((task) => task.frontmatter.phase === 'complete');

    expect(completeTasks.map((task) => task.id)).toEqual([second.id, first.id]);
    expect(completeTasks[0].frontmatter.order).toBeLessThan(completeTasks[1].frontmatter.order);
  });

  it('inserts complete -> ready rework moves at the start of ready', () => {
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
    moveTaskToPhase(tasks.find((task) => task.id === first.id)!, 'ready', 'user', 'first to ready', tasks);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((task) => task.id === first.id)!, 'executing', 'user', 'first to executing', tasks);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((task) => task.id === first.id)!, 'complete', 'user', 'first to complete', tasks);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((task) => task.id === second.id)!, 'ready', 'user', 'second to ready', tasks);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((task) => task.id === first.id)!, 'ready', 'user', 'rework first task', tasks);

    const readyTasks = discoverTasks(tasksDir).filter((task) => task.frontmatter.phase === 'ready');

    expect(readyTasks.map((task) => task.id)).toEqual([first.id, second.id]);
    expect(readyTasks[0].frontmatter.order).toBeLessThan(readyTasks[1].frontmatter.order);
  });
});

describe('archived restore moves', () => {
  it('persists archived -> complete transitions when restoring a task', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const created = createTaskFile(workspacePath, tasksDir, {
      title: 'Archived restore target',
      content: 'restore this task',
      acceptanceCriteria: ['done'],
    });

    let tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((task) => task.id === created.id)!, 'ready', 'user', 'to ready', tasks);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((task) => task.id === created.id)!, 'executing', 'user', 'to executing', tasks);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((task) => task.id === created.id)!, 'complete', 'user', 'to complete', tasks);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((task) => task.id === created.id)!, 'archived', 'user', 'archive', tasks);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((task) => task.id === created.id)!, 'complete', 'user', 'restore from archive', tasks);

    const restored = discoverTasks(tasksDir).find((task) => task.id === created.id)!;
    expect(restored.frontmatter.phase).toBe('complete');

    const lastTransition = restored.history.at(-1);
    expect(lastTransition).toMatchObject({
      from: 'archived',
      to: 'complete',
      actor: 'user',
      reason: 'restore from archive',
    });
  });

  it('keeps existing completion metrics when restoring a previously completed archived task', () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const { workspacePath, tasksDir } = createTempWorkspace();

      const created = createTaskFile(workspacePath, tasksDir, {
        title: 'Preserve completion metadata',
        content: 'restore should not re-complete the task',
        acceptanceCriteria: ['done'],
      });

      let tasks = discoverTasks(tasksDir);
      moveTaskToPhase(tasks.find((task) => task.id === created.id)!, 'ready', 'user', 'to ready', tasks);

      vi.setSystemTime(new Date('2026-01-01T00:10:00.000Z'));
      tasks = discoverTasks(tasksDir);
      moveTaskToPhase(tasks.find((task) => task.id === created.id)!, 'executing', 'user', 'to executing', tasks);

      vi.setSystemTime(new Date('2026-01-01T00:20:00.000Z'));
      tasks = discoverTasks(tasksDir);
      moveTaskToPhase(tasks.find((task) => task.id === created.id)!, 'complete', 'user', 'to complete', tasks);

      const completedTask = discoverTasks(tasksDir).find((task) => task.id === created.id)!;
      const completedAt = completedTask.frontmatter.completed;
      const cycleTime = completedTask.frontmatter.cycleTime;
      const leadTime = completedTask.frontmatter.leadTime;

      vi.setSystemTime(new Date('2026-01-01T00:30:00.000Z'));
      tasks = discoverTasks(tasksDir);
      moveTaskToPhase(tasks.find((task) => task.id === created.id)!, 'archived', 'user', 'archive', tasks);

      vi.setSystemTime(new Date('2026-01-01T00:40:00.000Z'));
      tasks = discoverTasks(tasksDir);
      moveTaskToPhase(tasks.find((task) => task.id === created.id)!, 'complete', 'user', 'restore from archive', tasks);

      const restoredTask = discoverTasks(tasksDir).find((task) => task.id === created.id)!;
      expect(restoredTask.frontmatter.phase).toBe('complete');
      expect(restoredTask.frontmatter.completed).toBe(completedAt);
      expect(restoredTask.frontmatter.cycleTime).toBe(cycleTime);
      expect(restoredTask.frontmatter.leadTime).toBe(leadTime);
    } finally {
      vi.useRealTimers();
    }
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

  it('supports criteria-only updates without changing title or content', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const created = createTaskFile(workspacePath, tasksDir, {
      title: 'Keep title stable',
      content: 'keep this body',
      acceptanceCriteria: ['existing criterion'],
    });

    const originalTitle = created.frontmatter.title;
    const originalContent = created.content;

    const updated = updateTask(created, {
      acceptanceCriteria: ['  first item  ', '', 'second item'],
    });

    expect(updated.frontmatter.title).toBe(originalTitle);
    expect(updated.content).toBe(originalContent);
    expect(updated.frontmatter.acceptanceCriteria).toEqual(['first item', 'second item']);

    const persisted = discoverTasks(tasksDir).find((task) => task.id === created.id)!;
    expect(persisted.frontmatter.title).toBe(originalTitle);
    expect(persisted.content).toBe(originalContent);
    expect(persisted.frontmatter.acceptanceCriteria).toEqual(['first item', 'second item']);
  });

  it('strips empty acceptance criteria when parsing task files', () => {
    const now = new Date().toISOString();
    const rawTask = `id: TEST-RAW
phase: backlog
created: ${now}
updated: ${now}
workspace: /tmp/workspace
project: workspace
description: Body content
acceptanceCriteria:
  - ""
  - "   "
  - Keep this
testingInstructions: []
commits: []
attachments: []
blocked:
  isBlocked: false
`;

    const parsed = parseTaskContent(rawTask, '/tmp/test-raw/task.yaml');

    expect(parsed.frontmatter.acceptanceCriteria).toEqual(['Keep this']);
    expect(parsed.content).toBe('Body content');
    expect(parsed.frontmatter.usageMetrics?.totals).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      cost: 0,
    });
    expect(parsed.frontmatter.usageMetrics?.byModel).toEqual([]);
  });

  it('normalizes YAML object-style criteria into readable text', () => {
    const now = new Date().toISOString();
    const rawTask = `id: TEST-OBJ
phase: backlog
created: ${now}
updated: ${now}
workspace: /tmp/workspace
project: workspace
description: Body
acceptanceCriteria:
  - "Criterion with colon: still valid text"
testingInstructions: []
commits: []
attachments: []
blocked:
  isBlocked: false
`;

    const parsed = parseTaskContent(rawTask, '/tmp/test-obj/task.yaml');

    expect(parsed.frontmatter.acceptanceCriteria).toEqual(['Criterion with colon: still valid text']);
  });

  it('recomputes usage totals from byModel when totals object is empty', () => {
    const now = new Date().toISOString();
    const rawTask = `id: TEST-USAGE
phase: backlog
created: ${now}
updated: ${now}
workspace: /tmp/workspace
project: workspace
description: Body
acceptanceCriteria:
  - Keep this
testingInstructions: []
commits: []
attachments: []
usageMetrics:
  totals: {}
  byModel:
    - provider: anthropic
      modelId: claude-sonnet-4-20250514
      inputTokens: 12
      outputTokens: 3
      totalTokens: 15
      cost: 0.001
blocked:
  isBlocked: false
`;

    const parsed = parseTaskContent(rawTask, '/tmp/test-usage/task.yaml');

    expect(parsed.frontmatter.usageMetrics?.totals).toEqual({
      inputTokens: 12,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 15,
      cost: 0.001,
    });
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

  it('allows restoring archived tasks to complete while still rejecting unsupported targets', () => {
    const archivedTask = createTask({ phase: 'archived' });

    expect(canMoveToPhase(archivedTask, 'complete')).toEqual({ allowed: true });
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

describe('directory-per-task format', () => {
  it('creates tasks as directories with task.yaml inside', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const task = createTaskFile(workspacePath, tasksDir, {
      title: 'Directory task',
      content: 'task description',
      acceptanceCriteria: ['done'],
    });

    // filePath should point to task.yaml inside a task directory
    expect(task.filePath).toContain('task.yaml');
    expect(existsSync(task.filePath)).toBe(true);

    // Task directory should exist
    const taskDir = getTaskDir(tasksDir, task.id);
    expect(existsSync(taskDir)).toBe(true);

    // File should be pure YAML (no frontmatter delimiters)
    const content = readFileSync(task.filePath, 'utf-8');
    expect(content.startsWith('---\n')).toBe(false);
    expect(content).toContain('description: task description');
  });

  it('round-trips task data through save and load', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const task = createTaskFile(workspacePath, tasksDir, {
      title: 'Round trip',
      content: 'my description',
      acceptanceCriteria: ['criterion 1', 'criterion 2'],
    });

    const loaded = discoverTasks(tasksDir).find(t => t.id === task.id)!;

    expect(loaded.frontmatter.title).toBe('Round trip');
    expect(loaded.content).toBe('my description');
    expect(loaded.frontmatter.acceptanceCriteria).toEqual(['criterion 1', 'criterion 2']);
    expect(loaded.frontmatter.phase).toBe('backlog');
    expect(loaded.frontmatter.usageMetrics?.totals).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      cost: 0,
    });
  });

  it('deletes the entire task directory', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const task = createTaskFile(workspacePath, tasksDir, {
      title: 'Delete me',
      content: 'to be deleted',
      acceptanceCriteria: [],
    });

    const taskDir = getTaskDir(tasksDir, task.id);
    expect(existsSync(taskDir)).toBe(true);

    deleteTask(task);

    expect(existsSync(taskDir)).toBe(false);
  });
});


