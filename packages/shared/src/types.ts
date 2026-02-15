// =============================================================================
// Task Factory Shared Types
// =============================================================================
// Core type definitions for the TPS-inspired agent work queue system

// =============================================================================
// Task Lifecycle Phases (Kanban Columns)
// =============================================================================

export type Phase =
  | 'backlog'
  | 'ready'
  | 'executing'
  | 'complete'
  | 'archived';

export const PHASES: Phase[] = [
  'backlog',
  'ready',
  'executing',
  'complete',
  'archived',
];

export const PHASE_DISPLAY_NAMES: Record<Phase, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  executing: 'Executing',
  complete: 'Complete',
  archived: 'Archived',
};

/**
 * Returns the next phase a task should be promoted to, or null if already at the end.
 * Special case: complete → archived (standard promotion).
 */
export function getPromotePhase(current: Phase): Phase | null {
  const index = PHASES.indexOf(current);
  if (index < 0 || index >= PHASES.length - 1) return null;
  return PHASES[index + 1];
}

/**
 * Returns the previous phase a task should be demoted to, or null if already at the start.
 * Special cases:
 *   - complete demotes to ready (skip executing — rework pattern)
 *   - archived cannot be demoted (null)
 */
export function getDemotePhase(current: Phase): Phase | null {
  if (current === 'archived') return null;
  if (current === 'complete') return 'ready';
  const index = PHASES.indexOf(current);
  if (index <= 0) return null;
  return PHASES[index - 1];
}

// WIP limits for each phase (null = unlimited)
export const DEFAULT_WIP_LIMITS: Record<Phase, number | null> = {
  backlog: null,
  ready: null,
  executing: 1,
  complete: null,
  archived: null,
};

// =============================================================================
// Model Configuration (per-task model selection)
// =============================================================================

export interface ModelConfig {
  provider: string;
  modelId: string;
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
}

export interface TaskDefaults {
  /** Preferred model for planning runs (acceptance criteria + plan generation). */
  planningModelConfig?: ModelConfig;
  /** Preferred model for execution/rework/chat runs. */
  executionModelConfig?: ModelConfig;
  /**
   * Legacy single-model field. Treated as executionModelConfig when present.
   * Kept for backward compatibility with existing settings/task files.
   */
  modelConfig?: ModelConfig;
  preExecutionSkills: string[];
  postExecutionSkills: string[];
}

export interface PlanningGuardrails {
  timeoutMs: number;
  maxToolCalls: number;
  maxReadBytes: number;
}

export const DEFAULT_PLANNING_GUARDRAILS: PlanningGuardrails = {
  timeoutMs: 30 * 60 * 1000,
  maxToolCalls: 40,
  maxReadBytes: 180_000,
};

// =============================================================================
// Task Usage Metrics
// =============================================================================

export interface TaskUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
}

export interface TaskModelUsage extends TaskUsageTotals {
  provider: string;
  modelId: string;
}

export interface TaskUsageMetrics {
  totals: TaskUsageTotals;
  byModel: TaskModelUsage[];
}

function readNumericMetric(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 0 ? value : 0;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed >= 0 ? parsed : 0;
    }
  }

  return 0;
}

function normalizeUsageTotals(value: unknown): TaskUsageTotals {
  const record = (value && typeof value === 'object' && !Array.isArray(value))
    ? value as Record<string, unknown>
    : {};

  const inputTokens = readNumericMetric(record.inputTokens ?? record.input);
  const outputTokens = readNumericMetric(record.outputTokens ?? record.output);
  const cacheReadTokens = readNumericMetric(record.cacheReadTokens ?? record.cacheRead);
  const cacheWriteTokens = readNumericMetric(record.cacheWriteTokens ?? record.cacheWrite);

  const explicitTotal = readNumericMetric(record.totalTokens ?? record.total);
  const computedTotal = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

  let cost = readNumericMetric(record.cost);
  if (cost === 0 && record.cost && typeof record.cost === 'object' && !Array.isArray(record.cost)) {
    const nested = record.cost as Record<string, unknown>;
    cost = readNumericMetric(nested.total ?? nested.amount ?? nested.usd);
  }

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: explicitTotal > 0 ? explicitTotal : computedTotal,
    cost,
  };
}

