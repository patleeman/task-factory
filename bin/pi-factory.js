#!/usr/bin/env node
// =============================================================================
// Task Factory CLI - Full-Featured Daemon CLI with API Client
// =============================================================================

import { spawn, exec } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, createReadStream } from 'fs';
import { readdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { createInterface } from 'readline';
import { homedir } from 'os';

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import * as clack from '@clack/prompts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// Configuration & Constants
// =============================================================================

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';
const DAEMON_PID_FILE = join(homedir(), '.taskfactory', 'daemon.pid');
const DAEMON_LOG_FILE = join(homedir(), '.taskfactory', 'daemon.log');
const CLI_CONFIG_FILE = join(homedir(), '.taskfactory', 'cli-config.json');

// =============================================================================
// Utility Functions
// =============================================================================

function getPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version;
  } catch {
    return '0.1.0';
  }
}

function ensureTaskFactoryDir() {
  const dir = join(homedir(), '.taskfactory');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function loadCliConfig() {
  try {
    if (existsSync(CLI_CONFIG_FILE)) {
      return JSON.parse(readFileSync(CLI_CONFIG_FILE, 'utf-8'));
    }
  } catch {
    // ignore
  }
  return {};
}

function saveCliConfig(config) {
  ensureTaskFactoryDir();
  writeFileSync(CLI_CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getServerUrl() {
  const config = loadCliConfig();
  const port = config.port || process.env.PORT || DEFAULT_PORT;
  const host = config.host || process.env.HOST || DEFAULT_HOST;
  return `http://${host}:${port}`;
}

function getServerPid() {
  try {
    if (existsSync(DAEMON_PID_FILE)) {
      const pid = parseInt(readFileSync(DAEMON_PID_FILE, 'utf-8').trim(), 10);
      return Number.isFinite(pid) ? pid : null;
    }
  } catch {
    // ignore
  }
  return null;
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isServerReady(url, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

// =============================================================================
// API Client
// =============================================================================

class ApiClient {
  constructor(baseUrl = getServerUrl()) {
    this.baseUrl = baseUrl;
  }

  async request(method, path, body = null) {
    const url = `${this.baseUrl}${path}`;
    const options = {
      method,
      headers: {},
    };

    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const error = new Error(data?.error || `HTTP ${response.status}`);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    } catch (err) {
      if (err.status) throw err;
      throw new Error(`Cannot connect to Task Factory server at ${this.baseUrl}. Is the daemon running?`);
    }
  }

  // Health
  health() { return this.request('GET', '/api/health'); }

  // Workspaces
  listWorkspaces() { return this.request('GET', '/api/workspaces'); }
  getWorkspace(id) { return this.request('GET', `/api/workspaces/${id}`); }
  createWorkspace(path, name, config) { return this.request('POST', '/api/workspaces', { path, name, config }); }
  deleteWorkspace(id) { return this.request('DELETE', `/api/workspaces/${id}`); }

  // Tasks
  listTasks(workspaceId, scope = 'active') { return this.request('GET', `/api/workspaces/${workspaceId}/tasks?scope=${scope}`); }
  getTask(workspaceId, taskId) { return this.request('GET', `/api/workspaces/${workspaceId}/tasks/${taskId}`); }
  createTask(workspaceId, request) { return this.request('POST', `/api/workspaces/${workspaceId}/tasks`, request); }
  updateTask(workspaceId, taskId, request) { return this.request('PATCH', `/api/workspaces/${workspaceId}/tasks/${taskId}`, request); }
  deleteTask(workspaceId, taskId) { return this.request('DELETE', `/api/workspaces/${workspaceId}/tasks/${taskId}`); }
  moveTask(workspaceId, taskId, toPhase, reason) { return this.request('POST', `/api/workspaces/${workspaceId}/tasks/${taskId}/move`, { toPhase, reason }); }
  executeTask(workspaceId, taskId) { return this.request('POST', `/api/workspaces/${workspaceId}/tasks/${taskId}/execute`); }
  stopTask(workspaceId, taskId) { return this.request('POST', `/api/workspaces/${workspaceId}/tasks/${taskId}/stop`); }

  // Queue
  getQueueStatus(workspaceId) { return this.request('GET', `/api/workspaces/${workspaceId}/queue/status`); }
  startQueue(workspaceId) { return this.request('POST', `/api/workspaces/${workspaceId}/queue/start`); }
  stopQueue(workspaceId) { return this.request('POST', `/api/workspaces/${workspaceId}/queue/stop`); }

  // Activity
  getActivity(workspaceId, limit = 100) { return this.request('GET', `/api/workspaces/${workspaceId}/activity?limit=${limit}`); }
}

// =============================================================================
// Output Formatting
// =============================================================================

function formatDate(isoString) {
  if (!isoString) return '-';
  const date = new Date(isoString);
  return date.toLocaleString();
}

function formatDuration(seconds) {
  if (!seconds) return '-';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function printWorkspaces(workspaces) {
  if (workspaces.length === 0) {
    console.log(chalk.yellow('No workspaces found.'));
    return;
  }

  const table = new Table({
    head: [chalk.bold('ID'), chalk.bold('Name'), chalk.bold('Path'), chalk.bold('Created')],
    colWidths: [12, 25, 45, 20],
  });

  for (const ws of workspaces) {
    table.push([
      ws.id.slice(0, 10),
      ws.name || '-',
      ws.path.length > 40 ? '...' + ws.path.slice(-37) : ws.path,
      formatDate(ws.createdAt),
    ]);
  }

  console.log(table.toString());
}

function printTasks(tasks, options = {}) {
  if (tasks.length === 0) {
    console.log(chalk.yellow('No tasks found.'));
    return;
  }

  const { showWorkspace = false } = options;

  const head = [
    chalk.bold('ID'),
    chalk.bold('Phase'),
    chalk.bold('Title'),
  ];

  if (showWorkspace) head.push(chalk.bold('Workspace'));
  head.push(chalk.bold('Updated'));

  const table = new Table({ head });

  for (const task of tasks) {
    const phaseColor = {
      backlog: chalk.gray,
      ready: chalk.blue,
      executing: chalk.yellow,
      complete: chalk.green,
      archived: chalk.gray,
    }[task.frontmatter.phase] || chalk.white;

    const row = [
      task.id.slice(0, 8),
      phaseColor(task.frontmatter.phase),
      task.frontmatter.title.slice(0, 40) + (task.frontmatter.title.length > 40 ? '...' : ''),
    ];

    if (showWorkspace) row.push(task.frontmatter.workspace?.slice(-20) || '-');
    row.push(formatDate(task.frontmatter.updated));

    table.push(row);
  }

  console.log(table.toString());
}

function printTaskDetail(task) {
  const fm = task.frontmatter;

  console.log(chalk.bold('\n╔══════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold('║ ') + chalk.cyan.bold(fm.title.padEnd(54)) + chalk.bold(' ║'));
  console.log(chalk.bold('╚══════════════════════════════════════════════════════════╝'));

  console.log(`\n${chalk.bold('ID:')} ${fm.id}`);
  console.log(`${chalk.bold('Phase:')} ${chalk.yellow(fm.phase)}`);
  console.log(`${chalk.bold('Workspace:')} ${fm.workspace}`);
  console.log(`${chalk.bold('Created:')} ${formatDate(fm.created)}`);
  console.log(`${chalk.bold('Updated:')} ${formatDate(fm.updated)}`);

  if (fm.assigned) console.log(`${chalk.bold('Assigned:')} ${fm.assigned}`);
  if (fm.blocked?.isBlocked) console.log(`${chalk.red.bold('⚠ BLOCKED:')} ${fm.blocked.reason}`);

  if (fm.acceptanceCriteria?.length > 0) {
    console.log(`\n${chalk.bold('Acceptance Criteria:')}`);
    for (const criteria of fm.acceptanceCriteria) {
      console.log(`  ${chalk.green('✓')} ${criteria}`);
    }
  }

  if (fm.plan) {
    console.log(`\n${chalk.bold('Plan:')}`);
    console.log(`${chalk.dim('Goal:')} ${fm.plan.goal}`);
    if (fm.plan.steps?.length) {
      console.log(chalk.dim('Steps:'));
      for (const step of fm.plan.steps) {
        console.log(`  ${chalk.blue('→')} ${step}`);
      }
    }
  }

  if (task.content) {
    const preview = task.content.slice(0, 500).replace(/\n+/g, ' ');
    console.log(`\n${chalk.bold('Description:')}`);
    console.log(preview.length < task.content.length ? preview + '...' : preview);
  }
}

function printQueueStatus(status) {
  console.log(`\n${chalk.bold('Queue Status:')}`);
  console.log(`  ${chalk.bold('Enabled:')} ${status.enabled ? chalk.green('Yes') : chalk.red('No')}`);
  console.log(`  ${chalk.bold('Current Task:')} ${status.currentTaskId || chalk.gray('None')}`);
  console.log(`  ${chalk.bold('Ready Tasks:')} ${status.tasksInReady}`);
  console.log(`  ${chalk.bold('Executing Tasks:')} ${status.tasksInExecuting}`);
}

// =============================================================================
// Daemon Commands
// =============================================================================

async function daemonStart(options) {
  const spinner = clack.spinner();
  spinner.start('Checking daemon status...');

  const pid = getServerPid();
  if (pid && isProcessRunning(pid)) {
    spinner.stop('Daemon is already running');
    console.log(chalk.green(`Daemon already running (PID: ${pid})`));
    console.log(`Server URL: ${getServerUrl()}`);
    return;
  }

  // Clean up stale PID file
  if (pid && !isProcessRunning(pid)) {
    try { unlinkSync(DAEMON_PID_FILE); } catch { /* ignore */ }
  }

  spinner.message('Starting daemon...');

  const serverPath = join(__dirname, '..', 'dist', 'server.js');
  if (!existsSync(serverPath)) {
    spinner.stop('Server bundle not found');
    console.error(chalk.red(`Server bundle not found at ${serverPath}. Run "npm run build" first.`));
    process.exit(1);
  }

  ensureTaskFactoryDir();

  const config = loadCliConfig();
  const port = options.port || config.port || process.env.PORT || DEFAULT_PORT;
  const host = options.host || config.host || process.env.HOST || DEFAULT_HOST;

  // Start daemon process
  const out = openSync(DAEMON_LOG_FILE, 'a');
  const err = openSync(DAEMON_LOG_FILE, 'a');

  const proc = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env, PORT: port.toString(), HOST: host },
  });

  proc.unref();

  // Save PID
  writeFileSync(DAEMON_PID_FILE, proc.pid.toString());

  spinner.message('Waiting for server to be ready...');

  const url = `http://${host}:${port}`;
  const ready = await isServerReady(url, 10000);

  if (!ready) {
    spinner.stop('Failed to start daemon');
    console.error(chalk.red('Daemon failed to start within 10 seconds. Check logs:'));
    console.error(chalk.gray(`  ${DAEMON_LOG_FILE}`));
    process.exit(1);
  }

  spinner.stop('Daemon started successfully');
  console.log(chalk.green(`✓ Daemon started (PID: ${proc.pid})`));
  console.log(`  URL: ${chalk.cyan(url)}`);
  console.log(`  Logs: ${chalk.gray(DAEMON_LOG_FILE)}`);

  closeSync(out);
  closeSync(err);
}

import { openSync, closeSync } from 'fs';

async function daemonStop() {
  const spinner = clack.spinner();
  spinner.start('Stopping daemon...');

  const pid = getServerPid();
  if (!pid) {
    spinner.stop('No daemon PID file found');
    console.log(chalk.yellow('Daemon is not running.'));
    return;
  }

  if (!isProcessRunning(pid)) {
    spinner.stop('Daemon not running');
    console.log(chalk.yellow('Daemon process not found. Cleaning up PID file.'));
    try { unlinkSync(DAEMON_PID_FILE); } catch { /* ignore */ }
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');

    // Wait for process to exit
    let attempts = 0;
    while (isProcessRunning(pid) && attempts < 50) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }

    if (isProcessRunning(pid)) {
      spinner.stop('Force killing daemon...');
      process.kill(pid, 'SIGKILL');
    }

    try { unlinkSync(DAEMON_PID_FILE); } catch { /* ignore */ }

    spinner.stop('Daemon stopped');
    console.log(chalk.green('✓ Daemon stopped'));
  } catch (err) {
    spinner.stop('Error stopping daemon');
    console.error(chalk.red(`Failed to stop daemon: ${err.message}`));
    process.exit(1);
  }
}

async function daemonRestart(options) {
  console.log(chalk.bold('Restarting daemon...\n'));
  await daemonStop();
  await new Promise(r => setTimeout(r, 500));
  await daemonStart(options);
}

async function daemonStatus() {
  const pid = getServerPid();

  if (!pid) {
    console.log(chalk.yellow('Daemon status: Not running'));
    console.log(chalk.gray('Run "pifactory daemon start" to start the daemon.'));
    return;
  }

  if (!isProcessRunning(pid)) {
    console.log(chalk.yellow(`Daemon status: Stale PID file (PID: ${pid})`));
    console.log(chalk.gray('Cleaning up PID file...'));
    try { unlinkSync(DAEMON_PID_FILE); } catch { /* ignore */ }
    return;
  }

  try {
    const client = new ApiClient();
    const health = await client.health();

    console.log(chalk.green('✓ Daemon is running'));
    console.log(`  PID: ${pid}`);
    console.log(`  URL: ${chalk.cyan(getServerUrl())}`);
    console.log(`  Status: ${chalk.green(health.status)}`);
    console.log(`  Timestamp: ${formatDate(health.timestamp)}`);
    console.log(`  Logs: ${chalk.gray(DAEMON_LOG_FILE)}`);
  } catch (err) {
    console.log(chalk.yellow(`Daemon status: Process exists but not responding`));
    console.log(`  PID: ${pid}`);
    console.log(`  URL: ${getServerUrl()}`);
    console.log(chalk.red(`  Error: ${err.message}`));
  }
}

// =============================================================================
// Workspace Commands
// =============================================================================

async function workspaceList() {
  const client = new ApiClient();
  const workspaces = await client.listWorkspaces();
  printWorkspaces(workspaces);
}

async function workspaceCreate(path, options) {
  if (!path) {
    console.error(chalk.red('Error: Path is required'));
    process.exit(1);
  }

  const resolvedPath = resolve(path);

  if (!existsSync(resolvedPath)) {
    const create = await clack.confirm({
      message: `Directory does not exist. Create it?`,
      initialValue: true,
    });

    if (create) {
      mkdirSync(resolvedPath, { recursive: true });
    } else {
      console.log(chalk.yellow('Cancelled.'));
      return;
    }
  }

  const spinner = clack.spinner();
  spinner.start('Creating workspace...');

  const client = new ApiClient();
  const name = options.name || resolvedPath.split('/').pop();

  try {
    const workspace = await client.createWorkspace(resolvedPath, name, {});
    spinner.stop('Workspace created');
    console.log(chalk.green(`✓ Workspace created`));
    console.log(`  ID: ${chalk.cyan(workspace.id)}`);
    console.log(`  Name: ${workspace.name}`);
    console.log(`  Path: ${workspace.path}`);
  } catch (err) {
    spinner.stop('Failed to create workspace');
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

async function workspaceDelete(id) {
  if (!id) {
    console.error(chalk.red('Error: Workspace ID is required'));
    process.exit(1);
  }

  const confirmed = await clack.confirm({
    message: `Are you sure you want to delete workspace ${id}?`,
    initialValue: false,
  });

  if (!confirmed) {
    console.log(chalk.yellow('Cancelled.'));
    return;
  }

  const spinner = clack.spinner();
  spinner.start('Deleting workspace...');

  const client = new ApiClient();

  try {
    await client.deleteWorkspace(id);
    spinner.stop('Workspace deleted');
    console.log(chalk.green('✓ Workspace deleted'));
  } catch (err) {
    spinner.stop('Failed to delete workspace');
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

async function workspaceShow(id) {
  if (!id) {
    console.error(chalk.red('Error: Workspace ID is required'));
    process.exit(1);
  }

  const client = new ApiClient();
  const workspace = await client.getWorkspace(id);

  console.log(chalk.bold('\nWorkspace Details:'));
  console.log(`  ${chalk.bold('ID:')} ${workspace.id}`);
  console.log(`  ${chalk.bold('Name:')} ${workspace.name}`);
  console.log(`  ${chalk.bold('Path:')} ${workspace.path}`);
  console.log(`  ${chalk.bold('Created:')} ${formatDate(workspace.createdAt)}`);
  console.log(`  ${chalk.bold('Updated:')} ${formatDate(workspace.updatedAt)}`);
}

async function workspaceExport(id, options) {
  if (!id) {
    console.error(chalk.red('Error: Workspace ID is required'));
    process.exit(1);
  }

  const spinner = clack.spinner();
  spinner.start('Exporting workspace...');

  const client = new ApiClient();
  const workspace = await client.getWorkspace(id);
  const tasks = await client.listTasks(id, 'all');

  const exportData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    workspace: {
      id: workspace.id,
      name: workspace.name,
      path: workspace.path,
      config: workspace.config,
    },
    tasks: tasks.map(t => ({
      id: t.id,
      frontmatter: t.frontmatter,
      content: t.content,
      history: t.history,
    })),
  };

  const outputPath = options.output || `workspace-${id.slice(0, 8)}-${Date.now()}.json`;
  writeFileSync(outputPath, JSON.stringify(exportData, null, 2));

  spinner.stop('Workspace exported');
  console.log(chalk.green(`✓ Workspace exported to ${outputPath}`));
  console.log(`  Tasks: ${tasks.length}`);
}

async function workspaceImport(file, options) {
  if (!file || !existsSync(file)) {
    console.error(chalk.red(`Error: File not found: ${file}`));
    process.exit(1);
  }

  const importData = JSON.parse(readFileSync(file, 'utf-8'));

  if (!importData.workspace || !importData.tasks) {
    console.error(chalk.red('Error: Invalid export file format'));
    process.exit(1);
  }

  console.log(chalk.bold('\nImporting workspace:'));
  console.log(`  Name: ${importData.workspace.name}`);
  console.log(`  Original ID: ${importData.workspace.id}`);
  console.log(`  Tasks: ${importData.tasks.length}`);

  const path = options.path || importData.workspace.path;
  const resolvedPath = resolve(path);

  if (!existsSync(resolvedPath)) {
    mkdirSync(resolvedPath, { recursive: true });
  }

  const spinner = clack.spinner();
  spinner.start('Creating workspace...');

  const client = new ApiClient();
  const workspace = await client.createWorkspace(resolvedPath, importData.workspace.name, importData.workspace.config);

  spinner.message('Importing tasks...');

  for (const task of importData.tasks) {
    await client.createTask(workspace.id, {
      title: task.frontmatter.title,
      content: task.content,
      acceptanceCriteria: task.frontmatter.acceptanceCriteria,
      plan: task.frontmatter.plan,
      preExecutionSkills: task.frontmatter.preExecutionSkills,
      postExecutionSkills: task.frontmatter.postExecutionSkills,
    });
  }

  spinner.stop('Workspace imported');
  console.log(chalk.green(`✓ Workspace imported`));
  console.log(`  New ID: ${chalk.cyan(workspace.id)}`);
  console.log(`  Path: ${workspace.path}`);
  console.log(`  Tasks imported: ${importData.tasks.length}`);
}

// =============================================================================
// Task Commands
// =============================================================================

async function taskList(options) {
  const client = new ApiClient();

  let tasks = [];

  if (options.workspace) {
    tasks = await client.listTasks(options.workspace, options.phase || 'active');
  } else {
    // List tasks from all workspaces
    const workspaces = await client.listWorkspaces();
    for (const ws of workspaces) {
      try {
        const wsTasks = await client.listTasks(ws.id, options.phase || 'active');
        tasks.push(...wsTasks);
      } catch {
        // skip workspaces with errors
      }
    }
  }

  printTasks(tasks, { showWorkspace: !options.workspace });
}

async function taskCreate(options) {
  if (!options.workspace) {
    console.error(chalk.red('Error: --workspace is required'));
    process.exit(1);
  }

  if (!options.title) {
    const title = await clack.text({
      message: 'Task title:',
      validate: (v) => v ? undefined : 'Title is required',
    });

    if (clack.isCancel(title)) {
      console.log(chalk.yellow('Cancelled.'));
      return;
    }

    options.title = title;
  }

  let content = options.content;
  if (!content) {
    const desc = await clack.text({
      message: 'Task description (optional):',
    });

    if (!clack.isCancel(desc)) {
      content = desc;
    }
  }

  const spinner = clack.spinner();
  spinner.start('Creating task...');

  const client = new ApiClient();

  try {
    const task = await client.createTask(options.workspace, {
      title: options.title,
      content: content || '',
    });

    spinner.stop('Task created');
    console.log(chalk.green(`✓ Task created`));
    console.log(`  ID: ${chalk.cyan(task.id)}`);
    console.log(`  Title: ${task.frontmatter.title}`);
    console.log(`  Phase: ${chalk.yellow(task.frontmatter.phase)}`);
  } catch (err) {
    spinner.stop('Failed to create task');
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

async function taskShow(taskId) {
  if (!taskId) {
    console.error(chalk.red('Error: Task ID is required'));
    process.exit(1);
  }

  const client = new ApiClient();

  // Find task across all workspaces
  const workspaces = await client.listWorkspaces();
  let foundTask = null;

  for (const ws of workspaces) {
    try {
      const tasks = await client.listTasks(ws.id, 'all');
      const task = tasks.find(t => t.id === taskId || t.id.startsWith(taskId));
      if (task) {
        foundTask = task;
        break;
      }
    } catch {
      // continue
    }
  }

  if (!foundTask) {
    console.error(chalk.red(`Task not found: ${taskId}`));
    process.exit(1);
  }

  printTaskDetail(foundTask);
}

async function taskMove(taskId, options) {
  if (!taskId) {
    console.error(chalk.red('Error: Task ID is required'));
    process.exit(1);
  }

  if (!options.to) {
    console.error(chalk.red('Error: --to is required'));
    console.log('Valid phases: backlog, ready, executing, complete, archived');
    process.exit(1);
  }

  const client = new ApiClient();

  // Find task workspace
  const workspaces = await client.listWorkspaces();
  let workspaceId = null;
  let foundTask = null;

  for (const ws of workspaces) {
    try {
      const tasks = await client.listTasks(ws.id, 'all');
      const task = tasks.find(t => t.id === taskId || t.id.startsWith(taskId));
      if (task) {
        workspaceId = ws.id;
        foundTask = task;
        break;
      }
    } catch {
      // continue
    }
  }

  if (!foundTask) {
    console.error(chalk.red(`Task not found: ${taskId}`));
    process.exit(1);
  }

  const spinner = clack.spinner();
  spinner.start(`Moving task to ${options.to}...`);

  try {
    await client.moveTask(workspaceId, foundTask.id, options.to, options.reason);
    spinner.stop('Task moved');
    console.log(chalk.green(`✓ Task moved to ${options.to}`));
  } catch (err) {
    spinner.stop('Failed to move task');
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

async function taskDelete(taskId) {
  if (!taskId) {
    console.error(chalk.red('Error: Task ID is required'));
    process.exit(1);
  }

  const confirmed = await clack.confirm({
    message: `Are you sure you want to delete task ${taskId}?`,
    initialValue: false,
  });

  if (!confirmed) {
    console.log(chalk.yellow('Cancelled.'));
    return;
  }

  const client = new ApiClient();

  // Find task workspace
  const workspaces = await client.listWorkspaces();

  for (const ws of workspaces) {
    try {
      const tasks = await client.listTasks(ws.id, 'all');
      const task = tasks.find(t => t.id === taskId || t.id.startsWith(taskId));
      if (task) {
        const spinner = clack.spinner();
        spinner.start('Deleting task...');

        await client.deleteTask(ws.id, task.id);

        spinner.stop('Task deleted');
        console.log(chalk.green('✓ Task deleted'));
        return;
      }
    } catch {
      // continue
    }
  }

  console.error(chalk.red(`Task not found: ${taskId}`));
  process.exit(1);
}

async function taskExecute(taskId) {
  if (!taskId) {
    console.error(chalk.red('Error: Task ID is required'));
    process.exit(1);
  }

  const client = new ApiClient();

  // Find task workspace
  const workspaces = await client.listWorkspaces();

  for (const ws of workspaces) {
    try {
      const tasks = await client.listTasks(ws.id, 'all');
      const task = tasks.find(t => t.id === taskId || t.id.startsWith(taskId));
      if (task) {
        const spinner = clack.spinner();
        spinner.start('Starting task execution...');

        const result = await client.executeTask(ws.id, task.id);

        spinner.stop('Execution started');
        console.log(chalk.green('✓ Task execution started'));
        console.log(`  Session ID: ${result.sessionId}`);
        console.log(`  Status: ${result.status}`);
        return;
      }
    } catch (err) {
      if (err.status !== 404) {
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    }
  }

  console.error(chalk.red(`Task not found: ${taskId}`));
  process.exit(1);
}

async function taskStop(taskId) {
  if (!taskId) {
    console.error(chalk.red('Error: Task ID is required'));
    process.exit(1);
  }

  const client = new ApiClient();

  // Find task workspace
  const workspaces = await client.listWorkspaces();

  for (const ws of workspaces) {
    try {
      const tasks = await client.listTasks(ws.id, 'all');
      const task = tasks.find(t => t.id === taskId || t.id.startsWith(taskId));
      if (task) {
        const spinner = clack.spinner();
        spinner.start('Stopping task execution...');

        await client.stopTask(ws.id, task.id);

        spinner.stop('Execution stopped');
        console.log(chalk.green('✓ Task execution stopped'));
        return;
      }
    } catch {
      // continue
    }
  }

  console.error(chalk.red(`Task not found: ${taskId}`));
  process.exit(1);
}

async function taskExport(taskId, options) {
  if (!taskId) {
    console.error(chalk.red('Error: Task ID is required'));
    process.exit(1);
  }

  const client = new ApiClient();

  // Find task workspace
  const workspaces = await client.listWorkspaces();

  for (const ws of workspaces) {
    try {
      const tasks = await client.listTasks(ws.id, 'all');
      const task = tasks.find(t => t.id === taskId || t.id.startsWith(taskId));
      if (task) {
        const exportData = {
          version: '1.0',
          exportedAt: new Date().toISOString(),
          task: {
            id: task.id,
            frontmatter: task.frontmatter,
            content: task.content,
            history: task.history,
          },
        };

        const outputPath = options.output || `task-${task.id.slice(0, 8)}-${Date.now()}.json`;
        writeFileSync(outputPath, JSON.stringify(exportData, null, 2));

        console.log(chalk.green(`✓ Task exported to ${outputPath}`));
        return;
      }
    } catch {
      // continue
    }
  }

  console.error(chalk.red(`Task not found: ${taskId}`));
  process.exit(1);
}

async function taskImport(file, options) {
  if (!file || !existsSync(file)) {
    console.error(chalk.red(`Error: File not found: ${file}`));
    process.exit(1);
  }

  const importData = JSON.parse(readFileSync(file, 'utf-8'));

  if (!importData.task) {
    console.error(chalk.red('Error: Invalid task export file format'));
    process.exit(1);
  }

  if (!options.workspace) {
    console.error(chalk.red('Error: --workspace is required'));
    process.exit(1);
  }

  const spinner = clack.spinner();
  spinner.start('Importing task...');

  const client = new ApiClient();

  const task = await client.createTask(options.workspace, {
    title: importData.task.frontmatter.title,
    content: importData.task.content,
    acceptanceCriteria: importData.task.frontmatter.acceptanceCriteria,
    plan: importData.task.frontmatter.plan,
    preExecutionSkills: importData.task.frontmatter.preExecutionSkills,
    postExecutionSkills: importData.task.frontmatter.postExecutionSkills,
  });

  spinner.stop('Task imported');
  console.log(chalk.green(`✓ Task imported`));
  console.log(`  New ID: ${chalk.cyan(task.id)}`);
  console.log(`  Title: ${task.frontmatter.title}`);
}

// =============================================================================
// Queue Commands
// =============================================================================

async function queueStatus(options) {
  const client = new ApiClient();

  if (options.workspace) {
    const status = await client.getQueueStatus(options.workspace);
    printQueueStatus(status);
  } else {
    const workspaces = await client.listWorkspaces();
    for (const ws of workspaces) {
      console.log(chalk.bold(`\n${ws.name}:`));
      try {
        const status = await client.getQueueStatus(ws.id);
        printQueueStatus(status);
      } catch (err) {
        console.log(chalk.red(`  Error: ${err.message}`));
      }
    }
  }
}

async function queueStart(options) {
  const client = new ApiClient();

  if (options.workspace) {
    const spinner = clack.spinner();
    spinner.start('Starting queue...');

    const status = await client.startQueue(options.workspace);

    spinner.stop('Queue started');
    console.log(chalk.green('✓ Queue started'));
    printQueueStatus(status);
  } else {
    const workspaces = await client.listWorkspaces();
    for (const ws of workspaces) {
      try {
        await client.startQueue(ws.id);
        console.log(chalk.green(`✓ ${ws.name}: Queue started`));
      } catch (err) {
        console.log(chalk.red(`✗ ${ws.name}: ${err.message}`));
      }
    }
  }
}

async function queueStop(options) {
  const client = new ApiClient();

  if (options.workspace) {
    const spinner = clack.spinner();
    spinner.start('Stopping queue...');

    const status = await client.stopQueue(options.workspace);

    spinner.stop('Queue stopped');
    console.log(chalk.green('✓ Queue stopped'));
    printQueueStatus(status);
  } else {
    const workspaces = await client.listWorkspaces();
    for (const ws of workspaces) {
      try {
        await client.stopQueue(ws.id);
        console.log(chalk.green(`✓ ${ws.name}: Queue stopped`));
      } catch (err) {
        console.log(chalk.red(`✗ ${ws.name}: ${err.message}`));
      }
    }
  }
}

// =============================================================================
// Logs Commands
// =============================================================================

async function logs(options) {
  if (!existsSync(DAEMON_LOG_FILE)) {
    console.log(chalk.yellow('No log file found.'));
    return;
  }

  const lines = options.lines || 50;

  if (options.follow) {
    console.log(chalk.bold('Tailing logs (press Ctrl+C to exit)...\n'));

    // First show the last N lines
    exec(`tail -n ${lines} "${DAEMON_LOG_FILE}"`, (err, stdout) => {
      if (stdout) process.stdout.write(stdout);
    });

    // Then follow
    const tail = spawn('tail', ['-f', DAEMON_LOG_FILE], { stdio: 'inherit' });

    process.on('SIGINT', () => {
      tail.kill();
      process.exit(0);
    });
  } else {
    exec(`tail -n ${lines} "${DAEMON_LOG_FILE}"`, (err, stdout, stderr) => {
      if (err) {
        console.error(chalk.red(`Error reading logs: ${err.message}`));
        return;
      }
      console.log(chalk.bold(`Last ${lines} lines of logs:\n`));
      process.stdout.write(stdout);
    });
  }
}

// =============================================================================
// Config Commands
// =============================================================================

async function configGet(key) {
  const config = loadCliConfig();

  if (key) {
    const value = config[key];
    if (value !== undefined) {
      console.log(value);
    } else {
      console.log(chalk.gray('(not set)'));
    }
  } else {
    console.log(chalk.bold('Current configuration:'));
    if (Object.keys(config).length === 0) {
      console.log(chalk.gray('  (no custom configuration set)'));
    } else {
      for (const [k, v] of Object.entries(config)) {
        console.log(`  ${k}: ${chalk.cyan(v)}`);
      }
    }
  }
}

async function configSet(key, value) {
  const config = loadCliConfig();
  config[key] = value;
  saveCliConfig(config);
  console.log(chalk.green(`✓ Set ${key} = ${value}`));
}

async function configList() {
  await configGet(null);
}

// =============================================================================
// CLI Setup
// =============================================================================

const program = new Command()
  .name('pifactory')
  .description('Task Factory - TPS-inspired Agent Work Queue')
  .version(getPackageVersion())
  .configureOutput({
    outputError: (str, write) => write(chalk.red(str)),
  });

// Daemon commands
const daemonCmd = program
  .command('daemon')
  .description('Manage the Task Factory daemon');

daemonCmd
  .command('start')
  .description('Start the background daemon')
  .option('-p, --port <port>', 'Server port', parseInt)
  .option('-h, --host <host>', 'Server host')
  .action(daemonStart);

daemonCmd
  .command('stop')
  .description('Stop the background daemon')
  .action(daemonStop);

daemonCmd
  .command('restart')
  .description('Restart the background daemon')
  .option('-p, --port <port>', 'Server port', parseInt)
  .option('-h, --host <host>', 'Server host')
  .action(daemonRestart);

daemonCmd
  .command('status')
  .description('Check daemon status')
  .action(daemonStatus);

// Workspace commands
const workspaceCmd = program
  .command('workspace')
  .alias('workspaces')
  .description('Manage workspaces');

workspaceCmd
  .command('list')
  .description('List all workspaces')
  .action(workspaceList);

workspaceCmd
  .command('create <path>')
  .description('Create a new workspace')
  .option('-n, --name <name>', 'Workspace name')
  .action(workspaceCreate);

workspaceCmd
  .command('delete <id>')
  .description('Delete a workspace')
  .action(workspaceDelete);

workspaceCmd
  .command('show <id>')
  .description('Show workspace details')
  .action(workspaceShow);

workspaceCmd
  .command('export <id>')
  .description('Export workspace to JSON file')
  .option('-o, --output <file>', 'Output file path')
  .action(workspaceExport);

workspaceCmd
  .command('import <file>')
  .description('Import workspace from JSON file')
  .option('-p, --path <path>', 'Target path for workspace')
  .action(workspaceImport);

// Task commands
const taskCmd = program
  .command('task')
  .alias('tasks')
  .description('Manage tasks');

taskCmd
  .command('list')
  .description('List tasks')
  .option('-w, --workspace <id>', 'Filter by workspace')
  .option('-p, --phase <phase>', 'Filter by phase (all, active, archived)')
  .action(taskList);

taskCmd
  .command('create')
  .description('Create a new task')
  .requiredOption('-w, --workspace <id>', 'Workspace ID')
  .option('-t, --title <title>', 'Task title')
  .option('-c, --content <content>', 'Task content/description')
  .action(taskCreate);

taskCmd
  .command('show <task-id>')
  .description('Show task details')
  .action(taskShow);

taskCmd
  .command('move <task-id>')
  .description('Move task to a different phase')
  .requiredOption('--to <phase>', 'Target phase')
  .option('--reason <reason>', 'Reason for move')
  .action(taskMove);

taskCmd
  .command('delete <task-id>')
  .description('Delete a task')
  .action(taskDelete);

taskCmd
  .command('execute <task-id>')
  .alias('exec')
  .description('Start executing a task')
  .action(taskExecute);

taskCmd
  .command('stop <task-id>')
  .description('Stop executing a task')
  .action(taskStop);

taskCmd
  .command('export <task-id>')
  .description('Export task to JSON file')
  .option('-o, --output <file>', 'Output file path')
  .action(taskExport);

taskCmd
  .command('import <file>')
  .description('Import task from JSON file')
  .requiredOption('-w, --workspace <id>', 'Target workspace ID')
  .action(taskImport);

// Queue commands
const queueCmd = program
  .command('queue')
  .description('Manage queue processing');

queueCmd
  .command('status')
  .description('Check queue status')
  .option('-w, --workspace <id>', 'Workspace ID (default: all workspaces)')
  .action(queueStatus);

queueCmd
  .command('start')
  .description('Start queue processing')
  .option('-w, --workspace <id>', 'Workspace ID (default: all workspaces)')
  .action(queueStart);

queueCmd
  .command('stop')
  .description('Stop queue processing')
  .option('-w, --workspace <id>', 'Workspace ID (default: all workspaces)')
  .action(queueStop);

// Logs commands
program
  .command('logs')
  .description('View daemon logs')
  .option('-f, --follow', 'Follow log output in real-time')
  .option('-n, --lines <n>', 'Number of lines to show', parseInt, 50)
  .action(logs);

// Config commands
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('get [key]')
  .description('Get configuration value')
  .action(configGet);

configCmd
  .command('set <key> <value>')
  .description('Set configuration value')
  .action(configSet);

configCmd
  .command('list')
  .description('List all configuration values')
  .action(configList);

// Legacy start command (start server in foreground)
program
  .command('start')
  .description('Start server in foreground (legacy mode)')
  .option('--no-open', 'Do not open browser')
  .option('-o, --open', 'Open browser', true)
  .action(async (options) => {
    const serverPath = join(__dirname, '..', 'dist', 'server.js');

    if (!existsSync(serverPath)) {
      console.error(chalk.red(`Server bundle not found at ${serverPath}. Run "npm run build" first.`));
      process.exit(1);
    }

    const config = loadCliConfig();
    const port = process.env.PORT || config.port || DEFAULT_PORT;
    const host = process.env.HOST || config.host || DEFAULT_HOST;
    const url = `http://localhost:${port}`;

    console.log(chalk.bold(`Starting Task Factory server on ${url}...`));

    const proc = spawn(process.execPath, [serverPath], {
      stdio: 'inherit',
      env: { ...process.env, PORT: port, HOST: host },
    });

    if (options.open) {
      setTimeout(() => {
        const openCmd = process.platform === 'darwin' ? 'open' :
                        process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${openCmd} ${url}`, () => {});
      }, 1500);
    }

    proc.on('exit', (code) => {
      process.exit(code || 0);
    });

    process.on('SIGINT', () => proc.kill('SIGINT'));
    process.on('SIGTERM', () => proc.kill('SIGTERM'));
  });

// Parse and run
program.parse();

// Show help if no arguments provided
if (process.argv.length <= 2) {
  program.help();
}
