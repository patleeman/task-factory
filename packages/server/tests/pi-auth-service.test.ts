import { describe, expect, it } from 'vitest';
import {
  PiAuthServiceError,
  PiLoginManager,
  clearProviderCredential,
  loadPiAuthOverview,
  setProviderApiKey,
  type AuthCredentialLike,
  type AuthStorageLike,
  type OAuthProviderLike,
  type PiAuthContext,
} from '../src/pi-auth-service.js';

interface FakeAuthStorageOptions {
  oauthProviders?: OAuthProviderLike[];
  initialCredentials?: Record<string, AuthCredentialLike>;
  externalProviders?: string[];
  loginImpl?: AuthStorageLike['login'];
}

class FakeAuthStorage implements AuthStorageLike {
  private readonly credentials = new Map<string, AuthCredentialLike>();
  private readonly oauthProviders: OAuthProviderLike[];
  private readonly externalProviders: Set<string>;
  private readonly loginImpl?: AuthStorageLike['login'];

  constructor(options: FakeAuthStorageOptions = {}) {
    this.oauthProviders = options.oauthProviders ?? [];
    this.externalProviders = new Set(options.externalProviders ?? []);
    this.loginImpl = options.loginImpl;

    for (const [providerId, credential] of Object.entries(options.initialCredentials ?? {})) {
      this.credentials.set(providerId, credential);
    }
  }

  get(provider: string): AuthCredentialLike | undefined {
    return this.credentials.get(provider);
  }

  hasAuth(provider: string): boolean {
    return this.credentials.has(provider) || this.externalProviders.has(provider);
  }

  list(): string[] {
    return Array.from(this.credentials.keys());
  }

  set(provider: string, credential: AuthCredentialLike): void {
    this.credentials.set(provider, credential);
  }

  remove(provider: string): void {
    this.credentials.delete(provider);
  }

  async login(providerId: string, callbacks: Parameters<AuthStorageLike['login']>[1]): Promise<void> {
    if (!this.loginImpl) {
      throw new Error(`No login handler configured for ${providerId}`);
    }

    await this.loginImpl(providerId, callbacks);
    this.credentials.set(providerId, { type: 'oauth' });
  }

  getOAuthProviders(): OAuthProviderLike[] {
    return [...this.oauthProviders];
  }
}

function createContext(authStorage: AuthStorageLike, modelProviders: string[]): () => Promise<PiAuthContext> {
  return async () => ({
    authStorage,
    modelRegistry: {
      getAll: () => modelProviders.map((provider) => ({ provider })),
    },
  });
}

