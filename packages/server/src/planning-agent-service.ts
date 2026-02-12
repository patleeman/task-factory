// =============================================================================
// Planning Agent Service
// =============================================================================
// The planning agent is a general-purpose conversational agent that helps the
// user research, decompose, and stage work before it hits the production line.
// It maintains one conversation per workspace and can create draft tasks and
// HTML artifacts on the shelf.

import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync } from 'fs';
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
  DraftTask,
  Artifact,
  PlanningMessage,
  PlanningAgentStatus,
  ServerEvent,
  Task,
  Shelf,
} from '@pi-factory/shared';
import {
  addDraftTask,
  addArtifact,
  getShelf,
} from './shelf-service.js';
import { getWorkspaceById } from './workspace-service.js';
import { discoverTasks } from './task-service.js';
import { getTasksDir } from './workspace-service.js';
import { getRepoExtensionPaths } from './agent-execution-service.js';

// =============================================================================
// Shelf callback registry — used by extension tools
// =============================================================================

declare global {
  var __piFactoryShelfCallbacks: Map<string, {
    createDraftTask: (args: any) => void;
    createArtifact: (args: any) => void;
  }> | undefined;
}

function ensureShelfCallbackRegistry(): Map<string, {
  createDraftTask: (args: any) => void;
  createArtifact: (args: any) => void;
}> {
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
    createDraftTask: (args: any) => {
      const draft: DraftTask = {
        id: `draft-${crypto.randomUUID().slice(0, 8)}`,
        title: String(args.title || 'Untitled Task'),
        content: String(args.content || ''),
        acceptanceCriteria: Array.isArray(args.acceptance_criteria)
          ? args.acceptance_criteria.map(String)
          : [],
        type: args.type || 'feature',
        priority: args.priority || 'medium',
        complexity: args.complexity || 'medium',
        createdAt: new Date().toISOString(),
      };
      const shelf = addDraftTask(workspaceId, draft);
      broadcast({ type: 'shelf:updated', workspaceId, shelf });
    },
    createArtifact: (args: any) => {
      const artifact: Artifact = {
        id: `artifact-${crypto.randomUUID().slice(0, 8)}`,
        name: String(args.name || 'Untitled Artifact'),
        html: String(args.html || '<p>Empty artifact</p>'),
        createdAt: new Date().toISOString(),
      };
      const shelf = addArtifact(workspaceId, artifact);
      broadcast({ type: 'shelf:updated', workspaceId, shelf });
    },
  });
}

function unregisterShelfCallbacks(workspaceId: string): void {
  globalThis.__piFactoryShelfCallbacks?.delete(workspaceId);
}

// =============================================================================
// Per-workspace planning session state
// =============================================================================

interface PlanningSession {
  workspaceId: string;
  piSession: AgentSession | null;
  status: PlanningAgentStatus;
  messages: PlanningMessage[];
  currentStreamText: string;
  currentThinkingText: string;
  toolCallArgs: Map<string, { toolName: string; args: Record<string, unknown> }>;
  unsubscribe?: () => void;
  broadcast: (event: ServerEvent) => void;
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

  const workspace = getWorkspaceById(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  const session: PlanningSession = {
    workspaceId,
    piSession: null,
    status: 'idle',
    messages: existing?.messages || [],
    currentStreamText: '',
    currentThinkingText: '',
    toolCallArgs: new Map(),
    broadcast,
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

    // Register shelf callbacks so extension tools can create drafts/artifacts
    registerShelfCallbacks(workspaceId, broadcast);

    // Subscribe to streaming events
    session.unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
      handlePlanningEvent(event, session);
    });

    // Send system prompt to establish planning agent identity
    const systemPrompt = buildPlanningSystemPrompt(workspace.path, workspaceId);
    await piSession.prompt(systemPrompt);

