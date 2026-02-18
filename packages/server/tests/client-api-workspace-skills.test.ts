import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../client/src/api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('client api getWorkspaceSkills', () => {
  it('loads, normalizes, and merges workspace + global skill sources', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          { id: 'tdd-feature', name: 'TDD Feature', description: 'Build features with tests first' },
          { id: 'checkpoint', name: '', description: '   ' },
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          { id: 'react-best-practices', name: 'React Best Practices', description: 'React performance patterns' },
          { id: 'checkpoint', name: 'Checkpoint Override', description: 'Should not replace workspace entry' },
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          { id: 'code-review', name: 'Code Review', description: 'Review changed code' },
        ]),
      });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const skills = await api.getWorkspaceSkills('workspace-1');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/workspaces/workspace-1/skills');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/pi/skills');
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/factory/skills');
    expect(skills).toEqual([
      { id: 'tdd-feature', name: 'TDD Feature', description: 'Build features with tests first' },
      { id: 'checkpoint', name: 'checkpoint', description: '' },
      { id: 'react-best-practices', name: 'React Best Practices', description: 'React performance patterns' },
      { id: 'code-review', name: 'Code Review', description: 'Review changed code' },
    ]);
  });

  it('falls back to globally discoverable skills when workspace skills are empty', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'react-best-practices', name: 'React Best Practices', description: 'React performance patterns' },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'code-review', name: 'Code Review', description: 'Review changed code' },
        ],
      });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const skills = await api.getWorkspaceSkills('workspace-1');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/workspaces/workspace-1/skills');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/pi/skills');
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/factory/skills');
    expect(skills).toEqual([
      { id: 'react-best-practices', name: 'React Best Practices', description: 'React performance patterns' },
      { id: 'code-review', name: 'Code Review', description: 'Review changed code' },
    ]);
  });

  it('returns an empty array when workspace and fallback skills are unavailable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills: [] }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'offline' }) })
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: 'offline' }) });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const skills = await api.getWorkspaceSkills('workspace-1');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/workspaces/workspace-1/skills');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/pi/skills');
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/factory/skills');
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
