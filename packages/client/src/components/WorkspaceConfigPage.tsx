import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { PiSkill, PiExtension } from '../types/pi'
import { api } from '../api'

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

export function WorkspaceConfigPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [allSkills, setAllSkills] = useState<PiSkill[]>([])
  const [allExtensions, setAllExtensions] = useState<PiExtension[]>([])
  const [config, setConfig] = useState<WorkspaceConfig>({
    skills: { enabled: [], config: {} },
    extensions: { enabled: [], config: {} },
  })
  const [sharedContext, setSharedContext] = useState('')
  const [sharedContextPath, setSharedContextPath] = useState('.pi/workspace-context.md')
  const [activeTab, setActiveTab] = useState<'skills' | 'extensions' | 'shared-context'>('skills')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  // Workspace deletion state
  const [workspaceName, setWorkspaceName] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    if (!workspaceId) return

    Promise.all([
      fetch('/api/pi/skills').then(r => r.json()),
      fetch('/api/pi/extensions').then(r => r.json()),
      fetch(`/api/workspaces/${workspaceId}/pi-config`).then(r => r.json()),
      fetch(`/api/workspaces/${workspaceId}/shared-context`).then(r => r.json()),
      api.getWorkspace(workspaceId),
    ]).then(([skillsData, extensionsData, configData, sharedContextData, workspace]) => {
      setAllSkills(skillsData)
      setAllExtensions(extensionsData)
      setConfig({
        skills: configData.skills || { enabled: [], config: {} },
        extensions: configData.extensions || { enabled: [], config: {} },
      })
      setSharedContext(sharedContextData.content || '')
      setSharedContextPath(sharedContextData.relativePath || '.pi/workspace-context.md')
      // Use folder name from path as the display name
      const folderName = workspace.path.split('/').filter(Boolean).pop() || workspace.name
      setWorkspaceName(folderName)
      setIsLoading(false)
    })
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
  }

  const handleSave = async () => {
    if (!workspaceId) return
    setIsSaving(true)
    try {
      const [configRes, sharedContextRes] = await Promise.all([
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
      ])

      if (!configRes.ok || !sharedContextRes.ok) {
        throw new Error('Save failed')
      }

      setSaveStatus('saved')
    } catch (err) {
      console.error('Failed to save config:', err)
      setSaveStatus('error')
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
            <h1 className="text-lg font-bold tracking-tight">PI-FACTORY</h1>
          </button>
          <div className="h-6 w-px bg-slate-700" />
          <span className="text-sm font-medium text-slate-300">Workspace Configuration</span>
        </div>
        <button
          onClick={() => navigate(`/workspace/${workspaceId}`)}
          className="text-sm text-slate-400 hover:text-white transition-colors"
        >
          ← Back to Workspace
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8">
          {/* Page Title */}
          <div className="flex items-center gap-3 mb-6">
            <div>
              <h2 className="text-xl font-semibold text-slate-800">Workspace Configuration</h2>
              <p className="text-sm text-slate-500">Configure skills and extensions for this workspace</p>
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
                      {isEnabled && '✓'}
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
                      {isEnabled && '✓'}
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
                }}
                placeholder="Add persistent workspace notes, constraints, architecture decisions, or conventions..."
                className="w-full min-h-[360px] p-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-safety-orange focus:border-safety-orange font-mono"
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
                    Permanently remove this workspace and all its task data from Pi-Factory.
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
                      Your project files will <strong>not</strong> be affected — only Pi-Factory data is removed.
                    </p>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Type <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-red-600">{workspaceName}</span> to confirm:
                    </label>
                    <input
                      type="text"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={workspaceName}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-red-400 mb-3"
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
                <span className="text-green-600">✓ Configuration saved</span>
              )}
              {saveStatus === 'error' && (
                <span className="text-red-600">Failed to save configuration</span>
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
