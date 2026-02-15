import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../client/src/api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('client api task list scope', () => {
  it('loads all tasks by default without a scope query', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [],
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await api.getTasks('workspace-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/workspace-1/tasks');
  });

  it('loads only active tasks when active scope is requested', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [],
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await api.getTasks('workspace-1', 'active');

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/workspace-1/tasks?scope=active');
  });

  it('loads archived tasks when archived scope is requested', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [],
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await api.getTasks('workspace-1', 'archived');

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/workspace-1/tasks?scope=archived');
  });

  it('surfaces server task list errors', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'task storage unavailable' }),
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.getTasks('workspace-1', 'active')).rejects.toThrow('task storage unavailable');
  });
});
