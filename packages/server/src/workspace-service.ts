// =============================================================================
// Workspace Service
// =============================================================================
// Manages workspace configuration and discovery
// Workspaces are stored as .pi/factory.json files in the workspace directory.
// A registry at ~/.taskfactory/workspaces.json tracks known workspace paths.

import { mkdir, readFile, writeFile, rm, stat } from 'fs/promises';
import { join, basename } from 'path';
import type { Workspace, WorkspaceConfig } from '@pi-factory/shared';
import { getTaskFactoryHomeDir } from './taskfactory-home.js';
// discoverTasks is likely sync, but we are just importing it here.
// If discoverTasks is used in the future it might need to be async too,
// but for now we focus on workspace service functions.

// =============================================================================
// Constants
// =============================================================================

const REGISTRY_DIR = getTaskFactoryHomeDir();
const REGISTRY_PATH = join(REGISTRY_DIR, 'workspaces.json');

const DEFAULT_CONFIG: WorkspaceConfig = {
  taskLocations: ['.pi/tasks'],
  defaultTaskLocation: '.pi/tasks',
  wipLimits: {},
  gitIntegration: {
    enabled: true,
    defaultBranch: 'main',
    branchPrefix: 'feat/',
  },
};

// =============================================================================
// Helpers
// =============================================================================

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

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
// Read workspace config from disk
// =============================================================================

async function readWorkspaceConfig(workspacePath: string): Promise<WorkspaceConfig | null> {
  const configPath = join(workspacePath, '.pi', 'factory.json');
  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function writeWorkspaceConfig(workspacePath: string, config: WorkspaceConfig): Promise<void> {
  const piDir = join(workspacePath, '.pi');
  await mkdir(piDir, { recursive: true });
  await writeFile(join(piDir, 'factory.json'), JSON.stringify(config, null, 2), 'utf-8');
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

  const mergedConfig: WorkspaceConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

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
  workspace.config = {
    ...workspace.config,
    ...config,
  };
  workspace.updatedAt = new Date().toISOString();

  await writeWorkspaceConfig(workspace.path, workspace.config);

  return workspace;
}

// =============================================================================
// Workspace Deletion
// =============================================================================

/**
 * Delete a workspace: remove from registry and clean up .pi/factory data.
 * Does NOT delete the user's project files — only Task Factory metadata.
 */
export async function deleteWorkspace(id: string): Promise<boolean> {
  const entries = await loadRegistry();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return false;

  // Remove factory config file (.pi/factory.json)
  const configPath = join(entry.path, '.pi', 'factory.json');
  try {
    await rm(configPath);
  } catch {
    // Best-effort cleanup
  }

  // Remove factory data directory (.pi/factory/) — activity logs, etc.
  const factoryDir = join(entry.path, '.pi', 'factory');
  try {
    await rm(factoryDir, { recursive: true });
  } catch {
    // Best-effort cleanup
  }

  // Remove task files (.pi/tasks/)
  const tasksDir = join(entry.path, '.pi', 'tasks');
  try {
    await rm(tasksDir, { recursive: true });
  } catch {
    // Best-effort cleanup
  }

  // Remove shelf data (.pi/shelf.json)
  const shelfPath = join(entry.path, '.pi', 'shelf.json');
  try {
    await rm(shelfPath);
  } catch {
    // Best-effort cleanup
  }

  // Remove idea backlog data (.pi/idea-backlog.json)
  const ideaBacklogPath = join(entry.path, '.pi', 'idea-backlog.json');
  try {
    await rm(ideaBacklogPath);
  } catch {
    // Best-effort cleanup
  }

  // Remove planning attachments (.pi/planning-attachments/)
  const planningAttDir = join(entry.path, '.pi', 'planning-attachments');
  try {
    await rm(planningAttDir, { recursive: true });
  } catch {
    // Best-effort cleanup
  }

  // Remove from registry
  await removeFromRegistry(id);

  return true;
}

// =============================================================================
// Task Directory Resolution
// =============================================================================

export function getTasksDir(workspace: Workspace): string {
  const location = workspace.config.defaultTaskLocation;

  if (location.startsWith('/')) {
    return location;
  }

  return join(workspace.path, location);
}
