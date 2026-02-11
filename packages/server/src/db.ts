// =============================================================================
// Database Layer
// =============================================================================
import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync } from 'fs';
import type { ActivityEntry, Task, Agent, Metrics } from '@pi-factory/shared';

const DB_DIR = join(homedir(), '.pi', 'factory');
const DB_PATH = join(DB_DIR, 'pi-factory.db');

let db: Database.Database | null = null;

export function initDatabase(): Database.Database {
  if (db) return db;

  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  createTables();
  return db;
}

function createTables() {
  if (!db) throw new Error('Database not initialized');

  // Workspaces
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Tasks (metadata only - content stored in files)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      type TEXT NOT NULL,
      priority TEXT NOT NULL,
      title TEXT NOT NULL,
      assigned TEXT,
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      cycle_time INTEGER,
      lead_time INTEGER,
      blocked_count INTEGER DEFAULT 0,
      blocked_duration INTEGER DEFAULT 0,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  // Activity Log (unified timeline)
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      entry_data TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  // Create index for efficient querying
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_activity_workspace ON activity_log(workspace_id, timestamp)
  `);

  // Agents
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      current_task TEXT,
      capabilities TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      metadata TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (current_task) REFERENCES tasks(id)
    )
  `);

  // Phase transitions
  db.exec(`
    CREATE TABLE IF NOT EXISTS phase_transitions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      from_phase TEXT NOT NULL,
      to_phase TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);
}

// =============================================================================
// Activity Log Operations
// =============================================================================

export function addActivityEntry(
  workspaceId: string,
  entry: ActivityEntry
): void {
  if (!db) throw new Error('Database not initialized');

  const stmt = db.prepare(`
    INSERT INTO activity_log (id, workspace_id, task_id, entry_type, entry_data, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    entry.id,
    workspaceId,
    entry.taskId,
    entry.type,
    JSON.stringify(entry),
    entry.timestamp
  );
}

export function getActivityLog(
  workspaceId: string,
  options: {
    limit?: number;
    before?: string;
    after?: string;
    taskId?: string;
  } = {}
): ActivityEntry[] {
  if (!db) throw new Error('Database not initialized');

  let sql = `SELECT entry_data FROM activity_log WHERE workspace_id = ?`;
  const params: (string | number)[] = [workspaceId];

  if (options.taskId) {
    sql += ` AND task_id = ?`;
    params.push(options.taskId);
  }

  if (options.before) {
    sql += ` AND timestamp < ?`;
    params.push(options.before);
  }

  if (options.after) {
    sql += ` AND timestamp > ?`;
    params.push(options.after);
  }

  sql += ` ORDER BY timestamp DESC`;

  if (options.limit) {
    sql += ` LIMIT ?`;
    params.push(options.limit);
  }

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as { entry_data: string }[];

  return rows.map((row) => JSON.parse(row.entry_data));
}

export function getRecentActivity(
  workspaceId: string,
  limit: number = 100
): ActivityEntry[] {
  return getActivityLog(workspaceId, { limit });
}

// =============================================================================
// Task Operations
// =============================================================================

export function saveTaskMetadata(task: Task, workspaceId: string): void {
  if (!db) throw new Error('Database not initialized');

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO tasks (
      id, workspace_id, phase, type, priority, title, assigned,
      file_path, created_at, updated_at, started_at, completed_at,
      cycle_time, lead_time, blocked_count, blocked_duration
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    task.id,
    workspaceId,
    task.frontmatter.phase,
    task.frontmatter.type,
    task.frontmatter.priority,
    task.frontmatter.title,
    task.frontmatter.assigned || null,
    task.filePath,
    task.frontmatter.created,
    task.frontmatter.updated,
    task.frontmatter.started || null,
    task.frontmatter.completed || null,
    task.frontmatter.cycleTime || null,
    task.frontmatter.leadTime || null,
    task.frontmatter.blockedCount,
    task.frontmatter.blockedDuration
  );
}

export function getTasksByWorkspace(workspaceId: string): Task[] {
  if (!db) throw new Error('Database not initialized');

  const stmt = db.prepare(`
    SELECT * FROM tasks WHERE workspace_id = ? ORDER BY updated_at DESC
  `);

  return stmt.all(workspaceId) as Task[];
}

export function getTasksByPhase(workspaceId: string, phase: string): Task[] {
  if (!db) throw new Error('Database not initialized');

  const stmt = db.prepare(`
    SELECT * FROM tasks WHERE workspace_id = ? AND phase = ? ORDER BY updated_at DESC
  `);

  return stmt.all(workspaceId, phase) as Task[];
}

