import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const createAgentSessionMock = vi.fn();
const sessionManagerCreateMock = vi.fn(() => ({}));
const sessionManagerOpenMock = vi.fn(() => ({}));
const runPrePlanningSkillsMock = vi.fn();
const runPreExecutionSkillsMock = vi.fn();

vi.mock('@mariozechner/pi-coding-agent', () => ({
  createAgentSession: (...args: any[]) => createAgentSessionMock(...args),
  AuthStorage: class AuthStorage {
    static create(): AuthStorage {
      return new AuthStorage();
    }
  },
  DefaultResourceLoader: class DefaultResourceLoader {
    async reload(): Promise<void> {
      // no-op
    }
  },
  ModelRegistry: class ModelRegistry {
    find(provider: string, modelId: string): { provider: string; modelId: string } {
      return { provider, modelId };
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

vi.mock('../src/post-execution-skills.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/post-execution-skills.js')>();
  return {
    ...actual,
    runPrePlanningSkills: (...args: any[]) => runPrePlanningSkillsMock(...args),
    runPreExecutionSkills: (...args: any[]) => runPreExecutionSkillsMock(...args),
    runPostExecutionSkills: vi.fn(async () => undefined),
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

describe('model profile fallback regression', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    mockedFactorySettings = null;
    createAgentSessionMock.mockReset();
    sessionManagerCreateMock.mockClear();
    sessionManagerOpenMock.mockClear();
    runPrePlanningSkillsMock.mockReset();
    runPreExecutionSkillsMock.mockReset();
    runPrePlanningSkillsMock.mockResolvedValue(undefined);
    runPreExecutionSkillsMock.mockResolvedValue(undefined);
    (globalThis as any).__piFactoryPlanCallbacks?.clear?.();
    (globalThis as any).__piFactoryCompleteCallbacks?.clear?.();
    (globalThis as any).__piFactoryAttachFileCallbacks?.clear?.();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();

    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('normalizes + validates fallback arrays in global settings payloads', async () => {
    const { normalizePiFactorySettingsPayload } = await import('../src/workflow-settings-service.js');

    const valid = normalizePiFactorySettingsPayload({
      modelProfiles: [
        {
          id: 'fallback-profile',
          name: 'Fallback Profile',
          planningModelConfig: { provider: 'openai', modelId: 'gpt-primary', thinkingLevel: 'high' },
          executionModelConfig: { provider: 'anthropic', modelId: 'claude-primary', thinkingLevel: 'medium' },
          planningFallbackModels: [
            { provider: 'openai', modelId: 'gpt-fallback-1', thinkingLevel: 'medium' },
            { provider: 'openai', modelId: 'gpt-fallback-2', thinkingLevel: 'low' },
          ],
          executionFallbackModels: [
            { provider: 'anthropic', modelId: 'claude-fallback-1', thinkingLevel: 'medium' },
          ],
        },
      ],
    });

    expect(valid.ok).toBe(true);
    if (!valid.ok) {
      return;
    }

    expect(valid.value.modelProfiles?.[0]).toMatchObject({
      planningFallbackModels: [
        { provider: 'openai', modelId: 'gpt-fallback-1', thinkingLevel: 'medium' },
        { provider: 'openai', modelId: 'gpt-fallback-2', thinkingLevel: 'low' },
      ],
      executionFallbackModels: [
        { provider: 'anthropic', modelId: 'claude-fallback-1', thinkingLevel: 'medium' },
      ],
    });

    const backwardsCompatible = normalizePiFactorySettingsPayload({
      modelProfiles: [
        {
          id: 'legacy-profile',
          name: 'Legacy Profile',
          planningModelConfig: { provider: 'openai', modelId: 'gpt-legacy' },
          executionModelConfig: { provider: 'anthropic', modelId: 'claude-legacy' },
        },
      ],
    });

    expect(backwardsCompatible.ok).toBe(true);
    if (backwardsCompatible.ok) {
      expect(backwardsCompatible.value.modelProfiles?.[0].planningFallbackModels).toBeUndefined();
      expect(backwardsCompatible.value.modelProfiles?.[0].executionFallbackModels).toBeUndefined();
    }

    const emptyArrays = normalizePiFactorySettingsPayload({
      modelProfiles: [
        {
          id: 'empty-arrays',
          name: 'Empty arrays',
          planningModelConfig: { provider: 'openai', modelId: 'gpt-5' },
          executionModelConfig: { provider: 'anthropic', modelId: 'claude-sonnet' },
          planningFallbackModels: [],
          executionFallbackModels: [],
        },
      ],
    });

    expect(emptyArrays.ok).toBe(true);
    if (emptyArrays.ok) {
      expect(emptyArrays.value.modelProfiles?.[0].planningFallbackModels).toBeUndefined();
      expect(emptyArrays.value.modelProfiles?.[0].executionFallbackModels).toBeUndefined();
    }

    const invalid = normalizePiFactorySettingsPayload({
      modelProfiles: [
        {
          id: 'bad-fallback',
          name: 'Bad fallback',
          planningModelConfig: { provider: 'openai', modelId: 'gpt-5' },
          executionModelConfig: { provider: 'anthropic', modelId: 'claude-sonnet' },
          planningFallbackModels: [
            { modelId: 'missing-provider' } as any,
          ],
        },
      ],
    });

    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error).toContain('modelProfiles[0].planningFallbackModels[0].provider');
    }
  });

  it('stores resolved fallback model chains on task creation', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-fallback-create-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask } = await import('../src/task-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Create task with fallback model chains',
      acceptanceCriteria: [],
      planningModelConfig: { provider: 'openai', modelId: 'gpt-primary', thinkingLevel: 'high' },
      executionModelConfig: { provider: 'anthropic', modelId: 'claude-primary', thinkingLevel: 'medium' },
      planningFallbackModels: [
        { provider: 'openai', modelId: 'gpt-fallback-1', thinkingLevel: 'medium' },
      ],
      executionFallbackModels: [
        { provider: 'anthropic', modelId: 'claude-fallback-1', thinkingLevel: 'low' },
        { provider: 'anthropic', modelId: 'claude-fallback-2', thinkingLevel: 'low' },
      ],
    });

    expect(task.frontmatter.planningFallbackModels).toEqual([
      { provider: 'openai', modelId: 'gpt-fallback-1', thinkingLevel: 'medium' },
    ]);

    expect(task.frontmatter.executionFallbackModels).toEqual([
      { provider: 'anthropic', modelId: 'claude-fallback-1', thinkingLevel: 'low' },
      { provider: 'anthropic', modelId: 'claude-fallback-2', thinkingLevel: 'low' },
    ]);
  });

  it('fails over planning model on retryable errors and logs activity', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-fallback-plan-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask } = await import('../src/task-service.js');
    const { planTask, ensurePlanCallbackRegistry } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Test planning failover',
      acceptanceCriteria: [],
      planningModelConfig: { provider: 'openai', modelId: 'gpt-primary', thinkingLevel: 'high' },
      planningFallbackModels: [
        { provider: 'openai', modelId: 'gpt-fallback-1', thinkingLevel: 'medium' },
      ],
      executionModelConfig: { provider: 'anthropic', modelId: 'claude-primary', thinkingLevel: 'medium' },
    });

    createAgentSessionMock
      .mockRejectedValueOnce(new Error('429 rate limit: primary unavailable'))
      .mockResolvedValueOnce({
        session: {
          subscribe: () => () => {},
          prompt: async () => {
            const callback = ensurePlanCallbackRegistry().get(task.id);
            if (!callback) {
              throw new Error('save_plan callback not registered');
            }

            await callback({
              acceptanceCriteria: ['Fallback criterion'],
              plan: {
                goal: 'Fallback planning goal',
                steps: ['Use fallback model'],
                validation: ['Plan was generated'],
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
    expect(createAgentSessionMock).toHaveBeenCalledTimes(2);
    expect(createAgentSessionMock.mock.calls[0]?.[0]?.model).toEqual({
      provider: 'openai',
      modelId: 'gpt-primary',
    });
    expect(createAgentSessionMock.mock.calls[1]?.[0]?.model).toEqual({
      provider: 'openai',
      modelId: 'gpt-fallback-1',
    });

    await vi.waitFor(() => {
      expect(
        broadcasts.some((event) => (
          event.type === 'activity:entry'
          && event.entry?.type === 'system-event'
          && event.entry?.metadata?.kind === 'planning-model-failover'
          && event.entry?.metadata?.fromModelId === 'gpt-primary'
          && event.entry?.metadata?.toModelId === 'gpt-fallback-1'
        )),
      ).toBe(true);
    });
  });

  it('marks planning as error when fallback chain is exhausted', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-fallback-plan-exhaust-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, parseTaskFile } = await import('../src/task-service.js');
    const { planTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Test planning fallback exhaustion',
      acceptanceCriteria: [],
      planningModelConfig: { provider: 'openai', modelId: 'gpt-primary' },
      planningFallbackModels: [
        { provider: 'openai', modelId: 'gpt-fallback-1' },
      ],
      executionModelConfig: { provider: 'anthropic', modelId: 'claude-primary' },
    });

    createAgentSessionMock
      .mockRejectedValueOnce(new Error('503 service unavailable'))
      .mockRejectedValueOnce(new Error('429 rate limit: fallback unavailable'));

    const result = await planTask({
      task,
      workspaceId: 'workspace-test',
      workspacePath,
      broadcastToWorkspace: () => {},
    });

    expect(result).toBeNull();
    expect(createAgentSessionMock).toHaveBeenCalledTimes(2);

    const persistedTask = parseTaskFile(task.filePath);
    expect(persistedTask.frontmatter.planningStatus).toBe('error');
  });

  it('fails over execution model on retryable errors and does not rerun pre-execution skills', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-fallback-exec-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, discoverTasks, moveTaskToPhase } = await import('../src/task-service.js');
    const { executeTask } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Test execution failover',
      acceptanceCriteria: [],
      planningModelConfig: { provider: 'openai', modelId: 'gpt-primary' },
      executionModelConfig: { provider: 'anthropic', modelId: 'claude-primary' },
      executionFallbackModels: [
        { provider: 'anthropic', modelId: 'claude-fallback-1' },
      ],
      preExecutionSkills: ['prep-context'],
    });

    const liveTasks = discoverTasks(tasksDir);
    const liveTask = liveTasks.find((candidate) => candidate.id === task.id);
    if (!liveTask) {
      throw new Error('Live task not found for execution failover test');
    }
    moveTaskToPhase(liveTask, 'executing', 'system', 'Queue manager auto-assigned', liveTasks);

    let firstSubscriber: ((event: any) => void) | undefined;
    let secondSubscriber: ((event: any) => void) | undefined;

    createAgentSessionMock
      .mockResolvedValueOnce({
        session: {
          subscribe: (listener: (event: any) => void) => {
            firstSubscriber = listener;
            return () => {};
          },
          prompt: async () => {
            firstSubscriber?.({
              type: 'message_end',
              message: {
                role: 'assistant',
                stopReason: 'error',
                errorMessage: '429 rate limit: primary execution model overloaded',
                content: [],
              },
            });
          },
          abort: async () => {},
        },
      })
      .mockResolvedValueOnce({
        session: {
          subscribe: (listener: (event: any) => void) => {
            secondSubscriber = listener;
            return () => {};
          },
          prompt: async () => {
            secondSubscriber?.({
              type: 'message_end',
              message: {
                role: 'assistant',
                stopReason: 'end_turn',
                content: [{ type: 'text', text: 'fallback response' }],
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
      expect(createAgentSessionMock).toHaveBeenCalledTimes(2);
      expect(
        broadcasts.some((event) => (
          event.type === 'activity:entry'
          && event.entry?.type === 'system-event'
          && event.entry?.metadata?.kind === 'execution-model-failover'
          && event.entry?.metadata?.fromModelId === 'claude-primary'
          && event.entry?.metadata?.toModelId === 'claude-fallback-1'
        )),
      ).toBe(true);
    });

    expect(runPreExecutionSkillsMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces final retryable error when execution fallback chain is exhausted', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pi-factory-fallback-exec-exhaust-'));
    tempDirs.push(workspacePath);

    const tasksDir = join(workspacePath, '.pi', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const { createTask, discoverTasks, moveTaskToPhase } = await import('../src/task-service.js');
    const { executeTask, getActiveSession } = await import('../src/agent-execution-service.js');

    const task = createTask(workspacePath, tasksDir, {
      content: 'Test execution fallback exhaustion',
      acceptanceCriteria: [],
      planningModelConfig: { provider: 'openai', modelId: 'gpt-primary' },
      executionModelConfig: { provider: 'anthropic', modelId: 'claude-primary' },
      executionFallbackModels: [
        { provider: 'anthropic', modelId: 'claude-fallback-1' },
      ],
    });

    const liveTasks = discoverTasks(tasksDir);
    const liveTask = liveTasks.find((candidate) => candidate.id === task.id);
    if (!liveTask) {
      throw new Error('Live task not found for execution exhaustion test');
    }
    moveTaskToPhase(liveTask, 'executing', 'system', 'Queue manager auto-assigned', liveTasks);

    let firstSubscriber: ((event: any) => void) | undefined;
    let secondSubscriber: ((event: any) => void) | undefined;

    createAgentSessionMock
      .mockResolvedValueOnce({
        session: {
          subscribe: (listener: (event: any) => void) => {
            firstSubscriber = listener;
            return () => {};
          },
          prompt: async () => {
            firstSubscriber?.({
              type: 'message_end',
              message: {
                role: 'assistant',
                stopReason: 'error',
                errorMessage: '503 service unavailable: primary down',
                content: [],
              },
            });
          },
          abort: async () => {},
        },
      })
      .mockResolvedValueOnce({
        session: {
          subscribe: (listener: (event: any) => void) => {
            secondSubscriber = listener;
            return () => {};
          },
          prompt: async () => {
            secondSubscriber?.({
              type: 'message_end',
              message: {
                role: 'assistant',
                stopReason: 'error',
                errorMessage: '529 overloaded: fallback down',
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
          && event.entry?.metadata?.kind === 'execution-model-failover'
        )),
      ).toBe(true);

      expect(
        broadcasts.some((event) => (
          event.type === 'activity:entry'
          && event.entry?.type === 'system-event'
          && typeof event.entry?.message === 'string'
          && event.entry.message.includes('Agent turn failed:')
          && event.entry.message.includes('529 overloaded: fallback down')
        )),
      ).toBe(true);
    });

    expect(getActiveSession(task.id)?.awaitingUserInput).toBe(true);
  });
});
