import { useState } from 'react'
import type { DraftTask } from '@pi-factory/shared'

interface DraftTaskCardProps {
  draft: DraftTask
  onPush: () => void
  onRemove: () => void
  onUpdate: (updates: Partial<DraftTask>) => void
}

export function DraftTaskCard({ draft, onPush, onRemove, onUpdate }: DraftTaskCardProps) {
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
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="text-[10px] font-semibold text-slate-400 uppercase shrink-0">draft</span>
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="text-sm font-medium text-slate-800 w-full bg-transparent border-b border-blue-400 outline-none"
            />
          ) : (
            <span className="text-sm font-medium text-slate-800">
              {draft.title}
            </span>
          )}
        </div>
      </div>

      {/* Content — always visible */}
      <div className="px-3 pb-3 space-y-2">
        {/* Description */}
        {isEditing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full text-xs text-slate-600 bg-white border border-slate-200 rounded p-2 resize-none min-h-[80px] focus:outline-none focus:border-blue-400"
            placeholder="Description..."
          />
        ) : draft.content ? (
          <p className="text-xs text-slate-600 whitespace-pre-wrap">{draft.content}</p>
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
              {draft.acceptanceCriteria.map((c, i) => (
                <li key={i} className="text-xs text-slate-500 flex items-start gap-1">
                  <span className="text-slate-300 shrink-0">•</span>
                  <span>{c}</span>
                </li>
              ))}
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
    </div>
  )
}
