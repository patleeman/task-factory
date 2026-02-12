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

function writeWorkspaceConfig(workspacePath: string, agentsMdPath?: string): void {
  const piDir = join(workspacePath, '.pi');
  mkdirSync(piDir, { recursive: true });

  const config = {
    taskLocations: ['.pi/tasks'],
    defaultTaskLocation: '.pi/tasks',
    ...(agentsMdPath ? { agentsMdPath } : {}),
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

describe('workspace AGENTS.md loading', () => {
  it('loads content from a relative path resolved from workspace root', async () => {
    setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');
    const agentsFile = join(workspacePath, 'config', 'AGENTS.workspace.md');
    mkdirSync(join(workspacePath, 'config'), { recursive: true });
    writeFileSync(agentsFile, 'workspace rule', 'utf-8');

    const { loadWorkspaceAgentsMd } = await import('../src/pi-integration.js');
    const loaded = loadWorkspaceAgentsMd(workspacePath, 'config/AGENTS.workspace.md');

    expect(loaded).toBe('workspace rule');
  });

  it('returns null and warns when configured file is missing or unreadable', async () => {
    setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { loadWorkspaceAgentsMd } = await import('../src/pi-integration.js');

    const missing = loadWorkspaceAgentsMd(workspacePath, 'does-not-exist.md');
    expect(missing).toBeNull();

    const unreadableDir = join(workspacePath, 'not-a-file');
    mkdirSync(unreadableDir, { recursive: true });

    const unreadable = loadWorkspaceAgentsMd(workspacePath, 'not-a-file');
    expect(unreadable).toBeNull();

    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls.some(call => String(call[0]).includes('not found'))).toBe(true);
    expect(warnSpy.mock.calls.some(call => String(call[0]).includes('not readable'))).toBe(true);
  });
});

describe('buildAgentContext AGENTS.md merge behavior', () => {
  it('merges workspace AGENTS.md after global AGENTS.md when configured', async () => {
    const homePath = setTempHome();
    const workspaceId = 'ws-merge';
    const workspacePath = createTempDir('pi-factory-workspace-');

    writeGlobalAgentsMd(homePath, 'GLOBAL RULES');
    writeWorkspaceConfig(workspacePath, 'config/AGENTS.workspace.md');
    mkdirSync(join(workspacePath, 'config'), { recursive: true });
    writeFileSync(join(workspacePath, 'config', 'AGENTS.workspace.md'), 'WORKSPACE RULES', 'utf-8');
    registerWorkspace(homePath, workspaceId, workspacePath);

    const { buildAgentContext } = await import('../src/pi-integration.js');
    const context = buildAgentContext(workspaceId, [], workspacePath);

    expect(context.globalRules).toContain('GLOBAL RULES');
    expect(context.globalRules).toContain('WORKSPACE RULES');
    expect(context.globalRules.indexOf('GLOBAL RULES')).toBeLessThan(
      context.globalRules.indexOf('WORKSPACE RULES'),
    );
  });

  it('merges using workspacePath when workspaceId is not provided', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');

    writeGlobalAgentsMd(homePath, 'GLOBAL RULES');
    writeWorkspaceConfig(workspacePath, 'config/AGENTS.workspace.md');
    mkdirSync(join(workspacePath, 'config'), { recursive: true });
    writeFileSync(join(workspacePath, 'config', 'AGENTS.workspace.md'), 'WORKSPACE RULES', 'utf-8');

    const { buildAgentContext } = await import('../src/pi-integration.js');
    const context = buildAgentContext(undefined, [], workspacePath);

    expect(context.globalRules).toContain('GLOBAL RULES');
    expect(context.globalRules).toContain('WORKSPACE RULES');
  });

  it('falls back to global AGENTS.md when no workspace agentsMdPath is configured', async () => {
    const homePath = setTempHome();
    const workspaceId = 'ws-global-only';
    const workspacePath = createTempDir('pi-factory-workspace-');

    writeGlobalAgentsMd(homePath, 'GLOBAL ONLY RULES');
    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, workspaceId, workspacePath);

    const { buildAgentContext } = await import('../src/pi-integration.js');
    const context = buildAgentContext(workspaceId, [], workspacePath);

    expect(context.globalRules).toBe('GLOBAL ONLY RULES');
  });

  it('reloads workspace AGENTS.md from disk on each call without restart', async () => {
    const homePath = setTempHome();
    const workspaceId = 'ws-reload';
    const workspacePath = createTempDir('pi-factory-workspace-');
    const workspaceAgentsPath = join(workspacePath, 'config', 'AGENTS.workspace.md');

    writeGlobalAgentsMd(homePath, 'GLOBAL RULES');
    writeWorkspaceConfig(workspacePath, 'config/AGENTS.workspace.md');
    mkdirSync(join(workspacePath, 'config'), { recursive: true });
    writeFileSync(workspaceAgentsPath, 'WORKSPACE RULES V1', 'utf-8');
    registerWorkspace(homePath, workspaceId, workspacePath);

    const { buildAgentContext } = await import('../src/pi-integration.js');

    const first = buildAgentContext(workspaceId, [], workspacePath).globalRules;
    expect(first).toContain('WORKSPACE RULES V1');

    writeFileSync(workspaceAgentsPath, 'WORKSPACE RULES V2', 'utf-8');

    const second = buildAgentContext(workspaceId, [], workspacePath).globalRules;
    expect(second).toContain('WORKSPACE RULES V2');
    expect(second).not.toContain('WORKSPACE RULES V1');
  });
});
