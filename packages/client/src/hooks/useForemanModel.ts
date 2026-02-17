import { useState, useEffect, useCallback } from 'react'
import type { ModelConfig } from '@task-factory/shared'
import { api } from '../api'

interface UseForemanModelResult {
  modelConfig: ModelConfig | null
  setModelConfig: (config: ModelConfig | null) => Promise<void>
  isLoading: boolean
  error: string | null
}

export function useForemanModel(workspaceId: string | null): UseForemanModelResult {
  const [modelConfig, setModelConfigState] = useState<ModelConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load foreman model on workspace change
  useEffect(() => {
    if (!workspaceId) {
      setModelConfigState(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    api.getForemanModel(workspaceId)
      .then((data) => {
        setModelConfigState(data.modelConfig)
      })
      .catch((err) => {
        console.error('Failed to load foreman model:', err)
        setError(err.message || 'Failed to load foreman model')
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [workspaceId])

  const setModelConfig = useCallback(async (config: ModelConfig | null) => {
    if (!workspaceId) return

    setError(null)
    
    try {
      const result = await api.saveForemanModel(workspaceId, config)
      setModelConfigState(result.modelConfig)
    } catch (err) {
      console.error('Failed to save foreman model:', err)
      setError(err instanceof Error ? err.message : 'Failed to save foreman model')
      throw err
    }
  }, [workspaceId])

  return {
    modelConfig,
    setModelConfig,
    isLoading,
    error,
  }
}
