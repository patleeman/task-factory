import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { Task, Phase } from '@pi-factory/shared'
import { PHASE_DISPLAY_NAMES } from '@pi-factory/shared'

interface PipelineBarProps {
  tasks: Task[]
  runningTaskIds: ReadonlySet<string>
  selectedTaskId: string | null
  onTaskClick: (task: Task) => void
  onMoveTask: (task: Task, toPhase: Phase) => void
  onReorderTasks?: (phase: Phase, taskIds: string[]) => void
  onCreateTask: () => void
  archivedTasks: Task[]
}

// Tracks where a dragged card would be inserted within the same phase
interface DropTarget {
  phase: Phase
  index: number // insertion index (0 = before first card, tasks.length = after last)
}

const VISIBLE_PHASES: Phase[] = ['backlog', 'ready', 'executing', 'complete']

// Card background colors per phase
const PHASE_BG: Record<string, string> = {
  backlog: 'bg-slate-100',
  ready: 'bg-blue-100',
  executing: 'bg-orange-100 pipeline-card-executing',
  complete: 'bg-emerald-100',
}

// Empty placeholder background
const PHASE_EMPTY_BG: Record<string, string> = {
  backlog: 'bg-slate-50',
  ready: 'bg-blue-50',
  executing: 'bg-orange-50',
  complete: 'bg-emerald-50',
}

// Phase label colors
const PHASE_LABEL_COLOR: Record<string, string> = {
  backlog: 'text-slate-400',
  ready: 'text-blue-500',
  executing: 'text-orange-600',
  complete: 'text-emerald-600',
}

const DRAG_MIME = 'application/pi-factory-task'

