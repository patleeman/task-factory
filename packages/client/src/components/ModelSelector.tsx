import { useState, useEffect } from 'react'
import type { ModelConfig } from '@pi-factory/shared'
import { api, type AvailableModel } from '../api'

interface ModelSelectorProps {
  value?: ModelConfig
  onChange: (config: ModelConfig | undefined) => void
  /** Render in compact mode for inline use in headers/toolbars */
  compact?: boolean
}

const THINKING_LEVELS = [
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Min' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHi' },
] as const

export function ModelSelector({ value, onChange, compact }: ModelSelectorProps) {
  const [models, setModels] = useState<AvailableModel[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    api.getAvailableModels()
      .then(setModels)
      .catch(err => console.error('Failed to load models:', err))
      .finally(() => setIsLoading(false))
  }, [])

  // Group models by provider
  const grouped = models.reduce<Record<string, AvailableModel[]>>((acc, model) => {
    if (!acc[model.provider]) acc[model.provider] = []
    acc[model.provider].push(model)
    return acc
  }, {})

  const selectedKey = value ? `${value.provider}/${value.modelId}` : ''
  const selectedModel = models.find(m => m.provider === value?.provider && m.id === value?.modelId)

  const handleModelChange = (key: string) => {
    if (!key) {
      onChange(undefined)
      return
    }
    const [provider, ...rest] = key.split('/')
    const modelId = rest.join('/')
    const model = models.find(m => m.provider === provider && m.id === modelId)
    onChange({
      provider,
      modelId,
      thinkingLevel: model?.reasoning ? (value?.thinkingLevel || 'medium') : undefined,
    })
  }

  const handleThinkingChange = (level: string) => {
    if (!value) return
    onChange({
      ...value,
      thinkingLevel: level as ModelConfig['thinkingLevel'],
    })
  }

  if (isLoading) {
    return (
      <div className="text-xs text-slate-400">Loading…</div>
    )
  }

  if (models.length === 0) {
    return (
      <div className="text-xs text-slate-400">No models</div>
    )
  }

  // Compact mode: single-line dropdown for headers/toolbars
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <select
          value={selectedKey}
          onChange={(e) => handleModelChange(e.target.value)}
          className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-transparent max-w-[200px]"
        >
          <option value="">Default model</option>
          {Object.entries(grouped).map(([provider, providerModels]) => (
            <optgroup key={provider} label={provider}>
              {providerModels.map(model => (
                <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
                  {model.name || model.id}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {value && selectedModel?.reasoning && (
          <select
            value={value.thinkingLevel || 'medium'}
            onChange={(e) => handleThinkingChange(e.target.value)}
            className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-transparent"
          >
            {THINKING_LEVELS.map(level => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <select
        value={selectedKey}
        onChange={(e) => handleModelChange(e.target.value)}
        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
      >
        <option value="">Default (from Pi settings)</option>
        {Object.entries(grouped).map(([provider, providerModels]) => (
          <optgroup key={provider} label={provider}>
            {providerModels.map(model => (
              <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
                {model.name || model.id}
                {model.reasoning ? ' (reasoning)' : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {/* Thinking level selector — show when a non-default model is selected */}
      {value && selectedModel?.reasoning && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 shrink-0">Thinking:</label>
          <select
            value={value.thinkingLevel || 'medium'}
            onChange={(e) => handleThinkingChange(e.target.value)}
            className="flex-1 text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
          >
            {THINKING_LEVELS.map(level => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
