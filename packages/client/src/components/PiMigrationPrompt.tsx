import { useEffect, useState } from 'react'
import type { PiMigrationSelection, PiMigrationStatus } from '../api'

interface PiMigrationPromptProps {
  status: PiMigrationStatus
  onMigrate: (selection: PiMigrationSelection) => Promise<void>
  onSkip: () => Promise<void>
}

function buildDefaultSelection(status: PiMigrationStatus): PiMigrationSelection {
  return {
    auth: status.available.auth,
    skills: status.available.skills,
    extensions: status.available.extensions,
  }
}

export function PiMigrationPrompt({ status, onMigrate, onSkip }: PiMigrationPromptProps) {
  const [selection, setSelection] = useState<PiMigrationSelection>(() => buildDefaultSelection(status))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setSelection(buildDefaultSelection(status))
    setError('')
  }, [status])

  const handleMigrate = async () => {
    setIsSubmitting(true)
    setError('')

    try {
      await onMigrate(selection)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSkip = async () => {
    setIsSubmitting(true)
    setError('')

    try {
      await onSkip()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Migrate from legacy Pi config</h1>
          <p className="mt-2 text-sm text-slate-600">
            We found legacy data under <span className="font-mono">~/.pi</span>. Choose what to copy into
            <span className="font-mono"> ~/.taskfactory</span>. This prompt only appears once.
          </p>
        </div>

        <div className="space-y-3">
          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={selection.auth === true}
              disabled={!status.available.auth || isSubmitting}
              onChange={(event) => setSelection((current) => ({ ...current, auth: event.target.checked }))}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Auth credentials</span>
              <span className="block text-xs text-slate-500">Copy provider keys/tokens into ~/.taskfactory/agent/auth.json</span>
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={selection.skills === true}
              disabled={!status.available.skills || isSubmitting}
              onChange={(event) => setSelection((current) => ({ ...current, skills: event.target.checked }))}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Pi skills</span>
              <span className="block text-xs text-slate-500">Copy global Pi skills into ~/.taskfactory/agent/skills</span>
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={selection.extensions === true}
              disabled={!status.available.extensions || isSubmitting}
              onChange={(event) => setSelection((current) => ({ ...current, extensions: event.target.checked }))}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Pi extensions</span>
              <span className="block text-xs text-slate-500">Copy global extensions into ~/.taskfactory/extensions</span>
            </span>
          </label>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => { void handleSkip() }}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => { void handleMigrate() }}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm rounded-lg bg-safety-orange text-white hover:opacity-90 disabled:opacity-60"
          >
            {isSubmitting ? 'Applying…' : 'Migrate selected'}
          </button>
        </div>
      </div>
    </div>
  )
}
