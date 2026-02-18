// =============================================================================
// Planning Agent Service
// =============================================================================
// The planning agent is a general-purpose conversational agent that helps the
// user research, decompose, and stage work before it hits the production line.
// It maintains one conversation per workspace and can create draft tasks
// on the production queue.

import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import {
  createAgentSession,
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
} from '@mariozechner/pi-coding-agent';
import type {
  Artifact,
  DraftTask,
  PlanningMessage,
  PlanningAgentStatus,
  ServerEvent,
  Task,
  Shelf,
  QARequest,
  QAAnswer,
  QAResponse,
  ContextUsageSnapshot,
} from '@task-factory/shared';
import {
  clearShelf,
} from './shelf-service.js';
import { getWorkspaceById } from './workspace-service.js';
import { discoverTasks } from './task-service.js';
import { getTasksDir } from './workspace-service.js';
import { getRepoExtensionPaths, hasLiveExecutionSession } from './agent-execution-service.js';
import {
  loadWorkspaceSharedContext,
  WORKSPACE_SHARED_CONTEXT_REL_PATH,
  loadForemanSettings,
} from './pi-integration.js';
import {
  startQueueProcessing,
  stopQueueProcessing,
  getQueueStatus,
} from './queue-manager.js';
import {
  buildContractReference,
  buildStateBlock,
  prependStateToTurn,
  stripStateContractEcho,
} from './state-contract.js';
import {
  getTaskFactoryAuthPath,
  getWorkspaceTaskFactorySkillsDir,
  resolveTaskFactoryHomePath,
} from './taskfactory-home.js';
import {
  loadWorkspaceConfigFromDiskSync,
  resolveWorkspaceArtifactRoot,
  getWorkspaceArtifactPath,
  resolveWorkspaceArtifactPathForRead,
} from './workspace-storage.js';

// =============================================================================
// Shelf callback registry — used by extension tools
// =============================================================================

export interface ShelfCallbacks {
  createDraftTask: (args: any) => Promise<DraftTask>;
  createArtifact: (args: { name: string; html: string }) => Promise<Artifact>;
  removeItem: (itemId: string) => Promise<string>;
  updateDraftTask: (draftId: string, updates: any) => Promise<string>;
  getShelf: () => Promise<Shelf>;
}

declare global {
  var __piFactoryShelfCallbacks: Map<string, ShelfCallbacks> | undefined;
}

function ensureShelfCallbackRegistry(): Map<string, ShelfCallbacks> {
  if (!globalThis.__piFactoryShelfCallbacks) {
    globalThis.__piFactoryShelfCallbacks = new Map();
  }
  return globalThis.__piFactoryShelfCallbacks;
}

function normalizeDraftTaskPlan(plan: any): DraftTask['plan'] {
  if (!plan || typeof plan !== 'object') return undefined;

  return {
    goal: String(plan.goal || ''),
    steps: Array.isArray(plan.steps) ? plan.steps.map(String) : [],
    validation: Array.isArray(plan.validation) ? plan.validation.map(String) : [],
    cleanup: Array.isArray(plan.cleanup) ? plan.cleanup.map(String) : [],
    generatedAt: typeof plan.generatedAt === 'string' && plan.generatedAt
      ? plan.generatedAt
      : new Date().toISOString(),
  };
}

function buildDraftTaskFromArgs(args: any): DraftTask {
  return {
    id: `draft-${crypto.randomUUID().slice(0, 8)}`,
    title: String(args.title || 'Untitled Task'),
    content: String(args.content || ''),
    acceptanceCriteria: Array.isArray(args.acceptance_criteria)
      ? args.acceptance_criteria.map(String)
      : [],
    plan: normalizeDraftTaskPlan(args.plan),
    createdAt: new Date().toISOString(),
  };
}

function applyDraftTaskUpdates(draft: DraftTask, updates: any): DraftTask {
  const nextAcceptanceCriteria = Array.isArray(updates?.acceptanceCriteria)
    ? updates.acceptanceCriteria.map(String)
    : Array.isArray(updates?.acceptance_criteria)
      ? updates.acceptance_criteria.map(String)
      : draft.acceptanceCriteria;

  const nextPlan = updates && Object.prototype.hasOwnProperty.call(updates, 'plan')
    ? normalizeDraftTaskPlan(updates.plan)
    : draft.plan;

  return {
    ...draft,
    title: typeof updates?.title === 'string' ? updates.title : draft.title,
    content: typeof updates?.content === 'string' ? updates.content : draft.content,
    acceptanceCriteria: nextAcceptanceCriteria,
    plan: nextPlan,
  };
}

function buildSessionOutputShelf(session?: { draftTasks: Map<string, DraftTask>; artifacts: Map<string, Artifact> } | null): Shelf {
  if (!session) return { items: [] };

  const draftItems = Array.from(session.draftTasks.values()).map((item) => ({
    type: 'draft-task' as const,
    item,
  }));
  const artifactItems = Array.from(session.artifacts.values()).map((item) => ({
    type: 'artifact' as const,
    item,
  }));

  return { items: [...draftItems, ...artifactItems] };
}

function registerShelfCallbacks(
  workspaceId: string,
  broadcast: (event: ServerEvent) => void,
  getSession: () => PlanningSession | undefined,
): void {
  const registry = ensureShelfCallbackRegistry();
  registry.set(workspaceId, {
    createDraftTask: async (args: any) => {
      const session = getSession();
      const draft = buildDraftTaskFromArgs(args);
      session?.draftTasks.set(draft.id, draft);

      if (session) {
        broadcast({ type: 'shelf:updated', workspaceId, shelf: buildSessionOutputShelf(session) });
      }

      return draft;
    },
    createArtifact: async (args: { name: string; html: string }) => {
      const artifact: Artifact = {
        id: `artifact-${crypto.randomUUID().slice(0, 8)}`,
        name: String(args.name || 'Untitled Artifact'),
        html: String(args.html || ''),
        createdAt: new Date().toISOString(),
      };

      const session = getSession();
      session?.artifacts.set(artifact.id, artifact);

      if (session) {
        broadcast({ type: 'shelf:updated', workspaceId, shelf: buildSessionOutputShelf(session) });
      }

      return artifact;
    },
    removeItem: async (itemId: string) => {
      const session = getSession();
      if (!session) return 'No active planning session';

      const removedDraft = session.draftTasks.delete(itemId);
      const removedArtifact = session.artifacts.delete(itemId);
      if (!removedDraft && !removedArtifact) {
        return `Item ${itemId} not found`;
      }

      broadcast({ type: 'shelf:updated', workspaceId, shelf: buildSessionOutputShelf(session) });
      return `Removed item ${itemId}`;
    },
    updateDraftTask: async (draftId: string, updates: any) => {
      const session = getSession();
      if (!session) return 'No active planning session';

      const existing = session.draftTasks.get(draftId);
      if (!existing) {
        return `Draft ${draftId} not found`;
      }

      const updated = applyDraftTaskUpdates(existing, updates);
      session.draftTasks.set(draftId, updated);
      broadcast({ type: 'shelf:updated', workspaceId, shelf: buildSessionOutputShelf(session) });
      return `Updated draft ${draftId}`;
    },
    getShelf: async () => {
      return buildSessionOutputShelf(getSession());
    },
  });
}

function unregisterShelfCallbacks(workspaceId: string): void {
  globalThis.__piFactoryShelfCallbacks?.delete(workspaceId);
}

// =============================================================================
// QA callback registry — used by ask_questions extension tool
// =============================================================================

export interface QACallbacks {
  askQuestions: (requestId: string, questions: { id: string; text: string; options: string[] }[]) => Promise<QAAnswer[]>;
}

declare global {
  var __piFactoryQACallbacks: Map<string, QACallbacks> | undefined;
}

function ensureQACallbackRegistry(): Map<string, QACallbacks> {
  if (!globalThis.__piFactoryQACallbacks) {
    globalThis.__piFactoryQACallbacks = new Map();
  }
  return globalThis.__piFactoryQACallbacks;
}

/** Pending QA request resolvers keyed by requestId */
const pendingQARequests = new Map<string, {
  resolve: (answers: QAAnswer[]) => void;
  reject: (err: Error) => void;
  workspaceId: string;
  request: QARequest;
}>();

function registerQACallbacks(
  workspaceId: string,
  _broadcast: (event: ServerEvent) => void,
  getSession: () => PlanningSession | undefined,
): void {
  const registry = ensureQACallbackRegistry();
  registry.set(workspaceId, {
    askQuestions: (requestId, questions) => {
      return new Promise<QAAnswer[]>((resolve, reject) => {
        const qaRequest: QARequest = {
          requestId,
          questions: questions.map((q) => ({
            id: q.id,
            text: q.text,
            options: q.options,
          })),
        };

        // Store resolver AND request data so the HTTP polling endpoint can return it
        pendingQARequests.set(requestId, { resolve, reject, workspaceId, request: qaRequest });

        const session = getSession();
        // Use session's current broadcast (updated on each message) rather than
        // the captured reference from registration time which may go stale.
        const broadcast = session?.broadcast || _broadcast;

        // Update status to awaiting_qa
        if (session) {
          session.status = 'awaiting_qa';
          broadcast({ type: 'planning:status', workspaceId, status: 'awaiting_qa' });
        }

        // Persist the QA request as a planning message
        if (session) {
          const qaMsg: PlanningMessage = {
            id: crypto.randomUUID(),
            role: 'qa',
            content: questions.map((q) => `**${q.text}**\n${q.options.map((o, i) => `  ${i + 1}. ${o}`).join('\n')}`).join('\n\n'),
            timestamp: new Date().toISOString(),
            sessionId: session.sessionId,
            metadata: { qaRequest },
          };
          session.messages.push(qaMsg);
          persistMessages(workspaceId, session.messages);
          broadcast({ type: 'planning:message', workspaceId, message: qaMsg });
        }

        // Broadcast the QA request event to the workspace
        broadcast({ type: 'qa:request', workspaceId, request: qaRequest });
      });
    },
  });
}

function unregisterQACallbacks(workspaceId: string): void {
  globalThis.__piFactoryQACallbacks?.delete(workspaceId);
  // Reject pending QA requests for this workspace so Promises don't hang.
  for (const [requestId, pending] of pendingQARequests) {
    if (pending.workspaceId !== workspaceId) continue;
    pending.reject(new Error('Planning session reset'));
    pendingQARequests.delete(requestId);
  }
}

/**
 * Abort a pending QA request. The agent tool receives an error and
 * continues with its best judgement.
 */
