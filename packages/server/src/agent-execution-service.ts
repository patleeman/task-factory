// =============================================================================
// Agent Execution Service
// =============================================================================
// Integrates with Pi SDK to execute tasks with agent capabilities

import { join, dirname, basename } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  createAgentSession,
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
} from '@mariozechner/pi-coding-agent';
import {
  DEFAULT_PLANNING_GUARDRAILS,
  DEFAULT_PLANNING_PROMPT_TEMPLATE,
  DEFAULT_PLANNING_RESUME_PROMPT_TEMPLATE,
  DEFAULT_EXECUTION_PROMPT_TEMPLATE,
  DEFAULT_REWORK_PROMPT_TEMPLATE,
  resolveGlobalWorkflowSettings,
  resolveWorkspaceWorkflowSettings,
  type Task,
  type TaskPlan,
  type Attachment,
  type ModelConfig,
  type PlanningGuardrails,
  type WorkspaceConfig,
  type ContextUsageSnapshot,
} from '@task-factory/shared';
import { createTaskSeparator, createChatMessage, createSystemEvent } from './activity-service.js';
import {
  buildAgentContext,
  loadPiFactorySettings,
  loadWorkspaceSharedContext,
  WORKSPACE_SHARED_CONTEXT_REL_PATH,
  type PiSkill,
} from './pi-integration.js';
import {
  moveTaskToPhase,
  saveTaskFile,
  parseTaskFile,
  canMoveToPhase,
  discoverTasks,
} from './task-service.js';
import { persistTaskUsageFromAssistantMessage } from './task-usage-service.js';
import { runPrePlanningSkills, runPreExecutionSkills, runPostExecutionSkills } from './post-execution-skills.js';
import { withTimeout } from './with-timeout.js';
import { generateAndPersistSummary } from './summary-service.js';
import { attachTaskFileAndBroadcast, type AttachTaskFileRequest } from './task-attachment-service.js';
import { logTaskStateTransition } from './state-transition.js';
import {
  buildContractReference,
  buildStateBlock,
  prependStateToTurn,
  buildTaskStateSnapshot,
  isForbidden,
  stripStateContractEcho,
} from './state-contract.js';
import { requestQueueKick } from './queue-kick-coordinator.js';
import {
  DEFAULT_WORKSPACE_TASK_LOCATION,
  loadWorkspaceConfigFromDiskSync,
  resolveExistingTasksDirFromWorkspacePath,
} from './workspace-storage.js';
import {
  getTaskFactoryAuthPath,
  getTaskFactoryGlobalExtensionsDir,
  getWorkspaceTaskFactoryExtensionsDir,
} from './taskfactory-home.js';
import {
  clearExecutionLease,
  getExecutionLeaseHeartbeatIntervalMs,
  heartbeatExecutionLease,
  isExecutionLeaseTrackingEnabled,
} from './execution-lease-service.js';

// =============================================================================
// Repo-local Extension Discovery
// =============================================================================

/**
 * Discover extensions from the bundled task-factory `extensions/` directory.
 *
 * Supports:
 *   extensions/my-ext.ts          — single file
 *   extensions/my-ext/index.ts    — directory with index
 */
function discoverBundledRepoExtensions(): string[] {
  const __filename = fileURLToPath(import.meta.url);
  let dir = dirname(__filename);

  // Walk up from this file to find the repo root (where extensions/ lives)
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'extensions');
    if (existsSync(candidate)) {
      return discoverExtensionsInDir(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return [];
}

function discoverExtensionsInDir(extensionsDir: string): string[] {
  if (!existsSync(extensionsDir)) return [];

  const paths: string[] = [];
  const entries = readdirSync(extensionsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const fullPath = join(extensionsDir, entry.name);

    if (entry.isFile() && entry.name.endsWith('.ts')) {
      paths.push(fullPath);
    } else if (entry.isDirectory()) {
      const indexPath = join(fullPath, 'index.ts');
      if (existsSync(indexPath)) {
        paths.push(indexPath);
      }
    }
  }

  return paths;
}

function discoverAdditionalExtensionPaths(workspacePath?: string): string[] {
  const sources: string[] = [getTaskFactoryGlobalExtensionsDir()];

  if (workspacePath) {
    sources.push(getWorkspaceTaskFactoryExtensionsDir(workspacePath));
  }

  const paths: string[] = [];
  for (const source of sources) {
    paths.push(...discoverExtensionsInDir(source));
  }

  return paths;
}

function dedupePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

/**
 * Repo extensions can be scoped by audience so we can keep some tools
 * (for example, web research) available to Foreman only.
 */
export type RepoExtensionAudience = 'all' | 'foreman' | 'task';

const FOREMAN_ONLY_EXTENSION_IDS = new Set<string>(['web-tools', 'manage-tasks', 'message-agent']);

function getExtensionId(path: string): string {
  const fileName = basename(path);
  if (fileName === 'index.ts') {
    return basename(dirname(path));
  }
  return fileName.replace(/\.ts$/, '');
}

function isForemanOnlyExtension(path: string): boolean {
  return FOREMAN_ONLY_EXTENSION_IDS.has(getExtensionId(path));
}

function filterExtensionsForAudience(paths: string[], audience: RepoExtensionAudience): string[] {
  if (audience === 'task') {
    return paths.filter((path) => !isForemanOnlyExtension(path));
  }

  // 'all' and 'foreman' both include every repo extension.
  return [...paths];
}

/** Cached bundled extension paths (discovered once, reloaded on demand). */
let _bundledRepoExtensionPaths: string[] | null = null;

function getBundledRepoExtensionPaths(): string[] {
  if (_bundledRepoExtensionPaths === null) {
    _bundledRepoExtensionPaths = discoverBundledRepoExtensions();
    if (_bundledRepoExtensionPaths.length > 0) {
      console.log(
        `Discovered ${_bundledRepoExtensionPaths.length} bundled extension(s):`,
        _bundledRepoExtensionPaths.map((p) => p.split('/').slice(-2).join('/')),
      );
    }
  }

  return _bundledRepoExtensionPaths;
}

export function getRepoExtensionPaths(
  audience: RepoExtensionAudience = 'all',
  workspacePath?: string,
): string[] {
  const bundled = getBundledRepoExtensionPaths();
  const additional = discoverAdditionalExtensionPaths(workspacePath);
  const merged = dedupePaths([...bundled, ...additional]);

  return filterExtensionsForAudience(merged, audience);
}

/** Force re-discovery (e.g., after adding a new extension) */
export function reloadRepoExtensions(workspacePath?: string): string[] {
  _bundledRepoExtensionPaths = null;
  return getRepoExtensionPaths('all', workspacePath);
}

// =============================================================================
// Prompt Template Rendering
// =============================================================================

/**
 * Render a prompt template with variable substitution.
 * Variables use {{variableName}} syntax.
 */
function renderPromptTemplate(
  template: string,
  variables: Record<string, string | undefined>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(placeholder, value ?? '');
  }
  return result;
}

// =============================================================================
// Attachment Loading (images → ImageContent, others → file path references)
// =============================================================================

interface ImageContent {
  type: 'image';
  data: string;    // base64
  mimeType: string;
}

interface LoadedAttachments {
  images: ImageContent[];
  promptSection: string;  // markdown text to append to prompt
}

/**
 * Resolve the active workspace tasks directory.
 *
 * Reads workspace config from disk and falls back to legacy `.pi/tasks` when
 * only legacy metadata exists.
 */
function resolveWorkspaceTasksDir(workspacePath: string): string {
  const workspaceConfig = loadWorkspaceConfigFromDiskSync(workspacePath);
  return resolveExistingTasksDirFromWorkspacePath(workspacePath, workspaceConfig);
}

/**
 * Get the on-disk directory for a task's attachments.
 */
function getAttachmentsDir(workspacePath: string, taskId: string): string {
  return join(resolveWorkspaceTasksDir(workspacePath), taskId.toLowerCase(), 'attachments');
}

/**
 * Load task attachments from disk.
 * - Image files are base64-encoded into ImageContent for the LLM.
 * - Non-image files get a file-path reference so the agent can read them.
 * Returns both the ImageContent array and a markdown prompt section.
 */
function loadAttachments(
  attachments: Attachment[],
  workspacePath: string,
  taskId: string,
): LoadedAttachments {
  if (!attachments || attachments.length === 0) {
    return { images: [], promptSection: '' };
  }

  const dir = getAttachmentsDir(workspacePath, taskId);
  const images: ImageContent[] = [];
  const lines: string[] = ['## Attachments\n'];

  for (const att of attachments) {
    const filePath = join(dir, att.storedName);
    const isImage = att.mimeType.startsWith('image/');

    if (isImage) {
      if (existsSync(filePath)) {
        try {
          const data = readFileSync(filePath).toString('base64');
          images.push({ type: 'image', data, mimeType: att.mimeType });
          lines.push(`- **${att.filename}** (image, attached inline)`);
        } catch (err) {
          console.error(`Failed to read image attachment ${att.filename}:`, err);
          lines.push(`- **${att.filename}** (image, failed to load)`);
        }
      } else {
        lines.push(`- **${att.filename}** (image, file missing)`);
      }
    } else {
      // Non-image: give the agent the file path so it can read it
      lines.push(`- **${att.filename}**: \`${filePath}\``);
    }
  }

  lines.push('');
  return { images, promptSection: lines.join('\n') };
}

/**
 * Load specific attachments by ID from a task's attachment list.
 * Used when a chat message references particular attachment IDs.
 */
export function loadAttachmentsByIds(
  attachmentIds: string[],
  allAttachments: Attachment[],
  workspacePath: string,
  taskId: string,
): ImageContent[] {
  if (!attachmentIds || attachmentIds.length === 0) return [];

  const dir = getAttachmentsDir(workspacePath, taskId);
  const images: ImageContent[] = [];

  for (const id of attachmentIds) {
    const att = allAttachments.find(a => a.id === id);
    if (!att) continue;

    const isImage = att.mimeType.startsWith('image/');
    if (!isImage) continue;

    const filePath = join(dir, att.storedName);
    if (!existsSync(filePath)) continue;

    try {
      const data = readFileSync(filePath).toString('base64');
      images.push({ type: 'image', data, mimeType: att.mimeType });
    } catch (err) {
      console.error(`Failed to read attachment ${att.filename}:`, err);
    }
  }

  return images;
}

// =============================================================================
// Agent Session Management
// =============================================================================

export interface ExecutionCompletionDetails {
  errorMessage?: string;
}

interface TaskSession {
  id: string;
  taskId: string;
  workspaceId: string;
  workspacePath?: string;
  piSession: AgentSession | null;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  startTime: string;
  endTime?: string;
  output: string[];
  unsubscribe?: () => void;
  /** Callback to broadcast streaming events to workspace clients */
  broadcastToWorkspace?: (event: any) => void;
  /** Accumulated streaming text for current message */
  currentStreamText: string;
  /** Accumulated thinking text for current message */
  currentThinkingText: string;
  /** Track tool call args by toolCallId for persisting structured entries */
  toolCallArgs: Map<string, { toolName: string; args: Record<string, unknown> }>;
  /** Track latest streamed output per toolCallId so partial updates can be diffed */
  toolCallOutput: Map<string, string>;
  /** Last completed tool result text (used to dedupe assistant tool-echo messages) */
  lastToolResultText: string;
  /** Timestamp (ms) of the last completed tool result */
  lastToolResultAt: number;
  /** Whether the agent called task_complete during this session */
  agentSignaledComplete: boolean;
  /** Summary from task_complete call */
  completionSummary: string;
  /** Callback to invoke when the task should advance to complete */
  onComplete?: (success: boolean, details?: ExecutionCompletionDetails) => void;
  /** Reference to the task being executed */
  task?: Task;
  /** True when an executing turn has ended and the agent is waiting for user input */
  awaitingUserInput?: boolean;
  /** Enables full-turn watchdog behavior for execution turns */
  watchdogsEnabled?: boolean;
  /** Watchdog timer for post-tool stalls (tool ended but no follow-up) */
  postToolStallTimer?: ReturnType<typeof setTimeout>;
  /** Watchdog timer for prompts that never emit a first SDK event */
  noFirstEventTimer?: ReturnType<typeof setTimeout>;
  /** Watchdog timer for tool execution that starts but never ends */
  toolExecutionTimer?: ReturnType<typeof setTimeout>;
  /** Watchdog timer for silent assistant streaming/thinking gaps */
  streamSilenceTimer?: ReturnType<typeof setTimeout>;
  /** Watchdog timer enforcing max duration for a single turn */
  maxTurnDurationTimer?: ReturnType<typeof setTimeout>;
  /** Tracks whether the current turn has emitted at least one SDK event */
  sawTurnEvent?: boolean;
  /** Tracks in-flight tool call for tool-execution watchdog metadata */
  activeToolCallId?: string;
  activeToolName?: string;
  /** Prevent duplicate watchdog recovery terminal events */
  watchdogRecovered?: boolean;
  /** Monotonic execution turn counter for reliability telemetry */
  activeTurnNumber?: number;
  /** Stable identifier for the currently running execution turn */
  activeTurnId?: string;
  /** Turn start timestamp in ms since epoch */
  activeTurnStartedAtMs?: number;
  /** First assistant token timestamp in ms since epoch */
  activeTurnFirstTokenAtMs?: number;
  /** Prevent duplicate first-token telemetry per turn */
  activeTurnFirstTokenEmitted?: boolean;
  /** Prevent duplicate turn-end telemetry per turn */
  activeTurnTelemetryClosed?: boolean;
  /** Captures assistant stopReason=error for turn-end telemetry */
  activeTurnErrorMessage?: string;
  /** Interval that refreshes the persisted execution lease heartbeat. */
  leaseHeartbeatTimer?: ReturnType<typeof setInterval>;
}

const activeSessions = new Map<string, TaskSession>();

function shouldTrackExecutionLease(session: TaskSession): boolean {
  if (!isExecutionLeaseTrackingEnabled()) {
    return false;
  }

  return Boolean(
    session.workspacePath
    && session.task
    && session.task.frontmatter.phase === 'executing',
  );
}

function stopExecutionLeaseHeartbeat(session: TaskSession): void {
  if (session.leaseHeartbeatTimer) {
    clearInterval(session.leaseHeartbeatTimer);
    session.leaseHeartbeatTimer = undefined;
  }
}

function refreshExecutionLeaseHeartbeat(session: TaskSession): void {
  if (!shouldTrackExecutionLease(session)) {
    return;
  }

  const workspacePath = session.workspacePath!;
  const status = session.status;

  void heartbeatExecutionLease(workspacePath, session.taskId, status).catch((err) => {
    console.warn(`[AgentExecution] Failed to refresh execution lease heartbeat for ${session.taskId}:`, err);
  });
}

function startExecutionLeaseHeartbeat(session: TaskSession): void {
  if (!shouldTrackExecutionLease(session)) {
    return;
  }

  stopExecutionLeaseHeartbeat(session);
  refreshExecutionLeaseHeartbeat(session);

  const intervalMs = getExecutionLeaseHeartbeatIntervalMs();
  const timer = setInterval(() => {
    refreshExecutionLeaseHeartbeat(session);
  }, intervalMs);
  timer.unref?.();
  session.leaseHeartbeatTimer = timer;
}

