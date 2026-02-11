// =============================================================================
// Workspace Service
// =============================================================================
// Manages workspace configuration and discovery

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import type { Workspace, WorkspaceConfig } from '@pi-factory/shared';
import { initDatabase, saveTaskMetadata } from './db.js';
import { discoverTasks } from './task-service.js';

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
// Workspace CRUD
// =============================================================================

export function createWorkspace(
  path: string,
  name?: string,
  config?: Partial<WorkspaceConfig>
): Workspace {
  const db = initDatabase();

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const workspace: Workspace = {
    id,
    path,
    name: name || basename(path),
    config: {
      ...DEFAULT_CONFIG,
      ...config,
    },
    createdAt: now,
    updatedAt: now,
  };

  // Ensure .pi directory exists
  const piDir = join(path, '.pi');
  if (!existsSync(piDir)) {
    mkdirSync(piDir, { recursive: true });
  }

  // Save workspace config
  const configPath = join(piDir, 'factory.json');
  writeFileSync(configPath, JSON.stringify(workspace.config, null, 2), 'utf-8');

  // Save to database
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO workspaces (id, path, name, config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    path,
    workspace.name,
    JSON.stringify(workspace.config),
    now,
    now
  );

  // Ensure tasks directory exists
  const tasksDir = getTasksDir(workspace);
  if (!existsSync(tasksDir)) {
    mkdirSync(tasksDir, { recursive: true });
  }

  return workspace;
}

export function loadWorkspace(path: string): Workspace | null {
  const db = initDatabase();

  // Check if workspace exists in DB
  const stmt = db.prepare(`SELECT * FROM workspaces WHERE path = ?`);
  const row = stmt.get(path) as
    | {
        id: string;
        path: string;
        name: string;
        config: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (row) {
    return {
      id: row.id,
      path: row.path,
      name: row.name,
      config: JSON.parse(row.config),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Check if .pi/factory.json exists
  const configPath = join(path, '.pi', 'factory.json');
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as WorkspaceConfig;
    return createWorkspace(path, basename(path), config);
  }

  return null;
}

export function getWorkspaceById(id: string): Workspace | null {
  const db = initDatabase();

  const stmt = db.prepare(`SELECT * FROM workspaces WHERE id = ?`);
  const row = stmt.get(id) as
    | {
        id: string;
        path: string;
        name: string;
        config: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    path: row.path,
    name: row.name,
    config: JSON.parse(row.config),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listWorkspaces(): Workspace[] {
  const db = initDatabase();

  const stmt = db.prepare(`SELECT * FROM workspaces ORDER BY updated_at DESC`);
  const rows = stmt.all() as {
    id: string;
    path: string;
    name: string;
    config: string;
    created_at: string;
    updated_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    name: row.name,
    config: JSON.parse(row.config),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function updateWorkspaceConfig(
  workspace: Workspace,
  config: Partial<WorkspaceConfig>
): Workspace {
  const db = initDatabase();

  workspace.config = {
    ...workspace.config,
    ...config,
  };
  workspace.updatedAt = new Date().toISOString();

  // Save to file
  const configPath = join(workspace.path, '.pi', 'factory.json');
  writeFileSync(configPath, JSON.stringify(workspace.config, null, 2), 'utf-8');

  // Update database
  const stmt = db.prepare(`
    UPDATE workspaces SET config = ?, updated_at = ? WHERE id = ?
  `);

  stmt.run(JSON.stringify(workspace.config), workspace.updatedAt, workspace.id);

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

// =============================================================================
// Workspace Sync
// =============================================================================

export function syncWorkspaceTasks(workspace: Workspace): void {
  const tasksDir = getTasksDir(workspace);
  const tasks = discoverTasks(tasksDir);

  for (const task of tasks) {
    saveTaskMetadata(task, workspace.id);
  }
}
