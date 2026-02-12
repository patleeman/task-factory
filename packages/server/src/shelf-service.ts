// =============================================================================
// Shelf Service — Draft tasks and artifacts staging area
// =============================================================================
// Draft tasks and artifacts live on a shelf per workspace.
// Persisted to JSON in the workspace's .pi directory.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { DraftTask, Artifact, Shelf, ShelfItem } from '@pi-factory/shared';
import { getWorkspaceById } from './workspace-service.js';

// In-memory cache: workspaceId -> Shelf
const shelfCache = new Map<string, Shelf>();

function getShelfPath(workspacePath: string): string {
  return join(workspacePath, '.pi', 'shelf.json');
}

function ensurePiDir(workspacePath: string): void {
  const piDir = join(workspacePath, '.pi');
  if (!existsSync(piDir)) {
    mkdirSync(piDir, { recursive: true });
  }
}

function loadShelfFromDisk(workspacePath: string): Shelf {
  const path = getShelfPath(workspacePath);
  if (!existsSync(path)) {
    return { items: [] };
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as Shelf;
  } catch {
    return { items: [] };
  }
}

function saveShelfToDisk(workspacePath: string, shelf: Shelf): void {
  ensurePiDir(workspacePath);
  const path = getShelfPath(workspacePath);
  writeFileSync(path, JSON.stringify(shelf, null, 2), 'utf-8');
}

export function getShelf(workspaceId: string): Shelf {
  if (shelfCache.has(workspaceId)) {
    return shelfCache.get(workspaceId)!;
  }

  const workspace = getWorkspaceById(workspaceId);
  if (!workspace) {
    return { items: [] };
  }

  const shelf = loadShelfFromDisk(workspace.path);
  shelfCache.set(workspaceId, shelf);
  return shelf;
}

function persistShelf(workspaceId: string, shelf: Shelf): void {
  shelfCache.set(workspaceId, shelf);
  const workspace = getWorkspaceById(workspaceId);
  if (workspace) {
    saveShelfToDisk(workspace.path, shelf);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft Tasks
// ─────────────────────────────────────────────────────────────────────────────

export function addDraftTask(workspaceId: string, draft: DraftTask): Shelf {
  const shelf = getShelf(workspaceId);
  shelf.items.push({ type: 'draft-task', item: draft });
  persistShelf(workspaceId, shelf);
  return shelf;
}

export function updateDraftTask(workspaceId: string, draftId: string, updates: Partial<DraftTask>): Shelf {
  const shelf = getShelf(workspaceId);
  const idx = shelf.items.findIndex(
    (si) => si.type === 'draft-task' && si.item.id === draftId
  );
  if (idx === -1) throw new Error(`Draft task ${draftId} not found`);

  const existing = shelf.items[idx].item as DraftTask;
  shelf.items[idx] = {
    type: 'draft-task',
    item: { ...existing, ...updates },
  };
  persistShelf(workspaceId, shelf);
  return shelf;
}

export function removeDraftTask(workspaceId: string, draftId: string): Shelf {
  const shelf = getShelf(workspaceId);
  shelf.items = shelf.items.filter(
    (si) => !(si.type === 'draft-task' && si.item.id === draftId)
  );
  persistShelf(workspaceId, shelf);
  return shelf;
}

export function getDraftTask(workspaceId: string, draftId: string): DraftTask | null {
  const shelf = getShelf(workspaceId);
  const item = shelf.items.find(
    (si) => si.type === 'draft-task' && si.item.id === draftId
  );
  return item ? (item.item as DraftTask) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifacts
// ─────────────────────────────────────────────────────────────────────────────

export function addArtifact(workspaceId: string, artifact: Artifact): Shelf {
  const shelf = getShelf(workspaceId);
  shelf.items.push({ type: 'artifact', item: artifact });
  persistShelf(workspaceId, shelf);
  return shelf;
}

export function updateArtifact(workspaceId: string, artifactId: string, updates: Partial<Artifact>): Shelf {
  const shelf = getShelf(workspaceId);
  const idx = shelf.items.findIndex(
    (si) => si.type === 'artifact' && si.item.id === artifactId
  );
  if (idx === -1) throw new Error(`Artifact ${artifactId} not found`);

  const existing = shelf.items[idx].item as Artifact;
  shelf.items[idx] = {
    type: 'artifact',
    item: { ...existing, ...updates },
  };
  persistShelf(workspaceId, shelf);
  return shelf;
}

export function removeArtifact(workspaceId: string, artifactId: string): Shelf {
  const shelf = getShelf(workspaceId);
  shelf.items = shelf.items.filter(
    (si) => !(si.type === 'artifact' && si.item.id === artifactId)
  );
  persistShelf(workspaceId, shelf);
  return shelf;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk operations
// ─────────────────────────────────────────────────────────────────────────────

export function clearShelf(workspaceId: string): Shelf {
  const shelf: Shelf = { items: [] };
  persistShelf(workspaceId, shelf);
  return shelf;
}

export function removeShelfItem(workspaceId: string, itemId: string): Shelf {
  const shelf = getShelf(workspaceId);
  shelf.items = shelf.items.filter((si) => si.item.id !== itemId);
  persistShelf(workspaceId, shelf);
  return shelf;
}
