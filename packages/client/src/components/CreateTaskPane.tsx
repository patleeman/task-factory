import { useState } from 'react'
import { MarkdownEditor } from './MarkdownEditor'

interface CreateTaskPaneProps {
  onCancel: () => void
  onSubmit: (data: { content: string; acceptanceCriteria: string[] }) => void
}

export function CreateTaskPane({ onCancel, onSubmit }: CreateTaskPaneProps) {
  const [content, setContent] = useState('')
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!content.trim()) return
    setIsSubmitting(true)
    await onSubmit({
      content,
      acceptanceCriteria: acceptanceCriteria
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    })
    setIsSubmitting(false)
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600 transition-colors text-sm"
          >
            ← Back
          </button>
          <h2 className="font-semibold text-sm text-slate-800">New Task</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="btn btn-secondary text-sm py-1.5 px-3"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!content.trim() || isSubmitting}
            className="btn btn-primary text-sm py-1.5 px-3 disabled:opacity-50"
          >
            {isSubmitting ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </div>

      {/* Content — flex column, editors fill available space */}
      <div className="flex-1 flex flex-col min-h-0 p-5 gap-4">
        {/* Description — takes 2/3 of space */}
        <div className="flex flex-col flex-[2] min-h-0">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 shrink-0">
            Task Description
          </label>
          <MarkdownEditor
            value={content}
            onChange={setContent}
            placeholder="Describe what needs to be done..."
            autoFocus
            fill
          />
        </div>

        {/* Acceptance Criteria — takes 1/3 of space */}
        <div className="flex flex-col flex-1 min-h-0">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 shrink-0">
            Acceptance Criteria
          </label>
          <MarkdownEditor
            value={acceptanceCriteria}
            onChange={setAcceptanceCriteria}
            placeholder="One criterion per line"
            fill
          />
        </div>
      </div>
    </div>
  )
}
