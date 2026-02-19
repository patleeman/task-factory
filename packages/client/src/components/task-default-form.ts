import type { ModelConfig, TaskDefaults } from '@task-factory/shared'

export interface CreateTaskFormDefaults {
  selectedPrePlanningSkillIds: string[]
  selectedPreSkillIds: string[]
  selectedSkillIds: string[]
  selectedModelProfileId: string | undefined
  planningModelConfig: ModelConfig | undefined
  executionModelConfig: ModelConfig | undefined
}

function cloneModelConfig(modelConfig: ModelConfig | undefined): ModelConfig | undefined {
  if (!modelConfig) {
    return undefined
  }

  const cloned: ModelConfig = {
    provider: modelConfig.provider,
    modelId: modelConfig.modelId,
  }

  if (modelConfig.thinkingLevel !== undefined) {
    cloned.thinkingLevel = modelConfig.thinkingLevel
  }

  return cloned
}

export function buildCreateTaskFormDefaults(defaults: TaskDefaults): CreateTaskFormDefaults {
  const executionModelConfig = defaults.executionModelConfig ?? defaults.modelConfig

  return {
    selectedPrePlanningSkillIds: [...defaults.prePlanningSkills],
    selectedPreSkillIds: [...defaults.preExecutionSkills],
    selectedSkillIds: [...defaults.postExecutionSkills],
    selectedModelProfileId: defaults.defaultModelProfileId,
    planningModelConfig: cloneModelConfig(defaults.planningModelConfig),
    executionModelConfig: cloneModelConfig(executionModelConfig),
  }
}
