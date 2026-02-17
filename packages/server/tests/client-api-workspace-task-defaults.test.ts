import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../client/src/api';
import type { TaskDefaults } from '@task-factory/shared';

const DEFAULTS: TaskDefaults = {
  planningModelConfig: {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4',
  },
  executionModelConfig: {
    provider: 'openai',
    modelId: 'gpt-4o',
  },
  modelConfig: {
    provider: 'openai',
    modelId: 'gpt-4o',
  },
  prePlanningSkills: [],
  preExecutionSkills: [],
  postExecutionSkills: ['checkpoint', 'code-review', 'update-docs'],
};

describe('client api workspace task defaults', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('loads workspace task defaults from workspace-scoped endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => DEFAULTS,
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await api.getWorkspaceTaskDefaults('workspace-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/workspace-1/task-defaults');
    expect(result).toEqual(DEFAULTS);
  });

  it('saves workspace task defaults to workspace-scoped endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => DEFAULTS,
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await api.saveWorkspaceTaskDefaults('workspace-1', DEFAULTS);

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/workspace-1/task-defaults', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(DEFAULTS),
    });
    expect(result).toEqual(DEFAULTS);
  });

  it('propagates workspace task-default validation errors from the server', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Unknown post-execution skills: not-a-skill' }),
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.saveWorkspaceTaskDefaults('workspace-1', DEFAULTS)).rejects.toThrow(
      'Unknown post-execution skills: not-a-skill',
    );
  });
});
