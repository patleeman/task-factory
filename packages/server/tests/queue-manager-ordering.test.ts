import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateWorkspaceConfigMock = vi.fn();
const getWorkspaceByIdMock = vi.fn();
const listWorkspacesMock = vi.fn();
const discoverTasksMock = vi.fn();
const moveTaskToPhaseMock = vi.fn();
const executeTaskMock = vi.fn();
const hasRunningSessionMock = vi.fn(() => false);
const hasLiveExecutionSessionMock = vi.fn(() => false);
const stopTaskExecutionMock = vi.fn(async () => false);
const loadGlobalWorkflowSettingsMock = vi.fn(() => ({
  readyLimit: 25,
  executingLimit: 1,
  backlogToReady: false,
  readyToExecuting: true,
}));

vi.mock('../src/workspace-service.js', () => ({
  getWorkspaceById: (...args: any[]) => getWorkspaceByIdMock(...args),
  getTasksDir: () => '/tmp/tasks',
  listWorkspaces: (...args: any[]) => listWorkspacesMock(...args),
  updateWorkspaceConfig: (...args: any[]) => updateWorkspaceConfigMock(...args),
}));

vi.mock('../src/task-service.js', () => ({
  discoverTasks: (...args: any[]) => discoverTasksMock(...args),
  moveTaskToPhase: (...args: any[]) => moveTaskToPhaseMock(...args),
}));

vi.mock('../src/agent-execution-service.js', () => ({
  executeTask: (...args: any[]) => executeTaskMock(...args),
  hasRunningSession: (...args: any[]) => hasRunningSessionMock(...args),
  hasLiveExecutionSession: (...args: any[]) => hasLiveExecutionSessionMock(...args),
  stopTaskExecution: (...args: any[]) => stopTaskExecutionMock(...args),
}));

vi.mock('../src/activity-service.js', () => ({
  createSystemEvent: vi.fn(async () => undefined),
}));

vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../src/state-transition.js', () => ({
  logTaskStateTransition: vi.fn(async () => undefined),
}));

vi.mock('../src/state-contract.js', () => ({
  buildTaskStateSnapshot: vi.fn(() => ({})),
}));

vi.mock('../src/workflow-settings-service.js', () => ({
  loadGlobalWorkflowSettings: (...args: any[]) => loadGlobalWorkflowSettingsMock(...args),
}));

function createWorkspace(executingWipLimit = 1) {
  return {
    id: 'workspace-1',
    name: 'workspace',
    path: '/tmp/workspace',
    createdAt: '',
    updatedAt: '',
    config: {
      taskLocations: ['.pi/tasks'],
      defaultTaskLocation: '.pi/tasks',
      wipLimits: {
        executing: executingWipLimit,
      },
      workflowAutomation: {
        backlogToReady: true,
        readyToExecuting: false,
      },
      queueProcessing: {
        enabled: false,
      },
    },
  };
}

function createTask(id: string, phase: string, order: number, created: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    frontmatter: {
      id,
      title: id,
      phase,
      order,
      created,
      updated: created,
      ...overrides,
    },
  };
}

