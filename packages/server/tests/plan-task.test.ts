import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DEFAULT_PLANNING_GUARDRAILS } from '@pi-factory/shared';

const createAgentSessionMock = vi.fn();
const sessionManagerCreateMock = vi.fn(() => ({}));
const sessionManagerOpenMock = vi.fn(() => ({}));
const withTimeoutMock = vi.fn();

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
    create: (...args: any[]) => sessionManagerCreateMock(...args),
    open: (...args: any[]) => sessionManagerOpenMock(...args),
  },
  SettingsManager: {
    create: () => ({
      applyOverrides: () => {},
    }),
  },
}));

vi.mock('../src/activity-service.js', () => ({
  createTaskSeparator: vi.fn(async () => undefined),
  createChatMessage: vi.fn(async (workspaceId: string, taskId: string, role: 'user' | 'agent', content: string) => ({
    type: 'chat-message',
    id: crypto.randomUUID(),
    taskId,
    role,
    content,
    timestamp: new Date().toISOString(),
    workspaceId,
  })),
  createSystemEvent: vi.fn(async (workspaceId: string, taskId: string, event: string, message: string) => ({
    type: 'system-event',
    id: crypto.randomUUID(),
    taskId,
    event,
    message,
    timestamp: new Date().toISOString(),
    workspaceId,
  })),
}));

vi.mock('../src/with-timeout.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/with-timeout.js')>();
  return {
    ...actual,
    withTimeout: (...args: any[]) => {
      withTimeoutMock(...args);
      return actual.withTimeout(...args);
    },
  };
});

let mockedFactorySettings: Record<string, unknown> | null = null;

vi.mock('../src/pi-integration.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/pi-integration.js')>();
  return {
    ...actual,
    loadPiFactorySettings: () => mockedFactorySettings,
  };
});

