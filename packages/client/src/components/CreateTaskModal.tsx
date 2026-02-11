import { useState } from 'react'
import { TASK_TYPES, PRIORITIES, COMPLEXITIES } from '@pi-factory/shared'

interface CreateTaskModalProps {
  onClose: () => void
  onSubmit: (data: any) => void
}

export function CreateTaskModal({ onClose, onSubmit }: CreateTaskModalProps) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState('feature')
  const [priority, setPriority] = useState('medium')
  const [complexity, setComplexity] = useState('medium')
  const [effort, setEffort] = useState('')
  const [content, setContent] = useState('')
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
  const [testingInstructions, setTestingInstructions] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      title,
      type,
      priority,
      complexity,
      estimatedEffort: effort,
      content,
      acceptanceCriteria: acceptanceCriteria.split('\n').filter(Boolean),
      testingInstructions: testingInstructions.split('\n').filter(Boolean),
    })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold">Create New Task</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          </div>

          {/* Form */}
          <div className="p-6 space-y-4 overflow-y-auto max-h-[60vh]">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input"
                placeholder="What needs to be done?"
                required
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Type
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="select"
                >
                  {TASK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="select"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Complexity
                </label>
                <select
                  value={complexity}
                  onChange={(e) => setComplexity(e.target.value)}
                  className="select"
                >
                  {COMPLEXITIES.map((c) => (
                    <option key={c} value={c}>
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Estimated Effort
              </label>
              <input
                type="text"
                value={effort}
                onChange={(e) => setEffort(e.target.value)}
                className="input"
                placeholder="e.g., 4h, 2d"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Description
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="input min-h-[100px]"
                placeholder="Describe the task..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Acceptance Criteria (one per line)
                </label>
                <textarea
                  value={acceptanceCriteria}
                  onChange={(e) => setAcceptanceCriteria(e.target.value)}
                  className="input min-h-[100px]"
                  placeholder="- User can login\n- Session persists"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Testing Instructions (one per line)
                </label>
                <textarea
                  value={testingInstructions}
                  onChange={(e) => setTestingInstructions(e.target.value)}
                  className="input min-h-[100px]"
                  placeholder="- Run npm test\n- Check UI"
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title}
              className="btn btn-primary"
            >
              Create Task
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
