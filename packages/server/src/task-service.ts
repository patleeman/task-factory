// =============================================================================
// Task Service
// =============================================================================
// Manages task files, parsing, and operations

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  rmSync,
  statSync,
  copyFileSync,
  openSync,
  readSync,
  closeSync,
} from 'fs';
import { join, basename, dirname } from 'path';
import YAML from 'yaml';
import {
  createEmptyTaskUsageMetrics,
  normalizeTaskUsageMetrics,
  type Task,
  type TaskFrontmatter,
  type CreateTaskRequest,
  type UpdateTaskRequest,
  type Phase,
} from '@task-factory/shared';
import { applyTaskDefaultsToRequest, loadTaskDefaultsForWorkspacePath } from './task-defaults-service.js';


// =============================================================================
// Task File Operations
// =============================================================================

const TASK_ID_COUNTER_FILE = '.task-id-counter.json';

type TaskIdCounters = Record<string, number>;

function getTaskIdPrefix(workspacePath: string): string {
  // Prefix: first 4 letters of workspace folder name, uppercase
  const folderName = basename(workspacePath).replace(/[^a-zA-Z]/g, '');
  return (folderName.slice(0, 4) || 'TASK').toUpperCase();
}

function getTaskIdCounterPath(tasksDir: string): string {
  return join(tasksDir, TASK_ID_COUNTER_FILE);
}

function loadTaskIdCounters(tasksDir: string): TaskIdCounters {
  const counterPath = getTaskIdCounterPath(tasksDir);

  if (!existsSync(counterPath)) {
    return {};
  }

  try {
    const raw = readFileSync(counterPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const counters: TaskIdCounters = {};
    for (const [prefix, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        continue;
      }

      counters[prefix.toUpperCase()] = Math.floor(value);
    }

    return counters;
  } catch (err) {
    console.warn(`[TaskService] Failed to parse task ID counter file at ${counterPath}:`, err);
    return {};
  }
}

function saveTaskIdCounters(tasksDir: string, counters: TaskIdCounters): void {
  const counterPath = getTaskIdCounterPath(tasksDir);
  writeFileSync(counterPath, JSON.stringify(counters, null, 2), 'utf-8');
}

function getMaxExistingTaskNumber(tasksDir: string, prefix: string): number {
  if (!existsSync(tasksDir)) {
    return 0;
  }

  let maxNum = 0;
  const entries = readdirSync(tasksDir);
  const dirPattern = new RegExp(`^${prefix}-(\\d+)$`, 'i');

  for (const entry of entries) {
    const match = entry.match(dirPattern);
    if (!match) {
      continue;
    }

    const num = parseInt(match[1], 10);
    if (num > maxNum) {
      maxNum = num;
    }
  }

  return maxNum;
}

export function generateTaskId(workspacePath: string, tasksDir: string): string {
  if (!existsSync(tasksDir)) {
    mkdirSync(tasksDir, { recursive: true });
  }

  const prefix = getTaskIdPrefix(workspacePath);
  const counters = loadTaskIdCounters(tasksDir);
  const lastIssuedNumber = counters[prefix] ?? 0;
  const maxExistingNumber = getMaxExistingTaskNumber(tasksDir, prefix);
  const nextNumber = Math.max(lastIssuedNumber, maxExistingNumber) + 1;

  counters[prefix] = nextNumber;
  saveTaskIdCounters(tasksDir, counters);

  return `${prefix}-${nextNumber}`;
}

export function normalizeAcceptanceCriteria(criteria: unknown): string[] {
  if (!Array.isArray(criteria)) {
    return [];
  }

  return criteria
    .map((criterion) => {
      if (typeof criterion === 'string') {
        return criterion.trim();
      }

      if (criterion == null) {
        return '';
      }

      if (typeof criterion === 'object') {
        const parts = Object.entries(criterion as Record<string, unknown>).map(([key, value]) => {
          const valueText = formatCriterionValue(value);
          return valueText ? `${key}: ${valueText}` : key;
        });
        return parts.join(' ').trim();
      }

      return String(criterion).trim();
    })
    .filter(Boolean);
}

function formatCriterionValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (value == null) {
    return '';
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value).trim();
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeVisualPlanPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const sourceSections = Array.isArray(record.sections) ? record.sections : [];
  const sections: Array<Record<string, unknown>> = [];

  for (const sourceSection of sourceSections) {
    if (!sourceSection || typeof sourceSection !== 'object' || Array.isArray(sourceSection)) {
      sections.push({
        component: 'Unknown',
        originalComponent: 'unknown',
        reason: 'invalid-section-shape',
      });
      continue;
    }

    const section = sourceSection as Record<string, unknown>;
    const component = typeof section.component === 'string' ? section.component : '';

    if (component === 'ArchitectureDiff') {
      const current = section.current as Record<string, unknown> | undefined;
      const planned = section.planned as Record<string, unknown> | undefined;
      const currentCode = typeof current?.code === 'string' ? current.code.trim() : '';
      const plannedCode = typeof planned?.code === 'string' ? planned.code.trim() : '';

      if (!currentCode || !plannedCode) {
        sections.push({
          component: 'Unknown',
          originalComponent: component || 'ArchitectureDiff',
          reason: 'invalid-architecture-diff',
        });
        continue;
      }
    }

    sections.push(section);
  }

  if (sections.length === 0) return null;

  const planTypeRaw = typeof record.planType === 'string' ? record.planType : '';
  const planType = [
    'feature-delivery',
    'bug-fix',
    'refactor',
    'testing-plan',
    'migration-rollout',
    'research-spike',
    'custom',
  ].includes(planTypeRaw)
    ? planTypeRaw
    : undefined;

  return {
    version: '1',
    planType,
    generatedAt: typeof record.generatedAt === 'string' && record.generatedAt ? record.generatedAt : undefined,
    sections,
  };
}

