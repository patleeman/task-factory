import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../client/src/api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('client api getWorkspaceSkillCatalog', () => {
  it('merges workspace and execution skills into one slash skill catalog', async () => {
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
          { id: 'code-review', name: 'Code Review', description: 'Review changed code', hooks: ['post'] },
        ]),
      });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const catalog = await api.getWorkspaceSkillCatalog('workspace-1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/workspaces/workspace-1/skills');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/factory/skills');
    expect(catalog).toEqual({
      slashSkills: [
        { id: 'tdd-feature', name: 'TDD Feature', description: 'Build features with tests first' },
        { id: 'checkpoint', name: 'checkpoint', description: '' },
        { id: 'code-review', name: 'Code Review', description: 'Review changed code' },
      ],
    });
  });

  it('gracefully handles unavailable fallback registry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills: [] }) })
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: 'offline' }) });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const catalog = await api.getWorkspaceSkillCatalog('workspace-1');

    expect(catalog).toEqual({ slashSkills: [] });
  });

  it('throws server-provided workspace errors', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Skills unavailable' }),
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.getWorkspaceSkillCatalog('workspace-1')).rejects.toThrow('Skills unavailable');
  });

  it('retains getWorkspaceSkills compatibility helper', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'react-best-practices', name: 'React Best Practices', description: 'React performance patterns' },
        ],
      });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const skills = await api.getWorkspaceSkills('workspace-1');

    expect(skills).toEqual([
      { id: 'react-best-practices', name: 'React Best Practices', description: 'React performance patterns' },
    ]);
  });
});
