import type { ModelConfig, TaskDefaults } from '@pi-factory/shared'

export interface CreateTaskFormDefaults {
  selectedPreSkillIds: string[]
  selectedSkillIds: string[]
  planningModelConfig: ModelConfig | undefined
  executionModelConfig: ModelConfig | undefined
}

function cloneModelConfig(modelConfig: ModelConfig | undefined): ModelConfig | undefined {
  if (!modelConfig) {
    return undefined
  }

  return {
    provider: modelConfig.provider,
    modelId: modelConfig.modelId,
    thinkingLevel: modelConfig.thinkingLevel,
  }
}

export function buildCreateTaskFormDefaults(defaults: TaskDefaults): CreateTaskFormDefaults {
  const executionModelConfig = defaults.executionModelConfig ?? defaults.modelConfig

  return {
    selectedPreSkillIds: [...defaults.preExecutionSkills],
    selectedSkillIds: [...defaults.postExecutionSkills],
    planningModelConfig: cloneModelConfig(defaults.planningModelConfig),
    executionModelConfig: cloneModelConfig(executionModelConfig),
  }
}
