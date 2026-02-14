#!/usr/bin/env node
// =============================================================================
// Task Factory Server
// =============================================================================
// Express + WebSocket server for the TPS-inspired agent work queue

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { join, dirname, resolve, normalize } from 'path';
import { fileURLToPath } from 'url';
import { readdir } from 'fs/promises';
import { homedir } from 'os';

import type {
  Task,
  Phase,
  CreateTaskRequest,
  UpdateTaskRequest,
  ServerEvent,
  ClientEvent,
} from '@pi-factory/shared';
import { PHASES, DEFAULT_WIP_LIMITS, getWorkspaceAutomationSettings } from '@pi-factory/shared';


import {
  createTask,
  updateTask,
  moveTaskToPhase,
  discoverTasks,
  canMoveToPhase,
  parseTaskFile,
  reorderTasks,
  saveTaskFile,
  shouldResumeInterruptedPlanning,
} from './task-service.js';
import { prepareTaskUpdateRequest } from './task-update-service.js';
import {
  createWorkspace,
  loadWorkspace,
  getWorkspaceById,
  listWorkspaces,
  getTasksDir,
  deleteWorkspace,
  updateWorkspaceConfig,
} from './workspace-service.js';
import {
  createTaskSeparator,
  createChatMessage,
  createSystemEvent,
  getActivityTimeline,
  getActivityForTask,
} from './activity-service.js';
import { logger } from './logger.js';
import { buildTaskStateSnapshot } from './state-contract.js';
import { logTaskStateTransition } from './state-transition.js';
import { buildWorkspaceAttentionSummary } from './workspace-attention.js';

// =============================================================================
// Configuration
// =============================================================================

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const HOST = process.env.HOST || '127.0.0.1';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// Helpers
// =============================================================================

function buildAutomationResponse(
  workspaceConfig: import('@pi-factory/shared').WorkspaceConfig,
  queueStatus: import('@pi-factory/shared').QueueStatus,
) {
  return {
    settings: getWorkspaceAutomationSettings(workspaceConfig),
    queueStatus,
  };
}

// =============================================================================
// State
// =============================================================================

const clients = new Map<string, WebSocket>();
const workspaceSubscriptions = new Map<string, Set<string>>(); // workspaceId -> clientIds

// =============================================================================
// Express App
// =============================================================================

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Static files (client build)
// Resolve client dist path from server location
// Server is at: packages/server/dist/index.js (dev) or dist/server.js (prod)
// Client is at: packages/client/dist
const clientDistPath = process.cwd().includes('packages/server')
  ? join(__dirname, '../../../packages/client/dist')  // dev
  : join(__dirname, '../packages/client/dist');  // prod
app.use(express.static(clientDistPath));

// =============================================================================
// API Routes
// =============================================================================

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Browse directories (for folder picker)
app.get('/api/browse', async (req, res) => {
  const rawPath = (req.query.path as string) || homedir();
  const dir = resolve(rawPath.replace(/^~/, homedir()));

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const folders = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        path: join(dir, e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ current: dir, folders });
  } catch (err) {
    logger.error(`Cannot read directory: ${dir}`, err);
    res.status(400).json({ error: `Cannot read directory` });
  }
});

// List workspaces
app.get('/api/workspaces', async (_req, res) => {
  const workspaces = await listWorkspaces();
  res.json(workspaces);
});