    // After the initial prompt resolves, the agent is ready
    session.status = 'idle';
    broadcast({ type: 'planning:status', workspaceId, status: 'idle' });
    broadcast({ type: 'planning:turn_end', workspaceId });

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

function buildPlanningSystemPrompt(workspacePath: string, workspaceId: string): string {
  // Get current tasks for context
  const workspace = getWorkspaceById(workspaceId);
  let taskSummary = '';
  if (workspace) {
    try {
      const tasksDir = getTasksDir(workspace);
      const tasks = discoverTasks(tasksDir);
      if (tasks.length > 0) {
        taskSummary = '\n## Current Tasks\n';
        const byPhase = new Map<string, Task[]>();
        for (const t of tasks) {
          const phase = t.frontmatter.phase;
          if (!byPhase.has(phase)) byPhase.set(phase, []);
          byPhase.get(phase)!.push(t);
        }
        for (const [phase, phaseTasks] of byPhase) {
          taskSummary += `\n### ${phase} (${phaseTasks.length})\n`;
          for (const t of phaseTasks.slice(0, 10)) {
            taskSummary += `- **${t.id}**: ${t.frontmatter.title}\n`;
          }
          if (phaseTasks.length > 10) {
            taskSummary += `- ... and ${phaseTasks.length - 10} more\n`;
          }
        }
      }
    } catch { /* ignore */ }
  }

  // Get current shelf contents
  const shelf = getShelf(workspaceId);
  let shelfSummary = '';
  if (shelf.items.length > 0) {
    shelfSummary = '\n## Current Shelf\n';
    for (const si of shelf.items) {
      if (si.type === 'draft-task') {
        shelfSummary += `- 📋 Draft: **${si.item.title}** (${si.item.id})\n`;
      } else {
        shelfSummary += `- 📄 Artifact: **${si.item.name}** (${si.item.id})\n`;
      }
    }
  }

  return `You are the Pi-Factory Planning Agent. You help the user plan, research, and decompose work into tasks.

## Your Role
- Have a conversation with the user about their goals and projects
- Research codebases, architectures, and requirements
- Break down large goals into well-defined, small tasks
- Create draft tasks that the user can review before committing to the backlog
- Generate HTML artifacts (research summaries, comparison tables, diagrams, mockups)
- Answer questions about the current state of work

## Workspace
- Path: ${workspacePath}
${taskSummary}${shelfSummary}

## Tools

You have access to two special tools for creating items on the shelf:

### create_draft_task
Creates a draft task on the shelf. The user can review and push it to the backlog.
Parameters:
- title (string): Short descriptive title
- content (string): Markdown description of what needs to be done
- acceptance_criteria (string[]): List of specific, testable criteria
- type (string): One of: feature, bug, refactor, research, spike
- priority (string): One of: critical, high, medium, low
- complexity (string): One of: low, medium, high

### create_artifact
Creates an HTML artifact on the shelf. Used for research summaries, comparison tables, diagrams, mockups, etc.
Parameters:
- name (string): Descriptive name for the artifact
- html (string): Complete HTML document. Use inline styles. Keep it self-contained.

## Guidelines
- Keep tasks small and focused — each should be completable in a single agent session
- Write clear acceptance criteria that are specific and testable
- When in doubt, ask the user for clarification
- Use artifacts for anything that benefits from visual presentation
- Be conversational and helpful — you're a collaborator, not just a task creator

Respond briefly to acknowledge you're ready, then wait for the user's first message.`;
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
      const message = event.message;
      let content = '';

      if ('content' in message && Array.isArray(message.content)) {
        content = message.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n');
      }

      if (content) {
        const msgId = crypto.randomUUID();
        const planningMsg: PlanningMessage = {
          id: msgId,
          role: 'assistant',
          content,
          timestamp: new Date().toISOString(),
        };
        session.messages.push(planningMsg);
        broadcast({ type: 'planning:message', workspaceId, message: planningMsg });
      }

      broadcast({
        type: 'planning:streaming_end',
        workspaceId,
        fullText: content || session.currentStreamText,
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
      });
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
      const resultText = typeof event.result === 'string'
        ? event.result
        : (event as any).content?.map((c: any) => c.type === 'text' ? c.text : '').join('') || '';

      broadcast({
        type: 'planning:tool_end',
        workspaceId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
        result: resultText,
      });

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

/**
 * Send a user message to the planning agent and get a streaming response.
 */
export async function sendPlanningMessage(
  workspaceId: string,
  content: string,
  broadcast: (event: ServerEvent) => void,
): Promise<void> {
  // Record the user message
  const userMsg: PlanningMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
  };

  const session = await getOrCreateSession(workspaceId, broadcast);
  session.messages.push(userMsg);
  broadcast({ type: 'planning:message', workspaceId, message: userMsg });

  // Send to the agent
  if (!session.piSession) {
    throw new Error('Planning session not initialized');
  }

  session.status = 'streaming';
  broadcast({ type: 'planning:status', workspaceId, status: 'streaming' });

  try {
    await session.piSession.followUp(content);

    // Turn complete
    session.status = 'idle';
    broadcast({ type: 'planning:status', workspaceId, status: 'idle' });
    broadcast({ type: 'planning:turn_end', workspaceId });
  } catch (err) {
    console.error('[PlanningAgent] Message failed:', err);
    session.status = 'error';
    broadcast({ type: 'planning:status', workspaceId, status: 'error' });
    throw err;
  }
}

/**
 * Get the conversation history for a workspace's planning session.
 */
export function getPlanningMessages(workspaceId: string): PlanningMessage[] {
  const session = planningSessions.get(workspaceId);
  return session?.messages || [];
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
 */
export async function resetPlanningSession(workspaceId: string): Promise<void> {
  const session = planningSessions.get(workspaceId);
  if (session) {
    session.unsubscribe?.();
    try {
      await session.piSession?.abort();
    } catch { /* ignore */ }
  }
  planningSessions.delete(workspaceId);
  unregisterShelfCallbacks(workspaceId);
}