function clearExecutionLeaseTracking(session: TaskSession): void {
  stopExecutionLeaseHeartbeat(session);

  if (!session.workspacePath || !isExecutionLeaseTrackingEnabled()) {
    return;
  }

  const workspacePath = session.workspacePath;
  void clearExecutionLease(workspacePath, session.taskId).catch((err) => {
    console.warn(`[AgentExecution] Failed to clear execution lease for ${session.taskId}:`, err);
  });
}

function registerActiveSession(session: TaskSession): void {
  const previous = activeSessions.get(session.taskId);
  if (previous && previous !== session) {
    clearExecutionLeaseTracking(previous);
  }

  activeSessions.set(session.taskId, session);
  startExecutionLeaseHeartbeat(session);
}

function clearActiveSessionIfOwned(taskId: string, session: TaskSession): boolean {
  const current = activeSessions.get(taskId);
  if (current !== session) {
    return false;
  }

  activeSessions.delete(taskId);
  clearExecutionLeaseTracking(session);
  return true;
}

export function getActiveSession(taskId: string): TaskSession | undefined {
  return activeSessions.get(taskId);
}

/** Returns true if the task has an active execution session (running or awaiting input). */
export function hasRunningSession(taskId: string): boolean {
  const session = activeSessions.get(taskId);
  if (!session) return false;
  return session.status === 'running' || session.status === 'idle';
}

/** Returns true when the task still has a live execution session. */
export function hasLiveExecutionSession(taskId: string): boolean {
  const session = activeSessions.get(taskId);
  if (!session) return false;

  // Idle sessions can still be live when the agent is awaiting user input.
  if (session.status === 'idle' && session.awaitingUserInput) {
    return true;
  }

  return session.status === 'running';
}

export function getAllActiveSessions(): TaskSession[] {
  return Array.from(activeSessions.values());
}

type TaskConversationPurpose = 'planning' | 'execution';

function getExecutionModelConfig(task: Task): ModelConfig | undefined {
  return task.frontmatter.executionModelConfig ?? task.frontmatter.modelConfig;
}

function getPlanningModelConfig(task: Task): ModelConfig | undefined {
  return task.frontmatter.planningModelConfig ?? getExecutionModelConfig(task);
}

function getModelConfigForPurpose(task: Task, purpose: TaskConversationPurpose): ModelConfig | undefined {
  return purpose === 'planning' ? getPlanningModelConfig(task) : getExecutionModelConfig(task);
}

interface TaskConversationSessionOptions {
  task: Task;
  workspacePath: string;
  settingsManager?: SettingsManager;
  requireExistingSession?: boolean;
  forceNewSession?: boolean;
  purpose?: TaskConversationPurpose;
  defaultThinkingLevel?: NonNullable<Parameters<typeof createAgentSession>[0]>['thinkingLevel'];
}

export interface TaskConversationSessionResult {
  session: AgentSession;
  resumed: boolean;
}

/**
 * Open (or create) the canonical per-task conversation session.
 * Persists sessionFile back to the task when a new session is created.
 */
export async function createTaskConversationSession(
  options: TaskConversationSessionOptions,
): Promise<TaskConversationSessionResult> {
  const {
    task,
    workspacePath,
    settingsManager,
    requireExistingSession = false,
    forceNewSession = false,
    purpose = 'execution',
    defaultThinkingLevel,
  } = options;

  const authStorage = AuthStorage.create(getTaskFactoryAuthPath());
  const modelRegistry = new ModelRegistry(authStorage);
  const loader = new DefaultResourceLoader({
    cwd: workspacePath,
    additionalExtensionPaths: getRepoExtensionPaths('task', workspacePath),
  });
  await loader.reload();

  const safePath = `--${workspacePath.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
  const sessionDir = join(homedir(), '.pi', 'agent', 'sessions', safePath);
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }

  const previousSessionFile = task.frontmatter.sessionFile;
  const hasExistingSession = !!(previousSessionFile && existsSync(previousSessionFile));

  if (requireExistingSession && !hasExistingSession) {
    throw new Error(`No existing conversation session for task ${task.id}`);
  }

  const shouldResume = !forceNewSession && hasExistingSession;
  const sessionManager = shouldResume && previousSessionFile
    ? SessionManager.open(previousSessionFile)
    : SessionManager.create(workspacePath);

  const sessionOpts: Parameters<typeof createAgentSession>[0] = {
    cwd: workspacePath,
    authStorage,
    modelRegistry,
    sessionManager,
    resourceLoader: loader,
  };

  if (settingsManager) {
    sessionOpts.settingsManager = settingsManager;
  }

  if (defaultThinkingLevel) {
    sessionOpts.thinkingLevel = defaultThinkingLevel;
  }

  const mc = getModelConfigForPurpose(task, purpose);
  if (mc) {
    const resolved = modelRegistry.find(mc.provider, mc.modelId);
    if (resolved) {
      sessionOpts.model = resolved;
    }
    if (mc.thinkingLevel) {
      sessionOpts.thinkingLevel = mc.thinkingLevel;
    }
  }

  const { session } = await createAgentSession(sessionOpts);

  const currentSessionFile = session.sessionFile;
  if (currentSessionFile && currentSessionFile !== task.frontmatter.sessionFile) {
    task.frontmatter.sessionFile = currentSessionFile;
    task.frontmatter.updated = new Date().toISOString();
    saveTaskFile(task);
  }

  return {
    session,
    resumed: shouldResume,
  };
}

function broadcastActivityEntry(
  broadcastToWorkspace: ((event: any) => void) | undefined,
  entryPromise: Promise<any>,
  context: string,
): void {
  if (!broadcastToWorkspace) return;

  void entryPromise
    .then((entry) => {
      broadcastToWorkspace({ type: 'activity:entry', entry });
    })
    .catch((err) => {
      console.error(`[AgentExecution] Failed to create activity entry (${context}):`, err);
    });
}

function getContextUsageSnapshot(session: TaskSession): ContextUsageSnapshot | null {
  try {
    const usage = session.piSession?.getContextUsage?.();
    if (!usage) return null;

    return {
      tokens: usage.tokens ?? null,
      contextWindow: usage.contextWindow,
      percent: usage.percent ?? null,
    };
  } catch (err) {
    console.warn(`[AgentExecution] Failed to read context usage for ${session.taskId}:`, err);
    return null;
  }
}

function broadcastTaskContextUsage(session: TaskSession, taskId: string): void {
  const usage = getContextUsageSnapshot(session);
  session.broadcastToWorkspace?.({
    type: 'agent:context_usage',
    taskId,
    usage,
  });
}

const POST_TOOL_STALL_TIMEOUT_MS = 2 * 60 * 1000;
const NO_FIRST_EVENT_TIMEOUT_MS = 20 * 1000;
const TOOL_EXECUTION_STALL_TIMEOUT_MS = 2 * 60 * 1000;
const STREAM_SILENCE_TIMEOUT_MS = 60 * 1000;
const MAX_TURN_DURATION_TIMEOUT_MS = 10 * 60 * 1000;

type ExecutionWatchdogPhase =
  | 'post-tool'
  | 'no-first-event'
  | 'tool-execution'
  | 'stream-silence'
  | 'max-turn-duration';

interface ExecutionWatchdogNotice {
  phase: ExecutionWatchdogPhase;
  timeoutMs: number;
  message: string;
  toolName?: string;
  toolCallId?: string;
}

type ExecutionReliabilitySignal =
  | 'turn_start'
  | 'first_token'
  | 'turn_end'
  | 'turn_stall_recovered'
  | 'provider_retry_start'
  | 'provider_retry_end'
  | 'compaction_end';

interface ExecutionReliabilityMetadata {
  [key: string]: unknown;
  kind: 'execution-reliability';
  signal: ExecutionReliabilitySignal;
  eventType: 'turn' | 'provider_retry' | 'compaction';
  sessionId: string;
  turnId?: string;
  turnNumber?: number;
  source?: string;
  outcome?: string;
  durationMs?: number;
  timeToFirstTokenMs?: number | null;
  stallPhase?: ExecutionWatchdogPhase;
  timeoutMs?: number;
  toolName?: string;
  toolCallId?: string;
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  aborted?: boolean;
  willRetry?: boolean;
  errorMessage?: string;
}

interface ExecutionTurnEndTelemetryOptions {
  outcome: 'success' | 'error' | 'watchdog_recovered';
  source: string;
  errorMessage?: string;
  stallPhase?: ExecutionWatchdogPhase;
  timeoutMs?: number;
  toolName?: string;
  toolCallId?: string;
}

function createExecutionReliabilityMetadata(
  session: TaskSession,
  signal: ExecutionReliabilitySignal,
  eventType: ExecutionReliabilityMetadata['eventType'],
  details: Partial<Omit<ExecutionReliabilityMetadata, 'kind' | 'signal' | 'eventType' | 'sessionId' | 'turnId' | 'turnNumber'>> = {},
): ExecutionReliabilityMetadata {
  return {
    kind: 'execution-reliability',
    signal,
    eventType,
    sessionId: session.id,
    turnId: session.activeTurnId,
    turnNumber: session.activeTurnNumber,
    ...details,
  };
}

function emitExecutionReliabilitySignal(
  session: TaskSession,
  workspaceId: string,
  taskId: string,
  signal: ExecutionReliabilitySignal,
  eventType: ExecutionReliabilityMetadata['eventType'],
  message: string,
  details: Partial<Omit<ExecutionReliabilityMetadata, 'kind' | 'signal' | 'eventType' | 'sessionId' | 'turnId' | 'turnNumber'>> = {},
): void {
  const metadata = createExecutionReliabilityMetadata(session, signal, eventType, details);

  broadcastActivityEntry(
    session.broadcastToWorkspace,
    createSystemEvent(workspaceId, taskId, 'phase-change', message, metadata),
    `execution reliability ${signal}`,
  );
}

function startExecutionTurnTelemetry(
  session: TaskSession,
  workspaceId: string,
  taskId: string,
): void {
  const turnNumber = (session.activeTurnNumber ?? 0) + 1;
  session.activeTurnNumber = turnNumber;
  session.activeTurnId = crypto.randomUUID();
  session.activeTurnStartedAtMs = Date.now();
  session.activeTurnFirstTokenAtMs = undefined;
  session.activeTurnFirstTokenEmitted = false;
  session.activeTurnTelemetryClosed = false;
  session.activeTurnErrorMessage = undefined;

  emitExecutionReliabilitySignal(
    session,
    workspaceId,
    taskId,
    'turn_start',
    'turn',
    `Execution reliability: turn ${turnNumber} started`,
    {
      source: 'watchdog:start',
      outcome: 'started',
    },
  );
}

function emitExecutionFirstTokenTelemetryIfNeeded(
  session: TaskSession,
  workspaceId: string,
  taskId: string,
  source: string,
): void {
  if (!session.activeTurnId || session.activeTurnFirstTokenEmitted) {
    return;
  }

  if (typeof session.activeTurnStartedAtMs !== 'number') {
    return;
  }

  const firstTokenAtMs = Date.now();
  const latencyMs = Math.max(0, firstTokenAtMs - session.activeTurnStartedAtMs);

  session.activeTurnFirstTokenAtMs = firstTokenAtMs;
  session.activeTurnFirstTokenEmitted = true;

  emitExecutionReliabilitySignal(
    session,
    workspaceId,
    taskId,
    'first_token',
    'turn',
    `Execution reliability: first token observed for turn ${session.activeTurnNumber ?? '?'} after ${latencyMs}ms`,
    {
      source,
      outcome: 'observed',
      timeToFirstTokenMs: latencyMs,
    },
  );
}

function closeExecutionTurnTelemetryIfNeeded(
  session: TaskSession,
  workspaceId: string,
  taskId: string,
  options: ExecutionTurnEndTelemetryOptions,
): void {
  if (!session.activeTurnId || session.activeTurnTelemetryClosed) {
    return;
  }

  if (typeof session.activeTurnStartedAtMs !== 'number') {
    return;
  }

  const endedAtMs = Date.now();
  const durationMs = Math.max(0, endedAtMs - session.activeTurnStartedAtMs);
  const firstTokenMs = typeof session.activeTurnFirstTokenAtMs === 'number'
    ? Math.max(0, session.activeTurnFirstTokenAtMs - session.activeTurnStartedAtMs)
    : null;

  emitExecutionReliabilitySignal(
    session,
    workspaceId,
    taskId,
    'turn_end',
    'turn',
    `Execution reliability: turn ${session.activeTurnNumber ?? '?'} ended (${options.outcome}) in ${durationMs}ms`,
    {
      source: options.source,
      outcome: options.outcome,
      durationMs,
      timeToFirstTokenMs: firstTokenMs,
      errorMessage: options.errorMessage,
      stallPhase: options.stallPhase,
      timeoutMs: options.timeoutMs,
      toolName: options.toolName,
      toolCallId: options.toolCallId,
    },
  );

  session.activeTurnTelemetryClosed = true;
}

function isExecutionWatchdogEnabled(session: TaskSession): boolean {
  return session.watchdogsEnabled === true;
}

function clearPostToolStallWatchdog(session: TaskSession): void {
  if (!session.postToolStallTimer) {
    return;
  }

  clearTimeout(session.postToolStallTimer);
  session.postToolStallTimer = undefined;
}

function clearNoFirstEventWatchdog(session: TaskSession): void {
  if (!session.noFirstEventTimer) {
    return;
  }

  clearTimeout(session.noFirstEventTimer);
  session.noFirstEventTimer = undefined;
}

function clearToolExecutionWatchdog(session: TaskSession): void {
  if (session.toolExecutionTimer) {
    clearTimeout(session.toolExecutionTimer);
    session.toolExecutionTimer = undefined;
  }

  session.activeToolCallId = undefined;
  session.activeToolName = undefined;
}

function clearStreamSilenceWatchdog(session: TaskSession): void {
  if (!session.streamSilenceTimer) {
    return;
  }

  clearTimeout(session.streamSilenceTimer);
  session.streamSilenceTimer = undefined;
}

function clearMaxTurnDurationWatchdog(session: TaskSession): void {
  if (!session.maxTurnDurationTimer) {
    return;
  }

  clearTimeout(session.maxTurnDurationTimer);
  session.maxTurnDurationTimer = undefined;
}

function clearExecutionTurnWatchdogs(session: TaskSession): void {
  clearPostToolStallWatchdog(session);
  clearNoFirstEventWatchdog(session);
  clearToolExecutionWatchdog(session);
  clearStreamSilenceWatchdog(session);
  clearMaxTurnDurationWatchdog(session);
}

function markExecutionTurnEventReceived(session: TaskSession): void {
  if (!isExecutionWatchdogEnabled(session) || session.sawTurnEvent) {
    return;
  }

  session.sawTurnEvent = true;
  clearNoFirstEventWatchdog(session);
}

function isAssistantMessageEvent(event: AgentSessionEvent): boolean {
  if (event.type !== 'message_start' && event.type !== 'message_update' && event.type !== 'message_end') {
    return false;
  }

  return (event.message as any)?.role === 'assistant';
}

async function recoverFromExecutionWatchdogTimeout(
  session: TaskSession,
  workspaceId: string,
  taskId: string,
  notice: ExecutionWatchdogNotice,
  context: string,
): Promise<void> {
  clearExecutionTurnWatchdogs(session);

  if (getActiveSession(taskId) !== session) {
    return;
  }

  if (session.watchdogRecovered) {
    return;
  }

  if (session.status !== 'running') {
    return;
  }

  session.watchdogRecovered = true;
  session.currentStreamText = '';
  session.currentThinkingText = '';
  session.toolCallArgs.clear();
  session.toolCallOutput.clear();

  emitExecutionReliabilitySignal(
    session,
    workspaceId,
    taskId,
    'turn_stall_recovered',
    'turn',
    `Execution reliability: watchdog recovered stalled turn ${session.activeTurnNumber ?? '?'} (${notice.phase})`,
    {
      source: `watchdog:${notice.phase}`,
      outcome: 'recovered',
      stallPhase: notice.phase,
      timeoutMs: notice.timeoutMs,
      toolName: notice.toolName,
      toolCallId: notice.toolCallId,
    },
  );

  closeExecutionTurnTelemetryIfNeeded(session, workspaceId, taskId, {
    outcome: 'watchdog_recovered',
    source: `watchdog:${notice.phase}`,
    stallPhase: notice.phase,
    timeoutMs: notice.timeoutMs,
    toolName: notice.toolName,
    toolCallId: notice.toolCallId,
  });

  broadcastActivityEntry(
    session.broadcastToWorkspace,
    createSystemEvent(
      workspaceId,
      taskId,
      'phase-change',
      notice.message,
      {
        kind: 'agent-turn-stall',
        phase: notice.phase,
        timeoutMs: notice.timeoutMs,
        toolName: notice.toolName,
        toolCallId: notice.toolCallId,
      },
    ),
    context,
  );

  session.status = 'idle';
  session.awaitingUserInput = false;
  session.endTime = new Date().toISOString();

  session.broadcastToWorkspace?.({
    type: 'agent:execution_status',
    taskId,
    status: 'idle',
  });
  session.broadcastToWorkspace?.({ type: 'agent:turn_end', taskId });

  broadcastTaskContextUsage(session, taskId);

  cleanupCompletionCallback(taskId);
  cleanupAttachFileCallback(taskId);
  session.onComplete = undefined;

  const unsubscribe = session.unsubscribe;
  session.unsubscribe = undefined;
  unsubscribe?.();

  const stalePiSession = session.piSession;
  session.piSession = null;

  clearActiveSessionIfOwned(taskId, session);

  try {
    await stalePiSession?.abort?.();
  } catch (err) {
    console.warn(`[AgentExecution] Failed to abort stalled session for ${taskId}:`, err);
  }
}

function armNoFirstEventWatchdog(
  session: TaskSession,
  workspaceId: string,
  taskId: string,
): void {
  clearNoFirstEventWatchdog(session);

  const timeout = setTimeout(() => {
    if (session.sawTurnEvent) {
      return;
    }

    const timeoutSeconds = Math.max(1, Math.round(NO_FIRST_EVENT_TIMEOUT_MS / 1000));
    void recoverFromExecutionWatchdogTimeout(
      session,
      workspaceId,
      taskId,
      {
        phase: 'no-first-event',
        timeoutMs: NO_FIRST_EVENT_TIMEOUT_MS,
        message: `Agent did not emit any turn events within ${timeoutSeconds}s. Marking session idle so you can continue.`,
      },
      'no-first-event watchdog timeout event',
    );
  }, NO_FIRST_EVENT_TIMEOUT_MS);

  (timeout as { unref?: () => void }).unref?.();
  session.noFirstEventTimer = timeout;
}

function armToolExecutionWatchdog(
  session: TaskSession,
  workspaceId: string,
  taskId: string,
  toolName: string,
  toolCallId: string,
): void {
  clearToolExecutionWatchdog(session);
  session.activeToolCallId = toolCallId;
  session.activeToolName = toolName;

  const timeout = setTimeout(() => {
    if (session.activeToolCallId !== toolCallId) {
      return;
    }

    const timeoutSeconds = Math.max(1, Math.round(TOOL_EXECUTION_STALL_TIMEOUT_MS / 1000));
    void recoverFromExecutionWatchdogTimeout(
      session,
      workspaceId,
      taskId,
      {
        phase: 'tool-execution',
        timeoutMs: TOOL_EXECUTION_STALL_TIMEOUT_MS,
        message: `Agent appears stuck while running tool "${toolName}" (${timeoutSeconds}s without completion). Marking session idle so you can continue.`,
        toolName,
        toolCallId,
      },
      'tool-execution watchdog timeout event',
    );
  }, TOOL_EXECUTION_STALL_TIMEOUT_MS);

  (timeout as { unref?: () => void }).unref?.();
  session.toolExecutionTimer = timeout;
}

function armStreamSilenceWatchdog(
  session: TaskSession,
  workspaceId: string,
  taskId: string,
): void {
  clearStreamSilenceWatchdog(session);

  const timeout = setTimeout(() => {
    const timeoutSeconds = Math.max(1, Math.round(STREAM_SILENCE_TIMEOUT_MS / 1000));
    void recoverFromExecutionWatchdogTimeout(
      session,
      workspaceId,
      taskId,
      {
        phase: 'stream-silence',
        timeoutMs: STREAM_SILENCE_TIMEOUT_MS,
        message: `Agent appears silent during response streaming (${timeoutSeconds}s without text or thinking updates). Marking session idle so you can continue.`,
      },
      'stream-silence watchdog timeout event',
    );
  }, STREAM_SILENCE_TIMEOUT_MS);

  (timeout as { unref?: () => void }).unref?.();
  session.streamSilenceTimer = timeout;
}

function armMaxTurnDurationWatchdog(
  session: TaskSession,
  workspaceId: string,
  taskId: string,
): void {
  clearMaxTurnDurationWatchdog(session);

  const timeout = setTimeout(() => {
    const timeoutSeconds = Math.max(1, Math.round(MAX_TURN_DURATION_TIMEOUT_MS / 1000));
    void recoverFromExecutionWatchdogTimeout(
      session,
      workspaceId,
      taskId,
      {
        phase: 'max-turn-duration',
        timeoutMs: MAX_TURN_DURATION_TIMEOUT_MS,
        message: `Agent exceeded max turn duration (${timeoutSeconds}s). Marking session idle so you can continue.`,
      },
      'max-turn watchdog timeout event',
    );
  }, MAX_TURN_DURATION_TIMEOUT_MS);

  (timeout as { unref?: () => void }).unref?.();
  session.maxTurnDurationTimer = timeout;
}

function armPostToolStallWatchdog(
  session: TaskSession,
  workspaceId: string,
  taskId: string,
  toolName: string,
  toolCallId: string,
): void {
  clearPostToolStallWatchdog(session);

  const timeout = setTimeout(() => {
    const timeoutSeconds = Math.max(1, Math.round(POST_TOOL_STALL_TIMEOUT_MS / 1000));
    void recoverFromExecutionWatchdogTimeout(
      session,
      workspaceId,
      taskId,
      {
        phase: 'post-tool',
        timeoutMs: POST_TOOL_STALL_TIMEOUT_MS,
        message: `Agent appears stuck after tool "${toolName}" (${timeoutSeconds}s without follow-up). Marking session idle so you can continue.`,
        toolName,
        toolCallId,
      },
      'post-tool stall timeout event',
    );
  }, POST_TOOL_STALL_TIMEOUT_MS);

  (timeout as { unref?: () => void }).unref?.();
  session.postToolStallTimer = timeout;
}

function startExecutionTurnWatchdogs(
  session: TaskSession,
  workspaceId: string,
  taskId: string,
): void {
  if (!isExecutionWatchdogEnabled(session)) {
    return;
  }

  clearExecutionTurnWatchdogs(session);
  session.watchdogRecovered = false;
  session.sawTurnEvent = false;
  startExecutionTurnTelemetry(session, workspaceId, taskId);
  armNoFirstEventWatchdog(session, workspaceId, taskId);
  armMaxTurnDurationWatchdog(session, workspaceId, taskId);
}

type AutoCompactionEndEvent = Extract<AgentSessionEvent, { type: 'auto_compaction_end' }>;
type AutoRetryStartEvent = Extract<AgentSessionEvent, { type: 'auto_retry_start' }>;
type AutoRetryEndEvent = Extract<AgentSessionEvent, { type: 'auto_retry_end' }>;

function buildCompactionStartNotice(reason: 'threshold' | 'overflow'): string {
  if (reason === 'overflow') {
    return 'Context window full — compacting conversation';
  }

  return 'Compacting conversation to reduce context usage';
}

function buildCompactionEndNotice(event: AutoCompactionEndEvent): {
  message: string;
  outcome: 'success' | 'aborted' | 'failed';
} {
  if (!event.aborted) {
    return { message: 'Conversation compacted successfully', outcome: 'success' };
  }

  const hasError = typeof event.errorMessage === 'string' && event.errorMessage.trim().length > 0;
  if (hasError) {
    const retrySuffix = event.willRetry ? ' Retrying automatically.' : '';
    return {
      message: `Compaction failed: ${event.errorMessage}${retrySuffix}`,
      outcome: 'failed',
    };
  }

  return {
    message: event.willRetry
      ? 'Compaction aborted. Retrying automatically.'
      : 'Compaction aborted.',
    outcome: 'aborted',
  };
}

function normalizeOptionalErrorMessage(errorMessage: unknown): string | null {
  if (typeof errorMessage === 'string') {
    const trimmed = errorMessage.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  if (errorMessage instanceof Error) {
    const trimmed = errorMessage.message?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  if (errorMessage == null) {
    return null;
  }

  try {
    const serialized = JSON.stringify(errorMessage);
    if (serialized && serialized !== '{}') {
      return serialized;
    }
  } catch {
    // Fall through to String fallback.
  }

  const fallback = String(errorMessage).trim();
  if (fallback.length > 0 && fallback !== '[object Object]') {
    return fallback;
  }

  return null;
}

function buildAutoRetryStartNotice(event: AutoRetryStartEvent): {
  message: string;
  errorMessage: string;
} {
  const normalizedError = normalizeOptionalErrorMessage(event.errorMessage) ?? 'Unknown provider error.';
  const delaySeconds = Math.max(1, Math.round(event.delayMs / 1000));

  return {
    message: `Retrying after provider error (attempt ${event.attempt}/${event.maxAttempts}) in ${delaySeconds}s: ${normalizedError}`,
    errorMessage: normalizedError,
  };
}

function buildAutoRetryEndNotice(event: AutoRetryEndEvent): {
  message: string;
  outcome: 'success' | 'failed';
  errorMessage?: string;
} {
  if (event.success) {
    return {
      message: `Retry succeeded on attempt ${event.attempt}.`,
      outcome: 'success',
    };
  }

  const normalizedError = normalizeOptionalErrorMessage(event.finalError) ?? 'Unknown provider error.';
  return {
    message: `Retry failed after ${event.attempt} attempt(s): ${normalizedError}`,
    outcome: 'failed',
    errorMessage: normalizedError,
  };
}

// =============================================================================
// Build Agent Prompt
// =============================================================================

function buildWorkspaceSharedContextSection(workspaceSharedContext: string | null): string {
  const normalized = workspaceSharedContext?.trim();
  if (!normalized) {
    return '';
  }

  let section = `## Workspace Shared Context\n`;
  section += `Shared file: \`${WORKSPACE_SHARED_CONTEXT_REL_PATH}\`\n`;
  section += `This file is collaboratively edited by the user and agent.\n\n`;
  section += `${normalized}\n\n`;

  return section;
}

