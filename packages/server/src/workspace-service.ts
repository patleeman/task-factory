// =============================================================================
// Workspace Service
// =============================================================================
// Manages workspace configuration and discovery.
// Workspace metadata lives in <workspace>/.taskfactory/factory.json.
// A registry at ~/.taskfactory/workspaces.json tracks known workspace paths.

import { existsSync } from 'fs';
import { mkdir, readFile, writeFile, rm, rename, copyFile, cp, stat } from 'fs/promises';
import { basename, dirname, join } from 'path';
import type { Workspace, WorkspaceConfig } from '@pi-factory/shared';
import { getTaskFactoryHomeDir } from './taskfactory-home.js';
import {
  DEFAULT_WORKSPACE_TASK_LOCATION,
  LEGACY_WORKSPACE_TASK_LOCATION,
  getWorkspaceStoragePath,
  getLegacyWorkspaceStoragePath,
  resolveExistingTasksDirFromWorkspacePath,
} from './workspace-storage.js';

// =============================================================================
// Constants
// =============================================================================

const REGISTRY_DIR = getTaskFactoryHomeDir();
const REGISTRY_PATH = join(REGISTRY_DIR, 'workspaces.json');

const DEFAULT_CONFIG: WorkspaceConfig = {
  taskLocations: [DEFAULT_WORKSPACE_TASK_LOCATION],
  defaultTaskLocation: DEFAULT_WORKSPACE_TASK_LOCATION,
  wipLimits: {},
  gitIntegration: {
    enabled: true,
    defaultBranch: 'main',
    branchPrefix: 'feat/',
  },
};

// =============================================================================
// Registry (lightweight index of known workspaces)
// =============================================================================

interface WorkspaceEntry {
  id: string;
  path: string;
  name: string;
}

