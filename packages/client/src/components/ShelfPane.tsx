import type { Shelf, DraftTask } from '@pi-factory/shared'
import { DraftTaskCard } from './DraftTaskCard'

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
  const drafts = shelf.items.filter((si): si is { type: 'draft-task'; item: DraftTask } => si.type === 'draft-task')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0">
        <h2 className="font-semibold text-xs text-slate-500 uppercase tracking-wide">
          Production Queue
          {drafts.length > 0 && (
            <span className="ml-1.5 text-slate-400 font-normal">({drafts.length})</span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {drafts.length > 0 && (
            <>
              <button
                onClick={onPushAll}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
              >
                Push all to backlog →
              </button>
              <button
                onClick={onClearShelf}
                className="text-xs text-slate-400 hover:text-red-500 font-medium transition-colors"
              >
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {/* Draft tasks */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {drafts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 px-6">
            <p className="text-sm font-medium text-slate-500 mb-1">Production queue is empty</p>
            <p className="text-xs text-center">
              Chat with the Foreman to create draft tasks
            </p>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {drafts.map(({ item: draft }) => (
              <DraftTaskCard
                key={draft.id}
                draft={draft}
                onPush={() => onPushDraft(draft.id)}
                onRemove={() => onRemoveItem(draft.id)}
                onUpdate={(updates) => onUpdateDraft(draft.id, updates)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
