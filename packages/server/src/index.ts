#!/usr/bin/env node
// =============================================================================
// Pi-Factory Server
// =============================================================================
// Express + WebSocket server for the TPS-inspired agent work queue

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';
import { homedir } from 'os';

import type {
  Task,
  Phase,
  CreateTaskRequest,
  UpdateTaskRequest,
  ServerEvent,
  ClientEvent,
} from '@pi-factory/shared';
import { PHASES, DEFAULT_WIP_LIMITS } from '@pi-factory/shared';


import {
  createTask,
  updateTask,
  moveTaskToPhase,
  discoverTasks,
  canMoveToPhase,
  parseTaskFile,
} from './task-service.js';
import {
  createWorkspace,
  loadWorkspace,
  getWorkspaceById,
  listWorkspaces,
  getTasksDir,
} from './workspace-service.js';
import {
  createTaskSeparator,
  createChatMessage,
  createSystemEvent,
  getActivityTimeline,
  getActivityForTask,
} from './activity-service.js';

// =============================================================================
// Configuration
// =============================================================================

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const HOST = process.env.HOST || '0.0.0.0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
app.get('/api/browse', (req, res) => {
  const rawPath = (req.query.path as string) || homedir();
  const dir = resolve(rawPath.replace(/^~/, homedir()));

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const folders = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        path: join(dir, e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ current: dir, folders });
  } catch (err) {
    res.status(400).json({ error: `Cannot read directory: ${dir}` });
  }
});

// List workspaces
app.get('/api/workspaces', (_req, res) => {
  const workspaces = listWorkspaces();
  res.json(workspaces);
});

