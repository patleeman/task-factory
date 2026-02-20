import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../client/src/api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('client api getWorkspaceSkillCatalog', () => {
  it('returns canonical catalog and uses enabled entries for slash commands', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          { id: 'tdd-feature', name: 'TDD Feature', description: 'Build features with tests first', source: 'workspace', provider: 'workspace', enabled: true },
          { id: 'checkpoint', name: '', description: '   ', source: 'starter', provider: 'starter', enabled: false },
        ]),
      });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const catalog = await api.getWorkspaceSkillCatalog('workspace-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/workspaces/workspace-1/skills');
    expect(catalog).toEqual({
      skills: [
        { id: 'tdd-feature', name: 'TDD Feature', description: 'Build features with tests first', source: 'workspace', provider: 'workspace', path: undefined, enabled: true },
        { id: 'checkpoint', name: 'checkpoint', description: '', source: 'starter', provider: 'starter', path: undefined, enabled: false },
      ],
      slashSkills: [
        { id: 'tdd-feature', name: 'TDD Feature', description: 'Build features with tests first', source: 'workspace', provider: 'workspace', path: undefined, enabled: true },
      ],
    });
  });

  it('returns empty catalog payload safely', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills: [] }) });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const catalog = await api.getWorkspaceSkillCatalog('workspace-1');

    expect(catalog).toEqual({ skills: [], slashSkills: [] });
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
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'react-best-practices', name: 'React Best Practices', description: 'React performance patterns', enabled: true },
          { id: 'security-review', name: 'Security Review', description: 'Audit', enabled: false },
        ],
      });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const skills = await api.getWorkspaceSkills('workspace-1');

    expect(skills).toEqual([
      { id: 'react-best-practices', name: 'React Best Practices', description: 'React performance patterns', source: undefined, provider: undefined, path: undefined, enabled: true },
    ]);
  });
});