function buildTaskPrompt(
  task: Task,
  skills: PiSkill[],
  attachmentSection: string,
  workspaceSharedContext: string | null,
  promptTemplate?: string,
): string {
  const { frontmatter, content } = task;
  const currentState = buildTaskStateSnapshot(frontmatter);

  // Build sections for template substitution
  const acceptanceCriteria = frontmatter.acceptanceCriteria.length > 0
    ? `## Acceptance Criteria\n${frontmatter.acceptanceCriteria.map((c, i) => `${i + 1}. [ ] ${c}`).join('\n')}\n`
    : '';

  const testingInstructions = frontmatter.testingInstructions.length > 0
    ? `## Testing Instructions\n${frontmatter.testingInstructions.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n`
    : '';

  const description = content ? `## Description\n${content}\n` : '';
  const sharedContext = buildWorkspaceSharedContextSection(workspaceSharedContext) ?? '';

  const skillsSection = skills.length > 0
    ? `## Available Skills\n${skills.map(s => `- **${s.name}**: ${s.description}${s.allowedTools.length > 0 ? `\n  - Tools: ${s.allowedTools.join(', ')}` : ''}`).join('\n')}\n`
    : '';

  const template = promptTemplate?.trim() || DEFAULT_EXECUTION_PROMPT_TEMPLATE;

  return renderPromptTemplate(template, {
    taskId: task.id,
    title: frontmatter.title,
    stateBlock: buildStateBlock(currentState),
    contractReference: buildContractReference(),
    acceptanceCriteria,
    testingInstructions,
    description,
    sharedContext,
    attachments: attachmentSection,
    skills: skillsSection,
  });
}

// =============================================================================
// Build Rework Prompt (for re-execution with existing conversation)
// =============================================================================

function buildReworkPrompt(
  task: Task,
  attachmentSection: string,
  workspaceSharedContext: string | null,
  promptTemplate?: string,
): string {
  const { frontmatter, content } = task;
  const currentState = buildTaskStateSnapshot(frontmatter);

  // Build sections for template substitution
  const acceptanceCriteria = frontmatter.acceptanceCriteria.length > 0
    ? `## Current Acceptance Criteria\n${frontmatter.acceptanceCriteria.map((c, i) => `${i + 1}. [ ] ${c}`).join('\n')}\n`
    : '';

  const description = content ? `## Description\n${content}\n` : '';
  const sharedContext = buildWorkspaceSharedContextSection(workspaceSharedContext) ?? '';

  const template = promptTemplate?.trim() || DEFAULT_REWORK_PROMPT_TEMPLATE;

  return renderPromptTemplate(template, {
    taskId: task.id,
    title: frontmatter.title,
    stateBlock: buildStateBlock(currentState),
    contractReference: buildContractReference(),
    acceptanceCriteria,
    description,
    sharedContext,
    attachments: attachmentSection,
  });
}

// =============================================================================
// Execute Task with Agent
// =============================================================================

export interface ExecuteTaskOptions {
  task: Task;
  workspaceId: string;
  workspacePath: string;
  onOutput?: (output: string) => void;
  onComplete?: (success: boolean, details?: ExecutionCompletionDetails) => void;
  broadcastToWorkspace?: (event: any) => void;
}

