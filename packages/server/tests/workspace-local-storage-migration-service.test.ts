// =============================================================================
// Tests: workspace-local-storage-migration-service
// =============================================================================
// Covers:
//   - Migration status detection (pending / not_needed / leave / moved)
//   - Move migration: artifacts copied to global root, config updated
//   - Leave decision: decision persisted, local storage kept
//   - Artifact root resolution after decisions

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
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

/** Write a minimal workspace config at <workspacePath>/.taskfactory/factory.json */
function writeLocalWorkspaceConfig(workspacePath: string, extras: Record<string, unknown> = {}): void {
  const dir = join(workspacePath, '.taskfactory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'factory.json'),
    JSON.stringify({
      taskLocations: ['.taskfactory/tasks'],
      defaultTaskLocation: '.taskfactory/tasks',
      ...extras,
    }, null, 2),
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
// Migration status detection
// =============================================================================

describe('workspace local storage migration — status detection', () => {
  it('returns not_needed when workspace has no local .taskfactory directory', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('ws-no-local-');

    // Create workspace without local .taskfactory (new-style workspace via createWorkspace)
    const { createWorkspace } = await import('../src/workspace-service.js');
    const workspace = await createWorkspace(workspacePath, 'new-proj');

    const { getWorkspaceStorageMigrationStatus } = await import('../src/workspace-local-storage-migration-service.js');
    const status = await getWorkspaceStorageMigrationStatus(workspace.id);

    // New workspace writes factory.json to local .taskfactory, but the global artifact root
    // differs from the local dir, so no migration is needed.
    expect(status.state).toBe('not_needed');
    void homePath;
  });

  it('returns pending when workspace has local .taskfactory with no prior decision', async () => {
    setTempHome();
    const workspacePath = createTempDir('ws-legacy-');

    // Simulate an existing workspace with legacy local .taskfactory
    writeLocalWorkspaceConfig(workspacePath);
    mkdirSync(join(workspacePath, '.taskfactory', 'tasks'), { recursive: true });

    // Register workspace (no global artifact root set)
    const { loadWorkspace } = await import('../src/workspace-service.js');
    const workspace = await loadWorkspace(workspacePath);
    expect(workspace).not.toBeNull();

    const { getWorkspaceStorageMigrationStatus } = await import('../src/workspace-local-storage-migration-service.js');
    const status = await getWorkspaceStorageMigrationStatus(workspace!.id);

    expect(status.state).toBe('pending');
    expect(status.targetArtifactRoot).toBeTruthy();
    expect(status.workspacePath).toBe(workspacePath);
  });

  it('returns not_needed for unknown workspace id', async () => {
    setTempHome();

    const { getWorkspaceStorageMigrationStatus } = await import('../src/workspace-local-storage-migration-service.js');
    const status = await getWorkspaceStorageMigrationStatus('nonexistent-id');

    expect(status.state).toBe('not_needed');
  });

  it('returns leave when workspace has localStorageDecision="leave"', async () => {
    setTempHome();
    const workspacePath = createTempDir('ws-leave-');

    writeLocalWorkspaceConfig(workspacePath, { localStorageDecision: 'leave' });
    mkdirSync(join(workspacePath, '.taskfactory', 'tasks'), { recursive: true });

    const { loadWorkspace } = await import('../src/workspace-service.js');
    const workspace = await loadWorkspace(workspacePath);

    const { getWorkspaceStorageMigrationStatus } = await import('../src/workspace-local-storage-migration-service.js');
    const status = await getWorkspaceStorageMigrationStatus(workspace!.id);

    expect(status.state).toBe('leave');
  });

  it('returns moved when workspace has localStorageDecision="moved"', async () => {
    setTempHome();
    const workspacePath = createTempDir('ws-moved-');

    writeLocalWorkspaceConfig(workspacePath, { localStorageDecision: 'moved', artifactRoot: '/some/global/root' });
    mkdirSync(join(workspacePath, '.taskfactory', 'tasks'), { recursive: true });

    const { loadWorkspace } = await import('../src/workspace-service.js');
    const workspace = await loadWorkspace(workspacePath);

    const { getWorkspaceStorageMigrationStatus } = await import('../src/workspace-local-storage-migration-service.js');
    const status = await getWorkspaceStorageMigrationStatus(workspace!.id);

    expect(status.state).toBe('moved');
  });
});

// =============================================================================
// Move migration
// =============================================================================

describe('workspace local storage migration — move', () => {
  it('moves tasks and planning data to global artifact root and updates config', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('ws-to-move-');

    // Set up legacy local storage with a task
    writeLocalWorkspaceConfig(workspacePath);
    mkdirSync(join(workspacePath, '.taskfactory', 'tasks', 'PIFA-1'), { recursive: true });
    writeFileSync(
      join(workspacePath, '.taskfactory', 'tasks', 'PIFA-1', 'task.md'),
      '---\nid: PIFA-1\ntitle: Test task\n---\n',
      'utf-8',
    );
    writeFileSync(
      join(workspacePath, '.taskfactory', 'planning-messages.json'),
      JSON.stringify([{ id: 'm1', role: 'user', content: 'hello' }], null, 2),
      'utf-8',
    );

    const { loadWorkspace } = await import('../src/workspace-service.js');
    const workspace = await loadWorkspace(workspacePath);
    expect(workspace).not.toBeNull();

    const { moveWorkspaceLocalStorage, getWorkspaceStorageMigrationStatus } = await import('../src/workspace-local-storage-migration-service.js');

    const result = await moveWorkspaceLocalStorage(workspace!.id);

    expect(result.state).toBe('moved');
    expect(result.targetArtifactRoot).toBeTruthy();

    // Task should be in the global artifact root
    const globalRoot = result.targetArtifactRoot!;
    expect(existsSync(join(globalRoot, 'tasks', 'PIFA-1', 'task.md'))).toBe(true);
    expect(existsSync(join(globalRoot, 'planning-messages.json'))).toBe(true);

    // factory.json should still be in local .taskfactory
    const localConfig = JSON.parse(
      readFileSync(join(workspacePath, '.taskfactory', 'factory.json'), 'utf-8'),
    ) as { artifactRoot: string; localStorageDecision: string; defaultTaskLocation: string };

    expect(localConfig.artifactRoot).toBe(globalRoot);
    expect(localConfig.localStorageDecision).toBe('moved');
    expect(localConfig.defaultTaskLocation).toBe(join(globalRoot, 'tasks'));

    // Status must now show 'moved', not 'pending'
    const statusAfter = await getWorkspaceStorageMigrationStatus(workspace!.id);
    expect(statusAfter.state).toBe('moved');

    void homePath;
  });

  it('is idempotent: calling move twice does not throw', async () => {
    setTempHome();
    const workspacePath = createTempDir('ws-idempotent-');

    writeLocalWorkspaceConfig(workspacePath);
    mkdirSync(join(workspacePath, '.taskfactory', 'tasks'), { recursive: true });

    const { loadWorkspace } = await import('../src/workspace-service.js');
    const workspace = await loadWorkspace(workspacePath);

    const { moveWorkspaceLocalStorage } = await import('../src/workspace-local-storage-migration-service.js');

    await moveWorkspaceLocalStorage(workspace!.id);
    await expect(moveWorkspaceLocalStorage(workspace!.id)).resolves.not.toThrow();
  });
});