async function loadRegistry(): Promise<WorkspaceEntry[]> {
  try {
    const content = await readFile(REGISTRY_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveRegistry(entries: WorkspaceEntry[]): Promise<void> {
  await mkdir(REGISTRY_DIR, { recursive: true });
  await writeFile(REGISTRY_PATH, JSON.stringify(entries, null, 2), 'utf-8');
}

async function addToRegistry(entry: WorkspaceEntry): Promise<void> {
  const current = await loadRegistry();
  const entries = current.filter((e) => e.path !== entry.path);
  entries.push(entry);
  await saveRegistry(entries);
}

async function removeFromRegistry(id: string): Promise<void> {
  const current = await loadRegistry();
  const entries = current.filter((e) => e.id !== id);
  await saveRegistry(entries);
}

// =============================================================================
// Workspace config normalization + migration
// =============================================================================

function sanitizeTaskLocations(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value): value is string => value.length > 0);
}

function normalizeWorkspaceConfig(config: Partial<WorkspaceConfig>): WorkspaceConfig {
  const taskLocations = sanitizeTaskLocations(config.taskLocations);

  const defaultTaskLocation = typeof config.defaultTaskLocation === 'string'
    ? config.defaultTaskLocation.trim()
    : '';

  const resolvedTaskLocations = taskLocations.length > 0
    ? taskLocations
    : [...DEFAULT_CONFIG.taskLocations];

  const resolvedDefaultTaskLocation = defaultTaskLocation
    || resolvedTaskLocations[0]
    || DEFAULT_WORKSPACE_TASK_LOCATION;

  if (!resolvedTaskLocations.includes(resolvedDefaultTaskLocation)) {
    resolvedTaskLocations.unshift(resolvedDefaultTaskLocation);
  }

  return {
    ...DEFAULT_CONFIG,
    ...config,
    taskLocations: resolvedTaskLocations,
    defaultTaskLocation: resolvedDefaultTaskLocation,
  };
}

function migrateLegacyTaskLocations(config: WorkspaceConfig): WorkspaceConfig {
  const migratedTaskLocations = config.taskLocations.map((location) => (
    location === LEGACY_WORKSPACE_TASK_LOCATION
      ? DEFAULT_WORKSPACE_TASK_LOCATION
      : location
  ));

  const migratedDefaultTaskLocation = config.defaultTaskLocation === LEGACY_WORKSPACE_TASK_LOCATION
    ? DEFAULT_WORKSPACE_TASK_LOCATION
    : config.defaultTaskLocation;

  return normalizeWorkspaceConfig({
    ...config,
    taskLocations: migratedTaskLocations,
    defaultTaskLocation: migratedDefaultTaskLocation,
  });
}

async function movePathIfDestinationMissing(fromPath: string, toPath: string): Promise<void> {
  if (!existsSync(fromPath)) {
    return;
  }

  if (existsSync(toPath)) {
    // Destination already exists. For directories, merge missing legacy content
    // into the preferred path so tasks/attachments do not get stranded.
    try {
      const sourceStats = await stat(fromPath);
      const destinationStats = await stat(toPath);

      if (sourceStats.isDirectory() && destinationStats.isDirectory()) {
        await cp(fromPath, toPath, {
          recursive: true,
          force: false,
          errorOnExist: false,
        });
        await rm(fromPath, { recursive: true, force: true });
      }
    } catch {
      // Best-effort merge only.
    }

    return;
  }

  await mkdir(dirname(toPath), { recursive: true });

  try {
    await rename(fromPath, toPath);
    return;
  } catch {
    // Fall back to copy + remove when rename is unavailable.
  }

  const sourceStats = await stat(fromPath);
  if (sourceStats.isDirectory()) {
    await cp(fromPath, toPath, { recursive: true });
    await rm(fromPath, { recursive: true, force: true });
    return;
  }

  await copyFile(fromPath, toPath);
  await rm(fromPath, { force: true });
}

async function migrateLegacyWorkspaceStorage(workspacePath: string): Promise<void> {
  const moves: Array<{ from: string; to: string }> = [
    {
      from: getLegacyWorkspaceStoragePath(workspacePath, 'tasks'),
      to: getWorkspaceStoragePath(workspacePath, 'tasks'),
    },
    {
      from: getLegacyWorkspaceStoragePath(workspacePath, 'planning-attachments'),
      to: getWorkspaceStoragePath(workspacePath, 'planning-attachments'),
    },
    {
      from: getLegacyWorkspaceStoragePath(workspacePath, 'planning-session-id.txt'),
      to: getWorkspaceStoragePath(workspacePath, 'planning-session-id.txt'),
    },
    {
      from: getLegacyWorkspaceStoragePath(workspacePath, 'planning-messages.json'),
      to: getWorkspaceStoragePath(workspacePath, 'planning-messages.json'),
    },
    {
      from: getLegacyWorkspaceStoragePath(workspacePath, 'planning-sessions'),
      to: getWorkspaceStoragePath(workspacePath, 'planning-sessions'),
    },
    {
      from: getLegacyWorkspaceStoragePath(workspacePath, 'shelf.json'),
      to: getWorkspaceStoragePath(workspacePath, 'shelf.json'),
    },
    {
      from: getLegacyWorkspaceStoragePath(workspacePath, 'idea-backlog.json'),
      to: getWorkspaceStoragePath(workspacePath, 'idea-backlog.json'),
    },
    {
      from: getLegacyWorkspaceStoragePath(workspacePath, 'workspace-context.md'),
      to: getWorkspaceStoragePath(workspacePath, 'workspace-context.md'),
    },
    {
      from: getLegacyWorkspaceStoragePath(workspacePath, 'factory', 'activity.jsonl'),
      to: getWorkspaceStoragePath(workspacePath, 'factory', 'activity.jsonl'),
    },
  ];

  for (const move of moves) {
    try {
      await movePathIfDestinationMissing(move.from, move.to);
    } catch (err) {
      console.warn(`[WorkspaceService] Failed to migrate ${move.from} -> ${move.to}:`, err);
    }
  }
}

async function tryReadWorkspaceConfig(configPath: string): Promise<WorkspaceConfig | null> {
  try {
    const content = await readFile(configPath, 'utf-8');
    return normalizeWorkspaceConfig(JSON.parse(content));
  } catch {
    return null;
  }
}

// =============================================================================
// Read workspace config from disk
// =============================================================================

async function readWorkspaceConfig(workspacePath: string): Promise<WorkspaceConfig | null> {
  const primaryConfigPath = getWorkspaceStoragePath(workspacePath, 'factory.json');
  const primaryConfig = await tryReadWorkspaceConfig(primaryConfigPath);
  if (primaryConfig) {
    return primaryConfig;
  }

  const legacyConfigPath = getLegacyWorkspaceStoragePath(workspacePath, 'factory.json');
  const legacyConfig = await tryReadWorkspaceConfig(legacyConfigPath);
  if (!legacyConfig) {
    return null;
  }

  const migratedLegacyConfig = migrateLegacyTaskLocations(legacyConfig);

  await migrateLegacyWorkspaceStorage(workspacePath);
  await writeWorkspaceConfig(workspacePath, migratedLegacyConfig);

  return migratedLegacyConfig;
}

async function writeWorkspaceConfig(workspacePath: string, config: WorkspaceConfig): Promise<void> {
  const storageDir = getWorkspaceStoragePath(workspacePath);
  await mkdir(storageDir, { recursive: true });
  await writeFile(
    getWorkspaceStoragePath(workspacePath, 'factory.json'),
    JSON.stringify(normalizeWorkspaceConfig(config), null, 2),
    'utf-8',
  );
}

// =============================================================================
// Workspace CRUD
// =============================================================================

export async function createWorkspace(
  path: string,
  name?: string,
  config?: Partial<WorkspaceConfig>
): Promise<Workspace> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const mergedConfig = normalizeWorkspaceConfig({
    ...DEFAULT_CONFIG,
    ...config,
  });

  const workspace: Workspace = {
    id,
    path,
    name: name || basename(path),
    config: mergedConfig,
    createdAt: now,
    updatedAt: now,
  };

  // Write config to workspace directory
  await writeWorkspaceConfig(path, mergedConfig);

  // Ensure tasks directory exists
  const tasksDir = getTasksDir(workspace);
  await mkdir(tasksDir, { recursive: true });

  // Track in registry
  await addToRegistry({ id, path, name: workspace.name });

  return workspace;
}

