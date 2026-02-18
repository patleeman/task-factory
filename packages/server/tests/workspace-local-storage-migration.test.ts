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

/**
 * Write a minimal factory.json into <workspace>/.taskfactory/.
 */
function writeWorkspaceConfig(
  workspacePath: string,
  overrides: Record<string, unknown> = {},
): void {
  const tfDir = join(workspacePath, '.taskfactory');
  mkdirSync(tfDir, { recursive: true });
  writeFileSync(
    join(tfDir, 'factory.json'),
    JSON.stringify({
      taskLocations: ['.taskfactory/tasks'],
      defaultTaskLocation: '.taskfactory/tasks',
      wipLimits: {},
      gitIntegration: { enabled: true, defaultBranch: 'main', branchPrefix: 'feat/' },
      ...overrides,
    }, null, 2),
    'utf-8',
  );
}

/**
 * Register a workspace in ~/.taskfactory/workspaces.json.
 */
function registerWorkspace(
  homePath: string,
  id: string,
  workspacePath: string,
  name: string,
): void {
  const registryDir = join(homePath, '.taskfactory');
  mkdirSync(registryDir, { recursive: true });
  const registryPath = join(registryDir, 'workspaces.json');
  const existing = existsSync(registryPath)
    ? JSON.parse(readFileSync(registryPath, 'utf-8')) as unknown[]
    : [];
  writeFileSync(
    registryPath,
    JSON.stringify([...existing, { id, path: workspacePath, name }], null, 2),
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

// =============================================================================
// getWorkspaceStorageMigrationStatus
// =============================================================================

describe('getWorkspaceStorageMigrationStatus', () => {
  it('returns not_needed when workspace has no local .taskfactory directory', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('tf-migration-ws-');
    const id = 'ws-no-local';

    // Create workspace config at global path (simulates a brand new workspace).
    const globalRoot = join(homePath, '.taskfactory', 'workspaces', 'no-local');
    mkdirSync(globalRoot, { recursive: true });
    writeWorkspaceConfig(workspacePath, { artifactRoot: globalRoot });
    registerWorkspace(homePath, id, workspacePath, 'no-local');

    const { getWorkspaceStorageMigrationStatus } = await import('../src/workspace-local-storage-migration-service.js');
    const status = await getWorkspaceStorageMigrationStatus(id);

    expect(status.state).toBe('not_needed');
  });

  it('returns pending when local .taskfactory exists and no decision has been made', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('tf-migration-ws-');
    const id = 'ws-pending';

    // Simulate legacy workspace: .taskfactory exists, no artifactRoot in config.
    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, id, workspacePath, 'pending-ws');

    const { getWorkspaceStorageMigrationStatus } = await import('../src/workspace-local-storage-migration-service.js');
    const status = await getWorkspaceStorageMigrationStatus(id);

    expect(status.state).toBe('pending');
    expect(status.workspacePath).toBe(workspacePath);
    expect(status.targetArtifactRoot).toContain('pending-ws');
  });

  it('returns leave when localStorageDecision is "leave"', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('tf-migration-ws-');
    const id = 'ws-leave';
    const localRoot = join(workspacePath, '.taskfactory');

    writeWorkspaceConfig(workspacePath, {
      artifactRoot: localRoot,
      localStorageDecision: 'leave',
    });
    registerWorkspace(homePath, id, workspacePath, 'leave-ws');

    const { getWorkspaceStorageMigrationStatus } = await import('../src/workspace-local-storage-migration-service.js');
    const status = await getWorkspaceStorageMigrationStatus(id);

    expect(status.state).toBe('leave');
  });

  it('returns moved when localStorageDecision is "moved"', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('tf-migration-ws-');
    const id = 'ws-moved';
    const globalRoot = join(homePath, '.taskfactory', 'workspaces', 'moved-ws');

    writeWorkspaceConfig(workspacePath, {
      artifactRoot: globalRoot,
      localStorageDecision: 'moved',
    });
    registerWorkspace(homePath, id, workspacePath, 'moved-ws');

    const { getWorkspaceStorageMigrationStatus } = await import('../src/workspace-local-storage-migration-service.js');
    const status = await getWorkspaceStorageMigrationStatus(id);

    expect(status.state).toBe('moved');
  });

  it('returns not_needed when artifactRoot already differs from the local .taskfactory dir', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('tf-migration-ws-');
    const id = 'ws-already-configured';
    const customRoot = join(homePath, '.taskfactory', 'workspaces', 'already-configured');

    // Local .taskfactory exists but artifactRoot already points elsewhere.
    writeWorkspaceConfig(workspacePath, { artifactRoot: customRoot });
    registerWorkspace(homePath, id, workspacePath, 'already-configured');

    const { getWorkspaceStorageMigrationStatus } = await import('../src/workspace-local-storage-migration-service.js');
    const status = await getWorkspaceStorageMigrationStatus(id);

    expect(status.state).toBe('not_needed');
  });

  it('returns not_needed for an unknown workspace ID', async () => {
    setTempHome();

    const { getWorkspaceStorageMigrationStatus } = await import('../src/workspace-local-storage-migration-service.js');
    const status = await getWorkspaceStorageMigrationStatus('does-not-exist');

    expect(status.state).toBe('not_needed');
  });
});

