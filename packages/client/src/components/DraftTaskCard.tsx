import { useState } from 'react'
import type { DraftTask } from '@pi-factory/shared'

interface DraftTaskCardProps {
  draft: DraftTask
  onPush: () => void
  onRemove: () => void
  onUpdate: (updates: Partial<DraftTask>) => void
}

const TYPE_COLORS: Record<string, string> = {
  feature: 'bg-blue-100 text-blue-700',
  bug: 'bg-red-100 text-red-700',
  refactor: 'bg-purple-100 text-purple-700',
  research: 'bg-yellow-100 text-yellow-700',
  spike: 'bg-orange-100 text-orange-700',
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-slate-100 text-slate-600',
  low: 'bg-slate-50 text-slate-400',
}

export function DraftTaskCard({ draft, onPush, onRemove, onUpdate }: DraftTaskCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(draft.title)
  const [editContent, setEditContent] = useState(draft.content)
  const [editCriteria, setEditCriteria] = useState(draft.acceptanceCriteria.join('\n'))

  const handleSave = () => {
    onUpdate({
      title: editTitle,
      content: editContent,
      acceptanceCriteria: editCriteria.split('\n').map(s => s.trim()).filter(Boolean),
    })
    setIsEditing(false)
  }

  const handleDiscard = () => {
    setEditTitle(draft.title)
    setEditContent(draft.content)
    setEditCriteria(draft.acceptanceCriteria.join('\n'))
    setIsEditing(false)
  }

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden hover:border-slate-300 transition-colors">
      {/* Header — always visible */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer"
        onClick={() => !isEditing && setIsExpanded(!isExpanded)}
      >
        <span className="text-[10px] font-semibold text-slate-400 uppercase">draft</span>
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="text-sm font-medium text-slate-800 w-full bg-transparent border-b border-blue-400 outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-sm font-medium text-slate-800 truncate block">
              {draft.title}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TYPE_COLORS[draft.type] || TYPE_COLORS.feature}`}>
            {draft.type}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${PRIORITY_COLORS[draft.priority] || PRIORITY_COLORS.medium}`}>
            {draft.priority}
          </span>
        </div>
      </div>

      {/* Expanded details */}
      {(isExpanded || isEditing) && (
        <div className="px-3 pb-3 border-t border-slate-100 pt-2 space-y-2">
          {/* Description */}
          {isEditing ? (
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full text-xs text-slate-600 bg-white border border-slate-200 rounded p-2 resize-none min-h-[80px] focus:outline-none focus:border-blue-400"
              placeholder="Description..."
            />
          ) : draft.content ? (
            <p className="text-xs text-slate-600 whitespace-pre-wrap">{draft.content.slice(0, 200)}{draft.content.length > 200 ? '...' : ''}</p>
          ) : null}

          {/* Acceptance criteria */}
          {isEditing ? (
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase">Acceptance Criteria</label>
              <textarea
                value={editCriteria}
                onChange={(e) => setEditCriteria(e.target.value)}
                className="w-full text-xs text-slate-600 bg-white border border-slate-200 rounded p-2 resize-none min-h-[60px] focus:outline-none focus:border-blue-400 mt-1"
                placeholder="One criterion per line..."
              />
            </div>
          ) : draft.acceptanceCriteria.length > 0 ? (
            <div>
              <span className="text-[10px] font-semibold text-slate-400 uppercase">AC ({draft.acceptanceCriteria.length})</span>
              <ul className="mt-1 space-y-0.5">
                {draft.acceptanceCriteria.slice(0, 5).map((c, i) => (
                  <li key={i} className="text-xs text-slate-500 flex items-start gap-1">
                    <span className="text-slate-300 shrink-0">•</span>
                    <span className="truncate">{c}</span>
                  </li>
                ))}
                {draft.acceptanceCriteria.length > 5 && (
                  <li className="text-xs text-slate-400 italic">+{draft.acceptanceCriteria.length - 5} more</li>
                )}
              </ul>
            </div>
          ) : null}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {isEditing ? (
              <>
                <button onClick={handleSave} className="text-xs px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 font-medium">Save</button>
                <button onClick={handleDiscard} className="text-xs px-2.5 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 font-medium">Discard</button>
              </>
            ) : (
              <>
                <button onClick={onPush} className="text-xs px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 font-medium">Push to backlog →</button>
                <button onClick={() => setIsEditing(true)} className="text-xs px-2.5 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 font-medium">Edit</button>
                <button onClick={onRemove} className="text-xs text-red-500 hover:text-red-700 ml-auto font-medium">Remove</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
