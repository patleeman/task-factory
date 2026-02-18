import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { PlanningMessage } from '@task-factory/shared';

const createAgentSessionMock = vi.fn();

vi.mock('@mariozechner/pi-coding-agent', () => ({
  createAgentSession: (...args: any[]) => createAgentSessionMock(...args),
  AuthStorage: class AuthStorage {},
  DefaultResourceLoader: class DefaultResourceLoader {
    async reload(): Promise<void> {
      // no-op for tests
    }
  },
  ModelRegistry: class ModelRegistry {
    find(): undefined {
      return undefined;
    }
  },
  SessionManager: {
    create: () => ({}),
  },
  SettingsManager: {
    create: () => ({
      applyOverrides: () => {},
    }),
  },
}));

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempRoots: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function setTempHome(): string {
  const homePath = createTempDir('pi-factory-home-');
  process.env.HOME = homePath;
  process.env.USERPROFILE = homePath;
  return homePath;
}

function registerWorkspace(homePath: string, workspaceId: string, workspacePath: string): void {
  const registryDir = join(homePath, '.taskfactory');
  mkdirSync(registryDir, { recursive: true });
  writeFileSync(
    join(registryDir, 'workspaces.json'),
    JSON.stringify([{ id: workspaceId, path: workspacePath, name: 'workspace' }], null, 2),
    'utf-8',
  );
}

