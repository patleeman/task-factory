import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, GripVertical, Plus, Trash2 } from 'lucide-react'
import type { IdeaBacklog, IdeaBacklogItem } from '@pi-factory/shared'
import { AppIcon } from './AppIcon'

interface IdeaBacklogPaneProps {
  backlog: IdeaBacklog | null
  onBack: () => void
  onAddIdea: (text: string) => Promise<void> | void
  onDeleteIdea: (ideaId: string) => Promise<void> | void
  onReorderIdeas: (ideaIds: string[]) => Promise<void> | void
  onPromoteIdea: (idea: IdeaBacklogItem) => void
}

function moveIdeaBeforeTarget(ideaIds: string[], draggedIdeaId: string, targetIdeaId: string): string[] {
  const withoutDragged = ideaIds.filter((id) => id !== draggedIdeaId)
  const targetIndex = withoutDragged.indexOf(targetIdeaId)
  if (targetIndex < 0) return ideaIds

  const reordered = [...withoutDragged]
  reordered.splice(targetIndex, 0, draggedIdeaId)
  return reordered
}

function moveIdeaToEnd(ideaIds: string[], draggedIdeaId: string): string[] {
  const withoutDragged = ideaIds.filter((id) => id !== draggedIdeaId)
  return [...withoutDragged, draggedIdeaId]
}

export function IdeaBacklogPane({
  backlog,
  onBack,
  onAddIdea,
  onDeleteIdea,
  onReorderIdeas,
  onPromoteIdea,
}: IdeaBacklogPaneProps) {
  const [draftText, setDraftText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [draggingIdeaId, setDraggingIdeaId] = useState<string | null>(null)
  const [dropTargetIdeaId, setDropTargetIdeaId] = useState<string | null>(null)
  const [dropAtEnd, setDropAtEnd] = useState(false)
  const dragIdeaIdRef = useRef<string | null>(null)

  const ideas = backlog?.items || []
  const canSubmit = draftText.trim().length > 0 && !isSubmitting

  const orderedIdeaIds = useMemo(() => ideas.map((idea) => idea.id), [ideas])

  const clearDragState = () => {
    dragIdeaIdRef.current = null
    setDraggingIdeaId(null)
    setDropTargetIdeaId(null)
    setDropAtEnd(false)
  }

  const submitIdea = async () => {
    const text = draftText.trim()
    if (!text || isSubmitting) return

    setIsSubmitting(true)
    try {
      await onAddIdea(text)
      setDraftText('')
    } catch {
      // Parent handler is expected to surface user-facing errors.
    } finally {
      setIsSubmitting(false)
    }
  }

  const applyReorder = async (nextIds: string[]) => {
    const sameOrder = nextIds.length === orderedIdeaIds.length
      && nextIds.every((id, index) => id === orderedIdeaIds[index])

    if (sameOrder) return
    await onReorderIdeas(nextIds)
  }

  const handleDropOnIdea = async (targetIdeaId: string) => {
    const draggedIdeaId = dragIdeaIdRef.current
    clearDragState()

    if (!draggedIdeaId || draggedIdeaId === targetIdeaId) return

    const nextIds = moveIdeaBeforeTarget(orderedIdeaIds, draggedIdeaId, targetIdeaId)
    try {
      await applyReorder(nextIds)
    } catch {
      // Parent handler is expected to surface user-facing errors.
    }
  }

  const handleDropAtEnd = async () => {
    const draggedIdeaId = dragIdeaIdRef.current
    clearDragState()

    if (!draggedIdeaId) return

    const nextIds = moveIdeaToEnd(orderedIdeaIds, draggedIdeaId)
    try {
      await applyReorder(nextIds)
    } catch {
      // Parent handler is expected to surface user-facing errors.
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0">
        <h2 className="font-semibold text-xs text-slate-500 uppercase tracking-wide">
          Idea Backlog
        </h2>
        <button
          onClick={onBack}
          className="text-xs text-slate-400 hover:text-slate-600 inline-flex items-center gap-1"
        >
          <AppIcon icon={ArrowLeft} size="xs" />
          Foreman workspace
        </button>
      </div>

      <div className="px-4 py-3 border-b border-slate-200 bg-white shrink-0">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submitIdea()
          }}
        >
          <input
            type="text"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            placeholder="Jot down an idea..."
            className="flex-1 text-sm border border-slate-300 rounded-md px-3 py-2 text-slate-700 focus:outline-none focus:border-slate-500"
          />
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <AppIcon icon={Plus} size="xs" />
            Add
          </button>
        </form>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto bg-white">
        {backlog === null ? (
          <div className="h-full flex items-center justify-center text-sm text-slate-400">Loading ideas...</div>
        ) : ideas.length === 0 ? (
          <div className="h-full flex items-center justify-center px-6 text-center">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">No ideas yet</p>
              <p className="text-xs text-slate-400">Capture ideas here, then promote them to the New Task flow.</p>
            </div>
          </div>
        ) : (
          <ul className="p-3 space-y-2">
            {ideas.map((idea) => {
              const isDragging = draggingIdeaId === idea.id
              const isDropTarget = dropTargetIdeaId === idea.id && !isDragging

              return (
                <li
                  key={idea.id}
                  draggable
                  onDragStart={(event) => {
                    dragIdeaIdRef.current = idea.id
                    setDraggingIdeaId(idea.id)
                    setDropTargetIdeaId(null)
                    setDropAtEnd(false)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', idea.id)
                  }}
                  onDragOver={(event) => {
                    if (!dragIdeaIdRef.current || dragIdeaIdRef.current === idea.id) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setDropAtEnd(false)
                    setDropTargetIdeaId(idea.id)
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    void handleDropOnIdea(idea.id)
                  }}
                  onDragEnd={clearDragState}
                  className={`border rounded-md px-3 py-2 transition-colors ${
                    isDragging
                      ? 'border-slate-300 bg-slate-50 opacity-60'
                      : isDropTarget
                        ? 'border-blue-400 bg-blue-50'
                        : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-slate-300 mt-0.5 cursor-grab">
                      <AppIcon icon={GripVertical} size="xs" />
                    </span>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{idea.text}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <button
                        type="button"
                        onClick={() => onPromoteIdea(idea)}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 font-medium"
                      >
                        Create Task
                        <AppIcon icon={ArrowRight} size="xs" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void onDeleteIdea(idea.id)
                        }}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200"
                        aria-label="Delete idea"
                        title="Delete idea"
                      >
                        <AppIcon icon={Trash2} size="xs" />
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}

            <li
              onDragOver={(event) => {
                if (!dragIdeaIdRef.current) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropTargetIdeaId(null)
                setDropAtEnd(true)
              }}
              onDrop={(event) => {
                event.preventDefault()
                void handleDropAtEnd()
              }}
              className={`h-6 rounded border border-dashed transition-colors ${
                dropAtEnd ? 'border-blue-400 bg-blue-50' : 'border-transparent'
              }`}
            />
          </ul>
        )}
      </div>
    </div>
  )
}
