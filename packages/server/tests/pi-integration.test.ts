import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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
  const registryDir = join(homePath, '.pi', 'factory');
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

  const config = {
    taskLocations: ['.pi/tasks'],
    defaultTaskLocation: '.pi/tasks',
  };

  writeFileSync(join(piDir, 'factory.json'), JSON.stringify(config, null, 2), 'utf-8');
}

function writeGlobalAgentsMd(homePath: string, content: string): void {
  const agentDir = join(homePath, '.pi', 'agent');
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'AGENTS.md'), content, 'utf-8');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();

  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;

  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

describe('workspace shared context', () => {
  it('loads content from .pi/workspace-context.md when present', async () => {
    setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');

    const { saveWorkspaceSharedContext, loadWorkspaceSharedContext } = await import('../src/pi-integration.js');
    saveWorkspaceSharedContext(workspacePath, 'workspace context');

    const loaded = loadWorkspaceSharedContext(workspacePath);
    expect(loaded).toBe('workspace context');
  });

  it('returns null and warns when shared context path is unreadable', async () => {
    setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');

    const { getWorkspaceSharedContextPath, loadWorkspaceSharedContext } = await import('../src/pi-integration.js');
    const contextPath = getWorkspaceSharedContextPath(workspacePath);
    mkdirSync(contextPath, { recursive: true }); // directory where file should be

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const loaded = loadWorkspaceSharedContext(workspacePath);

    expect(loaded).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('saveWorkspaceSharedContext creates missing directories and overwrites content', async () => {
    setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');

    const { saveWorkspaceSharedContext, loadWorkspaceSharedContext } = await import('../src/pi-integration.js');

    saveWorkspaceSharedContext(workspacePath, 'v1');
    expect(loadWorkspaceSharedContext(workspacePath)).toBe('v1');

    saveWorkspaceSharedContext(workspacePath, 'v2');
    expect(loadWorkspaceSharedContext(workspacePath)).toBe('v2');
  });
});

describe('buildAgentContext shared context merge behavior', () => {
  it('merges workspace shared context after global AGENTS.md when workspaceId resolves via registry', async () => {
    const homePath = setTempHome();
    const workspaceId = 'ws-merge';
    const workspacePath = createTempDir('pi-factory-workspace-');

    writeGlobalAgentsMd(homePath, 'GLOBAL RULES');
    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, workspaceId, workspacePath);

    const { saveWorkspaceSharedContext, buildAgentContext } = await import('../src/pi-integration.js');
    saveWorkspaceSharedContext(workspacePath, 'SHARED CONTEXT RULES');

    const context = buildAgentContext(workspaceId, []);

    expect(context.globalRules).toContain('GLOBAL RULES');
    expect(context.globalRules).toContain('SHARED CONTEXT RULES');
    expect(context.globalRules.indexOf('GLOBAL RULES')).toBeLessThan(
      context.globalRules.indexOf('SHARED CONTEXT RULES'),
    );
  });

  it('merges using workspacePath when workspaceId is not provided', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');

    writeGlobalAgentsMd(homePath, 'GLOBAL RULES');
    writeWorkspaceConfig(workspacePath);

    const { saveWorkspaceSharedContext, buildAgentContext } = await import('../src/pi-integration.js');
    saveWorkspaceSharedContext(workspacePath, 'SHARED CONTEXT RULES');

    const context = buildAgentContext(undefined, [], workspacePath);

    expect(context.globalRules).toContain('GLOBAL RULES');
    expect(context.globalRules).toContain('SHARED CONTEXT RULES');
  });

  it('falls back to global AGENTS.md when no shared context file is present', async () => {
    const homePath = setTempHome();
    const workspaceId = 'ws-global-only';
    const workspacePath = createTempDir('pi-factory-workspace-');

    writeGlobalAgentsMd(homePath, 'GLOBAL ONLY RULES');
    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, workspaceId, workspacePath);

    const { buildAgentContext } = await import('../src/pi-integration.js');
    const context = buildAgentContext(workspaceId, []);

    expect(context.globalRules).toBe('GLOBAL ONLY RULES');
  });

  it('reloads workspace shared context from disk on each call without restart', async () => {
    const homePath = setTempHome();
    const workspaceId = 'ws-reload';
    const workspacePath = createTempDir('pi-factory-workspace-');

    writeGlobalAgentsMd(homePath, 'GLOBAL RULES');
    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, workspaceId, workspacePath);

    const { saveWorkspaceSharedContext, buildAgentContext } = await import('../src/pi-integration.js');

    saveWorkspaceSharedContext(workspacePath, 'SHARED CONTEXT V1');
    const first = buildAgentContext(workspaceId, [], workspacePath).globalRules;
    expect(first).toContain('SHARED CONTEXT V1');

    saveWorkspaceSharedContext(workspacePath, 'SHARED CONTEXT V2');
    const second = buildAgentContext(workspaceId, [], workspacePath).globalRules;

    expect(second).toContain('SHARED CONTEXT V2');
    expect(second).not.toContain('SHARED CONTEXT V1');
  });
});

describe('pi factory settings persistence', () => {
  it('persists voice input hotkey through save/load settings.json', async () => {
    setTempHome();

    const { savePiFactorySettings, loadPiFactorySettings } = await import('../src/pi-integration.js');

    savePiFactorySettings({
      theme: 'dark',
      voiceInputHotkey: 'Alt+Space',
    });

    expect(loadPiFactorySettings()).toEqual({
      theme: 'dark',
      voiceInputHotkey: 'Alt+Space',
    });
  });
});
