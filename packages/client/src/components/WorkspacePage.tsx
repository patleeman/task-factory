import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useParams, useNavigate, useMatch } from 'react-router-dom'
import type { Task, Workspace, ActivityEntry, Phase, QueueStatus, Shelf, PlanningMessage, QAAnswer, AgentExecutionStatus } from '@pi-factory/shared'
import { api } from '../api'
import { AppIcon } from './AppIcon'
import { PipelineBar } from './PipelineBar'
import { TaskDetailPane } from './TaskDetailPane'
import { CreateTaskPane } from './CreateTaskPane'
import { ShelfPane } from './ShelfPane'
import { ResizeHandle } from './ResizeHandle'
import { useWebSocket } from '../hooks/useWebSocket'
import { useAgentStreaming } from '../hooks/useAgentStreaming'
import { usePlanningStreaming, PLANNING_TASK_ID } from '../hooks/usePlanningStreaming'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { TaskChat } from './TaskChat'
import { QADialog } from './QADialog'
import { ThemeToggle } from './ThemeToggle'

const LEFT_PANE_MIN = 320
const LEFT_PANE_MAX = 1400
const RUNNING_EXECUTION_STATUSES = new Set<AgentExecutionStatus>([
  'streaming',
  'tool_use',
  'thinking',
  'post-hooks',
])

function isExecutionStatusRunning(status: AgentExecutionStatus): boolean {
  return RUNNING_EXECUTION_STATUSES.has(status)
}