export function abortQARequest(
  workspaceId: string,
  requestId: string,
  broadcast: (event: ServerEvent) => void,
): boolean {
  const pending = pendingQARequests.get(requestId);
  if (!pending) return false;

  pendingQARequests.delete(requestId);

  // Persist abort as a QA message
  const session = planningSessions.get(workspaceId);
  if (session) {
    const abortMsg: PlanningMessage = {
      id: crypto.randomUUID(),
      role: 'qa',
      content: '*Skipped — user chose to answer directly instead.*',
      timestamp: new Date().toISOString(),
      sessionId: session.sessionId,
      metadata: { qaResponse: { requestId, answers: [] } },
    };
    session.messages.push(abortMsg);
    persistMessages(workspaceId, session.messages);
    broadcast({ type: 'planning:message', workspaceId, message: abortMsg });
  }

  pending.reject(new Error('User skipped Q&A'));
  return true;
}

/**
 * Resolve a pending QA request with user answers.
 * Called from the HTTP endpoint when the user submits the QADialog.
 */
export function resolveQARequest(
  workspaceId: string,
  requestId: string,
  answers: QAAnswer[],
  broadcast: (event: ServerEvent) => void,
): boolean {
  const pending = pendingQARequests.get(requestId);
  if (!pending) return false;

  pendingQARequests.delete(requestId);

  // Persist the QA response as a planning message
  const session = planningSessions.get(workspaceId);
  if (session) {
    const qaResponse: QAResponse = { requestId, answers };

    // Look up the original request to get human-readable question text
    const requestMsg = session.messages.find(
      (m) => m.role === 'qa' && m.metadata?.qaRequest?.requestId === requestId,
    );
    const questions = requestMsg?.metadata?.qaRequest?.questions || [];

    const responseMsg: PlanningMessage = {
      id: crypto.randomUUID(),
      role: 'qa',
      content: answers.map((a) => {
        const q = questions.find((q: any) => q.id === a.questionId);
        return `**${q?.text || a.questionId}**: ${a.selectedOption}`;
      }).join('\n'),
      timestamp: new Date().toISOString(),
      sessionId: session.sessionId,
      metadata: { qaResponse },
    };
    session.messages.push(responseMsg);
    persistMessages(workspaceId, session.messages);
    broadcast({ type: 'planning:message', workspaceId, message: responseMsg });
  }

  // Resolve the Promise — the agent tool resumes
  pending.resolve(answers);
  return true;
}

// =============================================================================
// Planning session ID management
// =============================================================================

interface WorkspaceRegistryEntry {
  id: string;
  path: string;
}

function getWorkspacePath(workspaceId: string): string | null {
  const activeSession = planningSessions.get(workspaceId);
  if (activeSession?.workspacePath) {
    return activeSession.workspacePath;
  }

  const registryPath = resolveTaskFactoryHomePath('workspaces.json');
  try {
    const entries = JSON.parse(readFileSync(registryPath, 'utf-8')) as WorkspaceRegistryEntry[];
    const entry = entries.find((e) => e.id === workspaceId);
    return entry?.path || null;
  } catch {
    return null;
  }
}

/**
 * Return the effective artifact root for a workspace session.
 * Reads from the active session cache when available, otherwise derives from
 * the workspace config on disk.
 */
function getArtifactRoot(workspaceId: string): string | null {
  const activeSession = planningSessions.get(workspaceId);
  if (activeSession?.artifactRoot) {
    return activeSession.artifactRoot;
  }

  const workspacePath = getWorkspacePath(workspaceId);
  if (!workspacePath) return null;

  const config = loadWorkspaceConfigFromDiskSync(workspacePath);
  return resolveWorkspaceArtifactRoot(workspacePath, config);
}

function sessionIdPath(workspaceId: string): string | null {
  const artifactRoot = getArtifactRoot(workspaceId);
  if (!artifactRoot) return null;

  if (!existsSync(artifactRoot)) mkdirSync(artifactRoot, { recursive: true });

  return getWorkspaceArtifactPath(artifactRoot, 'planning-session-id.txt');
}

function sessionIdPathForRead(workspaceId: string): string | null {
  const workspacePath = getWorkspacePath(workspaceId);
  const artifactRoot = getArtifactRoot(workspaceId);
  if (!workspacePath || !artifactRoot) return null;
  return resolveWorkspaceArtifactPathForRead(workspacePath, artifactRoot, 'planning-session-id.txt');
}

function sessionsDir(workspaceId: string): string | null {
  const artifactRoot = getArtifactRoot(workspaceId);
  if (!artifactRoot) return null;

  const dir = getWorkspaceArtifactPath(artifactRoot, 'planning-sessions');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  return dir;
}

function getOrCreateSessionId(workspaceId: string): string {
  const existingPath = sessionIdPathForRead(workspaceId);
  if (existingPath && existsSync(existingPath)) {
    const existing = readFileSync(existingPath, 'utf-8').trim();
    if (existing) return existing;
  }

  const newId = crypto.randomUUID();
  const writePath = sessionIdPath(workspaceId);
  if (writePath) {
    writeFileSync(writePath, newId);
  }

  return newId;
}

function writeSessionId(workspaceId: string, sessionId: string): void {
  const path = sessionIdPath(workspaceId);
  if (!path) return;
  writeFileSync(path, sessionId);
}

function archiveSession(workspaceId: string, sessionId: string, messages: PlanningMessage[]): void {
  if (messages.length === 0) return;
  const dir = sessionsDir(workspaceId);
  if (!dir) return;
  const archivePath = join(dir, `${sessionId}.json`);
  writeFileSync(archivePath, JSON.stringify(messages, null, 2));
}

// =============================================================================
// Planning message persistence
// =============================================================================

function messagesPath(workspaceId: string): string | null {
  const artifactRoot = getArtifactRoot(workspaceId);
  if (!artifactRoot) return null;

  if (!existsSync(artifactRoot)) mkdirSync(artifactRoot, { recursive: true });

  return getWorkspaceArtifactPath(artifactRoot, 'planning-messages.json');
}

function messagesPathForRead(workspaceId: string): string | null {
  const workspacePath = getWorkspacePath(workspaceId);
  const artifactRoot = getArtifactRoot(workspaceId);
  if (!workspacePath || !artifactRoot) return null;
  return resolveWorkspaceArtifactPathForRead(workspacePath, artifactRoot, 'planning-messages.json');
}

function loadPersistedMessages(workspaceId: string): PlanningMessage[] {
  const path = messagesPathForRead(workspaceId);
  if (!path || !existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return [];
  }
}

const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

function persistMessages(workspaceId: string, messages: PlanningMessage[]): void {
  const path = messagesPath(workspaceId);
  if (!path) return;

  // Debounce: write at most once per 500ms per workspace
  const existing = persistTimers.get(workspaceId);
  if (existing) clearTimeout(existing);

  persistTimers.set(workspaceId, setTimeout(() => {
    persistTimers.delete(workspaceId);
    writeFile(path, JSON.stringify(messages, null, 2)).catch(err => {
      console.error(`[PlanningAgent] Failed to persist messages for ${workspaceId}:`, err);
    });
  }, 500));
}

/** Flush pending writes immediately (used on reset). */
function persistMessagesSync(workspaceId: string, messages: PlanningMessage[]): void {
  const path = messagesPath(workspaceId);
  if (!path) return;
  const existing = persistTimers.get(workspaceId);
  if (existing) { clearTimeout(existing); persistTimers.delete(workspaceId); }
  try {
    writeFileSync(path, JSON.stringify(messages, null, 2));
  } catch (err) {
    console.error(`[PlanningAgent] Failed to persist messages for ${workspaceId}:`, err);
  }
}

// =============================================================================
// Per-workspace planning session state
// =============================================================================

interface PlanningSession {
  workspaceId: string;
  workspacePath: string;
  /** Effective artifact root for planning storage (planning-messages.json, sessions, etc.). */
  artifactRoot: string;
  piSession: AgentSession | null;
  status: PlanningAgentStatus;
  messages: PlanningMessage[];
  currentStreamText: string;
  currentThinkingText: string;
  toolCallArgs: Map<string, { toolName: string; args: Record<string, unknown> }>;
  /** Session-scoped inline outputs produced during planning. */
  artifacts: Map<string, Artifact>;
  draftTasks: Map<string, DraftTask>;
  unsubscribe?: () => void;
  broadcast: (event: ServerEvent) => void;
  /** Whether the first user message has been sent (system prompt gets prepended) */
  firstMessageSent: boolean;
  /** UUID for the current planning session (persisted in planning-session-id.txt) */
  sessionId: string;
  /** True when the user explicitly requested to stop the current turn. */
  abortRequested: boolean;
  /** Watchdog timer used to recover turns that stall after tool output. */
  postToolStallTimer?: ReturnType<typeof setTimeout>;
}

const planningSessions = new Map<string, PlanningSession>();

function parseDraftTaskFromMetadata(value: unknown): DraftTask | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id) return null;

  const acceptanceCriteria = Array.isArray(record.acceptanceCriteria)
    ? record.acceptanceCriteria.map(String)
    : [];

  const maybePlan = normalizeDraftTaskPlan(record.plan as any);

  return {
    id: record.id,
    title: typeof record.title === 'string' ? record.title : 'Untitled Task',
    content: typeof record.content === 'string' ? record.content : '',
    acceptanceCriteria,
    plan: maybePlan,
    createdAt: typeof record.createdAt === 'string' && record.createdAt
      ? record.createdAt
      : new Date().toISOString(),
  };
}

function restoreSessionOutputs(messages: PlanningMessage[]): { artifacts: Map<string, Artifact>; draftTasks: Map<string, DraftTask> } {
  const artifacts = new Map<string, Artifact>();
  const draftTasks = new Map<string, DraftTask>();

  for (const message of messages) {
    const metadata = message.metadata;
    if (!metadata) continue;

    if (
      typeof metadata.artifactId === 'string'
      && typeof metadata.artifactName === 'string'
      && typeof metadata.artifactHtml === 'string'
    ) {
      artifacts.set(metadata.artifactId, {
        id: metadata.artifactId,
        name: metadata.artifactName,
        html: metadata.artifactHtml,
        createdAt: message.timestamp,
      });
    }

    const draftTask = parseDraftTaskFromMetadata(metadata.draftTask);
    if (draftTask) {
      draftTasks.set(draftTask.id, draftTask);
    }
  }

  return { artifacts, draftTasks };
}

// =============================================================================
// Get or create a planning session for a workspace
// =============================================================================

