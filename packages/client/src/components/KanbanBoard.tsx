import { useState, useCallback, useRef, useMemo } from 'react'
import type { Task, Phase } from '@pi-factory/shared'
import { PHASES, PHASE_DISPLAY_NAMES, DEFAULT_WIP_LIMITS } from '@pi-factory/shared'
import { TaskCard } from './TaskCard'

interface KanbanBoardProps {
  tasksByPhase: Record<Phase, Task[]>
  onTaskClick: (task: Task) => void
  onMoveTask: (task: Task, toPhase: Phase) => void
  onReorderTasks: (phase: Phase, taskIds: string[]) => void
  onCreateTask: () => void
  wipLimits?: Partial<Record<Phase, number | null>>
}

// Tracks where a dragged card would be inserted
interface DropTarget {
  phase: Phase
  index: number // insertion index (0 = before first card, tasks.length = after last)
}

const DRAG_MIME = 'application/pi-factory-task'

export function KanbanBoard({ tasksByPhase, onTaskClick, onMoveTask, onReorderTasks, onCreateTask, wipLimits }: KanbanBoardProps) {
  const [dragOverPhase, setDragOverPhase] = useState<Phase | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const dropTargetRef = useRef<DropTarget | null>(null)
  const dragSourceRef = useRef<{ taskId: string; fromPhase: Phase } | null>(null)

  const getWipLimit = (phase: Phase): number | null => {
    return wipLimits?.[phase] ?? DEFAULT_WIP_LIMITS[phase]
  }

  const isOverLimit = (phase: Phase): boolean => {
    const limit = getWipLimit(phase)
    if (limit === null) return false
    return (tasksByPhase[phase]?.length || 0) > limit
  }

  const findTaskById = useCallback((taskId: string): Task | undefined => {
    for (const phase of PHASES) {
      const found = tasksByPhase[phase]?.find(t => t.id === taskId)
      if (found) return found
    }
    return undefined
  }, [tasksByPhase])

  // Compute insertion index based on cursor Y relative to cards in the column
  const computeDropIndex = useCallback((e: React.DragEvent, _phase: Phase): number => {
    const column = e.currentTarget as HTMLElement
    const cardElements = column.querySelectorAll('[data-task-id]')
    const mouseY = e.clientY

    for (let i = 0; i < cardElements.length; i++) {
      const rect = cardElements[i].getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      if (mouseY < midY) {
        return i
      }
    }

    return cardElements.length
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, phase: Phase) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverPhase(phase)

    const index = computeDropIndex(e, phase)
    setDropTarget({ phase, index })
  }, [computeDropIndex])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null
    const currentTarget = e.currentTarget as HTMLElement
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      setDragOverPhase(null)
      setDropTarget(null)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, toPhase: Phase) => {
    e.preventDefault()
    const currentDropTarget = dropTarget
    setDragOverPhase(null)
    setDropTarget(null)

    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return

    try {
      const { taskId, fromPhase } = JSON.parse(raw)
      const task = findTaskById(taskId)
      if (!task) return

      if (fromPhase === toPhase) {
        // Within-column reorder
        if (!currentDropTarget || currentDropTarget.phase !== toPhase) return

        const tasks = tasksByPhase[toPhase] || []
        const currentIndex = tasks.findIndex(t => t.id === taskId)
        if (currentIndex === -1) return

        let insertAt = currentDropTarget.index
        // If dragging down, the insertion index needs adjustment since the dragged
        // item will be removed first
        if (currentIndex < insertAt) insertAt--
        if (currentIndex === insertAt) return // No change

        // Build new order
        const newOrder = tasks.filter(t => t.id !== taskId)
        newOrder.splice(insertAt, 0, task)
        onReorderTasks(toPhase, newOrder.map(t => t.id))
      } else {
        // Cross-column move
        onMoveTask(task, toPhase)
      }
    } catch {
      // Invalid drag data, ignore
    }
  }, [findTaskById, onMoveTask, onReorderTasks, tasksByPhase, dropTarget])

  // Called from TaskCard onDragStart — we stash the source info for drop indicator logic
  const handleCardDragStart = useCallback((taskId: string, fromPhase: Phase) => {
    dragSourceRef.current = { taskId, fromPhase }
  }, [])

  const handleCardDragEnd = useCallback(() => {
    dragSourceRef.current = null
    setDragOverPhase(null)
    setDropTarget(null)
  }, [])

  return (
    <div className="flex h-full gap-4 p-4 min-w-max">
      {PHASES.map((phase) => {
        const tasks = tasksByPhase[phase] || []
        const limit = getWipLimit(phase)
        const overLimit = isOverLimit(phase)
        const isDragTarget = dragOverPhase === phase
        const isArchived = phase === 'archived'

        return (
          <div
            key={phase}
            onDragOver={(e) => handleDragOver(e, phase)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, phase)}
            className={`flex flex-col ${isArchived ? 'w-56' : 'w-72'} rounded-lg transition-colors duration-150 ${
              isDragTarget
                ? 'border-2 border-blue-400 bg-blue-50 ring-2 ring-blue-200'
                : overLimit
                  ? 'border border-red-300 bg-red-50'
                  : isArchived
                    ? 'border border-slate-200 bg-slate-50 opacity-75'
                    : 'border border-slate-200 bg-slate-100'
            }`}
          >
            {/* Column Header */}
            <div className={`column-header rounded-t-lg ${
              isDragTarget ? 'bg-blue-100' : overLimit ? 'bg-red-100' : ''
            }`}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full phase-dot-${phase}`} />
                <span className="font-semibold text-sm text-slate-700">
                  {PHASE_DISPLAY_NAMES[phase]}
                </span>
              </div>
              <div className={`text-xs font-medium ${overLimit ? 'text-red-600' : 'text-slate-500'}`}>
                {tasks.length}
                {limit !== null && `/${limit}`}
              </div>
            </div>

            {/* Task List */}
            <div className={`flex-1 overflow-y-auto p-2 space-y-0 min-h-[80px] ${
              isDragTarget && tasks.length === 0 ? 'flex items-center justify-center' : ''
            }`}>
              {phase === 'executing' ? (
                <ExecutingSlots
                  tasks={tasks}
                  slotCount={limit ?? undefined}
                  isDragTarget={isDragTarget}
                  onTaskClick={onTaskClick}
                  onMoveTask={onMoveTask}
                  onCardDragStart={handleCardDragStart}
                  onCardDragEnd={handleCardDragEnd}
                />
              ) : (
                <>
                  {tasks.map((task, i) => {
                    const showIndicatorBefore =
                      isDragTarget &&
                      dropTarget?.phase === phase &&
                      dropTarget.index === i &&
                      dragSourceRef.current?.taskId !== task.id

                    return (
                      <div key={task.id} data-task-id={task.id}>
                        {showIndicatorBefore && <DropIndicator />}
                        <div className="py-1">
                          <TaskCard
                            task={task}
                            onClick={() => onTaskClick(task)}
                            onMove={(phase) => onMoveTask(task, phase)}
                            onDragStartNotify={() => handleCardDragStart(task.id, phase)}
                            onDragEndNotify={handleCardDragEnd}
                          />
                        </div>
                      </div>
                    )
                  })}
                  {/* Drop indicator after last card */}
                  {isDragTarget &&
                    dropTarget?.phase === phase &&
                    dropTarget.index === tasks.length &&
                    tasks.length > 0 && (
                      <DropIndicator />
                    )}
                  {tasks.length === 0 && phase !== 'backlog' && (
                    <div className={`text-center py-8 text-sm ${
                      isDragTarget ? 'text-blue-500 font-medium' : 'text-slate-400'
                    }`}>
                      {isDragTarget ? 'Drop here' : 'No tasks'}
                    </div>
                  )}
                  {phase === 'backlog' && (
                    <>
                      {tasks.length === 0 && isDragTarget && (
                        <div className="text-center py-8 text-sm text-blue-500 font-medium">
                          Drop here
                        </div>
                      )}
                      <button
                        onClick={onCreateTask}
                        className="w-full py-2 px-3 border-2 border-dashed border-slate-300 rounded-lg text-sm text-slate-500 hover:border-safety-orange hover:text-safety-orange transition-colors"
                      >
                        + New Task
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// =============================================================================
// Drop Indicator
// =============================================================================

function DropIndicator() {
  return (
    <div className="flex items-center gap-1 py-0.5">
      <div className="w-2 h-2 rounded-full bg-blue-500" />
      <div className="flex-1 h-0.5 bg-blue-500 rounded-full" />
      <div className="w-2 h-2 rounded-full bg-blue-500" />
    </div>
  )
}

// =============================================================================
// Executing Slots
// =============================================================================

function ExecutingSlots({
  tasks,
  slotCount,
  isDragTarget,
  onTaskClick,
  onMoveTask,
  onCardDragStart,
  onCardDragEnd,
}: {
  tasks: Task[]
  slotCount?: number
  isDragTarget: boolean
  onTaskClick: (task: Task) => void
  onMoveTask: (task: Task, toPhase: Phase) => void
  onCardDragStart: (taskId: string, phase: Phase) => void
  onCardDragEnd: () => void
}) {
  const slots = Math.max(slotCount ?? 1, tasks.length)

  return (
    <>
      {Array.from({ length: slots }, (_, i) => {
        const task = tasks[i]

        if (task) {
          return (
            <div key={task.id} className="py-1" data-task-id={task.id}>
              <TaskCard
                task={task}
                onClick={() => onTaskClick(task)}
                onMove={(phase) => onMoveTask(task, phase)}
                onDragStartNotify={() => onCardDragStart(task.id, 'executing')}
                onDragEndNotify={onCardDragEnd}
              />
            </div>
          )
        }

        return (
          <div
            key={`slot-${i}`}
            className={`rounded-lg border-2 border-dashed px-3 py-6 text-center transition-colors my-1 ${
              isDragTarget
                ? 'border-blue-400 bg-blue-50/50 text-blue-500'
                : 'border-slate-300 text-slate-400'
            }`}
          >
            <div className="text-lg mb-1 opacity-50">⏳</div>
            <div className="text-xs font-medium">
              {isDragTarget ? 'Drop here' : 'Available'}
            </div>
          </div>
        )
      })}
    </>
  )
}