export function WorkspacePage() {
  const { workspaceId, taskId } = useParams<{ workspaceId: string; taskId?: string }>()
  const navigate = useNavigate()
  const isCreateRoute = useMatch('/workspace/:workspaceId/tasks/new') !== null

  const workspaceRootPath = workspaceId ? `/workspace/${workspaceId}` : '/'
  const workspaceConfigPath = workspaceId ? `/workspace/${workspaceId}/config` : '/'

  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [leftPaneWidth, setLeftPaneWidth] = useState(() =>
    Math.max(LEFT_PANE_MIN, Math.round(window.innerWidth * 0.4))
  )
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null)
  const [queueToggling, setQueueToggling] = useState(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const [shelf, setShelf] = useState<Shelf>({ items: [] })
  const [planningMessages, setPlanningMessages] = useState<PlanningMessage[]>([])
  const [runningExecutionTaskIds, setRunningExecutionTaskIds] = useState<Set<string>>(new Set())
  const tasksByIdRef = useRef<Map<string, Task>>(new Map())

  const selectedTask = taskId ? tasks.find((t) => t.id === taskId) || null : null
  const isTaskRoute = Boolean(taskId)

  // Mode: foreman (no task route) vs task (task route)
  const mode = isTaskRoute ? 'task' : 'foreman'

  const { subscribe, isConnected } = useWebSocket(workspaceId || null)
  const agentStream = useAgentStreaming(taskId || null, subscribe)
  const planningStream = usePlanningStreaming(workspaceId || null, subscribe, planningMessages)

  // Derived data
  const archivedTasks = tasks
    .filter(t => t.frontmatter.phase === 'archived')
    .sort((a, b) =>
      new Date(b.frontmatter.updated).getTime() - new Date(a.frontmatter.updated).getTime()
    )
  const nonArchivedTasks = tasks.filter(t => t.frontmatter.phase !== 'archived')
  const runningTaskIds = runningExecutionTaskIds
  const planGeneratingTaskIds = useMemo(() => {
    return new Set(
      tasks
        .filter((t) => t.frontmatter.phase === 'backlog')
        .filter((t) => t.frontmatter.planningStatus === 'running' && !t.frontmatter.plan)
        .map((t) => t.id),
    )
  }, [tasks])

  useEffect(() => {
    tasksByIdRef.current = new Map(tasks.map((task) => [task.id, task]))
  }, [tasks])

  useEffect(() => {
    setRunningExecutionTaskIds((prev) => {
      const tasksById = new Map(tasks.map((task) => [task.id, task]))

      let changed = false
      const next = new Set<string>()
      for (const taskId of prev) {
        const task = tasksById.get(taskId)
        if (task && task.frontmatter.phase === 'executing') {
          next.add(taskId)
        } else {
          changed = true
        }
      }

      if (!changed && next.size === prev.size) {
        return prev
      }

      return next
    })
  }, [tasks])

  // Load workspace data
  useEffect(() => {
    if (!workspaceId) return

    setIsLoading(true)
    setError(null)
    setActivity([])
    setRunningExecutionTaskIds(new Set())

    Promise.all([
      api.getWorkspace(workspaceId),
      api.getTasks(workspaceId),
      api.getActivity(workspaceId, 100),
      api.getQueueStatus(workspaceId),
      api.getShelf(workspaceId),
      api.getPlanningMessages(workspaceId),
      api.getActiveExecutions(workspaceId).catch((err) => {
        console.warn('Failed to load active execution snapshots:', err)
        return []
      }),
    ])
      .then(([ws, tasksData, activityData, qStatus, shelfData, planningMsgs, activeExecutions]) => {
        setWorkspace(ws)
        setTasks(tasksData)
        setActivity((prev) => {
          const byId = new Map<string, ActivityEntry>()

          for (const entry of activityData) {
            if (entry?.id) byId.set(entry.id, entry)
          }

          // Keep any live websocket entries that arrived while the initial
          // HTTP load was still in flight.
          for (const entry of prev) {
            if (entry?.id && !byId.has(entry.id)) {
              byId.set(entry.id, entry)
            }
          }

          const merged = Array.from(byId.values())
          merged.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
          return merged
        })
        setQueueStatus(qStatus)
        setShelf(shelfData)
        setPlanningMessages(planningMsgs)

        const tasksById = new Map(tasksData.map((task) => [task.id, task]))

        setRunningExecutionTaskIds(new Set(
          activeExecutions
            .filter((session) => {
              if (!session.isRunning) return false
              const task = tasksById.get(session.taskId)
              return task?.frontmatter.phase === 'executing'
            })
            .map((session) => session.taskId),
        ))
        setIsLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load workspace:', err)
        setError('Workspace not found')
        setIsLoading(false)
      })
  }, [workspaceId])

  // Load task-specific activity when opening a task route
  useEffect(() => {
    if (!workspaceId || !taskId) return

    api.getTaskActivity(workspaceId, taskId, 200)
      .then((taskEntries) => {
        setActivity((prev) => {
          const existingIds = new Set(prev.map((e) => e.id))
          const newEntries = taskEntries.filter((e) => !existingIds.has(e.id))
          if (newEntries.length === 0) return prev
          const merged = [...newEntries, ...prev]
          merged.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
          return merged
        })
      })
      .catch((err) => {
        console.error('Failed to load task activity:', err)
      })
  }, [workspaceId, taskId])

  // Clear move validation banners when switching routes
  useEffect(() => {
    setMoveError(null)
  }, [taskId, isCreateRoute])

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
          break
        case 'task:moved':
          setTasks((prev) =>
            prev.map((t) => (t.id === msg.task.id ? msg.task : t))
          )
          break
        case 'task:plan_generated': {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === msg.taskId
                ? { ...t, frontmatter: { ...t.frontmatter, plan: msg.plan, planningStatus: 'completed' } }
                : t
            )
          )
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
          setActivity((prev) => {
            const entry = msg.entry
            if (!entry?.id) return prev
            if (prev.some((e) => e.id === entry.id)) return prev
            return [entry, ...prev]
          })
          break
        case 'queue:status':
          setQueueStatus(msg.status)
          break
        case 'agent:execution_status': {
          const task = tasksByIdRef.current.get(msg.taskId)

          setRunningExecutionTaskIds((prev) => {
            const next = new Set(prev)

            if (!task || task.frontmatter.phase !== 'executing') {
              next.delete(msg.taskId)
              return next
            }

            if (isExecutionStatusRunning(msg.status)) {
              next.add(msg.taskId)
            } else {
              next.delete(msg.taskId)
            }
            return next
          })
          break
        }
        case 'shelf:updated':
          setShelf(msg.shelf)
          break
      }
    })
  }, [subscribe])

  // Create task
  const handleCreateTask = async (data: { content: string; preExecutionSkills?: string[]; postExecutionSkills?: string[]; skillConfigs?: Record<string, Record<string, string>>; planningModelConfig?: import('@pi-factory/shared').ModelConfig; executionModelConfig?: import('@pi-factory/shared').ModelConfig; pendingFiles?: File[] }) => {
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
      navigate(`${workspaceRootPath}/tasks/${task.id}`)
    } catch (err) {
      console.error('Failed to create task:', err)
      alert('Failed to create task: ' + String(err))
    }
  }

  const handleSelectTask = useCallback((task: Task) => {
    setMoveError(null)
    if (!workspaceId) return
    navigate(`${workspaceRootPath}/tasks/${task.id}`)
  }, [workspaceId, navigate, workspaceRootPath])

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
    if (task.frontmatter.phase === 'executing' && toPhase !== 'executing') {
      setRunningExecutionTaskIds((prev) => {
        if (!prev.has(task.id)) return prev
        const next = new Set(prev)
        next.delete(task.id)
        return next
      })
    }

    try {
      const result = await api.moveTask(workspaceId, task.id, toPhase)
      setMoveError(null)
      setTasks((prev) => prev.map((t) => {
        if (t.id !== task.id) return t
        if (t.frontmatter.phase !== toPhase) return t
        return result
      }))
    } catch (err) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
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

  // Planning agent handlers
  const handlePlanningMessage = async (content: string, attachmentIds?: string[]) => {
    if (!workspaceId) return
    try {
      await api.sendPlanningMessage(workspaceId, content, attachmentIds)
    } catch (err) {
      console.error('Failed to send planning message:', err)
    }
  }

  const handlePlanningUpload = async (files: File[]) => {
    if (!workspaceId) throw new Error('No workspace')
    return api.uploadPlanningAttachments(workspaceId, files)
  }

  const handleResetPlanning = async () => {
    if (!workspaceId) return
    try {
      await api.resetPlanningSession(workspaceId)
      setPlanningMessages([]) // Clear local state to reset the hook
    } catch (err) {
      console.error('Failed to reset planning session:', err)
    }
  }

  // Q&A disambiguation handlers
  const handleQASubmit = async (answers: QAAnswer[]) => {
    if (!workspaceId || !planningStream.activeQARequest) return
    try {
      await api.submitQAResponse(workspaceId, planningStream.activeQARequest.requestId, answers)
    } catch (err) {
      console.error('Failed to submit Q&A response:', err)
      showToast('Failed to submit answers')
    }
  }

  const handleQAAbort = async () => {
    if (!workspaceId || !planningStream.activeQARequest) return
    try {
      await api.abortQA(workspaceId, planningStream.activeQARequest.requestId)
    } catch (err) {
      console.error('Failed to abort Q&A:', err)
    }
  }

  // Shelf handlers
  const handlePushDraft = async (draftId: string) => {
    if (!workspaceId) return
    try {
      await api.pushDraftToBacklog(workspaceId, draftId)
    } catch (err) {
      console.error('Failed to push draft:', err)
      showToast('Failed to push draft to backlog')
    }
  }

  const handlePushAllDrafts = async () => {
    if (!workspaceId) return
    try {
      const result = await api.pushAllDraftsToBacklog(workspaceId)
      showToast(`Created ${result.count} task${result.count !== 1 ? 's' : ''} from drafts`)
    } catch (err) {
      console.error('Failed to push all drafts:', err)
      showToast('Failed to push drafts to backlog')
    }
  }

  const handleRemoveShelfItem = async (itemId: string) => {
    if (!workspaceId) return
    try {
      await api.removeShelfItem(workspaceId, itemId)
    } catch (err) {
      console.error('Failed to remove shelf item:', err)
    }
  }

  const handleUpdateDraft = async (draftId: string, updates: Partial<import('@pi-factory/shared').DraftTask>) => {
    if (!workspaceId) return
    try {
      await api.updateDraftTask(workspaceId, draftId, updates)
    } catch (err) {
      console.error('Failed to update draft:', err)
    }
  }

  const handleClearShelf = async () => {
    if (!workspaceId) return
    if (!confirm('Clear all items from the shelf?')) return
    try {
      await api.clearShelf(workspaceId)
    } catch (err) {
      console.error('Failed to clear shelf:', err)
    }
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
      showToast('Failed to toggle auto-execution')
    } finally {
      setQueueToggling(false)
    }
  }

  const handleResize = useCallback((delta: number) => {
    // delta is positive when dragging right — expand the left pane
    setLeftPaneWidth((prev) => Math.min(LEFT_PANE_MAX, Math.max(LEFT_PANE_MIN, prev - delta)))
  }, [])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onEscape: useCallback(() => {
      if (isTaskRoute || isCreateRoute) {
        navigate(workspaceRootPath)
      }
    }, [isTaskRoute, isCreateRoute, navigate, workspaceRootPath]),
    onFocusChat: useCallback(() => {
      const textarea = document.querySelector('[data-chat-input]') as HTMLTextAreaElement | null
      textarea?.focus()
    }, []),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-slate-300 border-t-safety-orange rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600 font-medium">Loading workspace...</p>
        </div>
      </div>
    )
  }

  if (error || !workspace) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-50">
        <div className="text-center">
          <p className="text-slate-600 font-medium mb-4">{error || 'Workspace not found'}</p>
          <button
            onClick={() => navigate('/')}
            className="text-sm text-safety-orange hover:underline inline-flex items-center gap-1"
          >
            <AppIcon icon={ArrowLeft} size="xs" />
            Back to workspaces
          </button>
        </div>
      </div>
    )
  }

  const workspaceName = workspace.path.split('/').filter(Boolean).pop() || workspace.name

  return (
    <div className="flex flex-col h-full bg-slate-50">
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
          {nonArchivedTasks.length > 0 && (() => {
            const counts = nonArchivedTasks.reduce((acc, t) => {
              const p = t.frontmatter.phase
              acc[p] = (acc[p] || 0) + 1
              return acc
            }, {} as Record<string, number>)
            const runningCount = nonArchivedTasks.filter((task) => runningTaskIds.has(task.id)).length
            return (
              <span className="text-xs text-slate-500 font-mono">
                {runningCount > 0 && <span className="text-orange-400">{runningCount} running</span>}
                {counts.ready > 0 && <span className="text-blue-400 ml-2">{counts.ready} ready</span>}
                {counts.complete > 0 && <span className="text-emerald-400 ml-2">{counts.complete} done</span>}
              </span>
            )
          })()}
          <div className="h-6 w-px bg-slate-700" />
          <button
            onClick={handleToggleQueue}
            disabled={queueToggling}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              queueStatus?.enabled
                ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            } ${queueToggling ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={queueStatus?.enabled ? 'Pause auto-execution' : 'Auto-execute ready tasks'}
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
            {queueStatus?.enabled ? 'Auto' : 'Auto'}
            {queueStatus?.enabled && queueStatus.tasksInReady > 0 && (
              <span className="bg-green-500/30 text-green-300 text-xs px-1.5 py-0.5 rounded-full">
                {queueStatus.tasksInReady} ready
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
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
            onClick={() => navigate(workspaceConfigPath)}
            className="text-xs text-slate-400 hover:text-white transition-colors font-medium"
            title="Workspace Configuration"
          >
            Config
          </button>
          <button
            onClick={() => navigate('/settings')}
            className="text-xs text-slate-400 hover:text-white transition-colors font-medium"
            title="Pi Settings"
          >
            Settings
          </button>
        </div>
      </header>

      {/* Error toast */}
      {toast && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-red-50 border-b border-red-200 text-red-800 text-sm shrink-0">
          <span>{toast}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-4 text-red-400 hover:text-red-600 text-xs font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main layout: two panes on top, pipeline bar on bottom */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top: two panes */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Left pane — Chat (foreman or task, depending on mode) */}
          <div
            className={`overflow-hidden shrink-0 transition-colors duration-200 ${mode === 'task' ? 'bg-orange-50/30' : 'bg-slate-50'}`}
            style={{ width: leftPaneWidth }}
          >
            {mode === 'foreman' ? (
              <TaskChat
                taskId={PLANNING_TASK_ID}
                workspaceId={workspaceId}
                entries={planningStream.entries}
                attachments={[]}
                agentStream={planningStream.agentStream}
                onSendMessage={handlePlanningMessage}
                onSteer={handlePlanningMessage}
                onFollowUp={handlePlanningMessage}
                onUploadFiles={handlePlanningUpload}
                getAttachmentUrl={(storedName) => api.getPlanningAttachmentUrl(workspaceId!, storedName)}
                onReset={handleResetPlanning}
                title="Foreman"
                emptyState={{ title: 'Foreman', subtitle: 'Ask me to research, plan, or decompose work into tasks' }}
                bottomSlot={
                  planningStream.activeQARequest ? (
                    <QADialog
                      request={planningStream.activeQARequest}
                      onSubmit={handleQASubmit}
                      onAbort={handleQAAbort}
                    />
                  ) : undefined
                }
              />
            ) : (
              /* Task mode: show task chat in left pane */
              <div className="flex flex-col h-full">
                <div className="flex items-center gap-2 px-4 h-10 border-b border-slate-200 bg-slate-50 shrink-0">
                  <button
                    onClick={() => navigate(workspaceRootPath)}
                    className="text-slate-400 hover:text-slate-600 transition-colors text-xs font-medium inline-flex items-center gap-1"
                  >
                    <AppIcon icon={ArrowLeft} size="xs" />
                    Foreman
                  </button>
                  <div className="h-4 w-px bg-slate-200" />
                  <span className="font-mono text-[10px] text-slate-400">{taskId}</span>
                  <span className="text-xs font-medium text-slate-700 truncate">
                    {selectedTask ? selectedTask.frontmatter.title : 'Task not found'}
                  </span>
                </div>
                <div className="flex-1 overflow-hidden min-h-0">
                  {selectedTask ? (
                    <TaskChat
                      taskId={selectedTask.id}
                      taskPhase={selectedTask.frontmatter.phase}
                      workspaceId={workspaceId || ''}
                      entries={activity}
                      attachments={selectedTask.frontmatter.attachments || []}
                      agentStream={agentStream}
                      onSendMessage={(content, attachmentIds) => handleSendMessage(selectedTask.id, content, attachmentIds)}
                      onSteer={(content, attachmentIds) => handleSteer(selectedTask.id, content, attachmentIds)}
                      onFollowUp={(content, attachmentIds) => handleFollowUp(selectedTask.id, content, attachmentIds)}
                    />
                  ) : (
                    <TaskRouteMissingState onBack={() => navigate(workspaceRootPath)} />
                  )}
                </div>
              </div>
            )}
          </div>

          <ResizeHandle onResize={handleResize} />

          {/* Right pane — contextual (shelf in foreman mode, task detail in task mode) */}
          <div className="flex-1 bg-white overflow-hidden min-w-0">
            {mode === 'foreman' ? (
              isCreateRoute ? (
                <CreateTaskPane
                  workspaceId={workspaceId || ''}
                  onCancel={() => navigate(workspaceRootPath)}
                  onSubmit={handleCreateTask}
                />
              ) : (
                <ShelfPane
                  shelf={shelf}
                  onPushDraft={handlePushDraft}
                  onPushAll={handlePushAllDrafts}
                  onRemoveItem={handleRemoveShelfItem}
                  onUpdateDraft={handleUpdateDraft}
                  onClearShelf={handleClearShelf}
                />
              )
            ) : selectedTask ? (
              <TaskDetailPane
                task={selectedTask}
                workspaceId={workspaceId || ''}
                moveError={moveError}
                isPlanGenerating={planGeneratingTaskIds.has(selectedTask.id)}
                isAgentRunning={runningTaskIds.has(selectedTask.id)}
                onClose={() => navigate(workspaceRootPath)}
                onMove={(phase) => handleMoveTask(selectedTask, phase)}
                onDelete={() => {
                  setTasks((prev) => prev.filter((t) => t.id !== selectedTask.id))
                  navigate(workspaceRootPath)
                }}
              />
            ) : (
              <TaskRouteMissingState onBack={() => navigate(workspaceRootPath)} />
            )}
          </div>
        </div>

        {/* Pipeline Bar — full width bottom */}
        <div className="bg-slate-50 border-t border-slate-200 shrink-0">
          <PipelineBar
            tasks={nonArchivedTasks}
            runningTaskIds={runningTaskIds}
            selectedTaskId={selectedTask?.id || null}
            onTaskClick={handleSelectTask}
            onMoveTask={handleMoveTask}
            onReorderTasks={handleReorderTasks}
            onCreateTask={() => navigate(`${workspaceRootPath}/tasks/new`)}
            archivedTasks={archivedTasks}
          />
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Task Route Missing State
// =============================================================================

function TaskRouteMissingState({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-slate-400 p-6 text-center">
      <h3 className="text-base font-medium text-slate-600 mb-1.5">Task not found</h3>
      <p className="text-sm mb-6">This task may have been deleted or moved.</p>
      <button
        onClick={onBack}
        className="btn btn-secondary text-sm inline-flex items-center gap-1"
      >
        <AppIcon icon={ArrowLeft} size="xs" />
        Back to foreman
      </button>
    </div>
  )
}

