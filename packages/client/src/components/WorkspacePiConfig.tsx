import { useState, useEffect } from 'react'
import type { PiSkill, PiExtension } from '../types/pi'

interface WorkspacePiConfigProps {
  workspaceId: string
  onClose: () => void
}

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

export function WorkspacePiConfig({ workspaceId, onClose }: WorkspacePiConfigProps) {
  const [allSkills, setAllSkills] = useState<PiSkill[]>([])
  const [allExtensions, setAllExtensions] = useState<PiExtension[]>([])
  const [config, setConfig] = useState<WorkspaceConfig>({
    skills: { enabled: [], config: {} },
    extensions: { enabled: [], config: {} },
  })
  const [activeTab, setActiveTab] = useState<'skills' | 'extensions'>('skills')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
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
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/pi-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      onClose()
    } catch (err) {
      console.error('Failed to save config:', err)
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()}>
          <div className="p-8 text-center">
            <div className="w-8 h-8 border-4 border-slate-300 border-t-safety-orange rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-600">Loading configuration...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-safety-orange rounded-lg flex items-center justify-center font-bold text-white text-sm">
              π
            </div>
            <h2 className="text-lg font-semibold">Workspace Pi Configuration</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200">
          <button
            onClick={() => setActiveTab('skills')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'skills'
                ? 'border-safety-orange text-safety-orange'
                : 'border-transparent text-slate-600 hover:text-slate-800'
            }`}
          >
            Skills ({config.skills.enabled.length})
          </button>
          <button
            onClick={() => setActiveTab('extensions')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'extensions'
                ? 'border-safety-orange text-safety-orange'
                : 'border-transparent text-slate-600 hover:text-slate-800'
            }`}
          >
            Extensions ({config.extensions.enabled.length})
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[50vh]">
          {activeTab === 'skills' && (
            <div className="space-y-2">
              <p className="text-sm text-slate-500 mb-4">
                Select skills available to agents in this workspace.
              </p>
              {allSkills.map(skill => {
                const isEnabled = config.skills.enabled.includes(skill.id)
                return (
                  <div
                    key={skill.id}
                    onClick={() => toggleSkill(skill.id)}
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                      isEnabled
                        ? 'border-safety-orange bg-orange-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">🛠️</span>
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
            <div className="space-y-2">
              <p className="text-sm text-slate-500 mb-4">
                Select extensions active in this workspace.
              </p>
              {allExtensions.map(ext => {
                const isEnabled = config.extensions.enabled.includes(ext.id)
                return (
                  <div
                    key={ext.id}
                    onClick={() => toggleExtension(ext.id)}
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                      isEnabled
                        ? 'border-safety-orange bg-orange-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">🔌</span>
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
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
          <button onClick={onClose} className="btn btn-secondary">
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
  )
}
