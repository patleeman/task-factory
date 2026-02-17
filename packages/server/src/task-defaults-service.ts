import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import {
  DEFAULT_PRE_EXECUTION_SKILLS,
  DEFAULT_POST_EXECUTION_SKILLS,
  DEFAULT_PLANNING_PROMPT_TEMPLATE,
  DEFAULT_EXECUTION_PROMPT_TEMPLATE,
  type CreateTaskRequest,
  type ModelConfig,
  type TaskDefaults,
  type SkillHook,
} from '@pi-factory/shared';
import {
  loadPiFactorySettings,
  savePiFactorySettings,
  type PiFactorySettings,
} from './pi-integration.js';
import { getTaskFactoryHomeDir } from './taskfactory-home.js';

export interface AvailableModelForDefaults {
  provider: string;
  id: string;
  reasoning: boolean;
}

export interface AvailableSkillForDefaults {
  id: string;
  hooks: SkillHook[];
}

export const ALLOWED_THINKING_LEVELS: ReadonlyArray<NonNullable<ModelConfig['thinkingLevel']>> = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

const ALLOWED_THINKING_LEVEL_SET = new Set<string>(ALLOWED_THINKING_LEVELS);

const BUILT_IN_TASK_DEFAULTS: TaskDefaults = {
  planningModelConfig: undefined,
  executionModelConfig: undefined,
  modelConfig: undefined,
  preExecutionSkills: [...DEFAULT_PRE_EXECUTION_SKILLS],
  postExecutionSkills: [...DEFAULT_POST_EXECUTION_SKILLS],
  planningPromptTemplate: DEFAULT_PLANNING_PROMPT_TEMPLATE,
  executionPromptTemplate: DEFAULT_EXECUTION_PROMPT_TEMPLATE,
};

const PI_FACTORY_DIR = getTaskFactoryHomeDir();
const WORKSPACE_REGISTRY_PATH = join(PI_FACTORY_DIR, 'workspaces.json');
const WORKSPACE_DEFAULTS_FILE_NAME = 'task-defaults.json';

interface TaskDefaultsOverride {
  planningModelConfig?: ModelConfig;
  executionModelConfig?: ModelConfig;
  modelConfig?: ModelConfig;
  preExecutionSkills?: string[];
  postExecutionSkills?: string[];
  planningPromptTemplate?: string;
  executionPromptTemplate?: string;
}

function cloneModelConfig(modelConfig: ModelConfig | undefined): ModelConfig | undefined {
  if (!modelConfig) return undefined;
  return {
    provider: modelConfig.provider,
    modelId: modelConfig.modelId,
    thinkingLevel: modelConfig.thinkingLevel,
  };
}

function cloneTaskDefaults(defaults: TaskDefaults): TaskDefaults {
  const executionModelConfig = cloneModelConfig(defaults.executionModelConfig ?? defaults.modelConfig);
  const planningModelConfig = cloneModelConfig(defaults.planningModelConfig);

  return {
    planningModelConfig,
    executionModelConfig,
    // Keep legacy field aligned for backward compatibility.
    modelConfig: cloneModelConfig(executionModelConfig),
    preExecutionSkills: [...defaults.preExecutionSkills],
    postExecutionSkills: [...defaults.postExecutionSkills],
    planningPromptTemplate: defaults.planningPromptTemplate,
    executionPromptTemplate: defaults.executionPromptTemplate,
  };
}

function normalizeTaskDefaults(defaults: TaskDefaults): TaskDefaults {
  const executionModelConfig = cloneModelConfig(defaults.executionModelConfig ?? defaults.modelConfig);

  return {
    planningModelConfig: cloneModelConfig(defaults.planningModelConfig),
    executionModelConfig,
    // Keep legacy field aligned for backward compatibility.
    modelConfig: cloneModelConfig(executionModelConfig),
    preExecutionSkills: [...defaults.preExecutionSkills],
    postExecutionSkills: [...defaults.postExecutionSkills],
    planningPromptTemplate: defaults.planningPromptTemplate,
    executionPromptTemplate: defaults.executionPromptTemplate,
  };
}

