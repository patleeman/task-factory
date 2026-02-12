import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ModelConfig, TaskDefaults } from '@pi-factory/shared'
import {
  api,
  type AvailableModel,
  type PiAuthOverview,
  type PiOAuthLoginSession,
  type PiProviderAuthState,
} from '../api'
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

export function SettingsPage() {
  const navigate = useNavigate()

  const [activeTab, setActiveTab] = useState<'auth' | 'task-defaults'>('auth')

  const [models, setModels] = useState<AvailableModel[]>([])
  const [skills, setSkills] = useState<PostExecutionSkill[]>([])
  const [form, setForm] = useState<TaskDefaults | null>(null)

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
    ])
      .then(([defaults, availableModels, availableSkills, auth]) => {
        if (isCancelled) return
        setModels(availableModels)
        setSkills(availableSkills)
        setForm(normalizeTaskDefaultsForUi(defaults, availableModels, availableSkills))
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

  const selectedAuthProvider = useMemo(
    () => authOverview?.providers.find((provider) => provider.id === selectedAuthProviderId) || null,
    [authOverview, selectedAuthProviderId],
  )

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

  const handleSaveDefaults = async () => {
    if (!form) return

    setIsSavingDefaults(true)
    setDefaultsError(null)
    setDefaultsSaveMessage(null)

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
      setDefaultsSaveMessage('Task defaults saved')
    } catch (err) {
      console.error('Failed to save task defaults:', err)
      setDefaultsError(err instanceof Error ? err.message : 'Failed to save task defaults')
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
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-5">
          <div>
            <h2 className="text-xl font-semibold text-slate-800">Pi Settings</h2>
            <p className="text-sm text-slate-500">Configure API keys, OAuth login, and task defaults in one place.</p>
          </div>

          {loadError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {loadError}
            </div>
          )}

          <div className="flex border-b border-slate-200">
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
          </div>

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
                  Save provider keys into <span className="font-mono">~/.pi/agent/auth.json</span>.
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
                  onClick={handleSaveDefaults}
                  disabled={isSavingDefaults}
                  className="btn btn-primary text-sm py-1.5 px-4 disabled:opacity-50"
                >
                  {isSavingDefaults ? 'Saving...' : 'Save Defaults'}
                </button>
              </div>
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
