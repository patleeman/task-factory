import { existsSync, readFileSync } from 'fs';
import { isAbsolute, join } from 'path';
import type { WorkspaceConfig } from '@task-factory/shared';

export const WORKSPACE_STORAGE_DIRNAME = '.taskfactory';
export const LEGACY_WORKSPACE_STORAGE_DIRNAME = '.pi';

export const DEFAULT_WORKSPACE_TASK_LOCATION = '.taskfactory/tasks';
export const LEGACY_WORKSPACE_TASK_LOCATION = '.pi/tasks';

export function getWorkspaceStorageDir(workspacePath: string): string {
  return join(workspacePath, WORKSPACE_STORAGE_DIRNAME);
}

export function getLegacyWorkspaceStorageDir(workspacePath: string): string {
  return join(workspacePath, LEGACY_WORKSPACE_STORAGE_DIRNAME);
}

export function getWorkspaceStoragePath(workspacePath: string, ...segments: string[]): string {
  return join(getWorkspaceStorageDir(workspacePath), ...segments);
}

export function getLegacyWorkspaceStoragePath(workspacePath: string, ...segments: string[]): string {
  return join(getLegacyWorkspaceStorageDir(workspacePath), ...segments);
}

export function resolveWorkspaceStoragePathForRead(workspacePath: string, ...segments: string[]): string {
  const preferredPath = getWorkspaceStoragePath(workspacePath, ...segments);
  if (existsSync(preferredPath)) {
    return preferredPath;
  }

  const legacyPath = getLegacyWorkspaceStoragePath(workspacePath, ...segments);
  if (existsSync(legacyPath)) {
    return legacyPath;
  }

  return preferredPath;
}

function resolveTaskLocation(workspacePath: string, location: string): string {
  return isAbsolute(location) ? location : join(workspacePath, location);
}

export function resolveTasksDirFromWorkspacePath(
  workspacePath: string,
  workspaceConfig: WorkspaceConfig | null,
): string {
  const location = workspaceConfig?.defaultTaskLocation || DEFAULT_WORKSPACE_TASK_LOCATION;
  return resolveTaskLocation(workspacePath, location);
}

/**
 * Resolve the active tasks directory for read operations.
 *
 * Prefer the configured/default `.taskfactory/tasks` location, but if it does
 * not exist and a legacy `.pi/tasks` directory is present, read from legacy so
 * older workspaces remain usable without manual migration.
 */
export function resolveExistingTasksDirFromWorkspacePath(
  workspacePath: string,
  workspaceConfig: WorkspaceConfig | null,
): string {
  const preferredPath = resolveTasksDirFromWorkspacePath(workspacePath, workspaceConfig);
  if (existsSync(preferredPath)) {
    return preferredPath;
  }

  const legacyPath = resolveTaskLocation(workspacePath, LEGACY_WORKSPACE_TASK_LOCATION);
  if (legacyPath !== preferredPath && existsSync(legacyPath)) {
    return legacyPath;
  }

  return preferredPath;
}

export function loadWorkspaceConfigFromDiskSync(workspacePath: string): WorkspaceConfig | null {
  const preferredPath = getWorkspaceStoragePath(workspacePath, 'factory.json');
  const legacyPath = getLegacyWorkspaceStoragePath(workspacePath, 'factory.json');

  for (const candidatePath of [preferredPath, legacyPath]) {
    try {
      const content = readFileSync(candidatePath, 'utf-8');
      return JSON.parse(content) as WorkspaceConfig;
    } catch {
      // Keep trying fallback candidates.
    }
  }

  return null;
}

// =============================================================================
// Artifact root resolution
// =============================================================================

/**
 * Return the effective artifact root directory for a workspace.
 *
 * Resolution order:
 * 1. `workspaceConfig.artifactRoot` (explicit absolute path set by user or migration).
 * 2. `<workspace>/.taskfactory` (legacy local default — used for existing workspaces).
 *
 * New workspaces created after this feature was introduced have `artifactRoot`
 * pre-set to `~/.taskfactory/workspaces/<name>/` by workspace-service.
 */
export function resolveWorkspaceArtifactRoot(
  workspacePath: string,
  workspaceConfig: WorkspaceConfig | null,
): string {
  if (workspaceConfig?.artifactRoot) {
    return workspaceConfig.artifactRoot;
  }
  return getWorkspaceStorageDir(workspacePath);
}

/**
 * Build an absolute path under the workspace's artifact root.
 */
export function getWorkspaceArtifactPath(artifactRoot: string, ...segments: string[]): string {
  return join(artifactRoot, ...segments);
}

/**
 * Like `resolveWorkspaceStoragePathForRead` but artifact-root–aware.
 *
 * Reads from the artifact root when configured; otherwise falls back to
 * the local `.taskfactory` directory (and then the legacy `.pi` directory).
 *
 * Accepts either a `WorkspaceConfig | null` (to resolve the artifact root
 * internally) or a pre-resolved absolute `artifactRoot` string.
 */
export function resolveWorkspaceArtifactPathForRead(
  workspacePath: string,
  workspaceConfigOrRoot: WorkspaceConfig | string | null,
  ...segments: string[]
): string {
  const artifactRoot = typeof workspaceConfigOrRoot === 'string'
    ? workspaceConfigOrRoot
    : resolveWorkspaceArtifactRoot(workspacePath, workspaceConfigOrRoot);

  const preferredPath = getWorkspaceArtifactPath(artifactRoot, ...segments);
  if (existsSync(preferredPath)) {
    return preferredPath;
  }

  // Legacy fallback paths (only relevant when artifactRoot is the local dir,
  // but harmless to check otherwise).
  const localPath = getWorkspaceStoragePath(workspacePath, ...segments);
  if (localPath !== preferredPath && existsSync(localPath)) {
    return localPath;
  }

  const legacyPath = getLegacyWorkspaceStoragePath(workspacePath, ...segments);
  if (legacyPath !== preferredPath && existsSync(legacyPath)) {
    return legacyPath;
  }

  return preferredPath;
}
