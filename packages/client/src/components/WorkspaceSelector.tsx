import { useState } from 'react'
import type { Workspace } from '@pi-factory/shared'

interface WorkspaceSelectorProps {
  workspaces: Workspace[]
  current: Workspace | null
  onSelect: (id: string) => void
  onCreate: (path: string, name: string) => void
}

export function WorkspaceSelector({ workspaces, current, onSelect, onCreate }: WorkspaceSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newPath, setNewPath] = useState('')
  const [newName, setNewName] = useState('')

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (newPath) {
      onCreate(newPath, newName || 'New Workspace')
      setShowCreate(false)
      setNewPath('')
      setNewName('')
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-sm hover:bg-slate-800 px-3 py-1.5 rounded-lg transition-colors"
      >
        <span className="font-medium">{current?.name || 'Select Workspace'}</span>
        <span className="text-slate-400">▼</span>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 top-full mt-1 w-72 bg-white rounded-lg shadow-xl border border-slate-200 z-50 overflow-hidden">
            <div className="p-2">
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => {
                    onSelect(ws.id)
                    setIsOpen(false)
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    current?.id === ws.id
                      ? 'bg-blue-50 text-blue-700'
                      : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="font-medium">{ws.name}</div>
                  <div className="text-xs text-slate-400 truncate">{ws.path}</div>
                </button>
              ))}

              {workspaces.length === 0 && (
                <div className="text-center py-4 text-sm text-slate-400">
                  No workspaces yet
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 p-2">
              {showCreate ? (
                <form onSubmit={handleCreate} className="space-y-2">
                  <input
                    type="text"
                    placeholder="Path (e.g., /home/user/project)"
                    value={newPath}
                    onChange={(e) => setNewPath(e.target.value)}
                    className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                  <input
                    type="text"
                    placeholder="Name (optional)"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCreate(false)}
                      className="flex-1 text-sm px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!newPath}
                      className="flex-1 text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      Create
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setShowCreate(true)}
                  className="w-full text-left px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                >
                  + Create Workspace
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
