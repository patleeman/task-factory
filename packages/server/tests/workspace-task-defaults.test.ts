import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { TaskDefaults } from '@task-factory/shared';

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

function writeFactorySettings(homePath: string, settings: Record<string, unknown>): void {
  const factoryDir = join(homePath, '.taskfactory');
  mkdirSync(factoryDir, { recursive: true });
  writeFileSync(join(factoryDir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf-8');
}

function registerWorkspace(homePath: string, workspaceId: string, workspacePath: string): void {
  const factoryDir = join(homePath, '.taskfactory');
  mkdirSync(factoryDir, { recursive: true });
  writeFileSync(
    join(factoryDir, 'workspaces.json'),
    JSON.stringify([{ id: workspaceId, path: workspacePath, name: 'workspace' }], null, 2),
    'utf-8',
  );
}

function writeWorkspaceTaskDefaults(homePath: string, workspaceId: string, defaults: Partial<TaskDefaults>): void {
  const workspaceDir = join(homePath, '.taskfactory', 'workspaces', workspaceId);
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(join(workspaceDir, 'task-defaults.json'), JSON.stringify(defaults, null, 2), 'utf-8');
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

describe('workspace task defaults', () => {
  it('applies workspace overrides over global defaults, then falls back to global for omitted fields', async () => {
    const homePath = setTempHome();

    writeFactorySettings(homePath, {
      taskDefaults: {
        planningModelConfig: {
          provider: 'anthropic',
          modelId: 'claude-sonnet-4',
          thinkingLevel: 'low',
        },
        executionModelConfig: {
          provider: 'openai',
          modelId: 'gpt-4o',
        },
        prePlanningSkills: [],
        preExecutionSkills: ['checkpoint'],
        postExecutionSkills: ['checkpoint', 'code-review'],
      },
    });

    writeWorkspaceTaskDefaults(homePath, 'ws-1', {
      executionModelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
      },
      postExecutionSkills: ['security-review'],
    });

    const { loadTaskDefaultsForWorkspace } = await import('../src/task-defaults-service.js');
    const resolved = loadTaskDefaultsForWorkspace('ws-1');

    expect(resolved.planningModelConfig).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4',
      thinkingLevel: 'low',
    });
    expect(resolved.executionModelConfig).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4',
    });
    expect(resolved.preExecutionSkills).toEqual(['checkpoint']);
    expect(resolved.postExecutionSkills).toEqual(['security-review']);
  });

  it('saves and loads workspace defaults without mutating global defaults', async () => {
    const homePath = setTempHome();

    writeFactorySettings(homePath, {
      taskDefaults: {
        planningModelConfig: {
          provider: 'openai',
          modelId: 'gpt-4o',
        },
        executionModelConfig: {
          provider: 'openai',
          modelId: 'gpt-4o',
        },
        prePlanningSkills: [],
        preExecutionSkills: ['checkpoint'],
        postExecutionSkills: ['checkpoint', 'code-review'],
      },
    });

    const { loadTaskDefaults, loadTaskDefaultsForWorkspace, saveWorkspaceTaskDefaults } = await import('../src/task-defaults-service.js');

    const savedWorkspaceDefaults = saveWorkspaceTaskDefaults('ws-save', {
      planningModelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
      },
      executionModelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
      },
      modelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
      },
      prePlanningSkills: [],
      preExecutionSkills: ['security-review'],
      postExecutionSkills: ['security-review'],
    });

    const globalDefaults = loadTaskDefaults();
    const workspaceDefaults = loadTaskDefaultsForWorkspace('ws-save');

    expect(globalDefaults.executionModelConfig).toEqual({
      provider: 'openai',
      modelId: 'gpt-4o',
    });
    expect(workspaceDefaults).toEqual(savedWorkspaceDefaults);
  });

  it('persists only workspace overrides so unchanged fields keep following global defaults', async () => {
    const homePath = setTempHome();

    writeFactorySettings(homePath, {
      taskDefaults: {
        planningModelConfig: {
          provider: 'openai',
          modelId: 'gpt-4o',
        },
        executionModelConfig: {
          provider: 'openai',
          modelId: 'gpt-4o',
        },
        prePlanningSkills: [],
        preExecutionSkills: ['checkpoint'],
        postExecutionSkills: ['checkpoint', 'code-review'],
      },
    });

    const { loadTaskDefaultsForWorkspace, saveWorkspaceTaskDefaults } = await import('../src/task-defaults-service.js');

    saveWorkspaceTaskDefaults('ws-diff', {
      planningModelConfig: {
        provider: 'openai',
        modelId: 'gpt-4o',
      },
      executionModelConfig: {
        provider: 'openai',
        modelId: 'gpt-4o',
      },
      modelConfig: {
        provider: 'openai',
        modelId: 'gpt-4o',
      },
      prePlanningSkills: [],
      preExecutionSkills: ['checkpoint'],
      postExecutionSkills: ['security-review'],
    });

    writeFactorySettings(homePath, {
      taskDefaults: {
        planningModelConfig: {
          provider: 'anthropic',
          modelId: 'claude-sonnet-4',
        },
        executionModelConfig: {
          provider: 'anthropic',
          modelId: 'claude-sonnet-4',
        },
        prePlanningSkills: [],
        preExecutionSkills: ['security-review'],
        postExecutionSkills: ['checkpoint', 'code-review'],
      },
    });

    const resolved = loadTaskDefaultsForWorkspace('ws-diff');

    expect(resolved.planningModelConfig).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4',
    });
    expect(resolved.executionModelConfig).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4',
    });
    expect(resolved.preExecutionSkills).toEqual(['security-review']);
    expect(resolved.postExecutionSkills).toEqual(['security-review']);
  });

  it('createTask resolves defaults by workspace path using explicit > workspace > global precedence', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');
    const tasksDir = join(workspacePath, '.taskfactory', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    registerWorkspace(homePath, 'ws-create', workspacePath);

    writeFactorySettings(homePath, {
      taskDefaults: {
        planningModelConfig: {
          provider: 'openai',
          modelId: 'gpt-4o',
        },
        executionModelConfig: {
          provider: 'openai',
          modelId: 'gpt-4o',
        },
        prePlanningSkills: [],
        preExecutionSkills: ['checkpoint'],
        postExecutionSkills: ['checkpoint', 'code-review'],
      },
    });

    writeWorkspaceTaskDefaults(homePath, 'ws-create', {
      executionModelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
      },
      postExecutionSkills: ['security-review'],
    });

    const { createTask } = await import('../src/task-service.js');

    const created = createTask(workspacePath, tasksDir, {
      content: 'Implement feature',
    });

    expect(created.frontmatter.planningModelConfig).toEqual({
      provider: 'openai',
      modelId: 'gpt-4o',
    });
    expect(created.frontmatter.executionModelConfig).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4',
    });
    expect(created.frontmatter.prePlanningSkills).toEqual([]);
    expect(created.frontmatter.preExecutionSkills).toEqual(['checkpoint']);
    expect(created.frontmatter.postExecutionSkills).toEqual(['security-review']);
  });

  it('keeps explicit request models and skills over workspace/global defaults during task creation', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');
    const tasksDir = join(workspacePath, '.taskfactory', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    registerWorkspace(homePath, 'ws-explicit', workspacePath);

    writeFactorySettings(homePath, {
      taskDefaults: {
        planningModelConfig: {
          provider: 'openai',
          modelId: 'gpt-4o',
        },
        executionModelConfig: {
          provider: 'openai',
          modelId: 'gpt-4o',
        },
        prePlanningSkills: [],
        preExecutionSkills: ['checkpoint'],
        postExecutionSkills: ['checkpoint', 'code-review'],
      },
    });

    writeWorkspaceTaskDefaults(homePath, 'ws-explicit', {
      planningModelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
      },
      executionModelConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
      },
      prePlanningSkills: [],
      preExecutionSkills: ['security-review'],
      postExecutionSkills: ['security-review'],
    });

    const { createTask } = await import('../src/task-service.js');

    const created = createTask(workspacePath, tasksDir, {
      content: 'Implement feature',
      planningModelConfig: {
        provider: 'anthropic',
        modelId: 'claude-opus-4',
      },
      executionModelConfig: {
        provider: 'openai',
        modelId: 'gpt-5',
      },
      prePlanningSkills: [],
      preExecutionSkills: [],
      postExecutionSkills: ['checkpoint'],
    });

    expect(created.frontmatter.planningModelConfig).toEqual({
      provider: 'anthropic',
      modelId: 'claude-opus-4',
    });
    expect(created.frontmatter.executionModelConfig).toEqual({
      provider: 'openai',
      modelId: 'gpt-5',
    });
    expect(created.frontmatter.prePlanningSkills).toEqual([]);
    expect(created.frontmatter.preExecutionSkills).toEqual([]);
    expect(created.frontmatter.postExecutionSkills).toEqual(['checkpoint']);
  });

  it('persists valid workspace defaultModelProfileId and clears stale profile IDs on save', async () => {
    const homePath = setTempHome();

    writeFactorySettings(homePath, {
      modelProfiles: [
        {
          id: 'profile-default',
          name: 'Default',
          planningModelConfig: { provider: 'anthropic', modelId: 'claude-sonnet-4' },
          executionModelConfig: { provider: 'openai', modelId: 'gpt-4o' },
        },
      ],
      taskDefaults: {
        prePlanningSkills: [],
        preExecutionSkills: [],
        postExecutionSkills: ['checkpoint'],
        defaultModelProfileId: 'profile-default',
      },
    });

    const { saveWorkspaceTaskDefaults, loadTaskDefaultsForWorkspace } = await import('../src/task-defaults-service.js');

    const savedValid = saveWorkspaceTaskDefaults('ws-profile', {
      planningModelConfig: undefined,
      executionModelConfig: undefined,
      modelConfig: undefined,
      defaultModelProfileId: 'profile-default',
      prePlanningSkills: [],
      preExecutionSkills: [],
      postExecutionSkills: ['checkpoint'],
    });

    expect(savedValid.defaultModelProfileId).toBe('profile-default');

    const savedStale = saveWorkspaceTaskDefaults('ws-profile', {
      planningModelConfig: undefined,
      executionModelConfig: undefined,
      modelConfig: undefined,
      defaultModelProfileId: 'profile-missing',
      prePlanningSkills: [],
      preExecutionSkills: [],
      postExecutionSkills: ['checkpoint'],
    });

    expect(savedStale.defaultModelProfileId).toBe('profile-default');
    expect(loadTaskDefaultsForWorkspace('ws-profile').defaultModelProfileId).toBe('profile-default');
  });
});
