import {
  resolveGlobalWorkflowSettings,
  resolveWorkspaceWorkflowSettings,
  getWorkspaceWorkflowOverrides,
  type QueueStatus,
  type WorkspaceConfig,
  type WorkspaceWorkflowSettings,
  type WorkspaceWorkflowSettingsResponse,
  type WorkflowDefaultsConfig,
  type ModelConfig,
  type ModelProfile,
} from '@task-factory/shared';
import {
  loadPiFactorySettings,
  type PiFactorySettings,
} from './pi-integration.js';

const SLOT_LIMIT_MIN = 1;
const SLOT_LIMIT_MAX = 100;
const ALLOWED_THINKING_LEVELS = new Set<NonNullable<ModelConfig['thinkingLevel']>>([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

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

function parseModelConfig(
  value: unknown,
  fieldName: string,
): { ok: true; value: ModelConfig } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: `${fieldName} must be an object with provider and modelId` };
  }

  const provider = (value as { provider?: unknown }).provider;
  const modelId = (value as { modelId?: unknown }).modelId;
  const thinkingLevel = (value as { thinkingLevel?: unknown }).thinkingLevel;

  if (typeof provider !== 'string' || provider.trim().length === 0) {
    return { ok: false, error: `${fieldName}.provider must be a non-empty string` };
  }

  if (typeof modelId !== 'string' || modelId.trim().length === 0) {
    return { ok: false, error: `${fieldName}.modelId must be a non-empty string` };
  }

  if (thinkingLevel !== undefined) {
    if (typeof thinkingLevel !== 'string' || !ALLOWED_THINKING_LEVELS.has(thinkingLevel as NonNullable<ModelConfig['thinkingLevel']>)) {
      return { ok: false, error: `${fieldName}.thinkingLevel must be one of: off, minimal, low, medium, high, xhigh` };
    }
  }

  const modelConfig: ModelConfig = {
    provider: provider.trim(),
    modelId: modelId.trim(),
  };

  if (typeof thinkingLevel === 'string') {
    modelConfig.thinkingLevel = thinkingLevel as ModelConfig['thinkingLevel'];
  }

  return { ok: true, value: modelConfig };
}

function parseFallbackModels(
  value: unknown,
  fieldName: string,
): { ok: true; value: ModelConfig[] | undefined } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (!Array.isArray(value)) {
    return { ok: false, error: `${fieldName} must be an array when provided` };
  }

  const normalizedFallbacks: ModelConfig[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const result = parseModelConfig(value[index], `${fieldName}[${index}]`);
    if (!result.ok) {
      return result;
    }
    normalizedFallbacks.push(result.value);
  }

  return { ok: true, value: normalizedFallbacks };
}

function parseModelProfiles(
  value: unknown,
): { ok: true; value: ModelProfile[] | undefined } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (value === null) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(value)) {
    return { ok: false, error: 'modelProfiles must be an array when provided' };
  }

  const normalizedProfiles: ModelProfile[] = [];
  const seenIds = new Set<string>();

  for (let index = 0; index < value.length; index += 1) {
    const rawProfile = value[index];
    const fieldPrefix = `modelProfiles[${index}]`;

    if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) {
      return { ok: false, error: `${fieldPrefix} must be an object` };
    }

    const id = (rawProfile as { id?: unknown }).id;
    const name = (rawProfile as { name?: unknown }).name;

    if (typeof id !== 'string' || id.trim().length === 0) {
      return { ok: false, error: `${fieldPrefix}.id must be a non-empty string` };
    }

    if (typeof name !== 'string' || name.trim().length === 0) {
      return { ok: false, error: `${fieldPrefix}.name must be a non-empty string` };
    }

    const normalizedId = id.trim();
    if (seenIds.has(normalizedId)) {
      return { ok: false, error: `${fieldPrefix}.id must be unique` };
    }
    seenIds.add(normalizedId);

    const planningResult = parseModelConfig(
      (rawProfile as { planningModelConfig?: unknown }).planningModelConfig,
      `${fieldPrefix}.planningModelConfig`,
    );
    if (!planningResult.ok) {
      return planningResult;
    }

    const executionSource = (rawProfile as { executionModelConfig?: unknown; modelConfig?: unknown }).executionModelConfig
      ?? (rawProfile as { modelConfig?: unknown }).modelConfig;
    const executionResult = parseModelConfig(
      executionSource,
      `${fieldPrefix}.executionModelConfig`,
    );
    if (!executionResult.ok) {
      return executionResult;
    }

    // Parse optional fallback model arrays
    const planningFallbackModelsResult = parseFallbackModels(
      (rawProfile as { planningFallbackModels?: unknown }).planningFallbackModels,
      `${fieldPrefix}.planningFallbackModels`,
    );
    if (!planningFallbackModelsResult.ok) {
      return planningFallbackModelsResult;
    }

    const executionFallbackModelsResult = parseFallbackModels(
      (rawProfile as { executionFallbackModels?: unknown }).executionFallbackModels,
      `${fieldPrefix}.executionFallbackModels`,
    );
    if (!executionFallbackModelsResult.ok) {
      return executionFallbackModelsResult;
    }

    const normalizedProfile: ModelProfile = {
      id: normalizedId,
      name: name.trim(),
      planningModelConfig: planningResult.value,
      executionModelConfig: executionResult.value,
      // Keep legacy alias aligned for backward compatibility.
      modelConfig: executionResult.value,
    };

    // Add fallback models if present and non-empty
    if (planningFallbackModelsResult.value && planningFallbackModelsResult.value.length > 0) {
      normalizedProfile.planningFallbackModels = planningFallbackModelsResult.value;
    }
    if (executionFallbackModelsResult.value && executionFallbackModelsResult.value.length > 0) {
      normalizedProfile.executionFallbackModels = executionFallbackModelsResult.value;
    }

    normalizedProfiles.push(normalizedProfile);
  }

  return { ok: true, value: normalizedProfiles };
}

export function normalizePiFactorySettingsPayload(
  payload: PiFactorySettings,
): { ok: true; value: PiFactorySettings } | { ok: false; error: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'Request body must be an object' };
  }

  const normalized: PiFactorySettings = { ...payload };

  const modelProfilesResult = parseModelProfiles(payload.modelProfiles);
  if (!modelProfilesResult.ok) {
    return modelProfilesResult;
  }

  if (modelProfilesResult.value === undefined) {
    delete normalized.modelProfiles;
  } else {
    normalized.modelProfiles = modelProfilesResult.value;
  }

  const rawDefaults = payload.workflowDefaults;

  if (rawDefaults === undefined || rawDefaults === null) {
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

  normalized.workflowDefaults = normalizedDefaults;

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
