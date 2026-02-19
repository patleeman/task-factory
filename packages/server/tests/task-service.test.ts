import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Task } from '@task-factory/shared';
import {
  canMoveToPhase,
  createTask as createTaskFile,
  countTasksByScope,
  deleteTask,
  discoverTasks,
  moveTaskToPhase,
  parseTaskContent,
  shouldResumeInterruptedPlanning,
  updateTask,
  getTaskDir,
  saveTaskFile,
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

describe('createTask', () => {
  it('persists a provided plan on task creation', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const created = createTaskFile(workspacePath, tasksDir, {
      title: 'Task with plan',
      content: 'Use provided plan',
      acceptanceCriteria: ['criterion'],
      plan: {
        goal: 'Keep the supplied plan',
        steps: ['step 1'],
        validation: ['validate 1'],
        cleanup: [],
        generatedAt: new Date().toISOString(),
      },
    });

    expect(created.frontmatter.plan).toBeDefined();
    expect(created.frontmatter.plan?.goal).toBe('Keep the supplied plan');

    const taskYaml = readFileSync(created.filePath, 'utf-8');
    expect(taskYaml).toContain('goal: Keep the supplied plan');
  });
});

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

describe('discoverTasks scope filtering', () => {
  it('returns active tasks without parsing malformed archived task files', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const activeTask = createTaskFile(workspacePath, tasksDir, {
      title: 'Active task',
      content: 'active body',
      acceptanceCriteria: ['done'],
    });

    const malformedArchivedDir = join(tasksDir, 'broken-archived-task');
    mkdirSync(malformedArchivedDir, { recursive: true });
    writeFileSync(
      join(malformedArchivedDir, 'task.yaml'),
      [
        'id: BROK-999',
        'title: Broken archived task',
        'phase: archived',
        'description: |',
        '  [this yaml is intentionally malformed',
      ].join('\n'),
      'utf-8',
    );

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const tasks = discoverTasks(tasksDir, { scope: 'active' });

      expect(tasks.some((task) => task.id === activeTask.id)).toBe(true);
      expect(tasks.some((task) => task.frontmatter.phase === 'archived')).toBe(false);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not misclassify active tasks when description text includes an indented phase field', () => {
    const { tasksDir } = createTempWorkspace();

    const taskId = 'TEXT-1';
    const taskDir = join(tasksDir, taskId.toLowerCase());
    mkdirSync(taskDir, { recursive: true });

    writeFileSync(
      join(taskDir, 'task.yaml'),
      [
        `id: ${taskId}`,
        'title: Phase text task',
        'phase: backlog',
        'created: 2026-02-15T00:00:00.000Z',
        'updated: 2026-02-15T00:00:00.000Z',
        'workspace: /tmp/workspace',
        'project: workspace',
        'blockedCount: 0',
        'blockedDuration: 0',
        'order: 0',
        'acceptanceCriteria: []',
        'testingInstructions: []',
        'commits: []',
        'attachments: []',
        'blocked:',
        '  isBlocked: false',
        'description: |',
        '  Notes:',
        '    phase: archived',
      ].join('\n'),
      'utf-8',
    );

    const activeOnly = discoverTasks(tasksDir, { scope: 'active' });
    const archivedOnly = discoverTasks(tasksDir, { scope: 'archived' });

    expect(activeOnly.map((task) => task.id)).toContain(taskId);
    expect(archivedOnly.map((task) => task.id)).not.toContain(taskId);
  });

  it('returns archived tasks only when archived scope is requested', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const activeTask = createTaskFile(workspacePath, tasksDir, {
      title: 'Active task',
      content: 'active body',
      acceptanceCriteria: ['done'],
    });

    const archivedTask = createTaskFile(workspacePath, tasksDir, {
      title: 'Archived task',
      content: 'archived body',
      acceptanceCriteria: ['done'],
    });

    const allTasks = discoverTasks(tasksDir);
    moveTaskToPhase(
      allTasks.find((task) => task.id === archivedTask.id)!,
      'archived',
      'user',
      'archive for scope filtering',
      allTasks,
    );

    const archivedOnly = discoverTasks(tasksDir, { scope: 'archived' });
    const activeOnly = discoverTasks(tasksDir, { scope: 'active' });

    expect(archivedOnly.map((task) => task.id)).toContain(archivedTask.id);
    expect(archivedOnly.some((task) => task.frontmatter.phase !== 'archived')).toBe(false);

    expect(activeOnly.map((task) => task.id)).toContain(activeTask.id);
    expect(activeOnly.map((task) => task.id)).not.toContain(archivedTask.id);
  });

  it('counts tasks by scope without loading full archived payloads', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const activeTask = createTaskFile(workspacePath, tasksDir, {
      title: 'Active task',
      content: 'active body',
      acceptanceCriteria: ['done'],
    });

    const archivedTask = createTaskFile(workspacePath, tasksDir, {
      title: 'Archived task',
      content: 'archived body',
      acceptanceCriteria: ['done'],
    });

    const allTasks = discoverTasks(tasksDir);
    moveTaskToPhase(
      allTasks.find((task) => task.id === archivedTask.id)!,
      'archived',
      'user',
      'archive for count scope filtering',
      allTasks,
    );

    expect(countTasksByScope(tasksDir, 'all')).toBe(2);
    expect(countTasksByScope(tasksDir, 'active')).toBe(1);
    expect(countTasksByScope(tasksDir, 'archived')).toBe(1);

    const activeOnly = discoverTasks(tasksDir, { scope: 'active' });
    expect(activeOnly.map((task) => task.id)).toContain(activeTask.id);
    expect(activeOnly.map((task) => task.id)).not.toContain(archivedTask.id);
  });

  it('counts malformed archived tasks by phase header without parsing failures', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    createTaskFile(workspacePath, tasksDir, {
      title: 'Active task',
      content: 'active body',
      acceptanceCriteria: ['done'],
    });

    const malformedArchivedDir = join(tasksDir, 'broken-archived-task-count');
    mkdirSync(malformedArchivedDir, { recursive: true });
    writeFileSync(
      join(malformedArchivedDir, 'task.yaml'),
      [
        'id: BROK-555',
        'title: Broken archived task',
        'phase: archived',
        'description: |',
        '  [this yaml is intentionally malformed',
      ].join('\n'),
      'utf-8',
    );

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      expect(countTasksByScope(tasksDir, 'active')).toBe(1);
      expect(countTasksByScope(tasksDir, 'archived')).toBe(1);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('task ordering', () => {
  it('creates new backlog tasks at the start (left)', () => {
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

    const third = createTaskFile(workspacePath, tasksDir, {
      title: 'Third task',
      content: 'third',
      acceptanceCriteria: ['done'],
    });

    expect(first.frontmatter.order).toBe(0);
    expect(second.frontmatter.order).toBe(first.frontmatter.order - 1);
    expect(third.frontmatter.order).toBe(second.frontmatter.order - 1);

    const backlogIds = discoverTasks(tasksDir)
      .filter((task) => task.frontmatter.phase === 'backlog')
      .map((task) => task.id);

    expect(backlogIds).toEqual([third.id, second.id, first.id]);
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

  it('inserts moved tasks at the start of archived', () => {
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
    moveTaskToPhase(tasks.find((task) => task.id === first.id)!, 'archived', 'user', 'archive first', tasks);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((task) => task.id === second.id)!, 'archived', 'user', 'archive second', tasks);

    const archivedTasks = discoverTasks(tasksDir).filter((task) => task.frontmatter.phase === 'archived');

    expect(archivedTasks.map((task) => task.id)).toEqual([second.id, first.id]);
    expect(archivedTasks[0].frontmatter.order).toBeLessThan(archivedTasks[1].frontmatter.order);
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

describe('archived conversation snapshots', () => {
  function getArchivedConversationPath(tasksDir: string, taskId: string): string {
    return join(getTaskDir(tasksDir, taskId), 'conversation-archive.jsonl');
  }

  it('copies the task conversation into the task directory when archiving', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const task = createTaskFile(workspacePath, tasksDir, {
      title: 'Archive conversation copy',
      content: 'archive with snapshot',
      acceptanceCriteria: ['done'],
    });

    const sessionDir = join(workspacePath, '.pi', 'sessions');
    mkdirSync(sessionDir, { recursive: true });

    const sessionFile = join(sessionDir, 'task-session.jsonl');
    const conversation = '{"role":"assistant","content":"hello"}\n';
    writeFileSync(sessionFile, conversation, 'utf-8');

    task.frontmatter.sessionFile = sessionFile;
    moveTaskToPhase(task, 'archived', 'user', 'archive', discoverTasks(tasksDir));

    const archivedConversationPath = getArchivedConversationPath(tasksDir, task.id);
    expect(existsSync(archivedConversationPath)).toBe(true);
    expect(readFileSync(archivedConversationPath, 'utf-8')).toBe(conversation);

    const persisted = discoverTasks(tasksDir).find((candidate) => candidate.id === task.id)!;
    expect(persisted.frontmatter.phase).toBe('archived');
  });

  it('refreshes the archived conversation snapshot when archiving again', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const task = createTaskFile(workspacePath, tasksDir, {
      title: 'Re-archive conversation copy',
      content: 'refresh archive snapshot',
      acceptanceCriteria: ['done'],
    });

    const sessionDir = join(workspacePath, '.pi', 'sessions');
    mkdirSync(sessionDir, { recursive: true });

    const sessionFile = join(sessionDir, 'task-session.jsonl');
    const firstConversation = '{"turn":1}\n';
    writeFileSync(sessionFile, firstConversation, 'utf-8');

    task.frontmatter.sessionFile = sessionFile;
    saveTaskFile(task);

    let tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((candidate) => candidate.id === task.id)!, 'archived', 'user', 'archive first', tasks);

    const archivedConversationPath = getArchivedConversationPath(tasksDir, task.id);
    expect(readFileSync(archivedConversationPath, 'utf-8')).toBe(firstConversation);

    const secondConversation = '{"turn":2}\n';
    writeFileSync(sessionFile, secondConversation, 'utf-8');

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((candidate) => candidate.id === task.id)!, 'complete', 'user', 'restore', tasks);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((candidate) => candidate.id === task.id)!, 'archived', 'user', 'archive second', tasks);

    expect(readFileSync(archivedConversationPath, 'utf-8')).toBe(secondConversation);
  });

  it('allows archiving when the conversation file is missing or unset', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const withoutSession = createTaskFile(workspacePath, tasksDir, {
      title: 'Archive without session',
      content: 'no conversation file',
      acceptanceCriteria: ['done'],
    });

    expect(() => {
      moveTaskToPhase(withoutSession, 'archived', 'user', 'archive without session', discoverTasks(tasksDir));
    }).not.toThrow();

    const withoutSessionPersisted = discoverTasks(tasksDir).find((task) => task.id === withoutSession.id)!;
    expect(withoutSessionPersisted.frontmatter.phase).toBe('archived');
    expect(existsSync(getArchivedConversationPath(tasksDir, withoutSession.id))).toBe(false);

    const missingSession = createTaskFile(workspacePath, tasksDir, {
      title: 'Archive with missing session',
      content: 'missing file should not block archive',
      acceptanceCriteria: ['done'],
    });

    missingSession.frontmatter.sessionFile = join(workspacePath, '.pi', 'sessions', 'missing-session.jsonl');

    expect(() => {
      moveTaskToPhase(missingSession, 'archived', 'user', 'archive missing session', discoverTasks(tasksDir));
    }).not.toThrow();

    const missingSessionPersisted = discoverTasks(tasksDir).find((task) => task.id === missingSession.id)!;
    expect(missingSessionPersisted.frontmatter.phase).toBe('archived');
    expect(existsSync(getArchivedConversationPath(tasksDir, missingSession.id))).toBe(false);

    const directorySession = createTaskFile(workspacePath, tasksDir, {
      title: 'Archive with directory session path',
      content: 'directory should not block archive',
      acceptanceCriteria: ['done'],
    });

    const sessionDir = join(workspacePath, '.pi', 'sessions', 'directory-session');
    mkdirSync(sessionDir, { recursive: true });
    directorySession.frontmatter.sessionFile = sessionDir;

    expect(() => {
      moveTaskToPhase(directorySession, 'archived', 'user', 'archive directory session', discoverTasks(tasksDir));
    }).not.toThrow();

    const directorySessionPersisted = discoverTasks(tasksDir).find((task) => task.id === directorySession.id)!;
    expect(directorySessionPersisted.frontmatter.phase).toBe('archived');
    expect(existsSync(getArchivedConversationPath(tasksDir, directorySession.id))).toBe(false);
  });

  it('does not create archived conversation snapshots for non-archived moves', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const task = createTaskFile(workspacePath, tasksDir, {
      title: 'Non-archive moves do not snapshot conversation',
      content: 'should not snapshot before archive',
      acceptanceCriteria: ['done'],
    });

    const sessionDir = join(workspacePath, '.pi', 'sessions');
    mkdirSync(sessionDir, { recursive: true });

    const sessionFile = join(sessionDir, 'task-session.jsonl');
    writeFileSync(sessionFile, '{"turn":1}\n', 'utf-8');

    task.frontmatter.sessionFile = sessionFile;
    saveTaskFile(task);

    const archivedConversationPath = getArchivedConversationPath(tasksDir, task.id);

    let tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((candidate) => candidate.id === task.id)!, 'ready', 'user', 'to ready', tasks);
    expect(existsSync(archivedConversationPath)).toBe(false);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((candidate) => candidate.id === task.id)!, 'executing', 'user', 'to executing', tasks);
    expect(existsSync(archivedConversationPath)).toBe(false);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((candidate) => candidate.id === task.id)!, 'complete', 'user', 'to complete', tasks);
    expect(existsSync(archivedConversationPath)).toBe(false);

    tasks = discoverTasks(tasksDir);
    moveTaskToPhase(tasks.find((candidate) => candidate.id === task.id)!, 'ready', 'user', 'rework', tasks);
    expect(existsSync(archivedConversationPath)).toBe(false);
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

  it('allows moving a planned backlog task (planningStatus=completed) directly to executing', () => {
    const task = createTask({
      phase: 'backlog',
      acceptanceCriteria: ['Criterion one'],
      planningStatus: 'completed',
    });
    const result = canMoveToPhase(task, 'executing');

    expect(result).toEqual({ allowed: true });
  });

  it('allows moving a backlog task with criteria and no prior planning run directly to executing', () => {
    const task = createTask({ phase: 'backlog', acceptanceCriteria: ['Criterion one'] });
    const result = canMoveToPhase(task, 'executing');

    expect(result).toEqual({ allowed: true });
  });

  it('blocks backlog -> executing when the task has no acceptance criteria', () => {
    const task = createTask({ phase: 'backlog', acceptanceCriteria: [] });
    const result = canMoveToPhase(task, 'executing');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Task must have acceptance criteria before moving directly to Executing');
  });

  it('blocks backlog -> executing when criteria are only whitespace', () => {
    const task = createTask({ phase: 'backlog', acceptanceCriteria: ['   ', '\t'] });
    const result = canMoveToPhase(task, 'executing');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Task must have acceptance criteria before moving directly to Executing');
  });

  it('blocks move to executing when planning is still running (ready phase)', () => {
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

  it('blocks backlog -> executing when planning is still running', () => {
    const task = createTask({
      phase: 'backlog',
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


