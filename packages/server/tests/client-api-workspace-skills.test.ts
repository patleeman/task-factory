import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../client/src/api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('client api getWorkspaceSkillCatalog', () => {
  it('keeps slash skills and execution hook skills in separate registries', async () => {
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
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          {
            id: 'code-review',
            name: 'Code Review',
            description: 'Review changed code',
            hooks: ['post', 'post', 'pre'],
          },
        ]),
      });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const catalog = await api.getWorkspaceSkillCatalog('workspace-1');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/workspaces/workspace-1/skills');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/pi/skills');
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/factory/skills');
    expect(catalog).toEqual({
      slashSkills: [
        { id: 'tdd-feature', name: 'TDD Feature', description: 'Build features with tests first' },
        { id: 'checkpoint', name: 'checkpoint', description: '' },
      ],
      hookSkills: [
        {
          id: 'code-review',
          name: 'Code Review',
          description: 'Review changed code',
          hooks: ['post', 'pre'],
        },
      ],
    });
  });

  it('falls back to global pi skills when workspace-enabled slash skills are empty', async () => {
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
          { id: 'code-review', name: 'Code Review', description: 'Review changed code', hooks: ['post'] },
        ],
      });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const catalog = await api.getWorkspaceSkillCatalog('workspace-1');

    expect(catalog).toEqual({
      slashSkills: [
        { id: 'react-best-practices', name: 'React Best Practices', description: 'React performance patterns' },
      ],
      hookSkills: [
        { id: 'code-review', name: 'Code Review', description: 'Review changed code', hooks: ['post'] },
      ],
    });
  });

  it('gracefully handles unavailable fallback registries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills: [] }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'offline' }) })
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: 'offline' }) });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const catalog = await api.getWorkspaceSkillCatalog('workspace-1');

    expect(catalog).toEqual({ slashSkills: [], hookSkills: [] });
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

  it('retains getWorkspaceSkills as slash-only compatibility helper', async () => {
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
          { id: 'code-review', name: 'Code Review', description: 'Review changed code', hooks: ['post'] },
        ],
      });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const skills = await api.getWorkspaceSkills('workspace-1');

    expect(skills).toEqual([
      { id: 'react-best-practices', name: 'React Best Practices', description: 'React performance patterns' },
    ]);
  });
});
