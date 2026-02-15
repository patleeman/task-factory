import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateWorkspaceConfigMock = vi.fn();
const getWorkspaceByIdMock = vi.fn();
const loadGlobalWorkflowSettingsMock = vi.fn(() => ({
  executingLimit: 1,
  backlogToReady: false,
  readyToExecuting: true,
}));

vi.mock('../src/workspace-service.js', () => ({
  getWorkspaceById: (...args: any[]) => getWorkspaceByIdMock(...args),
  getTasksDir: () => '/tmp/tasks',
  listWorkspaces: async () => [],
  updateWorkspaceConfig: (...args: any[]) => updateWorkspaceConfigMock(...args),
}));

vi.mock('../src/task-service.js', () => ({
  discoverTasks: () => [],
  moveTaskToPhase: vi.fn(),
}));

vi.mock('../src/agent-execution-service.js', () => ({
  executeTask: vi.fn(async () => {}),
  hasRunningSession: vi.fn(() => false),
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

describe('queue manager automation persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    updateWorkspaceConfigMock.mockReset();
    getWorkspaceByIdMock.mockReset();
    loadGlobalWorkflowSettingsMock.mockReset();
    loadGlobalWorkflowSettingsMock.mockImplementation(() => ({
      executingLimit: 1,
      backlogToReady: false,
      readyToExecuting: true,
    }));
  });

  it('persists ready→executing updates while preserving backlog→ready setting', async () => {
    const workspace = {
      id: 'workspace-1',
      name: 'workspace',
      path: '/tmp/workspace',
      createdAt: '',
      updatedAt: '',
      config: {
        taskLocations: ['.pi/tasks'],
        defaultTaskLocation: '.pi/tasks',
        workflowAutomation: {
          backlogToReady: true,
          readyToExecuting: false,
        },
        queueProcessing: {
          enabled: false,
        },
      },
    };

    getWorkspaceByIdMock.mockImplementation(async () => workspace);
    updateWorkspaceConfigMock.mockImplementation(async (_workspace: any, config: any) => {
      workspace.config = {
        ...workspace.config,
        ...config,
      };
      return workspace;
    });

    const { startQueueProcessing, stopQueueProcessing } = await import('../src/queue-manager.js');

    await startQueueProcessing(workspace.id, () => {});
    expect(updateWorkspaceConfigMock).toHaveBeenCalledWith(
      workspace,
      expect.objectContaining({
        queueProcessing: { enabled: true },
        workflowAutomation: {
          backlogToReady: true,
          readyToExecuting: true,
        },
      }),
    );

    await stopQueueProcessing(workspace.id);
    expect(updateWorkspaceConfigMock).toHaveBeenLastCalledWith(
      workspace,
      expect.objectContaining({
        queueProcessing: { enabled: false },
        workflowAutomation: {
          backlogToReady: true,
          readyToExecuting: false,
        },
      }),
    );
  });
});
