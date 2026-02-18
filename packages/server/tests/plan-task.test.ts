import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DEFAULT_PLANNING_GUARDRAILS } from '@task-factory/shared';

const createAgentSessionMock = vi.fn();
const sessionManagerCreateMock = vi.fn(() => ({}));
const sessionManagerOpenMock = vi.fn(() => ({}));
const withTimeoutMock = vi.fn();
const requestQueueKickMock = vi.fn();
const runPrePlanningSkillsMock = vi.fn();

vi.mock('@mariozechner/pi-coding-agent', () => ({
  createAgentSession: (...args: any[]) => createAgentSessionMock(...args),
  AuthStorage: class AuthStorage {
    static create(): AuthStorage {
      return new AuthStorage();
    }
  },
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
  createSystemEvent: vi.fn(async (
    workspaceId: string,
    taskId: string,
    event: string,
    message: string,
    metadata?: Record<string, unknown>,
  ) => ({
    type: 'system-event',
    id: crypto.randomUUID(),
    taskId,
    event,
    message,
    timestamp: new Date().toISOString(),
    workspaceId,
    metadata,
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

vi.mock('../src/queue-kick-coordinator.js', () => ({
  requestQueueKick: (...args: any[]) => requestQueueKickMock(...args),
}));

vi.mock('../src/post-execution-skills.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/post-execution-skills.js')>();
  return {
    ...actual,
    runPrePlanningSkills: (...args: any[]) => runPrePlanningSkillsMock(...args),
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
    requestQueueKickMock.mockReset();
    runPrePlanningSkillsMock.mockReset();
    runPrePlanningSkillsMock.mockResolvedValue(undefined);
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

  it('runs configured pre-planning skills before the planning prompt', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Run pre-planning hooks before planning prompt',
      acceptanceCriteria: [],
      prePlanningSkills: ['plan-context'],
    });

    let prePlanningRan = false;
    runPrePlanningSkillsMock.mockImplementation(async () => {
      prePlanningRan = true;
    });

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: () => () => {},
        prompt: async () => {
          expect(prePlanningRan).toBe(true);

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

    const broadcasts: any[] = [];
    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: (event: any) => broadcasts.push(event),
    });

    expect(result).not.toBeNull();
    expect(runPrePlanningSkillsMock).toHaveBeenCalledWith(
      expect.any(Object),
      ['plan-context'],
      expect.objectContaining({
        taskId: task.id,
        workspaceId: 'workspace-test',
      }),
    );

    const statusEvents = broadcasts.filter((event) => event.type === 'agent:execution_status');
    expect(statusEvents.some((event: any) => event.status === 'pre-planning-hooks')).toBe(true);
  });

  it('fails planning and skips the planning prompt when a pre-planning hook fails', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, parseTaskFile } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Pre-planning hook failure should stop planning prompt',
      acceptanceCriteria: [],
      prePlanningSkills: ['plan-context'],
    });

    runPrePlanningSkillsMock.mockRejectedValue(new Error('pre-planning boom'));

    const promptSpy = vi.fn(async () => {});

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: () => () => {},
        prompt: promptSpy,
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

    expect(result).toBeNull();
    expect(promptSpy).not.toHaveBeenCalled();
    expect(task.frontmatter.plan).toBeUndefined();
    expect(task.frontmatter.planningStatus).toBe('error');

    const persistedTask = parseTaskFile(task.filePath);
    expect(persistedTask.frontmatter.planningStatus).toBe('error');

    const statusEvents = broadcasts.filter((event) => event.type === 'agent:execution_status');
    expect(statusEvents.at(-1)).toMatchObject({
      taskId: task.id,
      status: 'error',
    });
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

  it('does not clear a newer execution session when planning cleanup runs', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, discoverTasks, moveTaskToPhase } = await import('../src/task-service.js');
    const {
      executeTask,
      getActiveSession,
      hasRunningSession,
      planTask,
      stopTaskExecution,
    } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Keep execution session alive when planning session tears down',
      acceptanceCriteria: [],
    });

    let releasePlanningPrompt: (() => void) | undefined;
    const planningPromptBlock = new Promise<void>((resolve) => {
      releasePlanningPrompt = resolve;
    });

    createAgentSessionMock.mockResolvedValueOnce({
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

          await planningPromptBlock;
        },
        abort: async () => {},
      },
    });

    createAgentSessionMock.mockResolvedValueOnce({
      session: {
        subscribe: () => () => {},
        prompt: async () => {},
        abort: async () => {},
      },
    });

    const planningPromise = planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: () => {},
    });

    await vi.waitFor(() => {
      expect(task.frontmatter.plan).toBeDefined();
    });

    const liveTasks = discoverTasks(tasksDir);
    const liveTask = liveTasks.find((candidate) => candidate.id === task.id);
    if (!liveTask) {
      throw new Error('Live task not found while setting up execution handoff');
    }

    moveTaskToPhase(liveTask, 'executing', 'system', 'Queue manager auto-assigned', liveTasks);

    const executionSession = await executeTask({
      task: liveTask,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: () => {},
    });

    expect(getActiveSession(task.id)?.id).toBe(executionSession.id);

    releasePlanningPrompt?.();

    const result = await planningPromise;
    expect(result).not.toBeNull();

    expect(getActiveSession(task.id)?.id).toBe(executionSession.id);
    expect(hasRunningSession(task.id)).toBe(true);

    await stopTaskExecution(task.id);
  });

  it('surfaces provider quota/rate-limit errors in the task activity log', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, discoverTasks, moveTaskToPhase } = await import('../src/task-service.js');
    const { executeTask, getActiveSession } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Surface provider failures in activity log',
      acceptanceCriteria: [],
    });

    const liveTasks = discoverTasks(tasksDir);
    const liveTask = liveTasks.find((candidate) => candidate.id === task.id);
    if (!liveTask) {
      throw new Error('Live task not found for execution test');
    }

    moveTaskToPhase(liveTask, 'executing', 'system', 'Queue manager auto-assigned', liveTasks);

    let subscriber: ((event: any) => void) | undefined;
    const providerError = 'You have hit your ChatGPT usage limit (plus plan). Try again in ~90 min.';

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
              stopReason: 'error',
              errorMessage: providerError,
              content: [],
            },
          });
        },
        abort: async () => {},
      },
    });

    const broadcasts: any[] = [];

    await executeTask({
      task: liveTask,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: (event: any) => broadcasts.push(event),
    });

    await vi.waitFor(() => {
      expect(
        broadcasts.some((event) => (
          event.type === 'activity:entry'
          && event.entry?.type === 'system-event'
          && typeof event.entry?.message === 'string'
          && event.entry.message.includes('Agent turn failed:')
          && event.entry.message.includes('ChatGPT usage limit')
        )),
      ).toBe(true);
    });

    expect(getActiveSession(task.id)?.awaitingUserInput).toBe(true);
  });

  it('surfaces provider auto-retry notices in the task activity log', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, discoverTasks, moveTaskToPhase } = await import('../src/task-service.js');
    const { executeTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Surface provider retry notices in activity log',
      acceptanceCriteria: [],
    });

    const liveTasks = discoverTasks(tasksDir);
    const liveTask = liveTasks.find((candidate) => candidate.id === task.id);
    if (!liveTask) {
      throw new Error('Live task not found for retry-notice test');
    }

    moveTaskToPhase(liveTask, 'executing', 'system', 'Queue manager auto-assigned', liveTasks);

    let subscriber: ((event: any) => void) | undefined;

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: (listener: (event: any) => void) => {
          subscriber = listener;
          return () => {};
        },
        prompt: async () => {
          subscriber?.({
            type: 'auto_retry_start',
            attempt: 1,
            maxAttempts: 3,
            delayMs: 2000,
            errorMessage: '429 rate limit: too many requests',
          });

          subscriber?.({
            type: 'auto_retry_end',
            success: true,
            attempt: 2,
          });

          subscriber?.({
            type: 'message_end',
            message: {
              role: 'assistant',
              stopReason: 'stop',
              content: [{ type: 'text', text: 'Recovered after retry.' }],
            },
          });
        },
        abort: async () => {},
      },
    });

    const broadcasts: any[] = [];

    await executeTask({
      task: liveTask,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: (event: any) => broadcasts.push(event),
    });

    await vi.waitFor(() => {
      expect(
        broadcasts.some((event) => (
          event.type === 'activity:entry'
          && event.entry?.type === 'system-event'
          && typeof event.entry?.message === 'string'
          && event.entry.message.includes('Retrying after provider error')
        )),
      ).toBe(true);
    });

    expect(
      broadcasts.some((event) => (
        event.type === 'activity:entry'
        && event.entry?.type === 'system-event'
        && typeof event.entry?.message === 'string'
        && event.entry.message.includes('Retry succeeded on attempt 2')
      )),
    ).toBe(true);

    const reliabilityEntries = broadcasts.filter((event) => (
      event.type === 'activity:entry'
      && event.entry?.type === 'system-event'
      && event.entry?.metadata?.kind === 'execution-reliability'
      && String(event.entry?.metadata?.signal).startsWith('provider_retry_')
    ));

    expect(reliabilityEntries.some((event) => event.entry.metadata.signal === 'provider_retry_start')).toBe(true);
    expect(
      reliabilityEntries.some((event) => (
        event.entry.metadata.signal === 'provider_retry_end'
        && event.entry.metadata.outcome === 'success'
      )),
    ).toBe(true);
  });

  it('emits queryable execution reliability turn telemetry for start, first token, and turn end', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, discoverTasks, moveTaskToPhase } = await import('../src/task-service.js');
    const { executeTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Emit reliability turn telemetry',
      acceptanceCriteria: [],
    });

    const liveTasks = discoverTasks(tasksDir);
    const liveTask = liveTasks.find((candidate) => candidate.id === task.id);
    if (!liveTask) {
      throw new Error('Live task not found for reliability telemetry test');
    }

    moveTaskToPhase(liveTask, 'executing', 'system', 'Queue manager auto-assigned', liveTasks);

    let subscriber: ((event: any) => void) | undefined;

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: (listener: (event: any) => void) => {
          subscriber = listener;
          return () => {};
        },
        prompt: async () => {
          subscriber?.({ type: 'agent_start' });
          subscriber?.({
            type: 'message_start',
            message: { role: 'assistant', content: [] },
          });
          subscriber?.({
            type: 'message_update',
            message: { role: 'assistant' },
            assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
          });
          subscriber?.({
            type: 'message_end',
            message: {
              role: 'assistant',
              stopReason: 'stop',
              content: [{ type: 'text', text: 'hello' }],
            },
          });
          subscriber?.({
            type: 'turn_end',
            message: { role: 'assistant', stopReason: 'stop' },
            toolResults: [],
          });
        },
        abort: async () => {},
      },
    });

    const broadcasts: any[] = [];

    await executeTask({
      task: liveTask,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: (event: any) => broadcasts.push(event),
    });

    await vi.waitFor(() => {
      expect(
        broadcasts.some((event) => (
          event.type === 'activity:entry'
          && event.entry?.type === 'system-event'
          && event.entry?.metadata?.kind === 'execution-reliability'
          && event.entry?.metadata?.signal === 'turn_end'
        )),
      ).toBe(true);
    });

    const reliabilityEntries = broadcasts.filter((event) => (
      event.type === 'activity:entry'
      && event.entry?.type === 'system-event'
      && event.entry?.metadata?.kind === 'execution-reliability'
      && event.entry?.taskId === task.id
    ));

    const turnStart = reliabilityEntries.find((event) => event.entry.metadata.signal === 'turn_start');
    const firstToken = reliabilityEntries.find((event) => event.entry.metadata.signal === 'first_token');
    const turnEnd = reliabilityEntries.find((event) => event.entry.metadata.signal === 'turn_end');

    expect(turnStart).toBeDefined();
    expect(firstToken).toBeDefined();
    expect(turnEnd).toBeDefined();

    expect(turnStart.entry.metadata).toMatchObject({
      kind: 'execution-reliability',
      signal: 'turn_start',
      eventType: 'turn',
      outcome: 'started',
      sessionId: expect.any(String),
      turnId: expect.any(String),
      turnNumber: 1,
    });

    expect(firstToken.entry.metadata).toMatchObject({
      kind: 'execution-reliability',
      signal: 'first_token',
      eventType: 'turn',
      outcome: 'observed',
      sessionId: expect.any(String),
      turnId: expect.any(String),
      turnNumber: 1,
    });
    expect(firstToken.entry.metadata.timeToFirstTokenMs).toEqual(expect.any(Number));

    expect(turnEnd.entry.metadata).toMatchObject({
      kind: 'execution-reliability',
      signal: 'turn_end',
      eventType: 'turn',
      outcome: 'success',
      sessionId: expect.any(String),
      turnId: expect.any(String),
      turnNumber: 1,
    });
    expect(turnEnd.entry.metadata.durationMs).toEqual(expect.any(Number));
  });

  it('emits queryable compaction reliability outcomes in task activity telemetry', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, discoverTasks, moveTaskToPhase } = await import('../src/task-service.js');
    const { executeTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Emit compaction telemetry outcomes',
      acceptanceCriteria: [],
    });

    const liveTasks = discoverTasks(tasksDir);
    const liveTask = liveTasks.find((candidate) => candidate.id === task.id);
    if (!liveTask) {
      throw new Error('Live task not found for compaction telemetry test');
    }

    moveTaskToPhase(liveTask, 'executing', 'system', 'Queue manager auto-assigned', liveTasks);

    let subscriber: ((event: any) => void) | undefined;

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: (listener: (event: any) => void) => {
          subscriber = listener;
          return () => {};
        },
        prompt: async () => {
          subscriber?.({
            type: 'auto_compaction_end',
            aborted: true,
            willRetry: false,
            errorMessage: 'context overflow',
          });

          subscriber?.({
            type: 'message_end',
            message: {
              role: 'assistant',
              stopReason: 'stop',
              content: [{ type: 'text', text: 'done' }],
            },
          });
        },
        abort: async () => {},
      },
    });

    const broadcasts: any[] = [];

    await executeTask({
      task: liveTask,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: (event: any) => broadcasts.push(event),
    });

    await vi.waitFor(() => {
      expect(
        broadcasts.some((event) => (
          event.type === 'activity:entry'
          && event.entry?.type === 'system-event'
          && event.entry?.metadata?.kind === 'execution-reliability'
          && event.entry?.metadata?.signal === 'compaction_end'
        )),
      ).toBe(true);
    });

    const compactionTelemetry = broadcasts.find((event) => (
      event.type === 'activity:entry'
      && event.entry?.type === 'system-event'
      && event.entry?.metadata?.kind === 'execution-reliability'
      && event.entry?.metadata?.signal === 'compaction_end'
    ));

    expect(compactionTelemetry?.entry?.metadata).toMatchObject({
      kind: 'execution-reliability',
      signal: 'compaction_end',
      eventType: 'compaction',
      outcome: 'failed',
      aborted: true,
      willRetry: false,
      sessionId: expect.any(String),
    });
    expect(compactionTelemetry?.entry?.metadata?.errorMessage).toContain('context overflow');
  });

  it('surfaces a stall notice and clears the active session when no follow-up arrives after a tool result', async () => {
    vi.useFakeTimers();

    try {
      const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
      tempDirs.push(workspacePath);

      const tasksDir = join(workspacePath, '.pi', 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      const { createTask, discoverTasks, moveTaskToPhase } = await import('../src/task-service.js');
      const { executeTask, getActiveSession } = await import('../src/agent-execution-service.js');

      const task = createTask(workspacePath, tasksDir, {
        content: 'Detect and recover from post-tool stalls',
        acceptanceCriteria: [],
      });

      const liveTasks = discoverTasks(tasksDir);
      const liveTask = liveTasks.find((candidate) => candidate.id === task.id);
      if (!liveTask) {
        throw new Error('Live task not found for stall watchdog test');
      }

      moveTaskToPhase(liveTask, 'executing', 'system', 'Queue manager auto-assigned', liveTasks);

      let subscriber: ((event: any) => void) | undefined;
      let rejectPrompt: ((err: unknown) => void) | undefined;

      createAgentSessionMock.mockResolvedValue({
        session: {
          subscribe: (listener: (event: any) => void) => {
            subscriber = listener;
            return () => {};
          },
          prompt: async () => {
            subscriber?.({
              type: 'tool_execution_start',
              toolName: 'read',
              toolCallId: 'call-stall',
              args: { path: 'README.md' },
            });

            subscriber?.({
              type: 'tool_execution_end',
              toolName: 'read',
              toolCallId: 'call-stall',
              isError: false,
              result: {
                content: [{ type: 'text', text: 'done' }],
              },
            });

            await new Promise<void>((_resolve, reject) => {
              rejectPrompt = reject;
            });
          },
          abort: async () => {
            if (rejectPrompt) {
              rejectPrompt(new Error('aborted'));
              rejectPrompt = undefined;
            }
          },
        },
      });

      const broadcasts: any[] = [];

      await executeTask({
        task: liveTask,
        workspaceId: 'workspace-test',
        workspacePath,
        broadcastToWorkspace: (event: any) => broadcasts.push(event),
      });

      expect(getActiveSession(task.id)).toBeDefined();

      await vi.advanceTimersByTimeAsync(125_000);

      await vi.waitFor(() => {
        expect(getActiveSession(task.id)).toBeUndefined();
      });

      expect(
        broadcasts.some((event) => (
          event.type === 'activity:entry'
          && event.entry?.type === 'system-event'
          && typeof event.entry?.message === 'string'
          && event.entry.message.includes('Agent appears stuck after tool "read"')
        )),
      ).toBe(true);

      expect(
        broadcasts.some((event) => (
          event.type === 'agent:execution_status'
          && event.taskId === task.id
          && event.status === 'idle'
        )),
      ).toBe(true);

      const stallTelemetry = broadcasts.find((event) => (
        event.type === 'activity:entry'
        && event.entry?.type === 'system-event'
        && event.entry?.metadata?.kind === 'execution-reliability'
        && event.entry?.metadata?.signal === 'turn_stall_recovered'
      ));

      expect(stallTelemetry?.entry?.metadata).toMatchObject({
        kind: 'execution-reliability',
        signal: 'turn_stall_recovered',
        eventType: 'turn',
        outcome: 'recovered',
        stallPhase: 'post-tool',
      });

      const stallTurnEnds = broadcasts.filter((event) => (
        event.type === 'activity:entry'
        && event.entry?.type === 'system-event'
        && event.entry?.metadata?.kind === 'execution-reliability'
        && event.entry?.metadata?.signal === 'turn_end'
        && event.entry?.metadata?.outcome === 'watchdog_recovered'
      ));
      expect(stallTurnEnds.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovers when prompt starts but no SDK events are emitted', async () => {
    vi.useFakeTimers();

    try {
      const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
      tempDirs.push(workspacePath);

      const tasksDir = join(workspacePath, '.pi', 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      const { createTask, discoverTasks, moveTaskToPhase } = await import('../src/task-service.js');
      const { executeTask, getActiveSession } = await import('../src/agent-execution-service.js');

      const task = createTask(workspacePath, tasksDir, {
        content: 'Recover when execution prompt emits no events',
        acceptanceCriteria: [],
      });

      const liveTasks = discoverTasks(tasksDir);
      const liveTask = liveTasks.find((candidate) => candidate.id === task.id);
      if (!liveTask) {
        throw new Error('Live task not found for no-first-event watchdog test');
      }

      moveTaskToPhase(liveTask, 'executing', 'system', 'Queue manager auto-assigned', liveTasks);

      let rejectPrompt: ((err: unknown) => void) | undefined;

      createAgentSessionMock.mockResolvedValue({
        session: {
          subscribe: () => () => {},
          prompt: async () => {
            await new Promise<void>((_resolve, reject) => {
              rejectPrompt = reject;
            });
          },
          abort: async () => {
            if (rejectPrompt) {
              rejectPrompt(new Error('aborted'));
              rejectPrompt = undefined;
            }
          },
        },
      });

      const broadcasts: any[] = [];

      await executeTask({
        task: liveTask,
        workspaceId: 'workspace-test',
        workspacePath,
        broadcastToWorkspace: (event: any) => broadcasts.push(event),
      });

      expect(getActiveSession(task.id)).toBeDefined();

      await vi.advanceTimersByTimeAsync(25_000);

      await vi.waitFor(() => {
        expect(getActiveSession(task.id)).toBeUndefined();
      });

      expect(
        broadcasts.some((event) => (
          event.type === 'activity:entry'
          && event.entry?.type === 'system-event'
          && typeof event.entry?.message === 'string'
          && event.entry.message.includes('did not emit any turn events')
        )),
      ).toBe(true);

      const terminalEvents = broadcasts.filter((event) => event.type === 'agent:turn_end' && event.taskId === task.id);
      expect(terminalEvents.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovers when a tool starts but never emits tool_execution_end', async () => {
    vi.useFakeTimers();

    try {
      const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
      tempDirs.push(workspacePath);

      const tasksDir = join(workspacePath, '.pi', 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      const { createTask, discoverTasks, moveTaskToPhase } = await import('../src/task-service.js');
      const { executeTask, getActiveSession } = await import('../src/agent-execution-service.js');

      const task = createTask(workspacePath, tasksDir, {
        content: 'Recover when tool start has no matching end',
        acceptanceCriteria: [],
      });

      const liveTasks = discoverTasks(tasksDir);
      const liveTask = liveTasks.find((candidate) => candidate.id === task.id);
      if (!liveTask) {
        throw new Error('Live task not found for tool-execution watchdog test');
      }

      moveTaskToPhase(liveTask, 'executing', 'system', 'Queue manager auto-assigned', liveTasks);

      let subscriber: ((event: any) => void) | undefined;
      let rejectPrompt: ((err: unknown) => void) | undefined;

      createAgentSessionMock.mockResolvedValue({
        session: {
          subscribe: (listener: (event: any) => void) => {
            subscriber = listener;
            return () => {};
          },
          prompt: async () => {
            subscriber?.({
              type: 'tool_execution_start',
              toolName: 'bash',
              toolCallId: 'call-no-end',
              args: { command: 'echo hi' },
            });

            await new Promise<void>((_resolve, reject) => {
              rejectPrompt = reject;
            });
          },
          abort: async () => {
            if (rejectPrompt) {
              rejectPrompt(new Error('aborted'));
              rejectPrompt = undefined;
            }
          },
        },
      });

      const broadcasts: any[] = [];

      await executeTask({
        task: liveTask,
        workspaceId: 'workspace-test',
        workspacePath,
        broadcastToWorkspace: (event: any) => broadcasts.push(event),
      });

      expect(getActiveSession(task.id)).toBeDefined();

      await vi.advanceTimersByTimeAsync(125_000);

      await vi.waitFor(() => {
        expect(getActiveSession(task.id)).toBeUndefined();
      });

      expect(
        broadcasts.some((event) => (
          event.type === 'activity:entry'
          && event.entry?.type === 'system-event'
          && typeof event.entry?.message === 'string'
          && event.entry.message.includes('stuck while running tool "bash"')
        )),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovers from silent streaming and ignores late stale events without duplicate terminal events', async () => {
    vi.useFakeTimers();

    try {
      const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
      tempDirs.push(workspacePath);

      const tasksDir = join(workspacePath, '.pi', 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      const { createTask, discoverTasks, moveTaskToPhase } = await import('../src/task-service.js');
      const { executeTask, getActiveSession } = await import('../src/agent-execution-service.js');

      const task = createTask(workspacePath, tasksDir, {
        content: 'Recover when assistant streaming goes silent',
        acceptanceCriteria: [],
      });

      const liveTasks = discoverTasks(tasksDir);
      const liveTask = liveTasks.find((candidate) => candidate.id === task.id);
      if (!liveTask) {
        throw new Error('Live task not found for stream-silence watchdog test');
      }

      moveTaskToPhase(liveTask, 'executing', 'system', 'Queue manager auto-assigned', liveTasks);

      let subscriber: ((event: any) => void) | undefined;
      let rejectPrompt: ((err: unknown) => void) | undefined;

      createAgentSessionMock.mockResolvedValue({
        session: {
          subscribe: (listener: (event: any) => void) => {
            subscriber = listener;
            return () => {};
          },
          prompt: async () => {
            subscriber?.({
              type: 'message_start',
              message: { role: 'assistant', content: [] },
            });

            subscriber?.({
              type: 'message_update',
              message: { role: 'assistant' },
              assistantMessageEvent: { type: 'thinking_delta', delta: 'Thinking...' },
            });

            await new Promise<void>((_resolve, reject) => {
              rejectPrompt = reject;
            });
          },
          abort: async () => {
            if (rejectPrompt) {
              rejectPrompt(new Error('aborted'));
              rejectPrompt = undefined;
            }
          },
        },
      });

      const broadcasts: any[] = [];

      await executeTask({
        task: liveTask,
        workspaceId: 'workspace-test',
        workspacePath,
        broadcastToWorkspace: (event: any) => broadcasts.push(event),
      });

      expect(getActiveSession(task.id)).toBeDefined();

      await vi.advanceTimersByTimeAsync(65_000);

      await vi.waitFor(() => {
        expect(getActiveSession(task.id)).toBeUndefined();
      });

      // Simulate late events from the old session; these must be ignored.
      subscriber?.({
        type: 'turn_end',
        message: { role: 'assistant', stopReason: 'stop' },
        toolResults: [],
      });
      subscriber?.({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: [{ type: 'text', text: 'late stale event' }],
        },
      });

      await vi.advanceTimersByTimeAsync(0);

      const stallNotices = broadcasts.filter((event) => (
        event.type === 'activity:entry'
        && event.entry?.type === 'system-event'
        && typeof event.entry?.message === 'string'
        && event.entry.message.includes('silent during response streaming')
      ));
      expect(stallNotices.length).toBe(1);

      const turnEndEvents = broadcasts.filter((event) => event.type === 'agent:turn_end' && event.taskId === task.id);
      expect(turnEndEvents.length).toBe(1);

      const lateEchoes = broadcasts.filter((event) => (
        event.type === 'activity:entry'
        && event.entry?.type === 'chat-message'
        && typeof event.entry?.content === 'string'
        && event.entry.content.includes('late stale event')
      ));
      expect(lateEchoes.length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovers when a turn exceeds the max duration despite periodic assistant updates', async () => {
    vi.useFakeTimers();

    try {
      const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
      tempDirs.push(workspacePath);

      const tasksDir = join(workspacePath, '.pi', 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      const { createTask, discoverTasks, moveTaskToPhase } = await import('../src/task-service.js');
      const { executeTask, getActiveSession } = await import('../src/agent-execution-service.js');

      const task = createTask(workspacePath, tasksDir, {
        content: 'Recover when execution turn exceeds max duration watchdog',
        acceptanceCriteria: [],
      });

      const liveTasks = discoverTasks(tasksDir);
      const liveTask = liveTasks.find((candidate) => candidate.id === task.id);
      if (!liveTask) {
        throw new Error('Live task not found for max-turn watchdog test');
      }

      moveTaskToPhase(liveTask, 'executing', 'system', 'Queue manager auto-assigned', liveTasks);

      let subscriber: ((event: any) => void) | undefined;
      let rejectPrompt: ((err: unknown) => void) | undefined;

      createAgentSessionMock.mockResolvedValue({
        session: {
          subscribe: (listener: (event: any) => void) => {
            subscriber = listener;
            return () => {};
          },
          prompt: async () => {
            subscriber?.({ type: 'agent_start' });
            subscriber?.({
              type: 'message_start',
              message: { role: 'assistant', content: [] },
            });

            const heartbeat = setInterval(() => {
              subscriber?.({
                type: 'message_update',
                message: { role: 'assistant' },
                assistantMessageEvent: { type: 'thinking_delta', delta: '…' },
              });
            }, 30_000);

            await new Promise<void>((_resolve, reject) => {
              rejectPrompt = (err) => {
                clearInterval(heartbeat);
                reject(err);
              };
            });
          },
          abort: async () => {
            if (rejectPrompt) {
              rejectPrompt(new Error('aborted'));
              rejectPrompt = undefined;
            }
          },
        },
      });

      const broadcasts: any[] = [];

      await executeTask({
        task: liveTask,
        workspaceId: 'workspace-test',
        workspacePath,
        broadcastToWorkspace: (event: any) => broadcasts.push(event),
      });

      expect(getActiveSession(task.id)).toBeDefined();

      await vi.advanceTimersByTimeAsync(605_000);

      await vi.waitFor(() => {
        expect(getActiveSession(task.id)).toBeUndefined();
      });

      expect(
        broadcasts.some((event) => (
          event.type === 'activity:entry'
          && event.entry?.type === 'system-event'
          && typeof event.entry?.message === 'string'
          && event.entry.message.includes('exceeded max turn duration')
        )),
      ).toBe(true);

      const turnEndEvents = broadcasts.filter((event) => event.type === 'agent:turn_end' && event.taskId === task.id);
      expect(turnEndEvents.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
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
    expect(requestQueueKickMock).toHaveBeenCalledWith('workspace-test');
  });

  it('auto-promotes when backlog automation is enabled while planning is already running', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const piDir = join(workspacePath, '.pi');
    const tasksDir = join(piDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const factoryConfigPath = join(piDir, 'factory.json');

    writeFileSync(
      factoryConfigPath,
      JSON.stringify({
        taskLocations: ['.pi/tasks'],
        defaultTaskLocation: '.pi/tasks',
        wipLimits: {},
        queueProcessing: { enabled: false },
        workflowAutomation: {
          backlogToReady: false,
          readyToExecuting: false,
        },
      }),
      'utf-8',
    );

    const { createTask, parseTaskFile } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Enable backlog automation while planning is in progress',
      acceptanceCriteria: [],
    });

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: () => () => {},
        prompt: async () => {
          const runningTask = parseTaskFile(task.filePath);
          expect(runningTask.frontmatter.planningStatus).toBe('running');

          writeFileSync(
            factoryConfigPath,
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

          const callback = (globalThis as any).__piFactoryPlanCallbacks?.get(task.id);
          if (!callback) {
            throw new Error('save_plan callback not registered');
          }

          callback({
            acceptanceCriteria: ['Task is planned after toggle'],
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

    expect(
      broadcasts.some((event) => (
        event.type === 'task:moved'
        && event.task?.id === task.id
        && event.from === 'backlog'
        && event.to === 'ready'
      )),
    ).toBe(true);
  });

  it('auto-promotes backlog tasks using active workspace settings even when task workspace metadata is empty', async () => {
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

    const { createTask, parseTaskFile, saveTaskFile } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Legacy task missing workspace metadata should still auto-promote',
      acceptanceCriteria: [],
    });

    task.frontmatter.workspace = '';
    saveTaskFile(task);

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

  it('does not recreate a task deleted while planning is running', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-plan-task-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, deleteTask, discoverTasks } = await import('../src/task-service.js');
    const { planTask, stopTaskExecution, getActiveSession } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Delete this task while planning is running',
      acceptanceCriteria: [],
    });

    let rejectPrompt: ((err?: unknown) => void) | null = null;

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: () => () => {},
        prompt: () => new Promise<void>((_, reject) => {
          rejectPrompt = reject;
        }),
        abort: async () => {
          rejectPrompt?.(new Error('aborted'));
        },
      },
    });

    const planningPromise = planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: () => {},
    });

    await vi.waitFor(() => {
      expect(getActiveSession(task.id)).toBeTruthy();
    });

    deleteTask(task);
    const stopped = await stopTaskExecution(task.id);
    expect(stopped).toBe(true);

    const result = await planningPromise;
    expect(result).toBeNull();

    expect(existsSync(task.filePath)).toBe(false);
    expect(discoverTasks(tasksDir).find((candidate) => candidate.id === task.id)).toBeUndefined();
  });
});
