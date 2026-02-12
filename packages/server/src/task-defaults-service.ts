import {
  DEFAULT_POST_EXECUTION_SKILLS,
  type CreateTaskRequest,
  type ModelConfig,
  type TaskDefaults,
} from '@pi-factory/shared';
import {
  loadPiFactorySettings,
  savePiFactorySettings,
  type PiFactorySettings,
} from './pi-integration.js';

export interface AvailableModelForDefaults {
  provider: string;
  id: string;
  reasoning: boolean;
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
  modelConfig: undefined,
  postExecutionSkills: [...DEFAULT_POST_EXECUTION_SKILLS],
};

function cloneModelConfig(modelConfig: ModelConfig | undefined): ModelConfig | undefined {
  if (!modelConfig) return undefined;
  return {
    provider: modelConfig.provider,
    modelId: modelConfig.modelId,
    thinkingLevel: modelConfig.thinkingLevel,
  };
}

function cloneTaskDefaults(defaults: TaskDefaults): TaskDefaults {
  return {
    modelConfig: cloneModelConfig(defaults.modelConfig),
    postExecutionSkills: [...defaults.postExecutionSkills],
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

function sanitizeSkillIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_POST_EXECUTION_SKILLS];
  }

  return raw.filter((skillId): skillId is string => typeof skillId === 'string');
}

export function getBuiltInTaskDefaults(): TaskDefaults {
  return cloneTaskDefaults(BUILT_IN_TASK_DEFAULTS);
}

export function resolveTaskDefaults(rawSettings: PiFactorySettings | null | undefined): TaskDefaults {
  const defaults = rawSettings?.taskDefaults;

  if (!defaults) {
    return getBuiltInTaskDefaults();
  }

  return {
    modelConfig: sanitizeModelConfig((defaults as { modelConfig?: unknown }).modelConfig),
    postExecutionSkills: sanitizeSkillIds((defaults as { postExecutionSkills?: unknown }).postExecutionSkills),
  };
}

export function loadTaskDefaults(): TaskDefaults {
  const settings = loadPiFactorySettings();
  return resolveTaskDefaults(settings);
}

export function saveTaskDefaults(defaults: TaskDefaults): TaskDefaults {
  const current = loadPiFactorySettings() || {};
  const normalized = {
    modelConfig: cloneModelConfig(defaults.modelConfig),
    postExecutionSkills: [...defaults.postExecutionSkills],
  };

  savePiFactorySettings({
    ...current,
    taskDefaults: normalized,
  });

  return normalized;
}

export function applyTaskDefaultsToRequest(request: CreateTaskRequest, defaults: TaskDefaults): {
  modelConfig: ModelConfig | undefined;
  postExecutionSkills: string[];
} {
  const modelConfig = request.modelConfig !== undefined
    ? cloneModelConfig(request.modelConfig)
    : cloneModelConfig(defaults.modelConfig);

  const postExecutionSkills = request.postExecutionSkills !== undefined
    ? [...request.postExecutionSkills]
    : [...defaults.postExecutionSkills];

  return {
    modelConfig,
    postExecutionSkills,
  };
}

export function parseTaskDefaultsPayload(raw: unknown): { ok: true; value: TaskDefaults } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Request body must be an object' };
  }

  const payload = raw as {
    modelConfig?: unknown;
    postExecutionSkills?: unknown;
  };

  if (!Array.isArray(payload.postExecutionSkills)) {
    return { ok: false, error: 'postExecutionSkills must be an array of skill IDs' };
  }

  const hasNonStringSkill = payload.postExecutionSkills.some((skillId) => typeof skillId !== 'string');
  if (hasNonStringSkill) {
    return { ok: false, error: 'postExecutionSkills must contain only string skill IDs' };
  }

  let modelConfig: ModelConfig | undefined;

  if (payload.modelConfig !== undefined && payload.modelConfig !== null) {
    if (typeof payload.modelConfig !== 'object') {
      return { ok: false, error: 'modelConfig must be an object' };
    }

    const provider = (payload.modelConfig as { provider?: unknown }).provider;
    const modelId = (payload.modelConfig as { modelId?: unknown }).modelId;
    const thinkingLevel = (payload.modelConfig as { thinkingLevel?: unknown }).thinkingLevel;

    if (typeof provider !== 'string' || provider.trim().length === 0) {
      return { ok: false, error: 'modelConfig.provider is required' };
    }

    if (typeof modelId !== 'string' || modelId.trim().length === 0) {
      return { ok: false, error: 'modelConfig.modelId is required' };
    }

    modelConfig = {
      provider: provider.trim(),
      modelId: modelId.trim(),
    };

    if (thinkingLevel !== undefined) {
      if (typeof thinkingLevel !== 'string' || !ALLOWED_THINKING_LEVEL_SET.has(thinkingLevel)) {
        return {
          ok: false,
          error: 'modelConfig.thinkingLevel must be one of: off, minimal, low, medium, high, xhigh',
        };
      }

      modelConfig.thinkingLevel = thinkingLevel as ModelConfig['thinkingLevel'];
    }
  }

  return {
    ok: true,
    value: {
      modelConfig,
      postExecutionSkills: [...payload.postExecutionSkills],
    },
  };
}

export function validateTaskDefaults(
  defaults: TaskDefaults,
  availableModels: AvailableModelForDefaults[],
  availableSkillIds: string[],
): { ok: true } | { ok: false; error: string } {
  if (defaults.modelConfig) {
    const selectedModel = availableModels.find(
      (model) => model.provider === defaults.modelConfig!.provider && model.id === defaults.modelConfig!.modelId,
    );

    if (!selectedModel) {
      return {
        ok: false,
        error: `Model ${defaults.modelConfig.provider}/${defaults.modelConfig.modelId} is not available for the selected provider`,
      };
    }

    if (defaults.modelConfig.thinkingLevel) {
      if (!ALLOWED_THINKING_LEVEL_SET.has(defaults.modelConfig.thinkingLevel)) {
        return {
          ok: false,
          error: 'Thinking level must be one of: off, minimal, low, medium, high, xhigh',
        };
      }

      if (!selectedModel.reasoning) {
        return {
          ok: false,
          error: `Thinking level is only supported for reasoning models. ${selectedModel.provider}/${selectedModel.id} is not reasoning-capable`,
        };
      }
    }
  }

  const validSkillIds = new Set(availableSkillIds);
  const unknownSkills = defaults.postExecutionSkills.filter((skillId) => !validSkillIds.has(skillId));

  if (unknownSkills.length > 0) {
    return {
      ok: false,
      error: `Unknown post-execution skills: ${unknownSkills.join(', ')}`,
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
