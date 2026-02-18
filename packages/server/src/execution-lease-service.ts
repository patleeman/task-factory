import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { getWorkspaceStoragePath, resolveWorkspaceStoragePathForRead } from './workspace-storage.js';

export interface ExecutionLease {
  taskId: string;
  ownerId: string;
  startedAt: string;
  lastHeartbeatAt: string;
  status: 'running' | 'idle' | 'paused' | 'completed' | 'error';
}

interface ExecutionLeaseFile {
  leases: Record<string, ExecutionLease>;
}

const DEFAULT_EXECUTION_LEASE_TTL_MS = 2 * 60 * 1000;

const startupId = randomUUID().slice(0, 8);
const ownerStartedAt = new Date().toISOString();
const EXECUTION_LEASE_OWNER_ID = `${hostname()}:${process.pid}:${startupId}:${ownerStartedAt}`;

const writeQueueByWorkspace = new Map<string, Promise<void>>();

function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

export function getExecutionLeaseOwnerId(): string {
  return EXECUTION_LEASE_OWNER_ID;
}

export function isExecutionLeaseTrackingEnabled(): boolean {
  const override = process.env.PI_FACTORY_EXECUTION_LEASES_ENABLED?.trim().toLowerCase();
  if (override === '0' || override === 'false') {
    return false;
  }

  if (override === '1' || override === 'true') {
    return true;
  }

  return process.env.NODE_ENV !== 'test';
}

export function getExecutionLeaseTtlMs(): number {
  return parsePositiveInt(process.env.PI_FACTORY_EXECUTION_LEASE_TTL_MS) ?? DEFAULT_EXECUTION_LEASE_TTL_MS;
}

export function getExecutionLeaseHeartbeatIntervalMs(): number {
  const ttlMs = getExecutionLeaseTtlMs();
  const fallback = Math.max(5_000, Math.floor(ttlMs / 3));
  return parsePositiveInt(process.env.PI_FACTORY_EXECUTION_LEASE_HEARTBEAT_MS) ?? fallback;
}

function getLeaseFilePath(workspacePath: string): string {
  return getWorkspaceStoragePath(workspacePath, 'factory', 'execution-leases.json');
}

function getLeaseReadFilePath(workspacePath: string): string {
  return resolveWorkspaceStoragePathForRead(workspacePath, 'factory', 'execution-leases.json');
}

async function readLeaseFile(workspacePath: string): Promise<ExecutionLeaseFile> {
  try {
    const filePath = getLeaseReadFilePath(workspacePath);
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<ExecutionLeaseFile>;

    if (!parsed || typeof parsed !== 'object' || !parsed.leases || typeof parsed.leases !== 'object') {
      return { leases: {} };
    }

    const normalized: Record<string, ExecutionLease> = {};
    for (const [taskId, candidate] of Object.entries(parsed.leases as Record<string, unknown>)) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const record = candidate as Record<string, unknown>;
      const ownerId = typeof record.ownerId === 'string' ? record.ownerId : '';
      const startedAt = typeof record.startedAt === 'string' ? record.startedAt : '';
      const lastHeartbeatAt = typeof record.lastHeartbeatAt === 'string' ? record.lastHeartbeatAt : '';
      const status = typeof record.status === 'string' ? record.status : 'running';
      if (!taskId || !ownerId || !startedAt || !lastHeartbeatAt) continue;

      normalized[taskId] = {
        taskId,
        ownerId,
        startedAt,
        lastHeartbeatAt,
        status: status as ExecutionLease['status'],
      };
    }

    return { leases: normalized };
  } catch {
    return { leases: {} };
  }
}

async function writeLeaseFile(workspacePath: string, data: ExecutionLeaseFile): Promise<void> {
  const filePath = getLeaseFilePath(workspacePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function updateLeaseFile(
  workspacePath: string,
  updater: (current: ExecutionLeaseFile) => ExecutionLeaseFile,
): Promise<void> {
  const previous = writeQueueByWorkspace.get(workspacePath) || Promise.resolve();

  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const current = await readLeaseFile(workspacePath);
      const updated = updater(current);
      await writeLeaseFile(workspacePath, updated);
    });

  writeQueueByWorkspace.set(workspacePath, next);

  try {
    await next;
  } finally {
    if (writeQueueByWorkspace.get(workspacePath) === next) {
      writeQueueByWorkspace.delete(workspacePath);
    }
  }
}

export async function loadExecutionLeases(workspacePath: string): Promise<Record<string, ExecutionLease>> {
  const data = await readLeaseFile(workspacePath);
  return data.leases;
}

export function isExecutionLeaseFresh(
  lease: ExecutionLease | undefined,
  options?: { nowMs?: number; ttlMs?: number },
): boolean {
  if (!lease) {
    return false;
  }

  const nowMs = options?.nowMs ?? Date.now();
  const ttlMs = options?.ttlMs ?? getExecutionLeaseTtlMs();
  const heartbeatMs = Date.parse(lease.lastHeartbeatAt);

  if (!Number.isFinite(heartbeatMs) || heartbeatMs <= 0) {
    return false;
  }

  return nowMs - heartbeatMs <= ttlMs;
}

export async function upsertExecutionLease(
  workspacePath: string,
  taskId: string,
  status: ExecutionLease['status'],
  ownerId: string = EXECUTION_LEASE_OWNER_ID,
): Promise<void> {
  const now = new Date().toISOString();

  await updateLeaseFile(workspacePath, (current) => {
    const existing = current.leases[taskId];
    const startedAt = existing?.startedAt || now;

    return {
      leases: {
        ...current.leases,
        [taskId]: {
          taskId,
          ownerId,
          startedAt,
          lastHeartbeatAt: now,
          status,
        },
      },
    };
  });
}

export async function heartbeatExecutionLease(
  workspacePath: string,
  taskId: string,
  status: ExecutionLease['status'],
): Promise<void> {
  await upsertExecutionLease(workspacePath, taskId, status);
}

export async function clearExecutionLease(workspacePath: string, taskId: string): Promise<void> {
  await updateLeaseFile(workspacePath, (current) => {
    if (!current.leases[taskId]) {
      return current;
    }

    const nextLeases = { ...current.leases };
    delete nextLeases[taskId];
    return { leases: nextLeases };
  });
}
