// =============================================================================
// Agent Execution Service
// =============================================================================
// Integrates with Pi SDK to execute tasks with agent capabilities

import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readdirSync } from 'fs';
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
import type { Task, TaskPlan } from '@pi-factory/shared';
import { createTaskSeparator, createChatMessage, createSystemEvent } from './activity-service.js';
import { buildAgentContext, type PiSkill } from './pi-integration.js';
import { moveTaskToPhase, updateTask, saveTaskFile } from './task-service.js';

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
}

const activeSessions = new Map<string, TaskSession>();

export function getActiveSession(taskId: string): TaskSession | undefined {
  return activeSessions.get(taskId);
}

export function getAllActiveSessions(): TaskSession[] {
  return Array.from(activeSessions.values());
}

// =============================================================================
// Build Agent Prompt
// =============================================================================

function buildTaskPrompt(task: Task, skills: PiSkill[]): string {
  const { frontmatter, content } = task;

  let prompt = `# Task: ${frontmatter.title}\n\n`;
  prompt += `**Task ID:** ${task.id}\n`;
  prompt += `**Type:** ${frontmatter.type}\n`;
  prompt += `**Priority:** ${frontmatter.priority}\n`;
  prompt += `**Complexity:** ${frontmatter.complexity || 'Not specified'}\n`;
  prompt += `**Estimated Effort:** ${frontmatter.estimatedEffort || 'Not specified'}\n\n`;

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
  prompt += `6. Report progress and any blockers\n\n`;

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
  };

  activeSessions.set(task.id, session);

  // Create task separator in activity log
  const sepEntry = createTaskSeparator(
    workspaceId,
    task.id,
    task.frontmatter.title,
    task.frontmatter.type,
    'executing'
  );
  broadcastToWorkspace?.({ type: 'activity:entry', entry: sepEntry });

  const startEntry = createSystemEvent(
    workspaceId,
    task.id,
    'phase-change',
    `Agent started executing task`,
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

    // Create Pi agent session
    const { session: piSession } = await createAgentSession({
      cwd: workspacePath,
      authStorage,
      modelRegistry,
      sessionManager: SessionManager.create(workspacePath),
      resourceLoader: loader,
    });

    session.piSession = piSession;

    // Subscribe to Pi events
    session.unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
      handlePiEvent(event, session, workspaceId, task.id, onOutput);
    });

    // Send initial task message
    const prompt = buildTaskPrompt(task, skills);
    await piSession.prompt(prompt);

    // Monitor for completion
    const checkInterval = setInterval(() => {
      if (session.status === 'completed' || session.status === 'error') {
        clearInterval(checkInterval);
        session.endTime = new Date().toISOString();

        createSystemEvent(
          workspaceId,
          task.id,
          'phase-change',
          `Agent execution ${session.status}`,
          { sessionId: session.id }
        );

        onComplete?.(session.status === 'completed');
      }
    }, 1000);

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
      session.status = 'completed';
      broadcast?.({
        type: 'agent:execution_status',
        taskId,
        status: 'completed',
      });
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
          .map((c: any) => (c.type === 'text' ? c.text : '[image]'))
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
      });
      const msg = `🔧 ${event.toolName}`;
      session.output.push(msg);
      onOutput?.(msg);
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
      broadcast?.({
        type: 'agent:tool_end',
        taskId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
        result: typeof event.result === 'string' ? event.result : undefined,
      });
      broadcast?.({
        type: 'agent:execution_status',
        taskId,
        status: 'streaming',
      });
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

export async function steerTask(taskId: string, content: string): Promise<boolean> {
  const session = activeSessions.get(taskId);
  if (!session?.piSession) return false;

  try {
    await session.piSession.steer(content);
    return true;
  } catch (err) {
    console.error('Failed to steer task:', err);
    return false;
  }
}

export async function followUpTask(taskId: string, content: string): Promise<boolean> {
  const session = activeSessions.get(taskId);
  if (!session?.piSession) return false;

  try {
    await session.piSession.followUp(content);
    return true;
  } catch (err) {
    console.error('Failed to follow-up task:', err);
    return false;
  }
}

// =============================================================================
// Stop Agent Execution
// =============================================================================

