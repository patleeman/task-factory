import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PiSettings } from '../types/pi'

export function SettingsPage() {
  const navigate = useNavigate()
  const [settings, setSettings] = useState<PiSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetch('/api/pi/settings')
      .then(r => r.json())
      .then((settingsData) => {
        setSettings(settingsData)
        setIsLoading(false)
      })
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-slate-300 border-t-safety-orange rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600 font-medium">Loading Pi settings...</p>
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8">
          {/* Page Title */}
          <div className="flex items-center gap-3 mb-6">
            <div>
              <h2 className="text-xl font-semibold text-slate-800">Pi Settings</h2>
              <p className="text-sm text-slate-500">Global Pi agent configuration</p>
            </div>
          </div>

          {/* Settings */}
          {settings && <GeneralSettings settings={settings} />}
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
          Thinking Level
        </label>
        <div className="text-sm text-slate-600 bg-white border border-slate-200 px-3 py-2 rounded-lg capitalize">
          {settings.defaultThinkingLevel || 'Not set'}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Theme
        </label>
        <div className="text-sm text-slate-600 bg-white border border-slate-200 px-3 py-2 rounded-lg">
          {settings.theme || 'Not set'}
        </div>
      </div>

      <p className="text-xs text-slate-400 mt-6">
        Edit ~/.pi/agent/settings.json to change these values.
        Model selection is configured per-task.
      </p>
    </div>
  )
}
