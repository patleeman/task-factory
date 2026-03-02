import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type { NotificationEvent, NotificationRoute, NotificationSettings, NotificationSeverity, NotificationType } from '@task-factory/shared';
import { loadPiFactorySettings, savePiFactorySettings } from './pi-integration.js';
import { logger } from './logger.js';
import { getWorkspaceById, updateWorkspaceConfig } from './workspace-service.js';

interface NotificationEnvelope {
  event: NotificationEvent;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
}

interface NotificationQueueStore {
  pending: NotificationEnvelope[];
  failed: NotificationEnvelope[];
}

type WorkspaceNotificationOverrides = {
  enabled?: boolean;
  routes?: NotificationRoute[];
};

const QUEUE_PATH = join(homedir(), '.taskfactory', 'notifications-queue.json');
let worker: NodeJS.Timeout | null = null;

function ensureDefaultSettings(input?: NotificationSettings): NotificationSettings {
  return {
    enabled: input?.enabled ?? false,
    sharedSecret: input?.sharedSecret,
    allowlistedTargets: input?.allowlistedTargets ?? [],
    routes: input?.routes ?? [],
    maxRetries: input?.maxRetries ?? 3,
    retryBackoffMs: input?.retryBackoffMs ?? 2_000,
  };
}

function loadQueueStore(): NotificationQueueStore {
  if (!existsSync(QUEUE_PATH)) {
    return { pending: [], failed: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(QUEUE_PATH, 'utf-8')) as NotificationQueueStore;
    return {
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      failed: Array.isArray(parsed.failed) ? parsed.failed : [],
    };
  } catch {
    return { pending: [], failed: [] };
  }
}

