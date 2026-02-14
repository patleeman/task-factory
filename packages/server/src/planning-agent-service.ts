// =============================================================================
// Planning Agent Service
// =============================================================================
// The planning agent is a general-purpose conversational agent that helps the
// user research, decompose, and stage work before it hits the production line.
// It maintains one conversation per workspace and can create draft tasks
// on the production queue.

import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
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
  QAQuestion,
  QARequest,
  QAAnswer,
  QAResponse,
} from '@pi-factory/shared';
import {
  addArtifact,
  addDraftTask,
  clearDraftTasks,
  getShelf,
  removeShelfItem,
  updateDraftTask as updateDraftTaskFn,
} from './shelf-service.js';
import { getWorkspaceById } from './workspace-service.js';
import { discoverTasks } from './task-service.js';
import { getTasksDir } from './workspace-service.js';
import { getRepoExtensionPaths } from './agent-execution-service.js';
import {
  loadWorkspaceSharedContext,
  WORKSPACE_SHARED_CONTEXT_REL_PATH,
} from './pi-integration.js';
import {
  startQueueProcessing,
  stopQueueProcessing,
  getQueueStatus,
} from './queue-manager.js';
import {
  buildContractReference,
  prependStateToTurn,
  stripStateContractEcho,
} from './state-contract.js';

// =============================================================================
// Shelf callback registry — used by extension tools
// =============================================================================

