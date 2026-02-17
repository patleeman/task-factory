import {
  resolveGlobalWorkflowSettings,
  resolveWorkspaceWorkflowSettings,
  getWorkspaceWorkflowOverrides,
  type QueueStatus,
  type WorkspaceConfig,
  type WorkspaceWorkflowSettings,
  type WorkspaceWorkflowSettingsResponse,
  type WorkflowDefaultsConfig,
} from '@task-factory/shared';
import {
  loadPiFactorySettings,
  type PiFactorySettings,
} from './pi-integration.js';

const SLOT_LIMIT_MIN = 1;
const SLOT_LIMIT_MAX = 100;

export interface WorkflowSettingsPatch {
  readyLimit?: number | null;
  executingLimit?: number | null;
  backlogToReady?: boolean | null;
  readyToExecuting?: boolean | null;
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function parseSlotLimit(
  value: unknown,
  fieldName: string,
  allowNull: boolean,
): { ok: true; value: number | null | undefined } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (value === null) {
    if (!allowNull) {
      return { ok: false, error: `${fieldName} must be an integer between ${SLOT_LIMIT_MIN} and ${SLOT_LIMIT_MAX}` };
    }

    return { ok: true, value: null };
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return {
      ok: false,
      error: `${fieldName} must be an integer between ${SLOT_LIMIT_MIN} and ${SLOT_LIMIT_MAX}${allowNull ? ', or null to inherit global default' : ''}`,
    };
  }

  if (value < SLOT_LIMIT_MIN || value > SLOT_LIMIT_MAX) {
    return {
      ok: false,
      error: `${fieldName} must be an integer between ${SLOT_LIMIT_MIN} and ${SLOT_LIMIT_MAX}${allowNull ? ', or null to inherit global default' : ''}`,
    };
  }

  return { ok: true, value };
}

function parseNullableBoolean(
  value: unknown,
  fieldName: string,
): { ok: true; value: boolean | null | undefined } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== 'boolean') {
    return {
      ok: false,
      error: `${fieldName} must be a boolean when provided (or null to inherit global default)`,
    };
  }

  return { ok: true, value };
}

export function normalizePiFactorySettingsPayload(
  payload: PiFactorySettings,
): { ok: true; value: PiFactorySettings } | { ok: false; error: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'Request body must be an object' };
  }

  const rawDefaults = payload.workflowDefaults;

  if (rawDefaults === undefined || rawDefaults === null) {
    const normalized: PiFactorySettings = { ...payload };
    delete normalized.workflowDefaults;
    return { ok: true, value: normalized };
  }

  if (typeof rawDefaults !== 'object') {
    return { ok: false, error: 'workflowDefaults must be an object when provided' };
  }

  const readyLimitResult = parseSlotLimit(
    (rawDefaults as { readyLimit?: unknown }).readyLimit,
    'workflowDefaults.readyLimit',
    true,
  );
  if (!readyLimitResult.ok) {
    return readyLimitResult;
  }

  const executingLimitResult = parseSlotLimit(
    (rawDefaults as { executingLimit?: unknown }).executingLimit,
    'workflowDefaults.executingLimit',
    true,
  );
  if (!executingLimitResult.ok) {
    return executingLimitResult;
  }

  const backlogToReadyResult = parseNullableBoolean(
    (rawDefaults as { backlogToReady?: unknown }).backlogToReady,
    'workflowDefaults.backlogToReady',
  );
  if (!backlogToReadyResult.ok) {
    return backlogToReadyResult;
  }

  const readyToExecutingResult = parseNullableBoolean(
    (rawDefaults as { readyToExecuting?: unknown }).readyToExecuting,
    'workflowDefaults.readyToExecuting',
  );
  if (!readyToExecutingResult.ok) {
    return readyToExecutingResult;
  }

  const normalizedDefaults: WorkflowDefaultsConfig = {};

  if (readyLimitResult.value !== undefined && readyLimitResult.value !== null) {
    normalizedDefaults.readyLimit = readyLimitResult.value;
  }

  if (executingLimitResult.value !== undefined && executingLimitResult.value !== null) {
    normalizedDefaults.executingLimit = executingLimitResult.value;
  }

  if (typeof backlogToReadyResult.value === 'boolean') {
    normalizedDefaults.backlogToReady = backlogToReadyResult.value;
  }

  if (typeof readyToExecutingResult.value === 'boolean') {
    normalizedDefaults.readyToExecuting = readyToExecutingResult.value;
  }

  const normalized: PiFactorySettings = {
    ...payload,
    workflowDefaults: normalizedDefaults,
  };

  return { ok: true, value: normalized };
}

export function loadGlobalWorkflowSettings(): WorkspaceWorkflowSettings {
  const settings = loadPiFactorySettings();
  return resolveGlobalWorkflowSettings(settings?.workflowDefaults);
}