function saveQueueStore(store: NotificationQueueStore): void {
  mkdirSync(dirname(QUEUE_PATH), { recursive: true });
  writeFileSync(QUEUE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

export function getNotificationSettings(): NotificationSettings {
  const settings = loadPiFactorySettings();
  return ensureDefaultSettings(settings?.notifications);
}

export function updateNotificationSettings(next: NotificationSettings): NotificationSettings {
  const merged = ensureDefaultSettings(next);
  const current = loadPiFactorySettings() ?? {};
  savePiFactorySettings({ ...current, notifications: merged });
  return merged;
}

export async function getWorkspaceNotificationOverrides(workspaceId: string): Promise<WorkspaceNotificationOverrides | undefined> {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) return undefined;
  return workspace.config.notifications;
}

export async function updateWorkspaceNotificationOverrides(
  workspaceId: string,
  overrides: WorkspaceNotificationOverrides | undefined,
): Promise<WorkspaceNotificationOverrides | undefined> {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  const current = workspace.config.notifications;
  await updateWorkspaceConfig(workspace, {
    notifications: overrides,
  });

  return {
    ...(current ?? {}),
    ...(overrides ?? {}),
  };
}

function matchesRoute(route: NotificationRoute, event: NotificationEvent): boolean {
  if (!route.enabled) return false;
  if (route.workspaceId && route.workspaceId !== event.workspaceId) return false;
  if (route.profileId && route.profileId !== event.profileId) return false;
  if (route.severities?.length && !route.severities.includes(event.severity)) return false;
  if (route.types?.length && !route.types.includes(event.type)) return false;
  if (route.taskIdPattern && event.taskId) {
    try {
      if (!new RegExp(route.taskIdPattern).test(event.taskId)) return false;
    } catch {
      return false;
    }
  }
  if (route.taskIdPattern && !event.taskId) return false;
  return true;
}

async function resolveRoutes(event: NotificationEvent): Promise<NotificationRoute[]> {
  const global = getNotificationSettings();
  const workspaceOverrides = event.workspaceId
    ? await getWorkspaceNotificationOverrides(event.workspaceId)
    : undefined;

  if (workspaceOverrides?.enabled === false) return [];
  if (!global.enabled && workspaceOverrides?.enabled !== true) return [];

  const routes = workspaceOverrides?.routes ?? global.routes;
  const allowlisted = new Set(global.allowlistedTargets);

  return routes.filter((route) => {
    if (!matchesRoute(route, event)) return false;
    return allowlisted.has(`${route.target.provider}:${route.target.destination}`);
  });
}

function validateEnum<T extends string>(value: unknown, allowed: T[]): value is T {
  return typeof value === 'string' && allowed.includes(value as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function validateNotificationEvent(payload: unknown): NotificationEvent {
  if (!isRecord(payload)) {
    throw new Error('Notification payload must be an object');
  }

  const obj = payload;
  const severityAllowed: NotificationSeverity[] = ['info', 'warning', 'error'];
  const typeAllowed: NotificationType[] = ['scheduled-task', 'task-lifecycle', 'job-complete', 'custom'];

  if (typeof obj.source !== 'string' || typeof obj.message !== 'string') {
    throw new Error('Notification requires source and message strings');
  }
  if (!validateEnum(obj.severity, severityAllowed)) {
    throw new Error('Invalid notification severity');
  }
  if (!validateEnum(obj.type, typeAllowed)) {
    throw new Error('Invalid notification type');
  }

  return {
    id: typeof obj.id === 'string' ? obj.id : randomUUID(),
    timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : new Date().toISOString(),
    source: obj.source,
    taskId: typeof obj.taskId === 'string' ? obj.taskId : undefined,
    workspaceId: typeof obj.workspaceId === 'string' ? obj.workspaceId : undefined,
    workspacePath: typeof obj.workspacePath === 'string' ? obj.workspacePath : undefined,
    profileId: typeof obj.profileId === 'string' ? obj.profileId : undefined,
    type: obj.type,
    severity: obj.severity,
    message: obj.message,
    link: typeof obj.link === 'string' ? obj.link : undefined,
    metadata: isRecord(obj.metadata) ? obj.metadata : undefined,
  };
}

export function enqueueNotification(event: NotificationEvent): void {
  const store = loadQueueStore();
  store.pending.push({ event, attempts: 0, nextAttemptAt: Date.now() });
  saveQueueStore(store);
}

export function emitNotification(payload: NotificationEvent | unknown): NotificationEvent {
  const event = validateNotificationEvent(payload);
  enqueueNotification(event);
  return event;
}

async function sendToRoute(route: NotificationRoute, event: NotificationEvent): Promise<void> {
  logger.info(`[NotificationGateway] send ${event.id} -> ${route.target.provider}:${route.target.destination}`, {
    workspaceId: event.workspaceId,
    taskId: event.taskId,
    severity: event.severity,
    type: event.type,
    source: event.source,
  });
}

async function processNotification(env: NotificationEnvelope, settings: NotificationSettings): Promise<{ success: boolean; retryAt?: number; error?: string }> {
  try {
    const routes = await resolveRoutes(env.event);
    if (routes.length === 0) {
      logger.info(`[NotificationGateway] no route for ${env.event.id}`, {
        workspaceId: env.event.workspaceId,
        taskId: env.event.taskId,
        severity: env.event.severity,
        type: env.event.type,
      });
      return { success: true };
    }

    for (const route of routes) {
      await sendToRoute(route, env.event);
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown delivery error';
    const maxRetries = settings.maxRetries ?? 3;
    const backoff = settings.retryBackoffMs ?? 2_000;
    const nextAttempts = env.attempts + 1;
    if (nextAttempts > maxRetries) {
      return { success: false, error: message };
    }
    return { success: false, error: message, retryAt: Date.now() + backoff * nextAttempts };
  }
}

async function tickWorker(): Promise<void> {
  const settings = getNotificationSettings();
  const store = loadQueueStore();
  if (store.pending.length === 0) return;

  const now = Date.now();
  const remaining: NotificationEnvelope[] = [];

  for (const env of store.pending) {
    if (env.nextAttemptAt > now) {
      remaining.push(env);
      continue;
    }

    const result = await processNotification(env, settings);
    if (result.success) {
      logger.info(`[NotificationGateway] delivered ${env.event.id}`);
      continue;
    }

    if (result.retryAt) {
      remaining.push({ ...env, attempts: env.attempts + 1, nextAttemptAt: result.retryAt, lastError: result.error });
      logger.warn(`[NotificationGateway] retry ${env.event.id}`, { attempts: env.attempts + 1, error: result.error });
      continue;
    }

    store.failed.push({ ...env, attempts: env.attempts + 1, lastError: result.error, nextAttemptAt: now });
    logger.error(`[NotificationGateway] failed ${env.event.id}`, { attempts: env.attempts + 1, error: result.error });
  }

  store.pending = remaining;
  saveQueueStore(store);
}

export function startNotificationWorker(): void {
  if (worker) return;
  worker = setInterval(() => {
    void tickWorker();
  }, 2_000);
  worker.unref?.();
}

export function getNotificationQueueStatus(): NotificationQueueStore {
  return loadQueueStore();
}