export async function loadWorkspace(path: string): Promise<Workspace | null> {
  // Check registry first
  const entries = await loadRegistry();
  const entry = entries.find((e) => e.path === path);

  const config = await readWorkspaceConfig(path);

  if (entry && config) {
    return {
      id: entry.id,
      path: entry.path,
      name: entry.name,
      config,
      createdAt: '', // Not tracked in file — not important
      updatedAt: '',
    };
  }

  // Config file exists but not in registry — register it
  if (config) {
    return createWorkspace(path, basename(path), config);
  }

  return null;
}

export async function getWorkspaceById(id: string): Promise<Workspace | null> {
  const entries = await loadRegistry();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return null;

  const config = await readWorkspaceConfig(entry.path);
  if (!config) return null;

  return {
    id: entry.id,
    path: entry.path,
    name: entry.name,
    config,
    createdAt: '',
    updatedAt: '',
  };
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const entries = await loadRegistry();
  const workspaces: Workspace[] = [];

  for (const entry of entries) {
    const config = await readWorkspaceConfig(entry.path);
    if (config) {
      workspaces.push({
        id: entry.id,
        path: entry.path,
        name: entry.name,
        config,
        createdAt: '',
        updatedAt: '',
      });
    }
    // If config file is gone, the workspace dir was deleted — skip it
  }

  return workspaces;
}

export async function updateWorkspaceConfig(
  workspace: Workspace,
  config: Partial<WorkspaceConfig>
): Promise<Workspace> {
  workspace.config = normalizeWorkspaceConfig({
    ...workspace.config,
    ...config,
  });
  workspace.updatedAt = new Date().toISOString();

  await writeWorkspaceConfig(workspace.path, workspace.config);

  return workspace;
}

// =============================================================================
// Workspace Deletion
// =============================================================================

/**
 * Delete a workspace: remove from registry and clean up Task Factory metadata.
 * Does NOT delete the user's project files.
 */
export async function deleteWorkspace(id: string): Promise<boolean> {
  const entries = await loadRegistry();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return false;

  const cleanupTargets = [
    // Preferred storage root.
    getWorkspaceStoragePath(entry.path),

    // Legacy storage paths retained for backward compatibility cleanup.
    getLegacyWorkspaceStoragePath(entry.path, 'factory.json'),
    getLegacyWorkspaceStoragePath(entry.path, 'factory'),
    getLegacyWorkspaceStoragePath(entry.path, 'tasks'),
    getLegacyWorkspaceStoragePath(entry.path, 'shelf.json'),
    getLegacyWorkspaceStoragePath(entry.path, 'idea-backlog.json'),
    getLegacyWorkspaceStoragePath(entry.path, 'planning-attachments'),
    getLegacyWorkspaceStoragePath(entry.path, 'planning-session-id.txt'),
    getLegacyWorkspaceStoragePath(entry.path, 'planning-messages.json'),
    getLegacyWorkspaceStoragePath(entry.path, 'planning-sessions'),
    getLegacyWorkspaceStoragePath(entry.path, 'workspace-context.md'),
  ];

  for (const target of cleanupTargets) {
    try {
      await rm(target, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }

  // Remove from registry
  await removeFromRegistry(id);

  return true;
}

// =============================================================================
// Task Directory Resolution
// =============================================================================

export function getTasksDir(workspace: Workspace): string {
  return resolveExistingTasksDirFromWorkspacePath(workspace.path, workspace.config);
}
