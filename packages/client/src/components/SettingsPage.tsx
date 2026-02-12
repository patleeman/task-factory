import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ModelConfig, TaskDefaults } from '@pi-factory/shared'
import { api, type AvailableModel } from '../api'
import { SkillSelector } from './SkillSelector'
import type { PostExecutionSkill } from '../types/pi'

const THINKING_LEVELS: Array<{ value: NonNullable<ModelConfig['thinkingLevel']>; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
]

function findModel(models: AvailableModel[], modelConfig?: ModelConfig): AvailableModel | undefined {
  if (!modelConfig) return undefined
  return models.find((model) => model.provider === modelConfig.provider && model.id === modelConfig.modelId)
}

function normalizeTaskDefaultsForUi(
  defaults: TaskDefaults,
  models: AvailableModel[],
  skills: PostExecutionSkill[],
): TaskDefaults {
  const selectedModel = findModel(models, defaults.modelConfig)

  const modelConfig: ModelConfig | undefined = selectedModel
    ? {
      provider: selectedModel.provider,
      modelId: selectedModel.id,
      thinkingLevel: selectedModel.reasoning
        ? defaults.modelConfig?.thinkingLevel || 'medium'
        : undefined,
    }
    : undefined

  const availableSkillIds = new Set(skills.map((skill) => skill.id))

  return {
    modelConfig,
    postExecutionSkills: defaults.postExecutionSkills.filter((skillId) => availableSkillIds.has(skillId)),
  }
}

export function SettingsPage() {
  const navigate = useNavigate()
  const [models, setModels] = useState<AvailableModel[]>([])
  const [skills, setSkills] = useState<PostExecutionSkill[]>([])
  const [form, setForm] = useState<TaskDefaults | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  useEffect(() => {
    let isCancelled = false

    Promise.all([
      api.getTaskDefaults(),
      api.getAvailableModels(),
      fetch('/api/factory/skills').then(r => r.json() as Promise<PostExecutionSkill[]>),
    ])
      .then(([defaults, availableModels, availableSkills]) => {
        if (isCancelled) return
        setModels(availableModels)
        setSkills(availableSkills)
        setForm(normalizeTaskDefaultsForUi(defaults, availableModels, availableSkills))
      })
      .catch((err) => {
        if (isCancelled) return
        console.error('Failed to load settings:', err)
        setError('Failed to load settings')
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false)
      })

    return () => {
      isCancelled = true
    }
  }, [])

  const providers = useMemo(
    () => Array.from(new Set(models.map((model) => model.provider))).sort((a, b) => a.localeCompare(b)),
    [models],
  )

  const selectedProvider = form?.modelConfig?.provider || ''
  const providerModels = useMemo(
    () => models.filter((model) => model.provider === selectedProvider),
    [models, selectedProvider],
  )
  const selectedModel = form ? findModel(models, form.modelConfig) : undefined

  const handleProviderChange = (provider: string) => {
    if (!form) return

    if (!provider) {
      setForm({
        ...form,
        modelConfig: undefined,
      })
      return
    }

    const modelsForProvider = models.filter((model) => model.provider === provider)
    if (modelsForProvider.length === 0) {
      setForm({
        ...form,
        modelConfig: undefined,
      })
      return
    }

    const currentModel = modelsForProvider.find((model) => model.id === form.modelConfig?.modelId)
    const nextModel = currentModel || modelsForProvider[0]

    setForm({
      ...form,
      modelConfig: {
        provider,
        modelId: nextModel.id,
        thinkingLevel: nextModel.reasoning
          ? form.modelConfig?.thinkingLevel || 'medium'
          : undefined,
      },
    })
  }

  const handleModelChange = (modelId: string) => {
    if (!form || !selectedProvider || !modelId) return

    const model = models.find((candidate) => candidate.provider === selectedProvider && candidate.id === modelId)
    if (!model) return

    setForm({
      ...form,
      modelConfig: {
        provider: model.provider,
        modelId: model.id,
        thinkingLevel: model.reasoning
          ? form.modelConfig?.thinkingLevel || 'medium'
          : undefined,
      },
    })
  }

  const handleThinkingLevelChange = (thinkingLevel: ModelConfig['thinkingLevel']) => {
    if (!form?.modelConfig) return

    setForm({
      ...form,
      modelConfig: {
        ...form.modelConfig,
        thinkingLevel,
      },
    })
  }

  const handleSave = async () => {
    if (!form) return

    setIsSaving(true)
    setError(null)
    setSaveMessage(null)

    try {
      const payload: TaskDefaults = {
        modelConfig: form.modelConfig
          ? {
            ...form.modelConfig,
            thinkingLevel: selectedModel?.reasoning
              ? form.modelConfig.thinkingLevel || 'medium'
              : undefined,
          }
          : undefined,
        postExecutionSkills: [...form.postExecutionSkills],
      }

      const saved = await api.saveTaskDefaults(payload)
      setForm(normalizeTaskDefaultsForUi(saved, models, skills))
      setSaveMessage('Saved')
    } catch (err) {
      console.error('Failed to save task defaults:', err)
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-slate-300 border-t-safety-orange rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600 font-medium">Loading settings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      <header className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white shadow-lg shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <h1 className="text-lg font-bold tracking-tight">PI-FACTORY</h1>
          </button>
          <div className="h-6 w-px bg-slate-700" />
          <span className="text-sm font-medium text-slate-300">Settings</span>
        </div>
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-slate-400 hover:text-white transition-colors"
        >
          ← Back
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-5">
          <div>
            <h2 className="text-xl font-semibold text-slate-800">Task Defaults</h2>
            <p className="text-sm text-slate-500">Applied automatically when creating tasks without explicit model/skill config.</p>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {saveMessage && !error && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              {saveMessage}
            </div>
          )}

          {form && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Provider
                </label>
                <select
                  value={selectedProvider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                >
                  <option value="">Default (from Pi settings)</option>
                  {providers.map((provider) => (
                    <option key={provider} value={provider}>{provider}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Model
                </label>
                <select
                  value={form.modelConfig?.modelId || ''}
                  onChange={(e) => handleModelChange(e.target.value)}
                  disabled={!selectedProvider}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <option value="">{selectedProvider ? 'Select model' : 'Select provider first'}</option>
                  {providerModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name || model.id}
                      {model.reasoning ? ' (reasoning)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {selectedModel?.reasoning && form.modelConfig && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Thinking Level
                  </label>
                  <select
                    value={form.modelConfig.thinkingLevel || 'medium'}
                    onChange={(e) => handleThinkingLevelChange(e.target.value as ModelConfig['thinkingLevel'])}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  >
                    {THINKING_LEVELS.map((level) => (
                      <option key={level.value} value={level.value}>{level.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Post-Execution Skills
                </label>
                <p className="text-xs text-slate-500 mb-2">Drag selected skills to set execution order.</p>
                <SkillSelector
                  availableSkills={skills}
                  selectedSkillIds={form.postExecutionSkills}
                  onChange={(skillIds) => setForm({ ...form, postExecutionSkills: skillIds })}
                />
              </div>

              <div className="pt-2">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="btn btn-primary text-sm py-1.5 px-4 disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save Defaults'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