export function buildWorkspaceWorkflowSettingsResponse(
  workspaceConfig: WorkspaceConfig,
  queueStatus: QueueStatus,
  globalDefaults: WorkspaceWorkflowSettings = loadGlobalWorkflowSettings(),
): WorkspaceWorkflowSettingsResponse {
  const effective = resolveWorkspaceWorkflowSettings(workspaceConfig, globalDefaults);
  const overrides = getWorkspaceWorkflowOverrides(workspaceConfig);

  return {
    settings: {
      backlogToReady: effective.backlogToReady,
      readyToExecuting: effective.readyToExecuting,
    },
    effective,
    overrides,
    globalDefaults,
    queueStatus,
  };
}

export function parseWorkspaceWorkflowPatch(
  raw: unknown,
): { ok: true; value: WorkflowSettingsPatch } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Request body must be an object' };
  }

  const payload = raw as {
    readyLimit?: unknown;
    executingLimit?: unknown;
    backlogToReady?: unknown;
    readyToExecuting?: unknown;
  };

  const includesReadyLimit = hasOwn(payload, 'readyLimit');
  const includesExecutingLimit = hasOwn(payload, 'executingLimit');
  const includesBacklogToReady = hasOwn(payload, 'backlogToReady');
  const includesReadyToExecuting = hasOwn(payload, 'readyToExecuting');

  if (!includesReadyLimit && !includesExecutingLimit && !includesBacklogToReady && !includesReadyToExecuting) {
    return {
      ok: false,
      error: 'At least one workflow setting must be provided',
    };
  }

  const readyLimitResult = parseSlotLimit(payload.readyLimit, 'readyLimit', true);
  if (!readyLimitResult.ok) {
    return readyLimitResult;
  }

  const executingLimitResult = parseSlotLimit(payload.executingLimit, 'executingLimit', true);
  if (!executingLimitResult.ok) {
    return executingLimitResult;
  }

  const backlogToReadyResult = parseNullableBoolean(payload.backlogToReady, 'backlogToReady');
  if (!backlogToReadyResult.ok) {
    return backlogToReadyResult;
  }

  const readyToExecutingResult = parseNullableBoolean(payload.readyToExecuting, 'readyToExecuting');
  if (!readyToExecutingResult.ok) {
    return readyToExecutingResult;
  }

  const patch: WorkflowSettingsPatch = {};

  if (includesReadyLimit) {
    patch.readyLimit = readyLimitResult.value ?? null;
  }

  if (includesExecutingLimit) {
    patch.executingLimit = executingLimitResult.value ?? null;
  }

  if (includesBacklogToReady) {
    patch.backlogToReady = backlogToReadyResult.value ?? null;
  }

  if (includesReadyToExecuting) {
    patch.readyToExecuting = readyToExecutingResult.value ?? null;
  }

  return { ok: true, value: patch };
}

export function applyWorkflowPatchToWorkspaceConfig(
  workspaceConfig: WorkspaceConfig,
  patch: WorkflowSettingsPatch,
  globalDefaults: WorkspaceWorkflowSettings,
): { nextConfig: WorkspaceConfig; effective: WorkspaceWorkflowSettings } {
  const nextWipLimits: Partial<Record<'backlog' | 'ready' | 'executing' | 'complete' | 'archived', number | null>> = {
    ...(workspaceConfig.wipLimits ?? {}),
  };
  const nextWorkflowAutomation = {
    ...(workspaceConfig.workflowAutomation ?? {}),
  };
  let nextQueueProcessing = workspaceConfig.queueProcessing
    ? { ...workspaceConfig.queueProcessing }
    : undefined;

  if (patch.readyLimit !== undefined) {
    if (patch.readyLimit === null) {
      delete nextWipLimits.ready;
    } else {
      nextWipLimits.ready = patch.readyLimit;
    }
  }

  if (patch.executingLimit !== undefined) {
    if (patch.executingLimit === null) {
      delete nextWipLimits.executing;
    } else {
      nextWipLimits.executing = patch.executingLimit;
    }
  }

  if (patch.backlogToReady !== undefined) {
    if (patch.backlogToReady === null) {
      delete nextWorkflowAutomation.backlogToReady;
    } else {
      nextWorkflowAutomation.backlogToReady = patch.backlogToReady;
    }
  }

  if (patch.readyToExecuting !== undefined) {
    if (patch.readyToExecuting === null) {
      delete nextWorkflowAutomation.readyToExecuting;
      nextQueueProcessing = undefined;
    } else {
      nextWorkflowAutomation.readyToExecuting = patch.readyToExecuting;
      nextQueueProcessing = { enabled: patch.readyToExecuting };
    }
  }

  const nextConfig: WorkspaceConfig = {
    ...workspaceConfig,
    wipLimits: nextWipLimits,
    workflowAutomation: nextWorkflowAutomation,
    queueProcessing: nextQueueProcessing,
  };

  const effective = resolveWorkspaceWorkflowSettings(nextConfig, globalDefaults);

  return {
    nextConfig,
    effective,
  };
}
