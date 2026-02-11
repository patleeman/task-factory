// =============================================================================
// Pi-Factory Shared Types
// =============================================================================
// Core type definitions for the TPS-inspired agent work queue system

// =============================================================================
// Task Lifecycle Phases (Kanban Columns)
// =============================================================================

export type Phase =
  | 'backlog'
  | 'planning'
  | 'ready'
  | 'executing'
  | 'complete';

export const PHASES: Phase[] = [
  'backlog',
  'planning',
  'ready',
  'executing',
  'complete',
];

export const PHASE_DISPLAY_NAMES: Record<Phase, string> = {
  backlog: 'Backlog',
  planning: 'Planning',
  ready: 'Ready',
  executing: 'Executing',
  complete: 'Complete',
};

// WIP limits for each phase (null = unlimited)
export const DEFAULT_WIP_LIMITS: Record<Phase, number | null> = {
  backlog: null,
  planning: 3,
  ready: 5,
  executing: 1,
  complete: null,
};

// =============================================================================
// Task Types
// =============================================================================

export type TaskType = 'feature' | 'bug' | 'refactor' | 'research' | 'spike';

export const TASK_TYPES: TaskType[] = [
  'feature',
  'bug',
  'refactor',
  'research',
  'spike',
];

export type Priority = 'critical' | 'high' | 'medium' | 'low';

export const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low'];

export type Complexity = 'low' | 'medium' | 'high';

export const COMPLEXITIES: Complexity[] = ['low', 'medium', 'high'];

// =============================================================================
// Task Frontmatter (YAML header in markdown files)
// =============================================================================

export interface TaskFrontmatter {
  // Identity
  id: string;
  title: string;

  // Status
  phase: Phase;
  type: TaskType;
  priority: Priority;

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
  estimatedEffort?: string; // e.g., "4h", "2d"
  complexity?: Complexity;

  // Execution
  branch?: string;
  commits: string[];
  prUrl?: string;

  // Quality gates
  qualityChecks: QualityChecks;

  // Plan (generated during planning phase)
  plan?: TaskPlan;

  // Blocker tracking
  blocked: BlockedState;
}

export interface QualityChecks {
  testsPass: boolean;
  lintPass: boolean;
  reviewDone: boolean;
}

// =============================================================================
// Task Plan (generated during planning phase)
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
  taskType: TaskType;
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
  acceptanceCriteria: string[];
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
}

export interface MoveTaskRequest {
  toPhase: Phase;
  reason?: string;
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
  | { type: 'task:plan_generated'; taskId: string; plan: TaskPlan };

export type AgentExecutionStatus = 'idle' | 'streaming' | 'tool_use' | 'thinking' | 'completed' | 'error';

export type ClientEvent =
  | { type: 'subscribe'; workspaceId: string }
  | { type: 'unsubscribe'; workspaceId: string }
  | { type: 'task:move'; taskId: string; toPhase: Phase }
  | { type: 'task:claim'; taskId: string; agentId: string }
  | { type: 'activity:send'; taskId: string; content: string; role: 'user' | 'agent' }
  | { type: 'agent:heartbeat'; agentId: string };

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
  type?: TaskType;
  priority?: Priority;
  assigned?: string;
  search?: string;
}

export interface SortOptions {
  field: 'created' | 'updated' | 'priority' | 'title';
  direction: 'asc' | 'desc';
}
