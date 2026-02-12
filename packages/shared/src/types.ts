// =============================================================================
// Pi-Factory Shared Types
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
  ready: 5,
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

  // Quality gates
  qualityChecks: QualityChecks;

  // Post-execution skills (run after main agent execution)
  postExecutionSkills?: string[];

  // Model configuration (per-task model selection)
  modelConfig?: ModelConfig;

  // Plan (auto-generated on task creation)
  plan?: TaskPlan;

  // Attachments (images, files)
  attachments: Attachment[];

  // Agent session file (for resuming conversation on re-execution)
  sessionFile?: string;

  // Blocker tracking
  blocked: BlockedState;
}

export interface QualityChecks {
  testsPass: boolean;
  lintPass: boolean;
  reviewDone: boolean;
}

// =============================================================================
// Task Plan (auto-generated on task creation)
// =============================================================================

export interface TaskPlan {
  goal: string;          // What the agent is trying to achieve
  steps: string[];       // What it needs to do to achieve that goal
  validation: string[];  // How to validate the goal has been achieved
  cleanup: string[];     // Post-completion cleanup actions
  generatedAt: string;   // ISO 8601 timestamp
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
  event: 'phase-change' | 'task-created' | 'task-completed' | 'blocked' | 'unblocked' | 'quality-check';
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

  // Quality gates
  requiredQualityChecks?: (keyof QualityChecks)[];

  // Auto-transition rules
  autoTransition?: {
    onTestsPass?: boolean;
    onReviewDone?: boolean;
  };

  // Queue processing (auto-pull from ready queue)
  queueProcessing?: {
    enabled: boolean;
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
  qualityGatePassRate: number;
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
  postExecutionSkills?: string[];
  modelConfig?: ModelConfig;
}

export interface UpdateTaskRequest {
  title?: string;
  phase?: Phase;
  content?: string;
  acceptanceCriteria?: string[];
  assigned?: string | null;
  qualityChecks?: Partial<QualityChecks>;
  plan?: TaskPlan;
  blocked?: Partial<BlockedState>;
  postExecutionSkills?: string[];
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
  // Planning agent events
  | PlanningEvent;

export type AgentExecutionStatus = 'idle' | 'streaming' | 'tool_use' | 'thinking' | 'completed' | 'error' | 'post-hooks';

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

// Planning agent chat message
export interface PlanningMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;       // ISO 8601
  sessionId?: string;      // UUID of the planning session this message belongs to
  metadata?: {
    toolName?: string;
    args?: Record<string, unknown>;
    isError?: boolean;
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
  | { type: 'planning:task_form_updated'; workspaceId: string; formState: Partial<NewTaskFormState> };

export type PlanningAgentStatus = 'idle' | 'streaming' | 'tool_use' | 'thinking' | 'error';

// New task form state (managed by planning agent)
export interface NewTaskFormState {
  content: string;
  selectedSkillIds: string[];
  modelConfig?: ModelConfig;
  skillOrder?: string[];
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
// Post-Execution Skills (Agent Skills spec compliant)
// =============================================================================

export interface PostExecutionSkill {
  id: string;              // directory name, matches frontmatter `name`
  name: string;            // from frontmatter
  description: string;     // from frontmatter
  type: 'follow-up' | 'loop';
  maxIterations: number;
  doneSignal: string;
  promptTemplate: string;  // SKILL.md body (markdown after frontmatter)
  path: string;            // absolute path to skill directory
  metadata: Record<string, string>;
}

/** Default post-execution skills applied to new tasks when none are specified. */
export const DEFAULT_POST_EXECUTION_SKILLS: string[] = ['checkpoint', 'code-review'];
