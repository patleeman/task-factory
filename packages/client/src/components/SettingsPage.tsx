import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  DEFAULT_PLANNING_GUARDRAILS,
  DEFAULT_WORKFLOW_SETTINGS,
  DEFAULT_PLANNING_PROMPT_TEMPLATE,
  DEFAULT_EXECUTION_PROMPT_TEMPLATE,
  type ModelConfig,
  type ModelProfile,
  type TaskDefaults,
  type PlanningGuardrails,
  type WorkflowDefaultsConfig,
  type WorkspaceWorkflowSettings,
} from '@task-factory/shared'
import {
  api,
  type AvailableModel,
  type PiAuthOverview,
  type PiOAuthLoginSession,
  type PiProviderAuthState,
  type PiFactorySettings,
} from '../api'
import { AppIcon } from './AppIcon'
import { ExecutionPipelineEditor } from './ExecutionPipelineEditor'
import { ModelSelector } from './ModelSelector'
import { SkillManagementPanel } from './SkillManagementPanel'
import { useTheme, type ThemePreference } from '../hooks/useTheme'
import {
  DEFAULT_VOICE_INPUT_HOTKEY,
  formatVoiceInputHotkeyFromEvent,
  normalizeVoiceInputHotkey,
} from '../voiceHotkey'
import type { PostExecutionSkill } from '../types/pi'

function findModel(models: AvailableModel[], modelConfig?: ModelConfig): AvailableModel | undefined {
  if (!modelConfig) return undefined
  return models.find((model) => model.provider === modelConfig.provider && model.id === modelConfig.modelId)
}

function normalizeModelConfigForUi(
  models: AvailableModel[],
  modelConfig?: ModelConfig,
): ModelConfig | undefined {
  const selectedModel = findModel(models, modelConfig)
  if (!selectedModel) {
    return undefined
  }

  return {
    provider: selectedModel.provider,
    modelId: selectedModel.id,
    thinkingLevel: selectedModel.reasoning
      ? modelConfig?.thinkingLevel || 'medium'
      : undefined,
  }
}

function normalizeTaskDefaultsForUi(
  defaults: TaskDefaults,
  models: AvailableModel[],
  skills: PostExecutionSkill[],
): TaskDefaults {
  const knownSkillIds = new Set(skills.map((skill) => skill.id))
  const executionModelConfig = normalizeModelConfigForUi(
    models,
    defaults.executionModelConfig ?? defaults.modelConfig,
  )

  return {
    planningModelConfig: normalizeModelConfigForUi(models, defaults.planningModelConfig),
    executionModelConfig,
    // Keep legacy alias aligned for backward compatibility.
    modelConfig: executionModelConfig,
    prePlanningSkills: defaults.prePlanningSkills.filter((skillId) => knownSkillIds.has(skillId)),
    preExecutionSkills: defaults.preExecutionSkills.filter((skillId) => knownSkillIds.has(skillId)),
    postExecutionSkills: defaults.postExecutionSkills.filter((skillId) => knownSkillIds.has(skillId)),
    planningPromptTemplate: defaults.planningPromptTemplate,
    executionPromptTemplate: defaults.executionPromptTemplate,
  }
}

function normalizePlanningGuardrailsForUi(settings: PiFactorySettings | null | undefined): PlanningGuardrails {
  const candidate = settings?.planningGuardrails

  const coerce = (value: unknown, fallback: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return fallback
    }

    const rounded = Math.floor(value)
    return rounded > 0 ? rounded : fallback
  }

  return {
    timeoutMs: coerce(candidate?.timeoutMs, DEFAULT_PLANNING_GUARDRAILS.timeoutMs),
    maxToolCalls: coerce(candidate?.maxToolCalls, DEFAULT_PLANNING_GUARDRAILS.maxToolCalls),
  }
}

function normalizeWorkflowDefaultsForUi(settings: PiFactorySettings | null | undefined): WorkspaceWorkflowSettings {
  const candidate = settings?.workflowDefaults

  const coerceLimit = (value: unknown, fallback: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return fallback
    }

    const rounded = Math.floor(value)
    if (rounded < 1) return fallback
    if (rounded > 100) return 100
    return rounded
  }

  return {
    readyLimit: coerceLimit(candidate?.readyLimit, DEFAULT_WORKFLOW_SETTINGS.readyLimit),
    executingLimit: coerceLimit(candidate?.executingLimit, DEFAULT_WORKFLOW_SETTINGS.executingLimit),
    backlogToReady: typeof candidate?.backlogToReady === 'boolean'
      ? candidate.backlogToReady
      : DEFAULT_WORKFLOW_SETTINGS.backlogToReady,
    readyToExecuting: typeof candidate?.readyToExecuting === 'boolean'
      ? candidate.readyToExecuting
      : DEFAULT_WORKFLOW_SETTINGS.readyToExecuting,
  }
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