export async function executeTask(options: ExecuteTaskOptions): Promise<TaskSession> {
  const { task, workspaceId, workspacePath, onOutput, onComplete, broadcastToWorkspace } = options;

  // Get enabled skills for this workspace
  const agentContext = buildAgentContext(workspaceId, undefined, workspacePath);
  const skills = agentContext.availableSkills;
  const workspaceSharedContext = loadWorkspaceSharedContext(workspacePath);

  // Load task defaults for prompt templates
  const { loadTaskDefaultsForWorkspacePath } = await import('./task-defaults-service.js');
  const taskDefaults = loadTaskDefaultsForWorkspacePath(workspacePath);

  // Create session
  const session: TaskSession = {
    id: crypto.randomUUID(),
    taskId: task.id,
    workspaceId,
    workspacePath,
    piSession: null,
    status: 'running',
    startTime: new Date().toISOString(),
    output: [],
    broadcastToWorkspace,
    currentStreamText: '',
    currentThinkingText: '',
    toolCallArgs: new Map(),
    toolCallOutput: new Map(),
    lastToolResultText: '',
    lastToolResultAt: 0,
    agentSignaledComplete: false,
    completionSummary: '',
    onComplete,
    task,
    awaitingUserInput: false,
    watchdogsEnabled: true,
    sawTurnEvent: false,
    watchdogRecovered: false,
  };

  registerActiveSession(session);

  // Create task separator in activity log
  broadcastActivityEntry(
    broadcastToWorkspace,
    createTaskSeparator(
      workspaceId,
      task.id,
      task.frontmatter.title,
      'executing',
    ),
    'task separator',
  );

  const isRework = task.frontmatter.sessionFile && existsSync(task.frontmatter.sessionFile);
  broadcastActivityEntry(
    broadcastToWorkspace,
    createSystemEvent(
      workspaceId,
      task.id,
      'phase-change',
      isRework
        ? `Agent resuming execution (continuing previous conversation)`
        : `Agent started executing task`,
      { sessionId: session.id },
    ),
    'execution start event',
  );

  try {
    const { session: piSession, resumed: isResumingSession } = await createTaskConversationSession({
      task,
      workspacePath,
      purpose: 'execution',
    });

    if (isResumingSession && task.frontmatter.sessionFile) {
      console.log(`[ExecuteTask] Resuming previous session for task ${task.id}: ${task.frontmatter.sessionFile}`);
    }

    session.piSession = piSession;

    // Subscribe to Pi events
    session.unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
      handlePiEvent(event, session, workspaceId, task.id, onOutput);
    });
    broadcastTaskContextUsage(session, task.id);

    // Register completion callback so the task_complete extension tool
    // can signal that the agent is actually done (vs. asking a question).
    //
    // Race condition: the Pi SDK's prompt() can resolve before retries
    // finish. If the agent calls task_complete during a background retry,
    // prompt() has already returned and handleAgentTurnEnd already went
    // idle. In that case, we re-trigger the completion flow here.
    const completeRegistry = ensureCompleteCallbackRegistry();

    completeRegistry.set(task.id, (summary: string) => {
      if (getActiveSession(task.id) !== session) {
        console.warn(`[AgentExecution] Ignoring completion signal for stale session on task ${task.id}`);
        return;
      }

      session.agentSignaledComplete = true;
      session.completionSummary = summary;

      // If the session already went idle (prompt resolved early), kick off
      // the completion flow now that the agent has actually signaled done.
      if (session.status === 'idle') {
        console.log(`[AgentExecution] Late completion signal for ${task.id} — session was idle, triggering completion flow`);
        handleAgentTurnEnd(session, workspaceId, task).catch((err) => {
          console.error(`[AgentExecution] Late completion flow error for ${task.id}:`, err);
        });
      }
    });

    const attachFileRegistry = ensureAttachFileCallbackRegistry();
    attachFileRegistry.set(task.id, async (request: AttachTaskFileRequest) => {
      if (getActiveSession(task.id) !== session) {
        throw new Error(`Attach file callback is stale for task ${task.id}`);
      }

      const { attachment } = await attachTaskFileAndBroadcast(
        workspacePath,
        task.id,
        request,
        session.broadcastToWorkspace,
      );

      return {
        taskId: task.id,
        attachmentId: attachment.id,
        filename: attachment.filename,
        storedName: attachment.storedName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        createdAt: attachment.createdAt,
      };
    });

    // Load task attachments (images become ImageContent, others become file paths in prompt)
    const { images: taskImages, promptSection: attachmentSection } = loadAttachments(
      task.frontmatter.attachments,
      workspacePath,
      task.id,
    );

    // Build prompt — use a rework prompt if resuming, otherwise the full task prompt
    const prompt = isResumingSession
      ? buildReworkPrompt(task, attachmentSection, workspaceSharedContext, taskDefaults.executionPromptTemplate)
      : buildTaskPrompt(task, skills, attachmentSection, workspaceSharedContext, taskDefaults.executionPromptTemplate);
    runAgentExecution(session, prompt, workspaceId, task, taskImages);

  } catch (err) {
    console.error('Failed to create Pi agent session:', err);

    session.status = 'error';
    session.endTime = new Date().toISOString();

    createSystemEvent(
      workspaceId,
      task.id,
      'phase-change',
      `Pi SDK error, using simulation: ${err}`,
      { error: String(err) }
    );

    // Fall back to simulation
    simulateAgentExecution(session, task, workspaceId, onOutput, onComplete);
  }

  return session;
}

// =============================================================================
// Background Agent Execution
// =============================================================================
// Runs the agent prompt loop in the background. Does not block the caller.
// Calls onComplete when the agent finishes (success or failure).

async function runAgentExecution(
  session: TaskSession,
  prompt: string,
  workspaceId: string,
  task: Task,
  images?: ImageContent[],
): Promise<void> {
  try {
    // Run pre-execution skills before the main prompt
    const preSkillIds = task.frontmatter.preExecutionSkills;
    if (preSkillIds && preSkillIds.length > 0 && session.piSession) {
      session.awaitingUserInput = false;
      session.broadcastToWorkspace?.({
        type: 'agent:execution_status',
        taskId: task.id,
        status: 'pre-hooks',
      });

      broadcastActivityEntry(
        session.broadcastToWorkspace,
        createSystemEvent(
          workspaceId,
          task.id,
          'phase-change',
          `Running ${preSkillIds.length} pre-execution skill(s): ${preSkillIds.join(', ')}`,
          { skillIds: preSkillIds },
        ),
        'pre-execution start event',
      );

      try {
        await runPreExecutionSkills(session.piSession, preSkillIds, {
          taskId: task.id,
          workspaceId,
          broadcastToWorkspace: session.broadcastToWorkspace,
          skillConfigs: task.frontmatter.skillConfigs,
        });
      } catch (preErr) {
        console.error('Pre-execution skills failed:', preErr);
        broadcastActivityEntry(
          session.broadcastToWorkspace,
          createSystemEvent(
            workspaceId,
            task.id,
            'phase-change',
            `Pre-execution skills failed — skipping main execution and post-execution: ${preErr}`,
            { error: String(preErr) },
          ),
          'pre-execution error event',
        );

        // Pre-execution failure: skip main execution and post-execution
        handleAgentError(session, workspaceId, task, preErr);
        return;
      }

      // Broadcast that pre-execution is done, main execution starting
      session.awaitingUserInput = false;
      session.broadcastToWorkspace?.({
        type: 'agent:execution_status',
        taskId: task.id,
        status: 'streaming',
      });
    }

    const promptOpts = images && images.length > 0 ? { images } : undefined;
    startExecutionTurnWatchdogs(session, workspaceId, task.id);
    await session.piSession!.prompt(prompt, promptOpts);

    // prompt() resolved — check if the agent signaled completion.
    // Must await so post-execution skills actually run (and errors are caught).
    await handleAgentTurnEnd(session, workspaceId, task);
  } catch (err) {
    if (getActiveSession(task.id) !== session) {
      const staleErrorMessage = normalizeOptionalErrorMessage(err)?.toLowerCase() ?? '';
      if (!staleErrorMessage.includes('aborted')) {
        console.warn(`[AgentExecution] Ignoring execution error for stale session on task ${task.id}:`, err);
      }
      return;
    }

    console.error('Agent execution error:', err);
    handleAgentError(session, workspaceId, task, err);
  }
}

/**
 * Called after prompt() or followUp() resolves — decides whether to
 * advance the task or wait for user input.
 */
async function handleAgentTurnEnd(
  session: TaskSession,
  workspaceId: string,
  task: Task,
): Promise<void> {
  clearExecutionTurnWatchdogs(session);

  if (getActiveSession(task.id) !== session) {
    console.warn(`[AgentExecution] Ignoring turn-end for stale session on task ${task.id}`);
    return;
  }

  if (!session.agentSignaledComplete) {
    const latestTask = refreshSessionTaskSnapshot(session) ?? task;
    const isExecutingTask = latestTask.frontmatter.phase === 'executing';

    // Agent finished without calling task_complete. For executing tasks this
    // means we are waiting for user input; for non-executing chat turns we
    // preserve the existing idle behavior.
    console.log(
      `[AgentExecution] Agent finished without signaling completion for task ${task.id} — ${isExecutingTask ? 'awaiting user input' : 'idle chat turn'}`,
    );

    closeExecutionTurnTelemetryIfNeeded(session, workspaceId, task.id, {
      outcome: session.activeTurnErrorMessage ? 'error' : 'success',
      source: 'handleAgentTurnEnd:awaiting-input',
      errorMessage: session.activeTurnErrorMessage,
    });

    session.status = 'idle';
    session.awaitingUserInput = isExecutingTask;

    // Keep this as status-only (no timeline spam event).
    session.broadcastToWorkspace?.({
      type: 'agent:execution_status',
      taskId: task.id,
      status: isExecutingTask ? 'awaiting_input' : 'idle',
    });

    // Do NOT call onComplete — the task stays in executing, no auto-advance
    return;
  }

  // Agent explicitly signaled done — run post-execution skills then complete.
  session.awaitingUserInput = false;
  const summary = session.completionSummary;

  closeExecutionTurnTelemetryIfNeeded(session, workspaceId, task.id, {
    outcome: session.activeTurnErrorMessage ? 'error' : 'success',
    source: 'handleAgentTurnEnd:task-complete',
    errorMessage: session.activeTurnErrorMessage,
  });

  cleanupCompletionCallback(task.id);

  const postSkillIds = task.frontmatter.postExecutionSkills;
  if (postSkillIds && postSkillIds.length > 0 && session.piSession) {
    session.broadcastToWorkspace?.({
      type: 'agent:execution_status',
      taskId: task.id,
      status: 'post-hooks',
    });

    broadcastActivityEntry(
      session.broadcastToWorkspace,
      createSystemEvent(
        workspaceId,
        task.id,
        'phase-change',
        `Running ${postSkillIds.length} post-execution skill(s): ${postSkillIds.join(', ')}`,
        { skillIds: postSkillIds },
      ),
      'post-execution start event',
    );

    try {
      await runPostExecutionSkills(session.piSession, postSkillIds, {
        taskId: task.id,
        workspaceId,
        broadcastToWorkspace: session.broadcastToWorkspace,
        skillConfigs: task.frontmatter.skillConfigs,
      });
    } catch (hookErr) {
      console.error('Post-execution skills error:', hookErr);
      broadcastActivityEntry(
        session.broadcastToWorkspace,
        createSystemEvent(
          workspaceId,
          task.id,
          'phase-change',
          `Post-execution skills error: ${hookErr}`,
          { error: String(hookErr) },
        ),
        'post-execution error event',
      );
    }
  }

  // Generate post-execution summary — prompt the same agent session
  // so it can provide a real summary and validate criteria from context
  try {
    session.broadcastToWorkspace?.({
      type: 'agent:execution_status',
      taskId: task.id,
      status: 'post-hooks',
    });

    broadcastActivityEntry(
      session.broadcastToWorkspace,
      createSystemEvent(
        workspaceId,
        task.id,
        'phase-change',
        'Generating post-execution summary…',
      ),
      'post-summary start event',
    );

    const postSummary = await generateAndPersistSummary(task, session.piSession, summary);

    const passCount = postSummary.criteriaValidation.filter(c => c.status === 'pass').length;
    const totalCount = postSummary.criteriaValidation.length;
    broadcastActivityEntry(
      session.broadcastToWorkspace,
      createSystemEvent(
        workspaceId,
        task.id,
        'phase-change',
        `Post-execution summary generated (${postSummary.fileDiffs.length} files changed, ${passCount}/${totalCount} criteria passing)`,
      ),
      'post-summary completion event',
    );
  } catch (summaryErr) {
    console.error('Failed to generate post-execution summary:', summaryErr);
  }

  if (session.status !== 'error') {
    session.status = 'completed';
  }

  session.endTime = new Date().toISOString();

  broadcastActivityEntry(
    session.broadcastToWorkspace,
    createSystemEvent(
      workspaceId,
      task.id,
      'phase-change',
      `Agent execution completed${summary ? ': ' + summary : ''}`,
      { sessionId: session.id },
    ),
    'execution completion event',
  );

  session.broadcastToWorkspace?.({
    type: 'agent:execution_status',
    taskId: task.id,
    status: 'completed',
  });

  const wasSuccess = session.status === 'completed';

  cleanupAttachFileCallback(task.id);

  // Clean up: unsubscribe from events and remove from active sessions
  // so future chat messages can trigger resumeChat() instead of
  // falling through all branches in the activity handler.
  session.unsubscribe?.();
  clearActiveSessionIfOwned(task.id, session);

  session.onComplete?.(
    wasSuccess,
    wasSuccess ? undefined : { errorMessage: session.activeTurnErrorMessage },
  );
}

/**
 * Handle agent execution errors (from prompt() or followUp()).
 */
function handleAgentError(
  session: TaskSession,
  workspaceId: string,
  task: Task,
  err: unknown,
): void {
  clearExecutionTurnWatchdogs(session);

  if (getActiveSession(task.id) !== session) {
    console.warn(`[AgentExecution] Ignoring error for stale session on task ${task.id}:`, err);
    return;
  }

  const normalizedError = normalizeOptionalErrorMessage(err) ?? String(err);
  session.activeTurnErrorMessage = normalizedError;

  closeExecutionTurnTelemetryIfNeeded(session, workspaceId, task.id, {
    outcome: 'error',
    source: 'handleAgentError',
    errorMessage: normalizedError,
  });

  cleanupCompletionCallback(task.id);
  cleanupAttachFileCallback(task.id);
  session.awaitingUserInput = false;
  session.status = 'error';
  session.endTime = new Date().toISOString();

  broadcastActivityEntry(
    session.broadcastToWorkspace,
    createSystemEvent(
      workspaceId,
      task.id,
      'phase-change',
      `Agent execution error: ${err}`,
      { sessionId: session.id },
    ),
    'execution error event',
  );

  session.broadcastToWorkspace?.({
    type: 'agent:execution_status',
    taskId: task.id,
    status: 'error',
  });

  // Clean up: unsubscribe and remove from active sessions so future
  // chat messages can trigger resumeChat() instead of being silently dropped.
  session.unsubscribe?.();
  clearActiveSessionIfOwned(task.id, session);

  session.onComplete?.(false, { errorMessage: normalizedError });
}

/** Remove the completion callback for a task (cleanup). */
function cleanupCompletionCallback(taskId: string): void {
  globalThis.__piFactoryCompleteCallbacks?.delete(taskId);
}

/** Remove the attach-file callback for a task (cleanup). */
function cleanupAttachFileCallback(taskId: string): void {
  globalThis.__piFactoryAttachFileCallbacks?.delete(taskId);
}

function extractTextFromContentBlocks(content: any): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
    .map((c: any) => c.text)
    .join('');
}

