export class PiAuthServiceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PiAuthServiceError';
    this.status = status;
  }
}

type OAuthAuthInfo = {
  url: string;
  instructions?: string;
};

type OAuthPrompt = {
  message: string;
  placeholder?: string;
  allowEmpty?: boolean;
};

type OAuthLoginCallbacks = {
  onAuth: (info: OAuthAuthInfo) => void;
  onPrompt: (prompt: OAuthPrompt) => Promise<string>;
  onProgress?: (message: string) => void;
  onManualCodeInput?: () => Promise<string>;
  signal?: AbortSignal;
};

export type AuthCredentialLike =
  | { type: 'api_key'; key: string }
  | ({ type: 'oauth' } & Record<string, unknown>);

export interface OAuthProviderLike {
  id: string;
  name: string;
  usesCallbackServer?: boolean;
}

export interface AuthStorageLike {
  get(provider: string): AuthCredentialLike | undefined;
  hasAuth(provider: string): boolean;
  list(): string[];
  set(provider: string, credential: AuthCredentialLike): void;
  remove(provider: string): void;
  login(providerId: string, callbacks: OAuthLoginCallbacks): Promise<void>;
  getOAuthProviders(): OAuthProviderLike[];
}

export interface ModelRegistryLike {
  getAll(): Array<{ provider: string }>;
}

export interface PiAuthContext {
  authStorage: AuthStorageLike;
  modelRegistry: ModelRegistryLike;
}

export type PiAuthState = 'none' | 'api_key' | 'oauth' | 'external';

export interface PiAuthProviderOverview {
  id: string;
  authState: PiAuthState;
  hasStoredCredential: boolean;
  supportsOAuth: boolean;
  oauthProviderName?: string;
  usesCallbackServer: boolean;
}

export interface PiOAuthProviderOverview {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
}

export interface PiAuthOverview {
  providers: PiAuthProviderOverview[];
  oauthProviders: PiOAuthProviderOverview[];
}

export interface CreatePiAuthContextFn {
  (): Promise<PiAuthContext>;
}

export async function createPiAuthRuntimeContext(): Promise<PiAuthContext> {
  const { AuthStorage, ModelRegistry } = await import('@mariozechner/pi-coding-agent');
  const authStorage = new AuthStorage();
  const modelRegistry = new ModelRegistry(authStorage);

  return {
    authStorage: authStorage as AuthStorageLike,
    modelRegistry: modelRegistry as unknown as ModelRegistryLike,
  };
}

function toAuthState(authStorage: AuthStorageLike, providerId: string): PiAuthState {
  const stored = authStorage.get(providerId);

  if (stored?.type === 'oauth') return 'oauth';
  if (stored?.type === 'api_key') return 'api_key';
  if (authStorage.hasAuth(providerId)) return 'external';
  return 'none';
}

function buildProviderOverview(
  context: PiAuthContext,
  providerId: string,
  oauthProvidersById: Map<string, OAuthProviderLike>,
): PiAuthProviderOverview {
  const oauth = oauthProvidersById.get(providerId);
  const stored = context.authStorage.get(providerId);

  return {
    id: providerId,
    authState: toAuthState(context.authStorage, providerId),
    hasStoredCredential: Boolean(stored),
    supportsOAuth: Boolean(oauth),
    oauthProviderName: oauth?.name,
    usesCallbackServer: oauth?.usesCallbackServer ?? false,
  };
}

function normalizeProviderId(providerId: string): string {
  const normalized = providerId.trim();
  if (!normalized) {
    throw new PiAuthServiceError(400, 'providerId is required');
  }
  return normalized;
}

