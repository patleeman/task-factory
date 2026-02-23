import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createTask,
  discoverTasks,
  shouldResumeInterruptedPlanning,
  canMoveToPhase,
} from '../src/task-service.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

function createTempWorkspace(): { workspacePath: string; tasksDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'pi-factory-skip-planning-'));
  tempRoots.push(root);

  const workspacePath = join(root, 'workspace');
  const tasksDir = join(workspacePath, '.pi', 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  return { workspacePath, tasksDir };
}

describe('skipPlanning feature', () => {
  it('persists explicit no-plan mode flags when skipPlanning is enabled', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const task = createTask(workspacePath, tasksDir, {
      title: 'Task with skip planning',
      content: 'Skip planning requested',
      skipPlanning: true,
    });

    expect(task.frontmatter.planningSkipped).toBe(true);
    expect(task.frontmatter.plan).toBeUndefined();

    const persisted = discoverTasks(tasksDir).find((t) => t.id === task.id)!;
    expect(persisted.frontmatter.planningSkipped).toBe(true);
  });

  it('does not resume interrupted planning for explicit no-plan tasks', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const noPlanTask = createTask(workspacePath, tasksDir, {
      title: 'No-plan task',
      content: 'Skip planning',
      skipPlanning: true,
    });
    noPlanTask.frontmatter.planningStatus = 'completed';

    const legacyTask = createTask(workspacePath, tasksDir, {
      title: 'Legacy unplanned task',
      content: 'Needs planning',
    });

    expect(shouldResumeInterruptedPlanning(noPlanTask)).toBe(false);
    expect(shouldResumeInterruptedPlanning(legacyTask)).toBe(true);
  });

  it('allows no-plan tasks to move backlog -> ready without acceptance criteria', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const noPlanTask = createTask(workspacePath, tasksDir, {
      title: 'No-plan ready transition',
      content: 'No AC provided',
      skipPlanning: true,
      acceptanceCriteria: [],
    });

    const result = canMoveToPhase(noPlanTask, 'ready');
    expect(result).toEqual({ allowed: true });
  });

  it('allows no-plan tasks to move backlog -> executing without acceptance criteria', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const noPlanTask = createTask(workspacePath, tasksDir, {
      title: 'No-plan executing transition',
      content: 'No AC provided',
      skipPlanning: true,
      acceptanceCriteria: [],
    });

    const result = canMoveToPhase(noPlanTask, 'executing');
    expect(result).toEqual({ allowed: true });
  });

  it('preserves acceptance criteria guard for normal planned tasks', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const normalTask = createTask(workspacePath, tasksDir, {
      title: 'Planned task',
      content: 'No skip planning',
      acceptanceCriteria: [],
    });

    expect(canMoveToPhase(normalTask, 'ready')).toEqual({
      allowed: false,
      reason: 'Task must have acceptance criteria before moving to Ready',
    });

    expect(canMoveToPhase(normalTask, 'executing')).toEqual({
      allowed: false,
      reason: 'Task must have acceptance criteria before moving directly to Executing',
    });
  });
});