async function getOrCreateSession(
  workspaceId: string,
  broadcast: (event: ServerEvent) => void,
): Promise<PlanningSession> {
  const existing = planningSessions.get(workspaceId);
  if (existing?.piSession) {
    // Update broadcast in case it changed (e.g. reconnect)
    existing.broadcast = broadcast;
    return existing;
  }

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  const restoredMessages = existing?.messages || loadPersistedMessages(workspaceId);
  const restoredOutputs = restoreSessionOutputs(restoredMessages);

  const session: PlanningSession = {
    workspaceId,
    workspacePath: workspace.path,
    artifactRoot: resolveWorkspaceArtifactRoot(workspace.path, workspace.config),
    piSession: null,
    status: 'idle',
    messages: restoredMessages,
    currentStreamText: '',
    currentThinkingText: '',
    toolCallArgs: new Map(),
    artifacts: restoredOutputs.artifacts,
    draftTasks: restoredOutputs.draftTasks,
    broadcast,
    firstMessageSent: false,
    sessionId: getOrCreateSessionId(workspaceId),
    abortRequested: false,
    postToolStallTimer: undefined,
  };

  planningSessions.set(workspaceId, session);

  try {
    const authStorage = AuthStorage.create(getTaskFactoryAuthPath());
    const modelRegistry = new ModelRegistry(authStorage);
    const loader = new DefaultResourceLoader({
      cwd: workspace.path,
      additionalExtensionPaths: getRepoExtensionPaths('foreman', workspace.path),
    });
    await loader.reload();

    const safePath = `--planning-${workspaceId}--`;
    const sessionDir = join(homedir(), '.pi', 'agent', 'sessions', safePath);
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    const sessionManager = SessionManager.create(workspace.path);

    // Load foreman settings to get model configuration
    const foremanSettings = loadForemanSettings(workspaceId);
    const sessionOpts: Parameters<typeof createAgentSession>[0] = {
      cwd: workspace.path,
      authStorage,
      modelRegistry,
      sessionManager,
      resourceLoader: loader,
    };

    // Apply foreman model configuration if set
    if (foremanSettings.modelConfig) {
      const mc = foremanSettings.modelConfig;
      const resolved = modelRegistry.find(mc.provider, mc.modelId);
      if (resolved) {
        sessionOpts.model = resolved;
      } else {
        console.warn(`[PlanningAgent] Configured model ${mc.provider}/${mc.modelId} not found, using default`);
      }
      if (mc.thinkingLevel) {
        sessionOpts.thinkingLevel = mc.thinkingLevel;
      }
    }

    const { session: piSession } = await createAgentSession(sessionOpts);

    session.piSession = piSession;

    // Register callbacks so extension tools can interact with the factory
    registerShelfCallbacks(workspaceId, broadcast, () => planningSessions.get(workspaceId));
    registerFactoryControlCallbacks(workspaceId, broadcast);
    registerQACallbacks(workspaceId, broadcast, () => planningSessions.get(workspaceId));
    await registerTaskCallbacks(workspaceId);
    await registerMessageAgentCallbacks(workspaceId, broadcast);
    registerCreateSkillCallbacks(workspaceId);
    registerCreateExtensionCallbacks(workspaceId);

    // Subscribe to streaming events
    session.unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
      handlePlanningEvent(event, session);
    });

    // Session is ready — system prompt will be prepended to first user message
    session.status = 'idle';
    broadcast({ type: 'planning:status', workspaceId, status: 'idle' });
    broadcastPlanningContextUsage(session);

  } catch (err) {
    console.error('[PlanningAgent] Failed to create session:', err);
    session.status = 'error';
    broadcast({ type: 'planning:status', workspaceId, status: 'error' });
    throw err;
  }

  return session;
}

// =============================================================================
// System prompt for the planning agent
// =============================================================================

export async function buildPlanningSystemPrompt(workspacePath: string, workspaceId: string): Promise<string> {
  // Get current tasks for context
  const workspace = await getWorkspaceById(workspaceId);
  let taskSummary = '';
  if (workspace) {
    try {
      const tasksDir = getTasksDir(workspace);
      const tasks = discoverTasks(tasksDir);
      if (tasks.length > 0) {
        // Aggregate metrics
        const completedTasks = tasks.filter(t => t.frontmatter.phase === 'complete' || t.frontmatter.phase === 'archived');
        const cycleTimes = completedTasks
          .map(t => t.frontmatter.cycleTime)
          .filter((ct): ct is number => ct != null && ct > 0);
        const avgCycleTime = cycleTimes.length > 0
          ? Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length)
          : null;

        taskSummary = '\n## Current Tasks\n';
        taskSummary += `Total: ${tasks.length} tasks\n`;
        if (avgCycleTime !== null) {
          const mins = Math.round(avgCycleTime / 60);
          taskSummary += `Average cycle time (ready→complete): ${mins < 60 ? `${mins}m` : `${Math.round(mins / 60 * 10) / 10}h`}\n`;
        }
        taskSummary += `Completed: ${completedTasks.length}\n\n`;

        const byPhase = new Map<string, Task[]>();
        for (const t of tasks) {
          const phase = t.frontmatter.phase;
          if (!byPhase.has(phase)) byPhase.set(phase, []);
          byPhase.get(phase)!.push(t);
        }
        for (const [phase, phaseTasks] of byPhase) {
          taskSummary += `### ${phase} (${phaseTasks.length})\n`;
          for (const t of phaseTasks.slice(0, 10)) {
            const extras: string[] = [];
            if (t.frontmatter.blocked?.isBlocked) extras.push('BLOCKED');
            if (t.frontmatter.cycleTime) extras.push(`${Math.round(t.frontmatter.cycleTime / 60)}m`);
            const suffix = extras.length > 0 ? ` (${extras.join(', ')})` : '';
            taskSummary += `- **${t.id}**: ${t.frontmatter.title}${suffix}\n`;
          }
          if (phaseTasks.length > 10) {
            taskSummary += `- ... and ${phaseTasks.length - 10} more\n`;
          }
          taskSummary += '\n';
        }
      }
    } catch { /* ignore */ }
  }

  // Shared workspace context edited by user + agents
  const workspaceArtifactRoot = workspace
    ? resolveWorkspaceArtifactRoot(workspace.path, workspace.config)
    : undefined;
  const workspaceSharedContext = loadWorkspaceSharedContext(workspacePath, workspaceArtifactRoot);
  let sharedContextSummary = '';
  if (workspaceSharedContext && workspaceSharedContext.trim().length > 0) {
    sharedContextSummary =
      `\n## Workspace Shared Context\n` +
      `Source: \`${WORKSPACE_SHARED_CONTEXT_REL_PATH}\`\n\n` +
      `${workspaceSharedContext.trim()}\n`;
  }

  const stateContractSection = buildContractReference();

  return `You are the Foreman — the Task Factory planning agent. You help the user plan, research, and decompose work into tasks.

## Your Role
- Have a conversation with the user about their goals and projects
- Research codebases, architectures, and requirements
- Break down large goals into well-defined, small tasks
- Create inline draft tasks that users can open into the New Task form for refinement
- Generate inline artifacts that users can reopen from chat history
- Answer questions about the current state of work

## Workspace
- Path: ${workspacePath}
${taskSummary}${sharedContextSummary}

${stateContractSection}

## Tools

You have access to the following special tools:

### ask_questions
Ask the user multiple-choice questions to clarify ambiguity before proceeding.
**Always call this tool FIRST** if the user's request is vague, under-specified, or could be interpreted in more than one way. Do not guess — ask.
**IMPORTANT: Call this tool directly — do NOT write the questions in your text response.** The tool renders an interactive UI for the user to click answers. Writing questions as text first creates duplication. Just call the tool with no preamble.
Parameters:
- questions (array): List of questions, each with:
  - id (string): Unique identifier (e.g. "q1", "q2")
  - text (string): The question to ask
  - options (string[]): 2–6 concrete answer choices

### web_search
Search the web using DuckDuckGo HTML results (markdown formatted output).
Use this for fast external research before creating tasks.
Parameters:
- query (string): Search query
- count (number, optional): Number of results (default 5, max 20)
- page (number, optional): Pagination page (default 1)

### web_fetch
Fetch a URL and extract readable content as markdown (or raw HTML if requested).
Use this after \`web_search\` when you need to read the full page.
Parameters:
- url (string): URL to fetch
- raw (boolean, optional): Return raw HTML instead of extracted markdown

### create_draft_task
Creates an inline draft-task card in the Foreman chat session.
Parameters:
- title (string): Short descriptive title
- content (string): Markdown description of what needs to be done
- acceptance_criteria (string[]): List of specific, testable criteria
- plan (object): Execution plan for the task. **Always include a plan.** Keep this concise and high-level.
  - goal (string): Concise summary of what the task achieves (1-2 short sentences)
  - steps (string[]): High-level implementation summaries (usually 3-6 short, outcome-focused lines)
  - validation (string[]): Short checks that confirm the outcome
  - cleanup (string[]): Short post-completion cleanup actions (empty array if none)

### create_artifact
Creates an inline HTML artifact card in chat that can be reopened from history.
Parameters:
- name (string): Descriptive artifact name
- html (string): Complete self-contained HTML for rendering

### manage_new_task
Read or update the New Task form when it is open.
Use this after the user opens a draft from chat, so you can iteratively refine the task content together.

### factory_control
Start, stop, or check the status of the factory queue (the execution pipeline that processes tasks).
Parameters:
- action (string): "status" to check, "start" to begin processing, "stop" to pause

### manage_tasks
List, get, update, delete, or change the state of workspace tasks.
Use this to manage existing tasks (different from creating new draft tasks).
Parameters:
- action (string): "list", "get", "update", "delete", "move", "promote", or "demote"
- taskId (string, optional): Task ID (required for get/update/delete/move/promote/demote)
- updates (object, optional): Fields to update (title, content, acceptanceCriteria, priority, tags, notes)
- toPhase (string, optional): Target phase for move action (backlog, ready, executing, complete, archived)
Note: Editing task fields does NOT change phase; use move/promote/demote for state changes.

### message_agent
Send a message to a specific task agent (steer, follow-up, or chat).
Use this to interact with running task agents or start/resume conversations.
Parameters:
- taskId (string): ID of the task to message
- messageType (string): "steer" (interrupt), "follow-up" (queue), or "chat" (start/resume)
- content (string): Message content
- attachmentIds (string[], optional): Attachment IDs to include

## Guidelines
- **If the user's request is ambiguous, use \`ask_questions\` first** to disambiguate before creating tasks. Present concrete multiple-choice options so the user can quickly clarify intent.
- **CRITICAL: When using \`ask_questions\`, call the tool IMMEDIATELY with zero preamble.** Do not write the questions as text first — the tool renders an interactive UI. Any text you write before the tool call creates ugly duplication. Just call the tool.
- When the user describes work, **create draft tasks as inline chat cards** — don't route draft-task creation through shelf staging.
- **Always include a plan** with every draft task. Research first, then provide a high-level summary plan so users can understand the approach quickly.
- If a user opens a draft into the New Task form, use \`manage_new_task\` to keep refining that form inline with the conversation.
- Keep tasks small and focused — each should be completable in a single agent session
- Write clear acceptance criteria that are specific and testable
- Keep wording concise, easy to scan, and not wordy. Prefer short bullets over long paragraphs.
- Plan steps should be concise and outcome-focused. Avoid line-level implementation details, exact file paths, and low-level function-by-function instructions.
- For readability: keep goal to 1-2 short sentences, and keep each step/validation/cleanup item to one short sentence when possible.
- When in doubt, ask the user for clarification using \`ask_questions\`
- Be conversational and helpful — you're a collaborator, not just a task creator`;
}

