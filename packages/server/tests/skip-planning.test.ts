import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Task } from '@task-factory/shared';
import {
  createTask,
  discoverTasks,
  shouldResumeInterruptedPlanning,
  saveTaskFile,
  getTaskFilePath,
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
  it('creates a task without planningStatus when skipPlanning is not set', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const task = createTask(workspacePath, tasksDir, {
      title: 'Task without skip',
      content: 'This task should have no planningStatus',
      acceptanceCriteria: ['criterion'],
    });

    // By default, planningStatus should be undefined (not set)
    expect(task.frontmatter.planningStatus).toBeUndefined();
    
    // The task should be eligible for planning/resume
    expect(shouldResumeInterruptedPlanning(task)).toBe(true);
  });

  it('creates a task with planningStatus=completed when skipPlanning is true', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    // Create the task
    const task = createTask(workspacePath, tasksDir, {
      title: 'Task with skip planning',
      content: 'This task should skip planning',
      acceptanceCriteria: ['criterion'],
    });

    // Simulate what the server does when skipPlanning is true
    task.frontmatter.planningStatus = 'completed';
    saveTaskFile(task);

    // Verify the persisted task has planningStatus=completed
    const persisted = discoverTasks(tasksDir).find((t) => t.id === task.id)!;
    expect(persisted.frontmatter.planningStatus).toBe('completed');
    
    // The task should NOT be eligible for planning resume
    expect(shouldResumeInterruptedPlanning(persisted)).toBe(false);
    
    // Verify the YAML file contains planningStatus: completed
    const taskYaml = readFileSync(task.filePath, 'utf-8');
    expect(taskYaml).toContain('planningStatus: completed');
  });

  it('persists skip-planning state correctly even without a plan', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const task = createTask(workspacePath, tasksDir, {
      title: 'Skip planning no plan',
      content: 'No plan but planning skipped',
      acceptanceCriteria: ['do something'],
    });

    // Simulate server setting planningStatus to completed when skipPlanning is true
    task.frontmatter.planningStatus = 'completed';
    saveTaskFile(task);

    const persisted = discoverTasks(tasksDir).find((t) => t.id === task.id)!;
    
    // Should not have a plan
    expect(persisted.frontmatter.plan).toBeUndefined();
    
    // But planningStatus should be completed to prevent recovery
    expect(persisted.frontmatter.planningStatus).toBe('completed');
    
    // Should not be resumed
    expect(shouldResumeInterruptedPlanning(persisted)).toBe(false);
  });

  it('distinguishes between skip-planning and legacy unplanned tasks', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    // Legacy unplanned task (no planningStatus)
    const legacyTask = createTask(workspacePath, tasksDir, {
      title: 'Legacy task',
      content: 'Legacy unplanned task',
      acceptanceCriteria: ['criterion'],
    });

    // Skip-planning task (planningStatus=completed)
    const skipTask = createTask(workspacePath, tasksDir, {
      title: 'Skip planning task',
      content: 'Skip planning task',
      acceptanceCriteria: ['criterion'],
    });
    skipTask.frontmatter.planningStatus = 'completed';
    saveTaskFile(skipTask);

    // Legacy task should be eligible for planning resume
    expect(shouldResumeInterruptedPlanning(legacyTask)).toBe(true);
    
    // Skip-planning task should NOT be eligible
    expect(shouldResumeInterruptedPlanning(skipTask)).toBe(false);
  });

  it('allows moving skip-planning task to executing without planning block', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const task = createTask(workspacePath, tasksDir, {
      title: 'Skip planning for execution',
      content: 'Skip and execute',
      acceptanceCriteria: ['execute this'],
    });

    // Mark as skip-planning
    task.frontmatter.planningStatus = 'completed';
    saveTaskFile(task);

    const persisted = discoverTasks(tasksDir).find((t) => t.id === task.id)!;
    
    // Task has acceptance criteria and planning is completed (not running)
    // so it should be able to move to executing
    const result = canMoveToPhase(persisted, 'executing');
    
    // Should be allowed since planning is completed (not running)
    expect(result.allowed).toBe(true);
  });
});
