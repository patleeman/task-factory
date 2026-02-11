import type { Task, Phase } from '@pi-factory/shared'
import { PHASES, PHASE_DISPLAY_NAMES, DEFAULT_WIP_LIMITS } from '@pi-factory/shared'
import { TaskCard } from './TaskCard'

interface KanbanBoardProps {
  tasksByPhase: Record<Phase, Task[]>
  onTaskClick: (task: Task) => void
  onMoveTask: (task: Task, toPhase: Phase) => void
  wipLimits?: Partial<Record<Phase, number | null>>
}

export function KanbanBoard({ tasksByPhase, onTaskClick, onMoveTask, wipLimits }: KanbanBoardProps) {
  const getWipLimit = (phase: Phase): number | null => {
    return wipLimits?.[phase] ?? DEFAULT_WIP_LIMITS[phase]
  }

  const isOverLimit = (phase: Phase): boolean => {
    const limit = getWipLimit(phase)
    if (limit === null) return false
    return (tasksByPhase[phase]?.length || 0) > limit
  }

  return (
    <div className="flex h-full gap-4 p-4 min-w-max">
      {PHASES.map((phase) => {
        const tasks = tasksByPhase[phase] || []
        const limit = getWipLimit(phase)
        const overLimit = isOverLimit(phase)

        return (
          <div
            key={phase}
            className={`flex flex-col w-72 rounded-lg border ${
              overLimit ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-100'
            }`}
          >
            {/* Column Header */}
            <div className={`column-header rounded-t-lg ${overLimit ? 'bg-red-100' : ''}`}>
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
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onClick={() => onTaskClick(task)}
                  onMove={(phase) => onMoveTask(task, phase)}
                />
              ))}
              {tasks.length === 0 && (
                <div className="text-center py-8 text-slate-400 text-sm">
                  No tasks
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
