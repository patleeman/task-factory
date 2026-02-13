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
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
} from '@mariozechner/pi-coding-agent';
import type { Task, TaskPlan, Attachment } from '@pi-factory/shared';
import { createTaskSeparator, createChatMessage, createSystemEvent } from './activity-service.js';
import {
  buildAgentContext,
  loadWorkspaceSharedContext,
  WORKSPACE_SHARED_CONTEXT_REL_PATH,
  type PiSkill,
} from './pi-integration.js';
import { moveTaskToPhase, updateTask, saveTaskFile, parseTaskFile } from './task-service.js';
import { runPreExecutionSkills, runPostExecutionSkills } from './post-execution-skills.js';
import { withTimeout } from './with-timeout.js';
import { generateAndPersistSummary } from './summary-service.js';

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
): string {
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

  const sharedContextSection = buildWorkspaceSharedContextSection(workspaceSharedContext);
  if (sharedContextSection) {
    prompt += sharedContextSection;
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
  prompt += `5. When you are DONE with the task and all acceptance criteria are met, call the \`task_complete\` tool with this task's ID ("${task.id}") and a brief summary\n`;
  prompt += `6. If you have questions, need clarification, or hit a blocker, do NOT call task_complete — just explain the situation and stop. The user will respond.\n\n`;

  return prompt;
}

// =============================================================================
// Build Rework Prompt (for re-execution with existing conversation)
// =============================================================================

function buildReworkPrompt(
  task: Task,
  skills: PiSkill[],
  attachmentSection: string,
  workspaceSharedContext: string | null,
): string {
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

  const sharedContextSection = buildWorkspaceSharedContextSection(workspaceSharedContext);
  if (sharedContextSection) {
    prompt += sharedContextSection;
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
  const agentContext = buildAgentContext(workspaceId, undefined, workspacePath);
  const skills = agentContext.availableSkills;
  const workspaceSharedContext = loadWorkspaceSharedContext(workspacePath);

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
    toolCallOutput: new Map(),
    lastToolResultText: '',
    lastToolResultAt: 0,
    agentSignaledComplete: false,
    completionSummary: '',
    onComplete,
    task,
  };

  activeSessions.set(task.id, session);

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
    //
    // Race condition: the Pi SDK's prompt() can resolve before retries
    // finish. If the agent calls task_complete during a background retry,
    // prompt() has already returned and handleAgentTurnEnd already went
    // idle. In that case, we re-trigger the completion flow here.
    const completeRegistry = ensureCompleteCallbackRegistry();

    completeRegistry.set(task.id, (summary: string) => {
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

    // Load task attachments (images become ImageContent, others become file paths in prompt)
    const { images: taskImages, promptSection: attachmentSection } = loadAttachments(
      task.frontmatter.attachments,
      workspacePath,
      task.id,
    );

    // Build prompt — use a rework prompt if resuming, otherwise the full task prompt
    const prompt = isResumingSession
      ? buildReworkPrompt(task, skills, attachmentSection, workspaceSharedContext)
      : buildTaskPrompt(task, skills, attachmentSection, workspaceSharedContext);
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
    // Run pre-execution skills before the main prompt
    const preSkillIds = task.frontmatter.preExecutionSkills;
    if (preSkillIds && preSkillIds.length > 0 && session.piSession) {
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
      session.broadcastToWorkspace?.({
        type: 'agent:execution_status',
        taskId: task.id,
        status: 'streaming',
      });
    }

    const promptOpts = images && images.length > 0 ? { images } : undefined;
    await session.piSession!.prompt(prompt, promptOpts);

    // prompt() resolved — check if the agent signaled completion.
    // Must await so post-execution skills actually run (and errors are caught).
    await handleAgentTurnEnd(session, workspaceId, task);
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

    // Keep this as status-only (no timeline spam event).
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

  // Clean up: unsubscribe from events and remove from active sessions
  // so future chat messages can trigger resumeChat() instead of
  // falling through all branches in the activity handler.
  session.unsubscribe?.();
  activeSessions.delete(task.id);

  session.onComplete?.(wasSuccess);
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
  activeSessions.delete(task.id);

  session.onComplete?.(false);
}

/** Remove the completion callback for a task (cleanup). */
function cleanupCompletionCallback(taskId: string): void {
  globalThis.__piFactoryCompleteCallbacks?.delete(taskId);
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

function shouldSkipToolEchoMessage(session: TaskSession, content: string): boolean {
  if (!content) return false;
  if (!session.lastToolResultText) return false;

  const ageMs = Date.now() - session.lastToolResultAt;
  if (ageMs > 2500) return false;

  return content.trim() === session.lastToolResultText.trim();
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
      // Ignore non-assistant messages (user/tool/custom). We only stream
      // assistant output to the task chat UI.
      if ((event.message as any)?.role !== 'assistant') {
        break;
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
      // Only persist assistant message output. If we process user message_end
      // here, the user's own text gets echoed back as an "agent" message.
      const message = event.message as any;
      if (message?.role !== 'assistant') {
        break;
      }

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

      if (content && !shouldSkipToolEchoMessage(session, content)) {
        broadcastActivityEntry(
          broadcast,
          createChatMessage(workspaceId, taskId, 'agent', content),
          'assistant message',
        );
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
      session.toolCallOutput.set(event.toolCallId, '');
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
      const toolCallId = (event as any).toolCallId || '';
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
      broadcast?.({
        type: 'agent:execution_status',
        taskId,
        status: 'streaming',
      });

      session.lastToolResultText = finalResultText;
      session.lastToolResultAt = Date.now();
      session.toolCallArgs.delete(event.toolCallId);
      session.toolCallOutput.delete(event.toolCallId);
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
    const hasImages = !!(images && images.length > 0);

    // If the agent is currently streaming, queue as follow-up and return.
    // Do NOT run handleAgentTurnEnd here — followUp() only queues the message.
    if (session.piSession.isStreaming) {
      await session.piSession.followUp(content, hasImages ? images : undefined);
      return true;
    }

    // Agent is idle: start a new turn with prompt().
    session.status = 'running';
    session.broadcastToWorkspace?.({
      type: 'agent:execution_status',
      taskId,
      status: 'streaming',
    });

    // Reset completion flags for this new turn.
    session.agentSignaledComplete = false;
    session.completionSummary = '';

    await session.piSession.prompt(content, hasImages ? { images: images! } : undefined);

    // Turn resolved — check completion signal (same logic as initial prompt).
    if (session.task) {
      await handleAgentTurnEnd(session, session.workspaceId, session.task);
    } else {
      session.status = 'idle';
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

    // Send the user's message as a new prompt (not followUp — there's no
    // active agent turn to follow up on since we just reopened the session).
    const workspaceSharedContext = loadWorkspaceSharedContext(workspacePath);
    const sharedContextSection = buildWorkspaceSharedContextSection(workspaceSharedContext);
    const promptContent = sharedContextSection
      ? `${sharedContextSection}## User Message\n${content}`
      : content;

    await piSession.prompt(promptContent, images && images.length > 0 ? { images } : undefined);

    // Prompt resolved — go idle (no auto-advance for non-executing tasks)
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

    const sessionOpts: Parameters<typeof createAgentSession>[0] = {
      cwd: workspacePath,
      authStorage,
      modelRegistry,
      sessionManager: SessionManager.create(workspacePath),
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

    await piSession.prompt(taskContext, images && images.length > 0 ? { images } : undefined);

    // Save session file so future messages can resume
    const sessionFilePath = piSession.sessionFile;
    if (sessionFilePath) {
      task.frontmatter.sessionFile = sessionFilePath;
      task.frontmatter.updated = new Date().toISOString();
      saveTaskFile(task);
    }

    // Chat resolved — go idle (no auto-advance for non-executing tasks)
    session.status = 'idle';

    broadcastToWorkspace?.({
      type: 'agent:execution_status',
      taskId: task.id,
      status: 'idle',
    });

    return true;
  } catch (err) {
    console.error(`[startChat] Failed to start chat for task ${task.id}:`, err);
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
// Planning Agent
// =============================================================================
// The planning agent researches the codebase, generates acceptance criteria, and produces a structured plan.
// Plans are auto-generated at task creation time using planTask() below.
// This agent is kept for manual/on-demand planning scenarios.

const PLANNING_TIMEOUT_MS = 5 * 60 * 1000;
const PLANNING_DEFAULT_THINKING_LEVEL = 'low' as const;

export function buildPlanningPrompt(
  task: Task,
  attachmentSection: string,
  workspaceSharedContext: string | null,
): string {
  const { frontmatter, content } = task;

  let prompt = `# Planning Task: ${frontmatter.title}\n\n`;
  prompt += `You are a planning agent. Your job is to research the codebase, generate strong acceptance criteria, and then produce a structured plan that is easy for humans to scan quickly.\n\n`;
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

  const sharedContextSection = buildWorkspaceSharedContextSection(workspaceSharedContext);
  if (sharedContextSection) {
    prompt += sharedContextSection;
  }

  // Add attachments section (images are sent separately as ImageContent)
  if (attachmentSection) {
    prompt += attachmentSection;
  }

  prompt += `## Instructions\n\n`;
  prompt += `1. Research the codebase to understand the current state. Read relevant files, understand architecture, and trace call sites.\n`;
  prompt += `2. From your investigation, produce 3-7 specific, testable acceptance criteria for this task.\n`;
  prompt += `3. Then produce a plan that directly satisfies those acceptance criteria.\n`;
  prompt += `4. The plan is a high-level task summary for humans. Keep it concise and easy to parse.\n`;
  prompt += `5. Steps should be short outcome-focused summaries (usually 3-6 steps). Avoid line-level implementation details, exact file paths, and low-level function-by-function instructions.\n`;
  prompt += `6. Validation items must verify the acceptance criteria and overall outcome without turning into a detailed test script.\n`;
  prompt += `7. Call the \`save_plan\` tool **exactly once** with taskId "${task.id}", acceptanceCriteria, goal, steps, validation, and cleanup.\n`;
  prompt += `8. Cleanup items are post-completion tasks (pass an empty array if none needed).\n`;

  return prompt;
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

function ensurePlanCallbackRegistry(): Map<string, (data: SavedPlanningData) => void> {
  if (!globalThis.__piFactoryPlanCallbacks) {
    globalThis.__piFactoryPlanCallbacks = new Map();
  }
  return globalThis.__piFactoryPlanCallbacks;
}

declare global {
  var __piFactoryPlanCallbacks: Map<string, (data: SavedPlanningData) => void> | undefined;
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
  };

  activeSessions.set(task.id, session);

  broadcastToWorkspace?.({
    type: 'agent:execution_status',
    taskId: task.id,
    status: 'streaming',
  });

  const registry = ensurePlanCallbackRegistry();
  let savedPlan: TaskPlan | null = null;

  try {
    // Register callback so the save_plan extension tool can persist criteria + plan
    registry.set(task.id, ({ acceptanceCriteria, plan }: SavedPlanningData) => {
      savedPlan = plan;
      finalizePlan(task, acceptanceCriteria, plan, workspaceId, broadcastToWorkspace);
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

    const planningSettings = SettingsManager.create(workspacePath);
    planningSettings.applyOverrides({
      retry: { enabled: false },
      compaction: { enabled: false },
    });

    // Resolve per-task model config if set
    const planSessionOpts: Parameters<typeof createAgentSession>[0] = {
      cwd: workspacePath,
      authStorage,
      modelRegistry,
      sessionManager: SessionManager.create(workspacePath),
      resourceLoader: loader,
      settingsManager: planningSettings,
      thinkingLevel: PLANNING_DEFAULT_THINKING_LEVEL,
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
    const workspaceSharedContext = loadWorkspaceSharedContext(workspacePath);
    const prompt = buildPlanningPrompt(task, planAttachmentSection, workspaceSharedContext);
    const planPromptOpts = planImages.length > 0 ? { images: planImages } : undefined;
    const planningTimeoutMessage = `Planning timed out after ${Math.round(PLANNING_TIMEOUT_MS / 1000)} seconds`;
    await withTimeout(
      async (signal) => {
        signal.addEventListener('abort', () => {
          void piSession.abort().catch(() => undefined);
        }, { once: true });
        await piSession.prompt(prompt, planPromptOpts);
      },
      PLANNING_TIMEOUT_MS,
      planningTimeoutMessage,
    );

    // Clean up
    session.unsubscribe?.();
    session.status = 'completed';
    session.endTime = new Date().toISOString();
    activeSessions.delete(task.id);
    registry.delete(task.id);

    if (!savedPlan) {
      const erroredTask = persistPlanningMutation(task, (latestTask) => {
        latestTask.frontmatter.planningStatus = 'error';
        latestTask.frontmatter.updated = new Date().toISOString();
      });

      broadcastToWorkspace?.({
        type: 'task:updated',
        task: erroredTask,
        changes: {},
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
    const errMessage = err instanceof Error ? err.message : String(err);

    // If a plan was already persisted via save_plan, treat this as a successful
    // completion (the failure happened after the important state was saved).
    if (savedPlan) {
      session.unsubscribe?.();
      try {
        await session.piSession?.abort();
      } catch {
        // Ignore — session may already be ended.
      }
      session.status = 'completed';
      session.endTime = new Date().toISOString();
      activeSessions.delete(task.id);
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
    activeSessions.delete(task.id);
    registry.delete(task.id);

    const erroredTask = persistPlanningMutation(task, (latestTask) => {
      latestTask.frontmatter.planningStatus = 'error';
      latestTask.frontmatter.updated = new Date().toISOString();
    });

    broadcastToWorkspace?.({
      type: 'task:updated',
      task: erroredTask,
      changes: {},
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
function finalizePlan(
  task: Task,
  acceptanceCriteria: string[],
  plan: TaskPlan,
  workspaceId: string,
  broadcastToWorkspace?: (event: any) => void,
): void {
  const normalizedCriteria = acceptanceCriteria
    .map((criterion) => criterion.trim())
    .filter(Boolean);

  const updatedTask = persistPlanningMutation(task, (latestTask) => {
    latestTask.frontmatter.acceptanceCriteria = normalizedCriteria;
    latestTask.frontmatter.plan = plan;
    latestTask.frontmatter.planningStatus = 'completed';
    latestTask.frontmatter.updated = new Date().toISOString();
  });

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
    task: updatedTask,
    changes: { acceptanceCriteria: normalizedCriteria, plan },
  });
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
  } catch (err) {
    console.error('Failed to regenerate acceptance criteria:', err);
    return task.frontmatter.acceptanceCriteria;
  }
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