function createModelProfileId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function getFirstAvailableModelConfig(models: AvailableModel[]): ModelConfig | undefined {
  if (models.length === 0) {
    return undefined
  }

  const first = models[0]
  return {
    provider: first.provider,
    modelId: first.id,
    thinkingLevel: first.reasoning ? 'medium' : undefined,
  }
}

function normalizeModelProfilesForUi(
  settings: PiFactorySettings | null | undefined,
  models: AvailableModel[],
): ModelProfile[] {
  const rawProfiles = settings?.modelProfiles
  if (!Array.isArray(rawProfiles)) {
    return []
  }

  const normalizedProfiles: ModelProfile[] = []

  for (const profile of rawProfiles) {
    if (!profile || typeof profile !== 'object') {
      continue
    }

    const id = typeof profile.id === 'string' ? profile.id.trim() : ''
    const name = typeof profile.name === 'string' ? profile.name.trim() : ''
    const planningModelConfig = normalizeModelConfigForUi(models, profile.planningModelConfig)
    const executionModelConfig = normalizeModelConfigForUi(
      models,
      profile.executionModelConfig ?? profile.modelConfig,
    )

    if (!id || !name || !planningModelConfig || !executionModelConfig) {
      continue
    }

    normalizedProfiles.push({
      id,
      name,
      planningModelConfig,
      executionModelConfig,
      modelConfig: executionModelConfig,
    })
  }

  return normalizedProfiles
}

function authStateLabel(authState: PiProviderAuthState): string {
  switch (authState) {
    case 'api_key':
      return 'API key'
    case 'oauth':
      return 'OAuth'
    case 'external':
      return 'Env/config'
    default:
      return 'Not configured'
  }
}

function authStateClass(authState: PiProviderAuthState): string {
  switch (authState) {
    case 'api_key':
      return 'bg-blue-100 text-blue-700'
    case 'oauth':
      return 'bg-green-100 text-green-700'
    case 'external':
      return 'bg-purple-100 text-purple-700'
    default:
      return 'bg-slate-100 text-slate-600'
  }
}