export function PipelineBar({
  tasks,
  runningTaskIds,
  selectedTaskId,
  onTaskClick,
  onMoveTask,
  onReorderTasks,
  onCreateTask,
  archivedTasks,
}: PipelineBarProps) {
  const [dragOverPhase, setDragOverPhase] = useState<Phase | null>(null)
  const [dragOverArchive, setDragOverArchive] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const dragSourceRef = useRef<{ taskId: string; fromPhase: Phase } | null>(null)
  // Mirror dropTarget in a ref so the drop handler always reads the latest value,
  // avoiding stale-closure issues when React hasn't committed the latest re-render.
  const dropTargetRef = useRef<DropTarget | null>(null)
  const archiveRef = useRef<HTMLDivElement>(null)

  // Group tasks by phase, sorted by order (memoized to avoid recreating on every render)
  const tasksByPhase = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const phase of VISIBLE_PHASES) {
      map[phase] = tasks
        .filter(t => t.frontmatter.phase === phase)
        .sort((a, b) => (a.frontmatter.order ?? 0) - (b.frontmatter.order ?? 0))
    }
    return map
  }, [tasks])

  const getAdvanceAction = (task: Task): { label: string; toPhase: Phase } | null => {
    switch (task.frontmatter.phase) {
      case 'backlog': return { label: 'Ready →', toPhase: 'ready' }
      default: return null
    }
  }

  const findTask = useCallback((taskId: string) => {
    return [...tasks, ...archivedTasks].find(t => t.id === taskId)
  }, [tasks, archivedTasks])

  // Compute insertion index based on cursor X relative to cards (horizontal layout)
  const computeDropIndex = useCallback((e: React.DragEvent): number => {
    const container = e.currentTarget as HTMLElement
    const cardElements = container.querySelectorAll('[data-task-id]')
    const mouseX = e.clientX

    for (let i = 0; i < cardElements.length; i++) {
      const rect = cardElements[i].getBoundingClientRect()
      const midX = rect.left + rect.width / 2
      if (mouseX < midX) {
        return i
      }
    }

    return cardElements.length
  }, [])

  // Helper to update drop target only when it actually changed (avoids unnecessary re-renders)
  const updateDropTarget = useCallback((dt: DropTarget | null) => {
    dropTargetRef.current = dt
    setDropTarget(prev => {
      if (prev === dt) return prev
      if (prev && dt && prev.phase === dt.phase && prev.index === dt.index) return prev
      return dt
    })
  }, [])

  const handlePhaseDragOver = useCallback((e: React.DragEvent, phase: Phase) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverPhase(prev => prev === phase ? prev : phase)

    // Only compute within-phase drop target when dragging from the same phase
    const source = dragSourceRef.current
    if (source && source.fromPhase === phase) {
      const index = computeDropIndex(e)
      updateDropTarget({ phase, index })
    } else {
      updateDropTarget(null)
    }
  }, [computeDropIndex, updateDropTarget])

  const handlePhaseDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverPhase(null)
      updateDropTarget(null)
    }
  }, [updateDropTarget])

  const handlePhaseDrop = useCallback((e: React.DragEvent, toPhase: Phase) => {
    e.preventDefault()
    // Read from ref to get the latest value, avoiding stale-closure issues
    const currentDropTarget = dropTargetRef.current
    setDragOverPhase(null)
    updateDropTarget(null)

    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    try {
      const { taskId, fromPhase } = JSON.parse(raw)
      const task = findTask(taskId)
      if (!task) return

      if (fromPhase === toPhase && onReorderTasks) {
        // Within-phase reorder
        if (!currentDropTarget || currentDropTarget.phase !== toPhase) return

        const phaseTasks = tasksByPhase[toPhase] || []
        const currentIndex = phaseTasks.findIndex(t => t.id === taskId)
        if (currentIndex === -1) return

        let insertAt = currentDropTarget.index
        // If dragging right (down in list), adjust because the dragged item
        // will be removed first, shifting indices
        if (currentIndex < insertAt) insertAt--
        if (currentIndex === insertAt) return // No change — same position

        // Build new order
        const newOrder = phaseTasks.filter(t => t.id !== taskId)
        newOrder.splice(insertAt, 0, task)
        onReorderTasks(toPhase, newOrder.map(t => t.id))
      } else if (fromPhase !== toPhase) {
        // Cross-phase move
        onMoveTask(task, toPhase)
      }
    } catch { /* ignore */ }
  }, [findTask, onMoveTask, onReorderTasks, tasksByPhase, updateDropTarget])

  const handleCardDragStart = useCallback((taskId: string, fromPhase: Phase) => {
    dragSourceRef.current = { taskId, fromPhase }
  }, [])

  const handleCardDragEnd = useCallback(() => {
    dragSourceRef.current = null
    setDragOverPhase(null)
    updateDropTarget(null)
  }, [updateDropTarget])

  const handleArchiveDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOverArchive(false)
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    try {
      const { taskId } = JSON.parse(raw)
      const task = findTask(taskId)
      if (task) onMoveTask(task, 'archived')
    } catch { /* ignore */ }
  }, [findTask, onMoveTask])

  return (
    <div className="flex items-stretch justify-start min-h-[148px] h-full overflow-x-auto pipeline-scroll">
      {VISIBLE_PHASES.map(phase => {
        const phaseTasks = tasksByPhase[phase]
        const isEmpty = phaseTasks.length === 0
        const isDragOver = dragOverPhase === phase
        const isBacklog = phase === 'backlog'

        return (
          <div
            key={phase}
            onDragOver={(e) => handlePhaseDragOver(e, phase)}
            onDragLeave={handlePhaseDragLeave}
            onDrop={(e) => handlePhaseDrop(e, phase)}
            className={`flex flex-col items-center py-2 px-2 transition-colors ${
              isDragOver ? 'bg-blue-50/60' : ''
            }`}
          >
            {/* Phase label */}
            <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${PHASE_LABEL_COLOR[phase]}`}>
              {PHASE_DISPLAY_NAMES[phase]}
            </div>

            {/* Cards or empty placeholder */}
            <div className="flex items-center gap-0">
              {isEmpty ? (
                <div
                  onClick={isBacklog ? onCreateTask : undefined}
                  className={`w-[190px] h-[112px] rounded-xl border border-dashed flex items-center justify-center transition-colors ${
                    isDragOver
                      ? 'border-blue-400 bg-blue-100/50'
                      : `border-slate-200 ${PHASE_EMPTY_BG[phase]}`
                  } ${isBacklog ? 'cursor-pointer hover:border-slate-400 hover:bg-slate-100' : ''}`}
                >
                  <span className={`text-xs ${isDragOver ? 'text-blue-500' : 'text-slate-300'}`}>
                    {isDragOver ? 'Drop here' : isBacklog ? '+ New Task' : 'Empty'}
                  </span>
                </div>
              ) : (
                <>
                  {phaseTasks.map((task, i) => {
                    const isSamePhase = dragSourceRef.current?.fromPhase === phase
                    const showIndicatorBefore =
                      isDragOver &&
                      isSamePhase &&
                      dropTarget?.phase === phase &&
                      dropTarget.index === i &&
                      dragSourceRef.current?.taskId !== task.id

                    return (
                      <div key={task.id} className="flex items-center" data-task-id={task.id}>
                        {showIndicatorBefore && <VerticalDropIndicator />}
                        <div className="px-1">
                          <PipelineCard
                            task={task}
                            isRunning={runningTaskIds.has(task.id)}
                            isSelected={task.id === selectedTaskId}
                            advanceAction={getAdvanceAction(task)}
                            onTaskClick={onTaskClick}
                            onMoveTask={onMoveTask}
                            onDragStartNotify={() => handleCardDragStart(task.id, phase)}
                            onDragEndNotify={handleCardDragEnd}
                          />
                        </div>
                      </div>
                    )
                  })}
                  {/* Drop indicator after last card */}
                  {isDragOver &&
                    dragSourceRef.current?.fromPhase === phase &&
                    dropTarget?.phase === phase &&
                    dropTarget.index === phaseTasks.length &&
                    phaseTasks.length > 0 && (
                      <VerticalDropIndicator />
                    )}
                  {isBacklog && (
                    <div
                      onClick={onCreateTask}
                      className="shrink-0 w-[80px] h-[112px] rounded-xl border border-dashed border-slate-200 flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors hover:border-slate-400 hover:bg-slate-100 mx-1"
                    >
                      <span className="text-lg text-slate-300">+</span>
                      <span className="text-[10px] text-slate-400 font-medium">New Task</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })}

      {/* Archive column — skeleton drop target + popover */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOverArchive(true) }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOverArchive(false)
          }
        }}
        onDrop={handleArchiveDrop}
        className={`flex flex-col items-center py-2 px-2 relative transition-colors ${
          dragOverArchive ? 'bg-blue-50/60' : ''
        }`}
      >
        <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-slate-400">
          Archived
        </div>
        <div
          ref={archiveRef}
          onClick={() => setShowArchived(!showArchived)}
          className={`w-[190px] h-[112px] rounded-xl border border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors ${
            dragOverArchive
              ? 'border-blue-400 bg-blue-100/50'
              : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100'
          }`}
        >
          <span className="text-xs text-slate-400 font-semibold uppercase">Archive</span>
          <span className={`text-xs ${dragOverArchive ? 'text-blue-500' : 'text-slate-400'}`}>
            {dragOverArchive ? 'Drop to archive' : `${archivedTasks.length} archived`}
          </span>
        </div>

        {/* Archived tasks popover — portal to escape overflow clipping */}
        {showArchived && (
          <ArchivedPopover
            anchorRef={archiveRef}
            archivedTasks={archivedTasks}
            onTaskClick={(task) => { onTaskClick(task); setShowArchived(false) }}
            onRestore={(task) => { onMoveTask(task, 'backlog'); setShowArchived(false) }}
            onClose={() => setShowArchived(false)}
          />
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Vertical Drop Indicator (shown between cards during within-phase reorder)
// =============================================================================

function VerticalDropIndicator() {
  return (
    <div className="flex flex-col items-center gap-0.5 px-0.5 shrink-0">
      <div className="w-2 h-2 rounded-full bg-blue-500" />
      <div className="w-0.5 h-20 bg-blue-500 rounded-full" />
      <div className="w-2 h-2 rounded-full bg-blue-500" />
    </div>
  )
}

// =============================================================================
// Pipeline Card
// =============================================================================

function PipelineCard({
  task,
  isRunning,
  isSelected,
  advanceAction,
  onTaskClick,
  onMoveTask,
  onDragStartNotify,
  onDragEndNotify,
}: {
  task: Task
  isRunning: boolean
  isSelected: boolean
  advanceAction?: { label: string; toPhase: Phase } | null
  onTaskClick: (task: Task) => void
  onMoveTask: (task: Task, toPhase: Phase) => void
  onDragStartNotify?: () => void
  onDragEndNotify?: () => void
}) {
  const phase = task.frontmatter.phase
  const isExecuting = phase === 'executing'
  const isComplete = phase === 'complete'
  const isAgentRunning = isRunning
  // Backlog tasks with a completed plan get a distinct color to signal "ready to promote"
  const hasPlan = phase === 'backlog' && !!task.frontmatter.plan && task.frontmatter.planningStatus !== 'running'
  const phaseBg = hasPlan ? 'bg-indigo-100' : (PHASE_BG[phase] || PHASE_BG.backlog)

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({
      taskId: task.id,
      fromPhase: phase,
    }))
    e.dataTransfer.effectAllowed = 'move'
    onDragStartNotify?.()
  }

  const handleDragEnd = () => {
    onDragEndNotify?.()
  }

  return (
    <div
      onClick={() => onTaskClick(task)}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`shrink-0 w-[190px] h-[112px] rounded-xl p-3 flex flex-col justify-between cursor-pointer transition-all ${
        isSelected
          ? 'ring-2 ring-blue-400 bg-white shadow-md'
          : phaseBg
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          {isAgentRunning && (
            <span className="w-3.5 h-3.5 shrink-0 relative flex items-center justify-center">
              <span className="absolute inset-0 rounded-full animate-ping opacity-40 bg-orange-400" />
              <span className="relative w-2 h-2 rounded-full bg-orange-500" />
            </span>
          )}
          <span className="text-xs font-mono text-slate-400 truncate">{task.id}</span>
        </div>
        <div className="text-sm font-medium text-slate-800 line-clamp-2 leading-snug mt-1">
          {task.frontmatter.title}
        </div>
      </div>
      <div className="flex items-center justify-between gap-1.5">
        <span className={`text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1.5 ${
          isExecuting ? 'text-orange-600'
          : isComplete ? 'text-emerald-600'
          : phase === 'ready' ? 'text-blue-600'
          : hasPlan ? 'text-indigo-600'
          : 'text-slate-400'
        }`}>
          {isAgentRunning && (
            <span className="inline-block w-3 h-3 rounded-full border-[1.5px] border-t-transparent animate-spin border-orange-500" />
          )}
          {hasPlan ? 'Planned' : PHASE_DISPLAY_NAMES[phase]}
        </span>
        {advanceAction && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onMoveTask(task, advanceAction.toPhase)
            }}
            className="text-[11px] px-2 py-0.5 rounded bg-white/60 hover:bg-white text-slate-600 font-medium transition-colors"
          >
            {advanceAction.label}
          </button>
        )}

      </div>
    </div>
  )
}

// =============================================================================
// Archived Popover — portaled to body to escape overflow clipping
// =============================================================================

function ArchivedPopover({
  anchorRef,
  archivedTasks,
  onTaskClick,
  onRestore,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>
  archivedTasks: Task[]
  onTaskClick: (task: Task) => void
  onRestore: (task: Task) => void
  onClose: () => void
}) {
  const [pos, setPos] = useState<{ right: number; bottom: number } | null>(null)

  useEffect(() => {
    const update = () => {
      if (!anchorRef.current) return
      const rect = anchorRef.current.getBoundingClientRect()
      const right = Math.max(16, window.innerWidth - (rect.left + rect.width))
      const bottom = Math.max(16, window.innerHeight - (rect.top - 8))
      setPos({ right, bottom })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [anchorRef])

  if (!pos) return null

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div
        className="fixed z-[9999] w-72 max-h-80 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden"
        style={{
          bottom: `${pos.bottom}px`,
          right: `${pos.right}px`,
        }}
      >
        <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
          <span className="text-xs font-semibold text-slate-600">
            Archived Tasks ({archivedTasks.length})
          </span>
        </div>
        {archivedTasks.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-slate-400">
            No archived tasks
          </div>
        ) : (
          <div className="overflow-y-auto max-h-64">
            {archivedTasks.map(task => (
              <div
                key={task.id}
                className="flex items-center gap-1 px-3 py-2.5 hover:bg-slate-50 border-b border-slate-50 last:border-0 transition-colors"
              >
                <button
                  onClick={() => onTaskClick(task)}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="text-[10px] font-mono text-slate-400">{task.id}</div>
                  <div className="text-xs text-slate-700 truncate">{task.frontmatter.title}</div>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onRestore(task) }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-blue-100 text-slate-500 hover:text-blue-600 transition-colors shrink-0"
                >
                  ↩ Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>,
    document.body
  )
}