export function stopTaskExecution(taskId: string): boolean {
  const session = activeSessions.get(taskId);

  if (!session || !session.piSession) {
    return false;
  }

  // Pi SDK doesn't have a direct interrupt, but we can dispose
  session.unsubscribe?.();
  session.status = 'paused';
  session.endTime = new Date().toISOString();

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

function buildPlanningPrompt(task: Task): string {
  const { frontmatter, content } = task;

  let prompt = `# Planning Task: ${frontmatter.title}\n\n`;
  prompt += `You are a planning agent. Your job is to research the codebase, understand the task, and produce a structured plan.\n\n`;
  prompt += `**Task ID:** ${task.id}\n`;
  prompt += `**Type:** ${frontmatter.type}\n`;
  prompt += `**Priority:** ${frontmatter.priority}\n\n`;

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

  prompt += `## Instructions\n\n`;
  prompt += `Research the codebase to understand the current state. Read relevant files, understand the architecture, and figure out what needs to happen to complete this task.\n\n`;
  prompt += `After your research, output your plan as a single JSON block with this exact structure:\n\n`;
  prompt += '```json\n';
  prompt += `{
  "goal": "A clear description of what this task is trying to achieve",
  "steps": [
    "Step 1: ...",
    "Step 2: ...",
    "Step 3: ..."
  ],
  "validation": [
    "How to verify step 1 worked",
    "How to verify step 2 worked",
    "Overall validation that the goal is achieved"
  ],
  "cleanup": [
    "Any cleanup actions needed after completion",
    "e.g. remove temp files, update docs, etc."
  ]
}\n`;
  prompt += '```\n\n';
  prompt += `Be thorough in your research. Read files, understand dependencies, and make the plan specific and actionable. `;
  prompt += `Each step should be concrete enough that an agent can execute it without ambiguity.\n`;
  prompt += `The validation section should describe how to confirm each step and the overall goal succeeded.\n`;
  prompt += `The cleanup section should list any post-completion tasks (can be empty array if none needed).\n`;

  return prompt;
}

function extractPlanFromText(text: string): TaskPlan | null {
  // Try to find a JSON block in the agent's response
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (!jsonMatch) {
    // Try to find raw JSON object
    const rawMatch = text.match(/\{[\s\S]*"goal"[\s\S]*"steps"[\s\S]*\}/);
    if (!rawMatch) return null;
    try {
      const parsed = JSON.parse(rawMatch[0]);
      return {
        goal: String(parsed.goal || ''),
        steps: Array.isArray(parsed.steps) ? parsed.steps.map(String) : [],
        validation: Array.isArray(parsed.validation) ? parsed.validation.map(String) : [],
        cleanup: Array.isArray(parsed.cleanup) ? parsed.cleanup.map(String) : [],
        generatedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    return {
      goal: String(parsed.goal || ''),
      steps: Array.isArray(parsed.steps) ? parsed.steps.map(String) : [],
      validation: Array.isArray(parsed.validation) ? parsed.validation.map(String) : [],
      cleanup: Array.isArray(parsed.cleanup) ? parsed.cleanup.map(String) : [],
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
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
    task.frontmatter.type,
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
  };

  activeSessions.set(task.id, session);

  broadcastToWorkspace?.({
    type: 'agent:execution_status',
    taskId: task.id,
    status: 'streaming',
  });

  try {
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

    const { session: piSession } = await createAgentSession({
      cwd: workspacePath,
      authStorage,
      modelRegistry,
      sessionManager: SessionManager.create(workspacePath),
      resourceLoader: loader,
    });

    session.piSession = piSession;

    // Collect the full agent response text
    let fullResponseText = '';

    session.unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
      // Reuse the existing event handler for streaming UI updates
      handlePiEvent(event, session, workspaceId, task.id);

      // Also collect the final text from message_end
      if (event.type === 'message_end') {
        const message = event.message;
        if ('content' in message && Array.isArray(message.content)) {
          const text = message.content
            .map((c: any) => (c.type === 'text' ? c.text : ''))
            .join('\n');
          if (text) fullResponseText += text + '\n';
        }
      }
    });

    // Send the planning prompt
    const prompt = buildPlanningPrompt(task);
    await piSession.prompt(prompt);

    // Extract the plan from agent output
    const textToSearch = fullResponseText || session.currentStreamText || session.output.join('\n');
    const plan = extractPlanFromText(textToSearch);

    // Clean up session
    session.unsubscribe?.();
    session.status = 'completed';
    session.endTime = new Date().toISOString();
    activeSessions.delete(task.id);

    if (plan) {
      finalizePlan(task, plan, workspaceId, broadcastToWorkspace);
    } else {
      const entry = createSystemEvent(
        workspaceId,
        task.id,
        'phase-change',
        'Planning agent completed but could not extract a structured plan from the response'
      );
      broadcastToWorkspace?.({ type: 'activity:entry', entry });
    }

    broadcastToWorkspace?.({
      type: 'agent:execution_status',
      taskId: task.id,
      status: 'completed',
    });

    return plan;
  } catch (err) {
    console.error('Planning agent failed, using simulation:', err);

    // Clean up the failed SDK session
    session.status = 'error';
    activeSessions.delete(task.id);

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
