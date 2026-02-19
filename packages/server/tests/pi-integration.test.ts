import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
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
  const registryDir = join(homePath, '.taskfactory');
  mkdirSync(registryDir, { recursive: true });
  writeFileSync(
    join(registryDir, 'workspaces.json'),
    JSON.stringify([{ id: workspaceId, path: workspacePath, name: 'workspace' }], null, 2),
    'utf-8',
  );
}

function registerLegacyWorkspace(homePath: string, workspaceId: string, workspacePath: string): void {
  const legacyRegistryDir = join(homePath, '.pi', 'factory');
  mkdirSync(legacyRegistryDir, { recursive: true });
  writeFileSync(
    join(legacyRegistryDir, 'workspaces.json'),
    JSON.stringify([{ id: workspaceId, path: workspacePath, name: 'workspace' }], null, 2),
    'utf-8',
  );
}

function writeLegacyFactorySettings(homePath: string, settings: Record<string, unknown>): void {
  const legacyDir = join(homePath, '.pi', 'factory');
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf-8');
}

function writeWorkspaceConfig(workspacePath: string): void {
  const taskfactoryDir = join(workspacePath, '.taskfactory');
  mkdirSync(taskfactoryDir, { recursive: true });

  const config = {
    taskLocations: ['.taskfactory/tasks'],
    defaultTaskLocation: '.taskfactory/tasks',
  };

  writeFileSync(join(taskfactoryDir, 'factory.json'), JSON.stringify(config, null, 2), 'utf-8');
}

function writeGlobalAgentsMd(homePath: string, content: string): void {
  const agentDir = join(homePath, '.pi', 'agent');
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'AGENTS.md'), content, 'utf-8');
}