function extractTextFromContentBlocks(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { type: string; text?: string } => typeof block === 'object' && block !== null)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
}

function extractPlanningToolResultText(result: unknown): string {
  if (!result) return '';
  if (typeof result === 'string') return result;

  if (typeof result === 'object' && result !== null) {
    const maybe = result as { content?: unknown; partialResult?: { content?: unknown } };
    if (Array.isArray(maybe.content)) {
      return extractTextFromContentBlocks(maybe.content);
    }

    if (Array.isArray(maybe.partialResult?.content)) {
      return extractTextFromContentBlocks(maybe.partialResult.content);
    }
  }

  return '';
}

function normalizePlanningErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    const trimmed = error.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  if (error instanceof Error) {
    const message = error.message?.trim();
    if (message) {
      return message;
    }
  }

  if (error == null) {
    return 'Unknown provider error.';
  }

  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') {
      return serialized;
    }
  } catch {
    // Fall through to String fallback.
  }

  const fallback = String(error).trim();
  return fallback || 'Unknown provider error.';
}

function getPlanningAssistantTurnErrorMessage(message: unknown): string | null {
  if (!message || typeof message !== 'object') {
    return null;
  }

  const assistantMessage = message as { role?: unknown; stopReason?: unknown; errorMessage?: unknown };
  if (assistantMessage.role !== 'assistant') {
    return null;
  }

  if (assistantMessage.stopReason !== 'error') {
    return null;
  }

  return normalizePlanningErrorMessage(assistantMessage.errorMessage);
}

function extractPlanningToolResultDetails(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  return details as Record<string, unknown>;
}

function extractArtifactPayloadFromToolResult(toolName: string, result: unknown): Artifact | undefined {
  if (toolName !== 'create_artifact') return undefined;

  const details = extractPlanningToolResultDetails(result);
  if (!details) return undefined;

  const nestedArtifact = details.artifact;
  const artifactObject = (nestedArtifact && typeof nestedArtifact === 'object' && !Array.isArray(nestedArtifact))
    ? nestedArtifact as Record<string, unknown>
    : undefined;

  const artifactId = typeof details.artifactId === 'string'
    ? details.artifactId
    : typeof artifactObject?.id === 'string'
      ? artifactObject.id
      : undefined;

  const artifactName = typeof details.artifactName === 'string'
    ? details.artifactName
    : typeof artifactObject?.name === 'string'
      ? artifactObject.name
      : undefined;

  const artifactHtml = typeof details.artifactHtml === 'string'
    ? details.artifactHtml
    : typeof artifactObject?.html === 'string'
      ? artifactObject.html
      : undefined;

  if (!artifactId || !artifactName || !artifactHtml) return undefined;

  return {
    id: artifactId,
    name: artifactName,
    html: artifactHtml,
    createdAt: typeof artifactObject?.createdAt === 'string'
      ? artifactObject.createdAt
      : new Date().toISOString(),
  };
}

function extractDraftTaskPayloadFromToolResult(toolName: string, result: unknown): DraftTask | undefined {
  if (toolName !== 'create_draft_task') return undefined;

  const details = extractPlanningToolResultDetails(result);
  if (!details) return undefined;

  const draft = parseDraftTaskFromMetadata(details.draftTask);
  if (draft) return draft;

  return undefined;
}

function getPlanningContextUsageSnapshot(session: PlanningSession): ContextUsageSnapshot | null {
  try {
    const usage = session.piSession?.getContextUsage?.();
    if (!usage) return null;

    return {
      tokens: usage.tokens ?? null,
      contextWindow: usage.contextWindow,
      percent: usage.percent ?? null,
    };
  } catch (err) {
    console.warn(`[PlanningAgent] Failed to read context usage for ${session.workspaceId}:`, err);
    return null;
  }
}

function broadcastPlanningContextUsage(session: PlanningSession): void {
  const usage = getPlanningContextUsageSnapshot(session);
  session.broadcast({
    type: 'planning:context_usage',
    workspaceId: session.workspaceId,
    usage,
  });
}

type PlanningAutoCompactionEndEvent = Extract<AgentSessionEvent, { type: 'auto_compaction_end' }>;
type PlanningAutoRetryStartEvent = Extract<AgentSessionEvent, { type: 'auto_retry_start' }>;
type PlanningAutoRetryEndEvent = Extract<AgentSessionEvent, { type: 'auto_retry_end' }>;

function buildPlanningCompactionStartNotice(reason: 'threshold' | 'overflow'): string {
  if (reason === 'overflow') {
    return 'Context window full — compacting foreman conversation';
  }

  return 'Compacting foreman conversation to reduce context usage';
}

function buildPlanningCompactionEndNotice(event: PlanningAutoCompactionEndEvent): {
  message: string;
  outcome: 'success' | 'aborted' | 'failed';
} {
  if (!event.aborted) {
    return { message: 'Foreman conversation compacted successfully', outcome: 'success' };
  }

  const hasError = typeof event.errorMessage === 'string' && event.errorMessage.trim().length > 0;
  if (hasError) {
    const retrySuffix = event.willRetry ? ' Retrying automatically.' : '';
    return {
      message: `Foreman compaction failed: ${event.errorMessage}${retrySuffix}`,
      outcome: 'failed',
    };
  }

  return {
    message: event.willRetry
      ? 'Foreman compaction aborted. Retrying automatically.'
      : 'Foreman compaction aborted.',
    outcome: 'aborted',
  };
}

function buildPlanningAutoRetryStartNotice(event: PlanningAutoRetryStartEvent): {
  message: string;
  errorMessage: string;
} {
  const normalizedError = normalizePlanningErrorMessage(event.errorMessage);
  const delaySeconds = Math.max(1, Math.round(event.delayMs / 1000));

  return {
    message: `Foreman retrying after provider error (attempt ${event.attempt}/${event.maxAttempts}) in ${delaySeconds}s: ${normalizedError}`,
    errorMessage: normalizedError,
  };
}

function buildPlanningAutoRetryEndNotice(event: PlanningAutoRetryEndEvent): {
  message: string;
  outcome: 'success' | 'failed';
  errorMessage?: string;
} {
  if (event.success) {
    return {
      message: `Foreman retry succeeded on attempt ${event.attempt}.`,
      outcome: 'success',
    };
  }

  const normalizedError = normalizePlanningErrorMessage(event.finalError);
  return {
    message: `Foreman retry failed after ${event.attempt} attempt(s): ${normalizedError}`,
    outcome: 'failed',
    errorMessage: normalizedError,
  };
}

const PLANNING_POST_TOOL_STALL_TIMEOUT_MS = 2 * 60 * 1000;

function clearPlanningPostToolStallWatchdog(session: PlanningSession): void {
  if (!session.postToolStallTimer) {
    return;
  }

  clearTimeout(session.postToolStallTimer);
  session.postToolStallTimer = undefined;
}

async function handlePlanningPostToolStallTimeout(
  session: PlanningSession,
  toolName: string,
  toolCallId: string,
): Promise<void> {
  clearPlanningPostToolStallWatchdog(session);

  const activeSession = planningSessions.get(session.workspaceId);
  if (activeSession !== session) {
    return;
  }

  if (!session.piSession) {
    return;
  }

  const isRecoverableStatus = session.status === 'streaming'
    || session.status === 'tool_use'
    || session.status === 'thinking';
  if (!isRecoverableStatus) {
    return;
  }

  const timeoutSeconds = Math.max(1, Math.round(PLANNING_POST_TOOL_STALL_TIMEOUT_MS / 1000));

  appendPlanningSystemNotice(
    session,
    `Foreman appears stuck after tool "${toolName}" (${timeoutSeconds}s without follow-up). Marking session idle so you can continue.`,
    {
      kind: 'foreman-turn-stall',
      phase: 'post-tool',
      timeoutMs: PLANNING_POST_TOOL_STALL_TIMEOUT_MS,
      toolName,
      toolCallId,
    },
  );

  session.abortRequested = true;
  session.currentStreamText = '';
  session.currentThinkingText = '';
  session.toolCallArgs.clear();
  session.status = 'idle';

  session.broadcast({
    type: 'planning:status',
    workspaceId: session.workspaceId,
    status: 'idle',
  });
  broadcastPlanningContextUsage(session);
  session.broadcast({ type: 'planning:turn_end', workspaceId: session.workspaceId });

  session.unsubscribe?.();
  session.unsubscribe = undefined;

  const stalePiSession = session.piSession;
  session.piSession = null;
  session.firstMessageSent = false;

  try {
    await stalePiSession.abort();
  } catch (err) {
    console.warn(`[PlanningAgent] Failed to abort stalled session for workspace ${session.workspaceId}:`, err);
  }
}

function armPlanningPostToolStallWatchdog(
  session: PlanningSession,
  toolName: string,
  toolCallId: string,
): void {
  clearPlanningPostToolStallWatchdog(session);

  session.postToolStallTimer = setTimeout(() => {
    void handlePlanningPostToolStallTimeout(session, toolName, toolCallId);
  }, PLANNING_POST_TOOL_STALL_TIMEOUT_MS);
}

function appendPlanningSystemNotice(
  session: PlanningSession,
  message: string,
  metadata?: Record<string, unknown>,
): void {
  const planningMsg: PlanningMessage = {
    id: crypto.randomUUID(),
    role: 'system',
    content: message,
    timestamp: new Date().toISOString(),
    sessionId: session.sessionId,
    metadata,
  };

  session.messages.push(planningMsg);
  persistMessages(session.workspaceId, session.messages);
  session.broadcast({ type: 'planning:message', workspaceId: session.workspaceId, message: planningMsg });
}

