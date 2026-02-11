import { useState } from 'react'
import type { Task, Phase } from '@pi-factory/shared'
import { PHASES, PHASE_DISPLAY_NAMES } from '@pi-factory/shared'

interface TaskCardProps {
  task: Task
  onClick: () => void
  onMove: (phase: Phase) => void
  onDragStartNotify?: () => void
  onDragEndNotify?: () => void
}

export function TaskCard({ task, onClick, onMove, onDragStartNotify, onDragEndNotify }: TaskCardProps) {
  const { frontmatter } = task
  const [isDragging, setIsDragging] = useState(false)

  // Get adjacent phases for quick move
  const currentIndex = PHASES.indexOf(frontmatter.phase)
  const prevPhase = currentIndex > 0 ? PHASES[currentIndex - 1] : null
  const nextPhase = currentIndex < PHASES.length - 1 ? PHASES[currentIndex + 1] : null

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/pi-factory-task', JSON.stringify({
      taskId: task.id,
      fromPhase: frontmatter.phase,
    }))
    e.dataTransfer.effectAllowed = 'move'
    requestAnimationFrame(() => setIsDragging(true))
    onDragStartNotify?.()
  }

  const handleDragEnd = () => {
    setIsDragging(false)
    onDragEndNotify?.()
  }

  return (
    <div
      onClick={onClick}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`task-card border-slate-300 p-3 group ${isDragging ? 'opacity-40' : ''}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs font-mono text-slate-500">{task.id}</span>
      </div>

      {/* Title */}
      <h3 className="font-medium text-sm text-slate-900 mb-2 line-clamp-2">
        {frontmatter.title}
      </h3>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span className={`phase-badge phase-badge-${frontmatter.phase} text-[10px]`}>
          {PHASE_DISPLAY_NAMES[frontmatter.phase]}
        </span>
        {frontmatter.assigned && (
          <span className="text-slate-400">👤 {frontmatter.assigned}</span>
        )}
      </div>

      {/* Quick Actions (visible on hover) */}
      <div className="hidden group-hover:flex items-center gap-1 mt-2 pt-2 border-t border-slate-100">
        {frontmatter.phase === 'complete' ? (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onMove('ready')
              }}
              className="text-xs px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-700"
            >
              ↩ Rework
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onMove('archived')
              }}
              className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-500 ml-auto"
            >
              📦 Archive
            </button>
          </>
        ) : (
          <>
            {prevPhase && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onMove(prevPhase)
                }}
                className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
              >
                ← {PHASE_DISPLAY_NAMES[prevPhase]}
              </button>
            )}
            {nextPhase && frontmatter.phase !== 'archived' && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onMove(nextPhase)
                }}
                className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 ml-auto"
              >
                {PHASE_DISPLAY_NAMES[nextPhase]} →
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