function normalizeTaskModelUsage(value: unknown): TaskModelUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const provider = typeof record.provider === 'string' ? record.provider.trim() : '';
  const modelId = typeof record.modelId === 'string'
    ? record.modelId.trim()
    : typeof record.model === 'string'
      ? record.model.trim()
      : '';

  if (!provider || !modelId) {
    return null;
  }

  const totals = normalizeUsageTotals(record);

  return {
    provider,
    modelId,
    ...totals,
  };
}

export function createEmptyTaskUsageMetrics(): TaskUsageMetrics {
  return {
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      cost: 0,
    },
    byModel: [],
  };
}

function sumTaskUsageTotals(byModel: TaskModelUsage[]): TaskUsageTotals {
  return byModel.reduce<TaskUsageTotals>((acc, usage) => ({
    inputTokens: acc.inputTokens + usage.inputTokens,
    outputTokens: acc.outputTokens + usage.outputTokens,
    cacheReadTokens: acc.cacheReadTokens + usage.cacheReadTokens,
    cacheWriteTokens: acc.cacheWriteTokens + usage.cacheWriteTokens,
    totalTokens: acc.totalTokens + usage.totalTokens,
    cost: acc.cost + usage.cost,
  }), createEmptyTaskUsageMetrics().totals);
}

function hasNonZeroUsageTotals(totals: TaskUsageTotals): boolean {
  return totals.inputTokens > 0
    || totals.outputTokens > 0
    || totals.cacheReadTokens > 0
    || totals.cacheWriteTokens > 0
    || totals.totalTokens > 0
    || totals.cost > 0;
}

export function normalizeTaskUsageMetrics(value: unknown): TaskUsageMetrics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createEmptyTaskUsageMetrics();
  }

  const record = value as Record<string, unknown>;
  const rawByModel = Array.isArray(record.byModel)
    ? record.byModel
    : Array.isArray(record.models)
      ? record.models
      : [];

  const byModel: TaskModelUsage[] = [];
  const byModelIndex = new Map<string, number>();

  for (const entry of rawByModel) {
    const normalized = normalizeTaskModelUsage(entry);
    if (!normalized) continue;

    const key = `${normalized.provider}::${normalized.modelId}`;
    const existingIndex = byModelIndex.get(key);

    if (existingIndex == null) {
      byModelIndex.set(key, byModel.length);
      byModel.push(normalized);
      continue;
    }

    const existing = byModel[existingIndex];
    byModel[existingIndex] = {
      ...existing,
      inputTokens: existing.inputTokens + normalized.inputTokens,
      outputTokens: existing.outputTokens + normalized.outputTokens,
      cacheReadTokens: existing.cacheReadTokens + normalized.cacheReadTokens,
      cacheWriteTokens: existing.cacheWriteTokens + normalized.cacheWriteTokens,
      totalTokens: existing.totalTokens + normalized.totalTokens,
      cost: existing.cost + normalized.cost,
    };
  }

  const totalsFromModels = sumTaskUsageTotals(byModel);

  let totals = totalsFromModels;
  if (Object.prototype.hasOwnProperty.call(record, 'totals')) {
    const totalsFromRecord = normalizeUsageTotals(record.totals);
    totals = hasNonZeroUsageTotals(totalsFromRecord)
      ? totalsFromRecord
      : totalsFromModels;
  }

  return {
    totals,
    byModel,
  };
}

// =============================================================================
// Task Frontmatter (YAML header in markdown files)
// =============================================================================

export interface TaskFrontmatter {
  // Identity
  id: string;
  title: string;

  // Status
  phase: Phase;

  // Timestamps
  created: string; // ISO 8601
  updated: string; // ISO 8601
  started?: string; // ISO 8601 - when moved to executing
  completed?: string; // ISO 8601 - when moved to complete

  // Assignment
  assigned?: string; // agent ID or null
  workspace: string; // absolute path
  project: string; // project name

  // TPS-inspired metrics
  cycleTime?: number; // seconds, calculated on completion
  leadTime?: number; // seconds, from created to completed
  blockedCount: number;
  blockedDuration: number; // seconds total

  // Planning
  acceptanceCriteria: string[];
  testingInstructions: string[];

