import { useState } from 'react'
import type { Shelf, DraftTask, Artifact } from '@pi-factory/shared'
import { DraftTaskCard } from './DraftTaskCard'
import { ArtifactViewer } from './ArtifactViewer'

interface ShelfPaneProps {
  shelf: Shelf
  onPushDraft: (draftId: string) => void
  onPushAll: () => void
  onRemoveItem: (itemId: string) => void
  onUpdateDraft: (draftId: string, updates: Partial<DraftTask>) => void
  onClearShelf: () => void
}

export function ShelfPane({
  shelf,
  onPushDraft,
  onPushAll,
  onRemoveItem,
  onUpdateDraft,
  onClearShelf,
}: ShelfPaneProps) {
  const [focusedArtifact, setFocusedArtifact] = useState<Artifact | null>(null)

  const drafts = shelf.items.filter((si): si is { type: 'draft-task'; item: DraftTask } => si.type === 'draft-task')
  const hasDrafts = drafts.length > 0

  if (focusedArtifact) {
    console.log('[ShelfPane] Rendering focused artifact:', focusedArtifact.id, 'html length:', focusedArtifact.html?.length)
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setFocusedArtifact(null)}
              className="text-slate-400 hover:text-slate-600 transition-colors text-xs font-medium"
            >
              ← Back
            </button>
            <div className="h-4 w-px bg-slate-200" />
            <span className="text-xs font-medium text-slate-700 truncate">{focusedArtifact.name}</span>
          </div>
          <button
            onClick={() => {
              onRemoveItem(focusedArtifact.id)
              setFocusedArtifact(null)
            }}
            className="text-xs text-red-500 hover:text-red-700 font-medium"
          >
            Remove
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <ArtifactViewer html={focusedArtifact.html} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0">
        <h2 className="font-semibold text-xs text-slate-500 uppercase tracking-wide">
          Production Queue
          {shelf.items.length > 0 && (
            <span className="ml-1.5 text-slate-400 font-normal">({shelf.items.length})</span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {hasDrafts && (
            <button
              onClick={onPushAll}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
            >
              Push all to backlog →
            </button>
          )}
          {shelf.items.length > 0 && (
            <button
              onClick={onClearShelf}
              className="text-xs text-slate-400 hover:text-red-500 font-medium transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Shelf items */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {shelf.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 px-6">
            <p className="text-sm font-medium text-slate-500 mb-1">Production queue is empty</p>
            <p className="text-xs text-center">
              Chat with the Foreman to create draft tasks and artifacts
            </p>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {shelf.items.map((si) => {
              if (si.type === 'draft-task') {
                const draft = si.item as DraftTask
                return (
                  <DraftTaskCard
                    key={draft.id}
                    draft={draft}
                    onPush={() => onPushDraft(draft.id)}
                    onRemove={() => onRemoveItem(draft.id)}
                    onUpdate={(updates) => onUpdateDraft(draft.id, updates)}
                  />
                )
              } else {
                const artifact = si.item as Artifact
                return (
                  <div
                    key={artifact.id}
                    onClick={() => {
                      console.log('[ShelfPane] Artifact clicked:', artifact.id, artifact.name)
                      setFocusedArtifact(artifact)
                    }}
                    className="border border-slate-200 rounded-lg p-3 cursor-pointer hover:border-slate-300 hover:bg-slate-50 transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase">artifact</span>
                        <span className="text-sm font-medium text-slate-700 truncate">
                          {artifact.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onRemoveItem(artifact.id)
                          }}
                          className="text-xs text-red-500 hover:text-red-700 px-1 font-medium"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Click to view • {new Date(artifact.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                )
              }
            })}
          </div>
        )}
      </div>
    </div>
  )
}