function sanitizeModelConfig(raw: unknown): ModelConfig | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const provider = (raw as { provider?: unknown }).provider;
  const modelId = (raw as { modelId?: unknown }).modelId;
  const thinkingLevel = (raw as { thinkingLevel?: unknown }).thinkingLevel;

  if (typeof provider !== 'string' || provider.trim().length === 0) {
    return undefined;
  }

  if (typeof modelId !== 'string' || modelId.trim().length === 0) {
    return undefined;
  }

  const modelConfig: ModelConfig = {
    provider: provider.trim(),
    modelId: modelId.trim(),
  };

  if (typeof thinkingLevel === 'string' && ALLOWED_THINKING_LEVEL_SET.has(thinkingLevel)) {
    modelConfig.thinkingLevel = thinkingLevel as ModelConfig['thinkingLevel'];
  }

  return modelConfig;
}

function sanitizePostSkillIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_POST_EXECUTION_SKILLS];
  }

  return raw.filter((skillId): skillId is string => typeof skillId === 'string');
}

function sanitizePreSkillIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_PRE_EXECUTION_SKILLS];
  }

  return raw.filter((skillId): skillId is string => typeof skillId === 'string');
}

function sanitizeOptionalSkillIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  return raw.filter((skillId): skillId is string => typeof skillId === 'string');
}

function sanitizePromptTemplate(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function areModelConfigsEqual(left: ModelConfig | undefined, right: ModelConfig | undefined): boolean {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.provider === right.provider
    && left.modelId === right.modelId
    && left.thinkingLevel === right.thinkingLevel;
}

function areSkillIdListsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }

  return true;
}

function buildWorkspaceTaskDefaultsOverride(
  defaults: TaskDefaults,
  globalDefaults: TaskDefaults,
): TaskDefaultsOverride | null {
  const normalizedDefaults = normalizeTaskDefaults(defaults);
  const normalizedGlobalDefaults = normalizeTaskDefaults(globalDefaults);

  const override: TaskDefaultsOverride = {};

  if (!areModelConfigsEqual(normalizedDefaults.planningModelConfig, normalizedGlobalDefaults.planningModelConfig)) {
    override.planningModelConfig = cloneModelConfig(normalizedDefaults.planningModelConfig);
  }

  const normalizedExecutionModel = normalizedDefaults.executionModelConfig ?? normalizedDefaults.modelConfig;
  const normalizedGlobalExecutionModel = normalizedGlobalDefaults.executionModelConfig ?? normalizedGlobalDefaults.modelConfig;

  if (!areModelConfigsEqual(normalizedExecutionModel, normalizedGlobalExecutionModel)) {
    override.executionModelConfig = cloneModelConfig(normalizedExecutionModel);
    // Keep legacy field aligned for backward compatibility.
    override.modelConfig = cloneModelConfig(normalizedExecutionModel);
  }

  if (!areSkillIdListsEqual(normalizedDefaults.preExecutionSkills, normalizedGlobalDefaults.preExecutionSkills)) {
    override.preExecutionSkills = [...normalizedDefaults.preExecutionSkills];
  }

  if (!areSkillIdListsEqual(normalizedDefaults.postExecutionSkills, normalizedGlobalDefaults.postExecutionSkills)) {
    override.postExecutionSkills = [...normalizedDefaults.postExecutionSkills];
  }

  if (normalizedDefaults.planningPromptTemplate !== normalizedGlobalDefaults.planningPromptTemplate) {
    override.planningPromptTemplate = normalizedDefaults.planningPromptTemplate;
  }

  if (normalizedDefaults.executionPromptTemplate !== normalizedGlobalDefaults.executionPromptTemplate) {
    override.executionPromptTemplate = normalizedDefaults.executionPromptTemplate;
  }

  const hasOverrides =
    override.planningModelConfig !== undefined
    || override.executionModelConfig !== undefined
    || override.modelConfig !== undefined
    || override.preExecutionSkills !== undefined
    || override.postExecutionSkills !== undefined
    || override.planningPromptTemplate !== undefined
    || override.executionPromptTemplate !== undefined;

  return hasOverrides ? override : null;
}