// Create workspace
app.post('/api/workspaces', (req, res) => {
  const { path, name, config } = req.body;

  if (!path) {
    res.status(400).json({ error: 'Path is required' });
    return;
  }

  try {
    const workspace = createWorkspace(path, name, config);
    res.json(workspace);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get workspace
app.get('/api/workspaces/:id', (req, res) => {
  const workspace = getWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  res.json(workspace);
});

// Get workspace tasks
app.get('/api/workspaces/:id/tasks', (req, res) => {
  const workspace = getWorkspaceById(req.params.id);

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
  const workspace = getWorkspaceById(req.params.id);

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
    createSystemEvent(workspace.id, task.id, 'task-created', `Task ${task.id} created`);

    res.json(task);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get task
app.get('/api/workspaces/:workspaceId/tasks/:taskId', (req, res) => {
  const workspace = getWorkspaceById(req.params.workspaceId);

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
app.patch('/api/workspaces/:workspaceId/tasks/:taskId', (req, res) => {
  const workspace = getWorkspaceById(req.params.workspaceId);

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
    task = updateTask(task, req.body as UpdateTaskRequest);

    broadcastToWorkspace(workspace.id, {
      type: 'task:updated',
      task,
      changes: req.body,
    });

    res.json(task);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Delete task
app.delete('/api/workspaces/:workspaceId/tasks/:taskId', async (req, res) => {
  const workspace = getWorkspaceById(req.params.workspaceId);

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
    res.status(500).json({ error: String(err) });
  }
});

// Move task to phase
app.post('/api/workspaces/:workspaceId/tasks/:taskId/move', (req, res) => {
  const workspace = getWorkspaceById(req.params.workspaceId);

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

  try {
    task = moveTaskToPhase(task, toPhase, 'user', reason);

    // Create system event
    createSystemEvent(
      workspace.id,
      task.id,
      'phase-change',
      `Moved from ${fromPhase} to ${toPhase}`,
      { fromPhase, toPhase }
    );

    // If moving to executing, create task separator in activity log
    if (toPhase === 'executing') {
      createTaskSeparator(
        workspace.id,
        task.id,
        task.frontmatter.title,
        task.frontmatter.type,
        toPhase
      );
    }

    broadcastToWorkspace(workspace.id, {
      type: 'task:moved',
      task,
      from: fromPhase,
      to: toPhase,
    });

    // If moving to planning, start the planning agent asynchronously
    if (toPhase === 'planning') {
      planTask({
        task,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        broadcastToWorkspace: (event) => broadcastToWorkspace(workspace.id, event),
      }).catch((err) => {
        console.error('Planning agent failed:', err);
      });
    }

    res.json(task);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get activity log
app.get('/api/workspaces/:id/activity', (req, res) => {
  const workspace = getWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
  const entries = getActivityTimeline(workspace.id, limit);

  res.json(entries);
});

// Get activity for specific task
app.get('/api/workspaces/:workspaceId/tasks/:taskId/activity', (req, res) => {
  const workspace = getWorkspaceById(req.params.workspaceId);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
  const entries = getActivityForTask(workspace.id, req.params.taskId, limit);

  res.json(entries);
});

// Send message to activity log
app.post('/api/workspaces/:workspaceId/activity', async (req, res) => {
  const workspace = getWorkspaceById(req.params.workspaceId);

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const { taskId, content, role } = req.body as {
    taskId: string;
    content: string;
    role: 'user' | 'agent';
  };

  const entry = createChatMessage(workspace.id, taskId, role, content);

  broadcastToWorkspace(workspace.id, {
    type: 'activity:entry',
    entry,
  });

  // If there's an active agent session on this task, forward the message
  if (role === 'user' && taskId) {
    const session = getActiveSession(taskId);
    if (session?.piSession && session.status === 'running') {
      // Steer the running agent with the user's message
      steerTask(taskId, content).catch((err) => {
        console.error('Failed to steer agent with chat message:', err);
      });
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
  loadGlobalAgentsMd,
  buildAgentContext,
  discoverPiThemes,
} from './pi-integration.js';

// Get Pi settings
app.get('/api/pi/settings', (_req, res) => {
  const settings = loadPiSettings();
  res.json(settings || {});
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

// Get repo-local extensions (from pi-factory's own extensions/ dir)
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

// Get global AGENTS.md
app.get('/api/pi/agents-md', (_req, res) => {
  const content = loadGlobalAgentsMd();
  res.json({ content: content || '' });
});

// Get agent context (combined)
app.get('/api/pi/context', (req, res) => {
  const workspaceId = req.query.workspace as string | undefined;
  const skillIds = req.query.skills as string[] | undefined;
  const context = buildAgentContext(workspaceId, skillIds);
  res.json(context);
});

// =============================================================================
// Pi-Factory Specific API
// =============================================================================

import {
  loadPiFactorySettings,
  savePiFactorySettings,
  loadWorkspacePiConfig,
  saveWorkspacePiConfig,
  getEnabledSkillsForWorkspace,
  getEnabledExtensionsForWorkspace,
  type PiFactorySettings,
  type WorkspacePiConfig,
} from './pi-integration.js';

// Get Pi-Factory settings
app.get('/api/pi-factory/settings', (_req, res) => {
  const settings = loadPiFactorySettings();
  res.json(settings || {});
});

// Save Pi-Factory settings
app.post('/api/pi-factory/settings', (req, res) => {
  try {
    const settings = req.body as PiFactorySettings;
    savePiFactorySettings(settings);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
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
  planTask,
  stopTaskExecution,
  steerTask,
  followUpTask,
  getActiveSession,
  getAllActiveSessions,
  getRepoExtensionPaths,
  reloadRepoExtensions,
  validateQualityGates,
  checkAndAutoTransition,
} from './agent-execution-service.js';

// Start task execution
app.post('/api/workspaces/:workspaceId/tasks/:taskId/execute', async (req, res) => {
  const workspace = getWorkspaceById(req.params.workspaceId);
  
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
  
  // Move task to executing phase
  if (task.frontmatter.phase !== 'executing') {
    moveTaskToPhase(task, 'executing', 'user', 'Agent started execution');
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
          // Auto-move to complete
          moveTaskToPhase(task, 'complete', 'system', 'Execution completed');
        }
        
        broadcastToWorkspace(workspace.id, {
          type: 'task:moved',
          task,
          from: 'executing',
          to: success ? 'complete' : 'executing',
        });
      },
    });
    
    res.json({ sessionId: session.id, status: session.status });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Stop task execution
app.post('/api/workspaces/:workspaceId/tasks/:taskId/stop', (req, res) => {
  const stopped = stopTaskExecution(req.params.taskId);
  res.json({ stopped });
});

// Steer agent (interrupt with new instruction)
app.post('/api/workspaces/:workspaceId/tasks/:taskId/steer', async (req, res) => {
  const { content } = req.body as { content: string };

  if (!content) {
    res.status(400).json({ error: 'Content is required' });
    return;
  }

  // Log the user steer message in activity
  const workspace = getWorkspaceById(req.params.workspaceId);
  if (workspace) {
    const entry = createChatMessage(workspace.id, req.params.taskId, 'user', content);
    broadcastToWorkspace(workspace.id, { type: 'activity:entry', entry });
    createSystemEvent(workspace.id, req.params.taskId, 'phase-change', 'User sent steering message');
  }

  const ok = await steerTask(req.params.taskId, content);
  res.json({ ok });
});

// Follow-up (queue for after agent finishes)
app.post('/api/workspaces/:workspaceId/tasks/:taskId/follow-up', async (req, res) => {
  const { content } = req.body as { content: string };

  if (!content) {
    res.status(400).json({ error: 'Content is required' });
    return;
  }

  // Log the user follow-up message in activity
  const workspace = getWorkspaceById(req.params.workspaceId);
  if (workspace) {
    const entry = createChatMessage(workspace.id, req.params.taskId, 'user', content);
    broadcastToWorkspace(workspace.id, { type: 'activity:entry', entry });
    createSystemEvent(workspace.id, req.params.taskId, 'phase-change', 'User queued follow-up message');
  }

  const ok = await followUpTask(req.params.taskId, content);
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

// Validate quality gates
app.post('/api/workspaces/:workspaceId/tasks/:taskId/validate', async (req, res) => {
  const workspace = getWorkspaceById(req.params.workspaceId);
  
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
  
  const result = await validateQualityGates(task, workspace.path);
  res.json(result);
});

// Update quality checks
app.patch('/api/workspaces/:workspaceId/tasks/:taskId/quality', async (req, res) => {
  const workspace = getWorkspaceById(req.params.workspaceId);
  
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  
  const tasksDir = getTasksDir(workspace);
  const tasks = discoverTasks(tasksDir);
  let task = tasks.find(t => t.id === req.params.taskId);
  
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  
  const { testsPass, lintPass, reviewDone } = req.body;
  
  task.frontmatter.qualityChecks = {
    testsPass: testsPass ?? task.frontmatter.qualityChecks.testsPass,
    lintPass: lintPass ?? task.frontmatter.qualityChecks.lintPass,
    reviewDone: reviewDone ?? task.frontmatter.qualityChecks.reviewDone,
  };
  
  // Save task
  const { saveTaskFile } = await import('./task-service.js');
  saveTaskFile(task);
  
  // Check for auto-transition
  checkAndAutoTransition(task, workspace.path);
  
  broadcastToWorkspace(workspace.id, {
    type: 'task:updated',
    task,
    changes: {},
  });
  
  res.json(task);
});

// Get all active executions
app.get('/api/executions', (_req, res) => {
  const sessions = getAllActiveSessions();
  res.json(sessions);
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

  console.log(`Client connected: ${clientId}`);

  ws.on('message', (data) => {
    try {
      const event = JSON.parse(data.toString()) as ClientEvent;
      handleClientEvent(clientId, event);
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
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
    console.log(`Client disconnected: ${clientId}`);
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
      console.log(`Client ${clientId} subscribed to ${workspaceId}`);
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
          const entry = createChatMessage(workspaceId, taskId, role, content);
          broadcastToWorkspace(workspaceId, {
            type: 'activity:entry',
            entry,
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

async function main() {
  server.listen(PORT, HOST, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║  Pi-Factory Server                                       ║
║  TPS-inspired Agent Work Queue                           ║
╠══════════════════════════════════════════════════════════╣
║  Listening on http://${HOST}:${PORT}                    ║
╚══════════════════════════════════════════════════════════╝
    `);
  });
}

main().catch(console.error);
