// =============================================================================
// Shelf Service — Draft tasks and artifacts staging area
// =============================================================================
// Draft tasks and artifacts live on a shelf per workspace.
// Persisted to JSON in the workspace's .pi directory.

import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { DraftTask, Artifact, Shelf, ShelfItem } from '@pi-factory/shared';
import { getWorkspaceById } from './workspace-service.js';

// In-memory cache: workspaceId -> Shelf
const shelfCache = new Map<string, Shelf>();

function getShelfPath(workspacePath: string): string {
  return join(workspacePath, '.pi', 'shelf.json');
}

async function ensurePiDir(workspacePath: string): Promise<void> {
  const piDir = join(workspacePath, '.pi');
  await mkdir(piDir, { recursive: true });
}

async function loadShelfFromDisk(workspacePath: string): Promise<Shelf> {
  const path = getShelfPath(workspacePath);
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as Shelf;
  } catch {
    return { items: [] };
  }
}

async function saveShelfToDisk(workspacePath: string, shelf: Shelf): Promise<void> {
  await ensurePiDir(workspacePath);
  const path = getShelfPath(workspacePath);
  await writeFile(path, JSON.stringify(shelf, null, 2), 'utf-8');
}

export async function getShelf(workspaceId: string): Promise<Shelf> {
  if (shelfCache.has(workspaceId)) {
    return shelfCache.get(workspaceId)!;
  }

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) {
    return { items: [] };
  }

  const shelf = await loadShelfFromDisk(workspace.path);
  shelfCache.set(workspaceId, shelf);
  return shelf;
}

async function persistShelf(workspaceId: string, shelf: Shelf): Promise<void> {
  shelfCache.set(workspaceId, shelf);
  const workspace = await getWorkspaceById(workspaceId);
  if (workspace) {
    await saveShelfToDisk(workspace.path, shelf);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft Tasks
// ─────────────────────────────────────────────────────────────────────────────

export async function addDraftTask(workspaceId: string, draft: DraftTask): Promise<Shelf> {
  const shelf = await getShelf(workspaceId);
  shelf.items.push({ type: 'draft-task', item: draft });
  await persistShelf(workspaceId, shelf);
  return shelf;
}

export async function updateDraftTask(workspaceId: string, draftId: string, updates: Partial<DraftTask>): Promise<Shelf> {
  const shelf = await getShelf(workspaceId);
  const idx = shelf.items.findIndex(
    (si) => si.type === 'draft-task' && si.item.id === draftId
  );
  if (idx === -1) throw new Error(`Draft task ${draftId} not found`);

  const existing = shelf.items[idx].item as DraftTask;
  shelf.items[idx] = {
    type: 'draft-task',
    item: { ...existing, ...updates },
  };
  await persistShelf(workspaceId, shelf);
  return shelf;
}

export async function removeDraftTask(workspaceId: string, draftId: string): Promise<Shelf> {
  const shelf = await getShelf(workspaceId);
  shelf.items = shelf.items.filter(
    (si) => !(si.type === 'draft-task' && si.item.id === draftId)
  );
  await persistShelf(workspaceId, shelf);
  return shelf;
}

export async function getDraftTask(workspaceId: string, draftId: string): Promise<DraftTask | null> {
  const shelf = await getShelf(workspaceId);
  const item = shelf.items.find(
    (si) => si.type === 'draft-task' && si.item.id === draftId
  );
  return item ? (item.item as DraftTask) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifacts
// ─────────────────────────────────────────────────────────────────────────────

export async function addArtifact(workspaceId: string, artifact: Artifact): Promise<Shelf> {
  const shelf = await getShelf(workspaceId);
  shelf.items.push({ type: 'artifact', item: artifact });
  await persistShelf(workspaceId, shelf);
  return shelf;
}

export async function updateArtifact(workspaceId: string, artifactId: string, updates: Partial<Artifact>): Promise<Shelf> {
  const shelf = await getShelf(workspaceId);
  const idx = shelf.items.findIndex(
    (si) => si.type === 'artifact' && si.item.id === artifactId
  );
  if (idx === -1) throw new Error(`Artifact ${artifactId} not found`);

  const existing = shelf.items[idx].item as Artifact;
  shelf.items[idx] = {
    type: 'artifact',
    item: { ...existing, ...updates },
  };
  await persistShelf(workspaceId, shelf);
  return shelf;
}

export async function removeArtifact(workspaceId: string, artifactId: string): Promise<Shelf> {
  const shelf = await getShelf(workspaceId);
  shelf.items = shelf.items.filter(
    (si) => !(si.type === 'artifact' && si.item.id === artifactId)
  );
  await persistShelf(workspaceId, shelf);
  return shelf;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk operations
// ─────────────────────────────────────────────────────────────────────────────

export async function clearShelf(workspaceId: string): Promise<Shelf> {
  const shelf: Shelf = { items: [] };
  await persistShelf(workspaceId, shelf);
  return shelf;
}

export async function removeShelfItem(workspaceId: string, itemId: string): Promise<Shelf> {
  const shelf = await getShelf(workspaceId);
  shelf.items = shelf.items.filter((si) => si.item.id !== itemId);
  await persistShelf(workspaceId, shelf);
  return shelf;
}
