// =============================================================================
// Workspace Local Storage Migration Service
// =============================================================================
// Handles the one-time decision about moving workspace artifacts out of the
// project's <workspace>/.taskfactory directory and into the global
// ~/.taskfactory/workspaces/<name>/ location.
//
// Migration is only prompted when:
//  - The workspace's <workspace>/.taskfactory directory exists (legacy data), AND
//  - The workspace config has no localStorageDecision recorded, AND
//  - The workspace is using the default local storage (no custom artifactRoot set).

import { existsSync } from 'fs';
import { cp, mkdir, rename, copyFile, rm, stat } from 'fs/promises';
import { dirname, join } from 'path';
import { getWorkspaceById, updateWorkspaceConfig } from './workspace-service.js';
import {
  getWorkspaceStorageDir,
  getLegacyWorkspaceStoragePath,
  resolveWorkspaceArtifactRoot,
} from './workspace-storage.js';
import { getGlobalWorkspaceArtifactDir } from './taskfactory-home.js';

// =============================================================================
// Types
// =============================================================================

export type WorkspaceStorageMigrationState =
  | 'not_needed'   // no local .taskfactory, or decision already made
  | 'pending'      // local .taskfactory exists, no decision yet
  | 'moved'        // user chose Move — now using global artifact root
  | 'leave';       // user chose Leave for now — keep local storage

