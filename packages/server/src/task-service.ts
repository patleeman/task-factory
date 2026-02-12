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
  TaskPlan,
  CreateTaskRequest,
  UpdateTaskRequest,
  Phase,
  QualityChecks,
  BlockedState,
  Attachment,
  ReorderTasksRequest,
} from '@pi-factory/shared';
import { DEFAULT_POST_EXECUTION_SKILLS } from '@pi-factory/shared';


// =============================================================================
// Task File Operations
// =============================================================================

export function generateTaskId(workspacePath: string, tasksDir: string): string {
  // Prefix: first 4 letters of workspace folder name, uppercase
  const folderName = basename(workspacePath).replace(/[^a-zA-Z]/g, '');
  const prefix = (folderName.slice(0, 4) || 'TASK').toUpperCase();

  // Find highest existing number in this workspace's tasks
  let maxNum = 0;
  if (existsSync(tasksDir)) {
    const files = readdirSync(tasksDir);
    const pattern = new RegExp(`^${prefix.toLowerCase()}-(\\d+)\\.md$`);
    for (const file of files) {
      const match = file.match(pattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
  }

  return `${prefix}-${maxNum + 1}`;
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
  const parsed = YAML.parse(yamlContent) as Partial<TaskFrontmatter> & { history?: any[] };

  // Pull history out — it's stored in YAML but not part of TaskFrontmatter type
  const history = Array.isArray(parsed.history) ? parsed.history : [];
  delete parsed.history;

  // Ensure required fields with defaults
  const frontmatter: TaskFrontmatter = {
    id: parsed.id || `TASK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    title: parsed.title || 'Untitled Task',
    phase: parsed.phase || 'backlog',
    created: parsed.created || new Date().toISOString(),
    updated: parsed.updated || new Date().toISOString(),
    assigned: parsed.assigned,
    workspace: parsed.workspace || '',
    project: parsed.project || '',
    blockedCount: parsed.blockedCount || 0,
    blockedDuration: parsed.blockedDuration || 0,
    order: parsed.order ?? 0,
    acceptanceCriteria: parsed.acceptanceCriteria || [],
    testingInstructions: parsed.testingInstructions || [],
    commits: parsed.commits || [],
    attachments: parsed.attachments || [],
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
    history,
    filePath,
  };
}

export function serializeTask(task: Task): string {
  // Combine frontmatter + history into a single YAML block
  const yamlObj: Record<string, unknown> = { ...task.frontmatter };
  if (task.history.length > 0) {
    yamlObj.history = task.history;
  }

  const yamlContent = YAML.stringify(yamlObj, {
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
  request: CreateTaskRequest,
  title?: string
): Task {
  // Ensure tasks directory exists
  if (!existsSync(tasksDir)) {
    mkdirSync(tasksDir, { recursive: true });
  }

  const id = generateTaskId(workspacePath, tasksDir);
  const now = new Date().toISOString();
  const fileName = `${id.toLowerCase()}.md`;
  const filePath = join(tasksDir, fileName);

  // Assign order = max existing order in backlog + 1 (new tasks go to bottom)
  const existingTasks = discoverTasks(tasksDir);
  const backlogTasks = existingTasks.filter(t => t.frontmatter.phase === 'backlog');
  const maxOrder = backlogTasks.reduce((max, t) => Math.max(max, t.frontmatter.order ?? 0), 0);

  const frontmatter: TaskFrontmatter = {
    id,
    title: title || request.title || 'Untitled Task',
    phase: 'backlog',
    created: now,
    updated: now,
    workspace: workspacePath,
    project: basename(workspacePath),
    blockedCount: 0,
    blockedDuration: 0,
    order: maxOrder + 1,
    acceptanceCriteria: request.acceptanceCriteria || [],
    testingInstructions: [],
    commits: [],
    attachments: [],
    modelConfig: request.modelConfig || undefined,
    postExecutionSkills: request.postExecutionSkills !== undefined
      ? request.postExecutionSkills
      : DEFAULT_POST_EXECUTION_SKILLS,
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

  if (request.content !== undefined) {
    task.content = request.content;
  }

  if (request.acceptanceCriteria !== undefined) {
    task.frontmatter.acceptanceCriteria = request.acceptanceCriteria;
  }

  if (request.assigned !== undefined) {
    task.frontmatter.assigned = request.assigned || undefined;
  }

  if (request.plan !== undefined) {
    task.frontmatter.plan = request.plan;
  }

  if (request.postExecutionSkills !== undefined) {
    task.frontmatter.postExecutionSkills = request.postExecutionSkills;
  }

  if (request.modelConfig !== undefined) {
    task.frontmatter.modelConfig = request.modelConfig;
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
  allTasks?: Task[],
): Task {
  const oldPhase = task.frontmatter.phase;
  const now = new Date().toISOString();

  // Assign order at bottom of target phase
  if (allTasks) {
    const tasksInTarget = allTasks.filter(
      t => t.frontmatter.phase === newPhase && t.id !== task.id
    );
    const maxOrder = tasksInTarget.reduce((max, t) => Math.max(max, t.frontmatter.order ?? 0), 0);
    task.frontmatter.order = maxOrder + 1;
  }

  if (newPhase === 'executing' && !task.frontmatter.started) {
    task.frontmatter.started = now;
  }

  // Rework: moving from complete back to ready — reset execution timestamps
  if (oldPhase === 'complete' && newPhase === 'ready') {
    task.frontmatter.completed = undefined;
    task.frontmatter.started = undefined;
    task.frontmatter.cycleTime = undefined;
    task.frontmatter.leadTime = undefined;
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

  // Record transition in task history
  task.history.push({
    from: oldPhase,
    to: newPhase,
    timestamp: now,
    actor,
    reason,
  });

  saveTaskFile(task);
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

  // Sort by order ASC (lower order = closer to top of column).
  // For tasks with the same order (e.g. legacy tasks without order), fall back to created ASC.
  return tasks.sort((a, b) => {
    const orderDiff = (a.frontmatter.order ?? 0) - (b.frontmatter.order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return new Date(a.frontmatter.created).getTime() - new Date(b.frontmatter.created).getTime();
  });
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
// Reorder Tasks Within a Phase
// =============================================================================

export function reorderTasks(
  tasksDir: string,
  phase: Phase,
  orderedTaskIds: string[],
): Task[] {
  const allTasks = discoverTasks(tasksDir);
  const phaseTasks = allTasks.filter(t => t.frontmatter.phase === phase);
  const now = new Date().toISOString();

  // Build a map for quick lookup
  const taskMap = new Map(phaseTasks.map(t => [t.id, t]));

  // Assign order based on position in the provided array
  const reordered: Task[] = [];
  for (let i = 0; i < orderedTaskIds.length; i++) {
    const task = taskMap.get(orderedTaskIds[i]);
    if (task) {
      task.frontmatter.order = i;
      task.frontmatter.updated = now;
      saveTaskFile(task);
      reordered.push(task);
    }
  }

  return reordered;
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
    executing: ['ready', 'complete'],
    complete: ['ready', 'archived'], // Rework (back to ready) or archive
    archived: [], // Terminal state — no transitions out
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