export interface ShelfCallbacks {
  createDraftTask: (args: any) => Promise<void>;
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

function registerShelfCallbacks(
  workspaceId: string,
  broadcast: (event: ServerEvent) => void,
): void {
  const registry = ensureShelfCallbackRegistry();
  registry.set(workspaceId, {
    createDraftTask: async (args: any) => {
      const draft: DraftTask = {
        id: `draft-${crypto.randomUUID().slice(0, 8)}`,
        title: String(args.title || 'Untitled Task'),
        content: String(args.content || ''),
        acceptanceCriteria: Array.isArray(args.acceptance_criteria)
          ? args.acceptance_criteria.map(String)
          : [],
        plan: args.plan ? {
          goal: String(args.plan.goal || ''),
          steps: Array.isArray(args.plan.steps) ? args.plan.steps.map(String) : [],
          validation: Array.isArray(args.plan.validation) ? args.plan.validation.map(String) : [],
          cleanup: Array.isArray(args.plan.cleanup) ? args.plan.cleanup.map(String) : [],
          generatedAt: new Date().toISOString(),
        } : undefined,
        createdAt: new Date().toISOString(),
      };
      const shelf = await addDraftTask(workspaceId, draft);
      broadcast({ type: 'shelf:updated', workspaceId, shelf });
    },
    createArtifact: async (args: { name: string; html: string }) => {
      const artifact: Artifact = {
        id: `artifact-${crypto.randomUUID().slice(0, 8)}`,
        name: String(args.name || 'Untitled Artifact'),
        html: String(args.html || ''),
        createdAt: new Date().toISOString(),
      };
      const shelf = await addArtifact(workspaceId, artifact);
      broadcast({ type: 'shelf:updated', workspaceId, shelf });
      return artifact;
    },
    removeItem: async (itemId: string) => {
      try {
        const shelf = await removeShelfItem(workspaceId, itemId);
        broadcast({ type: 'shelf:updated', workspaceId, shelf });
        return `Removed item ${itemId}`;
      } catch (err: any) {
        return `Failed to remove: ${err.message}`;
      }
    },
    updateDraftTask: async (draftId: string, updates: any) => {
      try {
        const shelf = await updateDraftTaskFn(workspaceId, draftId, updates);
        broadcast({ type: 'shelf:updated', workspaceId, shelf });
        return `Updated draft ${draftId}`;
      } catch (err: any) {
        return `Failed to update: ${err.message}`;
      }
    },
    getShelf: async () => {
      return getShelf(workspaceId);
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
  // Reject any pending QA requests for this workspace so Promises don't hang
  for (const [requestId, pending] of pendingQARequests) {
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

  const registryPath = join(homedir(), '.pi', 'factory', 'workspaces.json');
  try {
    const entries = JSON.parse(readFileSync(registryPath, 'utf-8')) as WorkspaceRegistryEntry[];
    const entry = entries.find((e) => e.id === workspaceId);
    return entry?.path || null;
  } catch {
    return null;
  }
}

function sessionIdPath(workspaceId: string): string | null {
  const workspacePath = getWorkspacePath(workspaceId);
  if (!workspacePath) return null;
  const dir = join(workspacePath, '.pi');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'planning-session-id.txt');
}

function sessionsDir(workspaceId: string): string | null {
  const workspacePath = getWorkspacePath(workspaceId);
  if (!workspacePath) return null;
  const dir = join(workspacePath, '.pi', 'planning-sessions');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getOrCreateSessionId(workspaceId: string): string {
  const path = sessionIdPath(workspaceId);
  if (path && existsSync(path)) {
    const existing = readFileSync(path, 'utf-8').trim();
    if (existing) return existing;
  }
  const newId = crypto.randomUUID();
  if (path) {
    writeFileSync(path, newId);
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
  const workspacePath = getWorkspacePath(workspaceId);
  if (!workspacePath) return null;
  const dir = join(workspacePath, '.pi');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'planning-messages.json');
}

function loadPersistedMessages(workspaceId: string): PlanningMessage[] {
  const path = messagesPath(workspaceId);
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
  piSession: AgentSession | null;
  status: PlanningAgentStatus;
  messages: PlanningMessage[];
  currentStreamText: string;
  currentThinkingText: string;
  toolCallArgs: Map<string, { toolName: string; args: Record<string, unknown> }>;
  unsubscribe?: () => void;
  broadcast: (event: ServerEvent) => void;
  /** Whether the first user message has been sent (system prompt gets prepended) */
  firstMessageSent: boolean;
  /** UUID for the current planning session (persisted in planning-session-id.txt) */
  sessionId: string;
  /** Queue of pending sends — ensures only one followUp/prompt runs at a time */
  sendQueue: Array<{
    content: string;
    images?: { type: 'image'; data: string; mimeType: string }[];
    resolve: () => void;
    reject: (err: Error) => void;
  }>;
  /** Whether a send is currently in-flight */
  isSending: boolean;
}

const planningSessions = new Map<string, PlanningSession>();

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

  const session: PlanningSession = {
    workspaceId,
    workspacePath: workspace.path,
    piSession: null,
    status: 'idle',
    messages: existing?.messages || loadPersistedMessages(workspaceId),
    currentStreamText: '',
    currentThinkingText: '',
    toolCallArgs: new Map(),
    broadcast,
    firstMessageSent: false,
    sessionId: getOrCreateSessionId(workspaceId),
    sendQueue: [],
    isSending: false,
  };

  planningSessions.set(workspaceId, session);

  try {
    const authStorage = new AuthStorage();
    const modelRegistry = new ModelRegistry(authStorage);
    const loader = new DefaultResourceLoader({
      cwd: workspace.path,
      additionalExtensionPaths: getRepoExtensionPaths(),
    });
    await loader.reload();

    const safePath = `--planning-${workspaceId}--`;
    const sessionDir = join(homedir(), '.pi', 'agent', 'sessions', safePath);
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    const sessionManager = SessionManager.create(workspace.path);

    const { session: piSession } = await createAgentSession({
      cwd: workspace.path,
      authStorage,
      modelRegistry,
      sessionManager,
      resourceLoader: loader,
    });

    session.piSession = piSession;

    // Register callbacks so extension tools can interact with the factory
    registerShelfCallbacks(workspaceId, broadcast);
    registerFactoryControlCallbacks(workspaceId, broadcast);
    registerQACallbacks(workspaceId, broadcast, () => planningSessions.get(workspaceId));

    // Subscribe to streaming events
    session.unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
      handlePlanningEvent(event, session);
    });

    // Session is ready — system prompt will be prepended to first user message
    session.status = 'idle';
    broadcast({ type: 'planning:status', workspaceId, status: 'idle' });

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

  // Get current production queue contents (draft tasks only)
  const shelf = await getShelf(workspaceId);
  let shelfSummary = '';
  const drafts = shelf.items.filter((si) => si.type === 'draft-task');
  if (drafts.length > 0) {
    shelfSummary = '\n## Current Production Queue\n';
    for (const si of drafts) {
      shelfSummary += `- **${si.item.title}** (${si.item.id})\n`;
    }
  }

  // Shared workspace context edited by user + agents
  const workspaceSharedContext = loadWorkspaceSharedContext(workspacePath);
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
- Create draft tasks that the user can review before committing to the backlog
- Answer questions about the current state of work

## Workspace
- Path: ${workspacePath}
${taskSummary}${shelfSummary}${sharedContextSummary}

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

### create_draft_task
Creates a draft task on the shelf. The user can review and push it to the backlog.
Parameters:
- title (string): Short descriptive title
- content (string): Markdown description of what needs to be done
- acceptance_criteria (string[]): List of specific, testable criteria
- plan (object): Execution plan for the task. **Always include a plan.** Tasks with plans skip the planning phase and go straight to ready for execution.
  - goal (string): Concise summary of what the task achieves
  - steps (string[]): High-level implementation summaries (usually 3-6 short steps)
  - validation (string[]): High-level checks that confirm the outcome
  - cleanup (string[]): Post-completion cleanup actions (empty array if none)

### manage_shelf
List, remove, or update shelf items.
Parameters:
- action (string): "list" | "remove" | "update"
- item_id (string, optional): ID of the item (required for remove/update)
- updates (object, optional): Fields to update on a draft task (title, content, acceptance_criteria)

### factory_control
Start, stop, or check the status of the factory queue (the execution pipeline that processes tasks).
Parameters:
- action (string): "status" to check, "start" to begin processing, "stop" to pause

## Guidelines
- **If the user's request is ambiguous, use \`ask_questions\` first** to disambiguate before creating tasks. Present concrete multiple-choice options so the user can quickly clarify intent.
- **CRITICAL: When using \`ask_questions\`, call the tool IMMEDIATELY with zero preamble.** Do not write the questions as text first — the tool renders an interactive UI. Any text you write before the tool call creates ugly duplication. Just call the tool.
- When the user describes work, **always create draft tasks immediately** — don't ask for permission, just do it
- **Always include a plan** with every draft task. Research first, then provide a high-level summary plan so users can understand the approach quickly.
- Keep tasks small and focused — each should be completable in a single agent session
- Write clear acceptance criteria that are specific and testable
- Plan steps should be concise and outcome-focused. Avoid line-level implementation details, exact file paths, and low-level function-by-function instructions.
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

function extractPlanningToolResultDetails(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  return details as Record<string, unknown>;
}

function extractArtifactReferenceFromToolResult(toolName: string, result: unknown): { artifactId: string; artifactName: string } | undefined {
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

  if (!artifactId || !artifactName) return undefined;
  return { artifactId, artifactName };
}

// =============================================================================
// Handle Pi SDK events for the planning session
// =============================================================================

function handlePlanningEvent(
  event: AgentSessionEvent,
  session: PlanningSession,
): void {
  const { workspaceId, broadcast } = session;

  switch (event.type) {
    case 'agent_start':
      session.currentStreamText = '';
      session.currentThinkingText = '';
      session.status = 'streaming';
      broadcast({ type: 'planning:status', workspaceId, status: 'streaming' });
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
      break;
    }

    case 'tool_execution_start': {
      session.toolCallArgs.set(event.toolCallId, {
        toolName: event.toolName,
        args: (event as any).args || {},
      });
      session.status = 'tool_use';
      broadcast({ type: 'planning:status', workspaceId, status: 'tool_use' });
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
      const artifactRef = extractArtifactReferenceFromToolResult(event.toolName, event.result);

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
          artifactId: artifactRef?.artifactId,
          artifactName: artifactRef?.artifactName,
        },
      };
      session.messages.push(toolMsg);
      persistMessages(workspaceId, session.messages);
      broadcast({ type: 'planning:message', workspaceId, message: toolMsg });

      session.toolCallArgs.delete(event.toolCallId);
      session.status = 'streaming';
      broadcast({ type: 'planning:status', workspaceId, status: 'streaming' });
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

  session.status = 'streaming';
  broadcast({ type: 'planning:status', workspaceId, status: 'streaming' });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const turnContent = prependStateToTurn(content, {
        mode: 'foreman',
        phase: 'none',
        planningStatus: 'none',
      });

      if (!session.firstMessageSent) {
        // First message in this Pi session: include system prompt + conversation history
        const systemPrompt = await buildPlanningSystemPrompt(
          session.workspacePath,
          workspaceId,
        );

        // If there are prior messages (restored from disk), include them as context
        const priorMessages = session.messages.filter(m => m.id !== session.messages[session.messages.length - 1]?.id);
        const hasHistory = priorMessages.length > 0;

        let fullPrompt = systemPrompt;
        if (hasHistory) {
          fullPrompt += '\n\n---\n\n## Conversation History (restored)\n\n';
          // Include last ~10 messages, truncate each to ~500 chars to avoid token limits
          const recentHistory = priorMessages.slice(-10);
          for (const msg of recentHistory) {
            const role = msg.role === 'user' ? 'User' : 'Assistant';
            const truncated = msg.content.length > 500
              ? msg.content.slice(0, 500) + '... [truncated]'
              : msg.content;
            fullPrompt += `**${role}:** ${truncated}\n\n`;
          }
          fullPrompt += '---\n\n## Current Message\n\n';
        } else {
          fullPrompt += '\n\n---\n\n# User Message\n\n';
        }
        fullPrompt += turnContent;

        const promptOpts = images && images.length > 0 ? { images } : undefined;
        await session.piSession.prompt(fullPrompt, promptOpts);
        session.firstMessageSent = true;
      } else {
        await session.piSession.followUp(turnContent, images && images.length > 0 ? images : undefined);
      }

      // Turn complete
      session.status = 'idle';
      broadcast({ type: 'planning:status', workspaceId, status: 'idle' });
      broadcast({ type: 'planning:turn_end', workspaceId });
      return;
    } catch (err) {
      console.error(`[PlanningAgent] Attempt ${attempt + 1} failed:`, err);

      if (attempt < MAX_RETRIES) {
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

          const authStorage = new AuthStorage();
          const modelRegistry = new ModelRegistry(authStorage);
          const loader = new DefaultResourceLoader({
            cwd: workspace.path,
            additionalExtensionPaths: getRepoExtensionPaths(),
          });
          await loader.reload();
          const sessionManager = SessionManager.create(workspace.path);
          const { session: piSession } = await createAgentSession({
            cwd: workspace.path,
            authStorage,
            modelRegistry,
            sessionManager,
            resourceLoader: loader,
          });
          session.piSession = piSession;
          registerShelfCallbacks(workspaceId, broadcast);
          registerFactoryControlCallbacks(workspaceId, broadcast);
          registerQACallbacks(workspaceId, broadcast, () => planningSessions.get(workspaceId));
          session.unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
            handlePlanningEvent(event, session);
          });

          broadcast({ type: 'planning:status', workspaceId, status: 'streaming' });
        } catch (recreateErr) {
          console.error('[PlanningAgent] Failed to recreate session:', recreateErr);
          session.status = 'error';
          broadcast({ type: 'planning:status', workspaceId, status: 'error' });
          // Add error message to conversation
          const errMsg: PlanningMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'I encountered an error and could not recover. Please try resetting the conversation.',
            timestamp: new Date().toISOString(),
            sessionId: session.sessionId,
          };
          session.messages.push(errMsg);
          persistMessages(workspaceId, session.messages);
          broadcast({ type: 'planning:message', workspaceId, message: errMsg });
          throw recreateErr;
        }
      } else {
        // All retries exhausted
        session.status = 'error';
        broadcast({ type: 'planning:status', workspaceId, status: 'error' });
        const errMsg: PlanningMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Something went wrong. Please try again or reset the conversation.',
          timestamp: new Date().toISOString(),
          sessionId: session.sessionId,
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
 * Process the send queue sequentially. Only one send runs at a time per session.
 */
async function processSendQueue(session: PlanningSession): Promise<void> {
  if (session.isSending) return; // Another call is already processing
  session.isSending = true;

  while (session.sendQueue.length > 0) {
    const next = session.sendQueue.shift()!;
    try {
      await sendToAgent(session, next.content, session.workspaceId, session.broadcast, next.images);
      next.resolve();
    } catch (err) {
      next.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  session.isSending = false;
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
  const session = await getOrCreateSession(workspaceId, broadcast);

  // Record the user message
  const userMsg: PlanningMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
    sessionId: session.sessionId,
  };

  session.messages.push(userMsg);
  persistMessages(workspaceId, session.messages);
  broadcast({ type: 'planning:message', workspaceId, message: userMsg });

  // Enqueue the send and process sequentially
  return new Promise<void>((resolve, reject) => {
    session.sendQueue.push({ content, images, resolve, reject });
    processSendQueue(session);
  });
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
    session.unsubscribe?.();
    try {
      await session.piSession?.abort();
    } catch { /* ignore */ }
  }
  planningSessions.delete(workspaceId);
  unregisterShelfCallbacks(workspaceId);
  unregisterFactoryControlCallbacks(workspaceId);
  unregisterQACallbacks(workspaceId);

  // Generate new session ID and persist
  const newSessionId = crypto.randomUUID();
  writeSessionId(workspaceId, newSessionId);

  // Clear the active messages file
  persistMessagesSync(workspaceId, []);

  // Clear production queue drafts (keep artifacts and other non-draft shelf items)
  const shelf = await clearDraftTasks(workspaceId);

  // Broadcast the session reset and updated shelf so clients clear chat + queue
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
    getStatus: () => any;
    start: () => any;
    stop: () => any;
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

function ensureControlRegistry(): Map<string, { getStatus: () => any; start: () => any; stop: () => any }> {
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
    getStatus: () => getQueueStatus(workspaceId),
    start: () => {
      const status = startQueueProcessing(workspaceId, broadcast);
      return status;
    },
    stop: () => {
      const status = stopQueueProcessing(workspaceId);
      return status;
    },
  });
}

function unregisterFactoryControlCallbacks(workspaceId: string): void {
  globalThis.__piFactoryControlCallbacks?.delete(workspaceId);
}
