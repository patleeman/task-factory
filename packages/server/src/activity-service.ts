// =============================================================================
// Activity Log Service
// =============================================================================
// Manages the unified timeline of agent activity across all tasks

import type {
  ActivityEntry,
  TaskSeparatorEntry,
  ChatMessageEntry,
  SystemEventEntry,
  TaskType,
  Phase,
} from '@pi-factory/shared';
import { addActivityEntry, getActivityLog, getRecentActivity } from './db.js';

// =============================================================================
// Entry Creation Helpers
// =============================================================================

export function createTaskSeparator(
  workspaceId: string,
  taskId: string,
  taskTitle: string,
  taskType: TaskType,
  phase: Phase,
  agentId?: string
): TaskSeparatorEntry {
  const entry: TaskSeparatorEntry = {
    type: 'task-separator',
    id: crypto.randomUUID(),
    taskId,
    taskTitle,
    taskType,
    phase,
    timestamp: new Date().toISOString(),
    agentId,
  };

  addActivityEntry(workspaceId, entry);
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

  addActivityEntry(workspaceId, entry);
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

  addActivityEntry(workspaceId, entry);
  return entry;
}

// =============================================================================
// Activity Log Queries
// =============================================================================

export function getActivityTimeline(
  workspaceId: string,
  limit: number = 100
): ActivityEntry[] {
  return getRecentActivity(workspaceId, limit);
}

export function getActivityForTask(
  workspaceId: string,
  taskId: string,
  limit: number = 50
): ActivityEntry[] {
  return getActivityLog(workspaceId, { taskId, limit });
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
  const entries = getActivityLog(workspaceId, {
    before: cursor,
    limit: limit + 1, // Get one extra to check if there are more
  });

  const hasMore = entries.length > limit;
  const results = hasMore ? entries.slice(0, limit) : entries;

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
  taskType: TaskType;
  entries: ActivityEntry[];
  startTime: string;
  endTime: string;
}

export function groupActivityByTask(
  entries: ActivityEntry[]
): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  let currentGroup: ActivityGroup | null = null;

  // Process entries in reverse chronological order (newest first)
  for (const entry of entries) {
    if (entry.type === 'task-separator') {
      // Start a new group
      currentGroup = {
        taskId: entry.taskId,
        taskTitle: entry.taskTitle,
        taskType: entry.taskType,
        entries: [entry],
        startTime: entry.timestamp,
        endTime: entry.timestamp,
      };
      groups.push(currentGroup);
    } else if (currentGroup && entry.taskId === currentGroup.taskId) {
      // Add to current group
      currentGroup.entries.push(entry);
      currentGroup.startTime = entry.timestamp; // Update start (oldest in group)
    } else {
      // Entry for a different task without a separator
      // Create an implicit group
      currentGroup = {
        taskId: entry.taskId,
        taskTitle: 'Unknown Task',
        taskType: 'feature',
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
      if (entry.role === 'user') {
        userMessages++;
      } else {
        agentMessages++;
      }
    } else if (entry.type === 'task-separator') {
      tasksStarted++;
      taskIds.add(entry.taskId);
    } else if (entry.type === 'system-event') {
      if (entry.event === 'task-completed') {
        tasksCompleted++;
      }
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
    averageMessagesPerTask:
      uniqueTasks > 0 ? Math.round(totalMessages / uniqueTasks) : 0,
  };
}