function resolveTaskDefaultsOverride(raw: unknown): TaskDefaultsOverride | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const defaults = raw as {
    planningModelConfig?: unknown;
    executionModelConfig?: unknown;
    modelConfig?: unknown;
    preExecutionSkills?: unknown;
    postExecutionSkills?: unknown;
    planningPromptTemplate?: unknown;
    executionPromptTemplate?: unknown;
  };

  const override: TaskDefaultsOverride = {
    planningModelConfig: sanitizeModelConfig(defaults.planningModelConfig),
    executionModelConfig: sanitizeModelConfig(defaults.executionModelConfig),
    modelConfig: sanitizeModelConfig(defaults.modelConfig),
    preExecutionSkills: sanitizeOptionalSkillIds(defaults.preExecutionSkills),
    postExecutionSkills: sanitizeOptionalSkillIds(defaults.postExecutionSkills),
    planningPromptTemplate: sanitizePromptTemplate(defaults.planningPromptTemplate),
    executionPromptTemplate: sanitizePromptTemplate(defaults.executionPromptTemplate),
  };

  const hasOverrides =
    override.planningModelConfig !== undefined
    || override.executionModelConfig !== undefined
    || override.modelConfig !== undefined
    || override.preExecutionSkills !== undefined
    || override.postExecutionSkills !== undefined
    || override.planningPromptTemplate !== undefined
    || override.executionPromptTemplate !== undefined;

  return hasOverrides ? override : null;
}

function mergeTaskDefaults(base: TaskDefaults, workspaceOverride: TaskDefaultsOverride | null): TaskDefaults {
  if (!workspaceOverride) {
    return cloneTaskDefaults(base);
  }

  const resolvedExecutionOverride = workspaceOverride.executionModelConfig ?? workspaceOverride.modelConfig;
  const executionModelConfig = resolvedExecutionOverride !== undefined
    ? cloneModelConfig(resolvedExecutionOverride)
    : cloneModelConfig(base.executionModelConfig ?? base.modelConfig);

  return {
    planningModelConfig: workspaceOverride.planningModelConfig !== undefined
      ? cloneModelConfig(workspaceOverride.planningModelConfig)
      : cloneModelConfig(base.planningModelConfig),
    executionModelConfig,
    // Keep legacy field aligned for backward compatibility.
    modelConfig: cloneModelConfig(executionModelConfig),
    preExecutionSkills: workspaceOverride.preExecutionSkills !== undefined
      ? [...workspaceOverride.preExecutionSkills]
      : [...base.preExecutionSkills],
    postExecutionSkills: workspaceOverride.postExecutionSkills !== undefined
      ? [...workspaceOverride.postExecutionSkills]
      : [...base.postExecutionSkills],
    planningPromptTemplate: workspaceOverride.planningPromptTemplate !== undefined
      ? workspaceOverride.planningPromptTemplate
      : base.planningPromptTemplate,
    executionPromptTemplate: workspaceOverride.executionPromptTemplate !== undefined
      ? workspaceOverride.executionPromptTemplate
      : base.executionPromptTemplate,
  };
}

function getWorkspaceTaskDefaultsPath(workspaceId: string): string {
  return join(PI_FACTORY_DIR, 'workspaces', workspaceId, WORKSPACE_DEFAULTS_FILE_NAME);
}

function findWorkspaceIdByPath(workspacePath: string): string | undefined {
  if (!existsSync(WORKSPACE_REGISTRY_PATH)) {
    return undefined;
  }

  try {
    const raw = readFileSync(WORKSPACE_REGISTRY_PATH, 'utf-8');
    const entries = JSON.parse(raw) as Array<{ id?: unknown; path?: unknown }>;

    for (const entry of entries) {
      if (typeof entry.id === 'string' && entry.path === workspacePath) {
        return entry.id;
      }
    }
  } catch (err) {
    console.warn(
      `[TaskDefaults] Failed to parse workspace registry at ${WORKSPACE_REGISTRY_PATH}: ${String(err)}`,
    );
  }

  return undefined;
}

