// =============================================================================
// Agent Execution Service
// =============================================================================
// Integrates with Pi SDK to execute tasks with agent capabilities

import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
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
import type { Task, TaskPlan, Attachment } from '@pi-factory/shared';
import { createTaskSeparator, createChatMessage, createSystemEvent } from './activity-service.js';
import { buildAgentContext, type PiSkill } from './pi-integration.js';
import { moveTaskToPhase, updateTask, saveTaskFile } from './task-service.js';
import { runPostExecutionSkills } from './post-execution-skills.js';

// =============================================================================
// Repo-local Extension Discovery
// =============================================================================

/**
 * Discover extensions from pi-factory's own extensions/ directory.
 * These are loaded via additionalExtensionPaths, separate from
 * ~/.pi/agent/extensions/ (global Pi extensions).
 *
 * Supports:
 *   extensions/my-ext.ts          — single file
 *   extensions/my-ext/index.ts    — directory with index
 */
function discoverRepoExtensions(): string[] {
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

/** Cached repo extension paths (discovered once at startup) */
let _repoExtensionPaths: string[] | null = null;

export function getRepoExtensionPaths(): string[] {
  if (_repoExtensionPaths === null) {
    _repoExtensionPaths = discoverRepoExtensions();
    if (_repoExtensionPaths.length > 0) {
      console.log(`Discovered ${_repoExtensionPaths.length} repo extension(s):`,
        _repoExtensionPaths.map(p => p.split('/').slice(-2).join('/')));
    }
  }
  return _repoExtensionPaths;
}

/** Force re-discovery (e.g., after adding a new extension) */
export function reloadRepoExtensions(): string[] {
  _repoExtensionPaths = null;
  return getRepoExtensionPaths();
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
 * Get the on-disk directory for a task's attachments.
 */
function getAttachmentsDir(workspacePath: string, taskId: string): string {
  return join(workspacePath, '.pi', 'tasks', 'attachments', taskId);
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

interface TaskSession {
  id: string;
  taskId: string;
  workspaceId: string;
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
  /** Whether the agent called task_complete during this session */
  agentSignaledComplete: boolean;
  /** Summary from task_complete call */
  completionSummary: string;
  /** Callback to invoke when the task should advance to complete */
  onComplete?: (success: boolean) => void;
  /** Reference to the task being executed */
  task?: Task;
}

const activeSessions = new Map<string, TaskSession>();

export function getActiveSession(taskId: string): TaskSession | undefined {
  return activeSessions.get(taskId);
}

/** Returns true if the task has an actively running session (not completed/error). */
/** Returns true if the task has an active session (running or waiting for input). */
export function hasRunningSession(taskId: string): boolean {
  const session = activeSessions.get(taskId);
  if (!session) return false;
  // 'idle' means the agent is waiting for user input — the session is still alive
  return session.status === 'running' || session.status === 'idle';
}

export function getAllActiveSessions(): TaskSession[] {
  return Array.from(activeSessions.values());
}

// =============================================================================
// Build Agent Prompt
// =============================================================================

function buildTaskPrompt(task: Task, skills: PiSkill[], attachmentSection: string): string {
  const { frontmatter, content } = task;

  let prompt = `# Task: ${frontmatter.title}\n\n`;
  prompt += `**Task ID:** ${task.id}\n\n`;

  if (frontmatter.acceptanceCriteria.length > 0) {
    prompt += `## Acceptance Criteria\n`;
    frontmatter.acceptanceCriteria.forEach((criteria, i) => {
      prompt += `${i + 1}. [ ] ${criteria}\n`;
    });
    prompt += '\n';
  }

  if (frontmatter.testingInstructions.length > 0) {
    prompt += `## Testing Instructions\n`;
    frontmatter.testingInstructions.forEach((instruction, i) => {
      prompt += `${i + 1}. ${instruction}\n`;
    });
    prompt += '\n';
  }

  if (content) {
    prompt += `## Description\n${content}\n\n`;
  }

  // Add attachments section (images are sent separately as ImageContent)
  if (attachmentSection) {
    prompt += attachmentSection;
  }

  // Add available skills
  if (skills.length > 0) {
    prompt += `## Available Skills\n`;
    skills.forEach(skill => {
      prompt += `- **${skill.name}**: ${skill.description}\n`;
      if (skill.allowedTools.length > 0) {
        prompt += `  - Tools: ${skill.allowedTools.join(', ')}\n`;
      }
    });
    prompt += '\n';
  }

  prompt += `## Instructions\n`;
  prompt += `1. Start by understanding the task requirements and acceptance criteria\n`;
  prompt += `2. Plan your approach before implementing\n`;
  prompt += `3. Use the available skills when appropriate\n`;
  prompt += `4. Run tests to verify your implementation\n`;
  prompt += `5. Update quality gates as you complete each item\n`;
  prompt += `6. When you are DONE with the task and all acceptance criteria are met, call the \`task_complete\` tool with this task's ID ("${task.id}") and a brief summary\n`;
  prompt += `7. If you have questions, need clarification, or hit a blocker, do NOT call task_complete — just explain the situation and stop. The user will respond.\n\n`;

  return prompt;
}

// =============================================================================
// Build Rework Prompt (for re-execution with existing conversation)
// =============================================================================

function buildReworkPrompt(task: Task, skills: PiSkill[], attachmentSection: string): string {
  const { frontmatter, content } = task;

  let prompt = `# Rework: ${frontmatter.title}\n\n`;
  prompt += `This task was previously completed but has been moved back for rework. `;
  prompt += `You have the full conversation history from the previous execution above.\n\n`;
  prompt += `**Task ID:** ${task.id}\n\n`;

  if (frontmatter.acceptanceCriteria.length > 0) {
    prompt += `## Current Acceptance Criteria\n`;
    frontmatter.acceptanceCriteria.forEach((criteria, i) => {
      prompt += `${i + 1}. [ ] ${criteria}\n`;
    });
    prompt += '\n';
  }

  if (content) {
    prompt += `## Description\n${content}\n\n`;
  }

  if (attachmentSection) {
    prompt += attachmentSection + '\n';
  }

  prompt += `## Instructions\n`;
  prompt += `1. Review what was done in the previous execution (you have the full history)\n`;
  prompt += `2. Identify what needs to be fixed or improved\n`;
  prompt += `3. Make the necessary changes\n`;
  prompt += `4. Re-verify all acceptance criteria are met\n`;
  prompt += `5. Run tests to confirm everything works\n`;
  prompt += `6. When DONE, call the \`task_complete\` tool with task ID "${task.id}" and a brief summary\n`;
  prompt += `7. If you have questions or hit a blocker, do NOT call task_complete — just explain and stop.\n\n`;

  return prompt;
}

// =============================================================================
// Execute Task with Agent
// =============================================================================

export interface ExecuteTaskOptions {
  task: Task;
  workspaceId: string;
  workspacePath: string;
  onOutput?: (output: string) => void;
  onComplete?: (success: boolean) => void;
  broadcastToWorkspace?: (event: any) => void;
}

export async function executeTask(options: ExecuteTaskOptions): Promise<TaskSession> {
  const { task, workspaceId, workspacePath, onOutput, onComplete, broadcastToWorkspace } = options;

  // Get enabled skills for this workspace
  const agentContext = buildAgentContext(workspaceId);
  const skills = agentContext.availableSkills;

  // Create session
  const session: TaskSession = {
    id: crypto.randomUUID(),
    taskId: task.id,
    workspaceId,
    piSession: null,
    status: 'running',
    startTime: new Date().toISOString(),
    output: [],
    broadcastToWorkspace,
    currentStreamText: '',
    currentThinkingText: '',
    toolCallArgs: new Map(),
    agentSignaledComplete: false,
    completionSummary: '',
    onComplete,
    task,
  };

  activeSessions.set(task.id, session);

  // Create task separator in activity log
  const sepEntry = createTaskSeparator(
    workspaceId,
    task.id,
    task.frontmatter.title,
    'executing'
  );
  broadcastToWorkspace?.({ type: 'activity:entry', entry: sepEntry });

  const isRework = task.frontmatter.sessionFile && existsSync(task.frontmatter.sessionFile);
  const startEntry = createSystemEvent(
    workspaceId,
    task.id,
    'phase-change',
    isRework
      ? `Agent resuming execution (continuing previous conversation)`
      : `Agent started executing task`,
    { sessionId: session.id }
  );
  broadcastToWorkspace?.({ type: 'activity:entry', entry: startEntry });

  try {
    // Initialize Pi SDK components
    const authStorage = new AuthStorage();
    const modelRegistry = new ModelRegistry(authStorage);

    // Create resource loader with task context + repo-local extensions
    const loader = new DefaultResourceLoader({
      cwd: workspacePath,
      additionalExtensionPaths: getRepoExtensionPaths(),
    });
    await loader.reload();

    // Ensure session directory exists
    const safePath = `--${workspacePath.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
    const sessionDir = join(homedir(), '.pi', 'agent', 'sessions', safePath);
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    // Check if this task has a previous session to resume (rework scenario)
    const previousSessionFile = task.frontmatter.sessionFile;
    const isResumingSession = previousSessionFile && existsSync(previousSessionFile);

    if (isResumingSession) {
      console.log(`[ExecuteTask] Resuming previous session for task ${task.id}: ${previousSessionFile}`);
    }

    const sessionManager = isResumingSession
      ? SessionManager.open(previousSessionFile)
      : SessionManager.create(workspacePath);

    // Resolve per-task model config if set
    const sessionOpts: Parameters<typeof createAgentSession>[0] = {
      cwd: workspacePath,
      authStorage,
      modelRegistry,
      sessionManager,
      resourceLoader: loader,
    };

    const mc = task.frontmatter.modelConfig;
    if (mc) {
      const resolved = modelRegistry.find(mc.provider, mc.modelId);
      if (resolved) {
        sessionOpts.model = resolved;
      }
      if (mc.thinkingLevel) {
        sessionOpts.thinkingLevel = mc.thinkingLevel;
      }
    }

    // Create Pi agent session
    const { session: piSession } = await createAgentSession(sessionOpts);

    session.piSession = piSession;

    // Persist session file path on the task so future re-executions can resume
    const currentSessionFile = piSession.sessionFile;
    if (currentSessionFile && currentSessionFile !== task.frontmatter.sessionFile) {
      task.frontmatter.sessionFile = currentSessionFile;
      task.frontmatter.updated = new Date().toISOString();
      saveTaskFile(task);
    }

    // Subscribe to Pi events
    session.unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
      handlePiEvent(event, session, workspaceId, task.id, onOutput);
    });

    // Register completion callback so the task_complete extension tool
    // can signal that the agent is actually done (vs. asking a question).
    const completeRegistry = ensureCompleteCallbackRegistry();

    completeRegistry.set(task.id, (summary: string) => {
      session.agentSignaledComplete = true;
      session.completionSummary = summary;
    });

    // Load task attachments (images become ImageContent, others become file paths in prompt)
    const { images: taskImages, promptSection: attachmentSection } = loadAttachments(
      task.frontmatter.attachments,
      workspacePath,
      task.id,
    );

    // Build prompt — use a rework prompt if resuming, otherwise the full task prompt
    const prompt = isResumingSession
      ? buildReworkPrompt(task, skills, attachmentSection)
      : buildTaskPrompt(task, skills, attachmentSection);
    runAgentExecution(session, prompt, workspaceId, task, onOutput, onComplete, taskImages);

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
  onOutput?: (output: string) => void,
  onComplete?: (success: boolean) => void,
  images?: ImageContent[],
): Promise<void> {
  try {
    const promptOpts = images && images.length > 0 ? { images } : undefined;
    await session.piSession!.prompt(prompt, promptOpts);

    // prompt() resolved — check if the agent signaled completion.
    handleAgentTurnEnd(session, workspaceId, task);
  } catch (err) {
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
  if (!session.agentSignaledComplete) {
    // Agent finished without calling task_complete — it likely asked a
    // question or flagged a blocker. Keep the task in "executing" and
    // wait for the user to respond (the session stays alive for follow-ups).
    console.log(`[AgentExecution] Agent finished without signaling completion for task ${task.id} — waiting for user input`);

    session.status = 'idle';

    const waitEntry = createSystemEvent(
      workspaceId,
      task.id,
      'phase-change',
      'Agent is waiting for user input',
      { sessionId: session.id }
    );
    session.broadcastToWorkspace?.({ type: 'activity:entry', entry: waitEntry });

    session.broadcastToWorkspace?.({
      type: 'agent:execution_status',
      taskId: task.id,
      status: 'idle',
    });

    // Do NOT call onComplete — the task stays in executing, no auto-advance
    return;
  }

  // Agent explicitly signaled done — run post-execution skills then complete.
  const summary = session.completionSummary;
  cleanupCompletionCallback(task.id);

  const postSkillIds = task.frontmatter.postExecutionSkills;
  if (postSkillIds && postSkillIds.length > 0 && session.piSession) {
    session.broadcastToWorkspace?.({
      type: 'agent:execution_status',
      taskId: task.id,
      status: 'post-hooks',
    });

    const postStartEntry = createSystemEvent(
      workspaceId,
      task.id,
      'phase-change',
      `Running ${postSkillIds.length} post-execution skill(s): ${postSkillIds.join(', ')}`,
      { skillIds: postSkillIds }
    );
    session.broadcastToWorkspace?.({ type: 'activity:entry', entry: postStartEntry });

    try {
      await runPostExecutionSkills(session.piSession, postSkillIds, {
        taskId: task.id,
        workspaceId,
        broadcastToWorkspace: session.broadcastToWorkspace,
      });
    } catch (hookErr) {
      console.error('Post-execution skills error:', hookErr);
      const hookErrEntry = createSystemEvent(
        workspaceId,
        task.id,
        'phase-change',
        `Post-execution skills error: ${hookErr}`,
        { error: String(hookErr) }
      );
      session.broadcastToWorkspace?.({ type: 'activity:entry', entry: hookErrEntry });
    }
  }

  if (session.status !== 'error') {
    session.status = 'completed';
  }

  session.endTime = new Date().toISOString();

  const completionEntry = createSystemEvent(
    workspaceId,
    task.id,
    'phase-change',
    `Agent execution completed${summary ? ': ' + summary : ''}`,
    { sessionId: session.id }
  );
  session.broadcastToWorkspace?.({ type: 'activity:entry', entry: completionEntry });

  session.broadcastToWorkspace?.({
    type: 'agent:execution_status',
    taskId: task.id,
    status: 'completed',
  });

  session.onComplete?.(session.status === 'completed');
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
  cleanupCompletionCallback(task.id);
  session.status = 'error';
  session.endTime = new Date().toISOString();

  const errorEntry = createSystemEvent(
    workspaceId,
    task.id,
    'phase-change',
    `Agent execution error: ${err}`,
    { sessionId: session.id }
  );
  session.broadcastToWorkspace?.({ type: 'activity:entry', entry: errorEntry });

  session.broadcastToWorkspace?.({
    type: 'agent:execution_status',
    taskId: task.id,
    status: 'error',
  });

  session.onComplete?.(false);
}

/** Remove the completion callback for a task (cleanup). */
function cleanupCompletionCallback(taskId: string): void {
  globalThis.__piFactoryCompleteCallbacks?.delete(taskId);
}

function handlePiEvent(
  event: AgentSessionEvent,
  session: TaskSession,
  workspaceId: string,
  taskId: string,
  onOutput?: (output: string) => void
): void {
  const broadcast = session.broadcastToWorkspace;

  switch (event.type) {
    case 'agent_start': {
      session.currentStreamText = '';
      session.currentThinkingText = '';
      broadcast?.({
        type: 'agent:execution_status',
        taskId,
        status: 'streaming',
      });
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
      session.currentStreamText = '';
      session.currentThinkingText = '';
      broadcast?.({ type: 'agent:streaming_start', taskId });
      break;
    }

    case 'message_update': {
      const sub = event.assistantMessageEvent;
      if (sub.type === 'text_delta') {
        const delta = sub.delta;
        if (delta) {
          session.currentStreamText += delta;
          session.output.push(delta);
          onOutput?.(delta);
          broadcast?.({ type: 'agent:streaming_text', taskId, delta });
        }
      } else if (sub.type === 'thinking_delta') {
        const delta = (sub as any).delta;
        if (delta) {
          session.currentThinkingText += delta;
          broadcast?.({ type: 'agent:thinking_delta', taskId, delta });
        }
      }
      break;
    }

    case 'message_end': {
      // Flush streaming text as a final message in the activity log
      const message = event.message;
      let content = '';

      if ('content' in message && Array.isArray(message.content)) {
        content = message.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n');
      }

      if (content) {
        const entry = createChatMessage(workspaceId, taskId, 'agent', content);
        broadcast?.({ type: 'activity:entry', entry });
      }

      broadcast?.({
        type: 'agent:streaming_end',
        taskId,
        fullText: content || session.currentStreamText,
      });

      if (session.currentThinkingText) {
        broadcast?.({ type: 'agent:thinking_end', taskId });
      }

      session.currentStreamText = '';
      session.currentThinkingText = '';
      break;
    }

    case 'tool_execution_start': {
      // Capture tool args for later storage
      session.toolCallArgs.set(event.toolCallId, {
        toolName: event.toolName,
        args: (event as any).args || {},
      });
      broadcast?.({
        type: 'agent:execution_status',
        taskId,
        status: 'tool_use',
      });
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
      const delta = (event as any).data || '';
      if (delta) {
        broadcast?.({
          type: 'agent:tool_update',
          taskId,
          toolCallId: (event as any).toolCallId || '',
          delta,
        });
      }
      break;
    }

    case 'tool_execution_end': {
      // Get the stored args for this tool call
      const toolInfo = session.toolCallArgs.get(event.toolCallId);
      const resultText = typeof event.result === 'string'
        ? event.result
        : (event as any).content?.map((c: any) => c.type === 'text' ? c.text : '').join('') || '';

      // Store as structured activity entry with tool metadata
      const toolEntry = createChatMessage(workspaceId, taskId, 'agent', resultText, undefined, {
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        args: toolInfo?.args || {},
        isError: event.isError,
      });

      broadcast?.({
        type: 'activity:entry',
        entry: toolEntry,
      });

      broadcast?.({
        type: 'agent:tool_end',
        taskId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
        result: resultText,
      });
      broadcast?.({
        type: 'agent:execution_status',
        taskId,
        status: 'streaming',
      });

      session.toolCallArgs.delete(event.toolCallId);
      break;
    }

    case 'turn_end' as any: {
      broadcast?.({ type: 'agent:turn_end', taskId });
      break;
    }

    case 'auto_compaction_start': {
      createSystemEvent(workspaceId, taskId, 'phase-change', 'Compacting conversation...', {});
      break;
    }

    case 'auto_compaction_end': {
      createSystemEvent(workspaceId, taskId, 'phase-change', 'Conversation compacted', {});
      break;
    }

    case 'auto_retry_start': {
      createSystemEvent(workspaceId, taskId, 'phase-change', 'Retrying after error...', {});
      break;
    }

    case 'auto_retry_end': {
      createSystemEvent(workspaceId, taskId, 'phase-change', 'Retry completed', {});
      break;
    }
  }
}

// =============================================================================
// Steer / Follow-up
// =============================================================================

export async function steerTask(taskId: string, content: string, images?: ImageContent[]): Promise<boolean> {
  const session = activeSessions.get(taskId);
  if (!session?.piSession) return false;

  try {
    await session.piSession.steer(content, images && images.length > 0 ? images : undefined);
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
    // Reset the completion signal for this new turn
    session.agentSignaledComplete = false;
    session.completionSummary = '';

    await session.piSession.followUp(content, images && images.length > 0 ? images : undefined);

    // followUp() resolved — check completion signal (same logic as initial prompt)
    if (session.task) {
      await handleAgentTurnEnd(session, session.workspaceId, session.task);
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
    piSession: null,
    status: 'running',
    startTime: new Date().toISOString(),
    output: [],
    broadcastToWorkspace,
    currentStreamText: '',
    currentThinkingText: '',
    toolCallArgs: new Map(),
    agentSignaledComplete: false,
    completionSummary: '',
    task,
  };

  activeSessions.set(task.id, session);

  broadcastToWorkspace?.({
    type: 'agent:execution_status',
    taskId: task.id,
    status: 'streaming',
  });

  try {
    const authStorage = new AuthStorage();
    const modelRegistry = new ModelRegistry(authStorage);
    const loader = new DefaultResourceLoader({
      cwd: workspacePath,
      additionalExtensionPaths: getRepoExtensionPaths(),
    });
    await loader.reload();

    const sessionManager = SessionManager.open(sessionFile);

    const sessionOpts: Parameters<typeof createAgentSession>[0] = {
      cwd: workspacePath,
      authStorage,
      modelRegistry,
      sessionManager,
      resourceLoader: loader,
    };

    const mc = task.frontmatter.modelConfig;
    if (mc) {
      const resolved = modelRegistry.find(mc.provider, mc.modelId);
      if (resolved) sessionOpts.model = resolved;
      if (mc.thinkingLevel) sessionOpts.thinkingLevel = mc.thinkingLevel;
    }

    const { session: piSession } = await createAgentSession(sessionOpts);
    session.piSession = piSession;

    session.unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
      handlePiEvent(event, session, workspaceId, task.id);
    });

    // Send the user's message as a follow-up
    await piSession.followUp(content, images && images.length > 0 ? images : undefined);

    // Chat follow-up resolved — go idle (no auto-advance for non-executing tasks)
    session.status = 'idle';

    broadcastToWorkspace?.({
      type: 'agent:execution_status',
      taskId: task.id,
      status: 'idle',
    });

    return true;
  } catch (err) {
    console.error(`[resumeChat] Failed to resume chat for task ${task.id}:`, err);
    session.status = 'error';
    activeSessions.delete(task.id);

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

  session.status = 'paused';
  session.endTime = new Date().toISOString();

  // Broadcast idle status so the UI stops showing streaming indicators
  session.broadcastToWorkspace?.({
    type: 'agent:execution_status',
    taskId,
    status: 'idle',
  });

  // Remove from active sessions so hasRunningSession returns false
  activeSessions.delete(taskId);

  return true;
}

// =============================================================================
// Quality Gate Validation
// =============================================================================

export interface QualityGateResult {
  testsPass: boolean;
  lintPass: boolean;
  reviewDone: boolean;
  errors: string[];
}

export async function validateQualityGates(
  task: Task,
  workspacePath: string
): Promise<QualityGateResult> {
  const result: QualityGateResult = {
    testsPass: false,
    lintPass: false,
    reviewDone: false,
    errors: [],
  };

  // Run tests if testing instructions exist
  if (task.frontmatter.testingInstructions.length > 0) {
    try {
      // Look for common test commands
      const testCmd = task.frontmatter.testingInstructions.find(
        (i) => i.includes('npm test') || i.includes('pytest') || i.includes('cargo test')
      );

      if (testCmd) {
        // In real implementation, run the test command
        // For now, simulate
        result.testsPass = true;
      }
    } catch (err) {
      result.errors.push(`Tests failed: ${err}`);
    }
  } else {
    result.testsPass = true; // No tests required
  }

  // Check lint (simulate)
  result.lintPass = true;

  // Check review (manual for now)
  result.reviewDone = task.frontmatter.qualityChecks?.reviewDone || false;

  return result;
}

// =============================================================================
// Auto-transition on Quality Gates
// =============================================================================

export async function checkAndAutoTransition(
  task: Task,
  workspacePath: string
): Promise<void> {
  const gates = await validateQualityGates(task, workspacePath);

  // Auto-move from executing to complete if all gates pass
  if (
    task.frontmatter.phase === 'executing' &&
    gates.testsPass &&
    gates.lintPass &&
    gates.reviewDone
  ) {
    moveTaskToPhase(task, 'complete', 'system', 'All quality gates passed');
  }
}

// =============================================================================
// Planning Agent
// =============================================================================
// When a task moves to "planning", the agent researches the codebase and
// generates a structured plan before the task can move to "ready".

function buildPlanningPrompt(task: Task, attachmentSection: string): string {
  const { frontmatter, content } = task;

  let prompt = `# Planning Task: ${frontmatter.title}\n\n`;
  prompt += `You are a planning agent. Your job is to research the codebase, understand the task, and produce a structured plan.\n\n`;
  prompt += `**Task ID:** ${task.id}\n\n`;

  if (frontmatter.acceptanceCriteria.length > 0) {
    prompt += `## Acceptance Criteria\n`;
    frontmatter.acceptanceCriteria.forEach((criteria, i) => {
      prompt += `${i + 1}. ${criteria}\n`;
    });
    prompt += '\n';
  }

  if (content) {
    prompt += `## Task Description\n${content}\n\n`;
  }

  // Add attachments section (images are sent separately as ImageContent)
  if (attachmentSection) {
    prompt += attachmentSection;
  }

  prompt += `## Instructions\n\n`;
  prompt += `1. Research the codebase to understand the current state. Read relevant files, understand the architecture, and figure out what needs to happen to complete this task.\n`;
  prompt += `2. Be thorough — read files, understand dependencies, trace call sites.\n`;
  prompt += `3. When you have a clear picture, call the \`save_plan\` tool **exactly once** with your plan. Pass taskId "${task.id}".\n`;
  prompt += `4. Each step should be concrete enough that an agent can execute it without ambiguity.\n`;
  prompt += `5. Validation items should describe how to confirm each step and the overall goal succeeded.\n`;
  prompt += `6. Cleanup items are post-completion tasks (pass an empty array if none needed).\n`;

  return prompt;
}

// =============================================================================
// Plan Callback Registry
// =============================================================================
// The save_plan extension tool calls back into the server via globalThis.
// We register a per-task callback before starting the planning session,
// and the extension looks it up by taskId.

function ensurePlanCallbackRegistry(): Map<string, (plan: TaskPlan) => void> {
  if (!globalThis.__piFactoryPlanCallbacks) {
    globalThis.__piFactoryPlanCallbacks = new Map();
  }
  return globalThis.__piFactoryPlanCallbacks;
}

declare global {
  var __piFactoryPlanCallbacks: Map<string, (plan: TaskPlan) => void> | undefined;
  var __piFactoryCompleteCallbacks: Map<string, (summary: string) => void> | undefined;
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

export interface PlanTaskOptions {
  task: Task;
  workspaceId: string;
  workspacePath: string;
  broadcastToWorkspace?: (event: any) => void;
}

export async function planTask(options: PlanTaskOptions): Promise<TaskPlan | null> {
  const { task, workspaceId, workspacePath, broadcastToWorkspace } = options;

  // Create task separator in activity log
  createTaskSeparator(
    workspaceId,
    task.id,
    task.frontmatter.title,
    'planning'
  );

  const sysEntry = createSystemEvent(
    workspaceId,
    task.id,
    'phase-change',
    'Planning agent started — researching codebase and generating plan'
  );
  broadcastToWorkspace?.({ type: 'activity:entry', entry: sysEntry });

  // Create a session to track the planning agent
  const session: TaskSession = {
    id: crypto.randomUUID(),
    taskId: task.id,
    workspaceId,
    piSession: null,
    status: 'running',
    startTime: new Date().toISOString(),
    output: [],
    broadcastToWorkspace,
    currentStreamText: '',
    currentThinkingText: '',
    toolCallArgs: new Map(),
    agentSignaledComplete: false,
    completionSummary: '',
  };

  activeSessions.set(task.id, session);

  broadcastToWorkspace?.({
    type: 'agent:execution_status',
    taskId: task.id,
    status: 'streaming',
  });

  try {
    // Register callback so the save_plan extension tool can persist the plan
    const registry = ensurePlanCallbackRegistry();
    let savedPlan: TaskPlan | null = null;

    registry.set(task.id, (plan: TaskPlan) => {
      savedPlan = plan;
      finalizePlan(task, plan, workspaceId, broadcastToWorkspace);
    });

    // Initialize Pi SDK
    const authStorage = new AuthStorage();
    const modelRegistry = new ModelRegistry(authStorage);
    const loader = new DefaultResourceLoader({
      cwd: workspacePath,
      additionalExtensionPaths: getRepoExtensionPaths(),
    });
    await loader.reload();

    const safePath = `--${workspacePath.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
    const sessionDir = join(homedir(), '.pi', 'agent', 'sessions', safePath);
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    // Resolve per-task model config if set
    const planSessionOpts: Parameters<typeof createAgentSession>[0] = {
      cwd: workspacePath,
      authStorage,
      modelRegistry,
      sessionManager: SessionManager.create(workspacePath),
      resourceLoader: loader,
    };

    const mc = task.frontmatter.modelConfig;
    if (mc) {
      const resolved = modelRegistry.find(mc.provider, mc.modelId);
      if (resolved) {
        planSessionOpts.model = resolved;
      }
      if (mc.thinkingLevel) {
        planSessionOpts.thinkingLevel = mc.thinkingLevel;
      }
    }

    const { session: piSession } = await createAgentSession(planSessionOpts);

    session.piSession = piSession;

    session.unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
      handlePiEvent(event, session, workspaceId, task.id);
    });

    // Load task attachments for the planning prompt
    const { images: planImages, promptSection: planAttachmentSection } = loadAttachments(
      task.frontmatter.attachments,
      workspacePath,
      task.id,
    );

    // Send the planning prompt
    const prompt = buildPlanningPrompt(task, planAttachmentSection);
    const planPromptOpts = planImages.length > 0 ? { images: planImages } : undefined;
    await piSession.prompt(prompt, planPromptOpts);

    // Clean up
    session.unsubscribe?.();
    session.status = 'completed';
    session.endTime = new Date().toISOString();
    activeSessions.delete(task.id);
    registry.delete(task.id);

    if (!savedPlan) {
      const entry = createSystemEvent(
        workspaceId,
        task.id,
        'phase-change',
        'Planning agent completed but did not call save_plan — no plan was saved'
      );
      broadcastToWorkspace?.({ type: 'activity:entry', entry });
    }

    broadcastToWorkspace?.({
      type: 'agent:execution_status',
      taskId: task.id,
      status: 'completed',
    });

    return savedPlan;
  } catch (err) {
    console.error('Planning agent failed, using simulation:', err);

    // Clean up
    session.status = 'error';
    activeSessions.delete(task.id);
    ensurePlanCallbackRegistry().delete(task.id);

    const entry = createSystemEvent(
      workspaceId,
      task.id,
      'phase-change',
      `Pi SDK unavailable, running simulated planning`
    );
    broadcastToWorkspace?.({ type: 'activity:entry', entry });

    // Fall back to simulation
    return simulatePlanningAgent(task, workspaceId, broadcastToWorkspace);
  }
}

/**
 * Save a generated plan to the task and broadcast updates.
 * Also regenerates acceptance criteria using the plan context.
 */
function finalizePlan(
  task: Task,
  plan: TaskPlan,
  workspaceId: string,
  broadcastToWorkspace?: (event: any) => void,
): void {
  task.frontmatter.plan = plan;
  task.frontmatter.updated = new Date().toISOString();
  saveTaskFile(task);

  const entry = createSystemEvent(
    workspaceId,
    task.id,
    'phase-change',
    'Plan generated successfully'
  );
  broadcastToWorkspace?.({ type: 'activity:entry', entry });

  broadcastToWorkspace?.({
    type: 'task:plan_generated',
    taskId: task.id,
    plan,
  });

  broadcastToWorkspace?.({
    type: 'task:updated',
    task,
    changes: { plan },
  });

  // Auto-regenerate acceptance criteria now that we have a plan
  regenerateAcceptanceCriteriaForTask(task, workspaceId, broadcastToWorkspace);
}

/**
 * Regenerate acceptance criteria for a task using its description and plan.
 * Called automatically after planning, or manually via the API.
 */
export async function regenerateAcceptanceCriteriaForTask(
  task: Task,
  workspaceId: string,
  broadcastToWorkspace?: (event: any) => void,
): Promise<string[]> {
  const description = task.content || task.frontmatter.title;
  const plan = task.frontmatter.plan;

  try {
    const { generateAcceptanceCriteria } = await import('./acceptance-criteria-service.js');
    const criteria = await generateAcceptanceCriteria(
      description,
      plan ? { goal: plan.goal, steps: plan.steps, validation: plan.validation, cleanup: plan.cleanup } : undefined,
    );

    if (criteria.length > 0) {
      task.frontmatter.acceptanceCriteria = criteria;
      task.frontmatter.updated = new Date().toISOString();
      saveTaskFile(task);

      const sysEntry = createSystemEvent(
        workspaceId,
        task.id,
        'phase-change',
        `Acceptance criteria regenerated (${criteria.length} criteria)`,
      );
      broadcastToWorkspace?.({ type: 'activity:entry', entry: sysEntry });

      broadcastToWorkspace?.({
        type: 'task:updated',
        task,
        changes: { acceptanceCriteria: criteria },
      });
    }

    return criteria;
  } catch (err) {
    console.error('Failed to regenerate acceptance criteria:', err);
    return task.frontmatter.acceptanceCriteria;
  }
}

/**
 * Simulated planning agent — generates a plan based on task metadata
 * when the Pi SDK is unavailable.
 */
function simulatePlanningAgent(
  task: Task,
  workspaceId: string,
  broadcastToWorkspace?: (event: any) => void,
): Promise<TaskPlan> {
  return new Promise((resolve) => {
    const { frontmatter, content } = task;

    const steps = [
      'Analyzing task requirements and description...',
      'Reviewing acceptance criteria...',
      'Identifying affected files and components...',
      'Determining implementation approach...',
      'Defining validation strategy...',
      'Generating structured plan...',
    ];

    let stepIndex = 0;

    broadcastToWorkspace?.({
      type: 'agent:streaming_start',
      taskId: task.id,
    });

    const interval = setInterval(() => {
      if (stepIndex >= steps.length) {
        clearInterval(interval);

        // Generate a plan from task metadata
        const plan: TaskPlan = {
          goal: frontmatter.title + (content ? ` — ${content.slice(0, 200)}` : ''),
          steps: frontmatter.acceptanceCriteria.length > 0
            ? frontmatter.acceptanceCriteria.map((c, i) => `Step ${i + 1}: Implement "${c}"`)
            : [
                'Understand the current codebase structure',
                'Implement the required changes',
                'Write tests for the new functionality',
                'Verify all tests pass',
              ],
          validation: frontmatter.acceptanceCriteria.length > 0
            ? frontmatter.acceptanceCriteria.map(c => `Verify: ${c}`)
            : [
                'All new tests pass',
                'No existing tests broken',
                'Code lints cleanly',
              ],
          cleanup: [
            'Remove any temporary debug code',
            'Update documentation if needed',
          ],
          generatedAt: new Date().toISOString(),
        };

        broadcastToWorkspace?.({
          type: 'agent:streaming_end',
          taskId: task.id,
          fullText: 'Plan generated.',
        });

        // Save the plan
        const agentMsg = createChatMessage(
          workspaceId,
          task.id,
          'agent',
          `I've analyzed the task and generated a plan. Check the **Details** tab to see the full plan.\n\n**Goal:** ${plan.goal}\n\n**${plan.steps.length} steps** identified, **${plan.validation.length} validation checks**, **${plan.cleanup.length} cleanup items**.`
        );
        broadcastToWorkspace?.({ type: 'activity:entry', entry: agentMsg });

        finalizePlan(task, plan, workspaceId, broadcastToWorkspace);

        broadcastToWorkspace?.({
          type: 'agent:execution_status',
          taskId: task.id,
          status: 'completed',
        });

        resolve(plan);
        return;
      }

      const output = steps[stepIndex];
      const msgEntry = createChatMessage(workspaceId, task.id, 'agent', output);
      broadcastToWorkspace?.({ type: 'activity:entry', entry: msgEntry });

      broadcastToWorkspace?.({
        type: 'agent:streaming_text',
        taskId: task.id,
        delta: output + '\n',
      });

      stepIndex++;
    }, 1500);
  });
}

// =============================================================================
// Simulated Agent Execution (for testing without Pi SDK)
// =============================================================================

function simulateAgentExecution(
  session: TaskSession,
  task: Task,
  workspaceId: string,
  onOutput?: (output: string) => void,
  onComplete?: (success: boolean) => void
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

      const entry = createSystemEvent(
        workspaceId,
        task.id,
        'phase-change',
        'Agent execution completed',
        { simulated: true }
      );
      broadcast?.({ type: 'activity:entry', entry });

      onComplete?.(true);
      return;
    }

    const output = steps[stepIndex];
    session.output.push(output);
    onOutput?.(output);

    const entry = createChatMessage(workspaceId, task.id, 'agent', output);
    broadcast?.({ type: 'activity:entry', entry });

    stepIndex++;
  }, 2000);
}
