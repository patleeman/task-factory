import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getModel: vi.fn(),
  createAgentSession: vi.fn(),
  modelRegistryGetAvailable: vi.fn(),
  loaderReload: vi.fn(async () => undefined),
}));

vi.mock('@mariozechner/pi-ai', () => ({
  getModel: (...args: unknown[]) => mocks.getModel(...args),
}));

vi.mock('@mariozechner/pi-coding-agent', () => ({
  AuthStorage: class AuthStorage {},
  createAgentSession: (...args: unknown[]) => mocks.createAgentSession(...args),
  ModelRegistry: class ModelRegistry {
    getAvailable(...args: unknown[]) {
      return mocks.modelRegistryGetAvailable(...args);
    }
  },
  SessionManager: {
    inMemory: () => ({ type: 'session-manager' }),
  },
  SettingsManager: {
    inMemory: () => ({ type: 'settings-manager' }),
  },
  DefaultResourceLoader: class DefaultResourceLoader {
    reload(...args: unknown[]) {
      return mocks.loaderReload(...args);
    }
  },
}));

import { generateTitle } from '../src/title-service.js';

function createSession(options: { response?: string; neverResolve?: boolean; promptError?: Error } = {}) {
  let listener: ((event: any) => void) | null = null;

  const prompt = vi.fn(async () => {
    if (options.promptError) {
      throw options.promptError;
    }

    if (options.neverResolve) {
      return new Promise<void>(() => {});
    }

    if (options.response && listener) {
      listener({
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta',
          delta: options.response,
        },
      });
    }
  });

  const dispose = vi.fn();

  return {
    session: {
      subscribe(callback: (event: any) => void) {
        listener = callback;
        return () => {
          listener = null;
        };
      },
      prompt,
      dispose,
    },
    prompt,
    dispose,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  mocks.getModel.mockReset();
  mocks.createAgentSession.mockReset();
  mocks.modelRegistryGetAvailable.mockReset();
  mocks.loaderReload.mockReset();
  mocks.loaderReload.mockResolvedValue(undefined);
});

describe('generateTitle', () => {
  it('returns normalized title text from model output', async () => {
    mocks.getModel
      .mockReturnValueOnce({ id: 'haiku' })
      .mockReturnValueOnce(undefined);

    const streaming = createSession({ response: '  "Ship backlog automation"  ' });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const title = await generateTitle('Implement backlog automation pipeline', []);

    expect(title).toBe('Ship backlog automation');
    expect(streaming.prompt).toHaveBeenCalledTimes(1);
    expect(streaming.dispose).toHaveBeenCalledTimes(1);
  });

  it('uses fallback title when no model is available', async () => {
    mocks.getModel.mockReturnValue(undefined);
    mocks.modelRegistryGetAvailable.mockResolvedValue([]);

    const title = await generateTitle('Fallback title from description', []);

    expect(title).toBe('Fallback title from description');
    expect(mocks.createAgentSession).not.toHaveBeenCalled();
  });

  it('uses fallback title when model output is empty', async () => {
    mocks.getModel.mockReturnValue({ id: 'haiku' });
    const streaming = createSession({ response: '   ' });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const title = await generateTitle('Fallback for empty model output', []);

    expect(title).toBe('Fallback for empty model output');
  });

  it('uses fallback title when generation times out', async () => {
    vi.useFakeTimers();

    mocks.getModel.mockReturnValue({ id: 'haiku' });
    const streaming = createSession({ neverResolve: true });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const resultPromise = generateTitle('Timeout fallback title', []);
    await vi.advanceTimersByTimeAsync(10_000);

    const title = await resultPromise;

    expect(title).toBe('Timeout fallback title');
    expect(streaming.dispose).toHaveBeenCalledTimes(1);
  });

  it('uses fallback title when session prompt throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mocks.getModel.mockReturnValue({ id: 'haiku' });
    const streaming = createSession({ promptError: new Error('prompt failed') });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const title = await generateTitle('Fallback after prompt failure', []);

    expect(title).toBe('Fallback after prompt failure');
    expect(streaming.dispose).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});
