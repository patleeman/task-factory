import { describe, expect, it } from 'vitest';
import { buildExecutionSnapshots, type ActiveSessionLike } from '../src/execution-snapshot.js';

describe('buildExecutionSnapshots', () => {
  const baseSessions: ActiveSessionLike[] = [
    {
      taskId: 'PIFA-1',
      workspaceId: 'ws-a',
      status: 'running',
      startTime: '2026-02-12T10:00:00.000Z',
    },
    {
      taskId: 'PIFA-2',
      workspaceId: 'ws-a',
      status: 'idle',
      startTime: '2026-02-12T10:05:00.000Z',
    },
    {
      taskId: 'PIFA-3',
      workspaceId: 'ws-b',
      status: 'running',
      startTime: '2026-02-12T10:10:00.000Z',
      endTime: '2026-02-12T10:11:00.000Z',
    },
  ];

  it('creates UI-safe snapshots and marks only running sessions as running', () => {
    const snapshots = buildExecutionSnapshots(baseSessions);

    expect(snapshots).toEqual([
      {
        taskId: 'PIFA-1',
        workspaceId: 'ws-a',
        status: 'running',
        startTime: '2026-02-12T10:00:00.000Z',
        endTime: undefined,
        isRunning: true,
      },
      {
        taskId: 'PIFA-2',
        workspaceId: 'ws-a',
        status: 'idle',
        startTime: '2026-02-12T10:05:00.000Z',
        endTime: undefined,
        isRunning: false,
      },
      {
        taskId: 'PIFA-3',
        workspaceId: 'ws-b',
        status: 'running',
        startTime: '2026-02-12T10:10:00.000Z',
        endTime: '2026-02-12T10:11:00.000Z',
        isRunning: true,
      },
    ]);
  });

  it('filters snapshots by workspace id when provided', () => {
    const snapshots = buildExecutionSnapshots(baseSessions, 'ws-a');

    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((s) => s.taskId)).toEqual(['PIFA-1', 'PIFA-2']);
  });
});
