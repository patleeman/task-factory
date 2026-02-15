import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../client/src/api';
import type { IdeaBacklog } from '@pi-factory/shared';

const BACKLOG: IdeaBacklog = {
  items: [
    {
      id: 'idea-1',
      text: 'Investigate caching strategy',
      createdAt: '2026-02-15T12:00:00.000Z',
    },
  ],
};

describe('client api workspace idea backlog', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('loads workspace idea backlog from workspace-scoped endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => BACKLOG,
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await api.getIdeaBacklog('workspace-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/workspace-1/idea-backlog');
    expect(result).toEqual(BACKLOG);
  });

  it('surfaces workspace idea backlog load errors from server responses', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'workspace storage unavailable' }),
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.getIdeaBacklog('workspace-1')).rejects.toThrow('workspace storage unavailable');
  });

  it('creates a new idea item via workspace-scoped endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => BACKLOG,
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await api.addIdeaBacklogItem('workspace-1', 'Investigate caching strategy');

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/workspace-1/idea-backlog/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Investigate caching strategy' }),
    });
    expect(result).toEqual(BACKLOG);
  });

  it('removes an idea item via workspace-scoped endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => BACKLOG,
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await api.removeIdeaBacklogItem('workspace-1', 'idea-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/workspace-1/idea-backlog/items/idea-1', {
      method: 'DELETE',
    });
    expect(result).toEqual(BACKLOG);
  });

  it('sends idea reorder payload and surfaces server validation errors', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'Reorder payload must include every idea exactly once' }),
        };
      }
      return {
        ok: true,
        json: async () => BACKLOG,
      };
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.reorderIdeaBacklog('workspace-1', ['idea-1'])).rejects.toThrow(
      'Reorder payload must include every idea exactly once',
    );

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/workspace-1/idea-backlog/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ideaIds: ['idea-1'] }),
    });
  });
});