describe('planTask', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    mockedFactorySettings = null;
    createAgentSessionMock.mockReset();
    sessionManagerCreateMock.mockClear();
    sessionManagerOpenMock.mockClear();
    withTimeoutMock.mockReset();
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

  it('falls back to the 30-minute timeout and 1800-second message when timeout setting is invalid', async () => {
    mockedFactorySettings = {
      planningGuardrails: {
        timeoutMs: -1,
      },
    };

    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Use timeout fallback when setting is invalid',
      acceptanceCriteria: [],
    });

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: () => () => {},
        prompt: async () => {
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

    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: () => {},
    });

    expect(result).not.toBeNull();
    expect(DEFAULT_PLANNING_GUARDRAILS.timeoutMs).toBe(1_800_000);

    const planningTimeoutCall = withTimeoutMock.mock.calls.find((call) => (
      typeof call[2] === 'string' && String(call[2]).startsWith('Planning timed out after')
    ));

    if (!planningTimeoutCall) {
      throw new Error('Expected planning timeout wrapper call');
    }

    expect(planningTimeoutCall[1]).toBe(DEFAULT_PLANNING_GUARDRAILS.timeoutMs);
    expect(planningTimeoutCall[2]).toBe('Planning timed out after 1800 seconds');
  });

  it('uses explicit timeout overrides from planning guardrail settings', async () => {
    mockedFactorySettings = {
      planningGuardrails: {
        timeoutMs: 120_000,
      },
    };

    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Respect explicit timeout override settings',
      acceptanceCriteria: [],
    });

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: () => () => {},
        prompt: async () => {
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

    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: () => {},
    });

    expect(result).not.toBeNull();

    const planningTimeoutCall = withTimeoutMock.mock.calls.find((call) => (
      typeof call[2] === 'string' && String(call[2]).startsWith('Planning timed out after')
    ));

    if (!planningTimeoutCall) {
      throw new Error('Expected planning timeout wrapper call');
    }

    expect(planningTimeoutCall[1]).toBe(120_000);
    expect(planningTimeoutCall[2]).toBe('Planning timed out after 120 seconds');
  });

  it('aborts the planning turn right after save_plan persists a plan', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Ensure planning stops once save_plan succeeds',
      acceptanceCriteria: [],
    });

    const abortSpy = vi.fn(async () => {});

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: () => () => {},
        prompt: async () => {
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
        abort: abortSpy,
      },
    });

    const broadcasts: any[] = [];
    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: (event: any) => broadcasts.push(event),
    });

    expect(result).not.toBeNull();
    expect(task.frontmatter.plan).toBeDefined();
    expect(task.frontmatter.planningStatus).toBe('completed');
    expect(abortSpy).toHaveBeenCalled();

    const statusEvents = broadcasts.filter((event) => event.type === 'agent:execution_status');
    expect(statusEvents.at(-1)).toMatchObject({
      taskId: task.id,
      status: 'completed',
    });
  });

  it('persists usage metrics when planning assistant messages include usage payloads', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, parseTaskFile } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Persist planning usage metrics',
      acceptanceCriteria: [],
    });

    let subscriber: ((event: any) => void) | undefined;

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: (listener: (event: any) => void) => {
          subscriber = listener;
          return () => {};
        },
        prompt: async () => {
          subscriber?.({
            type: 'message_end',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Planning output' }],
              provider: 'anthropic',
              model: 'claude-sonnet-4-20250514',
              usage: {
                input: 30,
                output: 10,
                totalTokens: 40,
                cost: { total: 0.003 },
              },
            },
          });

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

    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: () => {},
    });

    expect(result).not.toBeNull();

    const persistedTask = parseTaskFile(task.filePath);
    expect(persistedTask.frontmatter.usageMetrics?.totals).toEqual({
      inputTokens: 30,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 40,
      cost: 0.003,
    });

    expect(persistedTask.frontmatter.usageMetrics?.byModel).toEqual([
      {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-20250514',
        inputTokens: 30,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 40,
        cost: 0.003,
      },
    ]);
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

  it('auto-promotes backlog tasks to ready when backlog automation is enabled', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const piDir = join(workspacePath, '.pi');
    const tasksDir = join(piDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    writeFileSync(
      join(piDir, 'factory.json'),
      JSON.stringify({
        taskLocations: ['.pi/tasks'],
        defaultTaskLocation: '.pi/tasks',
        wipLimits: {},
        queueProcessing: { enabled: false },
        workflowAutomation: {
          backlogToReady: true,
          readyToExecuting: false,
        },
      }),
      'utf-8',
    );

    const { createTask, parseTaskFile } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Auto-promote this task when planning completes',
      acceptanceCriteria: [],
    });

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: () => () => {},
        prompt: async () => {
          const callback = (globalThis as any).__piFactoryPlanCallbacks?.get(task.id);
          if (!callback) {
            throw new Error('save_plan callback not registered');
          }

          callback({
            acceptanceCriteria: ['Task is planned'],
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

    expect(
      broadcasts.some((event) => (
        event.type === 'task:moved'
        && event.task?.id === task.id
        && event.from === 'backlog'
        && event.to === 'ready'
      )),
    ).toBe(true);
  });

  it('auto-promotes backlog tasks using global workflow defaults when workspace overrides are unset', async () => {
    mockedFactorySettings = {
      workflowDefaults: {
        executingLimit: 1,
        backlogToReady: true,
        readyToExecuting: false,
      },
    };

    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const piDir = join(workspacePath, '.pi');
    const tasksDir = join(piDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    writeFileSync(
      join(piDir, 'factory.json'),
      JSON.stringify({
        taskLocations: ['.pi/tasks'],
        defaultTaskLocation: '.pi/tasks',
      }),
      'utf-8',
    );

    const { createTask, parseTaskFile } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Use global defaults for planning auto-promotion',
      acceptanceCriteria: [],
    });

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: () => () => {},
        prompt: async () => {
          const callback = (globalThis as any).__piFactoryPlanCallbacks?.get(task.id);
          if (!callback) {
            throw new Error('save_plan callback not registered');
          }

          callback({
            acceptanceCriteria: ['Task is planned'],
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

    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: () => {},
    });

    expect(result).not.toBeNull();

    const persistedTask = parseTaskFile(task.filePath);
    expect(persistedTask.frontmatter.phase).toBe('ready');
  });

  it('auto-promotes even when Ready has tasks under the inherited global ready limit', async () => {
    mockedFactorySettings = {
      workflowDefaults: {
        readyLimit: 25,
        executingLimit: 1,
        backlogToReady: true,
        readyToExecuting: false,
      },
    };

    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const piDir = join(workspacePath, '.pi');
    const tasksDir = join(piDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    writeFileSync(
      join(piDir, 'factory.json'),
      JSON.stringify({
        taskLocations: ['.pi/tasks'],
        defaultTaskLocation: '.pi/tasks',
      }),
      'utf-8',
    );

    const { createTask, parseTaskFile, discoverTasks, moveTaskToPhase } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const existingReadyTask = createTask(workspacePath, tasksDir, {
      content: 'Already ready task',
      acceptanceCriteria: ['done'],
    });
    const liveTasks = discoverTasks(tasksDir);
    const existingReadyLive = liveTasks.find((candidate) => candidate.id === existingReadyTask.id);
    if (!existingReadyLive) {
      throw new Error('Failed to seed ready task');
    }
    moveTaskToPhase(existingReadyLive, 'ready', 'user', 'seed ready lane', liveTasks);

    const task = createTask(workspacePath, tasksDir, {
      content: 'Should still auto-promote with ready tasks present',
      acceptanceCriteria: [],
    });

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: () => () => {},
        prompt: async () => {
          const callback = (globalThis as any).__piFactoryPlanCallbacks?.get(task.id);
          if (!callback) {
            throw new Error('save_plan callback not registered');
          }

          callback({
            acceptanceCriteria: ['Task is planned'],
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

    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: () => {},
    });

    expect(result).not.toBeNull();

    const persistedTask = parseTaskFile(task.filePath);
    expect(persistedTask.frontmatter.phase).toBe('ready');
  });

  it('does not auto-promote when global ready WIP limit is reached', async () => {
    mockedFactorySettings = {
      workflowDefaults: {
        readyLimit: 1,
        executingLimit: 1,
        backlogToReady: true,
        readyToExecuting: false,
      },
    };

    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const piDir = join(workspacePath, '.pi');
    const tasksDir = join(piDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    writeFileSync(
      join(piDir, 'factory.json'),
      JSON.stringify({
        taskLocations: ['.pi/tasks'],
        defaultTaskLocation: '.pi/tasks',
        queueProcessing: { enabled: false },
        workflowAutomation: {
          backlogToReady: true,
          readyToExecuting: false,
        },
      }),
      'utf-8',
    );

    const { createTask, parseTaskFile, discoverTasks, moveTaskToPhase } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const existingReadyTask = createTask(workspacePath, tasksDir, {
      content: 'Already ready task',
      acceptanceCriteria: ['done'],
    });
    const liveTasks = discoverTasks(tasksDir);
    const existingReadyLive = liveTasks.find((candidate) => candidate.id === existingReadyTask.id);
    if (!existingReadyLive) {
      throw new Error('Failed to set up existing ready task');
    }
    moveTaskToPhase(existingReadyLive, 'ready', 'user', 'seed ready lane', liveTasks);

    const task = createTask(workspacePath, tasksDir, {
      content: 'Should stay backlog because global ready WIP is full',
      acceptanceCriteria: [],
    });

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: () => () => {},
        prompt: async () => {
          const callback = (globalThis as any).__piFactoryPlanCallbacks?.get(task.id);
          if (!callback) {
            throw new Error('save_plan callback not registered');
          }

          callback({
            acceptanceCriteria: ['Task is planned'],
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

    const broadcasts: any[] = [];
    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: (event: any) => broadcasts.push(event),
    });

    expect(result).not.toBeNull();

    const persistedTask = parseTaskFile(task.filePath);
    expect(persistedTask.frontmatter.phase).toBe('backlog');

    expect(
      broadcasts.some((event) => (
        event.type === 'task:moved'
        && event.task?.id === task.id
      )),
    ).toBe(false);
  });

  it('does not auto-promote when planning saves no acceptance criteria', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const piDir = join(workspacePath, '.pi');
    const tasksDir = join(piDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    writeFileSync(
      join(piDir, 'factory.json'),
      JSON.stringify({
        taskLocations: ['.pi/tasks'],
        defaultTaskLocation: '.pi/tasks',
        wipLimits: {},
        queueProcessing: { enabled: false },
        workflowAutomation: {
          backlogToReady: true,
          readyToExecuting: false,
        },
      }),
      'utf-8',
    );

    const { createTask, parseTaskFile } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'No criteria should block auto-promotion',
      acceptanceCriteria: [],
    });

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: () => () => {},
        prompt: async () => {
          const callback = (globalThis as any).__piFactoryPlanCallbacks?.get(task.id);
          if (!callback) {
            throw new Error('save_plan callback not registered');
          }

          callback({
            acceptanceCriteria: [],
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

    const broadcasts: any[] = [];
    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: (event: any) => broadcasts.push(event),
    });

    expect(result).not.toBeNull();

    const persistedTask = parseTaskFile(task.filePath);
    expect(persistedTask.frontmatter.phase).toBe('backlog');

    expect(
      broadcasts.some((event) => (
        event.type === 'task:moved'
        && event.task?.id === task.id
      )),
    ).toBe(false);
  });

  it('reuses the existing task conversation when regenerating a plan', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const sessionsDir = join(workspacePath, '.pi', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });

    const existingSessionFile = join(sessionsDir, 'task-session.jsonl');
    writeFileSync(existingSessionFile, '{"type":"header"}\n', 'utf-8');

    const { createTask, parseTaskFile, saveTaskFile } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Resume planning from prior context instead of starting over',
      acceptanceCriteria: [],
    });

    task.frontmatter.sessionFile = existingSessionFile;
    saveTaskFile(task);

    const promptSpy = vi.fn(async (prompt: string) => {
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

      expect(prompt).toContain('# Resume Planning Task:');
    });

    createAgentSessionMock.mockResolvedValue({
      session: {
        sessionFile: existingSessionFile,
        subscribe: () => () => {},
        prompt: promptSpy,
        abort: async () => {},
        compact: async () => ({ summary: 'ok' }),
      },
    });

    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: () => {},
    });

    expect(result).not.toBeNull();
    expect(sessionManagerOpenMock).toHaveBeenCalledWith(existingSessionFile);
    expect(sessionManagerCreateMock).not.toHaveBeenCalled();

    const persistedTask = parseTaskFile(task.filePath);
    expect(persistedTask.frontmatter.sessionFile).toBe(existingSessionFile);
    expect(persistedTask.frontmatter.planningStatus).toBe('completed');
  });

  it('reuses the existing task conversation when regenerating acceptance criteria', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const sessionsDir = join(workspacePath, '.pi', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });

    const existingSessionFile = join(sessionsDir, 'task-session.jsonl');
    writeFileSync(existingSessionFile, '{"type":"header"}\n', 'utf-8');

    const { createTask, parseTaskFile, saveTaskFile } = await import('../src/task-service.js');
    const { regenerateAcceptanceCriteriaForTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Reuse the task conversation for acceptance criteria regeneration',
      acceptanceCriteria: [],
    });

    task.frontmatter.sessionFile = existingSessionFile;
    saveTaskFile(task);

    const listeners: Array<(event: any) => void> = [];
    const disposeSpy = vi.fn();

    createAgentSessionMock.mockResolvedValue({
      session: {
        sessionFile: existingSessionFile,
        subscribe: (listener: (event: any) => void) => {
          listeners.push(listener);
          return () => {
            const index = listeners.indexOf(listener);
            if (index >= 0) listeners.splice(index, 1);
          };
        },
        prompt: async (prompt: string) => {
          expect(prompt).toContain('Regenerate acceptance criteria for task');
          for (const listener of listeners) {
            listener({
              type: 'message_update',
              assistantMessageEvent: {
                type: 'text_delta',
                delta: '1. Criterion one\n2. Criterion two\n',
              },
            });
          }
        },
        abort: async () => {},
        dispose: disposeSpy,
      },
    });

    const criteria = await regenerateAcceptanceCriteriaForTask(
      task,
      'workspace-test',
      () => {},
    );

    expect(criteria).toEqual(['Criterion one', 'Criterion two']);
    expect(sessionManagerOpenMock).toHaveBeenCalledWith(existingSessionFile);
    expect(sessionManagerCreateMock).not.toHaveBeenCalled();
    expect(disposeSpy).toHaveBeenCalled();

    const persistedTask = parseTaskFile(task.filePath);
    expect(persistedTask.frontmatter.acceptanceCriteria).toEqual(['Criterion one', 'Criterion two']);
    expect(persistedTask.frontmatter.sessionFile).toBe(existingSessionFile);
  });

  it('gives the agent a grace turn to call save_plan when tool budget is exceeded', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, parseTaskFile } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Test grace turn when budget exceeded',
      acceptanceCriteria: [],
    });

    const subscribers: Array<(event: any) => void> = [];
    let promptCount = 0;
    let abortCalled = false;

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: (listener: (event: any) => void) => {
          subscribers.push(listener);
          return () => {
            const idx = subscribers.indexOf(listener);
            if (idx >= 0) subscribers.splice(idx, 1);
          };
        },
        prompt: vi.fn(async () => {
          promptCount++;
          if (promptCount === 1) {
            // Fire enough tool_execution_end events to exceed the default budget
            for (let i = 0; i <= DEFAULT_PLANNING_GUARDRAILS.maxToolCalls; i++) {
              if (abortCalled) return;
              for (const sub of [...subscribers]) {
                sub({ type: 'tool_execution_end', toolName: 'bash', toolCallId: `call-${i}`, isError: false });
              }
            }
          } else if (promptCount === 2) {
            // Grace turn — agent calls save_plan
            const callback = (globalThis as any).__piFactoryPlanCallbacks?.get(task.id);
            if (!callback) throw new Error('save_plan callback not registered');
            callback({
              acceptanceCriteria: ['Grace turn criterion'],
              plan: {
                goal: 'Plan from grace turn',
                steps: ['Step one'],
                validation: ['Validate one'],
                cleanup: [],
                generatedAt: new Date().toISOString(),
              },
            });
          }
        }),
        abort: vi.fn(async () => {
          abortCalled = true;
        }),
      },
    });

    const broadcasts: any[] = [];
    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: (event: any) => broadcasts.push(event),
    });

    expect(result).not.toBeNull();
    expect(result?.goal).toBe('Plan from grace turn');
    expect(promptCount).toBe(2);

    const persistedTask = parseTaskFile(task.filePath);
    expect(persistedTask.frontmatter.plan).toBeDefined();
    expect(persistedTask.frontmatter.planningStatus).toBe('completed');
  });

  it('does not abort planning when read tool output is large', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, parseTaskFile } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Large read output should not trigger a planning read budget guardrail',
      acceptanceCriteria: [],
    });

    const subscribers: Array<(event: any) => void> = [];
    let promptCount = 0;
    let abortCalled = false;
    let callbackInvoked = false;

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: (listener: (event: any) => void) => {
          subscribers.push(listener);
          return () => {
            const idx = subscribers.indexOf(listener);
            if (idx >= 0) subscribers.splice(idx, 1);
          };
        },
        prompt: vi.fn(async () => {
          promptCount++;

          if (promptCount > 1) {
            throw new Error('Planning should not enter a grace turn for large read output');
          }

          for (const sub of [...subscribers]) {
            sub({
              type: 'tool_execution_end',
              toolName: 'read',
              toolCallId: 'read-1',
              isError: false,
              result: {
                content: [
                  {
                    type: 'text',
                    text: 'x'.repeat(250_000),
                  },
                ],
              },
            });
          }

          if (abortCalled) {
            return;
          }

          const callback = (globalThis as any).__piFactoryPlanCallbacks?.get(task.id);
          if (!callback) throw new Error('save_plan callback not registered');
          callbackInvoked = true;
          callback({
            acceptanceCriteria: ['Large read output criterion'],
            plan: {
              goal: 'Plan despite large read output',
              steps: ['Step one'],
              validation: ['Validate one'],
              cleanup: [],
              generatedAt: new Date().toISOString(),
            },
          });
        }),
        abort: vi.fn(async () => {
          abortCalled = true;
        }),
      },
    });

    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: () => {},
    });

    expect(result).not.toBeNull();
    expect(callbackInvoked).toBe(true);
    expect(promptCount).toBe(1);

    const persistedTask = parseTaskFile(task.filePath);
    expect(persistedTask.frontmatter.plan).toBeDefined();
    expect(persistedTask.frontmatter.planningStatus).toBe('completed');
  });

  it('gives the agent a grace turn to call save_plan when planning ends due output length', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, parseTaskFile } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Test grace turn when model hits output length limit',
      acceptanceCriteria: [],
    });

    const subscribers: Array<(event: any) => void> = [];
    let promptCount = 0;

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: (listener: (event: any) => void) => {
          subscribers.push(listener);
          return () => {
            const idx = subscribers.indexOf(listener);
            if (idx >= 0) subscribers.splice(idx, 1);
          };
        },
        prompt: vi.fn(async (prompt: string) => {
          promptCount++;
          if (promptCount === 1) {
            for (const sub of [...subscribers]) {
              sub({
                type: 'turn_end',
                message: {
                  role: 'assistant',
                  stopReason: 'length',
                },
                toolResults: [],
              });
            }
            return;
          }

          expect(prompt).toContain('save_plan');
          const callback = (globalThis as any).__piFactoryPlanCallbacks?.get(task.id);
          if (!callback) throw new Error('save_plan callback not registered');
          callback({
            acceptanceCriteria: ['Length grace turn criterion'],
            plan: {
              goal: 'Plan from length grace turn',
              steps: ['Step one'],
              validation: ['Validate one'],
              cleanup: [],
              generatedAt: new Date().toISOString(),
            },
          });
        }),
        abort: vi.fn(async () => {}),
      },
    });

    const broadcasts: any[] = [];
    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: (event: any) => broadcasts.push(event),
    });

    expect(result).not.toBeNull();
    expect(result?.goal).toBe('Plan from length grace turn');
    expect(promptCount).toBe(2);

    const persistedTask = parseTaskFile(task.filePath);
    expect(persistedTask.frontmatter.plan).toBeDefined();
    expect(persistedTask.frontmatter.planningStatus).toBe('completed');

    const statusEvents = broadcasts.filter((event) => event.type === 'agent:execution_status');
    expect(statusEvents.at(-1)).toMatchObject({
      taskId: task.id,
      status: 'completed',
    });
  });

  it('still errors when the turn-limit grace turn fails to produce a plan', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, parseTaskFile } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Test turn-limit grace turn that fails',
      acceptanceCriteria: [],
    });

    const subscribers: Array<(event: any) => void> = [];
    let promptCount = 0;

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: (listener: (event: any) => void) => {
          subscribers.push(listener);
          return () => {
            const idx = subscribers.indexOf(listener);
            if (idx >= 0) subscribers.splice(idx, 1);
          };
        },
        prompt: vi.fn(async () => {
          promptCount++;
          if (promptCount === 1) {
            for (const sub of [...subscribers]) {
              sub({
                type: 'turn_end',
                message: {
                  role: 'assistant',
                  stopReason: 'error',
                  errorMessage: 'max_turns_exceeded: planning run hit max_turns.',
                },
                toolResults: [],
              });
            }
          }
          // promptCount === 2: grace turn — agent does NOT call save_plan
        }),
        abort: vi.fn(async () => {}),
      },
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broadcasts: any[] = [];
    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: (event: any) => broadcasts.push(event),
    });

    expect(result).toBeNull();
    expect(promptCount).toBe(2);
    expect(task.frontmatter.planningStatus).toBe('error');

    const persistedTask = parseTaskFile(task.filePath);
    expect(persistedTask.frontmatter.plan).toBeUndefined();
    expect(persistedTask.frontmatter.planningStatus).toBe('error');

    const statusEvents = broadcasts.filter((event) => event.type === 'agent:execution_status');
    expect(statusEvents.at(-1)).toMatchObject({
      taskId: task.id,
      status: 'error',
    });

    const loggedTurnLimitFailure = errorSpy.mock.calls.some((call) =>
      call.some((arg) => String(arg).includes('Grace turn ended without save_plan')),
    );
    expect(loggedTurnLimitFailure).toBe(true);

    errorSpy.mockRestore();
  });

  it('still errors when the grace turn fails to produce a plan', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, parseTaskFile } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Test grace turn that fails',
      acceptanceCriteria: [],
    });

    const subscribers: Array<(event: any) => void> = [];
    let promptCount = 0;
    let abortCalled = false;

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: (listener: (event: any) => void) => {
          subscribers.push(listener);
          return () => {
            const idx = subscribers.indexOf(listener);
            if (idx >= 0) subscribers.splice(idx, 1);
          };
        },
        prompt: vi.fn(async () => {
          promptCount++;
          if (promptCount === 1) {
            for (let i = 0; i <= DEFAULT_PLANNING_GUARDRAILS.maxToolCalls; i++) {
              if (abortCalled) return;
              for (const sub of [...subscribers]) {
                sub({ type: 'tool_execution_end', toolName: 'bash', toolCallId: `call-${i}`, isError: false });
              }
            }
          }
          // promptCount === 2: grace turn — agent does NOT call save_plan
        }),
        abort: vi.fn(async () => {
          abortCalled = true;
        }),
      },
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broadcasts: any[] = [];
    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: (event: any) => broadcasts.push(event),
    });

    expect(result).toBeNull();
    expect(promptCount).toBe(2);
    expect(task.frontmatter.planningStatus).toBe('error');

    const persistedTask = parseTaskFile(task.filePath);
    expect(persistedTask.frontmatter.plan).toBeUndefined();
    expect(persistedTask.frontmatter.planningStatus).toBe('error');

    errorSpy.mockRestore();
  });
});
