import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../client/src/api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('client api stopTaskExecution', () => {
  it('posts to the stop endpoint and returns stopped=true', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ stopped: true }),
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await api.stopTaskExecution('workspace-1', 'TASK-123');

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/workspace-1/tasks/TASK-123/stop', {
      method: 'POST',
    });
    expect(result).toEqual({ stopped: true });
  });

  it('returns stopped=false when the success response does not include a stopped flag', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await api.stopTaskExecution('workspace-1', 'TASK-123');
    expect(result).toEqual({ stopped: false });
  });

  it('throws the server-provided error message when stop fails', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Task session is not stoppable' }),
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.stopTaskExecution('workspace-1', 'TASK-123')).rejects.toThrow('Task session is not stoppable');
  });

  it('falls back to a generic error message when stop error JSON cannot be parsed', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error('Invalid JSON');
      },
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.stopTaskExecution('workspace-1', 'TASK-123')).rejects.toThrow('Stop failed (503)');
  });
});

describe('client api stopPlanningExecution', () => {
  it('posts to the planning stop endpoint and returns stopped=true', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ stopped: true }),
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await api.stopPlanningExecution('workspace-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/workspace-1/planning/stop', {
      method: 'POST',
    });
    expect(result).toEqual({ stopped: true });
  });

  it('throws a fallback error with status when planning stop fails without parsable JSON', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('Invalid JSON');
      },
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.stopPlanningExecution('workspace-1')).rejects.toThrow('Stop failed (502)');
  });
});
