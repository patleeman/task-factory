// =============================================================================
// Activity Log Service
// =============================================================================
// Manages the unified timeline of agent activity across all tasks.
// Activity is stored as a JSONL file per workspace at .pi/factory/activity.jsonl.
// At typical agent usage, this file stays small (thousands of lines max).

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
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

function activityFilePath(workspaceId: string): string {
  const workspace = getWorkspaceById(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
  return join(workspace.path, '.pi', 'factory', 'activity.jsonl');
}

function ensureActivityDir(filePath: string): void {
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function appendEntry(workspaceId: string, entry: ActivityEntry): void {
  const filePath = activityFilePath(workspaceId);
  ensureActivityDir(filePath);
  appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
}

function readAllEntries(workspaceId: string): ActivityEntry[] {
  const filePath = activityFilePath(workspaceId);
  if (!existsSync(filePath)) return [];

  const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
  const entries: ActivityEntry[] = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

// =============================================================================
// Entry Creation Helpers
// =============================================================================

export function createTaskSeparator(
  workspaceId: string,
  taskId: string,
  taskTitle: string,
  phase: Phase,
  agentId?: string
): TaskSeparatorEntry {
  const entry: TaskSeparatorEntry = {
    type: 'task-separator',
    id: crypto.randomUUID(),
    taskId,
    taskTitle,
    phase,
    timestamp: new Date().toISOString(),
    agentId,
  };

  appendEntry(workspaceId, entry);
  return entry;
}

export function createChatMessage(
  workspaceId: string,
  taskId: string,
  role: 'user' | 'agent',
  content: string,
  agentId?: string,
  metadata?: Record<string, unknown>
): ChatMessageEntry {
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

  appendEntry(workspaceId, entry);
  return entry;
}

export function createSystemEvent(
  workspaceId: string,
  taskId: string,
  event: SystemEventEntry['event'],
  message: string,
  metadata?: Record<string, unknown>
): SystemEventEntry {
  const entry: SystemEventEntry = {
    type: 'system-event',
    id: crypto.randomUUID(),
    taskId,
    event,
    message,
    timestamp: new Date().toISOString(),
    metadata,
  };

  appendEntry(workspaceId, entry);
  return entry;
}

// =============================================================================
// Activity Log Queries
// =============================================================================

export function getActivityTimeline(
  workspaceId: string,
  limit: number = 100
): ActivityEntry[] {
  const entries = readAllEntries(workspaceId);
  // Return newest first, capped at limit
  return entries.reverse().slice(0, limit);
}

export function getActivityForTask(
  workspaceId: string,
  taskId: string,
  limit: number = 50
): ActivityEntry[] {
  const entries = readAllEntries(workspaceId);
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

export function getActivityStream(
  workspaceId: string,
  cursor?: string,
  limit: number = 50
): ActivityStream {
  const all = readAllEntries(workspaceId).reverse(); // newest first

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
