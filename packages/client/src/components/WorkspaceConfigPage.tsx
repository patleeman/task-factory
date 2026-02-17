import { useState, useEffect } from 'react'
import { ArrowLeft, Check, CheckCircle2 } from 'lucide-react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  DEFAULT_PRE_EXECUTION_SKILLS,
  DEFAULT_POST_EXECUTION_SKILLS,
  DEFAULT_PLANNING_PROMPT_TEMPLATE,
  DEFAULT_EXECUTION_PROMPT_TEMPLATE,
  type TaskDefaults,
} from '@task-factory/shared'
import type { PiSkill, PiExtension, PostExecutionSkill } from '../types/pi'
import { api, type WorkflowAutomationResponse, type WorkflowAutomationUpdate } from '../api'
import { AppIcon } from './AppIcon'
import { ModelSelector } from './ModelSelector'
import { ExecutionPipelineEditor } from './ExecutionPipelineEditor'

interface WorkspaceConfig {
  skills: {
    enabled: string[]
    config: Record<string, any>
  }
  extensions: {
    enabled: string[]
    config: Record<string, any>
  }
}

const EMPTY_TASK_DEFAULTS: TaskDefaults = {
  planningModelConfig: undefined,
  executionModelConfig: undefined,
  modelConfig: undefined,
  preExecutionSkills: [...DEFAULT_PRE_EXECUTION_SKILLS],
  postExecutionSkills: [...DEFAULT_POST_EXECUTION_SKILLS],
}

type OverrideMode = 'inherit' | 'override'

interface WorkflowOverridesForm {
  readyLimitMode: OverrideMode
  readyLimit: number
  executingLimitMode: OverrideMode
  executingLimit: number
  backlogToReadyMode: OverrideMode
  backlogToReady: boolean
  readyToExecutingMode: OverrideMode
  readyToExecuting: boolean
  globalReadyLimit: number
  globalExecutingLimit: number
  globalBacklogToReady: boolean
  globalReadyToExecuting: boolean
}

function sanitizeSlotLimitInput(value: number): number {
  if (!Number.isFinite(value)) return 1
  const rounded = Math.floor(value)
  if (rounded < 1) return 1
  if (rounded > 100) return 100
  return rounded
}

function buildWorkflowOverridesForm(settings: WorkflowAutomationResponse): WorkflowOverridesForm {
  return {
    readyLimitMode: settings.overrides.readyLimit !== undefined ? 'override' : 'inherit',
    readyLimit: settings.overrides.readyLimit ?? settings.effective.readyLimit,
    executingLimitMode: settings.overrides.executingLimit !== undefined ? 'override' : 'inherit',
    executingLimit: settings.overrides.executingLimit ?? settings.effective.executingLimit,
    backlogToReadyMode: settings.overrides.backlogToReady !== undefined ? 'override' : 'inherit',
    backlogToReady: settings.overrides.backlogToReady ?? settings.effective.backlogToReady,
    readyToExecutingMode: settings.overrides.readyToExecuting !== undefined ? 'override' : 'inherit',
    readyToExecuting: settings.overrides.readyToExecuting ?? settings.effective.readyToExecuting,
    globalReadyLimit: settings.globalDefaults.readyLimit,
    globalExecutingLimit: settings.globalDefaults.executingLimit,
    globalBacklogToReady: settings.globalDefaults.backlogToReady,
    globalReadyToExecuting: settings.globalDefaults.readyToExecuting,
  }
}

function buildWorkflowUpdateFromForm(form: WorkflowOverridesForm): WorkflowAutomationUpdate {
  return {
    readyLimit: form.readyLimitMode === 'override' ? sanitizeSlotLimitInput(form.readyLimit) : null,
    executingLimit: form.executingLimitMode === 'override' ? sanitizeSlotLimitInput(form.executingLimit) : null,
    backlogToReady: form.backlogToReadyMode === 'override' ? form.backlogToReady : null,
    readyToExecuting: form.readyToExecutingMode === 'override' ? form.readyToExecuting : null,
  }
}

