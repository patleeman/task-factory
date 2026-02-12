import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Workspace } from '@pi-factory/shared'
import { api } from '../api'

interface FolderEntry {
  name: string
  path: string
}

function FolderBrowser({ onSelect, onCancel }: { onSelect: (path: string) => void; onCancel: () => void }) {
  const [currentPath, setCurrentPath] = useState('')
  const [folders, setFolders] = useState<FolderEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const browse = async (path?: string) => {
    setLoading(true)
    setError('')
    try {
      const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : '/api/browse'
      const res = await fetch(url)
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        setCurrentPath(data.current)
        setFolders(data.folders)
      }
    } catch {
      setError('Failed to browse directories')
    }
    setLoading(false)
  }

  useEffect(() => { browse() }, [])

  const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/'

  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
      {/* Current path */}
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-sm text-slate-600 font-mono truncate">
        {currentPath || '...'}
      </div>

      {error && (
        <div className="px-4 py-2 text-sm text-red-600">{error}</div>
      )}

      {/* Folder list */}
      <div className="max-h-72 overflow-y-auto">
        {currentPath !== '/' && (
          <button
            onClick={() => browse(parentPath)}
            className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 text-slate-500 flex items-center gap-2 border-b border-slate-100"
          >
            <span>↑</span>
            <span>..</span>
          </button>
        )}

        {loading ? (
          <div className="px-4 py-8 text-sm text-slate-400 text-center">Loading...</div>
        ) : folders.length === 0 ? (
          <div className="px-4 py-8 text-sm text-slate-400 text-center">No subfolders</div>
        ) : (
          folders.map((f) => (
            <button
              key={f.path}
              onClick={() => browse(f.path)}
              className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 text-slate-700 flex items-center gap-2 border-b border-slate-50"
            >
              <span className="text-xs text-slate-400 font-mono">/</span>
              <span className="truncate">{f.name}</span>
            </button>
          ))
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 p-3 border-t border-slate-200 bg-slate-50">
        <button
          onClick={onCancel}
          className="flex-1 text-sm px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => onSelect(currentPath)}
          disabled={!currentPath}
          className="flex-1 text-sm px-4 py-2 bg-safety-orange text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          Use This Folder
        </button>
      </div>
    </div>
  )
}

function folderName(path: string): string {
  return path.split('/').filter(Boolean).pop() || path
}

export function WelcomePage() {
  const navigate = useNavigate()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showBrowser, setShowBrowser] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    api.getWorkspaces().then((w) => {
      setWorkspaces(w)
      setIsLoading(false)
    })
  }, [])

  const handleCreateWorkspace = async (path: string) => {
    setCreating(true)
    try {
      const workspace = await api.createWorkspace(path)
      navigate(`/workspace/${workspace.id}`)
    } catch (err) {
      console.error('Failed to create workspace:', err)
      alert('Failed to create workspace: ' + String(err))
    }
    setCreating(false)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-slate-300 border-t-safety-orange rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600 font-medium">Loading Pi-Factory...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-center px-4 py-6 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">PI-FACTORY</h1>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 flex items-start justify-center px-4 pt-8 pb-16">
        <div className="w-full max-w-lg">
          {/* Workspaces list */}
          {workspaces.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Workspaces
              </h2>
              <div className="space-y-2">
                {workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    onClick={() => navigate(`/workspace/${ws.id}`)}
                    className="w-full text-left px-4 py-3 bg-white border border-slate-200 rounded-xl hover:border-safety-orange hover:shadow-sm transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800 group-hover:text-safety-orange transition-colors">
                          {folderName(ws.path)}
                        </div>
                        <div className="text-xs text-slate-400 truncate mt-0.5 font-mono">
                          {ws.path}
                        </div>
                      </div>
                      <span className="text-slate-300 group-hover:text-safety-orange transition-colors text-lg ml-3 shrink-0">
                        →
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Add workspace */}
          {showBrowser ? (
            <div>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Select a project folder
              </h2>
              <FolderBrowser
                onSelect={handleCreateWorkspace}
                onCancel={() => setShowBrowser(false)}
              />
              {creating && (
                <div className="mt-3 text-sm text-slate-500 text-center">Setting up workspace...</div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowBrowser(true)}
              className="w-full py-4 px-4 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-safety-orange hover:text-safety-orange transition-colors text-sm font-medium"
            >
              + Add Workspace
            </button>
          )}

          {/* Empty state hint */}
          {workspaces.length === 0 && !showBrowser && (
            <p className="text-center text-sm text-slate-400 mt-6">
              Point Pi-Factory at a project folder to get started.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
