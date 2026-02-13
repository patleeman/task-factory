import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSystemEventMock = vi.fn();

vi.mock('../src/activity-service.js', () => ({
  createSystemEvent: (...args: unknown[]) => createSystemEventMock(...args),
}));

import { logTaskStateTransition } from '../src/state-transition.js';

describe('logTaskStateTransition', () => {
  beforeEach(() => {
    createSystemEventMock.mockReset();
  });

  it('persists and broadcasts a structured state transition event', async () => {
    const persistedEntry = {
      type: 'system-event',
      id: 'evt-1',
      taskId: 'PIFA-1',
      event: 'phase-change',
      message: '<state>ready</state> <mode>task_complete</mode> <planning_status>completed</planning_status>',
      timestamp: new Date().toISOString(),
      metadata: {},
    };
    createSystemEventMock.mockResolvedValue(persistedEntry);

    const broadcast = vi.fn();

    await logTaskStateTransition({
      workspaceId: 'ws-1',
      taskId: 'PIFA-1',
      from: {
        mode: 'task_planning',
        phase: 'backlog',
        planningStatus: 'running',
      },
      to: {
        mode: 'task_complete',
        phase: 'ready',
        planningStatus: 'completed',
      },
      source: 'task:move',
      reason: 'Moved to ready',
      broadcastToWorkspace: broadcast,
    });

    expect(createSystemEventMock).toHaveBeenCalledTimes(1);
    expect(createSystemEventMock).toHaveBeenCalledWith(
      'ws-1',
      'PIFA-1',
      'phase-change',
      '<state>ready</state> <mode>task_complete</mode> <planning_status>completed</planning_status>',
      expect.objectContaining({
        kind: 'state-transition',
        source: 'task:move',
        reason: 'Moved to ready',
      }),
    );

    expect(broadcast).toHaveBeenCalledWith({
      type: 'activity:entry',
      entry: persistedEntry,
    });
  });

  it('does nothing when state snapshot is unchanged', async () => {
    await logTaskStateTransition({
      workspaceId: 'ws-1',
      taskId: 'PIFA-1',
      from: {
        mode: 'task_execution',
        phase: 'executing',
        planningStatus: 'completed',
      },
      to: {
        mode: 'task_execution',
        phase: 'executing',
        planningStatus: 'completed',
      },
      source: 'noop',
    });

    expect(createSystemEventMock).not.toHaveBeenCalled();
  });
});
