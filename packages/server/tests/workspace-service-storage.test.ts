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

describe('workspace-service workspace storage roots', () => {
  it('creates new workspace with global artifact root under ~/.taskfactory/workspaces/', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');

    const { createWorkspace } = await import('../src/workspace-service.js');

    const workspace = await createWorkspace(workspacePath, 'my-project');

    // factory.json (the config file) must stay in the workspace-local .taskfactory dir.
    const configPath = join(workspacePath, '.taskfactory', 'factory.json');
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(join(workspacePath, '.pi', 'factory.json'))).toBe(false);

    // The artifact root and task location must point into the global dir, not the workspace dir.
    const expectedArtifactRoot = join(homePath, '.taskfactory', 'workspaces', 'my-project');
    const expectedTasksDir = join(expectedArtifactRoot, 'tasks');

    expect(workspace.config.artifactRoot).toBe(expectedArtifactRoot);
    expect(workspace.config.defaultTaskLocation).toBe(expectedTasksDir);
    expect(workspace.config.taskLocations).toContain(expectedTasksDir);

    // Tasks directory must be created under the global artifact root.
    expect(existsSync(expectedTasksDir)).toBe(true);

    // factory.json on disk should reflect the new global paths.
    const configOnDisk = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      artifactRoot: string;
      defaultTaskLocation: string;
      taskLocations: string[];
    };
    expect(configOnDisk.artifactRoot).toBe(expectedArtifactRoot);
    expect(configOnDisk.defaultTaskLocation).toBe(expectedTasksDir);
    expect(configOnDisk.taskLocations).toContain(expectedTasksDir);
  });

  it('loads legacy .pi workspace metadata and migrates task-factory artifacts into .taskfactory', async () => {
    setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-legacy-');

    const legacyDir = join(workspacePath, '.pi');
    const legacyTasksDir = join(legacyDir, 'tasks');
    const legacyTaskDir = join(legacyTasksDir, 'pifa-1');

    mkdirSync(legacyTaskDir, { recursive: true });
    writeFileSync(join(legacyTaskDir, 'task.yaml'), 'id: PIFA-1\ntitle: Legacy task\n', 'utf-8');
    writeFileSync(join(legacyDir, 'shelf.json'), JSON.stringify({ items: [] }, null, 2), 'utf-8');
    writeFileSync(
      join(legacyDir, 'factory.json'),
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

    const { loadWorkspace } = await import('../src/workspace-service.js');

    const workspace = await loadWorkspace(workspacePath);
    expect(workspace).not.toBeNull();
    expect(workspace?.config.defaultTaskLocation).toBe('.taskfactory/tasks');

    expect(existsSync(join(workspacePath, '.taskfactory', 'factory.json'))).toBe(true);
    expect(existsSync(join(workspacePath, '.taskfactory', 'tasks', 'pifa-1', 'task.yaml'))).toBe(true);
    expect(existsSync(join(workspacePath, '.taskfactory', 'shelf.json'))).toBe(true);
  });

  it('merges legacy task directories when .taskfactory/tasks already exists', async () => {
    setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-legacy-merge-');

    const legacyDir = join(workspacePath, '.pi');
    const preferredTasksDir = join(workspacePath, '.taskfactory', 'tasks');

    mkdirSync(join(preferredTasksDir, 'pifa-new'), { recursive: true });
    writeFileSync(join(preferredTasksDir, 'pifa-new', 'task.yaml'), 'id: PIFA-NEW\ntitle: Preferred task\n', 'utf-8');

    mkdirSync(join(legacyDir, 'tasks', 'pifa-old'), { recursive: true });
    writeFileSync(join(legacyDir, 'tasks', 'pifa-old', 'task.yaml'), 'id: PIFA-OLD\ntitle: Legacy task\n', 'utf-8');
    writeFileSync(
      join(legacyDir, 'factory.json'),
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

    const { loadWorkspace } = await import('../src/workspace-service.js');

    const workspace = await loadWorkspace(workspacePath);
    expect(workspace).not.toBeNull();

    expect(existsSync(join(preferredTasksDir, 'pifa-new', 'task.yaml'))).toBe(true);
    expect(existsSync(join(preferredTasksDir, 'pifa-old', 'task.yaml'))).toBe(true);
  });

  it('deletes task-factory metadata from .taskfactory, global artifact root, and legacy .pi roots', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-delete-');

    const { createWorkspace, deleteWorkspace } = await import('../src/workspace-service.js');

    const workspace = await createWorkspace(workspacePath, 'delete-test');

    mkdirSync(join(workspacePath, '.pi', 'tasks'), { recursive: true });
    writeFileSync(join(workspacePath, '.pi', 'factory.json'), JSON.stringify({}), 'utf-8');
    writeFileSync(join(workspacePath, '.pi', 'shelf.json'), JSON.stringify({ items: [] }), 'utf-8');

    const deleted = await deleteWorkspace(workspace.id);

    expect(deleted).toBe(true);
    // Local .taskfactory dir (contains factory.json) must be removed.
    expect(existsSync(join(workspacePath, '.taskfactory'))).toBe(false);
    // Global artifact root must also be removed.
    expect(existsSync(join(homePath, '.taskfactory', 'workspaces', 'delete-test'))).toBe(false);
    // Legacy .pi remnants must also be removed.
    expect(existsSync(join(workspacePath, '.pi', 'tasks'))).toBe(false);
    expect(existsSync(join(workspacePath, '.pi', 'factory.json'))).toBe(false);
    expect(existsSync(join(workspacePath, '.pi', 'shelf.json'))).toBe(false);
  });
});