// =============================================================================
// Handle Pi SDK events for the planning session
// =============================================================================

function handlePlanningEvent(
  event: AgentSessionEvent,
  session: PlanningSession,
): void {
  const { workspaceId, broadcast } = session;

  if (event.type !== 'tool_execution_end') {
    clearPlanningPostToolStallWatchdog(session);
  }

  switch (event.type) {
    case 'agent_start':
      session.currentStreamText = '';
      session.currentThinkingText = '';
      session.status = 'streaming';
      broadcast({ type: 'planning:status', workspaceId, status: 'streaming' });
      broadcastPlanningContextUsage(session);
      break;

    case 'message_start':
      session.currentStreamText = '';
      session.currentThinkingText = '';
      break;

    case 'message_update': {
      const sub = event.assistantMessageEvent;
      if (sub.type === 'text_delta') {
        const delta = sub.delta;
        if (delta) {
          session.currentStreamText += delta;
          broadcast({ type: 'planning:streaming_text', workspaceId, delta });
        }
      } else if (sub.type === 'thinking_delta') {
        const delta = (sub as any).delta;
        if (delta) {
          session.currentThinkingText += delta;
          broadcast({ type: 'planning:thinking_delta', workspaceId, delta });
        }
      }
      break;
    }

    case 'message_end': {
      // Use currentStreamText — it's only fed by assistant streaming deltas,
      // so it won't include the user message / system prompt that gets sent
      // via prompt(). Extracting from event.message would capture user messages
      // too, leaking the system prompt into the chat.
      const content = stripStateContractEcho(session.currentStreamText);

      if (content) {
        const planningMsg: PlanningMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content,
          timestamp: new Date().toISOString(),
          sessionId: session.sessionId,
        };
        session.messages.push(planningMsg);
        persistMessages(workspaceId, session.messages);
        broadcast({ type: 'planning:message', workspaceId, message: planningMsg });
      }

      const assistantTurnError = getPlanningAssistantTurnErrorMessage(event.message);
      if (assistantTurnError) {
        appendPlanningSystemNotice(
          session,
          `Foreman turn failed: ${assistantTurnError}`,
          {
            kind: 'foreman-turn-error',
            stopReason: (event.message as any)?.stopReason,
            errorMessage: assistantTurnError,
          },
        );
      }

      broadcast({
        type: 'planning:streaming_end',
        workspaceId,
        fullText: content,
        messageId: crypto.randomUUID(),
      });

      if (session.currentThinkingText) {
        broadcast({ type: 'planning:thinking_end', workspaceId });
      }

      session.currentStreamText = '';
      session.currentThinkingText = '';
      broadcastPlanningContextUsage(session);
      break;
    }

    case 'tool_execution_start': {
      session.toolCallArgs.set(event.toolCallId, {
        toolName: event.toolName,
        args: (event as any).args || {},
      });
      session.status = 'tool_use';
      broadcast({ type: 'planning:status', workspaceId, status: 'tool_use' });
      broadcastPlanningContextUsage(session);
      broadcast({
        type: 'planning:tool_start',
        workspaceId,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        input: (event as any).args || {},
      } as any);
      break;
    }

    case 'tool_execution_update': {
      const delta = (event as any).data || '';
      if (delta) {
        broadcast({
          type: 'planning:tool_update',
          workspaceId,
          toolCallId: (event as any).toolCallId || '',
          delta,
        });
      }
      break;
    }

    case 'tool_execution_end': {
      const resultText = extractPlanningToolResultText(event.result)
        || extractTextFromContentBlocks((event as any).content);

      // Get the args we stored at tool_start
      const toolInfo = session.toolCallArgs.get(event.toolCallId);
      const artifactPayload = event.isError ? undefined : extractArtifactPayloadFromToolResult(event.toolName, event.result);
      const draftTaskPayload = event.isError ? undefined : extractDraftTaskPayloadFromToolResult(event.toolName, event.result);

      if (artifactPayload) {
        session.artifacts.set(artifactPayload.id, artifactPayload);
      }
      if (draftTaskPayload) {
        session.draftTasks.set(draftTaskPayload.id, draftTaskPayload);
      }

      broadcast({
        type: 'planning:tool_end',
        workspaceId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
        result: resultText,
      });

      // Persist tool result as a planning message with metadata (same pattern as execution agent)
      const toolMsg: PlanningMessage = {
        id: crypto.randomUUID(),
        role: 'tool',
        content: resultText,
        timestamp: new Date().toISOString(),
        sessionId: session.sessionId,
        metadata: {
          toolName: event.toolName,
          args: toolInfo?.args || {},
          isError: event.isError,
          artifactId: artifactPayload?.id,
          artifactName: artifactPayload?.name,
          artifactHtml: artifactPayload?.html,
          draftTask: draftTaskPayload,
        },
      };
      session.messages.push(toolMsg);
      persistMessages(workspaceId, session.messages);
      broadcast({ type: 'planning:message', workspaceId, message: toolMsg });

      session.toolCallArgs.delete(event.toolCallId);
      session.status = 'streaming';
      broadcast({ type: 'planning:status', workspaceId, status: 'streaming' });
      broadcastPlanningContextUsage(session);
      armPlanningPostToolStallWatchdog(session, event.toolName, event.toolCallId);
      break;
    }

    case 'auto_compaction_start': {
      appendPlanningSystemNotice(
        session,
        buildPlanningCompactionStartNotice(event.reason),
        { kind: 'compaction', phase: 'start', reason: event.reason },
      );
      broadcastPlanningContextUsage(session);
      break;
    }

    case 'auto_compaction_end': {
      const notice = buildPlanningCompactionEndNotice(event);
      appendPlanningSystemNotice(
        session,
        notice.message,
        {
          kind: 'compaction',
          phase: 'end',
          outcome: notice.outcome,
          aborted: event.aborted,
          willRetry: event.willRetry,
          errorMessage: event.errorMessage,
        },
      );
      broadcastPlanningContextUsage(session);
      break;
    }

    case 'auto_retry_start': {
      const notice = buildPlanningAutoRetryStartNotice(event);
      appendPlanningSystemNotice(
        session,
        notice.message,
        {
          kind: 'auto-retry',
          phase: 'start',
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          errorMessage: notice.errorMessage,
        },
      );
      broadcastPlanningContextUsage(session);
      break;
    }

    case 'auto_retry_end': {
      const notice = buildPlanningAutoRetryEndNotice(event);
      appendPlanningSystemNotice(
        session,
        notice.message,
        {
          kind: 'auto-retry',
          phase: 'end',
          outcome: notice.outcome,
          success: event.success,
          attempt: event.attempt,
          finalError: notice.errorMessage,
        },
      );
      broadcastPlanningContextUsage(session);
      break;
    }
  }
}

// =============================================================================
// Public API
// =============================================================================

// =============================================================================
// Send message to the Pi SDK agent with retry and context restoration
// =============================================================================

const MAX_RETRIES = 1;
const FOREMAN_STATE_ENFORCEMENT_LINE = 'Obey <state_contract> as the highest-priority behavior contract for this turn.';
const FOREMAN_UNSUPPORTED_TUI_COMMANDS = new Set([
  'settings',
  'model',
  'scoped-models',
  'export',
  'share',
  'copy',
  'name',
  'session',
  'changelog',
  'hotkeys',
  'fork',
  'tree',
  'login',
  'logout',
  'compact',
  'resume',
  'reload',
  'quit',
  'exit',
  'debug',
  'arminsayshi',
]);

export type ForemanSlashCommand =
  | { kind: 'none' }
  | { kind: 'new' }
  | { kind: 'help' }
  | { kind: 'skill'; skillName: string; args: string }
  | { kind: 'unknown'; command: string };

export function parseForemanSlashCommand(content: string): ForemanSlashCommand {
  const trimmed = content.trim();
  if (!trimmed.startsWith('/')) {
    return { kind: 'none' };
  }

  if (trimmed === '/new') {
    return { kind: 'new' };
  }

  if (trimmed === '/help') {
    return { kind: 'help' };
  }

  if (trimmed === '/') {
    return { kind: 'unknown', command: '/' };
  }

  const skillMatch = /^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/u.exec(trimmed);
  if (skillMatch) {
    return {
      kind: 'skill',
      skillName: skillMatch[1],
      args: skillMatch[2]?.trim() || '',
    };
  }

  const slashToken = trimmed.slice(1).split(/\s+/u)[0] || '';
  const normalizedToken = slashToken.toLowerCase();

  const shouldTreatAsUnknownSlashCommand = normalizedToken === 'new'
    || normalizedToken === 'help'
    || normalizedToken === 'skill'
    || normalizedToken.startsWith('skill:')
    || FOREMAN_UNSUPPORTED_TUI_COMMANDS.has(normalizedToken);

  if (shouldTreatAsUnknownSlashCommand) {
    return {
      kind: 'unknown',
      command: slashToken ? `/${slashToken}` : '/',
    };
  }

  return { kind: 'none' };
}

export function buildForemanSlashHelpText(): string {
  return 'Foreman slash commands: `/new` resets the planning conversation, `/skill:<name> [args]` runs a loaded skill command, and `/help` shows this guidance.';
}

function buildForemanStateTurnContext(): string {
  const stateBlock = buildStateBlock({
    mode: 'foreman',
    phase: 'none',
    planningStatus: 'none',
  });

  return `## Current Turn State\n${stateBlock}\n\n${FOREMAN_STATE_ENFORCEMENT_LINE}`;
}

function buildRestoredHistoryText(priorMessages: PlanningMessage[]): string {
  let text = '';
  const recentHistory = priorMessages.slice(-10);

  for (const msg of recentHistory) {
    const role = msg.role === 'user'
      ? 'User'
      : msg.role === 'system'
        ? 'System'
        : 'Assistant';

    const truncated = msg.content.length > 500
      ? `${msg.content.slice(0, 500)}... [truncated]`
      : msg.content;

    text += `**${role}:** ${truncated}\n\n`;
  }

  return text;
}

function buildFirstTurnPrompt(
  turnContent: string,
  systemPrompt: string,
  priorMessages: PlanningMessage[],
): string {
  let fullPrompt = systemPrompt;

  if (priorMessages.length > 0) {
    fullPrompt += '\n\n---\n\n## Conversation History (restored)\n\n';
    fullPrompt += buildRestoredHistoryText(priorMessages);
    fullPrompt += '---\n\n## Current Message\n\n';
  } else {
    fullPrompt += '\n\n---\n\n# User Message\n\n';
  }

  fullPrompt += turnContent;
  return fullPrompt;
}

