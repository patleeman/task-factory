import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  modelRegistryFind: vi.fn(),
  createAgentSession: vi.fn(),
  modelRegistryGetAvailable: vi.fn(),
  loaderReload: vi.fn(async () => undefined),
  loadPiSettings: vi.fn(),
}));

vi.mock('@mariozechner/pi-coding-agent', () => ({
  AuthStorage: class AuthStorage {
    static create(): AuthStorage {
      return new AuthStorage();
    }
  },
  createAgentSession: (...args: unknown[]) => mocks.createAgentSession(...args),
  ModelRegistry: class ModelRegistry {
    find(...args: unknown[]) {
      return mocks.modelRegistryFind(...args);
    }
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

vi.mock('../src/pi-integration.js', () => ({
  loadPiSettings: (...args: unknown[]) => mocks.loadPiSettings(...args),
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
  mocks.modelRegistryFind.mockReset();
  mocks.createAgentSession.mockReset();
  mocks.modelRegistryGetAvailable.mockReset();
  mocks.loaderReload.mockReset();
  mocks.loaderReload.mockResolvedValue(undefined);
  mocks.loadPiSettings.mockReset();
  mocks.loadPiSettings.mockReturnValue(null);
});

describe('generateTitle', () => {
  it('returns normalized title text from model output', async () => {
    mocks.loadPiSettings.mockReturnValue({
      defaultProvider: 'anthropic',
      defaultModel: 'claude-haiku-4-5',
    });
    mocks.modelRegistryFind.mockReturnValue({ id: 'haiku' });

    const streaming = createSession({ response: '  "Ship backlog automation"  ' });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const title = await generateTitle('Implement backlog automation pipeline', []);

    expect(title).toBe('Ship backlog automation');
    expect(mocks.modelRegistryFind).toHaveBeenCalledWith('anthropic', 'claude-haiku-4-5');
    expect(streaming.prompt).toHaveBeenCalledTimes(1);
    expect(streaming.dispose).toHaveBeenCalledTimes(1);
  });

  it('uses configured non-Anthropic provider/model when available', async () => {
    mocks.loadPiSettings.mockReturnValue({
      defaultProvider: 'openai',
      defaultModel: 'gpt-4o-mini',
    });
    mocks.modelRegistryFind.mockReturnValue({ id: 'gpt-4o-mini', provider: 'openai' });

    const streaming = createSession({ response: 'OpenAI generated title' });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const title = await generateTitle('Test task with OpenAI default', []);

    expect(title).toBe('OpenAI generated title');
    expect(mocks.modelRegistryFind).toHaveBeenCalledWith('openai', 'gpt-4o-mini');
    expect(mocks.modelRegistryFind).toHaveBeenCalledTimes(1);
    expect(streaming.prompt).toHaveBeenCalledTimes(1);
  });

  it('does not attempt to find Anthropic models when non-Anthropic provider is configured', async () => {
    mocks.loadPiSettings.mockReturnValue({
      defaultProvider: 'openai',
      defaultModel: 'gpt-4o',
    });
    mocks.modelRegistryFind.mockReturnValue({ id: 'gpt-4o', provider: 'openai' });

    const streaming = createSession({ response: 'Non-Anthropic title' });
    mocks.createAgentSession.mockResolvedValue(streaming);

    await generateTitle('Test with OpenAI as default', []);

    // Should only call find once with the configured provider
    expect(mocks.modelRegistryFind).toHaveBeenCalledTimes(1);
    expect(mocks.modelRegistryFind).toHaveBeenCalledWith('openai', 'gpt-4o');
  });

  it('falls back to available models when configured model is unavailable', async () => {
    mocks.loadPiSettings.mockReturnValue({
      defaultProvider: 'openai',
      defaultModel: 'gpt-4o',
    });
    // Configured model is unavailable
    mocks.modelRegistryFind.mockReturnValue(undefined);
    // But available models exist in registry
    mocks.modelRegistryGetAvailable.mockResolvedValue([
      { id: 'claude-sonnet-4-20250514', provider: 'anthropic' },
    ]);

    const streaming = createSession({ response: 'Fallback model title' });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const title = await generateTitle('Test fallback to available model', []);

    expect(title).toBe('Fallback model title');
    expect(mocks.modelRegistryFind).toHaveBeenCalledWith('openai', 'gpt-4o');
    expect(mocks.modelRegistryGetAvailable).toHaveBeenCalled();
    expect(streaming.prompt).toHaveBeenCalledTimes(1);
  });

  it('falls back gracefully when no model can be resolved', async () => {
    mocks.loadPiSettings.mockReturnValue({
      defaultProvider: 'nonexistent',
      defaultModel: 'nonexistent-model',
    });
    mocks.modelRegistryFind.mockReturnValue(undefined);
    mocks.modelRegistryGetAvailable.mockResolvedValue([]);

    const title = await generateTitle('Graceful fallback title test', []);

    expect(title).toBe('Graceful fallback title test');
    expect(mocks.createAgentSession).not.toHaveBeenCalled();
  });

  it('falls back to available models when no Pi settings are configured', async () => {
    mocks.loadPiSettings.mockReturnValue(null);
    mocks.modelRegistryGetAvailable.mockResolvedValue([
      { id: 'some-model', provider: 'some-provider' },
    ]);

    const streaming = createSession({ response: 'Available model title' });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const title = await generateTitle('Test with no configured default', []);

    expect(title).toBe('Available model title');
    expect(mocks.modelRegistryFind).not.toHaveBeenCalled();
    expect(mocks.modelRegistryGetAvailable).toHaveBeenCalled();
  });

  it('falls back to available models when Pi settings have no defaultProvider', async () => {
    mocks.loadPiSettings.mockReturnValue({
      defaultModel: 'gpt-4o',
      // missing defaultProvider
    });
    mocks.modelRegistryGetAvailable.mockResolvedValue([
      { id: 'fallback-model', provider: 'fallback-provider' },
    ]);

    const streaming = createSession({ response: 'Fallback due to missing provider' });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const title = await generateTitle('Test with incomplete settings', []);

    expect(title).toBe('Fallback due to missing provider');
    expect(mocks.modelRegistryFind).not.toHaveBeenCalled();
  });

  it('falls back to available models when Pi settings have no defaultModel', async () => {
    mocks.loadPiSettings.mockReturnValue({
      defaultProvider: 'openai',
      // missing defaultModel
    });
    mocks.modelRegistryGetAvailable.mockResolvedValue([
      { id: 'fallback-model', provider: 'fallback-provider' },
    ]);

    const streaming = createSession({ response: 'Fallback due to missing model' });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const title = await generateTitle('Test with incomplete settings', []);

    expect(title).toBe('Fallback due to missing model');
    expect(mocks.modelRegistryFind).not.toHaveBeenCalled();
  });

  it('uses fallback title when no model is available', async () => {
    mocks.loadPiSettings.mockReturnValue(null);
    mocks.modelRegistryGetAvailable.mockResolvedValue([]);

    const title = await generateTitle('Fallback title from description', []);

    expect(title).toBe('Fallback title from description');
    expect(mocks.createAgentSession).not.toHaveBeenCalled();
  });

  it('uses fallback title when model output is empty', async () => {
    mocks.loadPiSettings.mockReturnValue({
      defaultProvider: 'anthropic',
      defaultModel: 'claude-haiku-4-5',
    });
    mocks.modelRegistryFind.mockReturnValue({ id: 'haiku' });
    const streaming = createSession({ response: '   ' });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const title = await generateTitle('Fallback for empty model output', []);

    expect(title).toBe('Fallback for empty model output');
  });

  it('uses fallback title when generation times out', async () => {
    vi.useFakeTimers();

    mocks.loadPiSettings.mockReturnValue({
      defaultProvider: 'anthropic',
      defaultModel: 'claude-haiku-4-5',
    });
    mocks.modelRegistryFind.mockReturnValue({ id: 'haiku' });
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

    mocks.loadPiSettings.mockReturnValue({
      defaultProvider: 'anthropic',
      defaultModel: 'claude-haiku-4-5',
    });
    mocks.modelRegistryFind.mockReturnValue({ id: 'haiku' });
    const streaming = createSession({ promptError: new Error('prompt failed') });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const title = await generateTitle('Fallback after prompt failure', []);

    expect(title).toBe('Fallback after prompt failure');
    expect(streaming.dispose).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});