function buildVisualPlanFromLegacyFields(plan: {
  goal: string;
  steps: string[];
  validation: string[];
  cleanup: string[];
  generatedAt: string;
}): Record<string, unknown> {
  return {
    version: '1',
    planType: 'custom',
    generatedAt: plan.generatedAt,
    sections: [
      {
        component: 'SummaryHero',
        title: 'Summary',
        problem: plan.goal,
        insight: plan.steps[0] || 'See plan steps for implementation scope.',
        outcome: plan.goal,
      },
      {
        component: 'ChangeList',
        title: 'Planned Changes',
        items: plan.steps.map((step, index) => ({ area: `Step ${index + 1}`, change: step })),
      },
      {
        component: 'ValidationPlan',
        title: 'Validation',
        checks: [...plan.validation],
      },
      {
        component: 'NextSteps',
        title: 'Next Steps',
        items: [...plan.cleanup],
      },
    ],
  };
}

function normalizeTaskPlan(plan: unknown): TaskFrontmatter['plan'] {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return undefined;

  const record = plan as Record<string, unknown>;
  const generatedAt = typeof record.generatedAt === 'string' && record.generatedAt
    ? record.generatedAt
    : new Date().toISOString();

  let goal = typeof record.goal === 'string' ? record.goal : '';
  let steps = normalizeStringList(record.steps);
  let validation = normalizeStringList(record.validation);
  let cleanup = normalizeStringList(record.cleanup);

  const rawVisualPlan = record.visualPlan;
  const normalizedVisualPlan = normalizeVisualPlanPayload(rawVisualPlan);

  const visualPlan = normalizedVisualPlan
    ? normalizedVisualPlan
    : (goal || steps.length > 0 || validation.length > 0 || cleanup.length > 0)
      ? buildVisualPlanFromLegacyFields({ goal, steps, validation, cleanup, generatedAt })
      : null;

  if (!visualPlan) return undefined;

  if (!goal && typeof (visualPlan as Record<string, unknown>) === 'object') {
    const sections = Array.isArray((visualPlan as Record<string, unknown>).sections)
      ? (visualPlan as Record<string, unknown>).sections as Array<Record<string, unknown>>
      : [];

    const summary = sections.find((section) => section.component === 'SummaryHero');
    const changes = sections.find((section) => section.component === 'ChangeList');
    const checks = sections.find((section) => section.component === 'ValidationPlan');
    const next = sections.find((section) => section.component === 'NextSteps')
      ?? sections.find((section) => section.component === 'FutureWork');

    goal = typeof summary?.outcome === 'string'
      ? String(summary.outcome)
      : (typeof summary?.problem === 'string' ? String(summary.problem) : 'Deliver planned changes and validation scope');

    if (steps.length === 0 && Array.isArray(changes?.items)) {
      steps = changes.items
        .map((item) => (item && typeof item === 'object' ? String((item as Record<string, unknown>).change || '').trim() : ''))
        .filter(Boolean);
    }

    if (validation.length === 0) {
      validation = normalizeStringList(checks?.checks);
    }

    if (cleanup.length === 0) {
      cleanup = normalizeStringList(next?.items);
    }
  }

  return {
    goal,
    steps,
    validation,
    cleanup,
    visualPlan: visualPlan as any,
    generatedAt,
  } as any;
}