function isTerminalLoginStatus(status: PiOAuthLoginSession['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

function validateVoiceInputHotkeyForUi(hotkey: string): string | null {
  if (hotkey === 'Escape') {
    return 'Escape is reserved for navigation. Choose a different voice hotkey.'
  }

  if (hotkey === 'Ctrl+K' || hotkey === 'Meta+K') {
    return 'Cmd/Ctrl+K is reserved for focusing chat. Choose a different voice hotkey.'
  }

  return null
}

export function SettingsPage() {
  const navigate = useNavigate()
  const { preference, setPreference } = useTheme()

  const [activeTab, setActiveTab] = useState<'appearance' | 'auth' | 'task-defaults' | 'skills'>('appearance')

  const [models, setModels] = useState<AvailableModel[]>([])
  const [skills, setSkills] = useState<PostExecutionSkill[]>([])
  const [form, setForm] = useState<TaskDefaults | null>(null)
  const [planningGuardrailsForm, setPlanningGuardrailsForm] = useState<PlanningGuardrails>({
    ...DEFAULT_PLANNING_GUARDRAILS,
  })
  const [workflowDefaultsForm, setWorkflowDefaultsForm] = useState<WorkspaceWorkflowSettings>({
    ...DEFAULT_WORKFLOW_SETTINGS,
  })
  const [modelProfilesForm, setModelProfilesForm] = useState<ModelProfile[]>([])
  const [voiceInputHotkey, setVoiceInputHotkey] = useState(DEFAULT_VOICE_INPUT_HOTKEY)

  const [isSavingSystemSettings, setIsSavingSystemSettings] = useState(false)
  const [systemSettingsError, setSystemSettingsError] = useState<string | null>(null)
  const [systemSettingsMessage, setSystemSettingsMessage] = useState<string | null>(null)

  const [authOverview, setAuthOverview] = useState<PiAuthOverview | null>(null)
  const [selectedAuthProviderId, setSelectedAuthProviderId] = useState('')
  const [apiKeyInput, setApiKeyInput] = useState('')

  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [isSavingDefaults, setIsSavingDefaults] = useState(false)
  const [defaultsError, setDefaultsError] = useState<string | null>(null)
  const [defaultsSaveMessage, setDefaultsSaveMessage] = useState<string | null>(null)

  const [isAuthSaving, setIsAuthSaving] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authMessage, setAuthMessage] = useState<string | null>(null)

  const [loginSession, setLoginSession] = useState<PiOAuthLoginSession | null>(null)
  const [loginInput, setLoginInput] = useState('')
  const [isLoginInputSubmitting, setIsLoginInputSubmitting] = useState(false)

  const refreshAuthOverview = useCallback(async () => {
    const latest = await api.getPiAuthOverview()
    setAuthOverview(latest)
    return latest
  }, [])

  useEffect(() => {
    let isCancelled = false

    Promise.all([
      api.getTaskDefaults(),
      api.getAvailableModels(),
      fetch('/api/factory/skills').then(r => r.json() as Promise<PostExecutionSkill[]>),
      api.getPiAuthOverview(),
      api.getPiFactorySettings(),
    ])
      .then(([defaults, availableModels, availableSkills, auth, settings]) => {
        if (isCancelled) return
        setModels(availableModels)
        setSkills(availableSkills)
        setForm(normalizeTaskDefaultsForUi(defaults, availableModels, availableSkills))
        setPlanningGuardrailsForm(normalizePlanningGuardrailsForUi(settings))
        setWorkflowDefaultsForm(normalizeWorkflowDefaultsForUi(settings))
        setModelProfilesForm(normalizeModelProfilesForUi(settings, availableModels))
        setVoiceInputHotkey(normalizeVoiceInputHotkey(settings.voiceInputHotkey))
        setAuthOverview(auth)
      })
      .catch((err) => {
        if (isCancelled) return
        console.error('Failed to load settings:', err)
        setLoadError('Failed to load settings')
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false)
      })

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (!authOverview) return

    const providerIds = authOverview.providers.map((provider) => provider.id)
    if (providerIds.length === 0) {
      setSelectedAuthProviderId('')
      return
    }

    if (!providerIds.includes(selectedAuthProviderId)) {
      setSelectedAuthProviderId(providerIds[0])
    }
  }, [authOverview, selectedAuthProviderId])

  const selectedAuthProvider = useMemo(
    () => authOverview?.providers.find((provider) => provider.id === selectedAuthProviderId) || null,
    [authOverview, selectedAuthProviderId],
  )

  const handleSkillsChange = useCallback((nextSkills: PostExecutionSkill[]) => {
    setSkills(nextSkills)
    setForm((current) => {
      if (!current) return current

      const knownSkillIds = new Set(nextSkills.map((skill) => skill.id))
      return {
        ...current,
        prePlanningSkills: current.prePlanningSkills.filter((skillId) => knownSkillIds.has(skillId)),
        preExecutionSkills: current.preExecutionSkills.filter((skillId) => knownSkillIds.has(skillId)),
        postExecutionSkills: current.postExecutionSkills.filter((skillId) => knownSkillIds.has(skillId)),
      }
    })
  }, [])

  const handleSaveVoiceInputHotkey = async () => {
    setIsSavingSystemSettings(true)
    setSystemSettingsError(null)
    setSystemSettingsMessage(null)

    try {
      const currentSettings = await api.getPiFactorySettings()
      const nextHotkey = normalizeVoiceInputHotkey(voiceInputHotkey)
      const validationError = validateVoiceInputHotkeyForUi(nextHotkey)

      if (validationError) {
        setSystemSettingsError(validationError)
        return
      }

      const nextSettings: PiFactorySettings = {
        ...currentSettings,
        voiceInputHotkey: nextHotkey,
      }

      await api.savePiFactorySettings(nextSettings)
      setVoiceInputHotkey(nextHotkey)
      setSystemSettingsMessage('Voice input hotkey saved')
    } catch (err) {
      console.error('Failed to save voice input hotkey:', err)
      setSystemSettingsError(err instanceof Error ? err.message : 'Failed to save voice input hotkey')
    } finally {
      setIsSavingSystemSettings(false)
    }
  }

  const handleSaveDefaults = async () => {
    if (!form) return

    setIsSavingDefaults(true)
    setDefaultsError(null)
    setDefaultsSaveMessage(null)

    try {
      const executionModelConfig = form.executionModelConfig ?? form.modelConfig
      const payload: TaskDefaults = {
        planningModelConfig: form.planningModelConfig
          ? { ...form.planningModelConfig }
          : undefined,
        executionModelConfig: executionModelConfig
          ? { ...executionModelConfig }
          : undefined,
        // Keep legacy alias aligned for backward compatibility.
        modelConfig: executionModelConfig
          ? { ...executionModelConfig }
          : undefined,
        prePlanningSkills: [...form.prePlanningSkills],
        preExecutionSkills: [...form.preExecutionSkills],
        postExecutionSkills: [...form.postExecutionSkills],
        planningPromptTemplate: form.planningPromptTemplate?.trim() || undefined,
        executionPromptTemplate: form.executionPromptTemplate?.trim() || undefined,
      }

      const savedDefaults = await api.saveTaskDefaults(payload)

      const normalizedProfiles: ModelProfile[] = modelProfilesForm.map((profile, index) => {
        const name = profile.name.trim()
        if (!name) {
          throw new Error(`Model profile ${index + 1} name is required`)
        }

        const planningModelConfig = cloneModelConfig(profile.planningModelConfig)
        const executionModelConfig = cloneModelConfig(profile.executionModelConfig ?? profile.modelConfig)

        const hasPlanningModel = Boolean(planningModelConfig?.provider?.trim() && planningModelConfig?.modelId?.trim())
        const hasExecutionModel = Boolean(executionModelConfig?.provider?.trim() && executionModelConfig?.modelId?.trim())

        if (!hasPlanningModel || !hasExecutionModel) {
          throw new Error(`Model profile ${name} must include planning and execution models`)
        }

        const finalPlanningModelConfig = planningModelConfig as ModelConfig
        const finalExecutionModelConfig = executionModelConfig as ModelConfig

        return {
          id: profile.id,
          name,
          planningModelConfig: finalPlanningModelConfig,
          executionModelConfig: finalExecutionModelConfig,
          // Keep legacy alias aligned for backward compatibility.
          modelConfig: finalExecutionModelConfig,
        }
      })

      const currentSettings = await api.getPiFactorySettings()
      const workflowDefaults: WorkflowDefaultsConfig = {
        readyLimit: workflowDefaultsForm.readyLimit,
        executingLimit: workflowDefaultsForm.executingLimit,
        backlogToReady: workflowDefaultsForm.backlogToReady,
        readyToExecuting: workflowDefaultsForm.readyToExecuting,
      }

      const nextSettings: PiFactorySettings = {
        ...currentSettings,
        planningGuardrails: {
          timeoutMs: planningGuardrailsForm.timeoutMs,
          maxToolCalls: planningGuardrailsForm.maxToolCalls,
        },
        workflowDefaults,
        modelProfiles: normalizedProfiles,
      }

      await api.savePiFactorySettings(nextSettings)
      setPlanningGuardrailsForm(normalizePlanningGuardrailsForUi(nextSettings))
      setWorkflowDefaultsForm(normalizeWorkflowDefaultsForUi(nextSettings))
      setModelProfilesForm(normalizeModelProfilesForUi(nextSettings, models))
      setForm(normalizeTaskDefaultsForUi(savedDefaults, models, skills))
      setDefaultsSaveMessage('Task defaults, model profiles, planning guardrails, and workflow defaults saved')
    } catch (err) {
      console.error('Failed to save settings:', err)
      setDefaultsError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSavingDefaults(false)
    }
  }

  const handleSaveApiKey = async () => {
    if (!selectedAuthProviderId) return

    setIsAuthSaving(true)
    setAuthError(null)
    setAuthMessage(null)

    try {
      await api.saveProviderApiKey(selectedAuthProviderId, apiKeyInput)
      await refreshAuthOverview()
      setApiKeyInput('')
      setAuthMessage(`Saved API key for ${selectedAuthProviderId}`)
    } catch (err) {
      console.error('Failed to save API key:', err)
      setAuthError(err instanceof Error ? err.message : 'Failed to save API key')
    } finally {
      setIsAuthSaving(false)
    }
  }

  const handleClearCredential = async (providerId: string) => {
    if (!providerId) return

    if (!confirm(`Remove stored credential for ${providerId}?`)) {
      return
    }

    setIsAuthSaving(true)
    setAuthError(null)
    setAuthMessage(null)

    try {
      await api.clearProviderCredential(providerId)
      await refreshAuthOverview()
      setAuthMessage(`Removed stored credential for ${providerId}`)
    } catch (err) {
      console.error('Failed to clear credential:', err)
      setAuthError(err instanceof Error ? err.message : 'Failed to clear credential')
    } finally {
      setIsAuthSaving(false)
    }
  }

  const handleStartLogin = async (providerId: string) => {
    setAuthError(null)
    setAuthMessage(null)

    try {
      const session = await api.startOAuthLogin(providerId)
      setLoginSession(session)
      setLoginInput('')
    } catch (err) {
      console.error('Failed to start OAuth login:', err)
      setAuthError(err instanceof Error ? err.message : 'Failed to start OAuth login')
    }
  }

  useEffect(() => {
    if (!loginSession || isTerminalLoginStatus(loginSession.status)) {
      return
    }

    const sessionId = loginSession.id
    const timer = setInterval(() => {
      api.getOAuthLoginSession(sessionId)
        .then(setLoginSession)
        .catch((err) => {
          console.error('Failed to refresh login session:', err)
          const message = err instanceof Error ? err.message : 'Failed to refresh login session'
          setAuthError(message)
          setLoginSession((current) => {
            if (!current || current.id !== sessionId) return current
            return {
              ...current,
              status: 'failed',
              error: message,
            }
          })
        })
    }, 1000)

    return () => clearInterval(timer)
  }, [loginSession?.id, loginSession?.status])

  useEffect(() => {
    if (!loginSession || loginSession.status !== 'succeeded') {
      return
    }

    refreshAuthOverview().catch((err) => {
      console.error('Failed to refresh auth status after login:', err)
    })
    setAuthMessage(`Logged in to ${loginSession.providerName}`)
  }, [loginSession?.id, loginSession?.status, refreshAuthOverview])

  const handleSubmitLoginInput = async () => {
    if (!loginSession?.inputRequest) return

    setIsLoginInputSubmitting(true)

    try {
      const next = await api.submitOAuthLoginInput(
        loginSession.id,
        loginSession.inputRequest.id,
        loginInput,
      )
      setLoginSession(next)
      setLoginInput('')
    } catch (err) {
      console.error('Failed to submit login input:', err)
      setAuthError(err instanceof Error ? err.message : 'Failed to submit login input')
    } finally {
      setIsLoginInputSubmitting(false)
    }
  }

  const handleCancelLogin = async () => {
    if (!loginSession) return

    try {
      const next = await api.cancelOAuthLogin(loginSession.id)
      setLoginSession(next)
    } catch (err) {
      console.error('Failed to cancel login flow:', err)
      setAuthError(err instanceof Error ? err.message : 'Failed to cancel login flow')
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
            <h1 className="text-lg font-bold tracking-tight">TASK FACTORY</h1>
          </button>
          <div className="h-6 w-px bg-slate-700" />
          <span className="text-sm font-medium text-slate-300">Settings</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-sm text-slate-400 hover:text-white transition-colors inline-flex items-center gap-1"
          >
            <AppIcon icon={ArrowLeft} size="xs" />
            Back
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-5">
          <div>
            <h2 className="text-xl font-semibold text-slate-800">Pi Settings</h2>
            <p className="text-sm text-slate-500">Manage appearance, authentication, task defaults, and execution skills.</p>
          </div>

          {loadError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {loadError}
            </div>
          )}

          <div className="flex border-b border-slate-200">
            <button
              onClick={() => setActiveTab('appearance')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'appearance'
                  ? 'border-safety-orange text-safety-orange'
                  : 'border-transparent text-slate-600 hover:text-slate-800'
              }`}
            >
              Appearance
            </button>
            <button
              onClick={() => setActiveTab('auth')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'auth'
                  ? 'border-safety-orange text-safety-orange'
                  : 'border-transparent text-slate-600 hover:text-slate-800'
              }`}
            >
              Authentication
            </button>
            <button
              onClick={() => setActiveTab('task-defaults')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'task-defaults'
                  ? 'border-safety-orange text-safety-orange'
                  : 'border-transparent text-slate-600 hover:text-slate-800'
              }`}
            >
              Task Defaults
            </button>
            <button
              onClick={() => setActiveTab('skills')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'skills'
                  ? 'border-safety-orange text-safety-orange'
                  : 'border-transparent text-slate-600 hover:text-slate-800'
              }`}
            >
              Skills
            </button>
          </div>

          {activeTab === 'appearance' && (
            <div className="space-y-5">
              <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Appearance</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Choose how Task Factory should render. Preference is saved in Task Factory settings and restored on reload.
                  </p>
                </div>

                <div className="max-w-xs">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Theme</label>
                  <select
                    value={preference}
                    onChange={(event) => setPreference(event.target.value as ThemePreference)}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                    <option value="system">System</option>
                  </select>
                </div>

                <div className="max-w-sm">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Voice input hotkey</label>
                  <input
                    type="text"
                    value={voiceInputHotkey}
                    readOnly
                    onKeyDown={(event) => {
                      if (event.key === 'Tab') return
                      event.preventDefault()

                      const nextHotkey = formatVoiceInputHotkeyFromEvent(event)
                      if (!nextHotkey) return

                      const validationError = validateVoiceInputHotkeyForUi(nextHotkey)
                      if (validationError) {
                        setSystemSettingsError(validationError)
                        setSystemSettingsMessage(null)
                        return
                      }

                      setVoiceInputHotkey(nextHotkey)
                      setSystemSettingsError(null)
                      setSystemSettingsMessage(null)
                    }}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent font-mono"
                    aria-label="Voice input hotkey"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Focus this field and press the key combo you want. Hold this hotkey to record voice input; release to stop.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={handleSaveVoiceInputHotkey}
                      disabled={isSavingSystemSettings}
                      className="btn btn-primary text-xs py-1.5 px-3 disabled:opacity-50"
                    >
                      {isSavingSystemSettings ? 'Saving...' : 'Save Voice Hotkey'}
                    </button>
                    <button
                      onClick={() => {
                        setVoiceInputHotkey(DEFAULT_VOICE_INPUT_HOTKEY)
                        setSystemSettingsError(null)
                        setSystemSettingsMessage(null)
                      }}
                      className="btn btn-secondary text-xs py-1.5 px-3"
                    >
                      Reset to Default
                    </button>
                  </div>
                </div>

                {systemSettingsError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {systemSettingsError}
                  </div>
                )}

                {systemSettingsMessage && !systemSettingsError && (
                  <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                    {systemSettingsMessage}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'auth' && (
            <div className="space-y-5">
              {authError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {authError}
                </div>
              )}

              {authMessage && !authError && (
                <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                  {authMessage}
                </div>
              )}

              <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-800">OAuth Login</h3>
                <p className="text-xs text-slate-500">
                  Use your subscription credentials (equivalent to <span className="font-mono">/login</span> in Pi).
                </p>

                <div className="space-y-2">
                  {(authOverview?.oauthProviders || []).map((provider) => (
                    <div key={provider.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                      <div>
                        <div className="text-sm font-medium text-slate-800">{provider.name}</div>
                        <div className="text-xs text-slate-500 font-mono">{provider.id}</div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-1 rounded-full ${provider.loggedIn ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                          {provider.loggedIn ? 'Logged in' : 'Not logged in'}
                        </span>
                        <button
                          onClick={() => handleStartLogin(provider.id)}
                          className="btn btn-secondary text-xs py-1 px-2"
                        >
                          {provider.loggedIn ? 'Re-login' : 'Login'}
                        </button>
                        {provider.loggedIn && (
                          <button
                            onClick={() => handleClearCredential(provider.id)}
                            className="text-xs text-red-600 hover:text-red-700"
                          >
                            Logout
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-800">API Keys</h3>
                <p className="text-xs text-slate-500">
                  Save provider keys into <span className="font-mono">~/.taskfactory/agent/auth.json</span>.
                </p>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Provider</label>
                  <select
                    value={selectedAuthProviderId}
                    onChange={(event) => setSelectedAuthProviderId(event.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  >
                    {(authOverview?.providers || []).map((provider) => (
                      <option key={provider.id} value={provider.id}>{provider.id}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">API Key Value</label>
                  <input
                    type="password"
                    value={apiKeyInput}
                    onChange={(event) => setApiKeyInput(event.target.value)}
                    placeholder="sk-... or ENV_VAR_NAME or !command"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSaveApiKey}
                    disabled={isAuthSaving || !selectedAuthProviderId || apiKeyInput.trim().length === 0}
                    className="btn btn-primary text-sm py-1.5 px-4 disabled:opacity-50"
                  >
                    {isAuthSaving ? 'Saving...' : 'Save API Key'}
                  </button>

                  {selectedAuthProvider && selectedAuthProvider.hasStoredCredential && (
                    <button
                      onClick={() => handleClearCredential(selectedAuthProvider.id)}
                      disabled={isAuthSaving}
                      className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
                    >
                      Remove Stored Credential
                    </button>
                  )}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                <h3 className="text-sm font-semibold text-slate-800">Provider Status</h3>
                <div className="space-y-1.5">
                  {(authOverview?.providers || []).map((provider) => (
                    <div key={provider.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-700">{provider.id}</span>
                        {provider.supportsOAuth && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">OAuth</span>
                        )}
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${authStateClass(provider.authState)}`}>
                        {authStateLabel(provider.authState)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {activeTab === 'task-defaults' && form && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Task Defaults</h3>
                <p className="text-xs text-slate-500">Applied automatically when creating tasks without explicit model/skill config.</p>
              </div>

              {defaultsError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {defaultsError}
                </div>
              )}

              {defaultsSaveMessage && !defaultsError && (
                <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                  {defaultsSaveMessage}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Default Planning Model
                  </label>
                  <ModelSelector
                    value={form.planningModelConfig}
                    onChange={(config) => {
                      setForm({
                        ...form,
                        planningModelConfig: config,
                      })
                    }}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Default Execution Model
                  </label>
                  <ModelSelector
                    value={form.executionModelConfig ?? form.modelConfig}
                    onChange={(config) => {
                      setForm({
                        ...form,
                        executionModelConfig: config,
                        // Keep legacy alias aligned for backward compatibility.
                        modelConfig: config,
                      })
                    }}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-800">Model Profiles</h4>
                    <p className="text-xs text-slate-500 mt-0.5">Save reusable planning + execution model combinations for quick task creation.</p>
                  </div>
                  <button
                    type="button"
                    disabled={models.length === 0}
                    onClick={() => {
                      const nextIndex = modelProfilesForm.length + 1
                      const fallbackModel = getFirstAvailableModelConfig(models)
                      const defaultPlanningModel = cloneModelConfig(form.planningModelConfig) ?? cloneModelConfig(fallbackModel)
                      const defaultExecutionModel = cloneModelConfig(form.executionModelConfig ?? form.modelConfig) ?? cloneModelConfig(fallbackModel)
                      if (!defaultPlanningModel || !defaultExecutionModel) {
                        return
                      }

                      setModelProfilesForm((current) => [
                        ...current,
                        {
                          id: createModelProfileId(),
                          name: `Profile ${nextIndex}`,
                          planningModelConfig: defaultPlanningModel,
                          executionModelConfig: defaultExecutionModel,
                          modelConfig: defaultExecutionModel,
                        },
                      ])
                    }}
                    className="btn btn-secondary text-xs py-1 px-2 disabled:opacity-50"
                  >
                    Add Profile
                  </button>
                </div>

                {modelProfilesForm.length === 0 ? (
                  <p className="text-xs text-slate-500">No model profiles yet.</p>
                ) : (
                  <div className="space-y-3">
                    {modelProfilesForm.map((profile, index) => (
                      <div key={profile.id} className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={profile.name}
                            onChange={(event) => {
                              const name = event.target.value
                              setModelProfilesForm((current) => current.map((candidate) => (
                                candidate.id === profile.id
                                  ? { ...candidate, name }
                                  : candidate
                              )))
                            }}
                            placeholder={`Profile ${index + 1}`}
                            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setModelProfilesForm((current) => current.filter((candidate) => candidate.id !== profile.id))
                            }}
                            className="text-xs text-red-600 hover:text-red-700"
                          >
                            Remove
                          </button>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                              Planning Model
                            </label>
                            <ModelSelector
                              value={profile.planningModelConfig}
                              onChange={(config) => {
                                if (!config) {
                                  return
                                }

                                setModelProfilesForm((current) => current.map((candidate) => (
                                  candidate.id === profile.id
                                    ? { ...candidate, planningModelConfig: config }
                                    : candidate
                                )))
                              }}
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                              Execution Model
                            </label>
                            <ModelSelector
                              value={profile.executionModelConfig ?? profile.modelConfig}
                              onChange={(config) => {
                                if (!config) {
                                  return
                                }

                                setModelProfilesForm((current) => current.map((candidate) => (
                                  candidate.id === profile.id
                                    ? {
                                        ...candidate,
                                        executionModelConfig: config,
                                        modelConfig: config,
                                      }
                                    : candidate
                                )))
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-800">Workflow Defaults</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Default slot limits and automation for workspaces that do not set overrides.</p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-xs font-medium text-slate-600">
                    Ready WIP slots
                    <input
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={workflowDefaultsForm.readyLimit}
                      onChange={(event) => {
                        const value = Number.parseInt(event.target.value, 10)
                        setWorkflowDefaultsForm((current) => ({
                          ...current,
                          readyLimit: Number.isFinite(value)
                            ? Math.max(1, Math.min(100, value))
                            : current.readyLimit,
                        }))
                      }}
                      className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-2.5 py-2 bg-white"
                    />
                  </label>

                  <label className="block text-xs font-medium text-slate-600">
                    Executing slots
                    <input
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={workflowDefaultsForm.executingLimit}
                      onChange={(event) => {
                        const value = Number.parseInt(event.target.value, 10)
                        setWorkflowDefaultsForm((current) => ({
                          ...current,
                          executingLimit: Number.isFinite(value)
                            ? Math.max(1, Math.min(100, value))
                            : current.executingLimit,
                        }))
                      }}
                      className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-2.5 py-2 bg-white"
                    />
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={workflowDefaultsForm.backlogToReady}
                      onChange={(event) => {
                        const checked = event.target.checked
                        setWorkflowDefaultsForm((current) => ({
                          ...current,
                          backlogToReady: checked,
                        }))
                      }}
                    />
                    Default Backlog→Ready auto-promote
                  </label>

                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={workflowDefaultsForm.readyToExecuting}
                      onChange={(event) => {
                        const checked = event.target.checked
                        setWorkflowDefaultsForm((current) => ({
                          ...current,
                          readyToExecuting: checked,
                        }))
                      }}
                    />
                    Default Ready→Executing auto-run
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-800">Planning Guardrails</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Limit planning runs to avoid long repository scans and timeout loops.</p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-xs font-medium text-slate-600">
                    Timeout (seconds)
                    <input
                      type="number"
                      min={10}
                      step={5}
                      value={Math.round(planningGuardrailsForm.timeoutMs / 1000)}
                      onChange={(event) => {
                        const seconds = Number.parseInt(event.target.value, 10)
                        setPlanningGuardrailsForm((current) => ({
                          ...current,
                          timeoutMs: Number.isFinite(seconds) && seconds > 0
                            ? seconds * 1000
                            : DEFAULT_PLANNING_GUARDRAILS.timeoutMs,
                        }))
                      }}
                      className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-2.5 py-2 bg-white"
                    />
                  </label>

                  <label className="block text-xs font-medium text-slate-600">
                    Max tool calls
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={planningGuardrailsForm.maxToolCalls}
                      onChange={(event) => {
                        const value = Number.parseInt(event.target.value, 10)
                        setPlanningGuardrailsForm((current) => ({
                          ...current,
                          maxToolCalls: Number.isFinite(value) && value > 0
                            ? value
                            : DEFAULT_PLANNING_GUARDRAILS.maxToolCalls,
                        }))
                      }}
                      className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-2.5 py-2 bg-white"
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Planning + Execution Pipelines
                </label>
                <p className="text-xs text-slate-500 mb-2">Set default pre-planning, pre-execution, and post-execution order with one visual pipeline.</p>
                <ExecutionPipelineEditor
                  availableSkills={skills}
                  selectedPrePlanningSkillIds={form.prePlanningSkills}
                  selectedPreSkillIds={form.preExecutionSkills}
                  selectedSkillIds={form.postExecutionSkills}
                  onPrePlanningSkillsChange={(skillIds) => {
                    setForm({ ...form, prePlanningSkills: skillIds })
                  }}
                  onPreSkillsChange={(skillIds) => {
                    setForm({ ...form, preExecutionSkills: skillIds })
                  }}
                  onPostSkillsChange={(skillIds) => {
                    setForm({ ...form, postExecutionSkills: skillIds })
                  }}
                  showSkillConfigControls={false}
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-800">Planning Prompt Template</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {'Custom prompt template for planning tasks. Available variables: {{taskId}}, {{title}}, {{stateBlock}}, {{contractReference}},'}
                    {' {{acceptanceCriteria}}, {{description}}, {{sharedContext}}, {{attachments}}, {{maxToolCalls}}'}
                  </p>
                </div>
                <textarea
                  value={form.planningPromptTemplate ?? DEFAULT_PLANNING_PROMPT_TEMPLATE}
                  onChange={(event) => {
                    const value = event.target.value
                    setForm({ ...form, planningPromptTemplate: value === DEFAULT_PLANNING_PROMPT_TEMPLATE ? undefined : value })
                  }}
                  rows={16}
                  className="w-full text-xs font-mono border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-y"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setForm({ ...form, planningPromptTemplate: undefined })}
                    className="text-xs text-slate-500 hover:text-slate-700 underline"
                    type="button"
                  >
                    Reset to default
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-800">Execution Prompt Template</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {'Custom prompt template for task execution. Available variables: {{taskId}}, {{title}}, {{stateBlock}}, {{contractReference}},'}
                    {' {{acceptanceCriteria}}, {{testingInstructions}}, {{description}}, {{sharedContext}},'}
                    {' {{attachments}}, {{skills}}'}
                  </p>
                </div>
                <textarea
                  value={form.executionPromptTemplate ?? DEFAULT_EXECUTION_PROMPT_TEMPLATE}
                  onChange={(event) => {
                    const value = event.target.value
                    setForm({ ...form, executionPromptTemplate: value === DEFAULT_EXECUTION_PROMPT_TEMPLATE ? undefined : value })
                  }}
                  rows={16}
                  className="w-full text-xs font-mono border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-y"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setForm({ ...form, executionPromptTemplate: undefined })}
                    className="text-xs text-slate-500 hover:text-slate-700 underline"
                    type="button"
                  >
                    Reset to default
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={handleSaveDefaults}
                  disabled={isSavingDefaults}
                  className="btn btn-primary text-sm py-1.5 px-4 disabled:opacity-50"
                >
                  {isSavingDefaults ? 'Saving...' : 'Save Defaults'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'skills' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-800">
                <span className="font-semibold">Skill Library</span> — create and edit reusable skills here.
                To configure which skills run by default on new tasks (pre-planning, pre-execution, post-execution),
                go to the <button
                  type="button"
                  onClick={() => setActiveTab('task-defaults')}
                  className="underline font-medium hover:text-blue-900"
                >Task Defaults</button> tab.
              </div>
              <SkillManagementPanel skills={skills} onSkillsChange={handleSkillsChange} />
            </div>
          )}
        </div>
      </div>

      {loginSession && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-xl rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-800">OAuth Login · {loginSession.providerName}</h3>
              <p className="text-xs text-slate-500 mt-0.5">Status: {loginSession.status}</p>
            </div>

            <div className="p-4 space-y-3">
              {loginSession.authUrl && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <div className="text-xs text-slate-600">Open this URL in your browser:</div>
                  <a
                    href={loginSession.authUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-mono text-blue-700 break-all hover:underline"
                  >
                    {loginSession.authUrl}
                  </a>
                  {loginSession.authInstructions && (
                    <div className="text-xs text-slate-600">{loginSession.authInstructions}</div>
                  )}
                </div>
              )}

              {loginSession.inputRequest && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-700">
                    {loginSession.inputRequest.message}
                  </label>
                  {loginSession.inputRequest.placeholder && (
                    <div className="text-[11px] text-slate-500">e.g. {loginSession.inputRequest.placeholder}</div>
                  )}
                  <div className="flex gap-2">
                    <input
                      value={loginInput}
                      onChange={(event) => setLoginInput(event.target.value)}
                      className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2"
                    />
                    <button
                      onClick={handleSubmitLoginInput}
                      disabled={
                        isLoginInputSubmitting
                        || (!loginSession.inputRequest.allowEmpty && loginInput.trim().length === 0)
                      }
                      className="btn btn-primary text-sm py-1.5 px-3 disabled:opacity-50"
                    >
                      {isLoginInputSubmitting ? 'Submitting...' : 'Submit'}
                    </button>
                  </div>
                </div>
              )}

              {loginSession.progressMessages.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-white p-3 max-h-40 overflow-y-auto">
                  <div className="text-xs font-medium text-slate-700 mb-1">Progress</div>
                  <ul className="space-y-1">
                    {loginSession.progressMessages.map((message, index) => (
                      <li key={`${message}-${index}`} className="text-xs text-slate-600">
                        {message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {loginSession.error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {loginSession.error}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              {!isTerminalLoginStatus(loginSession.status) ? (
                <button
                  onClick={handleCancelLogin}
                  className="btn btn-secondary text-sm py-1.5 px-3"
                >
                  Cancel Login
                </button>
              ) : (
                <button
                  onClick={() => {
                    setLoginSession(null)
                    setLoginInput('')
                  }}
                  className="btn btn-primary text-sm py-1.5 px-3"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