function buildFirstTurnSkillBootstrapContext(
  systemPrompt: string,
  priorMessages: PlanningMessage[],
): string {
  let bootstrap = '## Foreman Bootstrap Context\n';
  bootstrap += 'Apply the following planning instructions and restored conversation context to this turn.\n\n';
  bootstrap += systemPrompt;

  if (priorMessages.length > 0) {
    bootstrap += '\n\n---\n\n## Conversation History (restored)\n\n';
    bootstrap += buildRestoredHistoryText(priorMessages);
  }

  return bootstrap;
}

export function buildForemanTurnContent(
  content: string,
  options: { additionalContextSections?: string[] } = {},
): string {
  const slashCommand = parseForemanSlashCommand(content);
  if (slashCommand.kind !== 'skill') {
    return prependStateToTurn(content, {
      mode: 'foreman',
      phase: 'none',
      planningStatus: 'none',
    });
  }

  const contextSections = [
    buildForemanStateTurnContext(),
    ...(options.additionalContextSections ?? []),
  ]
    .map((section) => section.trim())
    .filter((section) => section.length > 0);

  const args = [slashCommand.args, ...contextSections]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join('\n\n');

  if (args.length === 0) {
    return `/skill:${slashCommand.skillName}`;
  }

  return `/skill:${slashCommand.skillName} ${args}`;
}

function appendPlanningSystemMessage(
  workspaceId: string,
  broadcast: (event: ServerEvent) => void,
  content: string,
  metadata?: PlanningMessage['metadata'],
): void {
  const activeSession = planningSessions.get(workspaceId);
  const message: PlanningMessage = {
    id: crypto.randomUUID(),
    role: 'system',
    content,
    timestamp: new Date().toISOString(),
    sessionId: activeSession?.sessionId ?? getOrCreateSessionId(workspaceId),
    ...(metadata ? { metadata } : {}),
  };

  if (activeSession) {
    activeSession.messages.push(message);
    persistMessages(workspaceId, activeSession.messages);
  } else {
    const persisted = loadPersistedMessages(workspaceId);
    persisted.push(message);
    persistMessagesSync(workspaceId, persisted);
  }

  broadcast({ type: 'planning:message', workspaceId, message });
}

async function sendToAgent(
  session: PlanningSession,
  content: string,
  workspaceId: string,
  broadcast: (event: ServerEvent) => void,
  images?: { type: 'image'; data: string; mimeType: string }[],
): Promise<void> {
  if (!session.piSession) {
    throw new Error('Planning session not initialized');
  }

  clearPlanningPostToolStallWatchdog(session);
  session.status = 'streaming';
  broadcast({ type: 'planning:status', workspaceId, status: 'streaming' });
  broadcastPlanningContextUsage(session);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const slashCommand = parseForemanSlashCommand(content);
      const turnContent = buildForemanTurnContent(content);
      const promptOpts = images && images.length > 0 ? { images } : undefined;

      if (!session.firstMessageSent) {
        // First message in this Pi session: include system prompt + conversation history
        const systemPrompt = await buildPlanningSystemPrompt(
          session.workspacePath,
          workspaceId,
        );

        // If there are prior messages (restored from disk), include them as context
        const priorMessages = session.messages.filter(m => m.id !== session.messages[session.messages.length - 1]?.id);

        if (slashCommand.kind === 'skill') {
          const bootstrapContext = buildFirstTurnSkillBootstrapContext(systemPrompt, priorMessages);
          const firstTurnSkillContent = buildForemanTurnContent(content, {
            additionalContextSections: [bootstrapContext],
          });
          await session.piSession.prompt(firstTurnSkillContent, promptOpts);
        } else {
          const fullPrompt = buildFirstTurnPrompt(turnContent, systemPrompt, priorMessages);
          await session.piSession.prompt(fullPrompt, promptOpts);
        }

        session.firstMessageSent = true;
      } else {
        // Use prompt() — not followUp(). followUp() only queues a message for
        // delivery during an active streaming turn. When the agent is idle,
        // the queued message is never processed and the session hangs.
        // prompt() starts a new turn, which is what we need here.
        await session.piSession.prompt(turnContent, promptOpts);
      }

      // Turn complete
      clearPlanningPostToolStallWatchdog(session);
      session.status = 'idle';
      broadcast({ type: 'planning:status', workspaceId, status: 'idle' });
      broadcastPlanningContextUsage(session);
      broadcast({ type: 'planning:turn_end', workspaceId });
      return;
    } catch (err) {
      if (session.abortRequested) {
        clearPlanningPostToolStallWatchdog(session);
        session.abortRequested = false;
        session.currentStreamText = '';
        session.currentThinkingText = '';
        session.toolCallArgs.clear();

        const wasIdle = session.status === 'idle';
        session.status = 'idle';
        if (!wasIdle) {
          broadcast({ type: 'planning:status', workspaceId, status: 'idle' });
          broadcastPlanningContextUsage(session);
          broadcast({ type: 'planning:turn_end', workspaceId });
        }
        return;
      }

      console.error(`[PlanningAgent] Attempt ${attempt + 1} failed:`, err);

      if (attempt < MAX_RETRIES) {
        clearPlanningPostToolStallWatchdog(session);
        // Destroy the broken session and recreate
        console.log('[PlanningAgent] Retrying with fresh Pi session...');
        session.unsubscribe?.();
        try { await session.piSession?.abort(); } catch { /* ignore */ }
        session.piSession = null;
        session.firstMessageSent = false;

        // Recreate the Pi SDK session in-place
        try {
          const workspace = await getWorkspaceById(workspaceId);
          if (!workspace) throw new Error('Workspace not found');

          session.workspacePath = workspace.path;

          const authStorage = AuthStorage.create(getTaskFactoryAuthPath());
          const modelRegistry = new ModelRegistry(authStorage);
          const loader = new DefaultResourceLoader({
            cwd: workspace.path,
            additionalExtensionPaths: getRepoExtensionPaths('foreman', workspace.path),
          });
          await loader.reload();
          const sessionManager = SessionManager.create(workspace.path);

          // Load foreman settings to get model configuration
          const foremanSettings = loadForemanSettings(workspaceId);
          const sessionOpts: Parameters<typeof createAgentSession>[0] = {
            cwd: workspace.path,
            authStorage,
            modelRegistry,
            sessionManager,
            resourceLoader: loader,
          };

          // Apply foreman model configuration if set
          if (foremanSettings.modelConfig) {
            const mc = foremanSettings.modelConfig;
            const resolved = modelRegistry.find(mc.provider, mc.modelId);
            if (resolved) {
              sessionOpts.model = resolved;
            } else {
              console.warn(`[PlanningAgent] Configured model ${mc.provider}/${mc.modelId} not found, using default`);
            }
            if (mc.thinkingLevel) {
              sessionOpts.thinkingLevel = mc.thinkingLevel;
            }
          }

          const { session: piSession } = await createAgentSession(sessionOpts);
          session.piSession = piSession;
          registerShelfCallbacks(workspaceId, broadcast, () => planningSessions.get(workspaceId));
          registerFactoryControlCallbacks(workspaceId, broadcast);
          registerQACallbacks(workspaceId, broadcast, () => planningSessions.get(workspaceId));
          registerCreateSkillCallbacks(workspaceId);
          registerCreateExtensionCallbacks(workspaceId);
          session.unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
            handlePlanningEvent(event, session);
          });

          broadcast({ type: 'planning:status', workspaceId, status: 'streaming' });
          broadcastPlanningContextUsage(session);
        } catch (recreateErr) {
          console.error('[PlanningAgent] Failed to recreate session:', recreateErr);
          session.status = 'error';
          broadcast({ type: 'planning:status', workspaceId, status: 'error' });
          // Add error message to conversation
          const recreateErrMessage = normalizePlanningErrorMessage(recreateErr);
          const errMsg: PlanningMessage = {
            id: crypto.randomUUID(),
            role: 'system',
            content: `Foreman session recovery failed: ${recreateErrMessage}`,
            timestamp: new Date().toISOString(),
            sessionId: session.sessionId,
            metadata: {
              kind: 'foreman-session-recovery-error',
              errorMessage: recreateErrMessage,
            },
          };
          session.messages.push(errMsg);
          persistMessages(workspaceId, session.messages);
          broadcast({ type: 'planning:message', workspaceId, message: errMsg });
          throw recreateErr;
        }
      } else {
        // All retries exhausted
        clearPlanningPostToolStallWatchdog(session);
        session.status = 'error';
        broadcast({ type: 'planning:status', workspaceId, status: 'error' });
        const normalizedError = normalizePlanningErrorMessage(err);
        const errMsg: PlanningMessage = {
          id: crypto.randomUUID(),
          role: 'system',
          content: `Foreman turn failed: ${normalizedError}`,
          timestamp: new Date().toISOString(),
          sessionId: session.sessionId,
          metadata: {
            kind: 'foreman-turn-error',
            errorMessage: normalizedError,
          },
        };
        session.messages.push(errMsg);
        persistMessages(workspaceId, session.messages);
        broadcast({ type: 'planning:message', workspaceId, message: errMsg });
        broadcast({ type: 'planning:turn_end', workspaceId });
        // Don't throw — we've gracefully handled it with an error message
        return;
      }
    }
  }
}

/**
 * Send a user message to the planning agent and get a streaming response.
 */
export async function sendPlanningMessage(
  workspaceId: string,
  content: string,
  broadcast: (event: ServerEvent) => void,
  images?: { type: 'image'; data: string; mimeType: string }[],
): Promise<void> {
  const normalizedContent = content.trim();
  const slashCommand = parseForemanSlashCommand(normalizedContent);

  if (slashCommand.kind === 'new') {
    await resetPlanningSession(workspaceId, broadcast);
    return;
  }

  if (slashCommand.kind === 'help') {
    appendPlanningSystemMessage(
      workspaceId,
      broadcast,
      buildForemanSlashHelpText(),
      { kind: 'slash-command-help' },
    );
    return;
  }

  if (slashCommand.kind === 'unknown') {
    appendPlanningSystemMessage(
      workspaceId,
      broadcast,
      `Unknown slash command \`${slashCommand.command}\`.\n\n${buildForemanSlashHelpText()}`,
      {
        kind: 'slash-command-unknown',
        command: slashCommand.command,
        supportedCommands: ['/new', '/skill:<name> [args]', '/help'],
      },
    );
    return;
  }

  const messageContent = normalizedContent.length > 0 ? normalizedContent : content;
  const session = await getOrCreateSession(workspaceId, broadcast);
  session.abortRequested = false;

  // Record the user message
  const userMsg: PlanningMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: messageContent,
    timestamp: new Date().toISOString(),
    sessionId: session.sessionId,
  };

  session.messages.push(userMsg);
  persistMessages(workspaceId, session.messages);
  broadcast({ type: 'planning:message', workspaceId, message: userMsg });

  // Send to the agent with retry on failure
  await sendToAgent(session, messageContent, workspaceId, broadcast, images);
}