export function parseTaskFile(filePath: string): Task {
  const content = readFileSync(filePath, 'utf-8');
  return parseTaskContent(content, filePath);
}

export function parseTaskContent(content: string, filePath: string): Task {
  const parsed = YAML.parse(content) as Partial<TaskFrontmatter> & {
    history?: any[];
    description?: string;
  };

  const history = Array.isArray(parsed.history) ? parsed.history : [];
  delete parsed.history;

  const description = parsed.description || '';
  delete parsed.description;

  const frontmatter = buildFrontmatter(parsed);

  return {
    id: frontmatter.id,
    frontmatter,
    content: description,
    history,
    filePath,
  };
}

function buildFrontmatter(parsed: Partial<TaskFrontmatter>): TaskFrontmatter {
  const frontmatter: TaskFrontmatter = {
    id: parsed.id || `TASK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    title: parsed.title || 'Untitled Task',
    // Migrate legacy 'planning' phase to 'backlog'
    phase: (parsed.phase as string) === 'planning' ? 'backlog' : (parsed.phase || 'backlog'),
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
    blocked: parsed.blocked || { isBlocked: false },
    ...parsed,
  };

  frontmatter.acceptanceCriteria = normalizeAcceptanceCriteria(frontmatter.acceptanceCriteria);
  frontmatter.plan = normalizeTaskPlan(parsed.plan);
  frontmatter.usageMetrics = normalizeTaskUsageMetrics(parsed.usageMetrics);

  return frontmatter;
}

export function serializeTask(task: Task): string {
  const yamlObj: Record<string, unknown> = { ...task.frontmatter };

  // Store the task description inline as a YAML field
  if (task.content) {
    yamlObj.description = task.content;
  }

  if (task.history.length > 0) {
    yamlObj.history = task.history;
  }

  return YAML.stringify(yamlObj, {
    indent: 2,
    lineWidth: 0,
  });
}

/**
 * Returns the directory path for a task given its ID and the tasks root dir.
 */
export function getTaskDir(tasksDir: string, taskId: string): string {
  return join(tasksDir, taskId.toLowerCase());
}

/**
 * Returns the path to the task.yaml file for a given task.
 */
export function getTaskFilePath(tasksDir: string, taskId: string): string {
  return join(getTaskDir(tasksDir, taskId), 'task.yaml');
}

/**
 * Returns the attachments directory for a task (inside the task directory).
 */
export function getTaskAttachmentsDir(tasksDir: string, taskId: string): string {
  return join(getTaskDir(tasksDir, taskId), 'attachments');
}

const ARCHIVED_CONVERSATION_FILENAME = 'conversation-archive.jsonl';

function archiveTaskConversationSnapshot(task: Task): void {
  const sessionFile = typeof task.frontmatter.sessionFile === 'string'
    ? task.frontmatter.sessionFile.trim()
    : '';

  if (!sessionFile || !existsSync(sessionFile)) {
    return;
  }

  let sourceStats;
  try {
    sourceStats = statSync(sessionFile);
  } catch {
    return;
  }

  if (!sourceStats.isFile()) {
    return;
  }

  const taskDir = dirname(task.filePath);
  if (!existsSync(taskDir)) {
    mkdirSync(taskDir, { recursive: true });
  }

  const archivePath = join(taskDir, ARCHIVED_CONVERSATION_FILENAME);

  try {
    copyFileSync(sessionFile, archivePath);
  } catch (err) {
    console.warn(`[TaskService] Failed to snapshot conversation for ${task.id}:`, err);
  }
}

export function saveTaskFile(task: Task): void {
  const serialized = serializeTask(task);
  const taskDir = dirname(task.filePath);
  if (!existsSync(taskDir)) {
    mkdirSync(taskDir, { recursive: true });
  }
  writeFileSync(task.filePath, serialized, 'utf-8');
}

// =============================================================================
// Task CRUD Operations
// =============================================================================

function getLeftInsertOrder(tasks: Task[], phase: Phase, excludeTaskId?: string): number {
  const tasksInPhase = tasks.filter((candidate) => (
    candidate.frontmatter.phase === phase && candidate.id !== excludeTaskId
  ));

  const minOrder = tasksInPhase.reduce(
    (min, candidate) => Math.min(min, candidate.frontmatter.order ?? 0),
    Number.POSITIVE_INFINITY,
  );

  return Number.isFinite(minOrder) ? minOrder - 1 : 0;
}

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
  const taskDir = getTaskDir(tasksDir, id);
  const filePath = getTaskFilePath(tasksDir, id);

  // Create task directory
  mkdirSync(taskDir, { recursive: true });

  // Insert new backlog tasks at the START (left edge in the UI).
  const existingTasks = discoverTasks(tasksDir);
  const nextOrder = getLeftInsertOrder(existingTasks, 'backlog');

  const taskDefaults = loadTaskDefaultsForWorkspacePath(workspacePath);
  const resolvedDefaults = applyTaskDefaultsToRequest(request, taskDefaults);

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
    order: nextOrder,
    acceptanceCriteria: normalizeAcceptanceCriteria(request.acceptanceCriteria),
    plan: normalizeTaskPlan(request.plan),
    planningSkipped: request.skipPlanning === true ? true : undefined,
    testingInstructions: [],
    commits: [],
    attachments: [],
    planningModelConfig: resolvedDefaults.planningModelConfig,
    executionModelConfig: resolvedDefaults.executionModelConfig,
    // Keep legacy field aligned for backward compatibility.
    modelConfig: resolvedDefaults.modelConfig,
    planningFallbackModels: Array.isArray(request.planningFallbackModels) && request.planningFallbackModels.length > 0
      ? request.planningFallbackModels
      : undefined,
    executionFallbackModels: Array.isArray(request.executionFallbackModels) && request.executionFallbackModels.length > 0
      ? request.executionFallbackModels
      : undefined,
    usageMetrics: createEmptyTaskUsageMetrics(),
    prePlanningSkills: resolvedDefaults.prePlanningSkills,
    preExecutionSkills: resolvedDefaults.preExecutionSkills,
    postExecutionSkills: resolvedDefaults.postExecutionSkills,
    skillConfigs: request.skillConfigs,
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
    task.frontmatter.acceptanceCriteria = normalizeAcceptanceCriteria(request.acceptanceCriteria);
  }

  if (request.assigned !== undefined) {
    task.frontmatter.assigned = request.assigned || undefined;
  }

  if (request.plan !== undefined) {
    task.frontmatter.plan = normalizeTaskPlan(request.plan);
  }

  if (request.prePlanningSkills !== undefined) {
    task.frontmatter.prePlanningSkills = request.prePlanningSkills;
  }

  if (request.preExecutionSkills !== undefined) {
    task.frontmatter.preExecutionSkills = request.preExecutionSkills;
  }

  if (request.postExecutionSkills !== undefined) {
    task.frontmatter.postExecutionSkills = request.postExecutionSkills;
  }

  if (request.skillConfigs !== undefined) {
    task.frontmatter.skillConfigs = request.skillConfigs;
  }

  if (request.planningModelConfig !== undefined) {
    task.frontmatter.planningModelConfig = request.planningModelConfig;
  }

  if (request.executionModelConfig !== undefined) {
    task.frontmatter.executionModelConfig = request.executionModelConfig;
    // Keep legacy field aligned for backward compatibility.
    task.frontmatter.modelConfig = request.executionModelConfig;
  } else if (request.modelConfig !== undefined) {
    // Legacy field updates execution model.
    task.frontmatter.executionModelConfig = request.modelConfig;
    task.frontmatter.modelConfig = request.modelConfig;
  }

  if (request.planningFallbackModels !== undefined) {
    task.frontmatter.planningFallbackModels =
      request.planningFallbackModels.length > 0 ? request.planningFallbackModels : undefined;
  }

  if (request.executionFallbackModels !== undefined) {
    task.frontmatter.executionFallbackModels =
      request.executionFallbackModels.length > 0 ? request.executionFallbackModels : undefined;
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

  // Insert at the START of the target phase (left edge in the UI).
  if (allTasks) {
    task.frontmatter.order = getLeftInsertOrder(allTasks, newPhase, task.id);
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
    // Keep completion metadata when simply unarchiving a previously completed task.
    const restoringPreviouslyCompletedTask =
      oldPhase === 'archived' && Boolean(task.frontmatter.completed);

    if (!restoringPreviouslyCompletedTask) {
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

  if (newPhase === 'archived') {
    archiveTaskConversationSnapshot(task);
  }

  return task;
}

// =============================================================================
// Task Discovery
// =============================================================================

const PHASE_HEADER_READ_BYTES = 4 * 1024;

export type TaskDiscoveryScope = 'all' | 'active' | 'archived';

export interface DiscoverTasksOptions {
  scope?: TaskDiscoveryScope;
}

function normalizePhaseForDiscovery(value: string): Phase | null {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'planning') {
    return 'backlog';
  }

  if (
    normalized === 'backlog'
    || normalized === 'ready'
    || normalized === 'executing'
    || normalized === 'complete'
    || normalized === 'archived'
  ) {
    return normalized;
  }

  return null;
}

function shouldIncludeTaskForScope(phase: Phase, scope: TaskDiscoveryScope): boolean {
  if (scope === 'all') {
    return true;
  }

  if (scope === 'archived') {
    return phase === 'archived';
  }

  return phase !== 'archived';
}

function readTaskPhaseFromHeader(filePath: string): Phase | null {
  let fd: number | null = null;

  try {
    fd = openSync(filePath, 'r');
    const buffer = Buffer.alloc(PHASE_HEADER_READ_BYTES);
    const bytesRead = readSync(fd, buffer, 0, PHASE_HEADER_READ_BYTES, 0);

    if (bytesRead <= 0) {
      return null;
    }

    const header = buffer.toString('utf-8', 0, bytesRead);
    const phaseMatch = header.match(/^phase\s*:\s*([^\n\r#]+)/m);
    if (!phaseMatch) {
      return null;
    }

    let phaseValue = phaseMatch[1].trim();
    if (!phaseValue) {
      return null;
    }

    if (
      (phaseValue.startsWith("'") && phaseValue.endsWith("'"))
      || (phaseValue.startsWith('"') && phaseValue.endsWith('"'))
    ) {
      phaseValue = phaseValue.slice(1, -1).trim();
    }

    return normalizePhaseForDiscovery(phaseValue);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close errors.
      }
    }
  }
}

export function discoverTasks(tasksDir: string, options: DiscoverTasksOptions = {}): Task[] {
  if (!existsSync(tasksDir)) {
    return [];
  }

  const scope: TaskDiscoveryScope = options.scope || 'all';
  const entries = readdirSync(tasksDir);
  const tasks: Task[] = [];

  for (const entry of entries) {
    const entryPath = join(tasksDir, entry);

    try {
      const entryStat = statSync(entryPath);

      if (!entryStat.isDirectory()) {
        continue;
      }

      const yamlPath = join(entryPath, 'task.yaml');
      if (!existsSync(yamlPath)) {
        continue;
      }

      if (scope !== 'all') {
        const phaseFromHeader = readTaskPhaseFromHeader(yamlPath);
        if (phaseFromHeader && !shouldIncludeTaskForScope(phaseFromHeader, scope)) {
          continue;
        }
      }

      const task = parseTaskFile(yamlPath);
      if (!shouldIncludeTaskForScope(task.frontmatter.phase, scope)) {
        continue;
      }

      tasks.push(task);
    } catch (err) {
      console.error(`Failed to parse task entry: ${entry}`, err);
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

export function countTasksByScope(tasksDir: string, scope: TaskDiscoveryScope = 'all'): number {
  if (!existsSync(tasksDir)) {
    return 0;
  }

  const entries = readdirSync(tasksDir);
  let count = 0;

  for (const entry of entries) {
    const entryPath = join(tasksDir, entry);

    try {
      const entryStat = statSync(entryPath);

      if (!entryStat.isDirectory()) {
        continue;
      }

      const yamlPath = join(entryPath, 'task.yaml');
      if (!existsSync(yamlPath)) {
        continue;
      }

      if (scope === 'all') {
        parseTaskFile(yamlPath);
        count += 1;
        continue;
      }

      const phaseFromHeader = readTaskPhaseFromHeader(yamlPath);
      if (phaseFromHeader) {
        if (shouldIncludeTaskForScope(phaseFromHeader, scope)) {
          count += 1;
        }
        continue;
      }

      const task = parseTaskFile(yamlPath);
      if (shouldIncludeTaskForScope(task.frontmatter.phase, scope)) {
        count += 1;
      }
    } catch (err) {
      console.error(`Failed to count task entry: ${entry}`, err);
    }
  }

  return count;
}

export function getTasksByPhase(tasks: Task[], phase: Phase): Task[] {
  return tasks.filter((t) => t.frontmatter.phase === phase);
}

/**
 * Returns true when a task should (re)enter planning after startup.
 *
 * Cases:
 * 1. Explicitly interrupted planning run (planningStatus=running, no plan)
 * 2. Legacy unplanned backlog task (no status yet, no plan, has content)
 */
export function shouldResumeInterruptedPlanning(task: Task): boolean {
  if (task.frontmatter.plan) return false;

  if (task.frontmatter.planningStatus === 'running') {
    return true;
  }

  const isLegacyUnplannedBacklogTask =
    !task.frontmatter.planningStatus
    && task.frontmatter.phase === 'backlog'
    && task.content.trim().length > 0;

  return isLegacyUnplannedBacklogTask;
}

// =============================================================================
// Delete Task
// =============================================================================

export function deleteTask(task: Task): void {
  const taskDir = dirname(task.filePath);
  if (existsSync(taskDir)) {
    rmSync(taskDir, { recursive: true, force: true });
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
  // Users can pause executing tasks (move back to backlog/ready) and resume later.
  // The session file is preserved so the agent picks up where it left off.
  // Backlog tasks with acceptance criteria may move directly to executing,
  // skipping the ready phase when the task is already execution-ready.
  const validTransitions: Record<Phase, Phase[]> = {
    backlog: ['ready', 'executing', 'complete', 'archived'],
    ready: ['backlog', 'executing', 'archived'],
    executing: ['backlog', 'ready', 'complete', 'archived'],
    complete: ['ready', 'executing', 'archived'],
    archived: ['backlog', 'complete'], // Restore archived tasks to complete; backlog remains available for manual moves
  };

  if (!validTransitions[currentPhase].includes(targetPhase)) {
    return {
      allowed: false,
      reason: `Cannot move from ${currentPhase} to ${targetPhase}`,
    };
  }

  // Phase-specific validation.
  // Note: the planning-running guard is intentionally checked before the criteria guard so
  // that "still planning" gives a more actionable error than "missing criteria" when both
  // conditions are true on a backlog task.
  if (targetPhase === 'executing' && task.frontmatter.planningStatus === 'running' && !task.frontmatter.plan) {
    return {
      allowed: false,
      reason: 'Task planning is still running',
    };
  }

  const hasAcceptanceCriteria = normalizeAcceptanceCriteria(task.frontmatter.acceptanceCriteria).length > 0;
  const inferredNoPlanMode = task.frontmatter.planningStatus === 'completed'
    && !task.frontmatter.plan
    && !hasAcceptanceCriteria;
  const requiresAcceptanceCriteria = task.frontmatter.planningSkipped !== true && !inferredNoPlanMode;

  if (targetPhase === 'ready') {
    if (requiresAcceptanceCriteria && !hasAcceptanceCriteria) {
      return {
        allowed: false,
        reason: 'Task must have acceptance criteria before moving to Ready',
      };
    }
  }

  // Backlog tasks moving directly to executing must be execution-ready unless planning was explicitly skipped.
  if (targetPhase === 'executing' && currentPhase === 'backlog') {
    if (requiresAcceptanceCriteria && !hasAcceptanceCriteria) {
      return {
        allowed: false,
        reason: 'Task must have acceptance criteria before moving directly to Executing',
      };
    }
  }

  return { allowed: true };
}
