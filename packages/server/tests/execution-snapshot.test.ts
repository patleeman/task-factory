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
      awaitingUserInput: true,
    },
    {
      taskId: 'PIFA-3',
      workspaceId: 'ws-b',
      status: 'running',
      startTime: '2026-02-12T10:10:00.000Z',
      endTime: '2026-02-12T10:11:00.000Z',
      awaitingUserInput: true,
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
        awaitingInput: false,
      },
      {
        taskId: 'PIFA-2',
        workspaceId: 'ws-a',
        status: 'idle',
        startTime: '2026-02-12T10:05:00.000Z',
        endTime: undefined,
        isRunning: false,
        awaitingInput: true,
      },
      {
        taskId: 'PIFA-3',
        workspaceId: 'ws-b',
        status: 'running',
        startTime: '2026-02-12T10:10:00.000Z',
        endTime: '2026-02-12T10:11:00.000Z',
        isRunning: true,
        awaitingInput: false,
      },
    ]);
  });

  it('filters snapshots by workspace id when provided', () => {
    const snapshots = buildExecutionSnapshots(baseSessions, 'ws-a');

    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((s) => s.taskId)).toEqual(['PIFA-1', 'PIFA-2']);
  });

  it('does not infer awaitingInput for plain idle sessions', () => {
    const snapshots = buildExecutionSnapshots([
      {
        taskId: 'PIFA-4',
        workspaceId: 'ws-c',
        status: 'idle',
        startTime: '2026-02-12T12:00:00.000Z',
      },
    ]);

    expect(snapshots[0]?.awaitingInput).toBe(false);
  });
});
