import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Task, Workspace, ActivityEntry, Phase, QueueStatus } from '@pi-factory/shared'
import { api } from '../api'
import { PipelineBar } from './PipelineBar'
import { TaskDetailPane } from './TaskDetailPane'
import { CreateTaskPane } from './CreateTaskPane'
import { ActivityLog } from './ActivityLog'
import { ResizeHandle } from './ResizeHandle'
import { useWebSocket } from '../hooks/useWebSocket'
import { useAgentStreaming } from '../hooks/useAgentStreaming'

const RIGHT_PANE_MIN = 280
const RIGHT_PANE_MAX = 700
const RIGHT_PANE_DEFAULT = 380

type MainPaneMode =
  | { type: 'empty' }
  | { type: 'task-detail'; task: Task }
  | { type: 'create-task' }

export function WorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()

  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [mainPane, setMainPane] = useState<MainPaneMode>({ type: 'empty' })
  const [rightPaneWidth, setRightPaneWidth] = useState(RIGHT_PANE_DEFAULT)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null)
  const [queueToggling, setQueueToggling] = useState(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const selectedTask = mainPane.type === 'task-detail' ? mainPane.task : null
  const selectedTaskRef = useRef(selectedTask)
  selectedTaskRef.current = selectedTask
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  const { subscribe, isConnected } = useWebSocket(workspaceId || null)
  const agentStream = useAgentStreaming(selectedTask?.id || null, subscribe)

  // Derived data
  const archivedTasks = tasks
    .filter(t => t.frontmatter.phase === 'archived')
    .sort((a, b) =>
      new Date(b.frontmatter.updated).getTime() - new Date(a.frontmatter.updated).getTime()
    )
  const nonArchivedTasks = tasks.filter(t => t.frontmatter.phase !== 'archived')

  // Load workspace data
  useEffect(() => {
    if (!workspaceId) return

    setIsLoading(true)
    setError(null)

    Promise.all([
      api.getWorkspace(workspaceId),
      api.getTasks(workspaceId),
      api.getActivity(workspaceId, 100),
      api.getQueueStatus(workspaceId),
    ])
      .then(([ws, tasksData, activityData, qStatus]) => {
        setWorkspace(ws)
        setTasks(tasksData)
        setActivity(activityData)
        setQueueStatus(qStatus)
        setIsLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load workspace:', err)
        setError('Workspace not found')
        setIsLoading(false)
      })
  }, [workspaceId])

  // Handle WebSocket messages
  useEffect(() => {
    return subscribe((msg) => {
      switch (msg.type) {
        case 'task:created':
          setTasks((prev) => {
            if (prev.some((t) => t.id === msg.task.id)) return prev
            return [msg.task, ...prev]
          })
          break
        case 'task:updated':
          setTasks((prev) =>
            prev.map((t) => (t.id === msg.task.id ? msg.task : t))
          )
          if (selectedTaskRef.current?.id === msg.task.id) {
            setMainPane({ type: 'task-detail', task: msg.task })
          }
          break
        case 'task:moved':
          setTasks((prev) =>
            prev.map((t) => (t.id === msg.task.id ? msg.task : t))
          )
          if (selectedTaskRef.current?.id === msg.task.id) {
            setMainPane({ type: 'task-detail', task: msg.task })
          }
          break
        case 'task:plan_generated': {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === msg.taskId
                ? { ...t, frontmatter: { ...t.frontmatter, plan: msg.plan } }
                : t
            )
          )
          if (selectedTaskRef.current?.id === msg.taskId) {
            setMainPane((prev) => {
              if (prev.type === 'task-detail') {
                return {
                  ...prev,
                  task: {
                    ...prev.task,
                    frontmatter: { ...prev.task.frontmatter, plan: msg.plan },
                  },
                }
              }
              return prev
            })
          }
          break
        }
        case 'task:reordered': {
          const { phase: reorderedPhase, taskIds: orderedIds } = msg
          setTasks((prev) => {
            const updated = [...prev]
            for (let i = 0; i < orderedIds.length; i++) {
              const idx = updated.findIndex((t) => t.id === orderedIds[i])
              if (idx !== -1 && updated[idx].frontmatter.phase === reorderedPhase) {
                updated[idx] = {
                  ...updated[idx],
                  frontmatter: { ...updated[idx].frontmatter, order: i },
                }
              }
            }
            return updated
          })
          break
        }
        case 'activity:entry':
          setActivity((prev) => [msg.entry, ...prev])
          break
        case 'queue:status':
          setQueueStatus(msg.status)
          break
      }
    })
  }, [subscribe])

  // Create task
  const handleCreateTask = async (data: { content: string; postExecutionSkills?: string[]; modelConfig?: import('@pi-factory/shared').ModelConfig; pendingFiles?: File[] }) => {
    if (!workspaceId) return
    try {
      const { pendingFiles, ...taskData } = data
      const task = await api.createTask(workspaceId, taskData)
      if (pendingFiles && pendingFiles.length > 0) {
        try {
          await api.uploadAttachments(workspaceId, task.id, pendingFiles)
        } catch (uploadErr) {
          console.error('Failed to upload attachments:', uploadErr)
        }
      }
      setMainPane({ type: 'task-detail', task })
    } catch (err) {
      console.error('Failed to create task:', err)
      alert('Failed to create task: ' + String(err))
    }
  }

  const handleSelectTask = useCallback((task: Task) => {
    setMoveError(null)
    const fullTask = tasksRef.current.find((t) => t.id === task.id)
    if (fullTask) {
      setMainPane({ type: 'task-detail', task: fullTask })

      if (workspaceId) {
        api.getTaskActivity(workspaceId, fullTask.id, 200).then((taskEntries) => {
          setActivity((prev) => {
            const existingIds = new Set(prev.map((e) => e.id))
            const newEntries = taskEntries.filter((e) => !existingIds.has(e.id))
            if (newEntries.length === 0) return prev
            // Merge and sort by timestamp descending (newest first) to maintain correct order
            const merged = [...newEntries, ...prev]
            merged.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
            return merged
          })
        }).catch((err) => {
          console.error('Failed to load task activity:', err)
        })
      }
    }
  }, [workspaceId])

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 5000)
  }, [])

  // Move task
  const handleMoveTask = async (task: Task, toPhase: Phase) => {
    if (!workspaceId) return

    const updatedTask = {
      ...task,
      frontmatter: {
        ...task.frontmatter,
        phase: toPhase,
        updated: new Date().toISOString(),
      },
    }
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updatedTask : t)))
    if (selectedTask?.id === task.id) {
      setMainPane({ type: 'task-detail', task: updatedTask })
    }

    try {
      const result = await api.moveTask(workspaceId, task.id, toPhase)
      setMoveError(null)
      setTasks((prev) => prev.map((t) => {
        if (t.id !== task.id) return t
        if (t.frontmatter.phase !== toPhase) return t
        return result
      }))
      if (selectedTask?.id === task.id) {
        setMainPane((prev) => {
          if (prev.type !== 'task-detail' || prev.task.id !== task.id) return prev
          if (prev.task.frontmatter.phase !== toPhase) return prev
          return { type: 'task-detail', task: result }
        })
      }
    } catch (err) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
      if (selectedTask?.id === task.id) {
        setMainPane({ type: 'task-detail', task })
      }
      const message = err instanceof Error ? err.message : 'Failed to move task'
      setMoveError(message)
      showToast(message)
      console.error('Failed to move task:', err)
    }
  }

  // Reorder tasks within a phase
  const handleReorderTasks = async (phase: Phase, taskIds: string[]) => {
    if (!workspaceId) return

    // Optimistic local update
    setTasks((prev) => {
      const updated = [...prev]
      for (let i = 0; i < taskIds.length; i++) {
        const idx = updated.findIndex((t) => t.id === taskIds[i])
        if (idx !== -1 && updated[idx].frontmatter.phase === phase) {
          updated[idx] = {
            ...updated[idx],
            frontmatter: { ...updated[idx].frontmatter, order: i },
          }
        }
      }
      return updated
    })

    try {
      await api.reorderTasks(workspaceId, phase, taskIds)
    } catch (err) {
      console.error('Failed to reorder tasks:', err)
      // Reload tasks to restore correct order on failure
      const freshTasks = await api.getTasks(workspaceId)
      setTasks(freshTasks)
      showToast('Failed to reorder tasks')
    }
  }

  const handleSendMessage = async (taskId: string, content: string, attachmentIds?: string[]) => {
    if (!workspaceId) return
    await api.sendMessage(workspaceId, taskId, content, 'user', attachmentIds)
  }

  const handleSteer = async (taskId: string, content: string, attachmentIds?: string[]) => {
    if (!workspaceId) return
    await fetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, attachmentIds }),
    })
  }

  const handleFollowUp = async (taskId: string, content: string, attachmentIds?: string[]) => {
    if (!workspaceId) return
    await fetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/follow-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, attachmentIds }),
    })
  }

  const handleToggleQueue = async () => {
    if (!workspaceId || queueToggling) return
    setQueueToggling(true)
    try {
      const status = queueStatus?.enabled
        ? await api.stopQueue(workspaceId)
        : await api.startQueue(workspaceId)
      setQueueStatus(status)
    } catch (err) {
      console.error('Failed to toggle queue:', err)
      showToast('Failed to toggle queue processing')
    } finally {
      setQueueToggling(false)
    }
  }

  const handleResize = useCallback((delta: number) => {
    // delta is positive when dragging left — shrink the left pane
    setRightPaneWidth((prev) => Math.min(RIGHT_PANE_MAX, Math.max(RIGHT_PANE_MIN, prev - delta)))
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-slate-300 border-t-safety-orange rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600 font-medium">Loading workspace...</p>
        </div>
      </div>
    )
  }

  if (error || !workspace) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <p className="text-slate-600 font-medium mb-4">{error || 'Workspace not found'}</p>
          <button
            onClick={() => navigate('/')}
            className="text-sm text-safety-orange hover:underline"
          >
            ← Back to workspaces
          </button>
        </div>
      </div>
    )
  }

  const workspaceName = workspace.path.split('/').filter(Boolean).pop() || workspace.name

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white shadow-lg shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <h1 className="text-lg font-bold tracking-tight">PI-FACTORY</h1>
          </button>
          <div className="h-6 w-px bg-slate-700" />
          <span className="text-sm font-medium text-slate-300">{workspaceName}</span>
          <div className="h-6 w-px bg-slate-700" />
          <button
            onClick={handleToggleQueue}
            disabled={queueToggling}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              queueStatus?.enabled
                ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            } ${queueToggling ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={queueStatus?.enabled ? 'Stop queue processing' : 'Start queue processing'}
          >
            {queueToggling ? (
              <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : queueStatus?.enabled ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="2" y="2" width="4" height="10" rx="1" />
                <rect x="8" y="2" width="4" height="10" rx="1" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M3 1.5v11l9-5.5z" />
              </svg>
            )}
            {queueStatus?.enabled ? 'Running' : 'Paused'}
            {queueStatus?.enabled && queueStatus.tasksInReady > 0 && (
              <span className="bg-green-500/30 text-green-300 text-xs px-1.5 py-0.5 rounded-full">
                {queueStatus.tasksInReady} queued
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-3">
          {isConnected ? (
            <span className="flex items-center gap-1.5 text-xs text-green-400">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              Live
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className="w-2 h-2 bg-slate-400 rounded-full" />
              Offline
            </span>
          )}
          <button
            onClick={() => navigate(`/workspace/${workspaceId}/config`)}
            className="text-slate-400 hover:text-white transition-colors"
            title="Workspace Configuration"
          >
            🛠️
          </button>
          <button
            onClick={() => navigate('/settings')}
            className="text-slate-400 hover:text-white transition-colors"
            title="Pi Settings"
          >
            ⚙️
          </button>
        </div>
      </header>

      {/* Error toast */}
      {toast && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-red-50 border-b border-red-200 text-red-800 text-sm shrink-0">
          <span>{toast}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-4 text-red-400 hover:text-red-600 font-medium"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main layout: two panes on top, pipeline bar on bottom */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top: two panes */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Activity Feed — left */}
          <div
            className="bg-slate-50 overflow-hidden shrink-0"
            style={{ width: rightPaneWidth }}
          >
            <ActivityLog
              entries={activity}
              tasks={tasks}
              onTaskClick={handleSelectTask}
            />
          </div>

          <ResizeHandle onResize={handleResize} />

          {/* Task Detail / Create / Empty State — right (white, fills remaining) */}
          <div className="flex-1 bg-white overflow-hidden min-w-0">
            {mainPane.type === 'task-detail' ? (
              <TaskDetailPane
                task={mainPane.task}
                workspaceId={workspaceId || ''}
                activity={activity}
                agentStream={agentStream}
                moveError={moveError}
                onClose={() => setMainPane({ type: 'empty' })}
                onMove={(phase) => {
                  if (selectedTask) handleMoveTask(selectedTask, phase)
                }}
                onDelete={() => {
                  if (selectedTask) {
                    setTasks((prev) => prev.filter((t) => t.id !== selectedTask.id))
                    setMainPane({ type: 'empty' })
                  }
                }}
                onSendMessage={handleSendMessage}
                onSteer={handleSteer}
                onFollowUp={handleFollowUp}
              />
            ) : mainPane.type === 'create-task' ? (
              <CreateTaskPane
                onCancel={() => setMainPane({ type: 'empty' })}
                onSubmit={handleCreateTask}
              />
            ) : (
              <EmptyState onCreateTask={() => setMainPane({ type: 'create-task' })} />
            )}
          </div>
        </div>

        {/* Pipeline Bar — full width bottom */}
        <div className="bg-slate-50 border-t border-slate-200 shrink-0">
          <PipelineBar
            tasks={nonArchivedTasks}
            selectedTaskId={selectedTask?.id || null}
            onTaskClick={handleSelectTask}
            onMoveTask={handleMoveTask}
            onReorderTasks={handleReorderTasks}
            onCreateTask={() => setMainPane({ type: 'create-task' })}
            archivedTasks={archivedTasks}
          />
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Empty State — shown when no task is selected
// =============================================================================

function EmptyState({ onCreateTask }: { onCreateTask: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-slate-400">
      <div className="text-5xl mb-5 opacity-50">📋</div>
      <h3 className="text-base font-medium text-slate-500 mb-1.5">No task selected</h3>
      <p className="text-sm mb-6">Select a task from the pipeline below</p>
      <button
        onClick={onCreateTask}
        className="btn btn-primary text-sm"
      >
        + New Task
      </button>
    </div>
  )
}