  // Execution
  branch?: string;
  commits: string[];
  prUrl?: string;

  // Ordering (position within a column; lower = closer to top)
  order: number;

  // Pre-execution skills (run before main agent execution)
  preExecutionSkills?: string[];

  // Post-execution skills (run after main agent execution)
  postExecutionSkills?: string[];

  // Skill configuration overrides (skillId -> { key -> value })
  skillConfigs?: Record<string, Record<string, string>>;

  // Model configuration (per-task model selection)
  planningModelConfig?: ModelConfig;
  executionModelConfig?: ModelConfig;
  /** Legacy single-model field (treated as execution model). */
  modelConfig?: ModelConfig;

  // Per-task model usage metrics (tokens/cost, accumulated over time)
  usageMetrics?: TaskUsageMetrics;

  // Plan (auto-generated on task creation)
  plan?: TaskPlan;

  // Planning lifecycle (used to recover interrupted planning after restarts)
  planningStatus?: 'running' | 'completed' | 'error';

  // Attachments (images, files)
  attachments: Attachment[];

  // Agent session file (for resuming conversation on re-execution)
  sessionFile?: string;

  // Post-execution summary (generated after task completion)
  postExecutionSummary?: PostExecutionSummary;

  // Blocker tracking
  blocked: BlockedState;
}

// =============================================================================
// Task Plan (auto-generated on task creation)
// =============================================================================

export interface TaskPlan {
  goal: string;          // High-level summary of what the agent is trying to achieve
  steps: string[];       // High-level, outcome-focused steps (not line-level implementation details)
  validation: string[];  // High-level checks for verifying the outcome
  cleanup: string[];     // Post-completion cleanup actions
  generatedAt: string;   // ISO 8601 timestamp
}

// =============================================================================
// Post-Execution Summary
// =============================================================================

export interface PostExecutionSummary {
  summary: string;           // Short description of work done
  completedAt: string;       // ISO 8601
  fileDiffs: FileDiff[];     // Word-level diffs of changed files
  criteriaValidation: CriterionValidation[];
  artifacts: SummaryArtifact[];
}

export interface FileDiff {
  filePath: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  /** 'add' for new text, 'del' for removed text, 'ctx' for unchanged context */
  type: 'add' | 'del' | 'ctx';
  content: string;
}

export type CriterionStatus = 'pass' | 'fail' | 'pending';

export interface CriterionValidation {
  criterion: string;
  status: CriterionStatus;
  evidence: string;
}

export interface SummaryArtifact {
  name: string;
  url: string;
  type: string;  // e.g. 'screenshot', 'log', 'report'
}

export interface BlockedState {
  isBlocked: boolean;
  reason?: string;
  since?: string; // ISO 8601
}

// =============================================================================
// Task (full entity)
// =============================================================================

export interface Task {
  id: string;
  frontmatter: TaskFrontmatter;
  content: string; // markdown body
  history: PhaseTransition[];
  filePath: string;
}

// Note: Chat messages are stored in ActivityLog, not per-task
// This enables the unified timeline view

export interface PhaseTransition {
  from: Phase;
  to: Phase;
  timestamp: string; // ISO 8601
  actor: 'user' | 'agent' | 'system';
  reason?: string;
}

// =============================================================================
// Activity Log (Unified Timeline)
// =============================================================================

export interface ActivityLog {
  workspaceId: string;
  entries: ActivityEntry[];
}

export type ActivityEntry =
  | TaskSeparatorEntry
  | ChatMessageEntry
  | SystemEventEntry;

export interface TaskSeparatorEntry {
  type: 'task-separator';
  id: string;
  taskId: string;
  taskTitle: string;
  phase: Phase;
  timestamp: string; // ISO 8601 - when agent started on this task
  agentId?: string;
}

export interface ChatMessageEntry {
  type: 'chat-message';
  id: string;
  taskId: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string; // ISO 8601
  agentId?: string;
  metadata?: Record<string, unknown>;
}

