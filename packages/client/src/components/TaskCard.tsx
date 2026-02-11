import type { Task, Phase } from '@pi-factory/shared'
import { PHASES, PHASE_DISPLAY_NAMES } from '@pi-factory/shared'

interface TaskCardProps {
  task: Task
  onClick: () => void
  onMove: (phase: Phase) => void
}

const TYPE_COLORS: Record<string, string> = {
  feature: 'border-blue-500',
  bug: 'border-red-500',
  refactor: 'border-purple-500',
  research: 'border-amber-500',
  spike: 'border-cyan-500',
}

const PRIORITY_ICONS: Record<string, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🔵',
  low: '⚪',
}

export function TaskCard({ task, onClick, onMove }: TaskCardProps) {
  const { frontmatter } = task
  const typeColor = TYPE_COLORS[frontmatter.type] || 'border-slate-400'

  // Get adjacent phases for quick move
  const currentIndex = PHASES.indexOf(frontmatter.phase)
  const prevPhase = currentIndex > 0 ? PHASES[currentIndex - 1] : null
  const nextPhase = currentIndex < PHASES.length - 1 ? PHASES[currentIndex + 1] : null

  return (
    <div
      onClick={onClick}
      className={`task-card ${typeColor} p-3 group`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs font-mono text-slate-500">{task.id}</span>
        <span className="text-xs" title={`Priority: ${frontmatter.priority}`}>
          {PRIORITY_ICONS[frontmatter.priority]}
        </span>
      </div>

      {/* Title */}
      <h3 className="font-medium text-sm text-slate-900 mb-2 line-clamp-2">
        {frontmatter.title}
      </h3>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <span className={`phase-badge phase-badge-${frontmatter.phase} text-[10px]`}>
            {PHASE_DISPLAY_NAMES[frontmatter.phase]}
          </span>
          {frontmatter.assigned && (
            <span className="text-slate-400">👤 {frontmatter.assigned}</span>
          )}
        </div>
        {frontmatter.estimatedEffort && (
          <span className="font-mono">{frontmatter.estimatedEffort}</span>
        )}
      </div>

      {/* Quick Actions (visible on hover) */}
      <div className="hidden group-hover:flex items-center gap-1 mt-2 pt-2 border-t border-slate-100">
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
        {nextPhase && (
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
      </div>
    </div>
  )
}