export function updateTaskPhase(
  taskId: string,
  newPhase: string,
  actor: string,
  reason?: string
): void {
  if (!db) throw new Error('Database not initialized');

  const now = new Date().toISOString();

  // Get current phase
  const getPhase = db.prepare(`SELECT phase FROM tasks WHERE id = ?`);
  const row = getPhase.get(taskId) as { phase: string } | undefined;
  const fromPhase = row?.phase;

  if (!fromPhase) throw new Error(`Task ${taskId} not found`);

  // Update task phase
  const updateStmt = db.prepare(`
    UPDATE tasks SET phase = ?, updated_at = ? WHERE id = ?
  `);
  updateStmt.run(newPhase, now, taskId);

  // Record transition
  const transitionStmt = db.prepare(`
    INSERT INTO phase_transitions (id, task_id, from_phase, to_phase, timestamp, actor, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  transitionStmt.run(
    crypto.randomUUID(),
    taskId,
    fromPhase,
    newPhase,
    now,
    actor,
    reason || null
  );
}

// =============================================================================
// Agent Operations
// =============================================================================

export function saveAgent(agent: Agent): void {
  if (!db) throw new Error('Database not initialized');

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO agents (
      id, workspace_id, name, status, current_task, capabilities, last_seen, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    agent.id,
    agent.workspace,
    agent.name,
    agent.status,
    agent.currentTask || null,
    JSON.stringify(agent.capabilities),
    agent.lastSeen,
    JSON.stringify(agent.metadata || {})
  );
}

export function getAgentsByWorkspace(workspaceId: string): Agent[] {
  if (!db) throw new Error('Database not initialized');

  const stmt = db.prepare(`
    SELECT * FROM agents WHERE workspace_id = ?
  `);

  const rows = stmt.all(workspaceId) as any[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    currentTask: row.current_task,
    workspace: row.workspace_id,
    capabilities: JSON.parse(row.capabilities),
    lastSeen: row.last_seen,
    metadata: JSON.parse(row.metadata),
  }));
}

export function updateAgentStatus(
  agentId: string,
  status: string,
  currentTask?: string
): void {
  if (!db) throw new Error('Database not initialized');

  const stmt = db.prepare(`
    UPDATE agents SET status = ?, current_task = ?, last_seen = ? WHERE id = ?
  `);

  stmt.run(status, currentTask || null, new Date().toISOString(), agentId);
}

// =============================================================================
// Metrics
// =============================================================================

export function getMetrics(workspaceId: string, days: number = 30): Metrics {
  if (!db) throw new Error('Database not initialized');

  const since = new Date();
  since.setDate(since.getDate() - days);

  // Current WIP
  const wipStmt = db.prepare(`
    SELECT phase, COUNT(*) as count FROM tasks
    WHERE workspace_id = ? AND phase NOT IN ('complete', 'backlog')
    GROUP BY phase
  `);
  const wipRows = wipStmt.all(workspaceId) as { phase: string; count: number }[];
  const currentWip: Record<string, number> = {};
  for (const row of wipRows) {
    currentWip[row.phase] = row.count;
  }

  // Cycle time (ready -> complete)
  const cycleStmt = db.prepare(`
    SELECT cycle_time FROM tasks
    WHERE workspace_id = ? AND completed_at > ? AND cycle_time IS NOT NULL
  `);
  const cycleRows = cycleStmt.all(workspaceId, since.toISOString()) as {
    cycle_time: number;
  }[];
  const cycleTimes = cycleRows.map((r) => r.cycle_time);

  // Throughput (completed per day)
  const throughputStmt = db.prepare(`
    SELECT DATE(completed_at) as date, COUNT(*) as count
    FROM tasks
    WHERE workspace_id = ? AND completed_at > ?
    GROUP BY DATE(completed_at)
  `);
  const throughputRows = throughputStmt.all(workspaceId, since.toISOString()) as {
    count: number;
  }[];
  const avgThroughput =
    throughputRows.length > 0
      ? throughputRows.reduce((sum, r) => sum + r.count, 0) / days
      : 0;

  return {
    cycleTime: calculateSummary(cycleTimes),
    leadTime: { average: 0, median: 0, p95: 0, min: 0, max: 0 }, // TODO
    throughput: avgThroughput,
    currentWip,
    wipLimitBreaches: 0, // TODO
    qualityGatePassRate: 0, // TODO
    reworkRate: 0, // TODO
    agentUtilization: {}, // TODO
    startDate: since.toISOString(),
    endDate: new Date().toISOString(),
  };
}

function calculateSummary(values: number[]): {
  average: number;
  median: number;
  p95: number;
  min: number;
  max: number;
} {
  if (values.length === 0) {
    return { average: 0, median: 0, p95: 0, min: 0, max: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / sorted.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95Index = Math.floor(sorted.length * 0.95);
  const p95 = sorted[p95Index] || sorted[sorted.length - 1];

  return {
    average: avg,
    median,
    p95,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}