// =============================================================================
// Leave decision
// =============================================================================

describe('workspace local storage migration — leave', () => {
  it('records leave decision and returns leave state', async () => {
    setTempHome();
    const workspacePath = createTempDir('ws-leave-action-');

    writeLocalWorkspaceConfig(workspacePath);
    mkdirSync(join(workspacePath, '.taskfactory', 'tasks'), { recursive: true });

    const { loadWorkspace } = await import('../src/workspace-service.js');
    const workspace = await loadWorkspace(workspacePath);

    const { leaveWorkspaceLocalStorage, getWorkspaceStorageMigrationStatus } = await import('../src/workspace-local-storage-migration-service.js');

    const result = await leaveWorkspaceLocalStorage(workspace!.id);

    expect(result.state).toBe('leave');

    // Status must not be pending after decision
    const statusAfter = await getWorkspaceStorageMigrationStatus(workspace!.id);
    expect(statusAfter.state).toBe('leave');
  });

  it('persists leave decision in factory.json so it survives restarts', async () => {
    setTempHome();
    const workspacePath = createTempDir('ws-leave-persist-');

    writeLocalWorkspaceConfig(workspacePath);
    mkdirSync(join(workspacePath, '.taskfactory', 'tasks'), { recursive: true });

    const { loadWorkspace } = await import('../src/workspace-service.js');
    const workspace = await loadWorkspace(workspacePath);

    const { leaveWorkspaceLocalStorage } = await import('../src/workspace-local-storage-migration-service.js');
    await leaveWorkspaceLocalStorage(workspace!.id);

    const configOnDisk = JSON.parse(
      readFileSync(join(workspacePath, '.taskfactory', 'factory.json'), 'utf-8'),
    ) as { localStorageDecision: string };

    expect(configOnDisk.localStorageDecision).toBe('leave');
  });

  it('does not move any files when user chooses leave', async () => {
    setTempHome();
    const workspacePath = createTempDir('ws-leave-no-move-');

    writeLocalWorkspaceConfig(workspacePath);
    mkdirSync(join(workspacePath, '.taskfactory', 'tasks', 'PIFA-2'), { recursive: true });
    writeFileSync(
      join(workspacePath, '.taskfactory', 'tasks', 'PIFA-2', 'task.md'),
      '---\nid: PIFA-2\n---\n',
      'utf-8',
    );

    const { loadWorkspace } = await import('../src/workspace-service.js');
    const workspace = await loadWorkspace(workspacePath);

    const { leaveWorkspaceLocalStorage } = await import('../src/workspace-local-storage-migration-service.js');
    await leaveWorkspaceLocalStorage(workspace!.id);

    // Original task file must still be in local .taskfactory
    expect(
      existsSync(join(workspacePath, '.taskfactory', 'tasks', 'PIFA-2', 'task.md')),
    ).toBe(true);
  });
});

