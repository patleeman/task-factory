import { existsSync, readFileSync } from 'fs';
import { isAbsolute, join } from 'path';
import type { WorkspaceConfig } from '@pi-factory/shared';

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