// =============================================================================
// leaveWorkspaceLocalStorage
// =============================================================================

describe('leaveWorkspaceLocalStorage', () => {
  it('records the leave decision and suppresses future prompts', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('tf-migration-ws-');
    const id = 'ws-leave-action';

    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, id, workspacePath, 'leave-action-ws');

    const { leaveWorkspaceLocalStorage, getWorkspaceStorageMigrationStatus } = await import('../src/workspace-local-storage-migration-service.js');

    // Should be pending before decision.
    const before = await getWorkspaceStorageMigrationStatus(id);
    expect(before.state).toBe('pending');

    const result = await leaveWorkspaceLocalStorage(id);
    expect(result.state).toBe('leave');

    // Subsequent status checks must not re-prompt.
    const after = await getWorkspaceStorageMigrationStatus(id);
    expect(after.state).toBe('leave');
  });

  it('does not move any files when leaving', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('tf-migration-ws-');
    const id = 'ws-leave-no-move';

    // Write some local task data.
    const localTasks = join(workspacePath, '.taskfactory', 'tasks');
    mkdirSync(localTasks, { recursive: true });
    writeFileSync(join(localTasks, 'task-1.md'), '# Task 1', 'utf-8');
    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, id, workspacePath, 'leave-no-move-ws');

    const { leaveWorkspaceLocalStorage } = await import('../src/workspace-local-storage-migration-service.js');
    await leaveWorkspaceLocalStorage(id);

    // Local data must still be in the original location.
    expect(existsSync(join(localTasks, 'task-1.md'))).toBe(true);

    // Global artifact root must NOT have been created.
    const globalRoot = join(homePath, '.taskfactory', 'workspaces', 'leave-no-move-ws');
    expect(existsSync(globalRoot)).toBe(false);
  });

  it('updates factory.json with the leave decision', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('tf-migration-ws-');
    const id = 'ws-leave-persist';

    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, id, workspacePath, 'leave-persist-ws');

    const { leaveWorkspaceLocalStorage } = await import('../src/workspace-local-storage-migration-service.js');
    await leaveWorkspaceLocalStorage(id);

    const configOnDisk = JSON.parse(
      readFileSync(join(workspacePath, '.taskfactory', 'factory.json'), 'utf-8'),
    ) as { localStorageDecision?: string };
    expect(configOnDisk.localStorageDecision).toBe('leave');
  });
});

// =============================================================================
// moveWorkspaceLocalStorage
// =============================================================================