export async function loadPiAuthOverview(
  createContext: CreatePiAuthContextFn = createPiAuthRuntimeContext,
): Promise<PiAuthOverview> {
  const context = await createContext();
  const oauthProviders = context.authStorage.getOAuthProviders();
  const oauthProvidersById = new Map(oauthProviders.map((provider) => [provider.id, provider]));

  const providerIds = new Set<string>();

  for (const model of context.modelRegistry.getAll()) {
    if (typeof model.provider === 'string' && model.provider.length > 0) {
      providerIds.add(model.provider);
    }
  }

  for (const providerId of context.authStorage.list()) {
    providerIds.add(providerId);
  }

  for (const oauthProvider of oauthProviders) {
    providerIds.add(oauthProvider.id);
  }

  const providers = Array.from(providerIds)
    .sort((a, b) => a.localeCompare(b))
    .map((providerId) => buildProviderOverview(context, providerId, oauthProvidersById));

  const oauthProviderViews = oauthProviders
    .map((provider) => {
      const stored = context.authStorage.get(provider.id);
      return {
        id: provider.id,
        name: provider.name,
        usesCallbackServer: provider.usesCallbackServer ?? false,
        loggedIn: stored?.type === 'oauth',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    providers,
    oauthProviders: oauthProviderViews,
  };
}

export async function setProviderApiKey(
  providerId: string,
  apiKey: string,
  createContext: CreatePiAuthContextFn = createPiAuthRuntimeContext,
): Promise<PiAuthProviderOverview> {
  const normalizedProviderId = normalizeProviderId(providerId);
  const normalizedApiKey = apiKey.trim();

  if (!normalizedApiKey) {
    throw new PiAuthServiceError(400, 'API key is required');
  }

  const context = await createContext();
  context.authStorage.set(normalizedProviderId, {
    type: 'api_key',
    key: normalizedApiKey,
  });

  const oauthProvidersById = new Map(
    context.authStorage.getOAuthProviders().map((provider) => [provider.id, provider]),
  );

  return buildProviderOverview(context, normalizedProviderId, oauthProvidersById);
}

export async function clearProviderCredential(
  providerId: string,
  createContext: CreatePiAuthContextFn = createPiAuthRuntimeContext,
): Promise<PiAuthProviderOverview> {
  const normalizedProviderId = normalizeProviderId(providerId);

  const context = await createContext();
  context.authStorage.remove(normalizedProviderId);

  const oauthProvidersById = new Map(
    context.authStorage.getOAuthProviders().map((provider) => [provider.id, provider]),
  );

  return buildProviderOverview(context, normalizedProviderId, oauthProvidersById);
}

const LOGIN_SESSION_RETENTION_MS = 10 * 60 * 1000;
const MAX_PROGRESS_MESSAGES = 50;

export type PiOAuthLoginStatus =
  | 'running'
  | 'awaiting_input'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface PiOAuthLoginInputRequest {
  id: string;
  type: 'prompt' | 'manual-code';
  message: string;
  placeholder?: string;
  allowEmpty?: boolean;
}

export interface PiOAuthLoginSession {
  id: string;
  providerId: string;
  providerName: string;
  status: PiOAuthLoginStatus;
  startedAt: string;
  updatedAt: string;
  authUrl?: string;
  authInstructions?: string;
  progressMessages: string[];
  inputRequest?: PiOAuthLoginInputRequest;
  error?: string;
}

interface PendingInput {
  request: PiOAuthLoginInputRequest;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

interface PiOAuthLoginSessionInternal extends PiOAuthLoginSession {
  abortController: AbortController;
  pendingInput?: PendingInput;
  cleanupHandle?: ReturnType<typeof setTimeout>;
}

export interface PiLoginManagerDependencies {
  createContext?: CreatePiAuthContextFn;
  now?: () => Date;
  setTimer?: (handler: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class PiLoginManager {
  private readonly createContext: CreatePiAuthContextFn;
  private readonly now: () => Date;
  private readonly setTimer: (handler: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void;

  private readonly sessions = new Map<string, PiOAuthLoginSessionInternal>();

  constructor(deps: PiLoginManagerDependencies = {}) {
    this.createContext = deps.createContext ?? createPiAuthRuntimeContext;
    this.now = deps.now ?? (() => new Date());
    this.setTimer = deps.setTimer ?? ((handler, delayMs) => setTimeout(handler, delayMs));
    this.clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  async start(providerId: string): Promise<PiOAuthLoginSession> {
    const normalizedProviderId = normalizeProviderId(providerId);
    const context = await this.createContext();
    const oauthProvider = context.authStorage
      .getOAuthProviders()
      .find((provider) => provider.id === normalizedProviderId);

    if (!oauthProvider) {
      throw new PiAuthServiceError(404, `OAuth provider not found: ${normalizedProviderId}`);
    }

    const now = this.now().toISOString();
    const session: PiOAuthLoginSessionInternal = {
      id: crypto.randomUUID(),
      providerId: normalizedProviderId,
      providerName: oauthProvider.name,
      status: 'running',
      startedAt: now,
      updatedAt: now,
      progressMessages: [],
      abortController: new AbortController(),
    };

    this.sessions.set(session.id, session);

    void this.runLogin(session, context.authStorage);

    return this.cloneSession(session);
  }

  get(sessionId: string): PiOAuthLoginSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new PiAuthServiceError(404, `Login session not found: ${sessionId}`);
    }

    return this.cloneSession(session);
  }

  submitInput(sessionId: string, requestId: string, value: string): PiOAuthLoginSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new PiAuthServiceError(404, `Login session not found: ${sessionId}`);
    }

    const pendingInput = session.pendingInput;
    if (!pendingInput) {
      throw new PiAuthServiceError(409, 'No login input is currently pending');
    }

    if (pendingInput.request.id !== requestId) {
      throw new PiAuthServiceError(409, 'Input request is no longer active');
    }

    if (!pendingInput.request.allowEmpty && value.trim().length === 0) {
      throw new PiAuthServiceError(400, 'Input is required');
    }

    pendingInput.resolve(value);

    return this.cloneSession(session);
  }

  cancel(sessionId: string): PiOAuthLoginSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new PiAuthServiceError(404, `Login session not found: ${sessionId}`);
    }

    if (session.status === 'succeeded' || session.status === 'failed' || session.status === 'cancelled') {
      return this.cloneSession(session);
    }

    session.status = 'cancelled';
    session.error = undefined;
    session.abortController.abort();
    this.touch(session);

    if (session.pendingInput) {
      session.pendingInput.reject(new Error('Login cancelled'));
    }

    this.scheduleCleanup(session);

    return this.cloneSession(session);
  }

  private async runLogin(session: PiOAuthLoginSessionInternal, authStorage: AuthStorageLike): Promise<void> {
    try {
      await authStorage.login(session.providerId, {
        onAuth: (info) => {
          session.authUrl = info.url;
          session.authInstructions = info.instructions;
          this.touch(session);
        },
        onPrompt: (prompt) => this.awaitInput(session, {
          type: 'prompt',
          message: prompt.message,
          placeholder: prompt.placeholder,
          allowEmpty: prompt.allowEmpty,
        }),
        onProgress: (message) => {
          if (!message) return;
          session.progressMessages = [...session.progressMessages, message].slice(-MAX_PROGRESS_MESSAGES);
          this.touch(session);
        },
        onManualCodeInput: () => this.awaitInput(session, {
          type: 'manual-code',
          message: 'Paste the redirect URL or authorization code',
          placeholder: 'https://.../callback?code=...',
          allowEmpty: false,
        }),
        signal: session.abortController.signal,
      });

      if (session.status !== 'cancelled') {
        session.status = 'succeeded';
        session.error = undefined;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const cancelled = session.abortController.signal.aborted || message === 'Login cancelled';

      if (cancelled) {
        session.status = 'cancelled';
        session.error = undefined;
      } else {
        session.status = 'failed';
        session.error = message;
      }
    } finally {
      if (session.pendingInput) {
        session.pendingInput.reject(new Error('Login finished'));
      }

      session.pendingInput = undefined;
      session.inputRequest = undefined;
      this.touch(session);
      this.scheduleCleanup(session);
    }
  }

  private awaitInput(
    session: PiOAuthLoginSessionInternal,
    requestBase: Omit<PiOAuthLoginInputRequest, 'id'>,
  ): Promise<string> {
    if (session.pendingInput) {
      return Promise.reject(new Error('Another login input request is already pending'));
    }

    const request: PiOAuthLoginInputRequest = {
      id: crypto.randomUUID(),
      ...requestBase,
    };

    session.status = 'awaiting_input';
    session.inputRequest = request;
    this.touch(session);

    return new Promise((resolve, reject) => {
      const settle = () => {
        if (session.pendingInput?.request.id !== request.id) {
          return;
        }

        session.pendingInput = undefined;
        session.inputRequest = undefined;

        if (session.status === 'awaiting_input') {
          session.status = 'running';
        }

        this.touch(session);
      };

      session.pendingInput = {
        request,
        resolve: (value: string) => {
          settle();
          resolve(value);
        },
        reject: (error: Error) => {
          settle();
          reject(error);
        },
      };

      if (session.abortController.signal.aborted) {
        session.pendingInput.reject(new Error('Login cancelled'));
      }
    });
  }

  private touch(session: PiOAuthLoginSessionInternal): void {
    session.updatedAt = this.now().toISOString();
  }

  private scheduleCleanup(session: PiOAuthLoginSessionInternal): void {
    if (session.cleanupHandle) {
      this.clearTimer(session.cleanupHandle);
    }

    session.cleanupHandle = this.setTimer(() => {
      this.sessions.delete(session.id);
    }, LOGIN_SESSION_RETENTION_MS);
  }

  private cloneSession(session: PiOAuthLoginSessionInternal): PiOAuthLoginSession {
    return {
      id: session.id,
      providerId: session.providerId,
      providerName: session.providerName,
      status: session.status,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      authUrl: session.authUrl,
      authInstructions: session.authInstructions,
      progressMessages: [...session.progressMessages],
      inputRequest: session.inputRequest ? { ...session.inputRequest } : undefined,
      error: session.error,
    };
  }
}

export const piLoginManager = new PiLoginManager();
