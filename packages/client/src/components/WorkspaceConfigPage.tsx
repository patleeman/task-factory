import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { PiSkill, PiExtension } from '../types/pi'

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
  const [activeTab, setActiveTab] = useState<'skills' | 'extensions'>('skills')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  useEffect(() => {
    if (!workspaceId) return

    Promise.all([
      fetch('/api/pi/skills').then(r => r.json()),
      fetch('/api/pi/extensions').then(r => r.json()),
      fetch(`/api/workspaces/${workspaceId}/pi-config`).then(r => r.json()),
    ]).then(([skillsData, extensionsData, configData]) => {
      setAllSkills(skillsData)
      setAllExtensions(extensionsData)
      setConfig({
        skills: configData.skills || { enabled: [], config: {} },
        extensions: configData.extensions || { enabled: [], config: {} },
      })
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
      await fetch(`/api/workspaces/${workspaceId}/pi-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      setSaveStatus('saved')
    } catch (err) {
      console.error('Failed to save config:', err)
      setSaveStatus('error')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-slate-300 border-t-safety-orange rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600 font-medium">Loading configuration...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50">
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
