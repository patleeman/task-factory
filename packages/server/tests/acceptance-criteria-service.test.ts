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
  AuthStorage: class AuthStorage {
    static create(): AuthStorage {
      return new AuthStorage();
    }
  },
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
  mocks.getModel.mockReset();
  mocks.createAgentSession.mockReset();
  mocks.modelRegistryGetAvailable.mockReset();
  mocks.loaderReload.mockReset();
  mocks.loaderReload.mockResolvedValue(undefined);
});

describe('generateAcceptanceCriteria', () => {
  it('parses numbered and bulleted criteria from model output', async () => {
    mocks.getModel
      .mockReturnValueOnce({ id: 'haiku' })
      .mockReturnValueOnce(undefined);

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
    expect(streaming.prompt).toHaveBeenCalledTimes(1);
    expect(streaming.dispose).toHaveBeenCalledTimes(1);
  });

  it('uses fallback criteria when no model is available', async () => {
    mocks.getModel.mockReturnValue(undefined);
    mocks.modelRegistryGetAvailable.mockResolvedValue([]);

    const criteria = await generateAcceptanceCriteria('Implement queue controls');

    expect(criteria).toEqual(['Implement queue controls is implemented and working correctly']);
    expect(mocks.createAgentSession).not.toHaveBeenCalled();
  });

  it('uses fallback criteria when model output is empty', async () => {
    mocks.getModel.mockReturnValue({ id: 'haiku' });
    const streaming = createSession({ response: '   ' });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const criteria = await generateAcceptanceCriteria('Implement queue controls');

    expect(criteria).toEqual(['Implement queue controls is implemented and working correctly']);
  });

  it('uses fallback criteria when generation times out', async () => {
    vi.useFakeTimers();

    mocks.getModel.mockReturnValue({ id: 'haiku' });
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

    mocks.getModel.mockReturnValue({ id: 'haiku' });
    const streaming = createSession({ promptError: new Error('prompt failed') });
    mocks.createAgentSession.mockResolvedValue(streaming);

    const criteria = await generateAcceptanceCriteria('Implement queue controls');

    expect(criteria).toEqual(['Implement queue controls is implemented and working correctly']);
    expect(streaming.dispose).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});