export function WorkspaceConfigPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [allSkills, setAllSkills] = useState<PiSkill[]>([])
  const [allExtensions, setAllExtensions] = useState<PiExtension[]>([])
  const [taskSkills, setTaskSkills] = useState<PostExecutionSkill[]>([])
  const [taskDefaults, setTaskDefaults] = useState<TaskDefaults>({ ...EMPTY_TASK_DEFAULTS })
  const [config, setConfig] = useState<WorkspaceConfig>({
    skills: { enabled: [], config: {} },
    extensions: { enabled: [], config: {} },
  })
  const [sharedContext, setSharedContext] = useState('')
  const [sharedContextPath, setSharedContextPath] = useState('.taskfactory/workspace-context.md')
  const [workflowForm, setWorkflowForm] = useState<WorkflowOverridesForm | null>(null)
  const [activeTab, setActiveTab] = useState<'skills' | 'extensions' | 'task-defaults' | 'workflow' | 'shared-context'>('skills')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')

  // Workspace deletion state
  const [workspaceName, setWorkspaceName] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    if (!workspaceId) return

    let cancelled = false
    setIsLoading(true)
    setSaveError('')
    setWorkflowForm(null)

    Promise.all([
      fetch('/api/pi/skills').then(r => r.json()),
      fetch('/api/pi/extensions').then(r => r.json()),
      fetch('/api/factory/skills').then(r => r.json() as Promise<PostExecutionSkill[]>),
      fetch(`/api/workspaces/${workspaceId}/pi-config`).then(r => r.json()),
      fetch(`/api/workspaces/${workspaceId}/shared-context`).then(r => r.json()),
      api.getWorkspace(workspaceId),
      api.getWorkspaceTaskDefaults(workspaceId),
      api.getWorkflowAutomation(workspaceId),
    ])
      .then(([
        skillsData,
        extensionsData,
        taskSkillsData,
        configData,
        sharedContextData,
        workspace,
        workspaceTaskDefaults,
        workflowSettings,
      ]) => {
        if (cancelled) return

        setAllSkills(skillsData)
        setAllExtensions(extensionsData)
        setTaskSkills(taskSkillsData)

        const skillsById = new Map(taskSkillsData.map((skill) => [skill.id, skill]))
        setTaskDefaults({
          ...workspaceTaskDefaults,
          preExecutionSkills: workspaceTaskDefaults.preExecutionSkills.filter((skillId) => {
            const skill = skillsById.get(skillId)
            return Boolean(skill && skill.hooks.includes('pre'))
          }),
          postExecutionSkills: workspaceTaskDefaults.postExecutionSkills.filter((skillId) => {
            const skill = skillsById.get(skillId)
            return Boolean(skill && skill.hooks.includes('post'))
          }),
        })

        setConfig({
          skills: configData.skills || { enabled: [], config: {} },
          extensions: configData.extensions || { enabled: [], config: {} },
        })
        setWorkflowForm(buildWorkflowOverridesForm(workflowSettings))
        setSharedContext(sharedContextData.content || '')
        setSharedContextPath(sharedContextData.relativePath || '.taskfactory/workspace-context.md')
        // Use folder name from path as the display name
        const folderName = workspace.path.split('/').filter(Boolean).pop() || workspace.name
        setWorkspaceName(folderName)
        setIsLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to load workspace configuration:', err)
        setSaveStatus('error')
        setSaveError('Failed to load workspace configuration')
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const toggleSkill = (skillId: string) => {
    setConfig(prev => ({
      ...prev,
      skills: {
        ...prev.skills,
        enabled: prev.skills.enabled.includes(skillId)
          ? prev.skills.enabled.filter(id => id !== skillId)
          : [...prev.skills.enabled, skillId],
      },
    }))
    setSaveStatus('idle')
    setSaveError('')
  }

  const toggleExtension = (extId: string) => {
    setConfig(prev => ({
      ...prev,
      extensions: {
        ...prev.extensions,
        enabled: prev.extensions.enabled.includes(extId)
          ? prev.extensions.enabled.filter(id => id !== extId)
          : [...prev.extensions.enabled, extId],
      },
    }))
    setSaveStatus('idle')
    setSaveError('')
  }

  const selectAllSkills = () => {
    setConfig(prev => ({
      ...prev,
      skills: {
        ...prev.skills,
        enabled: allSkills.map(s => s.id),
      },
    }))
    setSaveStatus('idle')
    setSaveError('')
  }

  const deselectAllSkills = () => {
    setConfig(prev => ({
      ...prev,
      skills: {
        ...prev.skills,
        enabled: [],
      },
    }))
    setSaveStatus('idle')
    setSaveError('')
  }

  const selectAllExtensions = () => {
    setConfig(prev => ({
      ...prev,
      extensions: {
        ...prev.extensions,
        enabled: allExtensions.map(e => e.id),
      },
    }))
    setSaveStatus('idle')
    setSaveError('')
  }

  const deselectAllExtensions = () => {
    setConfig(prev => ({
      ...prev,
      extensions: {
        ...prev.extensions,
        enabled: [],
      },
    }))
    setSaveStatus('idle')
    setSaveError('')
  }

  const updateTaskDefaults = (
    next: TaskDefaults | ((current: TaskDefaults) => TaskDefaults),
  ) => {
    setTaskDefaults((current) => {
      if (typeof next === 'function') {
        return next(current)
      }
      return next
    })
    setSaveStatus('idle')
    setSaveError('')
  }

  const handleSave = async () => {
    if (!workspaceId) return

    setIsSaving(true)
    setSaveError('')

    try {
      const workflowUpdate = workflowForm
        ? buildWorkflowUpdateFromForm(workflowForm)
        : null

      const [configRes, sharedContextRes, savedTaskDefaults, workflowResult] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/pi-config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        }),
        fetch(`/api/workspaces/${workspaceId}/shared-context`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: sharedContext }),
        }),
        api.saveWorkspaceTaskDefaults(workspaceId, taskDefaults),
        workflowUpdate
          ? api.updateWorkflowAutomation(workspaceId, workflowUpdate)
          : Promise.resolve<WorkflowAutomationResponse | null>(null),
      ])

      if (!configRes.ok || !sharedContextRes.ok) {
        throw new Error('Save failed')
      }

      setTaskDefaults(savedTaskDefaults)
      if (workflowResult) {
        setWorkflowForm(buildWorkflowOverridesForm(workflowResult))
      }

      setSaveStatus('saved')
    } catch (err) {
      console.error('Failed to save config:', err)
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : 'Failed to save configuration')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteWorkspace = async () => {
    if (!workspaceId || deleteConfirmText !== workspaceName) return
    setIsDeleting(true)
    setDeleteError('')
    try {
      await api.deleteWorkspace(workspaceId)
      navigate('/')
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete workspace. Please try again.')
      setIsDeleting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-slate-300 border-t-safety-orange rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600 font-medium">Loading configuration...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white shadow-lg shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(`/workspace/${workspaceId}`)}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <h1 className="text-lg font-bold tracking-tight">TASK FACTORY</h1>
          </button>
          <div className="h-6 w-px bg-slate-700" />
          <span className="text-sm font-medium text-slate-300">Workspace Configuration</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/workspace/${workspaceId}`)}
            className="text-sm text-slate-400 hover:text-white transition-colors inline-flex items-center gap-1"
          >
            <AppIcon icon={ArrowLeft} size="xs" />
            Back to Workspace
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8">
          {/* Page Title */}
          <div className="flex items-center gap-3 mb-6">
            <div>
              <h2 className="text-xl font-semibold text-slate-800">Workspace Configuration</h2>
              <p className="text-sm text-slate-500">Configure skills, extensions, and task defaults for this workspace</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-200 mb-6">
            <button
              onClick={() => setActiveTab('skills')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'skills'
                  ? 'border-safety-orange text-safety-orange'
                  : 'border-transparent text-slate-600 hover:text-slate-800'
              }`}
            >
              Skills ({config.skills.enabled.length}/{allSkills.length})
            </button>
            <button
              onClick={() => setActiveTab('extensions')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'extensions'
                  ? 'border-safety-orange text-safety-orange'
                  : 'border-transparent text-slate-600 hover:text-slate-800'
              }`}
            >
              Extensions ({config.extensions.enabled.length}/{allExtensions.length})
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
              onClick={() => setActiveTab('workflow')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'workflow'
                  ? 'border-safety-orange text-safety-orange'
                  : 'border-transparent text-slate-600 hover:text-slate-800'
              }`}
            >
              Workflow
            </button>
            <button
              onClick={() => setActiveTab('shared-context')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'shared-context'
                  ? 'border-safety-orange text-safety-orange'
                  : 'border-transparent text-slate-600 hover:text-slate-800'
              }`}
            >
              Shared Context
            </button>
          </div>

          {/* Tab Content */}
          {activeTab === 'skills' && (
            <div className="space-y-3">
              {/* Toggle All Bar */}
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">
                  Select skills available to agents in this workspace.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={selectAllSkills}
                    className="text-xs text-slate-500 hover:text-safety-orange transition-colors px-2 py-1 rounded hover:bg-slate-100"
                  >
                    Select All
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    onClick={deselectAllSkills}
                    className="text-xs text-slate-500 hover:text-safety-orange transition-colors px-2 py-1 rounded hover:bg-slate-100"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              {allSkills.map(skill => {
                const isEnabled = config.skills.enabled.includes(skill.id)
                return (
                  <div
                    key={skill.id}
                    onClick={() => toggleSkill(skill.id)}
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                      isEnabled
                        ? 'border-safety-orange bg-orange-50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-slate-400 uppercase">Ext</span>
                      <div>
                        <div className="font-medium text-slate-800">{skill.name}</div>
                        <div className="text-xs text-slate-500">{skill.id}</div>
                      </div>
                    </div>
                    <div
                      className={`w-5 h-5 rounded border flex items-center justify-center ${
                        isEnabled
                          ? 'bg-safety-orange border-safety-orange text-white'
                          : 'border-slate-300'
                      }`}
                    >
                      {isEnabled && <AppIcon icon={Check} size="xs" className="text-white" />}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {activeTab === 'extensions' && (
            <div className="space-y-3">
              {/* Toggle All Bar */}
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">
                  Select extensions active in this workspace.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={selectAllExtensions}
                    className="text-xs text-slate-500 hover:text-safety-orange transition-colors px-2 py-1 rounded hover:bg-slate-100"
                  >
                    Select All
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    onClick={deselectAllExtensions}
                    className="text-xs text-slate-500 hover:text-safety-orange transition-colors px-2 py-1 rounded hover:bg-slate-100"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              {allExtensions.map(ext => {
                const isEnabled = config.extensions.enabled.includes(ext.id)
                return (
                  <div
                    key={ext.id}
                    onClick={() => toggleExtension(ext.id)}
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                      isEnabled
                        ? 'border-safety-orange bg-orange-50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-slate-400 uppercase">Plug</span>
                      <div>
                        <div className="font-medium text-slate-800">{ext.name}</div>
                        <div className="text-xs text-slate-500">v{ext.version}</div>
                      </div>
                    </div>
                    <div
                      className={`w-5 h-5 rounded border flex items-center justify-center ${
                        isEnabled
                          ? 'bg-safety-orange border-safety-orange text-white'
                          : 'border-slate-300'
                      }`}
                    >
                      {isEnabled && <AppIcon icon={Check} size="xs" className="text-white" />}
                    </div>
                  </div>
                )
              })}

              {allExtensions.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-8">
                  No extensions found in ~/.pi/agent/extensions/
                </p>
              )}
            </div>
          )}

          {activeTab === 'task-defaults' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Task Defaults</h3>
                <p className="text-xs text-slate-500">Applied automatically when creating tasks in this workspace without explicit model/skill selections.</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Default Planning Model
                  </label>
                  <ModelSelector
                    value={taskDefaults.planningModelConfig}
                    onChange={(config) => {
                      updateTaskDefaults((current) => ({
                        ...current,
                        planningModelConfig: config,
                      }))
                    }}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Default Execution Model
                  </label>
                  <ModelSelector
                    value={taskDefaults.executionModelConfig ?? taskDefaults.modelConfig}
                    onChange={(config) => {
                      updateTaskDefaults((current) => ({
                        ...current,
                        executionModelConfig: config,
                        // Keep legacy alias aligned for backward compatibility.
                        modelConfig: config,
                      }))
                    }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Execution Pipeline
                </label>
                <p className="text-xs text-slate-500 mb-2">Set workspace-specific default pre/post execution order.</p>
                <ExecutionPipelineEditor
                  availableSkills={taskSkills}
                  selectedPreSkillIds={taskDefaults.preExecutionSkills}
                  selectedSkillIds={taskDefaults.postExecutionSkills}
                  onPreSkillsChange={(skillIds) => {
                    updateTaskDefaults((current) => ({
                      ...current,
                      preExecutionSkills: skillIds,
                    }))
                  }}
                  onPostSkillsChange={(skillIds) => {
                    updateTaskDefaults((current) => ({
                      ...current,
                      postExecutionSkills: skillIds,
                    }))
                  }}
                  showSkillConfigControls={false}
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-800">Planning Prompt Template</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {'Custom prompt template for planning tasks in this workspace. Available variables: {{taskId}}, {{title}}, {{stateBlock}}, {{contractReference}},'}
                    {' {{acceptanceCriteria}}, {{description}}, {{sharedContext}}, {{attachments}}, {{maxToolCalls}}'}
                  </p>
                </div>
                <textarea
                  value={taskDefaults.planningPromptTemplate ?? DEFAULT_PLANNING_PROMPT_TEMPLATE}
                  onChange={(event) => {
                    const value = event.target.value
                    updateTaskDefaults((current) => ({
                      ...current,
                      planningPromptTemplate: value === DEFAULT_PLANNING_PROMPT_TEMPLATE ? undefined : value,
                    }))
                  }}
                  rows={16}
                  className="w-full text-xs font-mono border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-y"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateTaskDefaults((current) => ({ ...current, planningPromptTemplate: undefined }))}
                    className="text-xs text-slate-500 hover:text-slate-700 underline"
                    type="button"
                  >
                    Clear (inherit from global)
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-800">Execution Prompt Template</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {'Custom prompt template for task execution in this workspace. Available variables: {{taskId}}, {{title}}, {{stateBlock}}, {{contractReference}},'}
                    {' {{acceptanceCriteria}}, {{testingInstructions}}, {{description}}, {{sharedContext}},'}
                    {' {{attachments}}, {{skills}}'}
                  </p>
                </div>
                <textarea
                  value={taskDefaults.executionPromptTemplate ?? DEFAULT_EXECUTION_PROMPT_TEMPLATE}
                  onChange={(event) => {
                    const value = event.target.value
                    updateTaskDefaults((current) => ({
                      ...current,
                      executionPromptTemplate: value === DEFAULT_EXECUTION_PROMPT_TEMPLATE ? undefined : value,
                    }))
                  }}
                  rows={16}
                  className="w-full text-xs font-mono border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-y"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateTaskDefaults((current) => ({ ...current, executionPromptTemplate: undefined }))}
                    className="text-xs text-slate-500 hover:text-slate-700 underline"
                    type="button"
                  >
                    Clear (inherit from global)
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'workflow' && workflowForm && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Workflow Overrides</h3>
                <p className="text-xs text-slate-500">Override global workflow defaults for this workspace. Disable an override to inherit the global value.</p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <div>Global defaults → Ready slots: <span className="font-mono">{workflowForm.globalReadyLimit}</span>, Executing slots: <span className="font-mono">{workflowForm.globalExecutingLimit}</span></div>
                <div className="mt-1">Global automation → Backlog→Ready: <span className="font-mono">{workflowForm.globalBacklogToReady ? 'on' : 'off'}</span>, Ready→Exec: <span className="font-mono">{workflowForm.globalReadyToExecuting ? 'on' : 'off'}</span></div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-700">Ready slots</label>
                    <label className="text-xs text-slate-600 inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={workflowForm.readyLimitMode === 'override'}
                        onChange={(event) => {
                          const checked = event.target.checked
                          setWorkflowForm((current) => {
                            if (!current) return current
                            return {
                              ...current,
                              readyLimitMode: checked ? 'override' : 'inherit',
                              readyLimit: checked ? current.readyLimit : current.globalReadyLimit,
                            }
                          })
                          setSaveStatus('idle')
                          setSaveError('')
                        }}
                      />
                      Override for workspace
                    </label>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={workflowForm.readyLimit}
                    disabled={workflowForm.readyLimitMode !== 'override'}
                    onChange={(event) => {
                      const value = Number.parseInt(event.target.value, 10)
                      setWorkflowForm((current) => {
                        if (!current) return current
                        return {
                          ...current,
                          readyLimit: Number.isFinite(value)
                            ? sanitizeSlotLimitInput(value)
                            : current.readyLimit,
                        }
                      })
                      setSaveStatus('idle')
                      setSaveError('')
                    }}
                    className="w-40 text-sm border border-slate-300 bg-white text-slate-800 rounded px-2 py-1.5 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                  {workflowForm.readyLimitMode !== 'override' && (
                    <p className="text-xs text-slate-500">Inherited from global default: {workflowForm.globalReadyLimit}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-700">Executing slots</label>
                    <label className="text-xs text-slate-600 inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={workflowForm.executingLimitMode === 'override'}
                        onChange={(event) => {
                          const checked = event.target.checked
                          setWorkflowForm((current) => {
                            if (!current) return current
                            return {
                              ...current,
                              executingLimitMode: checked ? 'override' : 'inherit',
                              executingLimit: checked ? current.executingLimit : current.globalExecutingLimit,
                            }
                          })
                          setSaveStatus('idle')
                          setSaveError('')
                        }}
                      />
                      Override for workspace
                    </label>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={workflowForm.executingLimit}
                    disabled={workflowForm.executingLimitMode !== 'override'}
                    onChange={(event) => {
                      const value = Number.parseInt(event.target.value, 10)
                      setWorkflowForm((current) => {
                        if (!current) return current
                        return {
                          ...current,
                          executingLimit: Number.isFinite(value)
                            ? sanitizeSlotLimitInput(value)
                            : current.executingLimit,
                        }
                      })
                      setSaveStatus('idle')
                      setSaveError('')
                    }}
                    className="w-40 text-sm border border-slate-300 bg-white text-slate-800 rounded px-2 py-1.5 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                  {workflowForm.executingLimitMode !== 'override' && (
                    <p className="text-xs text-slate-500">Inherited from global default: {workflowForm.globalExecutingLimit}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-700">Backlog→Ready auto-promote</label>
                    <label className="text-xs text-slate-600 inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={workflowForm.backlogToReadyMode === 'override'}
                        onChange={(event) => {
                          const checked = event.target.checked
                          setWorkflowForm((current) => {
                            if (!current) return current
                            return {
                              ...current,
                              backlogToReadyMode: checked ? 'override' : 'inherit',
                              backlogToReady: checked ? current.backlogToReady : current.globalBacklogToReady,
                            }
                          })
                          setSaveStatus('idle')
                          setSaveError('')
                        }}
                      />
                      Override for workspace
                    </label>
                  </div>
                  <label className="text-xs text-slate-700 inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={workflowForm.backlogToReady}
                      disabled={workflowForm.backlogToReadyMode !== 'override'}
                      onChange={(event) => {
                        const checked = event.target.checked
                        setWorkflowForm((current) => {
                          if (!current) return current
                          return {
                            ...current,
                            backlogToReady: checked,
                          }
                        })
                        setSaveStatus('idle')
                        setSaveError('')
                      }}
                    />
                    Enabled
                  </label>
                  {workflowForm.backlogToReadyMode !== 'override' && (
                    <p className="text-xs text-slate-500">Inherited from global default: {workflowForm.globalBacklogToReady ? 'enabled' : 'disabled'}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-700">Ready→Executing auto-run</label>
                    <label className="text-xs text-slate-600 inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={workflowForm.readyToExecutingMode === 'override'}
                        onChange={(event) => {
                          const checked = event.target.checked
                          setWorkflowForm((current) => {
                            if (!current) return current
                            return {
                              ...current,
                              readyToExecutingMode: checked ? 'override' : 'inherit',
                              readyToExecuting: checked ? current.readyToExecuting : current.globalReadyToExecuting,
                            }
                          })
                          setSaveStatus('idle')
                          setSaveError('')
                        }}
                      />
                      Override for workspace
                    </label>
                  </div>
                  <label className="text-xs text-slate-700 inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={workflowForm.readyToExecuting}
                      disabled={workflowForm.readyToExecutingMode !== 'override'}
                      onChange={(event) => {
                        const checked = event.target.checked
                        setWorkflowForm((current) => {
                          if (!current) return current
                          return {
                            ...current,
                            readyToExecuting: checked,
                          }
                        })
                        setSaveStatus('idle')
                        setSaveError('')
                      }}
                    />
                    Enabled
                  </label>
                  {workflowForm.readyToExecutingMode !== 'override' && (
                    <p className="text-xs text-slate-500">Inherited from global default: {workflowForm.globalReadyToExecuting ? 'enabled' : 'disabled'}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'shared-context' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-sm text-slate-600 mb-2">
                  Shared markdown context included in every agent run for this workspace.
                  Both you and the agent can update this file.
                </p>
                <p className="text-xs text-slate-500 font-mono bg-slate-50 border border-slate-200 rounded px-2 py-1 inline-block">
                  {sharedContextPath}
                </p>
              </div>

              <textarea
                value={sharedContext}
                onChange={(e) => {
                  setSharedContext(e.target.value)
                  setSaveStatus('idle')
                  setSaveError('')
                }}
                placeholder="Add persistent workspace notes, constraints, architecture decisions, or conventions..."
                className="w-full min-h-[360px] p-3 text-sm border border-slate-300 bg-white text-slate-800 placeholder-slate-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-safety-orange focus:border-safety-orange font-mono"
                spellCheck={false}
              />
            </div>
          )}

          {/* Danger Zone */}
          <div className="mt-12 pt-6 border-t border-red-200">
            <h3 className="text-sm font-semibold text-red-600 uppercase tracking-wide mb-3">Danger Zone</h3>
            <div className="border border-red-200 rounded-lg bg-red-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-800">Delete this workspace</div>
                  <div className="text-sm text-slate-500 mt-0.5">
                    Permanently remove this workspace and all its task data from Task Factory.
                  </div>
                </div>
                {!showDeleteConfirm && (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="px-4 py-2 text-sm font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-100 transition-colors shrink-0 ml-4"
                  >
                    Delete Workspace
                  </button>
                )}
              </div>

              {showDeleteConfirm && (
                <div className="mt-4 pt-4 border-t border-red-200">
                  <div className="bg-white border border-red-200 rounded-lg p-4">
                    <p className="text-sm text-slate-700 mb-1">
                      <strong className="text-red-600">Warning:</strong> This action is irreversible.
                      All tasks, activity logs, and workspace configuration will be permanently deleted.
                    </p>
                    <p className="text-sm text-slate-600 mb-3">
                      Your project files will <strong>not</strong> be affected — only Task Factory data is removed.
                    </p>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Type <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-red-600">{workspaceName}</span> to confirm:
                    </label>
                    <input
                      type="text"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={workspaceName}
                      className="w-full px-3 py-2 text-sm border border-slate-300 bg-white text-slate-800 placeholder-slate-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-red-400 mb-3"
                      autoComplete="off"
                      spellCheck={false}
                    />

                    {deleteError && (
                      <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        {deleteError}
                      </div>
                    )}

                    <div className="flex gap-3 justify-end">
                      <button
                        onClick={() => {
                          setShowDeleteConfirm(false)
                          setDeleteConfirmText('')
                          setDeleteError('')
                        }}
                        className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleDeleteWorkspace}
                        disabled={deleteConfirmText !== workspaceName || isDeleting}
                        className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isDeleting ? 'Deleting...' : 'I understand, delete this workspace'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Save Bar */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-200">
            <div className="text-sm">
              {saveStatus === 'saved' && (
                <span className="text-green-600 inline-flex items-center gap-1">
                  <AppIcon icon={CheckCircle2} size="xs" />
                  Configuration saved
                </span>
              )}
              {saveStatus === 'error' && (
                <span className="text-red-600">{saveError || 'Failed to save configuration'}</span>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => navigate(`/workspace/${workspaceId}`)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="btn btn-primary"
              >
                {isSaving ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