// =============================================================================
// Default artifact root for new workspaces
// =============================================================================

describe('new workspace — global artifact root defaults', () => {
  it('new workspaces use global artifact root under ~/.taskfactory/workspaces/', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('ws-new-global-');

    const { createWorkspace } = await import('../src/workspace-service.js');
    const workspace = await createWorkspace(workspacePath, 'test-workspace');

    const expectedGlobalRoot = join(homePath, '.taskfactory', 'workspaces', 'test-workspace');

    expect(workspace.config.artifactRoot).toBe(expectedGlobalRoot);
    expect(workspace.config.defaultTaskLocation).toBe(join(expectedGlobalRoot, 'tasks'));
    expect(existsSync(join(expectedGlobalRoot, 'tasks'))).toBe(true);

    // Tasks must NOT be created in the workspace-local .taskfactory
    expect(existsSync(join(workspacePath, '.taskfactory', 'tasks'))).toBe(false);
  });

  it('custom name is sanitized for the global directory', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('ws-new-sanitize-');

    const { createWorkspace } = await import('../src/workspace-service.js');
    const workspace = await createWorkspace(workspacePath, 'My Fancy Project!');

    // Spaces/! are replaced with dashes; trailing dashes are stripped
    const expectedDirName = 'My-Fancy-Project';
    expect(workspace.config.artifactRoot).toContain(expectedDirName);
    void homePath;
  });
});