describe('queue manager ordering', () => {
  beforeEach(() => {
    vi.resetModules();

    updateWorkspaceConfigMock.mockReset();
    getWorkspaceByIdMock.mockReset();
    listWorkspacesMock.mockReset();
    discoverTasksMock.mockReset();
    moveTaskToPhaseMock.mockReset();
    executeTaskMock.mockReset();
    hasRunningSessionMock.mockReset();
    hasLiveExecutionSessionMock.mockReset();
    stopTaskExecutionMock.mockReset();
    loadGlobalWorkflowSettingsMock.mockReset();

    hasRunningSessionMock.mockImplementation(() => false);
    hasLiveExecutionSessionMock.mockImplementation(() => false);
    listWorkspacesMock.mockImplementation(async () => []);
    stopTaskExecutionMock.mockImplementation(async () => false);
    loadGlobalWorkflowSettingsMock.mockImplementation(() => ({
      readyLimit: 25,
      executingLimit: 1,
      backlogToReady: false,
      readyToExecuting: true,
    }));

    moveTaskToPhaseMock.mockImplementation((task: any, newPhase: string, _actor: string, _reason?: string, allTasks?: any[]) => {
      if (allTasks) {
        const tasksInTarget = allTasks.filter((candidate) => (
          candidate.frontmatter.phase === newPhase && candidate.id !== task.id
        ));
        const minOrder = tasksInTarget.reduce(
          (min, candidate) => Math.min(min, candidate.frontmatter.order ?? 0),
          Number.POSITIVE_INFINITY,
        );
        task.frontmatter.order = Number.isFinite(minOrder) ? minOrder - 1 : 0;
      }
      task.frontmatter.phase = newPhase;
      return task;
    });

    executeTaskMock.mockImplementation(async () => undefined);
  });

  it('picks the oldest ready task first under left-insert ordering (FIFO)', async () => {
    const workspace = createWorkspace(1);
    const tasks = [
      createTask('TASK-NEW', 'ready', -1, '2025-01-01T00:00:10.000Z'),
      createTask('TASK-OLD', 'ready', 0, '2025-01-01T00:00:00.000Z'),
    ];

    getWorkspaceByIdMock.mockImplementation(async () => workspace);
    discoverTasksMock.mockImplementation(() => tasks);
    updateWorkspaceConfigMock.mockImplementation(async (_workspace: any, config: any) => {
      workspace.config = {
        ...workspace.config,
        ...config,
      };
      return workspace;
    });

    const { startQueueProcessing, stopQueueProcessing } = await import('../src/queue-manager.js');

    await startQueueProcessing(workspace.id, () => {});

    await vi.waitFor(() => {
      expect(executeTaskMock).toHaveBeenCalledTimes(1);
    });

    const pickedTaskId = executeTaskMock.mock.calls[0]?.[0]?.task?.id;
    expect(pickedTaskId).toBe('TASK-OLD');

    await stopQueueProcessing(workspace.id);
  });

  it('keeps FIFO behavior when ready tasks have equal order values', async () => {
    const workspace = createWorkspace(1);
    const tasks = [
      createTask('TASK-NEW', 'ready', 0, '2025-01-01T00:00:10.000Z'),
      createTask('TASK-OLD', 'ready', 0, '2025-01-01T00:00:00.000Z'),
    ];

    getWorkspaceByIdMock.mockImplementation(async () => workspace);
    discoverTasksMock.mockImplementation(() => tasks);
    updateWorkspaceConfigMock.mockImplementation(async (_workspace: any, config: any) => {
      workspace.config = {
        ...workspace.config,
        ...config,
      };
      return workspace;
    });

    const { startQueueProcessing, stopQueueProcessing } = await import('../src/queue-manager.js');

    await startQueueProcessing(workspace.id, () => {});

    await vi.waitFor(() => {
      expect(executeTaskMock).toHaveBeenCalledTimes(1);
    });

    const pickedTaskId = executeTaskMock.mock.calls[0]?.[0]?.task?.id;
    expect(pickedTaskId).toBe('TASK-OLD');

    await stopQueueProcessing(workspace.id);
  });

  it('picks up newly eligible ready work when kicked through the coordinator boundary', async () => {
    const workspace = createWorkspace(1);
    let planningComplete = false;

    getWorkspaceByIdMock.mockImplementation(async () => workspace);
    discoverTasksMock.mockImplementation(() => [
      createTask(
        'TASK-PLANNING',
        'ready',
        0,
        '2025-01-01T00:00:00.000Z',
        { planningStatus: planningComplete ? 'completed' : 'running' },
      ),
    ]);
    updateWorkspaceConfigMock.mockImplementation(async (_workspace: any, config: any) => {
      workspace.config = {
        ...workspace.config,
        ...config,
      };
      return workspace;
    });

    const { startQueueProcessing, stopQueueProcessing } = await import('../src/queue-manager.js');
    const { requestQueueKick } = await import('../src/queue-kick-coordinator.js');

    await startQueueProcessing(workspace.id, () => {});

    await vi.waitFor(() => {
      expect(discoverTasksMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(executeTaskMock).not.toHaveBeenCalled();

    planningComplete = true;
    requestQueueKick(workspace.id);

    await vi.waitFor(() => {
      expect(executeTaskMock).toHaveBeenCalledTimes(1);
    });

    expect(executeTaskMock.mock.calls[0]?.[0]?.task?.id).toBe('TASK-PLANNING');

    await stopQueueProcessing(workspace.id);
  });

  it('passes destination context when moving orphaned executing tasks back to ready', async () => {
    const workspace = createWorkspace(1);
    const tasks = [
      createTask(
        'TASK-ORPHAN',
        'executing',
        5,
        '2025-01-01T00:00:00.000Z',
        { started: new Date().toISOString() },
      ),
    ];

    getWorkspaceByIdMock.mockImplementation(async () => workspace);
    discoverTasksMock.mockImplementation(() => tasks);
    updateWorkspaceConfigMock.mockImplementation(async (_workspace: any, config: any) => {
      workspace.config = {
        ...workspace.config,
        ...config,
      };
      return workspace;
    });

    // Keep the orphan in executing after the first ready move so queue pickup
    // does not trigger additional transitions in this test.
    moveTaskToPhaseMock.mockImplementationOnce((task: any) => task);

    const { startQueueProcessing, stopQueueProcessing } = await import('../src/queue-manager.js');

    await startQueueProcessing(workspace.id, () => {});

    await vi.waitFor(() => {
      expect(
        moveTaskToPhaseMock.mock.calls.some((call) => call[0]?.id === 'TASK-ORPHAN' && call[1] === 'ready'),
      ).toBe(true);
    });

    const readyMoveCall = moveTaskToPhaseMock.mock.calls.find((call) => (
      call[0]?.id === 'TASK-ORPHAN' && call[1] === 'ready'
    ));

    expect(readyMoveCall?.[4]).toBe(tasks);
    expect(stopTaskExecutionMock).toHaveBeenCalledWith('TASK-ORPHAN');
    expect(executeTaskMock).not.toHaveBeenCalled();

    await stopQueueProcessing(workspace.id);
  });

  it('does not auto-assign ready work while another executing task still has an active session', async () => {
    const workspace = createWorkspace(1);
    const tasks = [
      createTask('TASK-EXECUTING', 'executing', 0, '2025-01-01T00:00:00.000Z'),
      createTask('TASK-READY', 'ready', -1, '2025-01-01T00:00:10.000Z'),
    ];

    getWorkspaceByIdMock.mockImplementation(async () => workspace);
    discoverTasksMock.mockImplementation(() => tasks);
    hasRunningSessionMock.mockImplementation((taskId: string) => taskId === 'TASK-EXECUTING');
    hasLiveExecutionSessionMock.mockImplementation((taskId: string) => taskId === 'TASK-EXECUTING');
    updateWorkspaceConfigMock.mockImplementation(async (_workspace: any, config: any) => {
      workspace.config = {
        ...workspace.config,
        ...config,
      };
      return workspace;
    });

    const { startQueueProcessing, stopQueueProcessing, kickQueue } = await import('../src/queue-manager.js');

    await startQueueProcessing(workspace.id, () => {});
    kickQueue(workspace.id);

    await vi.waitFor(() => {
      expect(discoverTasksMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    expect(executeTaskMock).not.toHaveBeenCalled();
    expect(
      moveTaskToPhaseMock.mock.calls.some((call) => call[0]?.id === 'TASK-READY' && call[1] === 'executing'),
    ).toBe(false);

    await stopQueueProcessing(workspace.id);
  });

  it('treats awaiting-input executions as live sessions and does not orphan-reset them', async () => {
    const workspace = createWorkspace(1);
    const tasks = [
      createTask('TASK-AWAITING', 'executing', 0, '2025-01-01T00:00:00.000Z'),
      createTask('TASK-READY', 'ready', -1, '2025-01-01T00:00:10.000Z'),
    ];

    getWorkspaceByIdMock.mockImplementation(async () => workspace);
    discoverTasksMock.mockImplementation(() => tasks);
    hasRunningSessionMock.mockImplementation(() => false);
    hasLiveExecutionSessionMock.mockImplementation((taskId: string) => taskId === 'TASK-AWAITING');
    updateWorkspaceConfigMock.mockImplementation(async (_workspace: any, config: any) => {
      workspace.config = {
        ...workspace.config,
        ...config,
      };
      return workspace;
    });

    const { startQueueProcessing, stopQueueProcessing } = await import('../src/queue-manager.js');

    await startQueueProcessing(workspace.id, () => {}, { persist: false });

    await vi.waitFor(() => {
      expect(discoverTasksMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    expect(stopTaskExecutionMock).not.toHaveBeenCalledWith('TASK-AWAITING');
    expect(
      moveTaskToPhaseMock.mock.calls.some((call) => call[0]?.id === 'TASK-AWAITING' && call[1] === 'ready'),
    ).toBe(false);
    expect(
      moveTaskToPhaseMock.mock.calls.some((call) => call[0]?.id === 'TASK-READY' && call[1] === 'executing'),
    ).toBe(false);

    await stopQueueProcessing(workspace.id, { persist: false });
  });

  it('continues ready→executing promotion across queue stop/start cycles', async () => {
    const workspace = createWorkspace(1);
    const tasks = [
      createTask('TASK-READY', 'ready', 0, '2025-01-01T00:00:00.000Z'),
    ];

    getWorkspaceByIdMock.mockImplementation(async () => workspace);
    discoverTasksMock.mockImplementation(() => tasks);
    updateWorkspaceConfigMock.mockImplementation(async (_workspace: any, config: any) => {
      workspace.config = {
        ...workspace.config,
        ...config,
      };
      return workspace;
    });

    const { startQueueProcessing, stopQueueProcessing } = await import('../src/queue-manager.js');

    await startQueueProcessing(workspace.id, () => {}, { persist: false });
    await vi.waitFor(() => {
      expect(executeTaskMock).toHaveBeenCalledTimes(1);
    });

    await stopQueueProcessing(workspace.id, { persist: false });

    tasks[0].frontmatter.phase = 'ready';

    await startQueueProcessing(workspace.id, () => {}, { persist: false });
    await vi.waitFor(() => {
      expect(executeTaskMock).toHaveBeenCalledTimes(2);
    });

    await stopQueueProcessing(workspace.id, { persist: false });
  });

  it('reconciles orphaned executing tasks even when executing WIP is currently full', async () => {
    const workspace = createWorkspace(1);
    const tasks = [
      createTask('TASK-RUNNING', 'executing', 1, '2025-01-01T00:00:00.000Z'),
      createTask(
        'TASK-ORPHAN',
        'executing',
        0,
        '2025-01-01T00:00:00.000Z',
        { started: '2024-12-31T23:55:00.000Z' },
      ),
      createTask('TASK-READY', 'ready', -1, '2025-01-01T00:00:10.000Z'),
    ];

    getWorkspaceByIdMock.mockImplementation(async () => workspace);
    discoverTasksMock.mockImplementation(() => tasks);
    hasRunningSessionMock.mockImplementation((taskId: string) => taskId === 'TASK-RUNNING');
    hasLiveExecutionSessionMock.mockImplementation((taskId: string) => taskId === 'TASK-RUNNING');
    updateWorkspaceConfigMock.mockImplementation(async (_workspace: any, config: any) => {
      workspace.config = {
        ...workspace.config,
        ...config,
      };
      return workspace;
    });

    const { startQueueProcessing, stopQueueProcessing } = await import('../src/queue-manager.js');

    await startQueueProcessing(workspace.id, () => {}, { persist: false });

    await vi.waitFor(() => {
      expect(
        moveTaskToPhaseMock.mock.calls.some((call) => call[0]?.id === 'TASK-ORPHAN' && call[1] === 'ready'),
      ).toBe(true);
    });

    expect(executeTaskMock).not.toHaveBeenCalled();

    await stopQueueProcessing(workspace.id, { persist: false });
  });

  it('does not auto-assign ready work if queue stop completes before delayed pickup resumes', async () => {
    const workspace = createWorkspace(1);
    const tasks = [
      createTask('TASK-READY', 'ready', 0, '2025-01-01T00:00:00.000Z'),
    ];

    let resolveDelayedLookup: (() => void) | undefined;
    const delayedLookup = new Promise<typeof workspace>((resolve) => {
      resolveDelayedLookup = () => resolve(workspace);
    });

    let workspaceLookupCount = 0;
    getWorkspaceByIdMock.mockImplementation(async () => {
      workspaceLookupCount += 1;
      if (workspaceLookupCount === 2) {
        return delayedLookup;
      }
      return workspace;
    });

    discoverTasksMock.mockImplementation(() => tasks);
    updateWorkspaceConfigMock.mockImplementation(async (_workspace: any, config: any) => {
      workspace.config = {
        ...workspace.config,
        ...config,
      };
      return workspace;
    });

    const { startQueueProcessing, stopQueueProcessing } = await import('../src/queue-manager.js');

    await startQueueProcessing(workspace.id, () => {}, { persist: false });

    await vi.waitFor(() => {
      expect(workspaceLookupCount).toBeGreaterThanOrEqual(2);
    });

    await stopQueueProcessing(workspace.id, { persist: false });

    resolveDelayedLookup?.();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(executeTaskMock).not.toHaveBeenCalled();
    expect(
      moveTaskToPhaseMock.mock.calls.some((call) => call[0]?.id === 'TASK-READY' && call[1] === 'executing'),
    ).toBe(false);
  });

  it('keeps queue paused on startup when ready→executing automation is disabled', async () => {
    const workspace = createWorkspace(1);
    workspace.config.workflowAutomation.readyToExecuting = false;
    workspace.config.queueProcessing = { enabled: false };

    const tasks = [
      createTask('TASK-READY', 'ready', 0, '2025-01-01T00:00:00.000Z'),
    ];

    listWorkspacesMock.mockImplementation(async () => [workspace]);
    getWorkspaceByIdMock.mockImplementation(async () => workspace);
    discoverTasksMock.mockImplementation(() => tasks);

    const { initializeQueueManagers } = await import('../src/queue-manager.js');

    await initializeQueueManagers(() => {});
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(executeTaskMock).not.toHaveBeenCalled();
    expect(
      moveTaskToPhaseMock.mock.calls.some((call) => call[0]?.id === 'TASK-READY' && call[1] === 'executing'),
    ).toBe(false);
  });

  it('recovers orphaned executions during startup before promoting regular ready work', async () => {
    const workspace = createWorkspace(1);
    workspace.config.workflowAutomation.readyToExecuting = true;
    workspace.config.queueProcessing = { enabled: true };

    const tasks = [
      createTask(
        'TASK-ORPHAN',
        'executing',
        1,
        '2025-01-01T00:00:00.000Z',
        { started: '2024-12-31T23:55:00.000Z' },
      ),
      createTask('TASK-READY', 'ready', 0, '2025-01-01T00:00:10.000Z'),
    ];

    listWorkspacesMock.mockImplementation(async () => [workspace]);
    getWorkspaceByIdMock.mockImplementation(async () => workspace);
    discoverTasksMock.mockImplementation(() => tasks);

    const { initializeQueueManagers, stopQueueProcessing } = await import('../src/queue-manager.js');

    await initializeQueueManagers(() => {});

    await vi.waitFor(() => {
      expect(executeTaskMock).toHaveBeenCalledTimes(1);
    });

    expect(executeTaskMock.mock.calls[0]?.[0]?.task?.id).toBe('TASK-ORPHAN');
    expect(
      moveTaskToPhaseMock.mock.calls.some((call) => call[0]?.id === 'TASK-READY' && call[1] === 'executing'),
    ).toBe(false);

    await stopQueueProcessing(workspace.id, { persist: false });
  });

  it('can recover the same orphaned execution after repeated stop/start cycles without manual edits', async () => {
    const workspace = createWorkspace(1);
    const tasks = [
      createTask(
        'TASK-ORPHAN',
        'executing',
        0,
        '2025-01-01T00:00:00.000Z',
        { started: '2024-12-31T23:55:00.000Z' },
      ),
    ];

    getWorkspaceByIdMock.mockImplementation(async () => workspace);
    discoverTasksMock.mockImplementation(() => tasks);

    const { startQueueProcessing, stopQueueProcessing } = await import('../src/queue-manager.js');

    await startQueueProcessing(workspace.id, () => {}, { persist: false });
    await vi.waitFor(() => {
      expect(executeTaskMock).toHaveBeenCalledTimes(1);
    });

    await stopQueueProcessing(workspace.id, { persist: false });

    await startQueueProcessing(workspace.id, () => {}, { persist: false });
    await vi.waitFor(() => {
      expect(executeTaskMock).toHaveBeenCalledTimes(2);
    });

    await stopQueueProcessing(workspace.id, { persist: false });
  });

  it('ignores stale completion callbacks from superseded execution attempts', async () => {
    const workspace = createWorkspace(1);
    const tasks = [
      createTask('TASK-RACE', 'ready', 0, '2025-01-01T00:00:00.000Z'),
    ];

    getWorkspaceByIdMock.mockImplementation(async () => workspace);
    discoverTasksMock.mockImplementation(() => tasks);
    updateWorkspaceConfigMock.mockImplementation(async (_workspace: any, config: any) => {
      workspace.config = {
        ...workspace.config,
        ...config,
      };
      return workspace;
    });

    const completionCallbacks: Array<(success: boolean) => void> = [];
    executeTaskMock.mockImplementation(async ({ onComplete }: any) => {
      completionCallbacks.push(onComplete);
    });

    const { startQueueProcessing, stopQueueProcessing, kickQueue } = await import('../src/queue-manager.js');

    await startQueueProcessing(workspace.id, () => {});

    await vi.waitFor(() => {
      expect(completionCallbacks).toHaveLength(1);
    });

    kickQueue(workspace.id);

    await vi.waitFor(() => {
      expect(completionCallbacks).toHaveLength(2);
    });

    completionCallbacks[0]?.(true);

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(
      moveTaskToPhaseMock.mock.calls.filter((call) => call[0]?.id === 'TASK-RACE' && call[1] === 'complete'),
    ).toHaveLength(0);

    completionCallbacks[1]?.(true);

    await vi.waitFor(() => {
      expect(
        moveTaskToPhaseMock.mock.calls.filter((call) => call[0]?.id === 'TASK-RACE' && call[1] === 'complete'),
      ).toHaveLength(1);
    });

    await stopQueueProcessing(workspace.id);
  });

  it('passes destination context when moving successful executions to complete', async () => {
    const workspace = createWorkspace(1);
    const tasks = [
      createTask('TASK-READY', 'ready', 0, '2025-01-01T00:00:00.000Z'),
    ];

    getWorkspaceByIdMock.mockImplementation(async () => workspace);
    discoverTasksMock.mockImplementation(() => tasks);
    updateWorkspaceConfigMock.mockImplementation(async (_workspace: any, config: any) => {
      workspace.config = {
        ...workspace.config,
        ...config,
      };
      return workspace;
    });
    executeTaskMock.mockImplementation(async ({ onComplete }: any) => {
      onComplete(true);
    });

    const { startQueueProcessing, stopQueueProcessing } = await import('../src/queue-manager.js');

    await startQueueProcessing(workspace.id, () => {});

    await vi.waitFor(() => {
      expect(
        moveTaskToPhaseMock.mock.calls.some((call) => call[0]?.id === 'TASK-READY' && call[1] === 'complete'),
      ).toBe(true);
    });

    const completeMoveCall = moveTaskToPhaseMock.mock.calls.find((call) => (
      call[0]?.id === 'TASK-READY' && call[1] === 'complete'
    ));

    expect(completeMoveCall?.[4]).toBe(tasks);

    await stopQueueProcessing(workspace.id);
  });

  it('uses active-scope discovery for queue status when no manager is running', async () => {
    const workspace = createWorkspace(1);
    workspace.config.workflowAutomation.readyToExecuting = true;

    const activeTasks = [
      createTask('TASK-READY', 'ready', 0, '2025-01-01T00:00:00.000Z'),
      createTask('TASK-EXECUTING', 'executing', 1, '2025-01-01T00:00:05.000Z'),
    ];
    const archivedTask = createTask('TASK-ARCHIVED', 'archived', 2, '2025-01-01T00:00:10.000Z');

    getWorkspaceByIdMock.mockImplementation(async () => workspace);
    discoverTasksMock.mockImplementation((_tasksDir: string, options?: { scope?: string }) => {
      if (options?.scope === 'active') {
        return activeTasks;
      }
      return [...activeTasks, archivedTask];
    });

    const { getQueueStatus } = await import('../src/queue-manager.js');

    const status = await getQueueStatus(workspace.id);

    expect(discoverTasksMock).toHaveBeenCalledWith('/tmp/tasks', { scope: 'active' });
    expect(status).toEqual({
      workspaceId: workspace.id,
      enabled: true,
      currentTaskId: null,
      tasksInReady: 1,
      tasksInExecuting: 1,
    });
  });

  it('uses active-scope discovery for queue status when a manager is running', async () => {
    const workspace = createWorkspace(1);

    const activeTasks = [
      createTask('TASK-READY', 'ready', 0, '2025-01-01T00:00:00.000Z'),
      createTask('TASK-EXECUTING', 'executing', 1, '2025-01-01T00:00:05.000Z'),
    ];
    const archivedTask = createTask('TASK-ARCHIVED', 'archived', 2, '2025-01-01T00:00:10.000Z');

    getWorkspaceByIdMock.mockImplementation(async () => workspace);
    hasLiveExecutionSessionMock.mockImplementation((taskId: string) => taskId === 'TASK-EXECUTING');
    discoverTasksMock.mockImplementation((_tasksDir: string, options?: { scope?: string }) => {
      if (options?.scope === 'active') {
        return activeTasks;
      }
      return [...activeTasks, archivedTask];
    });

    const { startQueueProcessing, stopQueueProcessing, getQueueStatus } = await import('../src/queue-manager.js');

    const startStatus = await startQueueProcessing(workspace.id, () => {}, { persist: false });
    const runningStatus = await getQueueStatus(workspace.id);

    const activeScopeCalls = discoverTasksMock.mock.calls.filter((call) => call[1]?.scope === 'active');

    expect(activeScopeCalls.length).toBeGreaterThan(0);
    expect(startStatus).toEqual({
      workspaceId: workspace.id,
      enabled: true,
      currentTaskId: null,
      tasksInReady: 1,
      tasksInExecuting: 1,
    });
    expect(runningStatus).toEqual({
      workspaceId: workspace.id,
      enabled: true,
      currentTaskId: null,
      tasksInReady: 1,
      tasksInExecuting: 1,
    });

    await stopQueueProcessing(workspace.id, { persist: false });
  });
});
