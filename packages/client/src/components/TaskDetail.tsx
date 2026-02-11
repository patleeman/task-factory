import { useState } from 'react'
import type { Task, Phase } from '@pi-factory/shared'
import { PHASES, PHASE_DISPLAY_NAMES } from '@pi-factory/shared'
import ReactMarkdown from 'react-markdown'

interface TaskDetailProps {
  task: Task
  workspaceId: string
  onClose: () => void
  onMove: (phase: Phase) => void
  onDelete?: () => void
}

export function TaskDetail({ task, workspaceId, onClose, onMove, onDelete }: TaskDetailProps) {
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editedTask, setEditedTask] = useState(task)
  const { frontmatter } = task

  const qualityChecks = [
    { key: 'testsPass', label: 'Tests passing' },
    { key: 'lintPass', label: 'Lint clean' },
    { key: 'reviewDone', label: 'Code review' },
  ]

  const canExecute = frontmatter.phase === 'ready' || frontmatter.phase === 'executing'
  const isExecutingPhase = frontmatter.phase === 'executing'

  const handleExecute = async () => {
    setIsExecuting(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/tasks/${task.id}/execute`, {
        method: 'POST',
      })
    } catch (err) {
      console.error('Failed to execute task:', err)
    } finally {
      setIsExecuting(false)
    }
  }

  const handleStop = async () => {
    try {
      await fetch(`/api/workspaces/${workspaceId}/tasks/${task.id}/stop`, {
        method: 'POST',
      })
    } catch (err) {
      console.error('Failed to stop execution:', err)
    }
  }

  const toggleQualityCheck = async (key: string) => {
    const currentValue = frontmatter.qualityChecks[key as keyof typeof frontmatter.qualityChecks]
    try {
      await fetch(`/api/workspaces/${workspaceId}/tasks/${task.id}/quality`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: !currentValue }),
      })
    } catch (err) {
      console.error('Failed to update quality check:', err)
    }
  }

  const handleSaveEdit = async () => {
    try {
      await fetch(`/api/workspaces/${workspaceId}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editedTask.frontmatter.title,
          content: editedTask.content,
          acceptanceCriteria: editedTask.frontmatter.acceptanceCriteria,
          testingInstructions: editedTask.frontmatter.testingInstructions,
        }),
      })
      setIsEditing(false)
    } catch (err) {
      console.error('Failed to save task:', err)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this task?')) return
    try {
      await fetch(`/api/workspaces/${workspaceId}/tasks/${task.id}`, {
        method: 'DELETE',
      })
      onDelete?.()
      onClose()
    } catch (err) {
      console.error('Failed to delete task:', err)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600"
            >
              ← Back
            </button>
            <span className="font-mono text-sm text-slate-500">{task.id}</span>
          </div>
          <div className="flex items-center gap-2">
            {canExecute && (
              <button
                onClick={isExecutingPhase ? handleStop : handleExecute}
                disabled={isExecuting}
                className={`btn text-sm py-1.5 px-3 ${
                  isExecutingPhase
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {isExecuting
                  ? 'Starting...'
                  : isExecutingPhase
                  ? '⏹ Stop Execution'
                  : '▶ Execute Task'}
              </button>
            )}
            <span className={`phase-badge phase-badge-${frontmatter.phase}`}>
              {PHASE_DISPLAY_NAMES[frontmatter.phase]}
            </span>
            <div className="relative">
              <button
                onClick={() => setShowMoveMenu(!showMoveMenu)}
                className="btn btn-secondary text-sm py-1.5"
              >
                Move ▼
              </button>
              {showMoveMenu && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 min-w-[150px]">
                  {PHASES.map((phase) => (
                    <button
                      key={phase}
                      onClick={() => {
                        onMove(phase)
                        setShowMoveMenu(false)
                      }}
                      disabled={phase === frontmatter.phase}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {PHASE_DISPLAY_NAMES[phase]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[70vh]">
          {isEditing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
                <input
                  type="text"
                  value={editedTask.frontmatter.title}
                  onChange={(e) => setEditedTask({
                    ...editedTask,
                    frontmatter: { ...editedTask.frontmatter, title: e.target.value }
                  })}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  value={editedTask.content}
                  onChange={(e) => setEditedTask({ ...editedTask, content: e.target.value })}
                  className="input min-h-[100px]"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={handleSaveEdit} className="btn btn-primary">Save</button>
                <button onClick={() => setIsEditing(false)} className="btn btn-secondary">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between mb-6">
                <h1 className="text-2xl font-bold text-slate-900">
                  {frontmatter.title}
                </h1>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsEditing(true)}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    Edit
                  </button>
                  <button
                    onClick={handleDelete}
                    className="text-sm text-red-600 hover:text-red-800"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6 mb-6">
                {/* Acceptance Criteria */}
                <div className="bg-slate-50 rounded-lg p-4">
                  <h3 className="font-semibold text-sm text-slate-700 mb-3">
                    Acceptance Criteria
                  </h3>
                  {frontmatter.acceptanceCriteria.length > 0 ? (
                    <ul className="space-y-2">
                      {frontmatter.acceptanceCriteria.map((criteria, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            readOnly
                          />
                          <span className="text-slate-700">{criteria}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-400 italic">
                      No acceptance criteria defined
                    </p>
                  )}
                </div>

                {/* Testing Instructions */}
                <div className="bg-slate-50 rounded-lg p-4">
                  <h3 className="font-semibold text-sm text-slate-700 mb-3">
                    Testing Instructions
                  </h3>
                  {frontmatter.testingInstructions.length > 0 ? (
                    <ul className="space-y-2">
                      {frontmatter.testingInstructions.map((instruction, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <span className="text-slate-400">•</span>
                          <span className="text-slate-700">{instruction}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-400 italic">
                      No testing instructions defined
                    </p>
                  )}
                </div>
              </div>

              {/* Metadata */}
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="bg-slate-50 rounded-lg p-3">
                  <span className="text-xs text-slate-500 block">Type</span>
                  <span className="text-sm font-medium capitalize">{frontmatter.type}</span>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <span className="text-xs text-slate-500 block">Priority</span>
                  <span className="text-sm font-medium capitalize">{frontmatter.priority}</span>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <span className="text-xs text-slate-500 block">Complexity</span>
                  <span className="text-sm font-medium capitalize">
                    {frontmatter.complexity || 'Not set'}
                  </span>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <span className="text-xs text-slate-500 block">Estimated</span>
                  <span className="text-sm font-medium">
                    {frontmatter.estimatedEffort || 'Not set'}
                  </span>
                </div>
              </div>

              {/* Quality Gates */}
              <div className="bg-slate-50 rounded-lg p-4 mb-6">
                <h3 className="font-semibold text-sm text-slate-700 mb-3">
                  Quality Gates
                </h3>
                <div className="flex gap-6">
                  {qualityChecks.map(({ key, label }) => {
                    const passed = frontmatter.qualityChecks[key as keyof typeof frontmatter.qualityChecks]
                    return (
                      <button
                        key={key}
                        onClick={() => toggleQualityCheck(key)}
                        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                      >
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                          passed ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-400'
                        }`}>
                          {passed ? '✓' : '○'}
                        </span>
                        <span className={`text-sm ${passed ? 'text-green-700' : 'text-slate-500'}`}>
                          {label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Description */}
              {task.content && (
                <div className="prose prose-slate max-w-none">
                  <h3 className="font-semibold text-sm text-slate-700 mb-2">Description</h3>
                  <ReactMarkdown>{task.content}</ReactMarkdown>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
