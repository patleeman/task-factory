import { useState } from 'react'
import type { WorkspaceStorageMigrationStatus } from '../api'

interface WorkspaceStorageMigrationPromptProps {
  status: WorkspaceStorageMigrationStatus
  onMove: () => Promise<void>
  onLeave: () => Promise<void>
}

export function WorkspaceStorageMigrationPrompt({
  status,
  onMove,
  onLeave,
}: WorkspaceStorageMigrationPromptProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleMove = async () => {
    setIsSubmitting(true)
    setError('')
    try {
      await onMove()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsSubmitting(false)
    }
  }

  const handleLeave = async () => {
    setIsSubmitting(true)
    setError('')
    try {
      await onLeave()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl space-y-5">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
              Deprecated in a future version
            </span>
          </div>
          <h2 className="text-lg font-semibold text-slate-900">
            Move workspace storage to global location?
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            This workspace currently stores its task factory data inside the project directory at{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">.taskfactory/</code>.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            The new default is to keep workspace data in a global location, separate from your project files:
          </p>
          <code className="mt-1 block rounded bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700 break-all">
            {status.targetArtifactRoot ?? '~/.taskfactory/workspaces/<workspace>/'}
          </code>
        </div>

        {/* Benefits */}
        <ul className="space-y-1.5 text-sm text-slate-600">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-emerald-500">✓</span>
            Keeps task data out of version control and project directories
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-emerald-500">✓</span>
            All existing tasks, planning history, and attachments will be preserved
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-emerald-500">✓</span>
            You can change the location anytime in Workspace Settings
          </li>
        </ul>

        {/* Deprecation notice */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <strong>Note:</strong> Storing workspace data inside the project directory (
          <code className="font-mono">.taskfactory/</code>) will be removed in a future version.
          We recommend moving now to avoid disruption.
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={() => { void handleLeave() }}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-60 transition-colors"
          >
            Leave for now
          </button>
          <button
            type="button"
            onClick={() => { void handleMove() }}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm rounded-lg bg-safety-orange text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
          >
            {isSubmitting ? 'Moving…' : 'Move to global location'}
          </button>
        </div>
      </div>
    </div>
  )
}
