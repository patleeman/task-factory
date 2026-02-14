import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateWorkspaceConfigMock = vi.fn();
const getWorkspaceByIdMock = vi.fn();
const discoverTasksMock = vi.fn();
const moveTaskToPhaseMock = vi.fn();
const executeTaskMock = vi.fn();
const hasRunningSessionMock = vi.fn(() => false);

vi.mock('../src/workspace-service.js', () => ({
  getWorkspaceById: (...args: any[]) => getWorkspaceByIdMock(...args),
  getTasksDir: () => '/tmp/tasks',
  listWorkspaces: async () => [],
  updateWorkspaceConfig: (...args: any[]) => updateWorkspaceConfigMock(...args),
}));

vi.mock('../src/task-service.js', () => ({
  discoverTasks: (...args: any[]) => discoverTasksMock(...args),
  moveTaskToPhase: (...args: any[]) => moveTaskToPhaseMock(...args),
}));

vi.mock('../src/agent-execution-service.js', () => ({
  executeTask: (...args: any[]) => executeTaskMock(...args),
  hasRunningSession: (...args: any[]) => hasRunningSessionMock(...args),
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
    discoverTasksMock.mockReset();
    moveTaskToPhaseMock.mockReset();
    executeTaskMock.mockReset();
    hasRunningSessionMock.mockReset();

    hasRunningSessionMock.mockImplementation(() => false);

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
    expect(executeTaskMock).not.toHaveBeenCalled();

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
});