function extractToolResultText(result: any): string {
  if (!result) return '';
  if (typeof result === 'string') return result;

  // Standard AgentToolResult shape: { content: [{ type: 'text', text }], details }
  if (Array.isArray(result.content)) {
    return extractTextFromContentBlocks(result.content);
  }

  // Backward-compat fallback
  if (Array.isArray((result as any).partialResult?.content)) {
    return extractTextFromContentBlocks((result as any).partialResult.content);
  }

  return '';
}

function normalizeAssistantErrorMessage(errorMessage: unknown): string {
  return normalizeOptionalErrorMessage(errorMessage)
    ?? 'Provider returned stopReason=error without an error message.';
}

function getAssistantTurnErrorMessage(message: any): string | null {
  if (!message || message.role !== 'assistant') {
    return null;
  }

  if (message.stopReason !== 'error') {
    return null;
  }

  return normalizeAssistantErrorMessage(message.errorMessage);
}

function shouldSkipToolEchoMessage(session: TaskSession, content: string): boolean {
  if (!content) return false;
  if (!session.lastToolResultText) return false;

  const ageMs = Date.now() - session.lastToolResultAt;
  if (ageMs > 2500) return false;

  return content.trim() === session.lastToolResultText.trim();
}

function persistUsageFromAssistantMessage(session: TaskSession, taskId: string, message: unknown): void {
  if (!session.task) {
    return;
  }

  try {
    const updatedTask = persistTaskUsageFromAssistantMessage(session.task, message);
    if (!updatedTask) {
      return;
    }

    session.task = updatedTask;

    session.broadcastToWorkspace?.({
      type: 'task:updated',
      task: updatedTask,
      changes: { frontmatter: updatedTask.frontmatter },
    });
  } catch (err) {
    console.error(`[AgentExecution] Failed to persist usage metrics for ${taskId}:`, err);
  }
}

function handlePiEvent(
  event: AgentSessionEvent,
  session: TaskSession,
  workspaceId: string,
  taskId: string,
  onOutput?: (output: string) => void
): void {
  if (getActiveSession(taskId) !== session) {
    return;
  }

  const broadcast = session.broadcastToWorkspace;

  if (isExecutionWatchdogEnabled(session)) {
    if (session.watchdogRecovered) {
      return;
    }

    markExecutionTurnEventReceived(session);

    if (event.type !== 'tool_execution_end') {
      clearPostToolStallWatchdog(session);
    }

    if (isAssistantMessageEvent(event)) {
      emitExecutionFirstTokenTelemetryIfNeeded(session, workspaceId, taskId, `event:${event.type}`);
    }
  }

  switch (event.type) {
    case 'agent_start': {
      session.currentStreamText = '';
      session.currentThinkingText = '';
      session.awaitingUserInput = false;
      broadcast?.({
        type: 'agent:execution_status',
        taskId,
        status: 'streaming',
      });
      broadcastTaskContextUsage(session, taskId);
      break;
    }

    case 'agent_end': {
      // Don't broadcast 'completed' here — agent_end fires when prompt() or
      // followUp() finishes, but there may still be post-execution skills to
      // run. The runAgentExecution function handles the final 'completed'
      // broadcast after all work (including post-execution skills) is done.
      break;
    }

    case 'message_start': {
      // Ignore non-assistant messages (user/tool/custom). We only stream
      // assistant output to the task chat UI.
      if ((event.message as any)?.role !== 'assistant') {
        break;
      }

      if (isExecutionWatchdogEnabled(session)) {
        armStreamSilenceWatchdog(session, workspaceId, taskId);
      }

      session.currentStreamText = '';
      session.currentThinkingText = '';
      broadcast?.({ type: 'agent:streaming_start', taskId });
      break;
    }

    case 'message_update': {
      // Defensive guard: assistantMessageEvent should only appear for assistant
      // messages, but skip if we ever get a non-assistant event.
      if ((event.message as any)?.role !== 'assistant') {
        break;
      }

      const sub = event.assistantMessageEvent;
      if (sub.type === 'text_delta') {
        const delta = sub.delta;
        if (delta) {
          if (isExecutionWatchdogEnabled(session)) {
            armStreamSilenceWatchdog(session, workspaceId, taskId);
          }

          session.currentStreamText += delta;
          session.output.push(delta);
          onOutput?.(delta);
          broadcast?.({ type: 'agent:streaming_text', taskId, delta });
        }
      } else if (sub.type === 'thinking_delta') {
        const delta = (sub as any).delta;
        if (delta) {
          if (isExecutionWatchdogEnabled(session)) {
            armStreamSilenceWatchdog(session, workspaceId, taskId);
          }

          session.currentThinkingText += delta;
          broadcast?.({ type: 'agent:thinking_delta', taskId, delta });
        }
      }
      break;
    }

    case 'message_end': {
      // Only persist assistant message output. If we process user message_end
      // here, the user's own text gets echoed back as an "agent" message.
      const message = event.message as any;
      if (message?.role !== 'assistant') {
        break;
      }

      if (isExecutionWatchdogEnabled(session)) {
        clearStreamSilenceWatchdog(session);
      }

      persistUsageFromAssistantMessage(session, taskId, message);

      // Flush streaming text as a final message in the activity log
      let content = '';

      if (Array.isArray(message.content)) {
        content = message.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n');
      } else if (typeof message.content === 'string') {
        content = message.content;
      }

      const sanitizedContent = stripStateContractEcho(content);
      const finalStreamText = stripStateContractEcho(sanitizedContent || session.currentStreamText);

      if (sanitizedContent && !shouldSkipToolEchoMessage(session, sanitizedContent)) {
        broadcastActivityEntry(
          broadcast,
          createChatMessage(workspaceId, taskId, 'agent', sanitizedContent),
          'assistant message',
        );
      }

      const assistantTurnError = getAssistantTurnErrorMessage(message);
      if (assistantTurnError) {
        session.activeTurnErrorMessage = assistantTurnError;

        broadcastActivityEntry(
          broadcast,
          createSystemEvent(
            workspaceId,
            taskId,
            'phase-change',
            `Agent turn failed: ${assistantTurnError}`,
            {
              kind: 'agent-turn-error',
              stopReason: message.stopReason,
              errorMessage: assistantTurnError,
            },
          ),
          'assistant turn error event',
        );
      }

      broadcast?.({
        type: 'agent:streaming_end',
        taskId,
        fullText: finalStreamText,
      });

      if (session.currentThinkingText) {
        broadcast?.({ type: 'agent:thinking_end', taskId });
      }

      session.currentStreamText = '';
      session.currentThinkingText = '';
      broadcastTaskContextUsage(session, taskId);
      break;
    }

    case 'tool_execution_start': {
      if (isExecutionWatchdogEnabled(session)) {
        clearStreamSilenceWatchdog(session);
        armToolExecutionWatchdog(session, workspaceId, taskId, event.toolName, event.toolCallId);
      }

      // Capture tool args for later storage
      session.toolCallArgs.set(event.toolCallId, {
        toolName: event.toolName,
        args: (event as any).args || {},
      });
      session.toolCallOutput.set(event.toolCallId, '');
      session.awaitingUserInput = false;
      broadcast?.({
        type: 'agent:execution_status',
        taskId,
        status: 'tool_use',
      });
      broadcastTaskContextUsage(session, taskId);
      broadcast?.({
        type: 'agent:tool_start',
        taskId,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        input: (event as any).args || {},
      } as any);
      break;
    }

    case 'tool_execution_update': {
      const toolCallId = (event as any).toolCallId || '';

      if (isExecutionWatchdogEnabled(session) && toolCallId && session.activeToolCallId === toolCallId && session.activeToolName) {
        armToolExecutionWatchdog(session, workspaceId, taskId, session.activeToolName, toolCallId);
      }

      const partialResult = (event as any).partialResult;

      // Newer SDKs emit structured partialResult; older paths may emit data.
      const partialText = extractToolResultText(partialResult) || (event as any).data || '';
      if (!partialText) {
        break;
      }

      const previous = session.toolCallOutput.get(toolCallId) || '';
      const delta = partialText.startsWith(previous)
        ? partialText.slice(previous.length)
        : partialText;

      session.toolCallOutput.set(toolCallId, partialText);

      if (delta) {
        broadcast?.({
          type: 'agent:tool_update',
          taskId,
          toolCallId,
          delta,
        });
      }
      break;
    }

    case 'tool_execution_end': {
      if (isExecutionWatchdogEnabled(session)) {
        clearToolExecutionWatchdog(session);
      }

      // Get the stored args for this tool call
      const toolInfo = session.toolCallArgs.get(event.toolCallId);
      const streamedText = session.toolCallOutput.get(event.toolCallId) || '';
      const finalResultText = extractToolResultText((event as any).result) || streamedText;

      // Store as structured activity entry with tool metadata
      broadcastActivityEntry(
        broadcast,
        createChatMessage(workspaceId, taskId, 'agent', finalResultText, undefined, {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          args: toolInfo?.args || {},
          isError: event.isError,
        }),
        'tool result message',
      );

      broadcast?.({
        type: 'agent:tool_end',
        taskId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
        result: finalResultText,
      });
      session.awaitingUserInput = false;
      broadcast?.({
        type: 'agent:execution_status',
        taskId,
        status: 'streaming',
      });
      broadcastTaskContextUsage(session, taskId);

      session.lastToolResultText = finalResultText;
      session.lastToolResultAt = Date.now();
      session.toolCallArgs.delete(event.toolCallId);
      session.toolCallOutput.delete(event.toolCallId);

      if (isExecutionWatchdogEnabled(session)) {
        armPostToolStallWatchdog(session, workspaceId, taskId, event.toolName, event.toolCallId);
      }
      break;
    }

    case 'turn_end' as any: {
      broadcast?.({ type: 'agent:turn_end', taskId });
      broadcastTaskContextUsage(session, taskId);
      break;
    }

    case 'auto_compaction_start': {
      broadcastActivityEntry(
        broadcast,
        createSystemEvent(
          workspaceId,
          taskId,
          'phase-change',
          buildCompactionStartNotice(event.reason),
          { kind: 'compaction', phase: 'start', reason: event.reason },
        ),
        'auto compaction start event',
      );
      broadcastTaskContextUsage(session, taskId);
      break;
    }

    case 'auto_compaction_end': {
      const notice = buildCompactionEndNotice(event);
      emitExecutionReliabilitySignal(
        session,
        workspaceId,
        taskId,
        'compaction_end',
        'compaction',
        `Execution reliability: compaction ${notice.outcome}`,
        {
          source: 'event:auto_compaction_end',
          outcome: notice.outcome,
          aborted: event.aborted,
          willRetry: event.willRetry,
          errorMessage: typeof event.errorMessage === 'string' ? event.errorMessage : undefined,
        },
      );

      broadcastActivityEntry(
        broadcast,
        createSystemEvent(
          workspaceId,
          taskId,
          'phase-change',
          notice.message,
          {
            kind: 'compaction',
            phase: 'end',
            outcome: notice.outcome,
            aborted: event.aborted,
            willRetry: event.willRetry,
            errorMessage: event.errorMessage,
          },
        ),
        'auto compaction end event',
      );
      broadcastTaskContextUsage(session, taskId);
      break;
    }

    case 'auto_retry_start': {
      const notice = buildAutoRetryStartNotice(event);
      emitExecutionReliabilitySignal(
        session,
        workspaceId,
        taskId,
        'provider_retry_start',
        'provider_retry',
        `Execution reliability: provider retry attempt ${event.attempt}/${event.maxAttempts} started`,
        {
          source: 'event:auto_retry_start',
          outcome: 'started',
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          errorMessage: notice.errorMessage,
        },
      );

      broadcastActivityEntry(
        broadcast,
        createSystemEvent(
          workspaceId,
          taskId,
          'phase-change',
          notice.message,
          {
            kind: 'auto-retry',
            phase: 'start',
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            delayMs: event.delayMs,
            errorMessage: notice.errorMessage,
          },
        ),
        'auto retry start event',
      );
      broadcastTaskContextUsage(session, taskId);
      break;
    }

    case 'auto_retry_end': {
      const notice = buildAutoRetryEndNotice(event);
      emitExecutionReliabilitySignal(
        session,
        workspaceId,
        taskId,
        'provider_retry_end',
        'provider_retry',
        `Execution reliability: provider retry attempt ${event.attempt} ${notice.outcome}`,
        {
          source: 'event:auto_retry_end',
          outcome: notice.outcome,
          attempt: event.attempt,
          errorMessage: notice.errorMessage,
        },
      );

      broadcastActivityEntry(
        broadcast,
        createSystemEvent(
          workspaceId,
          taskId,
          'phase-change',
          notice.message,
          {
            kind: 'auto-retry',
            phase: 'end',
            outcome: notice.outcome,
            success: event.success,
            attempt: event.attempt,
            finalError: notice.errorMessage,
          },
        ),
        'auto retry end event',
      );
      broadcastTaskContextUsage(session, taskId);
      break;
    }
  }
}

// =============================================================================
// Steer / Follow-up
// =============================================================================

function refreshSessionTaskSnapshot(session: TaskSession): Task | undefined {
  if (!session.task?.filePath) {
    return session.task;
  }

  if (!existsSync(session.task.filePath)) {
    return session.task;
  }

  try {
    const latestTask = parseTaskFile(session.task.filePath);
    session.task = latestTask;
    return latestTask;
  } catch (err) {
    console.warn(
      `[AgentExecution] Failed to refresh task snapshot for ${session.taskId}; using in-memory snapshot:`,
      err,
    );
    return session.task;
  }
}

function prependTaskTurnState(task: Task, content: string): string {
  return prependStateToTurn(content, buildTaskStateSnapshot(task.frontmatter));
}

export async function steerTask(taskId: string, content: string, images?: ImageContent[]): Promise<boolean> {
  const session = activeSessions.get(taskId);
  if (!session?.piSession) return false;

  try {
    const latestTask = refreshSessionTaskSnapshot(session);
    const turnContent = latestTask ? prependTaskTurnState(latestTask, content) : content;
    await session.piSession.steer(turnContent, images && images.length > 0 ? images : undefined);
    return true;
  } catch (err) {
    console.error('Failed to steer task:', err);
    return false;
  }
}