function loadWorkspaceTaskDefaultsOverride(workspaceId: string): TaskDefaultsOverride | null {
  const workspaceDefaultsPath = getWorkspaceTaskDefaultsPath(workspaceId);

  if (!existsSync(workspaceDefaultsPath)) {
    return null;
  }

  try {
    const raw = readFileSync(workspaceDefaultsPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return resolveTaskDefaultsOverride(parsed);
  } catch (err) {
    console.warn(
      `[TaskDefaults] Failed to load workspace task defaults at ${workspaceDefaultsPath}: ${String(err)}`,
    );
    return null;
  }
}

export function getBuiltInTaskDefaults(): TaskDefaults {
  return cloneTaskDefaults(BUILT_IN_TASK_DEFAULTS);
}

export function resolveTaskDefaults(rawSettings: PiFactorySettings | null | undefined): TaskDefaults {
  const defaults = rawSettings?.taskDefaults;

  if (!defaults) {
    return getBuiltInTaskDefaults();
  }

  const legacyModelConfig = sanitizeModelConfig((defaults as { modelConfig?: unknown }).modelConfig);
  const planningModelConfig = sanitizeModelConfig((defaults as { planningModelConfig?: unknown }).planningModelConfig);
  const executionModelConfig = sanitizeModelConfig((defaults as { executionModelConfig?: unknown }).executionModelConfig)
    ?? legacyModelConfig;

  return {
    planningModelConfig,
    executionModelConfig,
    // Keep legacy field aligned for backward compatibility.
    modelConfig: executionModelConfig,
    preExecutionSkills: sanitizePreSkillIds((defaults as { preExecutionSkills?: unknown }).preExecutionSkills),
    postExecutionSkills: sanitizePostSkillIds((defaults as { postExecutionSkills?: unknown }).postExecutionSkills),
    planningPromptTemplate: sanitizePromptTemplate((defaults as { planningPromptTemplate?: unknown }).planningPromptTemplate),
    executionPromptTemplate: sanitizePromptTemplate((defaults as { executionPromptTemplate?: unknown }).executionPromptTemplate),
  };
}

export function loadTaskDefaults(): TaskDefaults {
  const settings = loadPiFactorySettings();
  return resolveTaskDefaults(settings);
}

export function loadTaskDefaultsForWorkspace(workspaceId: string): TaskDefaults {
  const globalDefaults = loadTaskDefaults();
  const workspaceOverride = loadWorkspaceTaskDefaultsOverride(workspaceId);
  return mergeTaskDefaults(globalDefaults, workspaceOverride);
}

export function loadTaskDefaultsForWorkspacePath(workspacePath: string): TaskDefaults {
  const workspaceId = findWorkspaceIdByPath(workspacePath);
  if (!workspaceId) {
    return loadTaskDefaults();
  }

  return loadTaskDefaultsForWorkspace(workspaceId);
}

export function saveTaskDefaults(defaults: TaskDefaults): TaskDefaults {
  const current = loadPiFactorySettings() || {};
  const normalized = normalizeTaskDefaults(defaults);

  savePiFactorySettings({
    ...current,
    taskDefaults: normalized,
  });

  return cloneTaskDefaults(normalized);
}

export function saveWorkspaceTaskDefaults(workspaceId: string, defaults: TaskDefaults): TaskDefaults {
  const normalized = normalizeTaskDefaults(defaults);
  const globalDefaults = loadTaskDefaults();
  const workspaceOverride = buildWorkspaceTaskDefaultsOverride(normalized, globalDefaults);

  const workspaceDefaultsPath = getWorkspaceTaskDefaultsPath(workspaceId);
  const workspaceDefaultsDir = dirname(workspaceDefaultsPath);

  if (!existsSync(workspaceDefaultsDir)) {
    mkdirSync(workspaceDefaultsDir, { recursive: true });
  }

  if (!workspaceOverride) {
    // Persist an empty object so workspace defaults continue falling back to globals.
    writeFileSync(workspaceDefaultsPath, JSON.stringify({}, null, 2), 'utf-8');
    return loadTaskDefaultsForWorkspace(workspaceId);
  }

  writeFileSync(workspaceDefaultsPath, JSON.stringify(workspaceOverride, null, 2), 'utf-8');

  return loadTaskDefaultsForWorkspace(workspaceId);
}

export function applyTaskDefaultsToRequest(request: CreateTaskRequest, defaults: TaskDefaults): {
  planningModelConfig: ModelConfig | undefined;
  executionModelConfig: ModelConfig | undefined;
  /** Legacy alias for execution model. */
  modelConfig: ModelConfig | undefined;
  preExecutionSkills: string[];
  postExecutionSkills: string[];
  planningPromptTemplate: string | undefined;
  executionPromptTemplate: string | undefined;
} {
  const resolvedExecutionDefaults = defaults.executionModelConfig ?? defaults.modelConfig;

  const planningModelConfig = request.planningModelConfig !== undefined
    ? cloneModelConfig(request.planningModelConfig)
    : cloneModelConfig(defaults.planningModelConfig);

  const executionModelConfig = request.executionModelConfig !== undefined
    ? cloneModelConfig(request.executionModelConfig)
    : request.modelConfig !== undefined
      ? cloneModelConfig(request.modelConfig)
      : cloneModelConfig(resolvedExecutionDefaults);

  const preExecutionSkills = request.preExecutionSkills !== undefined
    ? [...request.preExecutionSkills]
    : [...defaults.preExecutionSkills];

  const postExecutionSkills = request.postExecutionSkills !== undefined
    ? [...request.postExecutionSkills]
    : [...defaults.postExecutionSkills];

  return {
    planningModelConfig,
    executionModelConfig,
    // Keep legacy alias aligned to execution model.
    modelConfig: cloneModelConfig(executionModelConfig),
    preExecutionSkills,
    postExecutionSkills,
    planningPromptTemplate: defaults.planningPromptTemplate,
    executionPromptTemplate: defaults.executionPromptTemplate,
  };
}

function parseModelConfigPayload(raw: unknown, fieldName: string):
  { ok: true; value: ModelConfig | undefined }
  | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }

  if (typeof raw !== 'object') {
    return { ok: false, error: `${fieldName} must be an object` };
  }

  const provider = (raw as { provider?: unknown }).provider;
  const modelId = (raw as { modelId?: unknown }).modelId;
  const thinkingLevel = (raw as { thinkingLevel?: unknown }).thinkingLevel;

  if (typeof provider !== 'string' || provider.trim().length === 0) {
    return { ok: false, error: `${fieldName}.provider is required` };
  }

  if (typeof modelId !== 'string' || modelId.trim().length === 0) {
    return { ok: false, error: `${fieldName}.modelId is required` };
  }

  const modelConfig: ModelConfig = {
    provider: provider.trim(),
    modelId: modelId.trim(),
  };

  if (thinkingLevel !== undefined) {
    if (typeof thinkingLevel !== 'string' || !ALLOWED_THINKING_LEVEL_SET.has(thinkingLevel)) {
      return {
        ok: false,
        error: `${fieldName}.thinkingLevel must be one of: off, minimal, low, medium, high, xhigh`,
      };
    }

    modelConfig.thinkingLevel = thinkingLevel as ModelConfig['thinkingLevel'];
  }

  return { ok: true, value: modelConfig };
}