// Workspace attention summary (tasks awaiting user input per workspace)
app.get('/api/workspaces/attention', async (_req, res) => {
  try {
    const workspaces = await listWorkspaces();
    const sessions = getAllActiveSessions();

    const taskPhaseByWorkspace = new Map<string, Map<string, Phase>>();
    for (const workspace of workspaces) {
      const phaseByTask = new Map<string, Phase>();

      try {
        const tasks = discoverTasks(getTasksDir(workspace));
        for (const task of tasks) {
          phaseByTask.set(task.id, task.frontmatter.phase);
        }
      } catch (err) {
        logger.warn('Failed to scan tasks while building workspace attention summary', {
          workspaceId: workspace.id,
          error: String(err),
        });
      }

      taskPhaseByWorkspace.set(workspace.id, phaseByTask);
    }

    const summary = buildWorkspaceAttentionSummary(
      workspaces.map((workspace) => workspace.id),
      taskPhaseByWorkspace,
      sessions,
    );

    res.json(summary);
  } catch (err) {
    logger.error('Failed to build workspace attention summary', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Create workspace
app.post('/api/workspaces', async (req, res) => {
  const { path, name, config } = req.body;

  if (!path) {
    res.status(400).json({ error: 'Path is required' });
    return;
  }

  try {
    const workspace = await createWorkspace(path, name, config);
    res.json(workspace);
  } catch (err) {
    logger.error('Failed to create workspace', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get workspace
app.get('/api/workspaces/:id', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  res.json(workspace);
});

// Delete workspace
app.delete('/api/workspaces/:id', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  try {
    // Stop queue processing if running
    try {
      stopQueueProcessing(workspace.id);
    } catch {
      // Queue may not be running — that's fine
    }

    // Stop any executing tasks in this workspace
    const tasksDir = getTasksDir(workspace);
    const tasks = discoverTasks(tasksDir);
    for (const task of tasks) {
      if (task.frontmatter.phase === 'executing') {
        try {
          await stopTaskExecution(task.id);
        } catch {
          // Best-effort
        }
      }
    }

    // Delete workspace data and remove from registry
    const deleted = await deleteWorkspace(workspace.id);

    if (!deleted) {
      res.status(500).json({ error: 'Failed to delete workspace' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Error deleting workspace', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get workspace tasks
app.get('/api/workspaces/:id/tasks', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const tasksDir = getTasksDir(workspace);
  const tasks = discoverTasks(tasksDir);

  res.json(tasks);
});

// Create task
app.post('/api/workspaces/:id/tasks', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const tasksDir = getTasksDir(workspace);
  const request = req.body as CreateTaskRequest;

  try {
    // Generate title if not provided
    let title = request.title;
    if (!title && request.content) {
      const { generateTitle } = await import('./title-service.js');
      title = await generateTitle(request.content, request.acceptanceCriteria || []);
    }

    const task = createTask(workspace.path, tasksDir, request, title);

    // Broadcast to subscribers
    broadcastToWorkspace(workspace.id, {
      type: 'task:created',
      task,
    });

    // Add system event
    await createSystemEvent(workspace.id, task.id, 'task-created', `Task ${task.id} created`);

    res.json(task);

    // Generate plan asynchronously using the planning agent (explores codebase)
    if (!task.frontmatter.plan && task.content) {
      planTask({
        task,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        broadcastToWorkspace: (event: any) => broadcastToWorkspace(workspace.id, event),
      }).catch((err) => {
        logger.error('Background plan generation failed:', err);
      });
    }
  } catch (err) {
    logger.error('Error creating task', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get task
app.get('/api/workspaces/:workspaceId/tasks/:taskId', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const tasksDir = getTasksDir(workspace);
  const tasks = discoverTasks(tasksDir);
  const task = tasks.find((t) => t.id === req.params.taskId);

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  res.json(task);
});

// Update task
app.patch('/api/workspaces/:workspaceId/tasks/:taskId', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const tasksDir = getTasksDir(workspace);
  const tasks = discoverTasks(tasksDir);
  let task = tasks.find((t) => t.id === req.params.taskId);

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  try {
    const request = req.body as UpdateTaskRequest;
    const preparedUpdate = await prepareTaskUpdateRequest(task, request);

    task = updateTask(task, preparedUpdate.request);

    broadcastToWorkspace(workspace.id, {
      type: 'task:updated',
      task,
      changes: preparedUpdate.request as unknown as Partial<Task>,
    });

    res.json(task);
  } catch (err) {
    logger.error('Error updating task', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Regenerate task plan
app.post('/api/workspaces/:workspaceId/tasks/:taskId/plan/regenerate', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const tasksDir = getTasksDir(workspace);
  const tasks = discoverTasks(tasksDir);
  const task = tasks.find((t) => t.id === req.params.taskId);

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  if (task.frontmatter.plan) {
    res.status(409).json({ error: 'Task already has a plan' });
    return;
  }

  if (task.frontmatter.planningStatus === 'running') {
    res.status(409).json({ error: 'Plan generation is already running for this task' });
    return;
  }

  res.json({ success: true });

  void planTask({
    task,
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    broadcastToWorkspace: (event: ServerEvent) => broadcastToWorkspace(workspace.id, event),
  }).catch((err) => {
    logger.error('Plan regeneration failed:', err);
  });
});

// Regenerate acceptance criteria
app.post('/api/workspaces/:workspaceId/tasks/:taskId/acceptance-criteria/regenerate', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const tasksDir = getTasksDir(workspace);
  const tasks = discoverTasks(tasksDir);
  const task = tasks.find((t) => t.id === req.params.taskId);

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  try {
    const acceptanceCriteria = await regenerateAcceptanceCriteriaForTask(
      task,
      workspace.id,
      (event: ServerEvent) => broadcastToWorkspace(workspace.id, event),
    );

    res.json({ acceptanceCriteria });
  } catch (err) {
    logger.error('Acceptance criteria regeneration failed:', err);
    res.status(500).json({ error: 'Acceptance criteria regeneration failed' });
  }
});

// Delete task
app.delete('/api/workspaces/:workspaceId/tasks/:taskId', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const tasksDir = getTasksDir(workspace);
  const tasks = discoverTasks(tasksDir);
  const task = tasks.find((t) => t.id === req.params.taskId);

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  try {
    const { deleteTask } = await import('./task-service.js');
    deleteTask(task);

    res.json({ success: true });
  } catch (err) {
    logger.error('Error deleting task', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Move task to phase
app.post('/api/workspaces/:workspaceId/tasks/:taskId/move', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const { toPhase, reason } = req.body as { toPhase: Phase; reason?: string };

  const tasksDir = getTasksDir(workspace);
  const tasks = discoverTasks(tasksDir);
  let task = tasks.find((t) => t.id === req.params.taskId);

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  // Validate move
  const validation = canMoveToPhase(task, toPhase);
  if (!validation.allowed) {
    res.status(400).json({ error: validation.reason });
    return;
  }

  // Check WIP limits
  const wipLimit = workspace.config.wipLimits?.[toPhase] ?? DEFAULT_WIP_LIMITS[toPhase];
  if (wipLimit !== null && wipLimit !== undefined) {
    const tasksInPhase = tasks.filter((t) => t.frontmatter.phase === toPhase);
    if (tasksInPhase.length >= wipLimit && task.frontmatter.phase !== toPhase) {
      res.status(400).json({
        error: `WIP limit reached for ${toPhase} (${wipLimit})`,
        wipBreach: true,
      });
      return;
    }
  }

  const fromPhase = task.frontmatter.phase;

  // If moving out of executing, stop the agent session first
  if (fromPhase === 'executing' && toPhase !== 'executing') {
    await stopTaskExecution(task.id);

    const pauseEntry = await createSystemEvent(
      workspace.id,
      task.id,
      'phase-change',
      'Agent execution paused — task moved out of executing',
      { fromPhase, toPhase }
    );
    broadcastToWorkspace(workspace.id, { type: 'activity:entry', entry: pauseEntry });
  }

  try {
    const fromState = buildTaskStateSnapshot(task.frontmatter);

    task = moveTaskToPhase(task, toPhase, 'user', reason, tasks);

    await logTaskStateTransition({
      workspaceId: workspace.id,
      taskId: task.id,
      from: fromState,
      to: buildTaskStateSnapshot(task.frontmatter),
      source: 'task:move',
      reason: reason || `Moved from ${fromPhase} to ${toPhase}`,
      broadcastToWorkspace: (event) => broadcastToWorkspace(workspace.id, event),
    });

    // Create system event
    await createSystemEvent(
      workspace.id,
      task.id,
      'phase-change',
      `Moved from ${fromPhase} to ${toPhase}`,
      { fromPhase, toPhase }
    );

    // Create task separator in activity log when moving to executing
    // or when moving backward (re-work) so the task appears at the
    // bottom of the activity timeline as the current work item.
    const fromIndex = PHASES.indexOf(fromPhase);
    const toIndex = PHASES.indexOf(toPhase);
    const isBackwardMove = toIndex < fromIndex;

    if (toPhase === 'executing' || isBackwardMove) {
      await createTaskSeparator(
        workspace.id,
        task.id,
        task.frontmatter.title,
        toPhase
      );
    }

    broadcastToWorkspace(workspace.id, {
      type: 'task:moved',
      task,
      from: fromPhase,
      to: toPhase,
    });

    // If a task moved to "ready", kick the queue manager to pick it up
    if (toPhase === 'ready') {
      kickQueue(workspace.id);
    }

    // If moved out of executing, kick queue to process next ready task
    if (fromPhase === 'executing' && toPhase !== 'executing') {
      kickQueue(workspace.id);
    }

    res.json(task);
  } catch (err) {
    logger.error('Error moving task', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Reorder tasks within a phase
app.post('/api/workspaces/:workspaceId/tasks/reorder', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const { phase, taskIds } = req.body as { phase: Phase; taskIds: string[] };

  if (!phase || !Array.isArray(taskIds)) {
    res.status(400).json({ error: 'phase and taskIds[] are required' });
    return;
  }

  try {
    const tasksDir = getTasksDir(workspace);
    const reordered = reorderTasks(tasksDir, phase, taskIds);

    broadcastToWorkspace(workspace.id, {
      type: 'task:reordered',
      phase,
      taskIds,
    });

    res.json({ success: true, count: reordered.length });
  } catch (err) {
    logger.error('Error reordering tasks', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get activity log
app.get('/api/workspaces/:id/activity', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
  const entries = await getActivityTimeline(workspace.id, limit);

  res.json(entries);
});

// Get activity for specific task
app.get('/api/workspaces/:workspaceId/tasks/:taskId/activity', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
  const entries = await getActivityForTask(workspace.id, req.params.taskId, limit);

  res.json(entries);
});

// Send message to activity log
app.post('/api/workspaces/:workspaceId/activity', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const { taskId, content, role, metadata } = req.body as {
    taskId: string;
    content: string;
    role: 'user' | 'agent';
    metadata?: Record<string, unknown>;
  };

  const entry = await createChatMessage(workspace.id, taskId, role, content, undefined, metadata);

  broadcastToWorkspace(workspace.id, {
    type: 'activity:entry',
    entry,
  });

  // If user message and there's an active agent session, steer it.
  // If no active session but task is in planning, start a planning agent.
  if (role === 'user' && taskId) {
    // Load image attachments referenced by this message (if any)
    const attachmentIds = (metadata?.attachmentIds as string[]) || [];
    let chatImages: { type: 'image'; data: string; mimeType: string }[] = [];
    if (attachmentIds.length > 0) {
      const tasksDir = getTasksDir(workspace);
      const allTasks = discoverTasks(tasksDir);
      const task = allTasks.find(t => t.id === taskId);
      if (task) {
        chatImages = loadAttachmentsByIds(
          attachmentIds,
          task.frontmatter.attachments || [],
          workspace.path,
          taskId,
        );
      }
    }

    const activeSession = getActiveSession(taskId);
    if (activeSession?.piSession && activeSession.status === 'running') {
      steerTask(taskId, content, chatImages.length > 0 ? chatImages : undefined).catch((err) => {
        logger.error('Failed to steer agent with chat message:', err);
      });
    } else if (activeSession?.piSession && (activeSession.status as string) === 'idle') {
      // Agent session is open but currently idle. Send message as a new turn.
      followUpTask(taskId, content, chatImages.length > 0 ? chatImages : undefined).catch((err) => {
        logger.error('Failed to follow-up agent with chat message:', err);
      });
    } else if (!activeSession) {
      // No active session — try to resume or start fresh depending on phase
      const tasksDir = getTasksDir(workspace);
      const tasks = discoverTasks(tasksDir);
      const task = tasks.find((t) => t.id === taskId);

      if (task && task.frontmatter.sessionFile) {
        // Task has a previous conversation — resume it for chat
        resumeChat(
          task,
          workspace.id,
          workspace.path,
          content,
          (event) => broadcastToWorkspace(workspace.id, event),
          chatImages.length > 0 ? chatImages : undefined,
        ).catch((err) => {
          logger.error('Failed to resume chat for task:', err);
        });
      } else if (task) {
        // No previous session — start a fresh agent chat
        startChat(
          task,
          workspace.id,
          workspace.path,
          content,
          (event) => broadcastToWorkspace(workspace.id, event),
          chatImages.length > 0 ? chatImages : undefined,
        ).catch((err) => {
          logger.error('Failed to start chat for task:', err);
        });
      }
    }
  }

  res.json(entry);
});

// =============================================================================
// Pi Integration API
// =============================================================================

import {
  loadPiSettings,
  loadPiModels,
  discoverPiExtensions,
  discoverPiSkills,
  loadPiSkill,
  buildAgentContext,
  discoverPiThemes,
} from './pi-integration.js';
import {
  PiAuthServiceError,
  clearProviderCredential,
  loadPiAuthOverview,
  piLoginManager,
  setProviderApiKey,
} from './pi-auth-service.js';

// Get available models (from Pi SDK ModelRegistry)
app.get('/api/pi/available-models', async (_req, res) => {
  try {
    const { AuthStorage, ModelRegistry } = await import('@mariozechner/pi-coding-agent');
    const authStorage = new AuthStorage();
    const modelRegistry = new ModelRegistry(authStorage);
    const available = modelRegistry.getAvailable();
    const models = available.map((m: any) => ({
      provider: typeof m.provider === 'string' ? m.provider : m.provider?.id || 'unknown',
      id: m.id,
      name: m.name,
      reasoning: m.reasoning || false,
    }));
    res.json(models);
  } catch (err) {
    logger.error('Failed to load available models:', err);
    res.json([]);
  }
});

// Get Pi settings
app.get('/api/pi/settings', (_req, res) => {
  const settings = loadPiSettings();
  res.json(settings || {});
});

// Get Pi auth provider status and stored credential state
app.get('/api/pi/auth', async (_req, res) => {
  try {
    const overview = await loadPiAuthOverview();
    res.json(overview);
  } catch (err) {
    logger.error('Failed to load Pi auth overview:', err);
    res.status(500).json({ error: 'Failed to load auth settings' });
  }
});

// Save API key for a provider in ~/.pi/agent/auth.json
app.put('/api/pi/auth/providers/:providerId/api-key', async (req, res) => {
  const providerId = req.params.providerId;
  const apiKey = (req.body as { apiKey?: unknown }).apiKey;

  if (typeof apiKey !== 'string') {
    res.status(400).json({ error: 'apiKey must be a string' });
    return;
  }

  try {
    const provider = await setProviderApiKey(providerId, apiKey);
    res.json(provider);
  } catch (err) {
    if (err instanceof PiAuthServiceError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    logger.error(`Failed to save API key for provider ${providerId}:`, err);
    res.status(500).json({ error: 'Failed to save API key' });
  }
});

// Remove stored credential for a provider (api_key or oauth)
app.delete('/api/pi/auth/providers/:providerId', async (req, res) => {
  const providerId = req.params.providerId;

  try {
    const provider = await clearProviderCredential(providerId);
    res.json(provider);
  } catch (err) {
    if (err instanceof PiAuthServiceError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    logger.error(`Failed to clear credential for provider ${providerId}:`, err);
    res.status(500).json({ error: 'Failed to clear credential' });
  }
});

// Start OAuth login flow for a provider
app.post('/api/pi/auth/login/start', async (req, res) => {
  const providerId = (req.body as { providerId?: unknown }).providerId;

  if (typeof providerId !== 'string') {
    res.status(400).json({ error: 'providerId must be a string' });
    return;
  }

  try {
    const session = await piLoginManager.start(providerId);
    res.json(session);
  } catch (err) {
    if (err instanceof PiAuthServiceError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    logger.error(`Failed to start OAuth login for provider ${providerId}:`, err);
    res.status(500).json({ error: 'Failed to start login flow' });
  }
});

// Get OAuth login flow status
app.get('/api/pi/auth/login/:sessionId', (req, res) => {
  try {
    const session = piLoginManager.get(req.params.sessionId);
    res.json(session);
  } catch (err) {
    if (err instanceof PiAuthServiceError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    logger.error(`Failed to read OAuth login session ${req.params.sessionId}:`, err);
    res.status(500).json({ error: 'Failed to read login session' });
  }
});

// Submit input for pending OAuth login prompt/manual code request
app.post('/api/pi/auth/login/:sessionId/input', (req, res) => {
  const requestId = (req.body as { requestId?: unknown }).requestId;
  const value = (req.body as { value?: unknown }).value;

  if (typeof requestId !== 'string') {
    res.status(400).json({ error: 'requestId must be a string' });
    return;
  }

  if (typeof value !== 'string') {
    res.status(400).json({ error: 'value must be a string' });
    return;
  }

  try {
    const session = piLoginManager.submitInput(req.params.sessionId, requestId, value);
    res.json(session);
  } catch (err) {
    if (err instanceof PiAuthServiceError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    logger.error(`Failed to submit OAuth login input for session ${req.params.sessionId}:`, err);
    res.status(500).json({ error: 'Failed to submit login input' });
  }
});

// Cancel OAuth login session
app.post('/api/pi/auth/login/:sessionId/cancel', (req, res) => {
  try {
    const session = piLoginManager.cancel(req.params.sessionId);
    res.json(session);
  } catch (err) {
    if (err instanceof PiAuthServiceError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    logger.error(`Failed to cancel OAuth login session ${req.params.sessionId}:`, err);
    res.status(500).json({ error: 'Failed to cancel login session' });
  }
});

// Get Pi models
app.get('/api/pi/models', (_req, res) => {
  const models = loadPiModels();
  res.json(models || { providers: {} });
});

// Get Pi extensions (global, from ~/.pi/agent/extensions/)
app.get('/api/pi/extensions', (_req, res) => {
  const extensions = discoverPiExtensions();
  res.json(extensions);
});

// Get repo-local extensions (from Task Factory's own extensions/ dir)
app.get('/api/factory/extensions', (_req, res) => {
  const paths = getRepoExtensionPaths();
  const extensions = paths.map((p) => {
    const parts = p.split('/');
    const name = parts[parts.length - 1] === 'index.ts'
      ? parts[parts.length - 2]
      : parts[parts.length - 1].replace(/\.ts$/, '');
    return { name, path: p };
  });
  res.json(extensions);
});

// Reload repo-local extensions
app.post('/api/factory/extensions/reload', (_req, res) => {
  const paths = reloadRepoExtensions();
  res.json({ count: paths.length, paths });
});

// Get post-execution skills (Agent Skills spec)
app.get('/api/factory/skills', (_req, res) => {
  const skills = discoverPostExecutionSkills();
  res.json(skills);
});

// Create post-execution skill
app.post('/api/factory/skills', (req, res) => {
  try {
    const skillId = createFactorySkill(req.body);
    const skills = reloadPostExecutionSkills();
    const created = skills.find((skill) => skill.id === skillId);

    if (!created) {
      res.status(500).json({ error: 'Skill was created but could not be reloaded' });
      return;
    }

    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Import post-execution skill from SKILL.md content
app.post('/api/factory/skills/import', (req, res) => {
  try {
    const payload = req.body as { content?: unknown; overwrite?: unknown };
    const content = typeof payload?.content === 'string' ? payload.content : '';
    const overwrite = payload?.overwrite === true;

    const skillId = importFactorySkill(content, overwrite);
    const skills = reloadPostExecutionSkills();
    const imported = skills.find((skill) => skill.id === skillId);

    if (!imported) {
      res.status(500).json({ error: 'Skill was imported but could not be reloaded' });
      return;
    }

    res.status(overwrite ? 200 : 201).json(imported);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Reload post-execution skills
app.post('/api/factory/skills/reload', (_req, res) => {
  const skills = reloadPostExecutionSkills();
  res.json({ count: skills.length, skills: skills.map(s => s.id) });
});

// Get single post-execution skill
app.get('/api/factory/skills/:id', (req, res) => {
  const skill = getPostExecutionSkill(req.params.id);
  if (!skill) {
    res.status(404).json({ error: 'Skill not found' });
    return;
  }
  res.json(skill);
});

// Update post-execution skill
app.put('/api/factory/skills/:id', (req, res) => {
  const existing = getPostExecutionSkill(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Skill not found' });
    return;
  }

  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : {};

    const metadataFromBody = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : {};

    const payload = {
      ...body,
      metadata: {
        ...existing.metadata,
        ...metadataFromBody,
      },
    };

    const skillId = updateFactorySkill(req.params.id, payload);
    const skills = reloadPostExecutionSkills();
    const updated = skills.find((skill) => skill.id === skillId);

    if (!updated) {
      res.status(500).json({ error: 'Skill was updated but could not be reloaded' });
      return;
    }

    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Delete post-execution skill
app.delete('/api/factory/skills/:id', (req, res) => {
  const existing = getPostExecutionSkill(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Skill not found' });
    return;
  }

  try {
    deleteFactorySkill(req.params.id);
    reloadPostExecutionSkills();
    res.json({ deleted: req.params.id });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get execution wrappers
app.get('/api/wrappers', (_req, res) => {
  const wrappers = discoverWrappers();
  res.json(wrappers);
});

// Reload execution wrappers
app.post('/api/wrappers/reload', (_req, res) => {
  const wrappers = reloadWrappers();
  res.json({ count: wrappers.length, wrappers: wrappers.map(w => w.id) });
});

// Get single execution wrapper
app.get('/api/wrappers/:id', (req, res) => {
  const wrapper = getWrapper(req.params.id);
  if (!wrapper) {
    res.status(404).json({ error: 'Wrapper not found' });
    return;
  }
  res.json(wrapper);
});

// Apply wrapper to a task
app.post('/api/workspaces/:workspaceId/tasks/:taskId/apply-wrapper', async (req, res) => {
  const { wrapperId } = req.body;
  if (!wrapperId || typeof wrapperId !== 'string') {
    res.status(400).json({ error: 'wrapperId is required' });
    return;
  }

  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const tasksDir = getTasksDir(workspace);
  const allTasks = discoverTasks(tasksDir);
  const task = allTasks.find(t => t.id === req.params.taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  try {
    const updated = applyWrapper(task, wrapperId);
    updated.frontmatter.updated = new Date().toISOString();
    saveTaskFile(updated);

    broadcastToWorkspace(workspace.id, { type: 'task:updated', task: updated, changes: {} });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// Get Pi skills
app.get('/api/pi/skills', (req, res) => {
  const skillIds = req.query.ids as string[] | undefined;
  
  if (skillIds && Array.isArray(skillIds)) {
    const skills = skillIds.map(id => loadPiSkill(id)).filter(Boolean);
    res.json(skills);
  } else {
    const skills = discoverPiSkills();
    res.json(skills);
  }
});

// Get specific Pi skill
app.get('/api/pi/skills/:skillId', (req, res) => {
  const skill = loadPiSkill(req.params.skillId);
  
  if (!skill) {
    res.status(404).json({ error: 'Skill not found' });
    return;
  }
  
  res.json(skill);
});

// Get Pi themes
app.get('/api/pi/themes', (_req, res) => {
  const themes = discoverPiThemes();
  res.json(themes);
});

// Get AGENTS.md + workspace shared context (combined prompt rules)
app.get('/api/pi/agents-md', async (req, res) => {
  const workspaceId = req.query.workspace as string | undefined;

  let workspacePath: string | undefined;
  if (workspaceId) {
    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    workspacePath = workspace.path;
  }

  const context = buildAgentContext(workspaceId, undefined, workspacePath);
  res.json({ content: context.globalRules });
});

// Get agent context (combined)
app.get('/api/pi/context', async (req, res) => {
  const workspaceId = req.query.workspace as string | undefined;
  const skillIds = req.query.skills as string[] | undefined;

  let workspacePath: string | undefined;
  if (workspaceId) {
    const workspace = await getWorkspaceById(workspaceId);
    if (workspace) workspacePath = workspace.path;
  }

  const context = buildAgentContext(workspaceId, skillIds, workspacePath);
  res.json(context);
});

// =============================================================================
// Task Factory specific API
// =============================================================================

import {
  loadPiFactorySettings,
  savePiFactorySettings,
  loadWorkspacePiConfig,
  saveWorkspacePiConfig,
  getEnabledSkillsForWorkspace,
  getEnabledExtensionsForWorkspace,
  getWorkspaceSharedContextPath,
  loadWorkspaceSharedContext,
  saveWorkspaceSharedContext,
  WORKSPACE_SHARED_CONTEXT_REL_PATH,
  type PiFactorySettings,
  type WorkspacePiConfig,
} from './pi-integration.js';
import {
  loadTaskDefaults,
  saveTaskDefaults,
  parseTaskDefaultsPayload,
  validateTaskDefaults,
  loadAvailableModelsForDefaults,
} from './task-defaults-service.js';

// Get Task Factory settings
app.get('/api/pi-factory/settings', (_req, res) => {
  const settings = loadPiFactorySettings();
  res.json(settings || {});
});

// Save Task Factory settings
app.post('/api/pi-factory/settings', (req, res) => {
  try {
    const settings = req.body as PiFactorySettings;
    savePiFactorySettings(settings);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get task creation defaults
app.get('/api/task-defaults', (_req, res) => {
  res.json(loadTaskDefaults());
});

async function handleSaveTaskDefaults(req: express.Request, res: express.Response): Promise<void> {
  const parsed = parseTaskDefaultsPayload(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  try {
    const [availableModels, availableSkills] = await Promise.all([
      loadAvailableModelsForDefaults(),
      Promise.resolve(discoverPostExecutionSkills()),
    ]);

    const validation = validateTaskDefaults(
      parsed.value,
      availableModels,
      availableSkills.map((skill) => skill.id),
    );

    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const saved = saveTaskDefaults(parsed.value);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

// Save task creation defaults
app.post('/api/task-defaults', (req, res) => {
  handleSaveTaskDefaults(req, res).catch((err) => {
    res.status(500).json({ error: String(err) });
  });
});

app.put('/api/task-defaults', (req, res) => {
  handleSaveTaskDefaults(req, res).catch((err) => {
    res.status(500).json({ error: String(err) });
  });
});

// Get workspace Pi configuration
app.get('/api/workspaces/:workspaceId/pi-config', (req, res) => {
  const config = loadWorkspacePiConfig(req.params.workspaceId);
  res.json(config || { skills: { enabled: [], config: {} }, extensions: { enabled: [], config: {} } });
});

// Save workspace Pi configuration
app.post('/api/workspaces/:workspaceId/pi-config', (req, res) => {
  try {
    const config = req.body as WorkspacePiConfig;
    saveWorkspacePiConfig(req.params.workspaceId, config);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get workspace shared context (user + agent collaboration store)
app.get('/api/workspaces/:workspaceId/shared-context', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const content = loadWorkspaceSharedContext(workspace.path) || '';
  const absolutePath = getWorkspaceSharedContextPath(workspace.path);

  res.json({
    relativePath: WORKSPACE_SHARED_CONTEXT_REL_PATH,
    absolutePath,
    content,
  });
});

// Save workspace shared context (last write wins)
app.put('/api/workspaces/:workspaceId/shared-context', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const content = (req.body as { content?: unknown }).content;
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content must be a string' });
    return;
  }

  try {
    saveWorkspaceSharedContext(workspace.path, content);

    res.json({
      success: true,
      relativePath: WORKSPACE_SHARED_CONTEXT_REL_PATH,
      absolutePath: getWorkspaceSharedContextPath(workspace.path),
      content,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get enabled skills for workspace
app.get('/api/workspaces/:workspaceId/skills', (req, res) => {
  const skills = getEnabledSkillsForWorkspace(req.params.workspaceId);
  res.json(skills);
});

// Get enabled extensions for workspace
app.get('/api/workspaces/:workspaceId/extensions', (req, res) => {
  const extensions = getEnabledExtensionsForWorkspace(req.params.workspaceId);
  res.json(extensions);
});

// =============================================================================
// Task Execution API
// =============================================================================

import {
  executeTask,
  stopTaskExecution,
  steerTask,
  followUpTask,
  resumeChat,
  getActiveSession,
  getAllActiveSessions,
  getRepoExtensionPaths,
  reloadRepoExtensions,
  loadAttachmentsByIds,
  planTask,
  startChat,
  createTaskConversationSession,
  regenerateAcceptanceCriteriaForTask,
} from './agent-execution-service.js';

import {
  discoverPostExecutionSkills,
  getPostExecutionSkill,
  reloadPostExecutionSkills,
} from './post-execution-skills.js';

import {
  createFactorySkill,
  updateFactorySkill,
  deleteFactorySkill,
  importFactorySkill,
} from './skill-management-service.js';

import {
  discoverWrappers,
  getWrapper,
  reloadWrappers,
  applyWrapper,
} from './execution-wrapper-service.js';

import {
  startQueueProcessing,
  stopQueueProcessing,
  getQueueStatus,
  kickQueue,
  initializeQueueManagers,
} from './queue-manager.js';
import { buildExecutionSnapshots } from './execution-snapshot.js';

// Start task execution
app.post('/api/workspaces/:workspaceId/tasks/:taskId/execute', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  
  const tasksDir = getTasksDir(workspace);
  const tasks = discoverTasks(tasksDir);
  const task = tasks.find(t => t.id === req.params.taskId);
  
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  
  const isPlanningRunning = task.frontmatter.planningStatus === 'running' && !task.frontmatter.plan;
  if (isPlanningRunning) {
    res.status(409).json({
      error: 'Task planning is still running. Wait for planning to finish before executing this task.',
    });
    return;
  }

  // Move task to executing phase and broadcast the change
  const fromPhase = task.frontmatter.phase;
  if (fromPhase !== 'executing') {
    const fromState = buildTaskStateSnapshot(task.frontmatter);
    moveTaskToPhase(task, 'executing', 'user', 'Agent started execution', tasks);

    await logTaskStateTransition({
      workspaceId: workspace.id,
      taskId: task.id,
      from: fromState,
      to: buildTaskStateSnapshot(task.frontmatter),
      source: 'task:execute',
      reason: 'Agent started execution',
      broadcastToWorkspace: (event) => broadcastToWorkspace(workspace.id, event),
    });

    broadcastToWorkspace(workspace.id, {
      type: 'task:moved',
      task,
      from: fromPhase,
      to: 'executing',
    });
  }
  
  try {
    const session = await executeTask({
      task,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      broadcastToWorkspace: (event) => broadcastToWorkspace(workspace.id, event),
      onOutput: (output) => {
        // Output callback is for legacy/simulation only
      },
      onComplete: (success) => {
        if (success) {
          const fromState = buildTaskStateSnapshot(task.frontmatter);

          // Auto-move to complete
          moveTaskToPhase(task, 'complete', 'system', 'Execution completed');

          void logTaskStateTransition({
            workspaceId: workspace.id,
            taskId: task.id,
            from: fromState,
            to: buildTaskStateSnapshot(task.frontmatter),
            source: 'task:execute:on-complete',
            reason: 'Execution completed',
            broadcastToWorkspace: (event) => broadcastToWorkspace(workspace.id, event),
          }).catch((stateErr) => {
            logger.error('Failed to log execution completion state transition', stateErr);
          });
        }
        
        broadcastToWorkspace(workspace.id, {
          type: 'task:moved',
          task,
          from: 'executing',
          to: success ? 'complete' : 'executing',
        });

        // Kick queue manager — there's now capacity for the next task
        kickQueue(workspace.id);
      },
    });
    
    res.json({ sessionId: session.id, status: session.status });
  } catch (err) {
    logger.error('Error starting execution', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Stop task execution
app.post('/api/workspaces/:workspaceId/tasks/:taskId/stop', async (req, res) => {
  const stopped = await stopTaskExecution(req.params.taskId);
  res.json({ stopped });
});

// Steer agent (interrupt with new instruction)
app.post('/api/workspaces/:workspaceId/tasks/:taskId/steer', async (req, res) => {
  const { content, attachmentIds } = req.body as { content: string; attachmentIds?: string[] };

  if (!content) {
    res.status(400).json({ error: 'Content is required' });
    return;
  }

  // Log the user steer message in activity
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (workspace) {
    const metadata = attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : undefined;
    const entry = await createChatMessage(workspace.id, req.params.taskId, 'user', content, undefined, metadata);
    broadcastToWorkspace(workspace.id, { type: 'activity:entry', entry });
    await createSystemEvent(workspace.id, req.params.taskId, 'phase-change', 'User sent steering message');
  }

  // Load image attachments if referenced
  let steerImages: { type: 'image'; data: string; mimeType: string }[] | undefined;
  if (attachmentIds && attachmentIds.length > 0 && workspace) {
    const tasksDir = getTasksDir(workspace);
    const tasks = discoverTasks(tasksDir);
    const task = tasks.find(t => t.id === req.params.taskId);
    if (task) {
      const images = loadAttachmentsByIds(attachmentIds, task.frontmatter.attachments || [], workspace.path, req.params.taskId);
      if (images.length > 0) steerImages = images;
    }
  }

  const ok = await steerTask(req.params.taskId, content, steerImages);
  res.json({ ok });
});

// Follow-up (queue for after agent finishes)
app.post('/api/workspaces/:workspaceId/tasks/:taskId/follow-up', async (req, res) => {
  const { content, attachmentIds } = req.body as { content: string; attachmentIds?: string[] };

  if (!content) {
    res.status(400).json({ error: 'Content is required' });
    return;
  }

  // Log the user follow-up message in activity
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (workspace) {
    const metadata = attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : undefined;
    const entry = await createChatMessage(workspace.id, req.params.taskId, 'user', content, undefined, metadata);
    broadcastToWorkspace(workspace.id, { type: 'activity:entry', entry });
    await createSystemEvent(workspace.id, req.params.taskId, 'phase-change', 'User queued follow-up message');
  }

  // Load image attachments if referenced
  let followUpImages: { type: 'image'; data: string; mimeType: string }[] | undefined;
  if (attachmentIds && attachmentIds.length > 0 && workspace) {
    const tasksDir = getTasksDir(workspace);
    const tasks = discoverTasks(tasksDir);
    const task = tasks.find(t => t.id === req.params.taskId);
    if (task) {
      const images = loadAttachmentsByIds(attachmentIds, task.frontmatter.attachments || [], workspace.path, req.params.taskId);
      if (images.length > 0) followUpImages = images;
    }
  }

  const ok = await followUpTask(req.params.taskId, content, followUpImages);
  res.json({ ok });
});

// Get task execution status
app.get('/api/workspaces/:workspaceId/tasks/:taskId/execution', (req, res) => {
  const session = getActiveSession(req.params.taskId);
  
  if (!session) {
    res.status(404).json({ error: 'No active execution found' });
    return;
  }
  
  res.json({
    sessionId: session.id,
    status: session.status,
    startTime: session.startTime,
    endTime: session.endTime,
    output: session.output,
  });
});

// =============================================================================
// Post-Execution Summary API
// =============================================================================

import {
  generateAndPersistSummary,
  updateCriterionStatus,
} from './summary-service.js';

import type { CriterionStatus } from '@pi-factory/shared';

// Get post-execution summary
app.get('/api/workspaces/:workspaceId/tasks/:taskId/summary', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const tasksDir = getTasksDir(workspace);
  const tasks = discoverTasks(tasksDir);
  const task = tasks.find(t => t.id === req.params.taskId);

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  if (!task.frontmatter.postExecutionSummary) {
    res.status(404).json({ error: 'No summary exists for this task' });
    return;
  }

  res.json(task.frontmatter.postExecutionSummary);
});

// Update a criterion's validation status
app.patch('/api/workspaces/:workspaceId/tasks/:taskId/summary/criteria/:index', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const tasksDir = getTasksDir(workspace);
  const tasks = discoverTasks(tasksDir);
  const task = tasks.find(t => t.id === req.params.taskId);

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const index = parseInt(req.params.index, 10);
  if (isNaN(index)) {
    res.status(400).json({ error: 'Invalid criterion index' });
    return;
  }

  const { status, evidence } = req.body as { status: CriterionStatus; evidence?: string };
  if (!status || !['pass', 'fail', 'pending'].includes(status)) {
    res.status(400).json({ error: 'Invalid status — must be pass, fail, or pending' });
    return;
  }

  const summary = updateCriterionStatus(task, index, status, evidence || '');
  if (!summary) {
    res.status(404).json({ error: 'No summary exists or invalid index' });
    return;
  }

  broadcastToWorkspace(workspace.id, {
    type: 'task:updated',
    task,
    changes: {},
  });

  res.json(summary);
});

// Generate (or regenerate) post-execution summary
app.post('/api/workspaces/:workspaceId/tasks/:taskId/summary/generate', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const tasksDir = getTasksDir(workspace);
  const tasks = discoverTasks(tasksDir);
  const task = tasks.find(t => t.id === req.params.taskId);

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  try {
    let piSession: { prompt: (content: string) => Promise<void>; dispose?: () => void } | null = null;

    try {
      try {
        const opened = await createTaskConversationSession({
          task,
          workspacePath: workspace.path,
          purpose: 'execution',
        });
        piSession = opened.session;
      } catch (err) {
        logger.error('[SummaryGenerate] Failed to resume task conversation, falling back:', err);
      }

      const summary = await generateAndPersistSummary(task, piSession);

      broadcastToWorkspace(workspace.id, {
        type: 'task:updated',
        task,
        changes: {},
      });

      res.json(summary);
    } finally {
      piSession?.dispose?.();
    }
  } catch (err) {
    logger.error('Error generating summary', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get all active executions (debug/admin)
app.get('/api/executions', (_req, res) => {
  const sessions = getAllActiveSessions();
  res.json(sessions);
});

// Get active executions for a specific workspace
app.get('/api/workspaces/:workspaceId/executions', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const sessions = getAllActiveSessions();
  res.json(buildExecutionSnapshots(sessions, workspace.id));
});

// =============================================================================
// Queue Manager API
// =============================================================================

// Get workflow automation settings for a workspace
app.get('/api/workspaces/:workspaceId/automation', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  try {
    const queueStatus = await getQueueStatus(workspace.id);
    res.json(buildAutomationResponse(workspace.config, queueStatus));
  } catch (err) {
    logger.error('Failed to read workflow automation settings', err);
    res.status(500).json({ error: 'Failed to read workflow automation settings' });
  }
});

// Update workflow automation settings for a workspace
app.patch('/api/workspaces/:workspaceId/automation', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const { backlogToReady, readyToExecuting } = req.body as {
    backlogToReady?: unknown;
    readyToExecuting?: unknown;
  };

  if (backlogToReady !== undefined && typeof backlogToReady !== 'boolean') {
    res.status(400).json({ error: 'backlogToReady must be a boolean when provided' });
    return;
  }

  if (readyToExecuting !== undefined && typeof readyToExecuting !== 'boolean') {
    res.status(400).json({ error: 'readyToExecuting must be a boolean when provided' });
    return;
  }

  if (backlogToReady === undefined && readyToExecuting === undefined) {
    res.status(400).json({ error: 'At least one automation setting must be provided' });
    return;
  }

  try {
    const current = getWorkspaceAutomationSettings(workspace.config);
    const next = {
      backlogToReady: backlogToReady ?? current.backlogToReady,
      readyToExecuting: readyToExecuting ?? current.readyToExecuting,
    };

    const updatedWorkspace = await updateWorkspaceConfig(workspace, {
      workflowAutomation: next,
      queueProcessing: { enabled: next.readyToExecuting },
    });

    let queueStatus = await getQueueStatus(updatedWorkspace.id);
    if (readyToExecuting !== undefined) {
      queueStatus = readyToExecuting
        ? await startQueueProcessing(
          updatedWorkspace.id,
          (event) => broadcastToWorkspace(updatedWorkspace.id, event),
        )
        : await stopQueueProcessing(updatedWorkspace.id);

      await createSystemEvent(
        updatedWorkspace.id,
        '',
        'phase-change',
        readyToExecuting ? 'Auto-execution enabled' : 'Auto-execution paused',
      );
    }

    if (backlogToReady !== undefined) {
      await createSystemEvent(
        updatedWorkspace.id,
        '',
        'phase-change',
        backlogToReady
          ? 'Backlog auto-promotion enabled (planning completion → ready)'
          : 'Backlog auto-promotion paused',
      );
    }

    const settings = getWorkspaceAutomationSettings(updatedWorkspace.config);
    broadcastToWorkspace(updatedWorkspace.id, {
      type: 'workspace:automation_updated',
      workspaceId: updatedWorkspace.id,
      settings,
    });

    res.json({ settings, queueStatus });
  } catch (err) {
    logger.error('Failed to update workflow automation settings', err);
    res.status(500).json({ error: 'Failed to update workflow automation settings' });
  }
});

// Get queue status
app.get('/api/workspaces/:workspaceId/queue/status', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  const status = await getQueueStatus(workspace.id);
  res.json(status);
});

// Start queue processing
app.post('/api/workspaces/:workspaceId/queue/start', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const status = await startQueueProcessing(
    workspace.id,
    (event) => broadcastToWorkspace(workspace.id, event),
  );

  await createSystemEvent(
    workspace.id,
    '',
    'phase-change',
    'Auto-execution enabled'
  );

  res.json(status);
});

// Stop queue processing
app.post('/api/workspaces/:workspaceId/queue/stop', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const status = await stopQueueProcessing(workspace.id);

  await createSystemEvent(
    workspace.id,
    '',
    'phase-change',
    'Auto-execution paused'
  );

  res.json(status);
});

// =============================================================================
// Attachment API
// =============================================================================

import multer from 'multer';
import { mkdir, unlink, stat } from 'fs/promises';
import { extname } from 'path';

function getAttachmentsDir(workspace: import('@pi-factory/shared').Workspace, taskId: string): string {
  const tasksDir = getTasksDir(workspace);
  return join(tasksDir, taskId.toLowerCase(), 'attachments');
}

// Configure multer to store files in task-specific directories
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      (async () => {
        try {
          const workspaceId = req.params.workspaceId as string;
          const taskId = req.params.taskId as string;
          const workspace = await getWorkspaceById(workspaceId);
          if (!workspace) return cb(new Error('Workspace not found'), '');
          const dir = getAttachmentsDir(workspace, taskId);
          await mkdir(dir, { recursive: true });
          cb(null, dir);
        } catch (err) {
          cb(err as Error, '');
        }
      })();
    },
    filename: (_req, file, cb) => {
      const id = crypto.randomUUID().slice(0, 8);
      const ext = extname(file.originalname) || '';
      cb(null, `${id}${ext}`);
    },
  }),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB per file
  },
});

// Upload attachment(s) to a task
app.post('/api/workspaces/:workspaceId/tasks/:taskId/attachments', upload.array('files', 10), async (req, res) => {
  const workspaceId = req.params.workspaceId as string;
  const taskId = req.params.taskId as string;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) { res.status(404).json({ error: 'Workspace not found' }); return; }

  const tasksDir = getTasksDir(workspace);
  const tasks = discoverTasks(tasksDir);
  let task = tasks.find(t => t.id === taskId);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) { res.status(400).json({ error: 'No files provided' }); return; }

  const newAttachments: import('@pi-factory/shared').Attachment[] = files.map(f => ({
    id: f.filename.replace(extname(f.filename), ''),
    filename: f.originalname,
    storedName: f.filename,
    mimeType: f.mimetype,
    size: f.size,
    createdAt: new Date().toISOString(),
  }));

  task.frontmatter.attachments = [...(task.frontmatter.attachments || []), ...newAttachments];
  task.frontmatter.updated = new Date().toISOString();
  const { saveTaskFile } = await import('./task-service.js');
  saveTaskFile(task);

  broadcastToWorkspace(workspace.id, { type: 'task:updated', task, changes: {} });

  res.json(newAttachments);
});

// List attachments for a task
app.get('/api/workspaces/:workspaceId/tasks/:taskId/attachments', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) { res.status(404).json({ error: 'Workspace not found' }); return; }

  const tasksDir = getTasksDir(workspace);
  const tasks = discoverTasks(tasksDir);
  const task = tasks.find(t => t.id === req.params.taskId);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  res.json(task.frontmatter.attachments || []);
});

// Serve an attachment file
app.get('/api/workspaces/:workspaceId/tasks/:taskId/attachments/:storedName', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) { res.status(404).json({ error: 'Workspace not found' }); return; }

  const dir = getAttachmentsDir(workspace, req.params.taskId);
  const filePath = join(dir, req.params.storedName);

  try {
    await stat(filePath);
    res.sendFile(filePath);
  } catch {
    res.status(404).json({ error: 'Attachment not found' });
  }
});

// Delete an attachment
app.delete('/api/workspaces/:workspaceId/tasks/:taskId/attachments/:attachmentId', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) { res.status(404).json({ error: 'Workspace not found' }); return; }

  const tasksDir = getTasksDir(workspace);
  const tasks = discoverTasks(tasksDir);
  let task = tasks.find(t => t.id === req.params.taskId);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  const attachment = (task.frontmatter.attachments || []).find(a => a.id === req.params.attachmentId);
  if (!attachment) { res.status(404).json({ error: 'Attachment not found' }); return; }

  // Delete file from disk
  const dir = getAttachmentsDir(workspace, req.params.taskId);
  const filePath = join(dir, attachment.storedName);
  try {
    await unlink(filePath);
  } catch {
    // Ignore error if file doesn't exist
  }

  // Remove from task metadata
  task.frontmatter.attachments = (task.frontmatter.attachments || []).filter(a => a.id !== req.params.attachmentId);
  task.frontmatter.updated = new Date().toISOString();
  const { saveTaskFile } = await import('./task-service.js');
  saveTaskFile(task);

  broadcastToWorkspace(workspace.id, { type: 'task:updated', task, changes: {} });

  res.json({ success: true });
});

// =============================================================================
// Planning Agent & Shelf API
// =============================================================================

import {
  sendPlanningMessage,
  getPlanningMessages,
  getPlanningStatus,
  resetPlanningSession,
  registerTaskFormCallbacks,
  unregisterTaskFormCallbacks,
  resolveQARequest,
  abortQARequest,
  getPendingQARequest,
} from './planning-agent-service.js';

import {
  getShelf,
  addDraftTask,
  updateDraftTask,
  removeDraftTask,
  addArtifact,
  removeArtifact,
  removeShelfItem,
  clearShelf,
} from './shelf-service.js';

// ─── Planning Attachments ────────────────────────────────────────────────────

function getPlanningAttachmentsDir(workspace: import('@pi-factory/shared').Workspace): string {
  return join(workspace.path, '.pi', 'planning-attachments');
}

const planningUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      (async () => {
        try {
          const workspace = await getWorkspaceById(req.params.workspaceId as string);
          if (!workspace) return cb(new Error('Workspace not found'), '');
          const dir = getPlanningAttachmentsDir(workspace);
          await mkdir(dir, { recursive: true });
          cb(null, dir);
        } catch (err) {
          cb(err as Error, '');
        }
      })();
    },
    filename: (_req, file, cb) => {
      const id = crypto.randomUUID().slice(0, 8);
      const ext = extname(file.originalname) || '';
      cb(null, `${id}${ext}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// Track planning attachments per workspace (in-memory, non-persistent — they're on disk)
const planningAttachments = new Map<string, import('@pi-factory/shared').Attachment[]>();

function getPlanningAttachmentList(workspaceId: string): import('@pi-factory/shared').Attachment[] {
  return planningAttachments.get(workspaceId) || [];
}

app.post('/api/workspaces/:workspaceId/planning/attachments', planningUpload.array('files', 10), async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId as string);
  if (!workspace) { res.status(404).json({ error: 'Workspace not found' }); return; }

  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) { res.status(400).json({ error: 'No files provided' }); return; }

  const newAttachments: import('@pi-factory/shared').Attachment[] = files.map(f => ({
    id: f.filename.replace(extname(f.filename), ''),
    filename: f.originalname,
    storedName: f.filename,
    mimeType: f.mimetype,
    size: f.size,
    createdAt: new Date().toISOString(),
  }));

  const existing = planningAttachments.get(workspace.id) || [];
  planningAttachments.set(workspace.id, [...existing, ...newAttachments]);

  res.json(newAttachments);
});

app.get('/api/workspaces/:workspaceId/planning/attachments/:storedName', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) { res.status(404).json({ error: 'Workspace not found' }); return; }

  const dir = getPlanningAttachmentsDir(workspace);
  const filePath = join(dir, req.params.storedName);
  try {
    await stat(filePath);
    res.sendFile(filePath);
  } catch {
    res.status(404).json({ error: 'Attachment not found' });
  }
});

// Send message to planning agent
app.post('/api/workspaces/:workspaceId/planning/message', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const { content, attachmentIds } = req.body as { content: string; attachmentIds?: string[] };
  if (!content && (!attachmentIds || attachmentIds.length === 0)) {
    res.status(400).json({ error: 'Content is required' });
    return;
  }

  try {
    // Load images from planning attachments if referenced
    let images: { type: 'image'; data: string; mimeType: string }[] | undefined;
    if (attachmentIds && attachmentIds.length > 0) {
      const allAtts = getPlanningAttachmentList(workspace.id);
      const dir = getPlanningAttachmentsDir(workspace);
      images = [];
      for (const id of attachmentIds) {
        const att = allAtts.find(a => a.id === id);
        if (!att || !att.mimeType.startsWith('image/')) continue;
        const filePath = join(dir, att.storedName);
        try {
          const { readFile } = await import('fs/promises');
          const data = (await readFile(filePath)).toString('base64');
          images.push({ type: 'image', data, mimeType: att.mimeType });
        } catch { /* skip */ }
      }
      if (images.length === 0) images = undefined;
    }

    // Fire and forget — response streams via WebSocket
    sendPlanningMessage(
      workspace.id,
      content || '(see attached images)',
      (event) => broadcastToWorkspace(workspace.id, event),
      images,
    ).catch((err) => {
      logger.error('Planning agent error:', err);
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error('Error sending planning message', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get planning conversation history
app.get('/api/workspaces/:workspaceId/planning/messages', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  res.json(getPlanningMessages(workspace.id));
});

// Get planning agent status
app.get('/api/workspaces/:workspaceId/planning/status', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  res.json({ status: getPlanningStatus(workspace.id) });
});

// Reset planning session
app.post('/api/workspaces/:workspaceId/planning/reset', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  try {
    const newSessionId = await resetPlanningSession(
      workspace.id,
      (event) => broadcastToWorkspace(workspace.id, event),
    );
    res.json({ ok: true, sessionId: newSessionId });
  } catch (err) {
    logger.error('Error resetting planning session', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Poll for pending QA request (reliable fallback when WebSocket broadcasts don't arrive)
app.get('/api/workspaces/:workspaceId/qa/pending', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  const request = getPendingQARequest(workspace.id);
  res.json({ request });
});

// Submit Q&A response (user answers to agent's ask_questions call)
app.post('/api/workspaces/:workspaceId/qa/respond', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const { requestId, answers } = req.body as {
    requestId: string;
    answers: { questionId: string; selectedOption: string }[];
  };

  if (!requestId || !Array.isArray(answers)) {
    res.status(400).json({ error: 'requestId and answers[] are required' });
    return;
  }

  const resolved = resolveQARequest(
    workspace.id,
    requestId,
    answers,
    (event) => broadcastToWorkspace(workspace.id, event),
  );

  if (!resolved) {
    res.status(404).json({ error: 'No pending Q&A request found for this requestId' });
    return;
  }

  res.json({ ok: true });
});

// Abort a pending Q&A request (user wants to skip and type directly)
app.post('/api/workspaces/:workspaceId/qa/abort', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const { requestId } = req.body as { requestId: string };
  if (!requestId) {
    res.status(400).json({ error: 'requestId is required' });
    return;
  }

  const aborted = abortQARequest(
    workspace.id,
    requestId,
    (event) => broadcastToWorkspace(workspace.id, event),
  );

  if (!aborted) {
    res.status(404).json({ error: 'No pending Q&A request found for this requestId' });
    return;
  }

  res.json({ ok: true });
});

// =============================================================================
// New Task Form State (bridge between planning agent and create-task UI)
// =============================================================================

import type { NewTaskFormState } from '@pi-factory/shared';

const taskFormStates = new Map<string, NewTaskFormState>();

// Client tells server the create-task form is open (syncs current state)
app.post('/api/workspaces/:workspaceId/task-form/open', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) { res.status(404).json({ error: 'Workspace not found' }); return; }

  const formState: NewTaskFormState = req.body;
  taskFormStates.set(workspace.id, formState);

  // Register callbacks so the agent extension tool can access form state
  registerTaskFormCallbacks(workspace.id, {
    getFormState: () => taskFormStates.get(workspace.id) || null,
    updateFormState: (updates) => {
      const current = taskFormStates.get(workspace.id);
      if (!current) return 'Form is not open';
      const updated = { ...current, ...updates };
      taskFormStates.set(workspace.id, updated);
      broadcastToWorkspace(workspace.id, {
        type: 'planning:task_form_updated',
        workspaceId: workspace.id,
        formState: updates,
      });
      return 'Form updated successfully';
    },
    getAvailableModels: async () => {
      const { AuthStorage, ModelRegistry } = await import('@mariozechner/pi-coding-agent');
      const auth = new AuthStorage();
      const registry = new ModelRegistry(auth);
      return registry.getAvailable();
    },
    getAvailableSkills: () => {
      const { discoverPostExecutionSkills } = require('./post-execution-skills.js');
      return discoverPostExecutionSkills();
    },
  });

  res.json({ ok: true });
});

// Client tells server the create-task form is closed
app.post('/api/workspaces/:workspaceId/task-form/close', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) { res.status(404).json({ error: 'Workspace not found' }); return; }

  taskFormStates.delete(workspace.id);
  unregisterTaskFormCallbacks(workspace.id);
  res.json({ ok: true });
});

// Client syncs form state changes to server
app.patch('/api/workspaces/:workspaceId/task-form', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) { res.status(404).json({ error: 'Workspace not found' }); return; }

  const current = taskFormStates.get(workspace.id);
  if (!current) { res.json({ ok: true }); return; }

  taskFormStates.set(workspace.id, { ...current, ...req.body });
  res.json({ ok: true });
});

// Get shelf
app.get('/api/workspaces/:workspaceId/shelf', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  res.json(await getShelf(workspace.id));
});

// Update draft task on shelf
app.patch('/api/workspaces/:workspaceId/shelf/drafts/:draftId', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  try {
    const shelf = await updateDraftTask(workspace.id, req.params.draftId, req.body);
    broadcastToWorkspace(workspace.id, { type: 'shelf:updated', workspaceId: workspace.id, shelf });
    res.json(shelf);
  } catch (err) {
    logger.error('Error updating draft', err);
    res.status(404).json({ error: 'Not found' });
  }
});

// Remove item from shelf
app.delete('/api/workspaces/:workspaceId/shelf/items/:itemId', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const shelf = await removeShelfItem(workspace.id, req.params.itemId);
  broadcastToWorkspace(workspace.id, { type: 'shelf:updated', workspaceId: workspace.id, shelf });
  res.json(shelf);
});

// Clear entire shelf
app.delete('/api/workspaces/:workspaceId/shelf', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const shelf = await clearShelf(workspace.id);
  broadcastToWorkspace(workspace.id, { type: 'shelf:updated', workspaceId: workspace.id, shelf });
  res.json(shelf);
});

// Push draft task to backlog (creates a real task)
app.post('/api/workspaces/:workspaceId/shelf/drafts/:draftId/push', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const { getDraftTask } = await import('./shelf-service.js');
  const draft = await getDraftTask(workspace.id, req.params.draftId);
  if (!draft) {
    res.status(404).json({ error: 'Draft task not found' });
    return;
  }

  // Create a real task from the draft
  const tasksDir = getTasksDir(workspace);
  const createReq: CreateTaskRequest = {
    title: draft.title,
    content: draft.content,
    acceptanceCriteria: draft.acceptanceCriteria,
  };

  try {
    const task = createTask(workspace.path, tasksDir, createReq, draft.title);

    // If draft has a plan, set it on the task
    if (draft.plan) {
      task.frontmatter.plan = draft.plan;
      task.frontmatter.updated = new Date().toISOString();
      const { saveTaskFile } = await import('./task-service.js');
      saveTaskFile(task);
    }

    // Remove from shelf
    const shelf = await removeDraftTask(workspace.id, draft.id);
    broadcastToWorkspace(workspace.id, { type: 'shelf:updated', workspaceId: workspace.id, shelf });

    // Broadcast task created
    broadcastToWorkspace(workspace.id, { type: 'task:created', task });

    await createSystemEvent(workspace.id, task.id, 'task-created', `Task ${task.id} created from draft`);

    res.json(task);

    // Generate plan asynchronously using the planning agent (explores codebase)
    if (!task.frontmatter.plan && task.content) {
      planTask({
        task,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        broadcastToWorkspace: (event: any) => broadcastToWorkspace(workspace.id, event),
      }).catch((err) => {
        logger.error('Background plan generation failed:', err);
      });
    }
  } catch (err) {
    logger.error('Error pushing draft to backlog', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Push all draft tasks to backlog
app.post('/api/workspaces/:workspaceId/shelf/push-all', async (req, res) => {
  const workspace = await getWorkspaceById(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const shelf = await getShelf(workspace.id);
  const drafts = shelf.items
    .filter((si) => si.type === 'draft-task')
    .map((si) => si.item as import('@pi-factory/shared').DraftTask);

  if (drafts.length === 0) {
    res.json({ tasks: [], count: 0 });
    return;
  }

  const tasksDir = getTasksDir(workspace);
  const createdTasks: Task[] = [];

  for (const draft of drafts) {
    try {
      const task = createTask(workspace.path, tasksDir, {
        title: draft.title,
        content: draft.content,
        acceptanceCriteria: draft.acceptanceCriteria,
      }, draft.title);

      // If draft has a plan, set it on the task
      if (draft.plan) {
        task.frontmatter.plan = draft.plan;
        task.frontmatter.updated = new Date().toISOString();
        const { saveTaskFile } = await import('./task-service.js');
        saveTaskFile(task);
      }

      createdTasks.push(task);
      broadcastToWorkspace(workspace.id, { type: 'task:created', task });
      await createSystemEvent(workspace.id, task.id, 'task-created', `Task ${task.id} created from draft`);

      // Generate plan asynchronously using the planning agent (explores codebase)
      if (!task.frontmatter.plan && task.content) {
        planTask({
          task,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          broadcastToWorkspace: (event: any) => broadcastToWorkspace(workspace.id, event),
        }).catch((err) => {
          logger.error('Background plan generation failed:', err);
        });
      }
    } catch (err) {
      logger.error(`Failed to create task from draft ${draft.id}:`, err);
    }
  }

  // Remove all drafts from shelf (keep artifacts)
  for (const draft of drafts) {
    await removeDraftTask(workspace.id, draft.id);
  }
  const updatedShelf = await getShelf(workspace.id);
  broadcastToWorkspace(workspace.id, { type: 'shelf:updated', workspaceId: workspace.id, shelf: updatedShelf });

  res.json({ tasks: createdTasks, count: createdTasks.length });
});

// Catch-all for SPA
app.get('*', (_req, res) => {
  res.sendFile(join(clientDistPath, 'index.html'));
});

// =============================================================================
// WebSocket
// =============================================================================

const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const clientId = crypto.randomUUID();
  clients.set(clientId, ws);

  logger.info(`Client connected: ${clientId}`);

  ws.on('message', (data) => {
    try {
      const event = JSON.parse(data.toString()) as ClientEvent;
      handleClientEvent(clientId, event);
    } catch (err) {
      logger.error('Failed to parse WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    // Remove from all subscriptions
    for (const [workspaceId, clientIds] of workspaceSubscriptions) {
      clientIds.delete(clientId);
      if (clientIds.size === 0) {
        workspaceSubscriptions.delete(workspaceId);
      }
    }
    logger.info(`Client disconnected: ${clientId}`);
  });

  // Send welcome
  sendToClient(clientId, { type: 'agent:status', agent: {} as any });
});

function handleClientEvent(clientId: string, event: ClientEvent) {
  switch (event.type) {
    case 'subscribe': {
      const { workspaceId } = event;
      if (!workspaceSubscriptions.has(workspaceId)) {
        workspaceSubscriptions.set(workspaceId, new Set());
      }
      workspaceSubscriptions.get(workspaceId)!.add(clientId);
      logger.info(`Client ${clientId} subscribed to ${workspaceId}`);
      break;
    }

    case 'unsubscribe': {
      const { workspaceId } = event;
      workspaceSubscriptions.get(workspaceId)?.delete(clientId);
      break;
    }

    case 'activity:send': {
      const { taskId, content, role } = event;
      // Find workspace for this client
      for (const [workspaceId, clientIds] of workspaceSubscriptions) {
        if (clientIds.has(clientId)) {
          createChatMessage(workspaceId, taskId, role, content).then((entry) => {
            broadcastToWorkspace(workspaceId, {
              type: 'activity:entry',
              entry,
            });
          });
          break;
        }
      }
      break;
    }
  }
}

function sendToClient(clientId: string, event: ServerEvent) {
  const ws = clients.get(clientId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function broadcastToWorkspace(workspaceId: string, event: ServerEvent) {
  const clientIds = workspaceSubscriptions.get(workspaceId);
  if (!clientIds) return;

  for (const clientId of clientIds) {
    sendToClient(clientId, event);
  }
}

// =============================================================================
// Startup
// =============================================================================

async function resumeInterruptedPlanningRuns(): Promise<void> {
  const workspaces = await listWorkspaces();

  for (const workspace of workspaces) {
    const tasksDir = getTasksDir(workspace);
    const tasks = discoverTasks(tasksDir);
    const interrupted = tasks.filter((task) =>
      shouldResumeInterruptedPlanning(task)
      && task.frontmatter.phase !== 'complete'
      && task.frontmatter.phase !== 'archived'
    );

    if (interrupted.length === 0) {
      continue;
    }

    logger.info(`[Startup] Resuming ${interrupted.length} interrupted planning task(s) in ${workspace.name}`);

    for (const task of interrupted) {
      const entry = await createSystemEvent(
        workspace.id,
        task.id,
        'phase-change',
        'Resuming interrupted planning run after server restart',
      );
      broadcastToWorkspace(workspace.id, { type: 'activity:entry', entry });

      // Run resumes concurrently so one hung planning run does not block others.
      void planTask({
        task,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        broadcastToWorkspace: (event: ServerEvent) => broadcastToWorkspace(workspace.id, event),
      }).catch((err) => {
        logger.error(`[Startup] Failed to resume planning for ${task.id}:`, err);
      });
    }
  }
}

async function main() {
  server.listen(PORT, HOST, () => {
    logger.info(`
╔══════════════════════════════════════════════════════════╗
║  Task Factory Server                                     ║
║  TPS-inspired Agent Work Queue                           ║
╠══════════════════════════════════════════════════════════╣
║  Listening on http://${HOST}:${PORT}                    ║
╚══════════════════════════════════════════════════════════╝
    `);

    // Resume queue processing for workspaces that had it enabled
    initializeQueueManagers((workspaceId, event) => {
      broadcastToWorkspace(workspaceId, event);
    });

    // Resume planning tasks that were interrupted by shutdown/restart.
    resumeInterruptedPlanningRuns().catch((err) => {
      logger.error('[Startup] Failed to resume interrupted planning runs:', err);
    });
  });
}

main().catch((err) => logger.error('Startup failed', err));
