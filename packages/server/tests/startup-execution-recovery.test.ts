import { beforeEach, describe, expect, it, vi } from 'vitest';

const listWorkspacesMock = vi.fn();
const discoverTasksMock = vi.fn();
const moveTaskToPhaseMock = vi.fn();
const createSystemEventMock = vi.fn();
const hasLiveExecutionSessionMock = vi.fn();
const loadExecutionLeasesMock = vi.fn();
const isExecutionLeaseFreshMock = vi.fn();
const clearExecutionLeaseMock = vi.fn();
const getExecutionLeaseTtlMsMock = vi.fn();

vi.mock('../src/workspace-service.js', () => ({
  listWorkspaces: (...args: unknown[]) => listWorkspacesMock(...args),
  getTasksDir: () => '/tmp/tasks',
}));

vi.mock('../src/task-service.js', () => ({
  discoverTasks: (...args: unknown[]) => discoverTasksMock(...args),
  moveTaskToPhase: (...args: unknown[]) => moveTaskToPhaseMock(...args),
}));

vi.mock('../src/activity-service.js', () => ({
  createSystemEvent: (...args: unknown[]) => createSystemEventMock(...args),
}));

vi.mock('../src/agent-execution-service.js', () => ({
  hasLiveExecutionSession: (...args: unknown[]) => hasLiveExecutionSessionMock(...args),
}));

vi.mock('../src/execution-lease-service.js', () => ({
  loadExecutionLeases: (...args: unknown[]) => loadExecutionLeasesMock(...args),
  isExecutionLeaseFresh: (...args: unknown[]) => isExecutionLeaseFreshMock(...args),
  clearExecutionLease: (...args: unknown[]) => clearExecutionLeaseMock(...args),
  getExecutionLeaseTtlMs: (...args: unknown[]) => getExecutionLeaseTtlMsMock(...args),
}));

vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createTask(id: string, phase: 'ready' | 'executing') {
  return {
    id,
    frontmatter: {
      id,
      title: id,
      phase,
      updated: '2026-01-01T00:00:00.000Z',
    },
  };
}

describe('startup execution recovery', () => {
  beforeEach(() => {
    vi.resetModules();

    listWorkspacesMock.mockReset();
    discoverTasksMock.mockReset();
    moveTaskToPhaseMock.mockReset();
    createSystemEventMock.mockReset();
    hasLiveExecutionSessionMock.mockReset();
    loadExecutionLeasesMock.mockReset();
    isExecutionLeaseFreshMock.mockReset();
    clearExecutionLeaseMock.mockReset();
    getExecutionLeaseTtlMsMock.mockReset();

    listWorkspacesMock.mockResolvedValue([
      {
        id: 'ws-1',
        name: 'workspace-1',
        path: '/tmp/workspace-1',
      },
    ]);
    hasLiveExecutionSessionMock.mockReturnValue(false);
    loadExecutionLeasesMock.mockResolvedValue({});
    isExecutionLeaseFreshMock.mockReturnValue(false);
    clearExecutionLeaseMock.mockResolvedValue(undefined);
    getExecutionLeaseTtlMsMock.mockReturnValue(120_000);
    createSystemEventMock.mockImplementation(async (_workspaceId, taskId, event, message, metadata) => ({
      type: 'system-event',
      id: `evt-${taskId}`,
      taskId,
      event,
      message,
      timestamp: '2026-02-18T00:00:00.000Z',
      metadata,
    }));

    moveTaskToPhaseMock.mockImplementation((task: any) => {
      task.frontmatter.phase = 'ready';
    });
  });

  it('recovers stale executing tasks and emits one recovery notice', async () => {
    const staleTask = createTask('TASK-STALE', 'executing');
    discoverTasksMock.mockReturnValue([staleTask]);
    loadExecutionLeasesMock.mockResolvedValue({
      'TASK-STALE': {
        taskId: 'TASK-STALE',
        ownerId: 'owner-1',
        startedAt: '2026-02-18T00:00:00.000Z',
        lastHeartbeatAt: '2026-02-18T00:00:01.000Z',
        status: 'running',
      },
    });
    isExecutionLeaseFreshMock.mockReturnValue(false);

    const { recoverStaleExecutingSessionsOnStartup } = await import('../src/startup-execution-recovery.js');

    const result = await recoverStaleExecutingSessionsOnStartup({
      nowMs: Date.parse('2026-02-18T00:10:00.000Z'),
      ttlMs: 120_000,
    });

    expect(result.recoveredTaskIds).toEqual(['TASK-STALE']);
    expect(moveTaskToPhaseMock).toHaveBeenCalledTimes(1);
    expect(createSystemEventMock).toHaveBeenCalledTimes(1);
    expect(createSystemEventMock.mock.calls[0]?.[3]).toContain('Recovered stale executing session');
    expect(clearExecutionLeaseMock).toHaveBeenCalledWith('/tmp/workspace-1', 'TASK-STALE');
  });

  it('keeps executing tasks untouched when lease heartbeat is fresh', async () => {
    const freshTask = createTask('TASK-FRESH', 'executing');
    discoverTasksMock.mockReturnValue([freshTask]);
    isExecutionLeaseFreshMock.mockReturnValue(true);

    const { recoverStaleExecutingSessionsOnStartup } = await import('../src/startup-execution-recovery.js');

    const result = await recoverStaleExecutingSessionsOnStartup({
      nowMs: Date.parse('2026-02-18T00:10:00.000Z'),
      ttlMs: 120_000,
    });

    expect(result.recoveredTaskIds).toEqual([]);
    expect(result.skippedFreshTaskIds).toEqual(['TASK-FRESH']);
    expect(moveTaskToPhaseMock).not.toHaveBeenCalled();
    expect(createSystemEventMock).not.toHaveBeenCalled();
  });

  it('keeps executing tasks untouched when a live in-memory session exists', async () => {
    const liveTask = createTask('TASK-LIVE', 'executing');
    discoverTasksMock.mockReturnValue([liveTask]);
    hasLiveExecutionSessionMock.mockReturnValue(true);

    const { recoverStaleExecutingSessionsOnStartup } = await import('../src/startup-execution-recovery.js');

    const result = await recoverStaleExecutingSessionsOnStartup({
      nowMs: Date.parse('2026-02-18T00:10:00.000Z'),
      ttlMs: 120_000,
    });

    expect(result.recoveredTaskIds).toEqual([]);
    expect(result.skippedFreshTaskIds).toEqual(['TASK-LIVE']);
    expect(moveTaskToPhaseMock).not.toHaveBeenCalled();
    expect(createSystemEventMock).not.toHaveBeenCalled();
  });

  it('is idempotent across repeated sweeps', async () => {
    const staleTask = createTask('TASK-STALE', 'executing');
    discoverTasksMock.mockReturnValue([staleTask]);
    isExecutionLeaseFreshMock.mockReturnValue(false);

    const { recoverStaleExecutingSessionsOnStartup } = await import('../src/startup-execution-recovery.js');

    await recoverStaleExecutingSessionsOnStartup({
      nowMs: Date.parse('2026-02-18T00:10:00.000Z'),
      ttlMs: 120_000,
    });

    await recoverStaleExecutingSessionsOnStartup({
      nowMs: Date.parse('2026-02-18T00:11:00.000Z'),
      ttlMs: 120_000,
    });

    expect(moveTaskToPhaseMock).toHaveBeenCalledTimes(1);
    expect(createSystemEventMock).toHaveBeenCalledTimes(1);
  });
});