export interface WorkspaceStorageMigrationStatus {
  state: WorkspaceStorageMigrationState;
  /** The local workspace path that has the legacy .taskfactory dir. */
  workspacePath?: string;
  /** The target global artifact root (useful for display in UI). */
  targetArtifactRoot?: string;
  decidedAt?: string;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Returns true if the workspace currently has local .taskfactory data that
 * originated before the global-storage feature was introduced.
 */
function hasLocalStorageData(workspacePath: string): boolean {
  return existsSync(getWorkspaceStorageDir(workspacePath));
}

async function movePathIfDestinationMissing(fromPath: string, toPath: string): Promise<void> {
  if (!existsSync(fromPath)) {
    return;
  }

  if (existsSync(toPath)) {
    // Destination already exists — merge missing source content in.
    try {
      const srcStat = await stat(fromPath);
      const dstStat = await stat(toPath);
      if (srcStat.isDirectory() && dstStat.isDirectory()) {
        await cp(fromPath, toPath, { recursive: true, force: false, errorOnExist: false });
        await rm(fromPath, { recursive: true, force: true });
      }
    } catch {
      // Best-effort only.
    }
    return;
  }

  await mkdir(dirname(toPath), { recursive: true });

  try {
    await rename(fromPath, toPath);
    return;
  } catch {
    // Cross-device rename — fall back to copy + delete.
  }

  const srcStat = await stat(fromPath);
  if (srcStat.isDirectory()) {
    await cp(fromPath, toPath, { recursive: true });
    await rm(fromPath, { recursive: true, force: true });
    return;
  }

  await copyFile(fromPath, toPath);
  await rm(fromPath, { force: true });
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Check whether a workspace needs a local storage migration prompt.
 *
 * Returns `pending` when:
 *  - the workspace has a local .taskfactory directory, AND
 *  - config.localStorageDecision is not set, AND
 *  - config.artifactRoot still points to the local .taskfactory directory
 *    (i.e. the user hasn't manually configured a global or custom path).
 */
export async function getWorkspaceStorageMigrationStatus(
  workspaceId: string,
): Promise<WorkspaceStorageMigrationStatus> {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) {
    return { state: 'not_needed' };
  }

  const { path: workspacePath, name: workspaceName, config } = workspace;

  // If a decision has already been recorded, return it directly.
  if (config.localStorageDecision === 'moved') {
    return {
      state: 'moved',
      workspacePath,
      targetArtifactRoot: config.artifactRoot,
      decidedAt: undefined,
    };
  }
  if (config.localStorageDecision === 'leave') {
    return { state: 'leave', workspacePath };
  }

  // If no local .taskfactory exists, no prompt needed.
  if (!hasLocalStorageData(workspacePath)) {
    return { state: 'not_needed' };
  }

  // If there is an explicit artifact root that differs from the local dir,
  // the user (or migration) already chose where to store artifacts.
  const localStorageDir = getWorkspaceStorageDir(workspacePath);
  const effectiveRoot = resolveWorkspaceArtifactRoot(workspacePath, config);
  if (effectiveRoot !== localStorageDir) {
    return { state: 'not_needed' };
  }

  // Local .taskfactory exists with no decision → prompt.
  const targetArtifactRoot = getGlobalWorkspaceArtifactDir(workspaceName);

  return {
    state: 'pending',
    workspacePath,
    targetArtifactRoot,
  };
}

/**
 * Migrate workspace artifacts from <workspace>/.taskfactory into the global
 * artifact root (~/.taskfactory/workspaces/<name>/).
 *
 * After migration:
 * - The workspace config is updated with the new artifactRoot.
 * - localStorageDecision is set to 'moved'.
 * - factory.json stays in <workspace>/.taskfactory/ (it's the config pointer).
 */
export async function moveWorkspaceLocalStorage(
  workspaceId: string,
): Promise<WorkspaceStorageMigrationStatus> {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  const { path: workspacePath, name: workspaceName } = workspace;
  const targetRoot = getGlobalWorkspaceArtifactDir(workspaceName);
  const localRoot = getWorkspaceStorageDir(workspacePath);

  await mkdir(targetRoot, { recursive: true });

  // Artifact paths to migrate — factory.json is handled separately via
  // updateWorkspaceConfig which writes the updated config to the new root.
  const artifacts: Array<{ from: string; to: string }> = [
    { from: join(localRoot, 'tasks'), to: join(targetRoot, 'tasks') },
    { from: join(localRoot, 'planning-attachments'), to: join(targetRoot, 'planning-attachments') },
    { from: join(localRoot, 'planning-session-id.txt'), to: join(targetRoot, 'planning-session-id.txt') },
    { from: join(localRoot, 'planning-messages.json'), to: join(targetRoot, 'planning-messages.json') },
    { from: join(localRoot, 'planning-sessions'), to: join(targetRoot, 'planning-sessions') },
    { from: join(localRoot, 'shelf.json'), to: join(targetRoot, 'shelf.json') },
    { from: join(localRoot, 'idea-backlog.json'), to: join(targetRoot, 'idea-backlog.json') },
    { from: join(localRoot, 'workspace-context.md'), to: join(targetRoot, 'workspace-context.md') },
    { from: join(localRoot, 'factory'), to: join(targetRoot, 'factory') },
    { from: join(localRoot, 'skills'), to: join(targetRoot, 'skills') },
    { from: join(localRoot, 'extensions'), to: join(targetRoot, 'extensions') },
  ];

  // Also migrate legacy .pi data if present.
  const legacyRoot = getLegacyWorkspaceStoragePath(workspacePath);
  const legacyArtifacts: Array<{ from: string; to: string }> = [
    { from: join(legacyRoot, 'tasks'), to: join(targetRoot, 'tasks') },
    { from: join(legacyRoot, 'workspace-context.md'), to: join(targetRoot, 'workspace-context.md') },
  ];

  for (const { from, to } of [...artifacts, ...legacyArtifacts]) {
    try {
      await movePathIfDestinationMissing(from, to);
    } catch (err) {
      console.warn(`[WorkspaceStorageMigration] Failed to migrate ${from} → ${to}:`, err);
    }
  }

  // Write the updated config (including new artifactRoot) to the global root,
  // and sync the registry. updateWorkspaceConfig handles both.
  const newTasksDir = join(targetRoot, 'tasks');
  await updateWorkspaceConfig(workspace, {
    artifactRoot: targetRoot,
    localStorageDecision: 'moved',
    taskLocations: [newTasksDir],
    defaultTaskLocation: newTasksDir,
  });

  // Remove the old local .taskfactory directory entirely — factory.json has been
  // written to the new global root by updateWorkspaceConfig, so nothing important
  // remains here.
  try {
    await rm(localRoot, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[WorkspaceStorageMigration] Failed to remove legacy local storage dir ${localRoot}:`, err);
  }

  return {
    state: 'moved',
    workspacePath,
    targetArtifactRoot: targetRoot,
  };
}

/**
 * Record the user's decision to keep local .taskfactory storage for now.
 * Suppresses future migration prompts for this workspace.
 */
export async function leaveWorkspaceLocalStorage(
  workspaceId: string,
): Promise<WorkspaceStorageMigrationStatus> {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  // Keep the artifact root pointing at the local directory (default behaviour).
  // Just record the decision so we don't prompt again.
  const localRoot = getWorkspaceStorageDir(workspace.path);
  await updateWorkspaceConfig(workspace, {
    artifactRoot: localRoot,
    localStorageDecision: 'leave',
  });

  return {
    state: 'leave',
    workspacePath: workspace.path,
  };
}