export interface SystemEventEntry {
  type: 'system-event';
  id: string;
  taskId: string;
  event: 'phase-change' | 'task-created' | 'task-completed' | 'blocked' | 'unblocked';
  message: string;
  timestamp: string; // ISO 8601
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Workspace
// =============================================================================

export interface Workspace {
  id: string;
  path: string;
  name: string;
  config: WorkspaceConfig;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceAutomationConfig {
  /** Auto-move backlog tasks to ready when planning completes. */
  backlogToReady?: boolean;
  /** Auto-move ready tasks to executing via queue manager. */
  readyToExecuting?: boolean;
}

export interface WorkspaceAutomationSettings {
  backlogToReady: boolean;
  readyToExecuting: boolean;
}

/** Global workflow defaults persisted in ~/.pi/factory/settings.json. */
export interface WorkflowDefaultsConfig {
  executingLimit?: number;
  backlogToReady?: boolean;
  readyToExecuting?: boolean;
}

/** Workspace-level override values (undefined = inherit from global defaults). */
export interface WorkspaceWorkflowOverrides {
  executingLimit?: number;
  backlogToReady?: boolean;
  readyToExecuting?: boolean;
}

/** Fully-resolved workflow settings used at runtime. */
export interface WorkspaceWorkflowSettings extends WorkspaceAutomationSettings {
  executingLimit: number;
}

export interface WorkspaceConfig {
  // Task file locations
  taskLocations: string[]; // directory paths
  defaultTaskLocation: string;

  // WIP limits (override defaults)
  wipLimits?: Partial<Record<Phase, number | null>>;

  // Git integration
  gitIntegration?: {
    enabled: boolean;
    defaultBranch: string;
    branchPrefix: string;
  };

  // Queue processing (legacy + runtime persistence for ready→executing auto flow)
  queueProcessing?: {
    enabled: boolean;
  };

  // Workflow automation settings (per-workspace)
  workflowAutomation?: WorkspaceAutomationConfig;
}

const BUILT_IN_EXECUTING_LIMIT = typeof DEFAULT_WIP_LIMITS.executing === 'number' && DEFAULT_WIP_LIMITS.executing > 0
  ? DEFAULT_WIP_LIMITS.executing
  : 1;

export const DEFAULT_WORKFLOW_SETTINGS: WorkspaceWorkflowSettings = {
  executingLimit: BUILT_IN_EXECUTING_LIMIT,
  backlogToReady: false,
  readyToExecuting: true,
};

function sanitizeWorkflowSlotLimit(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : undefined;
}

export function resolveGlobalWorkflowSettings(
  defaults: WorkflowDefaultsConfig | null | undefined,
): WorkspaceWorkflowSettings {
  return {
    executingLimit: sanitizeWorkflowSlotLimit(defaults?.executingLimit) ?? DEFAULT_WORKFLOW_SETTINGS.executingLimit,
    backlogToReady: typeof defaults?.backlogToReady === 'boolean'
      ? defaults.backlogToReady
      : DEFAULT_WORKFLOW_SETTINGS.backlogToReady,
    readyToExecuting: typeof defaults?.readyToExecuting === 'boolean'
      ? defaults.readyToExecuting
      : DEFAULT_WORKFLOW_SETTINGS.readyToExecuting,
  };
}

export function getWorkspaceWorkflowOverrides(config: WorkspaceConfig): WorkspaceWorkflowOverrides {
  const executingLimit = sanitizeWorkflowSlotLimit(config.wipLimits?.executing);

  const backlogToReady = typeof config.workflowAutomation?.backlogToReady === 'boolean'
    ? config.workflowAutomation.backlogToReady
    : undefined;

  const readyToExecuting = typeof config.workflowAutomation?.readyToExecuting === 'boolean'
    ? config.workflowAutomation.readyToExecuting
    : typeof config.queueProcessing?.enabled === 'boolean'
      ? config.queueProcessing.enabled
      : undefined;

  return {
    executingLimit,
    backlogToReady,
    readyToExecuting,
  };
}

export function resolveWorkspaceWorkflowSettings(
  config: WorkspaceConfig,
  globalDefaults?: WorkflowDefaultsConfig | null,
): WorkspaceWorkflowSettings {
  const defaults = resolveGlobalWorkflowSettings(globalDefaults);
  const overrides = getWorkspaceWorkflowOverrides(config);

  return {
    executingLimit: overrides.executingLimit ?? defaults.executingLimit,
    backlogToReady: overrides.backlogToReady ?? defaults.backlogToReady,
    readyToExecuting: overrides.readyToExecuting ?? defaults.readyToExecuting,
  };
}

export function resolveWorkspaceWipLimit(
  config: WorkspaceConfig,
  phase: Phase,
  globalDefaults?: WorkflowDefaultsConfig | null,
): number | null {
  if (phase === 'ready') {
    return null;
  }

  if (phase === 'executing') {
    return resolveWorkspaceWorkflowSettings(config, globalDefaults).executingLimit;
  }

  return config.wipLimits?.[phase] ?? DEFAULT_WIP_LIMITS[phase];
}

export function getWorkspaceAutomationSettings(
  config: WorkspaceConfig,
  globalDefaults?: WorkflowDefaultsConfig | null,
): WorkspaceAutomationSettings {
  const resolved = resolveWorkspaceWorkflowSettings(config, globalDefaults);
  return {
    backlogToReady: resolved.backlogToReady,
    readyToExecuting: resolved.readyToExecuting,
  };
}

// =============================================================================
// Agent
// =============================================================================

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'offline';

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  currentTask?: string; // task ID or null
  workspace: string; // workspace ID
  capabilities: string[];
  lastSeen: string; // ISO 8601
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Metrics
// =============================================================================

export interface Metrics {
  // Flow metrics
  cycleTime: MetricSummary; // average time from ready -> complete
  leadTime: MetricSummary; // average time from created -> complete
  throughput: number; // tasks completed per day