/**
 * Get the conversation history for a workspace's planning session.
 */
export function getPlanningMessages(workspaceId: string): PlanningMessage[] {
  const session = planningSessions.get(workspaceId);
  return session?.messages || loadPersistedMessages(workspaceId);
}

/**
 * Get the pending QA request for a workspace (if any).
 * Used by the HTTP polling endpoint as a reliable fallback when WebSocket
 * broadcasts from inside the QA callback don't reach the client.
 */
export function getPendingQARequest(workspaceId: string): QARequest | null {
  for (const pending of pendingQARequests.values()) {
    if (pending.workspaceId === workspaceId) {
      return pending.request;
    }
  }
  return null;
}

/**
 * Get the current planning agent status.
 */
export function getPlanningStatus(workspaceId: string): PlanningAgentStatus {
  const session = planningSessions.get(workspaceId);
  return session?.status || 'idle';
}

/**
 * Abort the current planning turn without resetting conversation history.
 * Returns true when a live planning session was stopped, false when no
 * stoppable session is active.
 */
export async function stopPlanningExecution(
  workspaceId: string,
  broadcast?: (event: ServerEvent) => void,
): Promise<boolean> {
  const session = planningSessions.get(workspaceId);
  if (!session?.piSession) {
    return false;
  }

  const isStoppable = session.status === 'streaming'
    || session.status === 'tool_use'
    || session.status === 'thinking';

  if (!isStoppable) {
    return false;
  }

  session.abortRequested = true;
  clearPlanningPostToolStallWatchdog(session);

  try {
    await session.piSession.abort();
  } catch (err) {
    console.error('[PlanningAgent] Failed to abort planning execution:', err);
  }

  // Keep local state consistent even if no follow-up events arrive.
  session.currentStreamText = '';
  session.currentThinkingText = '';
  session.toolCallArgs.clear();
  session.status = 'idle';

  const emit = broadcast || session.broadcast;
  emit({ type: 'planning:status', workspaceId, status: 'idle' });
  emit({ type: 'planning:turn_end', workspaceId });

  return true;
}

/**
 * Reset the planning session (start fresh conversation).
 * Archives the old session messages and generates a new session ID.
 * Returns the new session ID.
 */
export async function resetPlanningSession(
  workspaceId: string,
  broadcast?: (event: ServerEvent) => void,
): Promise<string> {
  const session = planningSessions.get(workspaceId);
  const oldSessionId = session?.sessionId || getOrCreateSessionId(workspaceId);
  const oldMessages = session?.messages || loadPersistedMessages(workspaceId);

  // Archive old session messages
  archiveSession(workspaceId, oldSessionId, oldMessages);

  // Tear down the old Pi SDK session
  if (session) {
    clearPlanningPostToolStallWatchdog(session);
    session.unsubscribe?.();
    try {
      await session.piSession?.abort();
    } catch { /* ignore */ }
  }
  planningSessions.delete(workspaceId);
  unregisterShelfCallbacks(workspaceId);
  unregisterFactoryControlCallbacks(workspaceId);
  unregisterQACallbacks(workspaceId);
  unregisterCreateSkillCallbacks(workspaceId);
  unregisterCreateExtensionCallbacks(workspaceId);

  // Generate new session ID and persist
  const newSessionId = crypto.randomUUID();
  writeSessionId(workspaceId, newSessionId);

  // Clear the active messages file
  persistMessagesSync(workspaceId, []);

  // Clear legacy shelf data so prior-session outputs cannot bleed into the new session.
  const shelf = await clearShelf(workspaceId);

  // Broadcast the session reset and updated shelf so clients clear chat + any legacy shelf UI.
  if (broadcast) {
    broadcast({ type: 'planning:session_reset', workspaceId, sessionId: newSessionId });
    broadcast({ type: 'shelf:updated', workspaceId, shelf });
  }

  return newSessionId;
}

// =============================================================================
// Task Form Callbacks (bridge between planning agent and create-task UI)
// =============================================================================

export interface TaskFormCallbacks {
  getFormState: () => any | null;
  updateFormState: (updates: Record<string, unknown>) => string;
  getAvailableModels: () => Promise<any[]>;
  getAvailableSkills: () => any[];
}

declare global {
  var __piFactoryTaskFormCallbacks: Map<string, TaskFormCallbacks> | undefined;
  var __piFactoryControlCallbacks: Map<string, {
    getStatus: () => Promise<any>;
    start: () => Promise<any>;
    stop: () => Promise<any>;
  }> | undefined;
}

function ensureTaskFormRegistry(): Map<string, TaskFormCallbacks> {
  if (!globalThis.__piFactoryTaskFormCallbacks) {
    globalThis.__piFactoryTaskFormCallbacks = new Map();
  }
  return globalThis.__piFactoryTaskFormCallbacks;
}

export function registerTaskFormCallbacks(workspaceId: string, callbacks: TaskFormCallbacks): void {
  ensureTaskFormRegistry().set(workspaceId, callbacks);
}

export function unregisterTaskFormCallbacks(workspaceId: string): void {
  globalThis.__piFactoryTaskFormCallbacks?.delete(workspaceId);
}

// =============================================================================
// Factory Control Callbacks (start/stop queue from planning agent)
// =============================================================================

function ensureControlRegistry(): Map<string, {
  getStatus: () => Promise<any>;
  start: () => Promise<any>;
  stop: () => Promise<any>;
}> {
  if (!globalThis.__piFactoryControlCallbacks) {
    globalThis.__piFactoryControlCallbacks = new Map();
  }
  return globalThis.__piFactoryControlCallbacks;
}

function registerFactoryControlCallbacks(
  workspaceId: string,
  broadcast: (event: ServerEvent) => void,
): void {
  ensureControlRegistry().set(workspaceId, {
    getStatus: async () => getQueueStatus(workspaceId),
    start: async () => startQueueProcessing(workspaceId, broadcast),
    stop: async () => stopQueueProcessing(workspaceId),
  });
}

function unregisterFactoryControlCallbacks(workspaceId: string): void {
  globalThis.__piFactoryControlCallbacks?.delete(workspaceId);
}

// =============================================================================
// Task Management Callbacks (CRUD + move/promote/demote from planning agent)
// =============================================================================

declare global {
  var __piFactoryTaskCallbacks: Map<string, {
    listTasks: () => Promise<any[]>;
    getTask: (taskId: string) => Promise<any | null>;
    updateTask: (taskId: string, updates: any) => Promise<any>;
    deleteTask: (taskId: string) => Promise<boolean>;
    moveTask: (taskId: string, toPhase: string) => Promise<any>;
    getPromotePhase: (phase: string) => string | null;
    getDemotePhase: (phase: string) => string | null;
  }> | undefined;
}

function ensureTaskCallbackRegistry(): Map<string, {
  listTasks: () => Promise<any[]>;
  getTask: (taskId: string) => Promise<any | null>;
  updateTask: (taskId: string, updates: any) => Promise<any>;
  deleteTask: (taskId: string) => Promise<boolean>;
  moveTask: (taskId: string, toPhase: string) => Promise<any>;
  getPromotePhase: (phase: string) => string | null;
  getDemotePhase: (phase: string) => string | null;
}> {
  if (!globalThis.__piFactoryTaskCallbacks) {
    globalThis.__piFactoryTaskCallbacks = new Map();
  }
  return globalThis.__piFactoryTaskCallbacks;
}

function getPromotePhase(phase: string): string | null {
  const flow: Record<string, string> = {
    backlog: 'ready',
    ready: 'executing',
    executing: 'complete',
  };
  return flow[phase] || null;
}

function getDemotePhase(phase: string): string | null {
  const flow: Record<string, string> = {
    ready: 'backlog',
    executing: 'ready',
    complete: 'executing',
    archived: 'backlog',
  };
  return flow[phase] || null;
}

async function registerTaskCallbacks(workspaceId: string): Promise<void> {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) return;

  ensureTaskCallbackRegistry().set(workspaceId, {
    listTasks: async () => {
      const tasksDir = getTasksDir(workspace);
      return discoverTasks(tasksDir);
    },
    getTask: async (taskId: string) => {
      const tasksDir = getTasksDir(workspace);
      const tasks = discoverTasks(tasksDir);
      return tasks.find(t => t.id === taskId) || null;
    },
    updateTask: async (taskId: string, updates: any) => {
      const { updateTask } = await import('./task-service.js');
      const tasksDir = getTasksDir(workspace);
      const tasks = discoverTasks(tasksDir);
      const task = tasks.find(t => t.id === taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);
      return updateTask(task, updates);
    },
    deleteTask: async (taskId: string) => {
      const { deleteTaskWithLifecycle } = await import('./task-deletion-service.js');
      const tasksDir = getTasksDir(workspace);
      const tasks = discoverTasks(tasksDir);
      const task = tasks.find(t => t.id === taskId);
      if (!task) return false;
      await deleteTaskWithLifecycle(task);
      return true;
    },
    moveTask: async (taskId: string, toPhase: string) => {
      const { moveTaskToPhase, canMoveToPhase } = await import('./task-service.js');
      const tasksDir = getTasksDir(workspace);
      const tasks = discoverTasks(tasksDir);
      const task = tasks.find(t => t.id === taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);

      const validation = canMoveToPhase(task, toPhase as any);
      if (!validation.allowed) {
        throw new Error(validation.reason || `Cannot move task to ${toPhase}`);
      }

      return moveTaskToPhase(task, toPhase as any, 'agent', undefined, tasks);
    },
    getPromotePhase,
    getDemotePhase,
  });
}

export function _unregisterTaskCallbacks(workspaceId: string): void {
  globalThis.__piFactoryTaskCallbacks?.delete(workspaceId);
}

// =============================================================================
// Message Agent Callbacks (steer/follow-up/chat from planning agent)
// =============================================================================

