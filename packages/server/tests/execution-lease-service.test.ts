import { describe, expect, it } from 'vitest';
import { isExecutionLeaseFresh } from '../src/execution-lease-service.js';

describe('execution lease service', () => {
  it('returns false when lease is missing', () => {
    expect(isExecutionLeaseFresh(undefined, { nowMs: 1_000, ttlMs: 500 })).toBe(false);
  });

  it('returns true when heartbeat is within ttl', () => {
    const lease = {
      taskId: 'TASK-1',
      ownerId: 'owner-1',
      startedAt: '2026-02-18T00:00:00.000Z',
      lastHeartbeatAt: '2026-02-18T00:00:10.000Z',
      status: 'running' as const,
    };

    expect(
      isExecutionLeaseFresh(lease, {
        nowMs: Date.parse('2026-02-18T00:00:40.000Z'),
        ttlMs: 45_000,
      }),
    ).toBe(true);
  });

  it('returns false when heartbeat exceeds ttl', () => {
    const lease = {
      taskId: 'TASK-1',
      ownerId: 'owner-1',
      startedAt: '2026-02-18T00:00:00.000Z',
      lastHeartbeatAt: '2026-02-18T00:00:10.000Z',
      status: 'running' as const,
    };

    expect(
      isExecutionLeaseFresh(lease, {
        nowMs: Date.parse('2026-02-18T00:01:30.000Z'),
        ttlMs: 45_000,
      }),
    ).toBe(false);
  });
});