function writeWorkspaceSkill(workspacePath: string, skillId: string, content = 'Skill body'): void {
  const skillDir = join(workspacePath, 'skills', skillId);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${skillId}\ndescription: ${skillId} description\nallowed-tools: read, bash\n---\n\n${content}\n`,
    'utf-8',
  );
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

describe('pi skill/extension runtime resolution', () => {
  it('does not load legacy ~/.pi/agent/skills without explicit migration', async () => {
    const homePath = setTempHome();

    const legacySkillDir = join(homePath, '.pi', 'agent', 'skills', 'legacy-skill');
    mkdirSync(legacySkillDir, { recursive: true });
    writeFileSync(
      join(legacySkillDir, 'SKILL.md'),
      '---\nname: legacy-skill\ndescription: Legacy skill\n---\n\nLegacy content.\n',
      'utf-8',
    );

    const { discoverPiSkills, loadPiSkill } = await import('../src/pi-integration.js');

    expect(discoverPiSkills()).toEqual([]);
    expect(loadPiSkill('legacy-skill')).toBeNull();
  });

  it('does not load legacy ~/.pi/agent/extensions without explicit migration', async () => {
    const homePath = setTempHome();

    const legacyExtensionDir = join(homePath, '.pi', 'agent', 'extensions', 'legacy-ext');
    mkdirSync(legacyExtensionDir, { recursive: true });
    writeFileSync(
      join(legacyExtensionDir, 'package.json'),
      JSON.stringify({ name: 'legacy-ext', version: '1.0.0' }, null, 2),
      'utf-8',
    );

    const { discoverPiExtensions } = await import('../src/pi-integration.js');

    expect(discoverPiExtensions()).toEqual([]);
  });
});

describe('workspace skill discovery + enablement', () => {
  it('discovers skills from the current workspace instead of global ~/.taskfactory/agent/skills', async () => {
    const homePath = setTempHome();
    const workspaceId = 'ws-skills';
    const workspacePath = createTempDir('pi-factory-workspace-');

    registerWorkspace(homePath, workspaceId, workspacePath);
    writeWorkspaceSkill(workspacePath, 'workspace-skill');

    const globalSkillDir = join(homePath, '.taskfactory', 'agent', 'skills', 'global-skill');
    mkdirSync(globalSkillDir, { recursive: true });
    writeFileSync(
      join(globalSkillDir, 'SKILL.md'),
      '---\nname: global-skill\ndescription: global\n---\n\nglobal\n',
      'utf-8',
    );

    const { discoverWorkspacePiSkills, getEnabledSkillsForWorkspace } = await import('../src/pi-integration.js');

    const discovered = discoverWorkspacePiSkills(workspacePath);
    expect(discovered.map((skill) => skill.id)).toEqual(['workspace-skill']);

    const enabled = getEnabledSkillsForWorkspace(workspaceId, workspacePath);
    expect(enabled.map((skill) => skill.id)).toEqual(['workspace-skill']);
  });

  it('defaults to all discovered workspace skills when no workspace selection is saved', async () => {
    const homePath = setTempHome();
    const workspaceId = 'ws-default-all';
    const workspacePath = createTempDir('pi-factory-workspace-');

    registerWorkspace(homePath, workspaceId, workspacePath);
    writeWorkspaceSkill(workspacePath, 'skill-a');
    writeWorkspaceSkill(workspacePath, 'skill-b');

    const { getEnabledSkillsForWorkspace } = await import('../src/pi-integration.js');

    const enabled = getEnabledSkillsForWorkspace(workspaceId, workspacePath);
    expect(enabled.map((skill) => skill.id)).toEqual(['skill-a', 'skill-b']);
  });

  it('respects persisted workspace skill deactivations', async () => {
    const homePath = setTempHome();
    const workspaceId = 'ws-filtered';
    const workspacePath = createTempDir('pi-factory-workspace-');

    registerWorkspace(homePath, workspaceId, workspacePath);
    writeWorkspaceSkill(workspacePath, 'skill-a');
    writeWorkspaceSkill(workspacePath, 'skill-b');

    const { saveWorkspacePiConfig, getEnabledSkillsForWorkspace } = await import('../src/pi-integration.js');

    saveWorkspacePiConfig(workspaceId, {
      skills: { enabled: ['skill-b'], config: {} },
    });

    const enabled = getEnabledSkillsForWorkspace(workspaceId, workspacePath);
    expect(enabled.map((skill) => skill.id)).toEqual(['skill-b']);
  });

  it('keeps explicit empty workspace selection (all skills disabled)', async () => {
    const homePath = setTempHome();
    const workspaceId = 'ws-empty';
    const workspacePath = createTempDir('pi-factory-workspace-');

    registerWorkspace(homePath, workspaceId, workspacePath);
    writeWorkspaceSkill(workspacePath, 'skill-a');

    const { saveWorkspacePiConfig, getEnabledSkillsForWorkspace } = await import('../src/pi-integration.js');

    saveWorkspacePiConfig(workspaceId, {
      skills: { enabled: [], config: {} },
    });

    const enabled = getEnabledSkillsForWorkspace(workspaceId, workspacePath);
    expect(enabled).toEqual([]);
  });
});

describe('workspace shared context', () => {
  it('loads content from .taskfactory/workspace-context.md when present', async () => {
    setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');

    const { saveWorkspaceSharedContext, loadWorkspaceSharedContext } = await import('../src/pi-integration.js');
    saveWorkspaceSharedContext(workspacePath, 'workspace context');

    const loaded = loadWorkspaceSharedContext(workspacePath);
    expect(loaded).toBe('workspace context');
  });

  it('falls back to legacy .pi/workspace-context.md when .taskfactory file is absent', async () => {
    setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');
    const legacyContextPath = join(workspacePath, '.pi', 'workspace-context.md');

    mkdirSync(join(workspacePath, '.pi'), { recursive: true });
    writeFileSync(legacyContextPath, 'legacy context', 'utf-8');

    const { loadWorkspaceSharedContext } = await import('../src/pi-integration.js');

    expect(loadWorkspaceSharedContext(workspacePath)).toBe('legacy context');
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

  it('does not read or migrate legacy ~/.pi/factory workspace registry entries at runtime', async () => {
    const homePath = setTempHome();
    const workspaceId = 'ws-legacy-registry';
    const workspacePath = createTempDir('pi-factory-workspace-');

    writeGlobalAgentsMd(homePath, 'GLOBAL RULES');
    writeWorkspaceConfig(workspacePath);
    registerLegacyWorkspace(homePath, workspaceId, workspacePath);

    const { buildAgentContext } = await import('../src/pi-integration.js');
    const context = buildAgentContext(workspaceId, []);

    expect(context.globalRules).toContain('GLOBAL RULES');

    const migratedRegistryPath = join(homePath, '.taskfactory', 'workspaces.json');
    expect(existsSync(migratedRegistryPath)).toBe(false);
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

  it('does not load legacy ~/.pi/factory/settings.json without explicit migration', async () => {
    const homePath = setTempHome();
    writeLegacyFactorySettings(homePath, {
      theme: 'legacy-theme',
      voiceInputHotkey: 'Alt+V',
    });

    const { loadPiFactorySettings, savePiFactorySettings } = await import('../src/pi-integration.js');

    expect(loadPiFactorySettings()).toBeNull();

    const settingsPath = join(homePath, '.taskfactory', 'settings.json');
    expect(existsSync(settingsPath)).toBe(false);

    savePiFactorySettings({
      theme: 'new-theme',
      voiceInputHotkey: 'Ctrl+Space',
    });

    expect(JSON.parse(readFileSync(settingsPath, 'utf-8'))).toEqual({
      theme: 'new-theme',
      voiceInputHotkey: 'Ctrl+Space',
    });
  });
});
