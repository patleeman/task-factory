import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const createAgentSessionMock = vi.fn();

vi.mock('@mariozechner/pi-coding-agent', () => ({
  createAgentSession: (...args: any[]) => createAgentSessionMock(...args),
  AuthStorage: class AuthStorage {},
  DefaultResourceLoader: class DefaultResourceLoader {
    async reload(): Promise<void> {
      // no-op for tests
    }
  },
  ModelRegistry: class ModelRegistry {
    find(): undefined {
      return undefined;
    }
  },
  SessionManager: {
    create: () => ({}),
  },
  SettingsManager: {
    create: () => ({
      applyOverrides: () => {},
    }),
  },
}));

vi.mock('../src/activity-service.js', () => ({
  createTaskSeparator: vi.fn(),
  createChatMessage: vi.fn(),
  createSystemEvent: vi.fn((workspaceId: string, taskId: string, event: string, message: string) => ({
    type: 'system-event',
    id: crypto.randomUUID(),
    taskId,
    event,
    message,
    timestamp: new Date().toISOString(),
    workspaceId,
  })),
}));

describe('planTask', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    createAgentSessionMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();

    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('returns null and keeps task unplanned when plan generation fails', async () => {
    createAgentSessionMock.mockRejectedValue(new Error('session creation failed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, parseTaskFile } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Implement better plan failure handling',
      acceptanceCriteria: [],
    });

    const broadcasts: any[] = [];
    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: (event: any) => broadcasts.push(event),
    });

    expect(result).toBeNull();
    expect(task.frontmatter.plan).toBeUndefined();
    expect(task.frontmatter.planningStatus).toBe('error');

    const persistedTask = parseTaskFile(task.filePath);
    expect(persistedTask.frontmatter.plan).toBeUndefined();
    expect(persistedTask.frontmatter.planningStatus).toBe('error');

    const statusEvents = broadcasts.filter((event) => event.type === 'agent:execution_status');
    expect(statusEvents.at(-1)).toMatchObject({
      taskId: task.id,
      status: 'error',
    });

    expect(broadcasts.some((event) => event.type === 'task:plan_generated')).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('marks planning as error when the agent completes without saving a plan', async () => {
    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: () => () => {},
        prompt: async () => {},
        abort: async () => {},
      },
    });

    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, parseTaskFile } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Return error status if save_plan is not called',
      acceptanceCriteria: [],
    });

    const broadcasts: any[] = [];
    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: (event: any) => broadcasts.push(event),
    });

    expect(result).toBeNull();
    expect(task.frontmatter.plan).toBeUndefined();
    expect(task.frontmatter.planningStatus).toBe('error');

    const persistedTask = parseTaskFile(task.filePath);
    expect(persistedTask.frontmatter.plan).toBeUndefined();
    expect(persistedTask.frontmatter.planningStatus).toBe('error');

    const statusEvents = broadcasts.filter((event) => event.type === 'agent:execution_status');
    expect(statusEvents.at(-1)).toMatchObject({
      taskId: task.id,
      status: 'error',
    });

    expect(broadcasts.some((event) => event.type === 'task:plan_generated')).toBe(false);
  });

  it('keeps concurrent phase transitions when a plan is saved', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, discoverTasks, moveTaskToPhase, parseTaskFile } = await import('../src/task-service.js');

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: () => () => {},
        prompt: async () => {
          const liveTasks = discoverTasks(tasksDir);
          const liveTask = liveTasks.find((candidate) => candidate.id === task.id);
          if (!liveTask) {
            throw new Error('Live task not found during planning test');
          }

          moveTaskToPhase(liveTask, 'ready', 'user', 'Moved while planning', liveTasks);

          const callback = (globalThis as any).__piFactoryPlanCallbacks?.get(task.id);
          if (!callback) {
            throw new Error('save_plan callback not registered');
          }

          callback({
            acceptanceCriteria: ['Criterion one'],
            plan: {
              goal: 'Goal',
              steps: ['Step one'],
              validation: ['Validate one'],
              cleanup: [],
              generatedAt: new Date().toISOString(),
            },
          });
        },
        abort: async () => {},
      },
    });

    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Ensure planning writes do not clobber phase updates',
      acceptanceCriteria: [],
    });

    const broadcasts: any[] = [];
    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: (event: any) => broadcasts.push(event),
    });

    expect(result).not.toBeNull();

    const persistedTask = parseTaskFile(task.filePath);
    expect(persistedTask.frontmatter.phase).toBe('ready');
    expect(persistedTask.frontmatter.plan).toBeDefined();
    expect(persistedTask.frontmatter.planningStatus).toBe('completed');

    const updateEvents = broadcasts.filter((event) => event.type === 'task:updated');
    expect(updateEvents.length).toBeGreaterThan(0);
    expect(updateEvents.at(-1)?.task?.frontmatter?.phase).toBe('ready');
  });
});
