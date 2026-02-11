// =============================================================================
// Task Service
// =============================================================================
// Manages task files, parsing, and operations

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import YAML from 'yaml';
import type {
  Task,
  TaskFrontmatter,
  CreateTaskRequest,
  UpdateTaskRequest,
  Phase,
  QualityChecks,
  BlockedState,
} from '@pi-factory/shared';
import { saveTaskMetadata, updateTaskPhase } from './db.js';

// =============================================================================
// Task File Operations
// =============================================================================

const TASK_ID_PREFIX = 'TASK-';
let taskCounter = 0;

export function generateTaskId(): string {
  taskCounter++;
  const timestamp = Date.now().toString(36).toUpperCase();
  return `${TASK_ID_PREFIX}${timestamp}-${taskCounter.toString().padStart(3, '0')}`;
}

export function parseTaskFile(filePath: string): Task {
  const content = readFileSync(filePath, 'utf-8');
  return parseTaskContent(content, filePath);
}

export function parseTaskContent(content: string, filePath: string): Task {
  // Parse YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    throw new Error('Invalid task file format: missing frontmatter');
  }

  const [, yamlContent, bodyContent] = frontmatterMatch;
  const parsed = YAML.parse(yamlContent) as Partial<TaskFrontmatter>;

  // Ensure required fields with defaults
  const frontmatter: TaskFrontmatter = {
    id: parsed.id || generateTaskId(),
    title: parsed.title || 'Untitled Task',
    phase: parsed.phase || 'backlog',
    type: parsed.type || 'feature',
    priority: parsed.priority || 'medium',
    created: parsed.created || new Date().toISOString(),
    updated: parsed.updated || new Date().toISOString(),
    assigned: parsed.assigned,
    workspace: parsed.workspace || '',
    project: parsed.project || '',
    blockedCount: parsed.blockedCount || 0,
    blockedDuration: parsed.blockedDuration || 0,
    acceptanceCriteria: parsed.acceptanceCriteria || [],
    testingInstructions: parsed.testingInstructions || [],
    estimatedEffort: parsed.estimatedEffort,
    complexity: parsed.complexity,
    commits: parsed.commits || [],
    qualityChecks: parsed.qualityChecks || {
      testsPass: false,
      lintPass: false,
      reviewDone: false,
    },
    blocked: parsed.blocked || { isBlocked: false },
    ...parsed,
  };

  return {
    id: frontmatter.id,
    frontmatter,
    content: bodyContent.trim(),
    history: [], // Loaded separately from DB
    filePath,
  };
}

export function serializeTask(task: Task): string {
  const frontmatter = task.frontmatter;
  const yamlContent = YAML.stringify(frontmatter, {
    indent: 2,
    lineWidth: 0,
  });

  return `---\n${yamlContent}---\n\n${task.content}`;
}

export function saveTaskFile(task: Task): void {
  const serialized = serializeTask(task);
  writeFileSync(task.filePath, serialized, 'utf-8');
}

// =============================================================================
// Task CRUD Operations
// =============================================================================

export function createTask(
  workspacePath: string,
  tasksDir: string,
  request: CreateTaskRequest
): Task {
  // Ensure tasks directory exists
  if (!existsSync(tasksDir)) {
    mkdirSync(tasksDir, { recursive: true });
  }

  const id = generateTaskId();
  const now = new Date().toISOString();
  const fileName = `${id.toLowerCase()}.md`;
  const filePath = join(tasksDir, fileName);

  const frontmatter: TaskFrontmatter = {
    id,
    title: request.title,
    phase: 'backlog',
    type: request.type,
    priority: request.priority,
    created: now,
    updated: now,
    workspace: workspacePath,
    project: basename(workspacePath),
    blockedCount: 0,
    blockedDuration: 0,
    acceptanceCriteria: request.acceptanceCriteria || [],
    testingInstructions: request.testingInstructions || [],
    estimatedEffort: request.estimatedEffort,
    complexity: request.complexity,
    commits: [],
    qualityChecks: {
      testsPass: false,
      lintPass: false,
      reviewDone: false,
    },
    blocked: {
      isBlocked: false,
    },
  };

  const task: Task = {
    id,
    frontmatter,
    content: request.content || '',
    history: [],
    filePath,
  };

  saveTaskFile(task);
  return task;
}