function validateModelConfig(
  modelConfig: ModelConfig | undefined,
  availableModels: AvailableModelForDefaults[],
  label: string,
): { ok: true } | { ok: false; error: string } {
  if (!modelConfig) {
    return { ok: true };
  }

  const selectedModel = availableModels.find(
    (model) => model.provider === modelConfig.provider && model.id === modelConfig.modelId,
  );

  if (!selectedModel) {
    return {
      ok: false,
      error: `${label} model ${modelConfig.provider}/${modelConfig.modelId} is not available for the selected provider`,
    };
  }

  if (!modelConfig.thinkingLevel) {
    return { ok: true };
  }

  if (!ALLOWED_THINKING_LEVEL_SET.has(modelConfig.thinkingLevel)) {
    return {
      ok: false,
      error: `${label} thinking level must be one of: off, minimal, low, medium, high, xhigh`,
    };
  }

  if (!selectedModel.reasoning) {
    return {
      ok: false,
      error: `${label} thinking level is only supported for reasoning models. ${selectedModel.provider}/${selectedModel.id} is not reasoning-capable`,
    };
  }

  return { ok: true };
}

export function parseTaskDefaultsPayload(raw: unknown): { ok: true; value: TaskDefaults } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Request body must be an object' };
  }

  const payload = raw as {
    planningModelConfig?: unknown;
    executionModelConfig?: unknown;
    modelConfig?: unknown;
    preExecutionSkills?: unknown;
    postExecutionSkills?: unknown;
    planningPromptTemplate?: unknown;
    executionPromptTemplate?: unknown;
  };

  if (!Array.isArray(payload.postExecutionSkills)) {
    return { ok: false, error: 'postExecutionSkills must be an array of skill IDs' };
  }

  const hasNonStringPostSkill = payload.postExecutionSkills.some((skillId) => typeof skillId !== 'string');
  if (hasNonStringPostSkill) {
    return { ok: false, error: 'postExecutionSkills must contain only string skill IDs' };
  }

  // preExecutionSkills defaults to empty array if not provided
  const preExecutionSkills: string[] = Array.isArray(payload.preExecutionSkills)
    ? payload.preExecutionSkills.filter((id): id is string => typeof id === 'string')
    : [];

  const parsedPlanningModelConfig = parseModelConfigPayload(payload.planningModelConfig, 'planningModelConfig');
  if (!parsedPlanningModelConfig.ok) {
    return parsedPlanningModelConfig;
  }

  const parsedExecutionModelConfig = parseModelConfigPayload(payload.executionModelConfig, 'executionModelConfig');
  if (!parsedExecutionModelConfig.ok) {
    return parsedExecutionModelConfig;
  }

  const parsedLegacyModelConfig = parseModelConfigPayload(payload.modelConfig, 'modelConfig');
  if (!parsedLegacyModelConfig.ok) {
    return parsedLegacyModelConfig;
  }

  const executionModelConfig = parsedExecutionModelConfig.value ?? parsedLegacyModelConfig.value;

  return {
    ok: true,
    value: {
      planningModelConfig: parsedPlanningModelConfig.value,
      executionModelConfig,
      // Keep legacy field aligned for backward compatibility.
      modelConfig: executionModelConfig,
      preExecutionSkills: [...preExecutionSkills],
      postExecutionSkills: [...payload.postExecutionSkills],
      planningPromptTemplate: sanitizePromptTemplate(payload.planningPromptTemplate),
      executionPromptTemplate: sanitizePromptTemplate(payload.executionPromptTemplate),
    },
  };
}

