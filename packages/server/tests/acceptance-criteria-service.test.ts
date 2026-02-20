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

import { generateAcceptanceCriteria } from '../src/acceptance-criteria-service.js';

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

describe('generateAcceptanceCriteria', () => {
  it('parses numbered and bulleted criteria from model output', async () => {
    mocks.loadPiSettings.mockReturnValue({
      defaultProvider: 'anthropic',
      defaultModel: 'claude-haiku-4-5',
    });
    mocks.modelRegistryFind.mockReturnValue({ id: 'haiku' });

    const streaming = createSession({
      response: '1. First criterion\n2) Second criterion\n- Third criterion\n* Fourth criterion\n',
    });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const criteria = await generateAcceptanceCriteria('Implement queue controls');

    expect(criteria).toEqual([
      'First criterion',
      'Second criterion',
      'Third criterion',
      'Fourth criterion',
    ]);
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

    const streaming = createSession({
      response: '1. OpenAI criterion one\n2. OpenAI criterion two',
    });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const criteria = await generateAcceptanceCriteria('Test with OpenAI default');

    expect(criteria).toEqual(['OpenAI criterion one', 'OpenAI criterion two']);
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

    const streaming = createSession({ response: '1. Non-Anthropic criterion' });
    mocks.createAgentSession.mockResolvedValue(streaming);

    await generateAcceptanceCriteria('Test with OpenAI as default');

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

    const streaming = createSession({ response: '1. Fallback model criterion' });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const criteria = await generateAcceptanceCriteria('Test fallback to available model');

    expect(criteria).toEqual(['Fallback model criterion']);
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

    const criteria = await generateAcceptanceCriteria('Graceful fallback test');

    expect(criteria).toEqual(['Graceful fallback test is implemented and working correctly']);
    expect(mocks.createAgentSession).not.toHaveBeenCalled();
  });

  it('falls back to available models when no Pi settings are configured', async () => {
    mocks.loadPiSettings.mockReturnValue(null);
    mocks.modelRegistryGetAvailable.mockResolvedValue([
      { id: 'some-model', provider: 'some-provider' },
    ]);

    const streaming = createSession({ response: '1. Available model criterion' });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const criteria = await generateAcceptanceCriteria('Test with no configured default');

    expect(criteria).toEqual(['Available model criterion']);
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

    const streaming = createSession({ response: '1. Fallback due to missing provider' });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const criteria = await generateAcceptanceCriteria('Test with incomplete settings');

    expect(criteria).toEqual(['Fallback due to missing provider']);
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

    const streaming = createSession({ response: '1. Fallback due to missing model' });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const criteria = await generateAcceptanceCriteria('Test with incomplete settings');

    expect(criteria).toEqual(['Fallback due to missing model']);
    expect(mocks.modelRegistryFind).not.toHaveBeenCalled();
  });

  it('uses fallback criteria when no model is available', async () => {
    mocks.loadPiSettings.mockReturnValue(null);
    mocks.modelRegistryGetAvailable.mockResolvedValue([]);

    const criteria = await generateAcceptanceCriteria('Implement queue controls');

    expect(criteria).toEqual(['Implement queue controls is implemented and working correctly']);
    expect(mocks.createAgentSession).not.toHaveBeenCalled();
  });

  it('uses fallback criteria when model output is empty', async () => {
    mocks.loadPiSettings.mockReturnValue({
      defaultProvider: 'anthropic',
      defaultModel: 'claude-haiku-4-5',
    });
    mocks.modelRegistryFind.mockReturnValue({ id: 'haiku' });
    const streaming = createSession({ response: '   ' });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const criteria = await generateAcceptanceCriteria('Implement queue controls');

    expect(criteria).toEqual(['Implement queue controls is implemented and working correctly']);
  });

  it('uses fallback criteria when generation times out', async () => {
    vi.useFakeTimers();

    mocks.loadPiSettings.mockReturnValue({
      defaultProvider: 'anthropic',
      defaultModel: 'claude-haiku-4-5',
    });
    mocks.modelRegistryFind.mockReturnValue({ id: 'haiku' });
    const streaming = createSession({ neverResolve: true });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const resultPromise = generateAcceptanceCriteria('Implement queue controls');
    await vi.advanceTimersByTimeAsync(15_000);

    const criteria = await resultPromise;

    expect(criteria).toEqual(['Implement queue controls is implemented and working correctly']);
    expect(streaming.dispose).toHaveBeenCalledTimes(1);
  });

  it('uses fallback criteria when session prompt throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mocks.loadPiSettings.mockReturnValue({
      defaultProvider: 'anthropic',
      defaultModel: 'claude-haiku-4-5',
    });
    mocks.modelRegistryFind.mockReturnValue({ id: 'haiku' });
    const streaming = createSession({ promptError: new Error('prompt failed') });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const criteria = await generateAcceptanceCriteria('Implement queue controls');

    expect(criteria).toEqual(['Implement queue controls is implemented and working correctly']);
    expect(streaming.dispose).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});
