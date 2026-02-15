// =============================================================================
// Workspace Idea Backlog Service
// =============================================================================
// A lightweight workspace-scoped scratch pad for short ideas.
// Persisted to .pi/idea-backlog.json and cached in-memory.

import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { IdeaBacklog, IdeaBacklogItem } from '@pi-factory/shared';
import { getWorkspaceById } from './workspace-service.js';

const backlogCache = new Map<string, IdeaBacklog>();

function getIdeaBacklogPath(workspacePath: string): string {
  return join(workspacePath, '.pi', 'idea-backlog.json');
}

async function ensurePiDir(workspacePath: string): Promise<void> {
  await mkdir(join(workspacePath, '.pi'), { recursive: true });
}

function normalizeIdeaBacklog(raw: unknown): IdeaBacklog {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { items?: unknown[] }).items)) {
    return { items: [] };
  }

  const items = (raw as { items: unknown[] }).items
    .map((item): IdeaBacklogItem | null => {
      if (!item || typeof item !== 'object') return null;
      const value = item as Partial<IdeaBacklogItem>;

      if (typeof value.id !== 'string' || value.id.trim().length === 0) return null;
      if (typeof value.text !== 'string') return null;
      if (typeof value.createdAt !== 'string' || value.createdAt.trim().length === 0) return null;

      return {
        id: value.id,
        text: value.text,
        createdAt: value.createdAt,
      };
    })
    .filter((item): item is IdeaBacklogItem => item !== null);

  return { items };
}

async function loadIdeaBacklogFromDisk(workspacePath: string): Promise<IdeaBacklog> {
  const path = getIdeaBacklogPath(workspacePath);
  try {
    const raw = await readFile(path, 'utf-8');
    return normalizeIdeaBacklog(JSON.parse(raw));
  } catch {
    return { items: [] };
  }
}

async function saveIdeaBacklogToDisk(workspacePath: string, backlog: IdeaBacklog): Promise<void> {
  await ensurePiDir(workspacePath);
  const path = getIdeaBacklogPath(workspacePath);
  await writeFile(path, JSON.stringify(backlog, null, 2), 'utf-8');
}

async function persistIdeaBacklog(workspaceId: string, backlog: IdeaBacklog): Promise<void> {
  backlogCache.set(workspaceId, backlog);
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) return;

  await saveIdeaBacklogToDisk(workspace.path, backlog);
}

export async function getIdeaBacklog(workspaceId: string): Promise<IdeaBacklog> {
  const cached = backlogCache.get(workspaceId);
  if (cached) return cached;

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) return { items: [] };

  const backlog = await loadIdeaBacklogFromDisk(workspace.path);
  backlogCache.set(workspaceId, backlog);
  return backlog;
}

export async function addIdeaBacklogItem(workspaceId: string, text: string): Promise<IdeaBacklog> {
  const trimmedText = text.trim();
  if (!trimmedText) {
    throw new Error('Idea text is required');
  }

  const backlog = await getIdeaBacklog(workspaceId);
  backlog.items.push({
    id: `idea-${crypto.randomUUID().slice(0, 8)}`,
    text: trimmedText,
    createdAt: new Date().toISOString(),
  });

  await persistIdeaBacklog(workspaceId, backlog);
  return backlog;
}

export async function removeIdeaBacklogItem(workspaceId: string, ideaId: string): Promise<IdeaBacklog> {
  const backlog = await getIdeaBacklog(workspaceId);
  backlog.items = backlog.items.filter((item) => item.id !== ideaId);

  await persistIdeaBacklog(workspaceId, backlog);
  return backlog;
}

export async function reorderIdeaBacklogItems(workspaceId: string, orderedIdeaIds: string[]): Promise<IdeaBacklog> {
  const backlog = await getIdeaBacklog(workspaceId);

  if (orderedIdeaIds.length !== backlog.items.length) {
    throw new Error('Reorder payload must include every idea exactly once');
  }

  const byId = new Map(backlog.items.map((item) => [item.id, item] as const));
  const reordered: IdeaBacklogItem[] = [];

  for (const ideaId of orderedIdeaIds) {
    const idea = byId.get(ideaId);
    if (!idea) {
      throw new Error('Reorder payload includes unknown idea IDs');
    }
    reordered.push(idea);
    byId.delete(ideaId);
  }

  if (byId.size > 0) {
    throw new Error('Reorder payload must include every idea exactly once');
  }

  backlog.items = reordered;
  await persistIdeaBacklog(workspaceId, backlog);
  return backlog;
}