export async function followUpTask(taskId: string, content: string, images?: ImageContent[]): Promise<boolean> {
  const session = activeSessions.get(taskId);
  if (!session?.piSession) return false;

  try {
    const hasImages = !!(images && images.length > 0);
    const latestTask = refreshSessionTaskSnapshot(session);
    const turnContent = latestTask ? prependTaskTurnState(latestTask, content) : content;

    // If the agent is currently streaming, queue as follow-up and return.
    // Do NOT run handleAgentTurnEnd here — followUp() only queues the message.
    if (session.piSession.isStreaming) {
      await session.piSession.followUp(turnContent, hasImages ? images : undefined);
      return true;
    }

    // Agent is idle: start a new turn with prompt().
    session.status = 'running';
    session.awaitingUserInput = false;
    session.broadcastToWorkspace?.({
      type: 'agent:execution_status',
      taskId,
      status: 'streaming',
    });

    // Reset completion flags for this new turn.
    session.agentSignaledComplete = false;
    session.completionSummary = '';

    const savePlanCallbackCleanup =
      session.task && !isForbidden(buildTaskStateSnapshot(session.task.frontmatter).mode, 'save_plan')
        ? registerSavePlanCallbackForChatTurn(
          session.task,
          session.workspaceId,
          session.workspacePath,
          session.broadcastToWorkspace,
        )
        : undefined;

    try {
      startExecutionTurnWatchdogs(session, session.workspaceId, taskId);
      await session.piSession.prompt(turnContent, hasImages ? { images: images! } : undefined);
    } finally {
      savePlanCallbackCleanup?.();
    }

    // Turn resolved — check completion signal (same logic as initial prompt).
    if (session.task) {
      await handleAgentTurnEnd(session, session.workspaceId, session.task);
    } else {
      session.status = 'idle';
      session.awaitingUserInput = false;
      session.broadcastToWorkspace?.({
        type: 'agent:execution_status',
        taskId,
        status: 'idle',
      });
    }

    return true;
  } catch (err) {
    console.error('Failed to follow-up task:', err);
    if (session.task) {
      handleAgentError(session, session.workspaceId, session.task, err);
    }
    return false;
  }
}

// =============================================================================
// Resume Chat (for tasks with no active session but a previous conversation)
// =============================================================================
// Creates a lightweight session from the task's sessionFile and sends a
// follow-up. Used when chatting on completed/ready/backlog tasks.

export async function resumeChat(
  task: Task,
  workspaceId: string,
  workspacePath: string,
  content: string,
  broadcastToWorkspace?: (event: any) => void,
  images?: ImageContent[],
): Promise<boolean> {
  const sessionFile = task.frontmatter.sessionFile;
  if (!sessionFile || !existsSync(sessionFile)) {
    console.log(`[resumeChat] No session file for task ${task.id} — cannot resume`);
    return false;
  }

  // Create a TaskSession to track this conversation
  const session: TaskSession = {
    id: crypto.randomUUID(),
    taskId: task.id,
    workspaceId,
    workspacePath,
    piSession: null,
    status: 'running',
    startTime: new Date().toISOString(),
    output: [],
    broadcastToWorkspace,
    currentStreamText: '',
    currentThinkingText: '',
    toolCallArgs: new Map(),
    toolCallOutput: new Map(),
    lastToolResultText: '',
    lastToolResultAt: 0,
    agentSignaledComplete: false,
    completionSummary: '',
    task,
    awaitingUserInput: false,
  };

  registerActiveSession(session);

  session.awaitingUserInput = false;
  broadcastToWorkspace?.({
    type: 'agent:execution_status',
    taskId: task.id,
    status: 'streaming',
  });

  try {
    const { session: piSession } = await createTaskConversationSession({
      task,
      workspacePath,
      requireExistingSession: true,
      purpose: 'execution',
    });

    session.piSession = piSession;

    session.unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
      handlePiEvent(event, session, workspaceId, task.id);
    });
    broadcastTaskContextUsage(session, task.id);

    // Send the user's message as a new prompt (not followUp — there's no
    // active agent turn to follow up on since we just reopened the session).
    const workspaceSharedContext = loadWorkspaceSharedContext(workspacePath);
    const sharedContextSection = buildWorkspaceSharedContextSection(workspaceSharedContext);
    const promptContent = sharedContextSection
      ? `${sharedContextSection}## User Message\n${content}`
      : content;
    const promptWithState = `${buildContractReference()}\n\n${prependStateToTurn(
      promptContent,
      buildTaskStateSnapshot(task.frontmatter),
    )}`;

    const savePlanCallbackCleanup =
      !isForbidden(buildTaskStateSnapshot(task.frontmatter).mode, 'save_plan')
        ? registerSavePlanCallbackForChatTurn(task, workspaceId, workspacePath, broadcastToWorkspace)
        : undefined;

    try {
      await piSession.prompt(promptWithState, images && images.length > 0 ? { images } : undefined);
    } finally {
      savePlanCallbackCleanup?.();
    }

    // Prompt resolved — go idle (no auto-advance for non-executing tasks)
    session.status = 'idle';
    session.awaitingUserInput = false;

    broadcastToWorkspace?.({
      type: 'agent:execution_status',
      taskId: task.id,
      status: 'idle',
    });

    return true;
  } catch (err) {
    console.error(`[resumeChat] Failed to resume chat for task ${task.id}:`, err);
    session.status = 'error';
    clearActiveSessionIfOwned(task.id, session);

    broadcastToWorkspace?.({
      type: 'agent:execution_status',
      taskId: task.id,
      status: 'error',
    });

    return false;
  }
}

// =============================================================================
// Start Chat (for tasks with no active session and no previous conversation)
// =============================================================================
// Creates a fresh agent session and sends the user's message as the initial
// prompt. Used when chatting on tasks that have never had an agent session.

export async function startChat(
  task: Task,
  workspaceId: string,
  workspacePath: string,
  content: string,
  broadcastToWorkspace?: (event: any) => void,
  images?: ImageContent[],
): Promise<boolean> {
  const session: TaskSession = {
    id: crypto.randomUUID(),
    taskId: task.id,
    workspaceId,
    workspacePath,
    piSession: null,
    status: 'running',
    startTime: new Date().toISOString(),
    output: [],
    broadcastToWorkspace,
    currentStreamText: '',
    currentThinkingText: '',
    toolCallArgs: new Map(),
    toolCallOutput: new Map(),
    lastToolResultText: '',
    lastToolResultAt: 0,
    agentSignaledComplete: false,
    completionSummary: '',
    task,
    awaitingUserInput: false,
  };

  registerActiveSession(session);

  session.awaitingUserInput = false;
  broadcastToWorkspace?.({
    type: 'agent:execution_status',
    taskId: task.id,
    status: 'streaming',
  });

  try {
    const { session: piSession } = await createTaskConversationSession({
      task,
      workspacePath,
      forceNewSession: true,
      purpose: 'execution',
    });

    session.piSession = piSession;

    session.unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
      handlePiEvent(event, session, workspaceId, task.id);
    });
    broadcastTaskContextUsage(session, task.id);

    // Build context about the task for the initial prompt
    const workspaceSharedContext = loadWorkspaceSharedContext(workspacePath);
    const sharedContextSection = buildWorkspaceSharedContextSection(workspaceSharedContext);

    const taskContext =
      (sharedContextSection || '') +
      `You are chatting about task ${task.id}: "${task.frontmatter.title}"\n` +
      (task.content ? `Task description: ${task.content}\n` : '') +
      (task.frontmatter.plan ? `This task has a plan with goal: ${task.frontmatter.plan.goal}\n` : '') +
      `Current phase: ${task.frontmatter.phase}\n\n` +
      `User message: ${content}`;
    const taskContextWithState = `${buildContractReference()}\n\n${prependStateToTurn(
      taskContext,
      buildTaskStateSnapshot(task.frontmatter),
    )}`;

    const savePlanCallbackCleanup =
      !isForbidden(buildTaskStateSnapshot(task.frontmatter).mode, 'save_plan')
        ? registerSavePlanCallbackForChatTurn(task, workspaceId, workspacePath, broadcastToWorkspace)
        : undefined;

    try {
      await piSession.prompt(taskContextWithState, images && images.length > 0 ? { images } : undefined);
    } finally {
      savePlanCallbackCleanup?.();
    }

    // Chat resolved — go idle (no auto-advance for non-executing tasks)
    session.status = 'idle';
    session.awaitingUserInput = false;

    broadcastToWorkspace?.({
      type: 'agent:execution_status',
      taskId: task.id,
      status: 'idle',
    });

    return true;
  } catch (err) {
    console.error(`[startChat] Failed to start chat for task ${task.id}:`, err);
    session.status = 'error';
    clearActiveSessionIfOwned(task.id, session);

    broadcastToWorkspace?.({
      type: 'agent:execution_status',
      taskId: task.id,
      status: 'error',
    });

    return false;
  }
}

// =============================================================================
// Stop Agent Execution
// =============================================================================

export async function stopTaskExecution(taskId: string): Promise<boolean> {
  const session = activeSessions.get(taskId);

  if (!session || !session.piSession) {
    return false;
  }

  clearExecutionTurnWatchdogs(session);

  // Abort the agent session via Pi SDK (interrupts current operation)
  try {
    await session.piSession.abort();
  } catch (err) {
    console.error(`[stopTaskExecution] abort() failed for task ${taskId}:`, err);
  }

  // Unsubscribe from events so no further callbacks fire
  session.unsubscribe?.();

  // Prevent onComplete from firing after we stop
  session.onComplete = undefined;

  // Clean up completion callback registry
  cleanupCompletionCallback(taskId);
  cleanupAttachFileCallback(taskId);

  session.status = 'paused';
  session.awaitingUserInput = false;
  session.endTime = new Date().toISOString();

  // Broadcast idle status so the UI stops showing streaming indicators
  session.broadcastToWorkspace?.({
    type: 'agent:execution_status',
    taskId,
    status: 'idle',
  });

  // Remove from active sessions so hasRunningSession returns false
  clearActiveSessionIfOwned(taskId, session);

  return true;
}

// =============================================================================
// Planning Agent
// =============================================================================
// The planning agent researches the codebase, generates acceptance criteria, and produces a structured plan.
// Plans are auto-generated at task creation time using planTask() below.
// This agent is kept for manual/on-demand planning scenarios.

const PLANNING_DEFAULT_THINKING_LEVEL = 'low' as const;
const PLANNING_COMPACTION_TIMEOUT_MS = 90 * 1000;
const PLANNING_COMPACTION_INSTRUCTIONS = [
  'Planning is complete for this task.',
  'Summarize the planning conversation for future implementation work.',
  'Preserve: user intent, key constraints, architectural decisions, discovered risks, accepted trade-offs, acceptance criteria, and the saved plan goal/steps/validation/cleanup.',
  'Drop repetitive exploration logs and duplicate command output.',
].join(' ');

function coercePlanningGuardrailNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.floor(value);
  if (rounded <= 0) {
    return fallback;
  }

  return rounded;
}

export function resolvePlanningGuardrails(raw: unknown): PlanningGuardrails {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PLANNING_GUARDRAILS };
  }

  const candidate = raw as Partial<PlanningGuardrails>;

  return {
    timeoutMs: coercePlanningGuardrailNumber(candidate.timeoutMs, DEFAULT_PLANNING_GUARDRAILS.timeoutMs),
    maxToolCalls: coercePlanningGuardrailNumber(candidate.maxToolCalls, DEFAULT_PLANNING_GUARDRAILS.maxToolCalls),
  };
}

export function loadPlanningGuardrails(): PlanningGuardrails {
  const settings = loadPiFactorySettings();
  return resolvePlanningGuardrails(settings?.planningGuardrails);
}

const PLANNING_TURN_LIMIT_ERROR_PATTERN = /(turn[\s_-]*limit(?:\b|[_-])|\bmax(?:imum)?(?:[\s_-]+number[\s_-]+of)?[\s_-]*turns?(?:\b|[_-])|\btoo[\s_-]+many[\s_-]+turns?(?:\b|[_-]))/i;

function isPlanningTurnLimitError(errorMessage: unknown): boolean {
  if (typeof errorMessage !== 'string') {
    return false;
  }

  return PLANNING_TURN_LIMIT_ERROR_PATTERN.test(errorMessage);
}

function detectPlanningTurnLimitReason(event: AgentSessionEvent): string | null {
  if (event.type !== 'turn_end') {
    return null;
  }

  const message = (event as any).message;
  if (!message || message.role !== 'assistant') {
    return null;
  }

  if (message.stopReason === 'length') {
    return 'assistant output limit reached (stopReason=length)';
  }

  if (message.stopReason !== 'error' || !isPlanningTurnLimitError(message.errorMessage)) {
    return null;
  }

  const normalizedError = String(message.errorMessage).replace(/\s+/g, ' ').trim();
  return normalizedError
    ? `planning turn limit reached (${normalizedError})`
    : 'planning turn limit reached';
}

function buildPlanningGraceTurnPrompt(taskId: string, reason: string): string {
  return (
    `Your planning run ended because ${reason}. You must call \`save_plan\` NOW with taskId "${taskId}" `
    + 'using the research you have gathered so far. Do not call any other tools — only `save_plan`. '
    + 'Produce your best plan from the information already collected. Keep wording concise, easy to scan, and not overly wordy.'
  );
}

export function buildPlanningPrompt(
  task: Task,
  attachmentSection: string,
  workspaceSharedContext: string | null,
  guardrails: PlanningGuardrails = DEFAULT_PLANNING_GUARDRAILS,
  promptTemplate?: string,
): string {
  const { frontmatter, content } = task;
  const currentState = {
    ...buildTaskStateSnapshot(frontmatter),
    mode: 'task_planning' as const,
  };

  // Build sections for template substitution
  const acceptanceCriteria = frontmatter.acceptanceCriteria.length > 0
    ? `## Acceptance Criteria\n${frontmatter.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n`
    : '';

  const description = content ? `## Task Description\n${content}\n` : '';
  const sharedContext = buildWorkspaceSharedContextSection(workspaceSharedContext) ?? '';

  const template = promptTemplate?.trim() || DEFAULT_PLANNING_PROMPT_TEMPLATE;

  return renderPromptTemplate(template, {
    taskId: task.id,
    title: frontmatter.title,
    stateBlock: buildStateBlock(currentState),
    contractReference: buildContractReference(),
    acceptanceCriteria,
    description,
    sharedContext,
    attachments: attachmentSection,
    maxToolCalls: String(guardrails.maxToolCalls),
  });
}

export function buildPlanningResumePrompt(
  task: Task,
  attachmentSection: string,
  workspaceSharedContext: string | null,
  guardrails: PlanningGuardrails = DEFAULT_PLANNING_GUARDRAILS,
  promptTemplate?: string,
): string {
  const { frontmatter, content } = task;
  const currentState = {
    ...buildTaskStateSnapshot(frontmatter),
    mode: 'task_planning' as const,
  };

  // Build sections for template substitution
  const acceptanceCriteria = frontmatter.acceptanceCriteria.length > 0
    ? `## Existing Acceptance Criteria\n${frontmatter.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n`
    : '';

  const description = content ? `## Task Description\n${content}\n` : '';
  const sharedContext = buildWorkspaceSharedContextSection(workspaceSharedContext) ?? '';

  const template = promptTemplate?.trim() || DEFAULT_PLANNING_RESUME_PROMPT_TEMPLATE;

  return renderPromptTemplate(template, {
    taskId: task.id,
    title: frontmatter.title,
    stateBlock: buildStateBlock(currentState),
    contractReference: buildContractReference(),
    acceptanceCriteria,
    description,
    sharedContext,
    attachments: attachmentSection,
    maxToolCalls: String(guardrails.maxToolCalls),
  });
}