export function updateTask(
  task: Task,
  request: UpdateTaskRequest
): Task {
  const now = new Date().toISOString();

  if (request.title !== undefined) {
    task.frontmatter.title = request.title;
  }

  if (request.priority !== undefined) {
    task.frontmatter.priority = request.priority;
  }

  if (request.content !== undefined) {
    task.content = request.content;
  }

  if (request.acceptanceCriteria !== undefined) {
    task.frontmatter.acceptanceCriteria = request.acceptanceCriteria;
  }

  if (request.testingInstructions !== undefined) {
    task.frontmatter.testingInstructions = request.testingInstructions;
  }

  if (request.estimatedEffort !== undefined) {
    task.frontmatter.estimatedEffort = request.estimatedEffort;
  }

  if (request.complexity !== undefined) {
    task.frontmatter.complexity = request.complexity;
  }

  if (request.assigned !== undefined) {
    task.frontmatter.assigned = request.assigned || undefined;
  }

  if (request.qualityChecks !== undefined) {
    task.frontmatter.qualityChecks = {
      ...task.frontmatter.qualityChecks,
      ...request.qualityChecks,
    };
  }

  if (request.blocked !== undefined) {
    task.frontmatter.blocked = {
      ...task.frontmatter.blocked,
      ...request.blocked,
    };

    if (request.blocked.isBlocked) {
      task.frontmatter.blockedCount++;
      task.frontmatter.blocked.since = now;
    } else if (task.frontmatter.blocked.since) {
      const blockedTime =
        new Date(now).getTime() - new Date(task.frontmatter.blocked.since).getTime();
      task.frontmatter.blockedDuration += Math.floor(blockedTime / 1000);
      task.frontmatter.blocked.since = undefined;
    }
  }

  task.frontmatter.updated = now;

  saveTaskFile(task);
  return task;
}

export function moveTaskToPhase(
  task: Task,
  newPhase: Phase,
  actor: 'user' | 'agent' | 'system',
  reason?: string,
  workspaceId?: string
): Task {
  const oldPhase = task.frontmatter.phase;

  // Update timestamps based on phase
  const now = new Date().toISOString();

  if (newPhase === 'executing' && !task.frontmatter.started) {
    task.frontmatter.started = now;
  }

  if (newPhase === 'complete') {
    task.frontmatter.completed = now;

    if (task.frontmatter.started) {
      const cycleTime =
        new Date(now).getTime() - new Date(task.frontmatter.started).getTime();
      task.frontmatter.cycleTime = Math.floor(cycleTime / 1000);
    }

    const leadTime =
      new Date(now).getTime() - new Date(task.frontmatter.created).getTime();
    task.frontmatter.leadTime = Math.floor(leadTime / 1000);
  }

  task.frontmatter.phase = newPhase;
  task.frontmatter.updated = now;

  saveTaskFile(task);

  // Update database
  if (workspaceId) {
    updateTaskPhase(task.id, newPhase, actor, reason);
    saveTaskMetadata(task, workspaceId);
  }

  return task;
}

// =============================================================================
// Task Discovery
// =============================================================================

export function discoverTasks(tasksDir: string): Task[] {
  if (!existsSync(tasksDir)) {
    return [];
  }

  const files = readdirSync(tasksDir);
  const tasks: Task[] = [];

  for (const file of files) {
    if (file.endsWith('.md')) {
      try {
        const filePath = join(tasksDir, file);
        const task = parseTaskFile(filePath);
        tasks.push(task);
      } catch (err) {
        console.error(`Failed to parse task file: ${file}`, err);
      }
    }
  }

  return tasks.sort(
    (a, b) =>
      new Date(b.frontmatter.updated).getTime() -
      new Date(a.frontmatter.updated).getTime()
  );
}

export function getTasksByPhase(tasks: Task[], phase: Phase): Task[] {
  return tasks.filter((t) => t.frontmatter.phase === phase);
}

// =============================================================================
// Delete Task
// =============================================================================

export function deleteTask(task: Task): void {
  if (existsSync(task.filePath)) {
    unlinkSync(task.filePath);
  }
}

// =============================================================================
// Validation
// =============================================================================

export function canMoveToPhase(task: Task, targetPhase: Phase): {
  allowed: boolean;
  reason?: string;
} {
  const currentPhase = task.frontmatter.phase;

  // Define valid transitions
  const validTransitions: Record<Phase, Phase[]> = {
    backlog: ['planning'],
    planning: ['backlog', 'ready'],
    ready: ['planning', 'executing'],
    executing: ['ready', 'wrapup'],
    wrapup: ['executing', 'complete'],
    complete: ['wrapup'], // Can reopen
  };

  if (!validTransitions[currentPhase].includes(targetPhase)) {
    return {
      allowed: false,
      reason: `Cannot move from ${currentPhase} to ${targetPhase}`,
    };
  }

  // Phase-specific validation
  if (targetPhase === 'ready') {
    if (task.frontmatter.acceptanceCriteria.length === 0) {
      return {
        allowed: false,
        reason: 'Task must have acceptance criteria before moving to Ready',
      };
    }
  }

  if (targetPhase === 'complete') {
    const qc = task.frontmatter.qualityChecks;
    if (!qc.testsPass || !qc.lintPass) {
      return {
        allowed: false,
        reason: 'All quality checks must pass before completing',
      };
    }
  }

  return { allowed: true };
}
