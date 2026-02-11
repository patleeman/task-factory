import { useState, useEffect } from 'react'
import type { PiSettings, PiModelsConfig, PiSkill, PiExtension } from '../types/pi'

interface PiSettingsProps {
  onClose: () => void
}

export function PiSettings({ onClose }: PiSettingsProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'models' | 'skills' | 'extensions'>('general')
  const [settings, setSettings] = useState<PiSettings | null>(null)
  const [models, setModels] = useState<PiModelsConfig | null>(null)
  const [skills, setSkills] = useState<PiSkill[]>([])
  const [extensions, setExtensions] = useState<PiExtension[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Load all Pi configuration
    Promise.all([
      fetch('/api/pi/settings').then(r => r.json()),
      fetch('/api/pi/models').then(r => r.json()),
      fetch('/api/pi/skills').then(r => r.json()),
      fetch('/api/pi/extensions').then(r => r.json()),
    ]).then(([settingsData, modelsData, skillsData, extensionsData]) => {
      setSettings(settingsData)
      setModels(modelsData)
      setSkills(skillsData)
      setExtensions(extensionsData)
      setIsLoading(false)
    })
  }, [])

  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'models', label: 'Models' },
    { id: 'skills', label: 'Skills' },
    { id: 'extensions', label: 'Extensions' },
  ] as const

  if (isLoading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()}>
          <div className="p-8 text-center">
            <div className="w-8 h-8 border-4 border-slate-300 border-t-safety-orange rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-600">Loading Pi settings...</p>
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
            <h2 className="text-lg font-semibold">Pi Settings</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-safety-orange text-safety-orange'
                  : 'border-transparent text-slate-600 hover:text-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {activeTab === 'general' && settings && (
            <GeneralSettings settings={settings} />
          )}
          {activeTab === 'models' && models && (
            <ModelsSettings models={models} currentModel={settings?.defaultModel} />
          )}
          {activeTab === 'skills' && (
            <SkillsSettings skills={skills} />
          )}
          {activeTab === 'extensions' && (
            <ExtensionsSettings extensions={extensions} />
          )}
        </div>
      </div>
    </div>
  )
}

function GeneralSettings({ settings }: { settings: PiSettings }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Default Provider
        </label>
        <div className="text-sm text-slate-600 bg-slate-50 px-3 py-2 rounded-lg">
          {settings.defaultProvider || 'Not set'}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Default Model
        </label>
        <div className="text-sm text-slate-600 bg-slate-50 px-3 py-2 rounded-lg">
          {settings.defaultModel || 'Not set'}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Thinking Level
        </label>
        <div className="text-sm text-slate-600 bg-slate-50 px-3 py-2 rounded-lg capitalize">
          {settings.defaultThinkingLevel || 'Not set'}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Theme
        </label>
        <div className="text-sm text-slate-600 bg-slate-50 px-3 py-2 rounded-lg">
          {settings.theme || 'Not set'}
        </div>
      </div>

      <p className="text-xs text-slate-400 mt-4">
        Edit ~/.pi/agent/settings.json to change these values
      </p>
    </div>
  )
}

function ModelsSettings({ models, currentModel }: { models: PiModelsConfig; currentModel?: string }) {
  return (
    <div className="space-y-4">
      {Object.entries(models.providers || {}).map(([providerId, provider]) => (
        <div key={providerId} className="bg-slate-50 rounded-lg p-4">
          <h3 className="font-medium text-slate-800 mb-2">{provider.name}</h3>
          <div className="space-y-1">
            {provider.models?.map((model: any) => (
              <div
                key={model.id}
                className={`text-sm px-3 py-2 rounded ${
                  model.id === currentModel
                    ? 'bg-safety-orange text-white'
                    : 'text-slate-600'
                }`}
              >
                {model.name || model.id}
                {model.id === currentModel && ' (default)'}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SkillsSettings({ skills }: { skills: PiSkill[] }) {
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)

  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500 mb-4">
        {skills.length} skills available. Click a skill to view details.
      </p>
      {skills.map(skill => (
        <div
          key={skill.id}
          className="border border-slate-200 rounded-lg overflow-hidden"
        >
          <button
            onClick={() => setExpandedSkill(expandedSkill === skill.id ? null : skill.id)}
            className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-lg">🛠️</span>
              <div className="text-left">
                <div className="font-medium text-slate-800">{skill.name}</div>
                <div className="text-xs text-slate-500">{skill.id}</div>
              </div>
            </div>
            <span className="text-slate-400">
              {expandedSkill === skill.id ? '▼' : '▶'}
            </span>
          </button>
          {expandedSkill === skill.id && (
            <div className="px-4 py-3 border-t border-slate-200">
              <p className="text-sm text-slate-600 mb-3">{skill.description}</p>
              {skill.allowedTools.length > 0 && (
                <div>
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Allowed Tools
                  </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {skill.allowedTools.map(tool => (
                      <span
                        key={tool}
                        className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded"
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function ExtensionsSettings({ extensions }: { extensions: PiExtension[] }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500 mb-4">
        {extensions.length} extensions available
      </p>
      {extensions.map(ext => (
        <div
          key={ext.id}
          className="flex items-center justify-between px-4 py-3 bg-slate-50 rounded-lg"
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">🔌</span>
            <div>
              <div className="font-medium text-slate-800">{ext.name}</div>
              <div className="text-xs text-slate-500">
                v{ext.version}
                {ext.slots && ext.slots.length > 0 && (
                  <span className="ml-2">
                    Slots: {ext.slots.join(', ')}
                  </span>
                )}
              </div>
            </div>
          </div>
          <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
            Active
          </span>
        </div>
      ))}
    </div>
  )
}