function writeWorkspaceConfig(workspacePath: string): void {
  const piDir = join(workspacePath, '.pi');
  mkdirSync(piDir, { recursive: true });

  writeFileSync(
    join(piDir, 'factory.json'),
    JSON.stringify({
      taskLocations: ['.pi/tasks'],
      defaultTaskLocation: '.pi/tasks',
      wipLimits: {},
      gitIntegration: {
        enabled: true,
        defaultBranch: 'main',
        branchPrefix: 'feat/',
      },
    }, null, 2),
    'utf-8',
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  createAgentSessionMock.mockReset();

  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;

  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

describe('planning foreman slash command helpers', () => {
  it('parses supported commands and keeps absolute paths as normal text', async () => {
    const { parseForemanSlashCommand } = await import('../src/planning-agent-service.js');

    expect(parseForemanSlashCommand('/new')).toEqual({ kind: 'new' });
    expect(parseForemanSlashCommand('/help')).toEqual({ kind: 'help' });
    expect(parseForemanSlashCommand('/skill:tdd-feature add tests')).toEqual({
      kind: 'skill',
      skillName: 'tdd-feature',
      args: 'add tests',
    });
    expect(parseForemanSlashCommand('/model')).toEqual({ kind: 'unknown', command: '/model' });
    expect(parseForemanSlashCommand('/')).toEqual({ kind: 'unknown', command: '/' });
    expect(parseForemanSlashCommand('/tmp/project')).toEqual({ kind: 'none' });
    expect(parseForemanSlashCommand('plan this')).toEqual({ kind: 'none' });
  });

  it('keeps /skill at the start while injecting state contract context', async () => {
    const { buildForemanTurnContent } = await import('../src/planning-agent-service.js');

    const regularTurn = buildForemanTurnContent('Please investigate this');
    expect(regularTurn).toContain('## Current Turn State');
    expect(regularTurn).toContain('<mode>foreman</mode>');
    expect(regularTurn).toContain('Please investigate this');

    const skillTurn = buildForemanTurnContent('/skill:tdd-feature', {
      additionalContextSections: ['BOOTSTRAP CONTEXT'],
    });

    expect(skillTurn.startsWith('/skill:tdd-feature ')).toBe(true);
    expect(skillTurn).toContain('<state_contract version="2">');
    expect(skillTurn).toContain('<mode>foreman</mode>');
    expect(skillTurn).toContain('BOOTSTRAP CONTEXT');
  });
});

describe('planning slash command handling', () => {
  it('treats /new as a planning reset and does not append a user prompt message', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');
    const workspaceId = 'ws-slash-new';
    const oldSessionId = 'session-old';
    const now = new Date().toISOString();

    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, workspaceId, workspacePath);

    const taskfactoryDir = join(workspacePath, '.taskfactory');
    mkdirSync(taskfactoryDir, { recursive: true });

    const oldMessages: PlanningMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Old planning context',
        timestamp: now,
        sessionId: oldSessionId,
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Old planning response',
        timestamp: now,
        sessionId: oldSessionId,
      },
    ];

    writeFileSync(join(taskfactoryDir, 'planning-session-id.txt'), oldSessionId, 'utf-8');
    writeFileSync(join(taskfactoryDir, 'planning-messages.json'), JSON.stringify(oldMessages, null, 2), 'utf-8');

    const { sendPlanningMessage, getPlanningMessages } = await import('../src/planning-agent-service.js');

    const events: any[] = [];
    await sendPlanningMessage(workspaceId, '/new', (event) => events.push(event));

    const resetEvent = events.find((event) => event.type === 'planning:session_reset');
    expect(resetEvent).toBeTruthy();

    const userSlashMessageEvent = events.find(
      (event) => event.type === 'planning:message'
        && event.message?.role === 'user'
        && event.message?.content === '/new',
    );
    expect(userSlashMessageEvent).toBeUndefined();

    const persistedMessages = JSON.parse(readFileSync(join(taskfactoryDir, 'planning-messages.json'), 'utf-8'));
    expect(persistedMessages).toEqual([]);

    const archivePath = join(taskfactoryDir, 'planning-sessions', `${oldSessionId}.json`);
    expect(existsSync(archivePath)).toBe(true);
    expect(JSON.parse(readFileSync(archivePath, 'utf-8'))).toEqual(oldMessages);

    expect(getPlanningMessages(workspaceId)).toEqual([]);
  });

  it('returns help guidance for /help and unsupported slash commands without opening an agent turn', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');
    const workspaceId = 'ws-slash-help';

    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, workspaceId, workspacePath);

    const { sendPlanningMessage, getPlanningMessages } = await import('../src/planning-agent-service.js');

    const events: any[] = [];
    await sendPlanningMessage(workspaceId, '/help', (event) => events.push(event));

    const helpEvent = events.find((event) => event.type === 'planning:message');
    expect(helpEvent).toBeTruthy();
    expect(helpEvent.message.role).toBe('system');
    expect(helpEvent.message.content).toContain('/new');
    expect(helpEvent.message.content).toContain('/skill:<name> [args]');
    expect(helpEvent.message.content).toContain('/help');
    expect(events.some((event) => event.type === 'planning:status')).toBe(false);

    await sendPlanningMessage(workspaceId, '/model', (event) => events.push(event));

    const unknownEvent = events
      .filter((event) => event.type === 'planning:message')
      .map((event) => event.message)
      .find((message: PlanningMessage) => message.content.includes('Unknown slash command'));

    expect(unknownEvent).toBeTruthy();
    expect(unknownEvent?.content).toContain('`/model`');

    const history = getPlanningMessages(workspaceId);
    expect(history.every((message) => message.role === 'system')).toBe(true);
  });

  it('surfaces provider stopReason=error messages in foreman chat log', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');
    const workspaceId = 'ws-provider-stop-error';

    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, workspaceId, workspacePath);

    let subscriber: ((event: any) => void) | undefined;
    const providerError = 'You have hit your ChatGPT usage limit (plus plan). Try again in ~90 min.';

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: (listener: (event: any) => void) => {
          subscriber = listener;
          return () => {};
        },
        prompt: async () => {
          subscriber?.({
            type: 'message_end',
            message: {
              role: 'assistant',
              stopReason: 'error',
              errorMessage: providerError,
              content: [],
            },
          });
        },
        abort: async () => {},
      },
    });

    const { sendPlanningMessage, getPlanningMessages } = await import('../src/planning-agent-service.js');

    const events: any[] = [];
    await sendPlanningMessage(workspaceId, 'continue', (event) => events.push(event));

    const errorMessage = events
      .filter((event) => event.type === 'planning:message')
      .map((event) => event.message as PlanningMessage)
      .find((message) => (
        message.role === 'system'
        && message.content.includes('Foreman turn failed:')
        && message.content.includes('ChatGPT usage limit')
      ));

    expect(errorMessage).toBeTruthy();

    const history = getPlanningMessages(workspaceId);
    expect(history.some((message) => message.id === errorMessage?.id)).toBe(true);
  });

  it('surfaces auto-retry notices in foreman chat log', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');
    const workspaceId = 'ws-provider-auto-retry';

    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, workspaceId, workspacePath);

    let subscriber: ((event: any) => void) | undefined;

    createAgentSessionMock.mockResolvedValue({
      session: {
        subscribe: (listener: (event: any) => void) => {
          subscriber = listener;
          return () => {};
        },
        prompt: async () => {
          subscriber?.({
            type: 'auto_retry_start',
            attempt: 1,
            maxAttempts: 3,
            delayMs: 2500,
            errorMessage: '429 rate limit: too many requests',
          });

          subscriber?.({
            type: 'auto_retry_end',
            success: true,
            attempt: 2,
          });

          subscriber?.({
            type: 'message_end',
            message: {
              role: 'assistant',
              stopReason: 'stop',
              content: [{ type: 'text', text: 'Recovered after retry.' }],
            },
          });
        },
        abort: async () => {},
      },
    });

    const { sendPlanningMessage } = await import('../src/planning-agent-service.js');

    const events: any[] = [];
    await sendPlanningMessage(workspaceId, 'continue', (event) => events.push(event));

    const retryStartMessage = events
      .filter((event) => event.type === 'planning:message')
      .map((event) => event.message as PlanningMessage)
      .find((message) => (
        message.role === 'system'
        && message.content.includes('Foreman retrying after provider error')
        && message.metadata?.kind === 'auto-retry'
        && message.metadata?.phase === 'start'
      ));

    const retryEndMessage = events
      .filter((event) => event.type === 'planning:message')
      .map((event) => event.message as PlanningMessage)
      .find((message) => (
        message.role === 'system'
        && message.content.includes('Foreman retry succeeded on attempt 2')
        && message.metadata?.kind === 'auto-retry'
        && message.metadata?.phase === 'end'
      ));

    expect(retryStartMessage).toBeTruthy();
    expect(retryEndMessage).toBeTruthy();
  });

  it('surfaces thrown provider errors in foreman chat log after retries', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');
    const workspaceId = 'ws-provider-throw-error';

    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, workspaceId, workspacePath);

    const promptError = new Error('Rate limit exceeded');

    createAgentSessionMock.mockImplementation(() => ({
      session: {
        subscribe: () => () => {},
        prompt: async () => {
          throw promptError;
        },
        abort: async () => {},
      },
    }));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { sendPlanningMessage } = await import('../src/planning-agent-service.js');

    const events: any[] = [];
    await sendPlanningMessage(workspaceId, 'continue', (event) => events.push(event));

    const finalErrorMessage = events
      .filter((event) => event.type === 'planning:message')
      .map((event) => event.message as PlanningMessage)
      .find((message) => (
        message.role === 'system'
        && message.content.includes('Foreman turn failed: Rate limit exceeded')
      ));

    expect(finalErrorMessage).toBeTruthy();
    expect(createAgentSessionMock).toHaveBeenCalledTimes(2);

    errorSpy.mockRestore();
  });
});