export function validateTaskDefaults(
  defaults: TaskDefaults,
  availableModels: AvailableModelForDefaults[],
  availableSkills: AvailableSkillForDefaults[],
): { ok: true } | { ok: false; error: string } {
  const planningValidation = validateModelConfig(defaults.planningModelConfig, availableModels, 'Planning');
  if (!planningValidation.ok) {
    return planningValidation;
  }

  const executionModelConfig = defaults.executionModelConfig ?? defaults.modelConfig;
  const executionValidation = validateModelConfig(executionModelConfig, availableModels, 'Execution');
  if (!executionValidation.ok) {
    return executionValidation;
  }

  const skillById = new Map<string, AvailableSkillForDefaults>();
  for (const skill of availableSkills) {
    skillById.set(skill.id, skill);
  }

  const unknownPreSkills = defaults.preExecutionSkills.filter((skillId) => !skillById.has(skillId));
  if (unknownPreSkills.length > 0) {
    return {
      ok: false,
      error: `Unknown pre-execution skills: ${unknownPreSkills.join(', ')}`,
    };
  }

  const unknownPostSkills = defaults.postExecutionSkills.filter((skillId) => !skillById.has(skillId));
  if (unknownPostSkills.length > 0) {
    return {
      ok: false,
      error: `Unknown post-execution skills: ${unknownPostSkills.join(', ')}`,
    };
  }

  const incompatiblePreSkills = defaults.preExecutionSkills.filter((skillId) => {
    const skill = skillById.get(skillId);
    return skill ? !skill.hooks.includes('pre') : false;
  });
  if (incompatiblePreSkills.length > 0) {
    return {
      ok: false,
      error: `Pre-execution skills do not support pre hook: ${incompatiblePreSkills.join(', ')}`,
    };
  }

  const incompatiblePostSkills = defaults.postExecutionSkills.filter((skillId) => {
    const skill = skillById.get(skillId);
    return skill ? !skill.hooks.includes('post') : false;
  });
  if (incompatiblePostSkills.length > 0) {
    return {
      ok: false,
      error: `Post-execution skills do not support post hook: ${incompatiblePostSkills.join(', ')}`,
    };
  }

  return { ok: true };
}

export async function loadAvailableModelsForDefaults(): Promise<AvailableModelForDefaults[]> {
  const { AuthStorage, ModelRegistry } = await import('@mariozechner/pi-coding-agent');
  const authStorage = new AuthStorage();
  const modelRegistry = new ModelRegistry(authStorage);
  const available = modelRegistry.getAvailable();

  return available.map((model: any) => ({
    provider: typeof model.provider === 'string' ? model.provider : model.provider?.id || 'unknown',
    id: model.id,
    reasoning: Boolean(model.reasoning),
  }));
}