async function waitForCondition(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();

  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('loadPiAuthOverview', () => {
  it('returns merged provider auth state across models, auth file, and oauth providers', async () => {
    const authStorage = new FakeAuthStorage({
      oauthProviders: [
        { id: 'anthropic', name: 'Anthropic' },
        { id: 'openai-codex', name: 'ChatGPT Plus/Pro', usesCallbackServer: true },
      ],
      initialCredentials: {
        anthropic: { type: 'api_key', key: 'sk-ant-123' },
        'openai-codex': { type: 'oauth' },
      },
      externalProviders: ['google'],
    });

    const overview = await loadPiAuthOverview(createContext(authStorage, ['anthropic', 'google']));

    expect(overview.providers.map((provider) => provider.id)).toEqual([
      'anthropic',
      'google',
      'openai-codex',
    ]);

    expect(overview.providers.find((provider) => provider.id === 'anthropic')).toMatchObject({
      authState: 'api_key',
      supportsOAuth: true,
      hasStoredCredential: true,
    });

    expect(overview.providers.find((provider) => provider.id === 'google')).toMatchObject({
      authState: 'external',
      supportsOAuth: false,
      hasStoredCredential: false,
    });

    expect(overview.providers.find((provider) => provider.id === 'openai-codex')).toMatchObject({
      authState: 'oauth',
      supportsOAuth: true,
      usesCallbackServer: true,
    });

    expect(overview.oauthProviders).toEqual([
      {
        id: 'anthropic',
        name: 'Anthropic',
        usesCallbackServer: false,
        loggedIn: false,
      },
      {
        id: 'openai-codex',
        name: 'ChatGPT Plus/Pro',
        usesCallbackServer: true,
        loggedIn: true,
      },
    ]);
  });
});

describe('provider credential mutations', () => {
  it('sets and clears api key credentials', async () => {
    const authStorage = new FakeAuthStorage({
      oauthProviders: [{ id: 'openai', name: 'OpenAI' }],
    });
    const contextFactory = createContext(authStorage, ['openai']);

    const afterSet = await setProviderApiKey('openai', 'sk-test-123', contextFactory);
    expect(afterSet).toMatchObject({
      id: 'openai',
      authState: 'api_key',
      hasStoredCredential: true,
      supportsOAuth: true,
    });

    const afterClear = await clearProviderCredential('openai', contextFactory);
    expect(afterClear).toMatchObject({
      id: 'openai',
      authState: 'none',
      hasStoredCredential: false,
      supportsOAuth: true,
    });
  });

  it('rejects empty api keys', async () => {
    const authStorage = new FakeAuthStorage();

    await expect(
      setProviderApiKey('openai', '   ', createContext(authStorage, ['openai'])),
    ).rejects.toMatchObject({ status: 400 } satisfies Partial<PiAuthServiceError>);
  });
});

describe('PiLoginManager', () => {
  it('completes login after prompt input is submitted', async () => {
    const authStorage = new FakeAuthStorage({
      oauthProviders: [{ id: 'anthropic', name: 'Anthropic' }],
      loginImpl: async (_providerId, callbacks) => {
        callbacks.onAuth({ url: 'https://example.com/auth' });
        const code = await callbacks.onPrompt({ message: 'Paste authorization code' });
        if (code !== 'valid-code') {
          throw new Error('Invalid code');
        }
        callbacks.onProgress?.('Authenticated');
      },
    });

    const manager = new PiLoginManager({
      createContext: createContext(authStorage, []),
      setTimer: ((handler: () => void) => ({ handler } as unknown as ReturnType<typeof setTimeout>)),
      clearTimer: () => {},
    });

    const started = await manager.start('anthropic');

    await waitForCondition(() => manager.get(started.id).inputRequest !== undefined);

    const pending = manager.get(started.id);
    expect(pending.status).toBe('awaiting_input');
    expect(pending.authUrl).toBe('https://example.com/auth');
    expect(pending.inputRequest?.message).toContain('authorization code');

    manager.submitInput(started.id, pending.inputRequest!.id, 'valid-code');

    await waitForCondition(() => manager.get(started.id).status === 'succeeded');

    const completed = manager.get(started.id);
    expect(completed.status).toBe('succeeded');
    expect(completed.progressMessages).toContain('Authenticated');
  });

  it('cancels a running login session', async () => {
    const authStorage = new FakeAuthStorage({
      oauthProviders: [{ id: 'openai-codex', name: 'OpenAI Codex', usesCallbackServer: true }],
      loginImpl: async (_providerId, callbacks) => {
        callbacks.onAuth({ url: 'https://example.com/login' });
        await new Promise<void>((_resolve, reject) => {
          if (callbacks.signal?.aborted) {
            reject(new Error('Login cancelled'));
            return;
          }

          callbacks.signal?.addEventListener(
            'abort',
            () => reject(new Error('Login cancelled')),
            { once: true },
          );
        });
      },
    });

    const manager = new PiLoginManager({
      createContext: createContext(authStorage, []),
      setTimer: ((handler: () => void) => ({ handler } as unknown as ReturnType<typeof setTimeout>)),
      clearTimer: () => {},
    });

    const started = await manager.start('openai-codex');
    const cancelled = manager.cancel(started.id);

    expect(cancelled.status).toBe('cancelled');

    await waitForCondition(() => manager.get(started.id).status === 'cancelled');
  });
});
