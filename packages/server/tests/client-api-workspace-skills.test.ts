import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../client/src/api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('client api getWorkspaceSkills', () => {
  it('loads and normalizes workspace skills', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ([
        { id: 'tdd-feature', name: 'TDD Feature', description: 'Build features with tests first' },
        { id: 'checkpoint', name: '', description: '   ' },
      ]),
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const skills = await api.getWorkspaceSkills('workspace-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/workspace-1/skills');
    expect(skills).toEqual([
      { id: 'tdd-feature', name: 'TDD Feature', description: 'Build features with tests first' },
      { id: 'checkpoint', name: 'checkpoint', description: '' },
    ]);
  });

  it('returns an empty array when the response is not an array', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ skills: [] }),
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const skills = await api.getWorkspaceSkills('workspace-1');
    expect(skills).toEqual([]);
  });

  it('throws server-provided errors', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Skills unavailable' }),
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.getWorkspaceSkills('workspace-1')).rejects.toThrow('Skills unavailable');
  });
});
