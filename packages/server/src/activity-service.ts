// =============================================================================
// Activity Log Service
// =============================================================================
// Manages the unified timeline of agent activity across all tasks.
// Activity is stored as a JSONL file per workspace at .pi/factory/activity.jsonl.
// At typical agent usage, this file stays small (thousands of lines max).

import { mkdir, readFile, appendFile } from 'fs/promises';
import { join, dirname } from 'path';
import type {
  ActivityEntry,
  TaskSeparatorEntry,
  ChatMessageEntry,
  SystemEventEntry,
  Phase,
} from '@pi-factory/shared';
import { getWorkspaceById } from './workspace-service.js';

// =============================================================================
// File Operations
// =============================================================================

async function activityFilePath(workspaceId: string): Promise<string> {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
  return join(workspace.path, '.pi', 'factory', 'activity.jsonl');
}

async function ensureActivityDir(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
}

const appendQueueByWorkspace = new Map<string, Promise<void>>();

async function appendEntry(workspaceId: string, entry: ActivityEntry): Promise<void> {
  const previous = appendQueueByWorkspace.get(workspaceId) || Promise.resolve();

  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const filePath = await activityFilePath(workspaceId);
      await ensureActivityDir(filePath);
      await appendFile(filePath, JSON.stringify(entry) + '\n', 'utf-8');
    });

  appendQueueByWorkspace.set(workspaceId, next);

  try {
    await next;
  } finally {
    if (appendQueueByWorkspace.get(workspaceId) === next) {
      appendQueueByWorkspace.delete(workspaceId);
    }
  }
}

async function readAllEntries(workspaceId: string): Promise<ActivityEntry[]> {
  try {
    const filePath = await activityFilePath(workspaceId);
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries: ActivityEntry[] = [];

    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }

    return entries;
  } catch {
    return [];
  }
}

// =============================================================================
// Entry Creation Helpers
// =============================================================================

export async function createTaskSeparator(
  workspaceId: string,
  taskId: string,
  taskTitle: string,
  phase: Phase,
  agentId?: string
): Promise<TaskSeparatorEntry> {
  const entry: TaskSeparatorEntry = {
    type: 'task-separator',
    id: crypto.randomUUID(),
    taskId,
    taskTitle,
    phase,
    timestamp: new Date().toISOString(),
    agentId,
  };

  await appendEntry(workspaceId, entry);
  return entry;
}

export async function createChatMessage(
  workspaceId: string,
  taskId: string,
  role: 'user' | 'agent',
  content: string,
  agentId?: string,
  metadata?: Record<string, unknown>
): Promise<ChatMessageEntry> {
  const entry: ChatMessageEntry = {
    type: 'chat-message',
    id: crypto.randomUUID(),
    taskId,
    role,
    content,
    timestamp: new Date().toISOString(),
    agentId,
    metadata,
  };

  await appendEntry(workspaceId, entry);
  return entry;
}

export async function createSystemEvent(
  workspaceId: string,
  taskId: string,
  event: SystemEventEntry['event'],
  message: string,
  metadata?: Record<string, unknown>
): Promise<SystemEventEntry> {
  const entry: SystemEventEntry = {
    type: 'system-event',
    id: crypto.randomUUID(),
    taskId,
    event,
    message,
    timestamp: new Date().toISOString(),
    metadata,
  };

  await appendEntry(workspaceId, entry);
  return entry;
}

// =============================================================================
// Activity Log Queries
// =============================================================================

export async function getActivityTimeline(
  workspaceId: string,
  limit: number = 100
): Promise<ActivityEntry[]> {
  const entries = await readAllEntries(workspaceId);
  // Return newest first, capped at limit
  return entries.reverse().slice(0, limit);
}

export async function getActivityForTask(
  workspaceId: string,
  taskId: string,
  limit: number = 50
): Promise<ActivityEntry[]> {
  const entries = await readAllEntries(workspaceId);
  return entries
    .filter((e) => e.taskId === taskId)
    .reverse()
    .slice(0, limit);
}

// =============================================================================
// Activity Stream (for WebSocket)
// =============================================================================

export interface ActivityStream {
  entries: ActivityEntry[];
  hasMore: boolean;
  oldestTimestamp?: string;
}

export async function getActivityStream(
  workspaceId: string,
  cursor?: string,
  limit: number = 50
): Promise<ActivityStream> {
  const all = (await readAllEntries(workspaceId)).reverse(); // newest first

  let filtered = all;
  if (cursor) {
    const idx = all.findIndex((e) => e.timestamp < cursor);
    filtered = idx >= 0 ? all.slice(idx) : [];
  }

  const hasMore = filtered.length > limit;
  const results = filtered.slice(0, limit);

  return {
    entries: results,
    hasMore,
    oldestTimestamp: results[results.length - 1]?.timestamp,
  };
}

// =============================================================================
// Activity Grouping (for UI display)
// =============================================================================

export interface ActivityGroup {
  taskId: string;
  taskTitle: string;
  entries: ActivityEntry[];
  startTime: string;
  endTime: string;
}

export function groupActivityByTask(
  entries: ActivityEntry[]
): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  let currentGroup: ActivityGroup | null = null;

  for (const entry of entries) {
    if (entry.type === 'task-separator') {
      currentGroup = {
        taskId: entry.taskId,
        taskTitle: entry.taskTitle,
        entries: [entry],
        startTime: entry.timestamp,
        endTime: entry.timestamp,
      };
      groups.push(currentGroup);
    } else if (currentGroup && entry.taskId === currentGroup.taskId) {
      currentGroup.entries.push(entry);
      currentGroup.startTime = entry.timestamp;
    } else {
      currentGroup = {
        taskId: entry.taskId,
        taskTitle: 'Unknown Task',
        entries: [entry],
        startTime: entry.timestamp,
        endTime: entry.timestamp,
      };
      groups.push(currentGroup);
    }
  }

  return groups;
}

// =============================================================================
// Activity Statistics
// =============================================================================

export interface ActivityStats {
  totalMessages: number;
  userMessages: number;
  agentMessages: number;
  tasksStarted: number;
  tasksCompleted: number;
  averageMessagesPerTask: number;
}

export function calculateActivityStats(
  entries: ActivityEntry[]
): ActivityStats {
  let totalMessages = 0;
  let userMessages = 0;
  let agentMessages = 0;
  let tasksStarted = 0;
  let tasksCompleted = 0;
  const taskIds = new Set<string>();

  for (const entry of entries) {
    if (entry.type === 'chat-message') {
      totalMessages++;
      taskIds.add(entry.taskId);
      if (entry.role === 'user') userMessages++;
      else agentMessages++;
    } else if (entry.type === 'task-separator') {
      tasksStarted++;
      taskIds.add(entry.taskId);
    } else if (entry.type === 'system-event') {
      if (entry.event === 'task-completed') tasksCompleted++;
      taskIds.add(entry.taskId);
    }
  }

  const uniqueTasks = taskIds.size;

  return {
    totalMessages,
    userMessages,
    agentMessages,
    tasksStarted,
    tasksCompleted,
    averageMessagesPerTask: uniqueTasks > 0 ? Math.round(totalMessages / uniqueTasks) : 0,
  };
}
