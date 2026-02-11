// =============================================================================
// Workspace Service
// =============================================================================
// Manages workspace configuration and discovery
// Workspaces are stored as .pi/factory.json files in the workspace directory.
// A registry at ~/.pi/factory/workspaces.json tracks known workspace paths.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { Workspace, WorkspaceConfig } from '@pi-factory/shared';
import { discoverTasks } from './task-service.js';

// =============================================================================
// Constants
// =============================================================================

const REGISTRY_DIR = join(homedir(), '.pi', 'factory');
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
  requiredQualityChecks: ['testsPass', 'lintPass'],
  autoTransition: {
    onTestsPass: false,
    onReviewDone: false,
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

function loadRegistry(): WorkspaceEntry[] {
  if (!existsSync(REGISTRY_PATH)) return [];
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveRegistry(entries: WorkspaceEntry[]): void {
  if (!existsSync(REGISTRY_DIR)) {
    mkdirSync(REGISTRY_DIR, { recursive: true });
  }
  writeFileSync(REGISTRY_PATH, JSON.stringify(entries, null, 2), 'utf-8');
}

function addToRegistry(entry: WorkspaceEntry): void {
  const entries = loadRegistry().filter((e) => e.path !== entry.path);
  entries.push(entry);
  saveRegistry(entries);
}

function removeFromRegistry(id: string): void {
  const entries = loadRegistry().filter((e) => e.id !== id);
  saveRegistry(entries);
}

// =============================================================================
// Read workspace config from disk
// =============================================================================

function readWorkspaceConfig(workspacePath: string): WorkspaceConfig | null {
  const configPath = join(workspacePath, '.pi', 'factory.json');
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeWorkspaceConfig(workspacePath: string, config: WorkspaceConfig): void {
  const piDir = join(workspacePath, '.pi');
  if (!existsSync(piDir)) {
    mkdirSync(piDir, { recursive: true });
  }
  writeFileSync(join(piDir, 'factory.json'), JSON.stringify(config, null, 2), 'utf-8');
}

// =============================================================================
// Workspace CRUD
// =============================================================================

export function createWorkspace(
  path: string,
  name?: string,
  config?: Partial<WorkspaceConfig>
): Workspace {
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
  writeWorkspaceConfig(path, mergedConfig);

  // Ensure tasks directory exists
  const tasksDir = getTasksDir(workspace);
  if (!existsSync(tasksDir)) {
    mkdirSync(tasksDir, { recursive: true });
  }

  // Track in registry
  addToRegistry({ id, path, name: workspace.name });

  return workspace;
}

export function loadWorkspace(path: string): Workspace | null {
  // Check registry first
  const entries = loadRegistry();
  const entry = entries.find((e) => e.path === path);

  const config = readWorkspaceConfig(path);

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

export function getWorkspaceById(id: string): Workspace | null {
  const entries = loadRegistry();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return null;

  const config = readWorkspaceConfig(entry.path);
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

export function listWorkspaces(): Workspace[] {
  const entries = loadRegistry();
  const workspaces: Workspace[] = [];

  for (const entry of entries) {
    const config = readWorkspaceConfig(entry.path);
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

export function updateWorkspaceConfig(
  workspace: Workspace,
  config: Partial<WorkspaceConfig>
): Workspace {
  workspace.config = {
    ...workspace.config,
    ...config,
  };
  workspace.updatedAt = new Date().toISOString();

  writeWorkspaceConfig(workspace.path, workspace.config);

  return workspace;
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