async function compactTaskSessionAfterPlanning(
  session: TaskSession,
  taskId: string,
): Promise<void> {
  const piSession = session.piSession;
  if (!piSession) return;

  const compact = (piSession as any).compact;
  if (typeof compact !== 'function') return;

  try {
    await withTimeout(
      async () => {
        await compact.call(piSession, PLANNING_COMPACTION_INSTRUCTIONS);
      },
      PLANNING_COMPACTION_TIMEOUT_MS,
      `Planning compaction timed out after ${Math.round(PLANNING_COMPACTION_TIMEOUT_MS / 1000)} seconds`,
    );
  } catch (err) {
    try {
      const abortCompaction = (piSession as any).abortCompaction;
      if (typeof abortCompaction === 'function') {
        abortCompaction.call(piSession);
      }
    } catch {
      // Ignore abort-compaction errors.
    }
    console.error(`[planTask] Failed to compact task conversation for ${taskId}:`, err);
  }
}

// =============================================================================
// Plan Callback Registry
// =============================================================================
// The save_plan extension tool calls back into the server via globalThis.
// We register a per-task callback before starting the planning session,
// and the extension looks it up by taskId.

interface SavedPlanningData {
  acceptanceCriteria: string[];
  plan: TaskPlan;
}

function ensurePlanCallbackRegistry(): Map<string, (data: SavedPlanningData) => void | Promise<void>> {
  if (!globalThis.__piFactoryPlanCallbacks) {
    globalThis.__piFactoryPlanCallbacks = new Map();
  }
  return globalThis.__piFactoryPlanCallbacks;
}

interface AttachTaskFileToolResult {
  taskId: string;
  attachmentId: string;
  filename: string;
  storedName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

declare global {
  var __piFactoryPlanCallbacks: Map<string, (data: SavedPlanningData) => void | Promise<void>> | undefined;
  var __piFactoryCompleteCallbacks: Map<string, (summary: string) => void> | undefined;
  var __piFactoryAttachFileCallbacks: Map<string, (data: AttachTaskFileRequest) => Promise<AttachTaskFileToolResult>> | undefined;
}

// =============================================================================
// Completion Callback Registry
// =============================================================================
// The task_complete extension tool calls back into the server via globalThis.
// We register a per-task callback before starting execution, and the extension
// looks it up by taskId.

function ensureCompleteCallbackRegistry(): Map<string, (summary: string) => void> {
  if (!globalThis.__piFactoryCompleteCallbacks) {
    globalThis.__piFactoryCompleteCallbacks = new Map();
  }
  return globalThis.__piFactoryCompleteCallbacks;
}

function ensureAttachFileCallbackRegistry(): Map<string, (data: AttachTaskFileRequest) => Promise<AttachTaskFileToolResult>> {
  if (!globalThis.__piFactoryAttachFileCallbacks) {
    globalThis.__piFactoryAttachFileCallbacks = new Map();
  }
  return globalThis.__piFactoryAttachFileCallbacks;
}

function savePlanForTask(
  task: Task,
  acceptanceCriteria: string[],
  plan: TaskPlan,
  workspaceId: string,
  workspacePath?: string,
  broadcastToWorkspace?: (event: any) => void,
): void {
  const latestTask = existsSync(task.filePath) ? parseTaskFile(task.filePath) : task;
  const currentState = buildTaskStateSnapshot(latestTask.frontmatter);

  if (isForbidden(currentState.mode, 'save_plan')) {
    throw new Error(
      `save_plan is forbidden in mode ${currentState.mode}.`,
    );
  }

  finalizePlan(task, acceptanceCriteria, plan, workspaceId, workspacePath, broadcastToWorkspace);
}

function registerSavePlanCallbackForChatTurn(
  task: Task,
  workspaceId: string,
  workspacePath?: string,
  broadcastToWorkspace?: (event: any) => void,
): () => void {
  const registry = ensurePlanCallbackRegistry();
  const callback = ({ acceptanceCriteria, plan }: SavedPlanningData) => {
    savePlanForTask(task, acceptanceCriteria, plan, workspaceId, workspacePath, broadcastToWorkspace);
  };

  const previous = registry.get(task.id);
  registry.set(task.id, callback);

  return () => {
    const active = registry.get(task.id);
    if (active !== callback) return;

    if (previous) {
      registry.set(task.id, previous);
      return;
    }

    registry.delete(task.id);
  };
}

export interface PlanTaskOptions {
  task: Task;
  workspaceId: string;
  workspacePath: string;
  broadcastToWorkspace?: (event: any) => void;
}

function syncTaskReference(target: Task, source: Task): void {
  target.id = source.id;
  target.frontmatter = source.frontmatter;
  target.content = source.content;
  target.history = source.history;
  target.filePath = source.filePath;
}

function persistPlanningMutation(task: Task, mutate: (latestTask: Task) => void): Task {
  const latestTask = existsSync(task.filePath) ? parseTaskFile(task.filePath) : task;
  mutate(latestTask);
  saveTaskFile(latestTask);
  syncTaskReference(task, latestTask);
  return latestTask;
}

export async function planTask(options: PlanTaskOptions): Promise<TaskPlan | null> {
  const { task, workspaceId, workspacePath, broadcastToWorkspace } = options;

  const stateBeforePlanning = buildTaskStateSnapshot(task.frontmatter);

  // Mark planning as running so interrupted work can be recovered on restart.
  const runningTask = persistPlanningMutation(task, (latestTask) => {
    latestTask.frontmatter.planningStatus = 'running';
    latestTask.frontmatter.updated = new Date().toISOString();
  });

  broadcastToWorkspace?.({
    type: 'task:updated',
    task: runningTask,
    changes: {},
  });

  const runningState = {
    ...buildTaskStateSnapshot(runningTask.frontmatter),
    mode: 'task_planning' as const,
  };

  void logTaskStateTransition({
    workspaceId,
    taskId: runningTask.id,
    from: stateBeforePlanning,
    to: runningState,
    source: 'planning:start',
    reason: 'Planning session started',
    broadcastToWorkspace,
  }).catch((err) => {
    console.error(`[planTask] Failed to log planning start state for ${runningTask.id}:`, err);
  });

  // Create task separator in activity log
  createTaskSeparator(
    workspaceId,
    task.id,
    task.frontmatter.title,
    task.frontmatter.phase,
  );

  broadcastActivityEntry(
    broadcastToWorkspace,
    createSystemEvent(
      workspaceId,
      task.id,
      'phase-change',
      'Planning agent started — researching codebase and generating plan',
    ),
    'planning start event',
  );

  // Create a session to track the planning agent
  const session: TaskSession = {
    id: crypto.randomUUID(),
    taskId: task.id,
    workspaceId,
    workspacePath,
    piSession: null,
    status: 'running',
    startTime: new Date().toISOString(),
    output: [],
    broadcastToWorkspace,
    currentStreamText: '',
    currentThinkingText: '',
    toolCallArgs: new Map(),
    toolCallOutput: new Map(),
    lastToolResultText: '',
    lastToolResultAt: 0,
    agentSignaledComplete: false,
    completionSummary: '',
    task,
    awaitingUserInput: false,
  };

  registerActiveSession(session);

  const prePlanningSkillIds = task.frontmatter.prePlanningSkills;
  const hasPrePlanningSkills = Array.isArray(prePlanningSkillIds) && prePlanningSkillIds.length > 0;

  broadcastToWorkspace?.({
    type: 'agent:execution_status',
    taskId: task.id,
    status: hasPrePlanningSkills ? 'pre-planning-hooks' : 'streaming',
  });

  const registry = ensurePlanCallbackRegistry();
  const planningGuardrails = loadPlanningGuardrails();
  const { loadTaskDefaultsForWorkspacePath } = await import('./task-defaults-service.js');
  const taskDefaults = loadTaskDefaultsForWorkspacePath(workspacePath);
  let savedPlan: TaskPlan | null = null;
  let hasPersistedPlan = false;
  let planningToolCallCount = 0;
  let planningGuardrailAbortMessage: string | null = null;
  let planningTurnLimitMessage: string | null = null;
  let graceTurnActive = false;

  try {
    // Register callback so the save_plan extension tool can persist criteria + plan.
    // As soon as a plan is persisted, abort the planning turn so the model
    // cannot continue into implementation work while the task is still backlog/planning.
    registry.set(task.id, ({ acceptanceCriteria, plan }: SavedPlanningData) => {
      if (hasPersistedPlan) return;
      hasPersistedPlan = true;
      savedPlan = plan;
      finalizePlan(task, acceptanceCriteria, plan, workspaceId, workspacePath, broadcastToWorkspace);

      void session.piSession?.abort().catch((abortErr) => {
        console.error(`[planTask] Failed to abort planning session after save_plan for ${task.id}:`, abortErr);
      });
    });

    const planningSettings = SettingsManager.create(workspacePath);
    planningSettings.applyOverrides({
      retry: { enabled: false },
      compaction: { enabled: false },
    });

    const { session: piSession, resumed: isResumingPlanningSession } = await createTaskConversationSession({
      task,
      workspacePath,
      settingsManager: planningSettings,
      purpose: 'planning',
      defaultThinkingLevel: PLANNING_DEFAULT_THINKING_LEVEL,
    });

    session.piSession = piSession;

    const abortForPlanningGuardrail = (message: string): void => {
      if (hasPersistedPlan || planningGuardrailAbortMessage) {
        return;
      }

      planningGuardrailAbortMessage = message;

      broadcastActivityEntry(
        broadcastToWorkspace,
        createSystemEvent(
          workspaceId,
          task.id,
          'phase-change',
          `Planning guardrail hit: ${message}`,
        ),
        'planning guardrail event',
      );

      void session.piSession?.abort().catch((abortErr) => {
        console.error(`[planTask] Failed to abort planning session after guardrail hit for ${task.id}:`, abortErr);
      });
    };

    session.unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
      handlePiEvent(event, session, workspaceId, task.id);

      if (hasPersistedPlan) {
        return;
      }

      // During the grace turn, abort if the agent calls any tool other than save_plan.
      // save_plan fires the registry callback synchronously, setting hasPersistedPlan
      // before this subscriber sees tool_execution_end, so it's caught above.
      if (graceTurnActive) {
        if (event.type === 'tool_execution_end') {
          void session.piSession?.abort().catch(() => undefined);
        }
        return;
      }

      if (!planningGuardrailAbortMessage && !planningTurnLimitMessage) {
        planningTurnLimitMessage = detectPlanningTurnLimitReason(event);
      }

      if (planningGuardrailAbortMessage) {
        return;
      }

      if (event.type !== 'tool_execution_end') {
        return;
      }

      planningToolCallCount += 1;
      if (planningToolCallCount > planningGuardrails.maxToolCalls) {
        abortForPlanningGuardrail(
          `tool-call budget exceeded (${planningToolCallCount}/${planningGuardrails.maxToolCalls}). Narrow scope or raise planning guardrails in Settings.`,
        );
        return;
      }

    });
    broadcastTaskContextUsage(session, task.id);

    if (hasPrePlanningSkills && prePlanningSkillIds && prePlanningSkillIds.length > 0 && session.piSession) {
      broadcastActivityEntry(
        broadcastToWorkspace,
        createSystemEvent(
          workspaceId,
          task.id,
          'phase-change',
          `Running ${prePlanningSkillIds.length} pre-planning skill(s): ${prePlanningSkillIds.join(', ')}`,
          { skillIds: prePlanningSkillIds },
        ),
        'pre-planning start event',
      );

      try {
        await runPrePlanningSkills(session.piSession, prePlanningSkillIds, {
          taskId: task.id,
          workspaceId,
          broadcastToWorkspace,
          skillConfigs: task.frontmatter.skillConfigs,
        });
      } catch (prePlanningErr) {
        console.error('Pre-planning skills failed:', prePlanningErr);

        broadcastActivityEntry(
          broadcastToWorkspace,
          createSystemEvent(
            workspaceId,
            task.id,
            'phase-change',
            `Pre-planning skills failed — skipping planning prompt: ${prePlanningErr}`,
            { error: String(prePlanningErr) },
          ),
          'pre-planning error event',
        );

        throw prePlanningErr;
      }

      broadcastToWorkspace?.({
        type: 'agent:execution_status',
        taskId: task.id,
        status: 'streaming',
      });
    }

    // Load task attachments for the planning prompt
    const { images: planImages, promptSection: planAttachmentSection } = loadAttachments(
      task.frontmatter.attachments,
      workspacePath,
      task.id,
    );

    // Send the planning prompt
    const workspaceSharedContext = loadWorkspaceSharedContext(workspacePath);
    const prompt = isResumingPlanningSession
      ? buildPlanningResumePrompt(task, planAttachmentSection, workspaceSharedContext, planningGuardrails, taskDefaults.planningPromptTemplate)
      : buildPlanningPrompt(task, planAttachmentSection, workspaceSharedContext, planningGuardrails, taskDefaults.planningPromptTemplate);
    const planPromptOpts = planImages.length > 0 ? { images: planImages } : undefined;
    const planningTimeoutMessage = `Planning timed out after ${Math.round(planningGuardrails.timeoutMs / 1000)} seconds`;
    await withTimeout(
      async (signal) => {
        signal.addEventListener('abort', () => {
          void piSession.abort().catch(() => undefined);
        }, { once: true });
        await piSession.prompt(prompt, planPromptOpts);

        // Grace turn: if planning ended due to a budget/turn/output limit and no plan
        // was saved, give the agent one final turn to call save_plan.
        const graceTurnReason = planningGuardrailAbortMessage ?? planningTurnLimitMessage;
        if (graceTurnReason && !savedPlan && !hasPersistedPlan) {
          graceTurnActive = true;

          const graceTurnEventMessage = planningGuardrailAbortMessage
            ? 'Budget exceeded — giving agent one final turn to save a plan.'
            : 'Turn/output limit reached — giving agent one final turn to save a plan.';

          broadcastActivityEntry(
            broadcastToWorkspace,
            createSystemEvent(
              workspaceId,
              task.id,
              'phase-change',
              graceTurnEventMessage,
            ),
            'planning grace turn event',
          );

          const graceTurnPrompt = planningGuardrailAbortMessage
            ? (
                `Your planning tool budget has been reached. You must call \`save_plan\` NOW with taskId "${task.id}" `
                + 'using the research you have gathered so far. Do not call any other tools — only `save_plan`. '
                + 'Produce your best plan from the information already collected.'
              )
            : buildPlanningGraceTurnPrompt(task.id, graceTurnReason);

          await piSession.prompt(graceTurnPrompt);
        }
      },
      planningGuardrails.timeoutMs,
      planningTimeoutMessage,
    );

    if (!savedPlan && planningGuardrailAbortMessage) {
      throw new Error(planningGuardrailAbortMessage);
    }

    if (!savedPlan && planningTurnLimitMessage) {
      throw new Error(`${planningTurnLimitMessage}. Grace turn ended without save_plan.`);
    }

    if (savedPlan) {
      await compactTaskSessionAfterPlanning(session, task.id);
    }

    // Clean up
    session.unsubscribe?.();
    session.status = 'completed';
    session.endTime = new Date().toISOString();
    clearActiveSessionIfOwned(task.id, session);
    registry.delete(task.id);