declare global {
  var __piFactoryMessageAgentCallbacks: Map<string, {
    hasActiveSession: (taskId: string) => boolean;
    steerTask: (taskId: string, content: string, attachmentIds?: string[]) => Promise<boolean>;
    followUpTask: (taskId: string, content: string, attachmentIds?: string[]) => Promise<boolean>;
    startChat: (taskId: string, content: string, attachmentIds?: string[]) => Promise<boolean>;
    resumeChat: (taskId: string, content: string, attachmentIds?: string[]) => Promise<boolean>;
  }> | undefined;
}

function ensureMessageAgentCallbackRegistry(): Map<string, {
  hasActiveSession: (taskId: string) => boolean;
  steerTask: (taskId: string, content: string, attachmentIds?: string[]) => Promise<boolean>;
  followUpTask: (taskId: string, content: string, attachmentIds?: string[]) => Promise<boolean>;
  startChat: (taskId: string, content: string, attachmentIds?: string[]) => Promise<boolean>;
  resumeChat: (taskId: string, content: string, attachmentIds?: string[]) => Promise<boolean>;
}> {
  if (!globalThis.__piFactoryMessageAgentCallbacks) {
    globalThis.__piFactoryMessageAgentCallbacks = new Map();
  }
  return globalThis.__piFactoryMessageAgentCallbacks;
}

async function registerMessageAgentCallbacks(
  workspaceId: string,
  broadcast: (event: ServerEvent) => void,
): Promise<void> {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) return;

  ensureMessageAgentCallbackRegistry().set(workspaceId, {
    hasActiveSession: (taskId: string) => {
      return hasLiveExecutionSession(taskId);
    },
    steerTask: async (taskId: string, content: string, _attachmentIds?: string[]) => {
      const { steerTask } = await import('./agent-execution-service.js');
      // TODO: Pass attachmentIds once steerTask supports attachments
      return steerTask(taskId, content);
    },
    followUpTask: async (taskId: string, content: string, _attachmentIds?: string[]) => {
      const { followUpTask } = await import('./agent-execution-service.js');
      // TODO: Pass attachmentIds once followUpTask supports attachments
      return followUpTask(taskId, content);
    },
    startChat: async (taskId: string, content: string, _attachmentIds?: string[]) => {
      const { startChat } = await import('./agent-execution-service.js');
      const { discoverTasks } = await import('./task-service.js');
      const tasksDir = getTasksDir(workspace);
      const tasks = discoverTasks(tasksDir);
      const task = tasks.find(t => t.id === taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);
      // TODO: Pass attachmentIds once startChat supports attachments
      return startChat(task, workspaceId, workspace.path, content, broadcast);
    },
    resumeChat: async (taskId: string, content: string, _attachmentIds?: string[]) => {
      const { resumeChat } = await import('./agent-execution-service.js');
      const { discoverTasks } = await import('./task-service.js');
      const tasksDir = getTasksDir(workspace);
      const tasks = discoverTasks(tasksDir);
      const task = tasks.find(t => t.id === taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);
      // TODO: Pass attachmentIds once resumeChat supports attachments
      return resumeChat(task, workspaceId, workspace.path, content, broadcast);
    },
  });
}

export function _unregisterMessageAgentCallbacks(workspaceId: string): void {
  globalThis.__piFactoryMessageAgentCallbacks?.delete(workspaceId);
}

// =============================================================================
// Create Skill Callbacks (create new execution skills from foreman)
// =============================================================================

declare global {
  var __piFactoryCreateSkillCallbacks: Map<string, {
    createSkill: (payload: {
      name: string;
      description: string;
      hooks: ('pre-planning' | 'pre' | 'post')[];
      content: string;
      destination?: 'global' | 'repo-local';
    }) => Promise<{ success: boolean; skillId?: string; path?: string; error?: string }>;
    listSkills: () => Promise<Array<{ id: string; name: string; description: string; hooks: string[] }>>;
  }> | undefined;
}

function ensureCreateSkillCallbackRegistry(): Map<string, {
  createSkill: (payload: {
    name: string;
    description: string;
    hooks: ('pre-planning' | 'pre' | 'post')[];
    content: string;
    destination?: 'global' | 'repo-local';
  }) => Promise<{ success: boolean; skillId?: string; path?: string; error?: string }>;
  listSkills: () => Promise<Array<{ id: string; name: string; description: string; hooks: string[] }>>;
}> {
  if (!globalThis.__piFactoryCreateSkillCallbacks) {
    globalThis.__piFactoryCreateSkillCallbacks = new Map();
  }
  return globalThis.__piFactoryCreateSkillCallbacks;
}

function registerCreateSkillCallbacks(workspaceId: string): void {
  ensureCreateSkillCallbackRegistry().set(workspaceId, {
    createSkill: async (payload) => {
      const { createFactorySkill, getFactoryUserSkillsDir } = await import('./skill-management-service.js');
      const { reloadPostExecutionSkills } = await import('./post-execution-skills.js');
      const { join } = await import('path');

      try {
        const workspace = await getWorkspaceById(workspaceId);
        if (!workspace) {
          return {
            success: false,
            error: `Workspace ${workspaceId} not found`,
          };
        }

        const destination = payload.destination === 'repo-local' ? 'repo-local' : 'global';
        const skillsDir = destination === 'repo-local'
          ? getWorkspaceTaskFactorySkillsDir(workspace.path)
          : getFactoryUserSkillsDir();

        // Normalize the skill payload to match what createFactorySkill expects
        const skillPayload = {
          id: payload.name,
          description: payload.description,
          type: 'follow-up' as const,
          hooks: payload.hooks,
          promptTemplate: payload.content,
          maxIterations: 1,
        };

        const skillId = createFactorySkill(skillPayload, { skillsDir });

        // Reload skills so the new skill is immediately available
        reloadPostExecutionSkills();

        const skillPath = join(skillsDir, skillId, 'SKILL.md');

        return {
          success: true,
          skillId,
          path: skillPath,
        };
      } catch (err: any) {
        return {
          success: false,
          error: err.message || String(err),
        };
      }
    },
    listSkills: async () => {
      const { discoverPostExecutionSkills } = await import('./post-execution-skills.js');
      const skills = discoverPostExecutionSkills();
      return skills.map(skill => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        hooks: skill.hooks,
      }));
    },
  });
}

function unregisterCreateSkillCallbacks(workspaceId: string): void {
  globalThis.__piFactoryCreateSkillCallbacks?.delete(workspaceId);
}

// =============================================================================
// Create Extension Callbacks (create new TypeScript extensions from foreman)
// =============================================================================

declare global {
  var __piFactoryCreateExtensionCallbacks: Map<string, {
    createExtension: (payload: {
      name: string;
      audience: 'foreman' | 'task' | 'all';
      typescript: string;
      destination?: 'global' | 'repo-local';
      confirmed?: boolean;
    }) => Promise<{
      success: boolean;
      path?: string;
      error?: string;
      warnings?: string[];
      validationErrors?: string[];
      needsConfirmation?: boolean;
    }>;
    listExtensions: () => Promise<Array<{ name: string; path: string; audience: string }>>;
  }> | undefined;
}

function ensureCreateExtensionCallbackRegistry(): Map<string, {
  createExtension: (payload: {
    name: string;
    audience: 'foreman' | 'task' | 'all';
    typescript: string;
    destination?: 'global' | 'repo-local';
    confirmed?: boolean;
  }) => Promise<{
    success: boolean;
    path?: string;
    error?: string;
    warnings?: string[];
    validationErrors?: string[];
    needsConfirmation?: boolean;
  }>;
  listExtensions: () => Promise<Array<{ name: string; path: string; audience: string }>>;
}> {
  if (!globalThis.__piFactoryCreateExtensionCallbacks) {
    globalThis.__piFactoryCreateExtensionCallbacks = new Map();
  }
  return globalThis.__piFactoryCreateExtensionCallbacks;
}

function registerCreateExtensionCallbacks(workspaceId: string): void {
  ensureCreateExtensionCallbackRegistry().set(workspaceId, {
    createExtension: async (payload) => {
      const { createFactoryExtension, validateExtensionTypeScript, scanExtensionSecurity } = await import('./extension-management-service.js');

      try {
        const workspace = await getWorkspaceById(workspaceId);
        if (!workspace) {
          return {
            success: false,
            error: `Workspace ${workspaceId} not found`,
          };
        }

        // First, validate the TypeScript code
        const validationResult = await validateExtensionTypeScript(payload.typescript);
        if (!validationResult.valid) {
          return {
            success: false,
            error: 'TypeScript validation failed',
            validationErrors: validationResult.errors,
          };
        }

        // Scan for security issues
        const securityScan = await scanExtensionSecurity(payload.typescript);

        // If there are warnings and not confirmed, require confirmation
        if ((securityScan.warnings.length > 0 || validationResult.warnings.length > 0) && !payload.confirmed) {
          return {
            success: false,
            needsConfirmation: true,
            warnings: securityScan.warnings,
            validationErrors: validationResult.warnings,
          };
        }

        // Create the extension
        const result = await createFactoryExtension({
          name: payload.name,
          audience: payload.audience,
          typescript: payload.typescript,
          destination: payload.destination,
          workspacePath: workspace.path,
        });

        if (result.success) {
          // Reload extensions so the new extension is immediately available
          const { reloadRepoExtensions } = await import('./agent-execution-service.js');
          reloadRepoExtensions(workspace.path);

          return {
            success: true,
            path: result.path,
            warnings: securityScan.warnings,
          };
        } else {
          return {
            success: false,
            error: result.error,
          };
        }
      } catch (err: any) {
        return {
          success: false,
          error: err.message || String(err),
        };
      }
    },
    listExtensions: async () => {
      const { getRepoExtensionPaths } = await import('./agent-execution-service.js');
      const { basename, dirname } = await import('path');

      const workspace = await getWorkspaceById(workspaceId);
      const paths = getRepoExtensionPaths('all', workspace?.path);
      const FOREMAN_ONLY_EXTENSION_IDS = new Set(['web-tools', 'manage-tasks', 'message-agent', 'create-skill', 'create-extension']);

      return paths.map(path => {
        const fileName = basename(path);
        const name = fileName === 'index.ts' ? basename(dirname(path)) : fileName.replace(/\.ts$/, '');
        const isForemanOnly = FOREMAN_ONLY_EXTENSION_IDS.has(name);

        return {
          name,
          path,
          audience: isForemanOnly ? 'foreman' : 'all',
        };
      });
    },
  });
}

function unregisterCreateExtensionCallbacks(workspaceId: string): void {
  globalThis.__piFactoryCreateExtensionCallbacks?.delete(workspaceId);
}