describe('moveWorkspaceLocalStorage', () => {
  it('migrates tasks directory to the global artifact root', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('tf-migration-ws-');
    const id = 'ws-move-tasks';

    const localTasks = join(workspacePath, '.taskfactory', 'tasks');
    mkdirSync(join(localTasks, 'PIFA-1'), { recursive: true });
    writeFileSync(join(localTasks, 'PIFA-1', 'task.md'), '# PIFA-1', 'utf-8');
    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, id, workspacePath, 'move-tasks-ws');

    const { moveWorkspaceLocalStorage } = await import('../src/workspace-local-storage-migration-service.js');
    const result = await moveWorkspaceLocalStorage(id);

    expect(result.state).toBe('moved');
    expect(result.targetArtifactRoot).toBeTruthy();

    const globalTasks = join(result.targetArtifactRoot!, 'tasks');
    expect(existsSync(join(globalTasks, 'PIFA-1', 'task.md'))).toBe(true);
  });

  it('migrates planning messages and sessions', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('tf-migration-ws-');
    const id = 'ws-move-planning';

    const localTf = join(workspacePath, '.taskfactory');
    mkdirSync(localTf, { recursive: true });
    writeFileSync(join(localTf, 'planning-messages.json'), JSON.stringify([]), 'utf-8');
    writeFileSync(join(localTf, 'planning-session-id.txt'), 'session-123', 'utf-8');
    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, id, workspacePath, 'move-planning-ws');

    const { moveWorkspaceLocalStorage } = await import('../src/workspace-local-storage-migration-service.js');
    const result = await moveWorkspaceLocalStorage(id);

    const globalRoot = result.targetArtifactRoot!;
    expect(existsSync(join(globalRoot, 'planning-messages.json'))).toBe(true);
    expect(existsSync(join(globalRoot, 'planning-session-id.txt'))).toBe(true);
  });

  it('updates workspace config with new artifactRoot and localStorageDecision=moved', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('tf-migration-ws-');
    const id = 'ws-move-config';

    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, id, workspacePath, 'move-config-ws');

    const { moveWorkspaceLocalStorage } = await import('../src/workspace-local-storage-migration-service.js');
    const result = await moveWorkspaceLocalStorage(id);

    // factory.json must now be at the global artifact root — local .taskfactory is deleted.
    expect(existsSync(join(workspacePath, '.taskfactory'))).toBe(false);
    const configOnDisk = JSON.parse(
      readFileSync(join(result.targetArtifactRoot!, 'factory.json'), 'utf-8'),
    ) as { artifactRoot?: string; localStorageDecision?: string; defaultTaskLocation?: string };

    expect(configOnDisk.artifactRoot).toBe(result.targetArtifactRoot);
    expect(configOnDisk.localStorageDecision).toBe('moved');
    expect(configOnDisk.defaultTaskLocation).toBe(join(result.targetArtifactRoot!, 'tasks'));
  });

  it('subsequent status check returns moved after a move', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('tf-migration-ws-');
    const id = 'ws-move-status';

    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, id, workspacePath, 'move-status-ws');

    const { moveWorkspaceLocalStorage, getWorkspaceStorageMigrationStatus } = await import('../src/workspace-local-storage-migration-service.js');

    await moveWorkspaceLocalStorage(id);

    const status = await getWorkspaceStorageMigrationStatus(id);
    expect(status.state).toBe('moved');
  });

  it('preserves shelf.json content through migration', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('tf-migration-ws-');
    const id = 'ws-move-shelf';

    const shelfData = { items: [{ type: 'draft-task', item: { id: 'dt-1', title: 'Test' } }] };
    const localTf = join(workspacePath, '.taskfactory');
    mkdirSync(localTf, { recursive: true });
    writeFileSync(join(localTf, 'shelf.json'), JSON.stringify(shelfData, null, 2), 'utf-8');
    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, id, workspacePath, 'move-shelf-ws');

    const { moveWorkspaceLocalStorage } = await import('../src/workspace-local-storage-migration-service.js');
    const result = await moveWorkspaceLocalStorage(id);

    const movedShelf = JSON.parse(
      readFileSync(join(result.targetArtifactRoot!, 'shelf.json'), 'utf-8'),
    ) as typeof shelfData;
    expect(movedShelf.items).toHaveLength(1);
    expect(movedShelf.items[0].item.id).toBe('dt-1');
  });
});

// =============================================================================
// Default artifact root for new workspaces (criterion 1 + 2)
// =============================================================================

describe('new workspace artifact root defaults', () => {
  it('new workspace resolveWorkspaceArtifactRoot returns the global path', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('tf-migration-ws-');

    const { createWorkspace } = await import('../src/workspace-service.js');
    const { resolveWorkspaceArtifactRoot } = await import('../src/workspace-storage.js');

    const workspace = await createWorkspace(workspacePath, 'new-ws');

    const resolved = resolveWorkspaceArtifactRoot(workspace.path, workspace.config);

    const expectedRoot = join(homePath, '.taskfactory', 'workspaces', 'new-ws');
    expect(resolved).toBe(expectedRoot);
    expect(workspace.config.artifactRoot).toBe(expectedRoot);
  });

  it('custom artifactRoot is used by resolveWorkspaceArtifactRoot', async () => {
    setTempHome();
    const workspacePath = createTempDir('tf-migration-ws-');
    const customRoot = join(workspacePath, 'my-custom-artifacts');

    const { createWorkspace } = await import('../src/workspace-service.js');
    const { resolveWorkspaceArtifactRoot } = await import('../src/workspace-storage.js');

    const workspace = await createWorkspace(workspacePath, 'custom-ws', {
      artifactRoot: customRoot,
    });

    const resolved = resolveWorkspaceArtifactRoot(workspace.path, workspace.config);
    expect(resolved).toBe(customRoot);
  });
});