  // WIP metrics
  currentWip: Record<Phase, number>;
  wipLimitBreaches: number;

  // Quality metrics
  reworkRate: number; // tasks that went back to executing

  // Agent metrics
  agentUtilization: Record<string, number>; // % of time working

  // Time range
  startDate: string;
  endDate: string;
}

export interface MetricSummary {
  average: number; // seconds
  median: number; // seconds
  p95: number; // seconds
  min: number;
  max: number;
}

// =============================================================================
// API Types
// =============================================================================

export interface CreateTaskRequest {
  title?: string; // Auto-generated if not provided
  content: string; // Task description
  acceptanceCriteria?: string[]; // Auto-generated if not provided
  plan?: TaskPlan;
  preExecutionSkills?: string[];
  postExecutionSkills?: string[];
  skillConfigs?: Record<string, Record<string, string>>;
  planningModelConfig?: ModelConfig;
  executionModelConfig?: ModelConfig;
  /** Legacy single-model field (treated as execution model). */
  modelConfig?: ModelConfig;
}

export interface UpdateTaskRequest {
  title?: string;
  phase?: Phase;
  content?: string;
  acceptanceCriteria?: string[];
  assigned?: string | null;
  plan?: TaskPlan;
  blocked?: Partial<BlockedState>;
  preExecutionSkills?: string[];
  postExecutionSkills?: string[];
  skillConfigs?: Record<string, Record<string, string>>;
  planningModelConfig?: ModelConfig;
  executionModelConfig?: ModelConfig;
  /** Legacy single-model field (treated as execution model). */
  modelConfig?: ModelConfig;
}

export interface MoveTaskRequest {
  toPhase: Phase;
  reason?: string;
}

export interface ReorderTasksRequest {
  phase: Phase;
  taskIds: string[]; // ordered list — index 0 = top of column
}

export interface ClaimTaskRequest {
  agentId: string;
}

// =============================================================================
// WebSocket Events
// =============================================================================

export type ServerEvent =
  | { type: 'task:created'; task: Task }
  | { type: 'task:updated'; task: Task; changes: Partial<Task> }
  | { type: 'task:moved'; task: Task; from: Phase; to: Phase }
  | { type: 'task:reordered'; phase: Phase; taskIds: string[] }
  | { type: 'task:claimed'; task: Task; agent: Agent }
  | { type: 'activity:entry'; entry: ActivityEntry }
  | { type: 'agent:status'; agent: Agent }
  | { type: 'metrics:updated'; metrics: Metrics }
  | { type: 'wip:breach'; phase: Phase; current: number; limit: number }
  // Streaming events for live agent output
  | { type: 'agent:streaming_start'; taskId: string }
  | { type: 'agent:streaming_text'; taskId: string; delta: string }
  | { type: 'agent:streaming_end'; taskId: string; fullText: string }
  | { type: 'agent:thinking_delta'; taskId: string; delta: string }
  | { type: 'agent:thinking_end'; taskId: string }
  | { type: 'agent:tool_start'; taskId: string; toolName: string; toolCallId: string }
  | { type: 'agent:tool_update'; taskId: string; toolCallId: string; delta: string }
  | { type: 'agent:tool_end'; taskId: string; toolCallId: string; toolName: string; isError: boolean; result?: string }
  | { type: 'agent:turn_end'; taskId: string }
  | { type: 'agent:execution_status'; taskId: string; status: AgentExecutionStatus }
  | { type: 'task:plan_generated'; taskId: string; plan: TaskPlan }
  | { type: 'queue:status'; status: QueueStatus }
  | {
    type: 'workspace:automation_updated';
    workspaceId: string;
    settings: WorkspaceWorkflowSettings;
    overrides?: WorkspaceWorkflowOverrides;
    globalDefaults?: WorkspaceWorkflowSettings;
  }
  | { type: 'idea_backlog:updated'; workspaceId: string; backlog: IdeaBacklog }
  // Planning agent events
  | PlanningEvent;

export type AgentExecutionStatus = 'idle' | 'awaiting_input' | 'streaming' | 'tool_use' | 'thinking' | 'completed' | 'error' | 'pre-hooks' | 'post-hooks';

export type ClientEvent =
  | { type: 'subscribe'; workspaceId: string }
  | { type: 'unsubscribe'; workspaceId: string }
  | { type: 'task:move'; taskId: string; toPhase: Phase }
  | { type: 'task:claim'; taskId: string; agentId: string }
  | { type: 'activity:send'; taskId: string; content: string; role: 'user' | 'agent' }
  | { type: 'agent:heartbeat'; agentId: string };

// =============================================================================
// Attachments
// =============================================================================

export interface Attachment {
  id: string;
  filename: string;       // original filename
  storedName: string;     // on-disk filename (id + extension)
  mimeType: string;
  size: number;           // bytes
  createdAt: string;      // ISO 8601
}

// =============================================================================
// Queue Manager
// =============================================================================

export interface QueueStatus {
  workspaceId: string;
  enabled: boolean;
  currentTaskId: string | null;
  tasksInReady: number;
  tasksInExecuting: number;
}

export interface WorkspaceWorkflowSettingsResponse {
  /** Legacy alias retained for older clients. */
  settings: WorkspaceAutomationSettings;
  effective: WorkspaceWorkflowSettings;
  overrides: WorkspaceWorkflowOverrides;
  globalDefaults: WorkspaceWorkflowSettings;
  queueStatus: QueueStatus;
}

// =============================================================================
// Planning Agent: Draft Tasks & Artifacts (Shelf)
// =============================================================================

export interface DraftTask {
  id: string;              // temporary ID (e.g. "draft-abc123")
  title: string;
  content: string;         // markdown description
  acceptanceCriteria: string[];
  plan?: TaskPlan;         // optional pre-generated plan
  createdAt: string;       // ISO 8601
}

export interface Artifact {
  id: string;
  name: string;
  html: string;            // raw HTML to render in sandboxed iframe
  createdAt: string;       // ISO 8601
}

export type ShelfItem =
  | { type: 'draft-task'; item: DraftTask }
  | { type: 'artifact'; item: Artifact };

export interface Shelf {
  items: ShelfItem[];
}

// Workspace idea backlog (simple scratch-pad list)
export interface IdeaBacklogItem {
  id: string;
  text: string;
  createdAt: string;
}

export interface IdeaBacklog {
  items: IdeaBacklogItem[];
}

// Planning agent chat message
export interface PlanningMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'qa';
  content: string;
  timestamp: string;       // ISO 8601
  sessionId?: string;      // UUID of the planning session this message belongs to
  metadata?: {
    toolName?: string;
    args?: Record<string, unknown>;
    isError?: boolean;
    /** Stable reference for create_artifact tool messages. */
    artifactId?: string;
    artifactName?: string;
    /** Renderable HTML payload for inline artifact reopen in chat history. */
    artifactHtml?: string;
    /** Full draft-task payload for inline task cards in chat history. */
    draftTask?: DraftTask;
    qaRequest?: QARequest;
    qaResponse?: QAResponse;
  };
}

// Planning agent WebSocket events
export type PlanningEvent =
  | { type: 'planning:message'; workspaceId: string; message: PlanningMessage }
  | { type: 'planning:streaming_text'; workspaceId: string; delta: string }
  | { type: 'planning:streaming_end'; workspaceId: string; fullText: string; messageId: string }
  | { type: 'planning:tool_start'; workspaceId: string; toolName: string; toolCallId: string }
  | { type: 'planning:tool_update'; workspaceId: string; toolCallId: string; delta: string }
  | { type: 'planning:tool_end'; workspaceId: string; toolCallId: string; toolName: string; isError: boolean; result?: string }
  | { type: 'planning:thinking_delta'; workspaceId: string; delta: string }
  | { type: 'planning:thinking_end'; workspaceId: string }
  | { type: 'planning:turn_end'; workspaceId: string }
  | { type: 'planning:status'; workspaceId: string; status: PlanningAgentStatus }
  | { type: 'planning:session_reset'; workspaceId: string; sessionId: string }
  | { type: 'shelf:updated'; workspaceId: string; shelf: Shelf }
  | { type: 'planning:task_form_updated'; workspaceId: string; formState: Partial<NewTaskFormState> }
  | { type: 'qa:request'; workspaceId: string; request: QARequest };

export type PlanningAgentStatus = 'idle' | 'streaming' | 'tool_use' | 'thinking' | 'error' | 'awaiting_qa';

// New task form state (managed by planning agent)
export interface NewTaskFormState {
  content: string;
  selectedSkillIds: string[];
  selectedPreSkillIds?: string[];
  planningModelConfig?: ModelConfig;
  executionModelConfig?: ModelConfig;
  /** Legacy single-model field (treated as execution model). */
  modelConfig?: ModelConfig;
  skillOrder?: string[];
}

// =============================================================================
// Q&A Disambiguation
// =============================================================================

export interface QAQuestion {
  id: string;
  text: string;
  options: string[];
}

export interface QARequest {
  requestId: string;
  questions: QAQuestion[];
}

export interface QAAnswer {
  questionId: string;
  selectedOption: string;
}

export interface QAResponse {
  requestId: string;
  answers: QAAnswer[];
}

// =============================================================================
// Utility Types
// =============================================================================

export interface KanbanColumn {
  phase: Phase;
  name: string;
  tasks: Task[];
  wipLimit: number | null;
  count: number;
  isOverLimit: boolean;
}

export interface FilterOptions {
  phase?: Phase;
  assigned?: string;
  search?: string;
}

export interface SortOptions {
  field: 'created' | 'updated' | 'title';
  direction: 'asc' | 'desc';
}

// =============================================================================
// Execution Skills (Agent Skills spec compliant)
// =============================================================================

export type SkillHook = 'pre' | 'post';
export type SkillSource = 'starter' | 'user';

export interface SkillConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  default: string;
  description: string;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    options?: string[];  // for 'select' type
  };
}

export interface PostExecutionSkill {
  id: string;              // directory name, matches frontmatter `name`
  name: string;            // from frontmatter
  description: string;     // from frontmatter
  type: 'follow-up' | 'loop';
  hooks: SkillHook[];      // supported execution hooks for this skill
  workflowId?: string;     // optional workflow grouping ID (e.g. "tdd")
  pairedSkillId?: string;  // optional paired skill ID for multi-hook workflows
  maxIterations: number;
  doneSignal: string;
  promptTemplate: string;  // SKILL.md body (markdown after frontmatter)
  path: string;            // absolute path to skill directory
  source: SkillSource;     // built-in starter skill vs user-defined skill
  metadata: Record<string, string>;
  configSchema: SkillConfigField[];
}

/** Default pre-execution skills applied to new tasks when none are specified. */
export const DEFAULT_PRE_EXECUTION_SKILLS: string[] = [];

/** Default post-execution skills applied to new tasks when none are specified. */
export const DEFAULT_POST_EXECUTION_SKILLS: string[] = ['checkpoint', 'code-review'];