    if (!savedPlan) {
      const beforeErrorState = buildTaskStateSnapshot(task.frontmatter);
      const erroredTask = persistPlanningMutation(task, (latestTask) => {
        latestTask.frontmatter.planningStatus = 'error';
        latestTask.frontmatter.updated = new Date().toISOString();
      });

      broadcastToWorkspace?.({
        type: 'task:updated',
        task: erroredTask,
        changes: {},
      });

      void logTaskStateTransition({
        workspaceId,
        taskId: erroredTask.id,
        from: {
          ...beforeErrorState,
          mode: 'task_planning',
        },
        to: buildTaskStateSnapshot(erroredTask.frontmatter),
        source: 'planning:missing-save-plan',
        reason: 'Planning ended without save_plan',
        broadcastToWorkspace,
      }).catch((stateErr) => {
        console.error(`[planTask] Failed to log missing-save-plan state for ${erroredTask.id}:`, stateErr);
      });

      broadcastActivityEntry(
        broadcastToWorkspace,
        createSystemEvent(
          workspaceId,
          task.id,
          'phase-change',
          'Planning agent completed but did not call save_plan — no plan was saved',
        ),
        'planning missing save_plan event',
      );
    }

    broadcastToWorkspace?.({
      type: 'agent:execution_status',
      taskId: task.id,
      status: savedPlan ? 'completed' : 'error',
    });

    return savedPlan;
  } catch (err) {
    const errMessage = planningGuardrailAbortMessage ?? (err instanceof Error ? err.message : String(err));

    // If a plan was already persisted via save_plan, treat this as a successful
    // completion (the failure happened after the important state was saved).
    if (savedPlan) {
      try {
        await session.piSession?.abort();
      } catch {
        // Ignore — session may already be ended.
      }

      await compactTaskSessionAfterPlanning(session, task.id);

      session.unsubscribe?.();
      session.status = 'completed';
      session.endTime = new Date().toISOString();
      clearActiveSessionIfOwned(task.id, session);
      registry.delete(task.id);

      broadcastToWorkspace?.({
        type: 'agent:execution_status',
        taskId: task.id,
        status: 'completed',
      });

      return savedPlan;
    }

    console.error(`Planning agent failed for ${task.id}:`, err);

    // Clean up failed session so no background stream continues.
    session.unsubscribe?.();
    try {
      await session.piSession?.abort();
    } catch (abortErr) {
      console.error(`[planTask] abort() failed for ${task.id}:`, abortErr);
    }

    session.status = 'error';
    session.endTime = new Date().toISOString();
    clearActiveSessionIfOwned(task.id, session);
    registry.delete(task.id);

    const beforeErrorState = buildTaskStateSnapshot(task.frontmatter);
    const erroredTask = persistPlanningMutation(task, (latestTask) => {
      latestTask.frontmatter.planningStatus = 'error';
      latestTask.frontmatter.updated = new Date().toISOString();
    });

    broadcastToWorkspace?.({
      type: 'task:updated',
      task: erroredTask,
      changes: {},
    });

    void logTaskStateTransition({
      workspaceId,
      taskId: erroredTask.id,
      from: {
        ...beforeErrorState,
        mode: 'task_planning',
      },
      to: buildTaskStateSnapshot(erroredTask.frontmatter),
      source: 'planning:error',
      reason: errMessage,
      broadcastToWorkspace,
    }).catch((stateErr) => {
      console.error(`[planTask] Failed to log planning error state for ${erroredTask.id}:`, stateErr);
    });

    broadcastActivityEntry(
      broadcastToWorkspace,
      createSystemEvent(
        workspaceId,
        task.id,
        'phase-change',
        `Planning agent failed (${errMessage}). No plan was saved.`,
      ),
      'planning failure event',
    );

    broadcastToWorkspace?.({
      type: 'agent:execution_status',
      taskId: task.id,
      status: 'error',
    });

    return null;
  }
}

/**
 * Save acceptance criteria + a generated plan to the task and broadcast updates.
 */
function readWorkspaceConfigForTask(task: Task, workspacePath?: string): WorkspaceConfig | null {
  const candidatePaths = [workspacePath, task.frontmatter.workspace]
    .map((candidate) => candidate?.trim())
    .filter((candidate): candidate is string => Boolean(candidate));

  for (const candidatePath of candidatePaths) {
    const config = loadWorkspaceConfigFromDiskSync(candidatePath);
    if (config) {
      return config;
    }
  }

  return null;
}

function resolveTasksDirForTask(
  task: Task,
  workspaceConfig: WorkspaceConfig | null,
  workspacePath?: string,
): string {
  const effectiveWorkspacePath = workspacePath?.trim() || task.frontmatter.workspace?.trim();
  if (!effectiveWorkspacePath) {
    return workspaceConfig?.defaultTaskLocation || DEFAULT_WORKSPACE_TASK_LOCATION;
  }

  return resolveExistingTasksDirFromWorkspacePath(effectiveWorkspacePath, workspaceConfig);
}

function maybeAutoPromoteBacklogTaskAfterPlanning(
  task: Task,
  workspaceId: string,
  normalizedCriteria: string[],
  workspacePath?: string,
  broadcastToWorkspace?: (event: any) => void,
): Task {
  if (task.frontmatter.phase !== 'backlog') {
    return task;
  }

  if (normalizedCriteria.length === 0) {
    return task;
  }

  const workspaceConfig = readWorkspaceConfigForTask(task, workspacePath);
  const globalWorkflowDefaults = resolveGlobalWorkflowSettings(loadPiFactorySettings()?.workflowDefaults);
  const workflowSettings = workspaceConfig
    ? resolveWorkspaceWorkflowSettings(workspaceConfig, globalWorkflowDefaults)
    : globalWorkflowDefaults;

  if (!workflowSettings.backlogToReady) {
    return task;
  }

  const tasksDir = resolveTasksDirForTask(task, workspaceConfig, workspacePath);
  const tasks = discoverTasks(tasksDir);
  const latestTask = tasks.find((candidate) => candidate.id === task.id) || task;

  const moveValidation = canMoveToPhase(latestTask, 'ready');
  if (!moveValidation.allowed) {
    return latestTask;
  }

  const readyTasks = tasks.filter((candidate) => candidate.frontmatter.phase === 'ready');
  if (readyTasks.length >= workflowSettings.readyLimit && latestTask.frontmatter.phase !== 'ready') {
    return latestTask;
  }

  const fromPhase = latestTask.frontmatter.phase;
  const fromState = buildTaskStateSnapshot(latestTask.frontmatter);

  moveTaskToPhase(latestTask, 'ready', 'system', 'Auto-promoted after planning completion', tasks);
  syncTaskReference(task, latestTask);

  void logTaskStateTransition({
    workspaceId,
    taskId: latestTask.id,
    from: fromState,
    to: buildTaskStateSnapshot(latestTask.frontmatter),
    source: 'planning:auto-promote',
    reason: 'Auto-promoted from backlog to ready after planning completion',
    broadcastToWorkspace,
  }).catch((stateErr) => {
    console.error(`[finalizePlan] Failed to log auto-promotion state for ${latestTask.id}:`, stateErr);
  });

  broadcastActivityEntry(
    broadcastToWorkspace,
    createSystemEvent(
      workspaceId,
      latestTask.id,
      'phase-change',
      'Auto-promoted from backlog to ready after planning completion',
      { fromPhase, toPhase: 'ready' },
    ),
    'planning auto-promote event',
  );

  broadcastToWorkspace?.({
    type: 'task:moved',
    task: latestTask,
    from: fromPhase,
    to: 'ready',
  });

  // Notify the queue manager through the coordination boundary.
  requestQueueKick(workspaceId);

  return latestTask;
}

function finalizePlan(
  task: Task,
  acceptanceCriteria: string[],
  plan: TaskPlan,
  workspaceId: string,
  workspacePath?: string,
  broadcastToWorkspace?: (event: any) => void,
): void {
  const normalizedCriteria = acceptanceCriteria
    .map((criterion) => criterion.trim())
    .filter(Boolean);

  const beforeCompletionState = buildTaskStateSnapshot(task.frontmatter);

  const updatedTask = persistPlanningMutation(task, (latestTask) => {
    latestTask.frontmatter.acceptanceCriteria = normalizedCriteria;
    latestTask.frontmatter.plan = plan;
    latestTask.frontmatter.planningStatus = 'completed';
    latestTask.frontmatter.updated = new Date().toISOString();
  });

  void logTaskStateTransition({
    workspaceId,
    taskId: updatedTask.id,
    from: {
      ...beforeCompletionState,
      mode: 'task_planning',
    },
    to: buildTaskStateSnapshot(updatedTask.frontmatter),
    source: 'planning:completed',
    reason: 'Plan and acceptance criteria saved',
    broadcastToWorkspace,
  }).catch((stateErr) => {
    console.error(`[finalizePlan] Failed to log planning completion state for ${updatedTask.id}:`, stateErr);
  });

  const finalTask = maybeAutoPromoteBacklogTaskAfterPlanning(
    updatedTask,
    workspaceId,
    normalizedCriteria,
    workspacePath,
    broadcastToWorkspace,
  );

  broadcastActivityEntry(
    broadcastToWorkspace,
    createSystemEvent(
      workspaceId,
      updatedTask.id,
      'phase-change',
      `Planning complete: ${normalizedCriteria.length} acceptance criteria and plan generated successfully`,
    ),
    'planning complete event',
  );

  broadcastToWorkspace?.({
    type: 'task:plan_generated',
    taskId: updatedTask.id,
    plan,
  });

  broadcastToWorkspace?.({
    type: 'task:updated',
    task: finalTask,
    changes: { acceptanceCriteria: normalizedCriteria, plan },
  });
}

function buildAcceptanceCriteriaRegenerationPrompt(task: Task): string {
  const plan = task.frontmatter.plan;

  let prompt = `Regenerate acceptance criteria for task ${task.id}: "${task.frontmatter.title}".\n`;
  prompt += 'Use the existing conversation context as the primary source of truth.\n';
  prompt += 'Do not run tools unless absolutely necessary.\n';
  prompt += 'Output ONLY a numbered list (1. 2. 3. ...) with 3-7 criteria.\n';
  prompt += 'No introduction, no explanation, no markdown headers.\n\n';

  if (task.content) {
    prompt += `Task Description:\n${task.content}\n\n`;
  }

  if (plan) {
    prompt += `Plan:\n`;
    prompt += `- Goal: ${plan.goal}\n`;
    if (plan.steps.length > 0) {
      prompt += `- Steps:\n${plan.steps.map((step, i) => `  ${i + 1}. ${step}`).join('\n')}\n`;
    }
    if (plan.validation.length > 0) {
      prompt += `- Validation:\n${plan.validation.map((item) => `  - ${item}`).join('\n')}\n`;
    }
    prompt += '\n';
  }

  return `${buildContractReference()}\n\n${prependStateToTurn(
    prompt,
    buildTaskStateSnapshot(task.frontmatter),
  )}`;
}

function parseAcceptanceCriteriaFromConversation(response: string): string[] {
  if (!response.trim()) return [];

  const extracted = response
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const numbered = line.match(/^\d+[\.)]\s+(.+)$/);
      if (numbered) return numbered[1].trim();

      const bullet = line.match(/^[-*]\s+(.+)$/);
      if (bullet) return bullet[1].trim();

      return null;
    })
    .filter((line): line is string => !!line)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const criterion of extracted) {
    const key = criterion.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(criterion);
  }

  return deduped.slice(0, 7);
}

async function regenerateAcceptanceCriteriaViaTaskConversation(task: Task): Promise<string[]> {
  const workspacePath = task.frontmatter.workspace?.trim();
  if (!workspacePath) {
    return [];
  }

  const { session: piSession } = await createTaskConversationSession({
    task,
    workspacePath,
    purpose: 'planning',
  });

  let response = '';
  const unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
    if (
      event.type === 'message_update'
      && event.assistantMessageEvent.type === 'text_delta'
    ) {
      response += event.assistantMessageEvent.delta;
    }
  });

  try {
    const prompt = buildAcceptanceCriteriaRegenerationPrompt(task);
    await withTimeout(
      async (signal) => {
        signal.addEventListener('abort', () => {
          void piSession.abort().catch(() => undefined);
        }, { once: true });
        await piSession.prompt(prompt);
      },
      90_000,
      'Acceptance criteria regeneration timed out after 90 seconds',
    );
  } finally {
    unsubscribe();
    piSession.dispose();
  }

  return parseAcceptanceCriteriaFromConversation(response);
}

/**
 * Regenerate acceptance criteria for a task using its description and plan.
 * Called manually via the API.
 */
export async function regenerateAcceptanceCriteriaForTask(
  task: Task,
  workspaceId: string,
  broadcastToWorkspace?: (event: any) => void,
): Promise<string[]> {
  const description = task.content || task.frontmatter.title;
  const plan = task.frontmatter.plan;

  let criteria: string[] = [];

  try {
    criteria = await regenerateAcceptanceCriteriaViaTaskConversation(task);
  } catch (err) {
    console.error('[AcceptanceCriteria] Failed to regenerate via task conversation:', err);
  }

  if (criteria.length === 0) {
    try {
      const { generateAcceptanceCriteria } = await import('./acceptance-criteria-service.js');
      criteria = await generateAcceptanceCriteria(
        description,
        plan ? { goal: plan.goal, steps: plan.steps, validation: plan.validation, cleanup: plan.cleanup } : undefined,
      );
    } catch (err) {
      console.error('Failed to regenerate acceptance criteria:', err);
      return task.frontmatter.acceptanceCriteria;
    }
  }

  if (criteria.length > 0) {
    task.frontmatter.acceptanceCriteria = criteria;
    task.frontmatter.updated = new Date().toISOString();
    saveTaskFile(task);

    broadcastActivityEntry(
      broadcastToWorkspace,
      createSystemEvent(
        workspaceId,
        task.id,
        'phase-change',
        `Acceptance criteria regenerated (${criteria.length} criteria)`,
      ),
      'acceptance criteria regeneration event',
    );

    broadcastToWorkspace?.({
      type: 'task:updated',
      task,
      changes: { acceptanceCriteria: criteria },
    });
  }

  return criteria;
}

// =============================================================================
// Simulated Agent Execution (for testing without Pi SDK)
// =============================================================================

function simulateAgentExecution(
  session: TaskSession,
  task: Task,
  workspaceId: string,
  onOutput?: (output: string) => void,
  onComplete?: (success: boolean, details?: ExecutionCompletionDetails) => void
): void {
  const broadcast = session.broadcastToWorkspace;
  const steps = [
    'Analyzing task requirements...',
    'Reviewing acceptance criteria...',
    'Planning implementation approach...',
    'Setting up development environment...',
    'Implementing core functionality...',
    'Writing tests...',
    'Running test suite...',
    'All tests passing ✓',
    'Running linter...',
    'Lint check passed ✓',
    'Task completed successfully!',
  ];

  let stepIndex = 0;

  const interval = setInterval(() => {
    if (stepIndex >= steps.length) {
      clearInterval(interval);
      session.status = 'completed';
      session.endTime = new Date().toISOString();

      broadcastActivityEntry(
        broadcast,
        createSystemEvent(
          workspaceId,
          task.id,
          'phase-change',
          'Agent execution completed',
          { simulated: true },
        ),
        'simulated execution completion event',
      );

      onComplete?.(true);
      return;
    }

    const output = steps[stepIndex];
    session.output.push(output);
    onOutput?.(output);

    broadcastActivityEntry(
      broadcast,
      createChatMessage(workspaceId, task.id, 'agent', output),
      'simulated chat message',
    );

    stepIndex++;
  }, 2000);
}
