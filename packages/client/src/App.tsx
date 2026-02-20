import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { WelcomePage } from './components/WelcomePage'
import { WorkspacePage } from './components/WorkspacePage'
import { SettingsPage } from './components/SettingsPage'
import { WorkspaceConfigPage } from './components/WorkspaceConfigPage'
import { WorkspaceLayout } from './components/WorkspaceLayout'
import { PiMigrationPrompt } from './components/PiMigrationPrompt'
import { api, type PiMigrationSelection, type PiMigrationStatus } from './api'

function App() {
  const [migrationStatus, setMigrationStatus] = useState<PiMigrationStatus | null>(null)
  const [migrationLoading, setMigrationLoading] = useState(true)
  const [migrationError, setMigrationError] = useState('')

  useEffect(() => {
    let cancelled = false

    api.getPiMigrationStatus()
      .then((status) => {
        if (cancelled) return
        setMigrationStatus(status)
        setMigrationLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setMigrationError(err instanceof Error ? err.message : String(err))
        setMigrationLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleMigrate = async (selection: PiMigrationSelection) => {
    const status = await api.migrateLegacyPiData(selection)
    setMigrationStatus(status)
  }

  const handleSkip = async () => {
    const status = await api.skipLegacyPiMigration()
    setMigrationStatus(status)
  }

  if (migrationLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-slate-300 border-t-safety-orange rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600 font-medium">Loading Task Factory...</p>
        </div>
      </div>
    )
  }

  if (migrationError) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50 px-4">
        <div className="w-full max-w-xl rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          <p className="font-semibold">Failed to load migration status</p>
          <p className="text-sm mt-1">{migrationError}</p>
        </div>
      </div>
    )
  }

  if (migrationStatus?.state === 'pending') {
    return (
      <PiMigrationPrompt
        status={migrationStatus}
        onMigrate={handleMigrate}
        onSkip={handleSkip}
      />
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/settings" element={<SettingsPage />} />

        <Route element={<WorkspaceLayout />}>
          <Route path="/workspace/:workspaceId" element={<WorkspacePage />} />
          <Route path="/workspace/:workspaceId/archive" element={<WorkspacePage />} />
          <Route path="/workspace/:workspaceId/tasks/new" element={<WorkspacePage />} />
          <Route path="/workspace/:workspaceId/tasks/:taskId" element={<WorkspacePage />} />
          <Route path="/workspace/:workspaceId/config" element={<WorkspaceConfigPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
