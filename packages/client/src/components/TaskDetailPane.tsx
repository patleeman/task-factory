import { useState, useEffect } from 'react'
import type { Task, Phase, ActivityEntry } from '@pi-factory/shared'
import { PHASES, PHASE_DISPLAY_NAMES } from '@pi-factory/shared'
import { MarkdownEditor } from './MarkdownEditor'
import { TaskChat } from './TaskChat'
import type { AgentStreamState } from '../hooks/useAgentStreaming'
import ReactMarkdown from 'react-markdown'

type Tab = 'details' | 'chat'

interface TaskDetailPaneProps {
  task: Task
  workspaceId: string
  activity: ActivityEntry[]
  agentStream: AgentStreamState
  onClose: () => void
  onMove: (phase: Phase) => void
  onDelete?: () => void
  onSendMessage: (taskId: string, content: string) => void
  onSteer: (taskId: string, content: string) => void
  onFollowUp: (taskId: string, content: string) => void
}

export function TaskDetailPane({
  task,
  workspaceId,
  activity,
  agentStream,
  onClose,
  onMove,
  onDelete,
  onSendMessage,
  onSteer,
  onFollowUp,
}: TaskDetailPaneProps) {
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const [editedTitle, setEditedTitle] = useState(task.frontmatter.title)
  const [editedContent, setEditedContent] = useState(task.content)
  const [editedCriteria, setEditedCriteria] = useState(
    task.frontmatter.acceptanceCriteria.join('\n')
  )
  const { frontmatter } = task

  // Count unread-ish: messages for this task
  const taskMessageCount = activity.filter(
    (e) => e.taskId === task.id && e.type === 'chat-message'
  ).length

  // Reset edit state when task changes
  useEffect(() => {
    setIsEditing(false)
    setEditedTitle(task.frontmatter.title)
    setEditedContent(task.content)
    setEditedCriteria(task.frontmatter.acceptanceCriteria.join('\n'))
  }, [task.id])

  const qualityChecks = [
    { key: 'testsPass', label: 'Tests' },
    { key: 'lintPass', label: 'Lint' },
    { key: 'reviewDone', label: 'Review' },
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
          title: editedTitle,
          content: editedContent,
          acceptanceCriteria: editedCriteria
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
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
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors text-sm"
          >
            ←
          </button>
          <span className="font-mono text-xs text-slate-400 truncate max-w-[120px]">{task.id}</span>
          <span className={`phase-badge phase-badge-${frontmatter.phase}`}>
            {PHASE_DISPLAY_NAMES[frontmatter.phase]}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {canExecute && (
            <button
              onClick={isExecutingPhase ? handleStop : handleExecute}
              disabled={isExecuting}
              className={`btn text-xs py-1 px-2.5 ${
                isExecutingPhase
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {isExecuting
                ? '...'
                : isExecutingPhase
                ? '⏹ Stop'
                : '▶ Run'}
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setShowMoveMenu(!showMoveMenu)}
              className="btn btn-secondary text-xs py-1 px-2.5"
            >
              Move ▾
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
                    className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed first:rounded-t-lg last:rounded-b-lg"
                  >
                    <span className={`inline-block w-2 h-2 rounded-full mr-2 phase-dot-${phase}`} />
                    {PHASE_DISPLAY_NAMES[phase]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 shrink-0">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex-1 text-center py-2 text-sm font-medium transition-colors relative ${
            activeTab === 'chat'
              ? 'text-blue-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Chat
          {taskMessageCount > 0 && (
            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
              activeTab === 'chat'
                ? 'bg-blue-100 text-blue-600'
                : 'bg-slate-200 text-slate-500'
            }`}>
              {taskMessageCount}
            </span>
          )}
          {activeTab === 'chat' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('details')}
          className={`flex-1 text-center py-2 text-sm font-medium transition-colors relative ${
            activeTab === 'details'
              ? 'text-blue-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Details
          {activeTab === 'details' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
          )}
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'chat' ? (
        <TaskChat
          taskId={task.id}
          workspaceId={workspaceId}
          entries={activity}
          agentStream={agentStream}
          onSendMessage={(content) => onSendMessage(task.id, content)}
          onSteer={(content) => onSteer(task.id, content)}
          onFollowUp={(content) => onFollowUp(task.id, content)}
        />
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="p-5 space-y-5">
            {/* Title */}
            <div>
              {isEditing ? (
                <input
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  className="text-xl font-bold text-slate-900 w-full bg-transparent border-b-2 border-blue-400 outline-none pb-1"
                />
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <h1 className="text-xl font-bold text-slate-900 leading-tight">
                    {frontmatter.title}
                  </h1>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setIsEditing(true)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={handleDelete}
                      className="text-xs text-red-500 hover:text-red-700 font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Quality Gates */}
            <div className="flex items-center gap-3 py-2 px-3 bg-slate-50 rounded-lg">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Quality</span>
              <div className="flex items-center gap-3">
                {qualityChecks.map(({ key, label }) => {
                  const passed = frontmatter.qualityChecks[key as keyof typeof frontmatter.qualityChecks]
                  return (
                    <button
                      key={key}
                      onClick={() => toggleQualityCheck(key)}
                      className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
                        passed
                          ? 'text-green-700 hover:text-green-800'
                          : 'text-slate-400 hover:text-slate-600'
                      }`}
                      title={label}
                    >
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                        passed ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-400'
                      }`}>
                        {passed ? '✓' : '·'}
                      </span>
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Plan (generated during planning phase) */}
            {frontmatter.plan && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-blue-600 text-sm">📋</span>
                  <h3 className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                    Plan
                  </h3>
                  <span className="text-[10px] text-blue-400 ml-auto">
                    Generated {new Date(frontmatter.plan.generatedAt).toLocaleString()}
                  </span>
                </div>

                {/* Goal */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-600 mb-1">Goal</h4>
                  <p className="text-sm text-slate-800">{frontmatter.plan.goal}</p>
                </div>

                {/* Steps */}
                {frontmatter.plan.steps.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-600 mb-1">Steps</h4>
                    <ol className="space-y-1 list-decimal list-inside">
                      {frontmatter.plan.steps.map((step, i) => (
                        <li key={i} className="text-sm text-slate-700">{step}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Validation */}
                {frontmatter.plan.validation.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-600 mb-1">Validation</h4>
                    <ul className="space-y-1">
                      {frontmatter.plan.validation.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                          <span className="text-green-500 shrink-0 mt-0.5">✓</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Cleanup */}
                {frontmatter.plan.cleanup.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-600 mb-1">Cleanup</h4>
                    <ul className="space-y-1">
                      {frontmatter.plan.cleanup.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                          <span className="text-slate-400 shrink-0 mt-0.5">🧹</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Planning in progress indicator */}
            {frontmatter.phase === 'planning' && !frontmatter.plan && (
              <div className="flex items-center gap-3 py-3 px-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-amber-700 font-medium">
                  Planning agent is researching and generating a plan…
                </span>
              </div>
            )}

            {/* Acceptance Criteria */}
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Acceptance Criteria
              </h3>
              {isEditing ? (
                <MarkdownEditor
                  value={editedCriteria}
                  onChange={setEditedCriteria}
                  placeholder="One criterion per line"
                  minHeight="160px"
                />
              ) : frontmatter.acceptanceCriteria.length > 0 ? (
                <ul className="space-y-1.5">
                  {frontmatter.acceptanceCriteria.map((criteria, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="w-5 h-5 rounded border border-slate-300 flex items-center justify-center text-[10px] text-slate-400 shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-slate-700">{criteria}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400 italic">No acceptance criteria defined</p>
              )}
            </div>

            {/* Description */}
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Description
              </h3>
              {isEditing ? (
                <MarkdownEditor
                  value={editedContent}
                  onChange={setEditedContent}
                  placeholder="Task description in markdown..."
                  minHeight="400px"
                />
              ) : task.content ? (
                <div className="prose prose-slate prose-sm max-w-none">
                  <ReactMarkdown>{task.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm text-slate-400 italic">No description</p>
              )}
            </div>

            {/* Edit actions */}
            {isEditing && (
              <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
                <button
                  onClick={handleSaveEdit}
                  className="btn btn-primary text-sm py-1.5 px-4"
                >
                  Save Changes
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false)
                    setEditedTitle(task.frontmatter.title)
                    setEditedContent(task.content)
                    setEditedCriteria(task.frontmatter.acceptanceCriteria.join('\n'))
                  }}
                  className="btn btn-secondary text-sm py-1.5 px-4"
                >
                  Discard
                </button>
              </div>
            )}

            {/* Metadata */}
            <div className="text-xs text-slate-400 pt-4 border-t border-slate-100 space-y-1">
              <div className="flex justify-between">
                <span>Created</span>
                <span>{new Date(frontmatter.created).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Updated</span>
                <span>{new Date(frontmatter.updated).toLocaleString()}</span>
              </div>
              {frontmatter.branch && (
                <div className="flex justify-between">
                  <span>Branch</span>
                  <span className="font-mono">{frontmatter.branch}</span>
                </div>
              )}
              {frontmatter.prUrl && (
                <div className="flex justify-between">
                  <span>PR</span>
                  <a href={frontmatter.prUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                    View PR →
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
