import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../client/src/api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('client api openArchiveInFileExplorer', () => {
  it('posts to the workspace archive explorer endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true }),
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await api.openArchiveInFileExplorer('workspace-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/workspace-1/archive/open-in-explorer', {
      method: 'POST',
    });
  });

  it('throws the server-provided error when archive explorer open fails', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Failed to open archive in file explorer: xdg-open missing' }),
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.openArchiveInFileExplorer('workspace-1')).rejects.toThrow(
      'Failed to open archive in file explorer: xdg-open missing',
    );
  });

  it('falls back to status-based error when response JSON cannot be parsed', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error('Invalid JSON');
      },
    }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.openArchiveInFileExplorer('workspace-1')).rejects.toThrow(
      'Failed to open archive in file explorer (503)',
    );
  });
});
