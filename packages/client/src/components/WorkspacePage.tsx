import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ArrowLeft, Lightbulb, Plus, Power } from 'lucide-react'
import { useParams, useNavigate, useMatch, useOutletContext } from 'react-router-dom'
import type { Task, Workspace, ActivityEntry, Phase, QueueStatus, PlanningMessage, QAAnswer, AgentExecutionStatus, WorkspaceWorkflowSettings, Artifact, DraftTask, IdeaBacklog, IdeaBacklogItem, NewTaskFormState } from '@task-factory/shared'
import { DEFAULT_WORKFLOW_SETTINGS } from '@task-factory/shared'
import { api, type WorkflowAutomationResponse, type WorkspaceSkill } from '../api'
import { AppIcon } from './AppIcon'
import { PipelineBar } from './PipelineBar'
import { TaskDetailPane } from './TaskDetailPane'
import { CreateTaskPane, type CreateTaskData } from './CreateTaskPane'
import { ShelfPane } from './ShelfPane'
import { IdeaBacklogPane } from './IdeaBacklogPane'
import { ArchivePane } from './ArchivePane'
import { ResizeHandle } from './ResizeHandle'
import { ModelSelector } from './ModelSelector'
import type { WorkspaceWebSocketConnection } from '../hooks/useWebSocket'
import { useAgentStreaming } from '../hooks/useAgentStreaming'
import { usePlanningStreaming, PLANNING_TASK_ID } from '../hooks/usePlanningStreaming'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useForemanModel } from '../hooks/useForemanModel'
import { DEFAULT_VOICE_INPUT_HOTKEY, normalizeVoiceInputHotkey } from '../voiceHotkey'
import { TaskChat, type SlashCommandOption } from './TaskChat'
import { QADialog } from './QADialog'
import { isFactoryRunningState, syncAutomationSettingsWithQueue } from './workflow-automation'

const LEFT_PANE_MIN = 320
const LEFT_PANE_MAX = 1400
const RUNNING_EXECUTION_STATUSES = new Set<AgentExecutionStatus>([
  'streaming',
  'tool_use',
  'thinking',
  'post-hooks',
])

const BASE_FOREMAN_SLASH_COMMANDS: SlashCommandOption[] = [
  { command: '/new', description: 'Reset the planning conversation' },
  { command: '/help', description: 'Show supported slash commands' },
]

function buildForemanSlashCommands(skills: WorkspaceSkill[]): SlashCommandOption[] {
  const commands = [...BASE_FOREMAN_SLASH_COMMANDS]

  const sortedSkills = [...skills].sort((a, b) => a.id.localeCompare(b.id))
  for (const skill of sortedSkills) {
    const description = skill.description.trim() || `Run skill ${skill.name}`
    commands.push({
      command: `/skill:${skill.id}`,
      description,
    })
  }

  if (sortedSkills.length === 0) {
    commands.push({
      command: '/skill:<name>',
      description: 'Run a loaded skill command',
    })
  }

  return commands
}

function isExecutionStatusRunning(status: AgentExecutionStatus): boolean {
  return RUNNING_EXECUTION_STATUSES.has(status)
}

function getArchivedCountDelta(fromPhase: Phase | null | undefined, toPhase: Phase | null | undefined): number {
  if (fromPhase !== 'archived' && toPhase === 'archived') {
    return 1
  }

  if (fromPhase === 'archived' && toPhase !== 'archived') {
    return -1
  }

  return 0
}

function clampArchivedCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.floor(value))
}

function formatDraftTaskForNewTaskForm(draftTask: DraftTask): string {
  const sections: string[] = []

  sections.push(`# ${draftTask.title}`)

  if (draftTask.content.trim()) {
    sections.push(draftTask.content.trim())
  }

  if (draftTask.acceptanceCriteria.length > 0) {
    sections.push('## Acceptance Criteria')
    sections.push(draftTask.acceptanceCriteria.map((criterion) => `- ${criterion}`).join('\n'))
  }

  if (draftTask.plan) {
    sections.push('## Draft Plan')
    sections.push(`**Goal:** ${draftTask.plan.goal}`)

    if (draftTask.plan.steps.length > 0) {
      sections.push('### Steps')
      sections.push(draftTask.plan.steps.map((step, index) => `${index + 1}. ${step}`).join('\n'))
    }

    if (draftTask.plan.validation.length > 0) {
      sections.push('### Validation')
      sections.push(draftTask.plan.validation.map((item, index) => `${index + 1}. ${item}`).join('\n'))
    }

    if (draftTask.plan.cleanup.length > 0) {
      sections.push('### Cleanup')
      sections.push(draftTask.plan.cleanup.map((item, index) => `${index + 1}. ${item}`).join('\n'))
    }
  }

  return sections.join('\n\n').trim()
}

export function WorkspacePage() {
  const { workspaceId, taskId } = useParams<{ workspaceId: string; taskId?: string }>()
  const navigate = useNavigate()
  const isCreateRoute = useMatch('/workspace/:workspaceId/tasks/new') !== null
  const isArchiveRoute = useMatch('/workspace/:workspaceId/archive') !== null

  const workspaceRootPath = workspaceId ? `/workspace/${workspaceId}` : '/'
  const workspaceArchivePath = workspaceId ? `/workspace/${workspaceId}/archive` : '/'
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
  const [voiceInputHotkey, setVoiceInputHotkey] = useState(DEFAULT_VOICE_INPUT_HOTKEY)
  const [isVoiceHotkeyPressed, setIsVoiceHotkeyPressed] = useState(false)
  const [isVoiceDictating, setIsVoiceDictating] = useState(false)
  const [automationSettings, setAutomationSettings] = useState<WorkspaceWorkflowSettings>({
    ...DEFAULT_WORKFLOW_SETTINGS,
  })
  const [backlogAutomationToggling, setBacklogAutomationToggling] = useState(false)
  const [readyAutomationToggling, setReadyAutomationToggling] = useState(false)
  const [factoryToggling, setFactoryToggling] = useState(false)
  const [archivedTasksLoaded, setArchivedTasksLoaded] = useState(false)
  const [archivedTasksLoading, setArchivedTasksLoading] = useState(false)
  const [archivedTaskCount, setArchivedTaskCount] = useState(0)
  const [isOpeningArchiveInFileExplorer, setIsOpeningArchiveInFileExplorer] = useState(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const archivedLoadPromiseRef = useRef<Promise<void> | null>(null)
  const openingArchiveExplorerRef = useRef(false)

  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null)
  const [ideaBacklog, setIdeaBacklog] = useState<IdeaBacklog | null>(null)
  const [activeForemanPane, setActiveForemanPane] = useState<'workspace' | 'ideas'>('workspace')
  const [planningMessages, setPlanningMessages] = useState<PlanningMessage[]>([])
  const [foremanSlashCommands, setForemanSlashCommands] = useState<SlashCommandOption[]>(BASE_FOREMAN_SLASH_COMMANDS)
  const [agentTaskFormUpdates, setAgentTaskFormUpdates] = useState<Partial<NewTaskFormState> | null>(null)
  const [newTaskPrefill, setNewTaskPrefill] = useState<{ id: string; formState: Partial<NewTaskFormState>; sourceDraftId?: string } | null>(null)
  const [draftTaskStates, setDraftTaskStates] = useState<Record<string, { status: 'created' | 'dismissed'; taskId?: string }>>({})
  const [creatingDraftTaskIds, setCreatingDraftTaskIds] = useState<Set<string>>(new Set())
  const [runningExecutionTaskIds, setRunningExecutionTaskIds] = useState<Set<string>>(new Set())
  const [awaitingInputTaskIds, setAwaitingInputTaskIds] = useState<Set<string>>(new Set())
  const [stoppingTaskIds, setStoppingTaskIds] = useState<Set<string>>(new Set())
  const [isStoppingPlanning, setIsStoppingPlanning] = useState(false)
  const stoppingTaskIdsRef = useRef<Set<string>>(new Set())
  const stoppingPlanningRef = useRef(false)
  const tasksByIdRef = useRef<Map<string, Task>>(new Map())

  const selectedTask = taskId ? tasks.find((t) => t.id === taskId) || null : null
  const isTaskRoute = Boolean(taskId)

  // Mode: foreman (no task route) vs task (task route)
  const mode = isTaskRoute ? 'task' : 'foreman'

  const { subscribe, isConnected } = useOutletContext<WorkspaceWebSocketConnection>()
  const agentStream = useAgentStreaming(taskId || null, subscribe)
  const planningStream = usePlanningStreaming(workspaceId || null, subscribe, planningMessages)
  const { modelConfig: foremanModelConfig, setModelConfig: setForemanModelConfig } = useForemanModel(workspaceId || null)

  useEffect(() => {
    let cancelled = false

    api.getPiFactorySettings()
      .then((settings) => {
        if (cancelled) return
        setVoiceInputHotkey(normalizeVoiceInputHotkey(settings.voiceInputHotkey))
      })
      .catch((err) => {
        console.warn('Failed to load voice input hotkey settings:', err)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setIsVoiceHotkeyPressed(false)
    setIsVoiceDictating(false)
  }, [taskId])

  // Derived data
  const archivedTasks = tasks
    .filter(t => t.frontmatter.phase === 'archived')
    .sort((a, b) =>
      new Date(b.frontmatter.updated).getTime() - new Date(a.frontmatter.updated).getTime()
    )
  const nonArchivedTasks = tasks.filter(t => t.frontmatter.phase !== 'archived')
  const effectiveArchivedCount = archivedTasksLoaded
    ? archivedTasks.length
    : archivedTaskCount
  const runningTaskIds = runningExecutionTaskIds
  const awaitingTaskIds = awaitingInputTaskIds
  const awaitingInputCount = nonArchivedTasks.filter((task) => awaitingTaskIds.has(task.id)).length
  const liveExecutionTaskIds = useMemo(() => {
    const ids = new Set(runningTaskIds)
    for (const taskId of awaitingTaskIds) {
      ids.add(taskId)
    }
    return ids
  }, [runningTaskIds, awaitingTaskIds])
  const effectiveAutomationSettings: WorkspaceWorkflowSettings = syncAutomationSettingsWithQueue(
    automationSettings,
    queueStatus,
  )
  const isFactoryRunning = isFactoryRunningState(effectiveAutomationSettings, liveExecutionTaskIds.size)
  const planGeneratingTaskIds = useMemo(() => {
    return new Set(
      tasks
        .filter((t) => t.frontmatter.phase === 'backlog')
        .filter((t) => t.frontmatter.planningStatus === 'running' && !t.frontmatter.plan)
        .map((t) => t.id),
    )
  }, [tasks])

  const mergeArchivedTasks = useCallback((existingTasks: Task[], archived: Task[]) => {
    const activeTasks = existingTasks.filter((task) => task.frontmatter.phase !== 'archived')
    const merged = [...activeTasks]
    const seenIds = new Set(activeTasks.map((task) => task.id))

    for (const task of archived) {
      if (seenIds.has(task.id)) {
        const existingIndex = merged.findIndex((candidate) => candidate.id === task.id)
        if (existingIndex !== -1) {
          merged[existingIndex] = task
        }
        continue
      }

      merged.push(task)
      seenIds.add(task.id)
    }

    return merged
  }, [])

  const loadArchivedTasksIfNeeded = useCallback(async (options?: { force?: boolean }) => {
    if (!workspaceId) return

    const shouldForce = options?.force === true
    if (!shouldForce && archivedTasksLoaded) {
      return
    }

    if (!shouldForce && archivedLoadPromiseRef.current) {
      return archivedLoadPromiseRef.current
    }

    setArchivedTasksLoading(true)

    const loadPromise = api.getTasks(workspaceId, 'archived')
      .then((archivedTasksData) => {
        setTasks((prev) => mergeArchivedTasks(prev, archivedTasksData))
        setArchivedTaskCount(clampArchivedCount(archivedTasksData.length))
        setArchivedTasksLoaded(true)
      })
      .catch((err) => {
        console.error('Failed to load archived tasks:', err)
      })
      .finally(() => {
        archivedLoadPromiseRef.current = null
        setArchivedTasksLoading(false)
      })

    archivedLoadPromiseRef.current = loadPromise
    return loadPromise
  }, [workspaceId, archivedTasksLoaded, mergeArchivedTasks])

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
        if (task) {
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

  useEffect(() => {
    setAwaitingInputTaskIds((prev) => {
      const tasksById = new Map(tasks.map((task) => [task.id, task]))

      let changed = false
      const next = new Set<string>()
      for (const trackedTaskId of prev) {
        const task = tasksById.get(trackedTaskId)
        if (task) {
          next.add(trackedTaskId)
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

  useEffect(() => {
    const tasksById = new Map(tasks.map((task) => [task.id, task]))
    const filtered = new Set<string>()

    for (const trackedTaskId of stoppingTaskIdsRef.current) {
      const task = tasksById.get(trackedTaskId)
      if (task) {
        filtered.add(trackedTaskId)
      }
    }

    if (filtered.size === stoppingTaskIdsRef.current.size) {
      return
    }

    stoppingTaskIdsRef.current = filtered
    setStoppingTaskIds(filtered)
  }, [tasks])

  // Load workspace data
  useEffect(() => {
    if (!workspaceId) return

    setIsLoading(true)
    setError(null)
    setActivity([])
    setSelectedArtifact(null)
    setIdeaBacklog(null)
    setActiveForemanPane('workspace')
    setForemanSlashCommands(BASE_FOREMAN_SLASH_COMMANDS)
    setAgentTaskFormUpdates(null)
    setNewTaskPrefill(null)
    setDraftTaskStates({})
    setCreatingDraftTaskIds(new Set())
    setRunningExecutionTaskIds(new Set())
    setAwaitingInputTaskIds(new Set())
    stoppingTaskIdsRef.current = new Set()
    stoppingPlanningRef.current = false
    setStoppingTaskIds(new Set())
    setIsStoppingPlanning(false)
    setBacklogAutomationToggling(false)
    setReadyAutomationToggling(false)
    setFactoryToggling(false)
    setAutomationSettings({ ...DEFAULT_WORKFLOW_SETTINGS })
    setArchivedTasksLoaded(false)
    setArchivedTasksLoading(false)
    setArchivedTaskCount(0)
    archivedLoadPromiseRef.current = null

    Promise.all([
      api.getWorkspace(workspaceId),
      api.getTasks(workspaceId, 'active'),
      api.getArchivedTaskCount(workspaceId).catch((err) => {
        console.warn('Failed to load archived task count:', err)
        return 0
      }),
      api.getActivity(workspaceId, 100),
      api.getWorkflowAutomation(workspaceId),
      api.getPlanningMessages(workspaceId),
      api.getWorkspaceSkills(workspaceId).catch((err) => {
        console.warn('Failed to load workspace skills:', err)
        return []
      }),
      api.getIdeaBacklog(workspaceId).catch((err) => {
        console.warn('Failed to load idea backlog:', err)
        return { items: [] }
      }),
      api.getActiveExecutions(workspaceId).catch((err) => {
        console.warn('Failed to load active execution snapshots:', err)
        return []
      }),
    ])
      .then(([ws, tasksData, archivedCount, activityData, automationData, planningMsgs, workspaceSkills, ideaBacklogData, activeExecutions]) => {
        const nextWipLimits = {
          ...(ws.config.wipLimits || {}),
        }
        delete nextWipLimits.ready
        if (automationData.overrides.readyLimit !== undefined) {
          nextWipLimits.ready = automationData.overrides.readyLimit
        }
        if (automationData.overrides.executingLimit !== undefined) {
          nextWipLimits.executing = automationData.overrides.executingLimit
        }

        setWorkspace({
          ...ws,
          config: {
            ...ws.config,
            wipLimits: nextWipLimits,
            workflowAutomation: {
              ...(ws.config.workflowAutomation || {}),
              ...(automationData.overrides.backlogToReady !== undefined
                ? { backlogToReady: automationData.overrides.backlogToReady }
                : {}),
              ...(automationData.overrides.readyToExecuting !== undefined
                ? { readyToExecuting: automationData.overrides.readyToExecuting }
                : {}),
            },
            queueProcessing: { enabled: automationData.effective.readyToExecuting },
          },
        })
        setTasks(tasksData)
        setArchivedTaskCount(clampArchivedCount(archivedCount))
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
        setAutomationSettings(automationData.effective)
        setQueueStatus(automationData.queueStatus)
        setPlanningMessages(planningMsgs)
        setForemanSlashCommands(buildForemanSlashCommands(workspaceSkills))
        setIdeaBacklog(ideaBacklogData)

        const tasksById = new Map(tasksData.map((task) => [task.id, task]))

        setRunningExecutionTaskIds(new Set(
          activeExecutions
            .filter((session) => {
              if (!session.isRunning) return false
              return tasksById.has(session.taskId)
            })
            .map((session) => session.taskId),
        ))

        setAwaitingInputTaskIds(new Set(
          activeExecutions
            .filter((session) => {
              if (!session.awaitingInput) return false
              return tasksById.has(session.taskId)
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

  // Lazy-load archived tasks only when the archive UI or archived task detail is needed.
  useEffect(() => {
    if (!workspaceId || isLoading) return

    if (isArchiveRoute) {
      void loadArchivedTasksIfNeeded()
      return
    }

    if (!taskId || selectedTask) {
      return
    }

    void loadArchivedTasksIfNeeded()
  }, [workspaceId, isLoading, isArchiveRoute, taskId, selectedTask, loadArchivedTasksIfNeeded])

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
  }, [taskId, isCreateRoute, isArchiveRoute])

  // Handle WebSocket messages
  useEffect(() => {
    return subscribe((msg) => {
      switch (msg.type) {
        case 'task:created': {
          setTasks((prev) => {
            if (prev.some((t) => t.id === msg.task.id)) return prev
            if (msg.task.frontmatter.phase === 'archived' && !archivedTasksLoaded) {
              return prev
            }
            return [msg.task, ...prev]
          })
          break
        }
        case 'task:updated': {
          setTasks((prev) => {
            const existingIndex = prev.findIndex((task) => task.id === msg.task.id)
            if (existingIndex === -1) {
              if (msg.task.frontmatter.phase === 'archived' && !archivedTasksLoaded) {
                return prev
              }
              return prev
            }

            const updated = [...prev]
            updated[existingIndex] = msg.task
            return updated
          })
          break
        }
        case 'task:moved': {
          const knownTask = tasksByIdRef.current.get(msg.task.id)
          const delta = getArchivedCountDelta(knownTask?.frontmatter.phase ?? msg.from, msg.to)
          if (delta !== 0) {
            setArchivedTaskCount((prev) => clampArchivedCount(prev + delta))
          }

          setTasks((prev) => {
            const existingIndex = prev.findIndex((task) => task.id === msg.task.id)

            if (msg.to === 'archived' && !archivedTasksLoaded) {
              if (existingIndex === -1) return prev

              const updated = [...prev]
              updated[existingIndex] = msg.task
              return updated
            }

            if (existingIndex === -1) {
              return [msg.task, ...prev]
            }

            const updated = [...prev]
            updated[existingIndex] = msg.task
            return updated
          })
          break
        }
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
          if (reorderedPhase === 'archived' && !archivedTasksLoaded) {
            break
          }

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
          setAutomationSettings((prev) => ({ ...prev, readyToExecuting: msg.status.enabled }))
          setWorkspace((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              config: {
                ...prev.config,
                queueProcessing: { enabled: msg.status.enabled },
              },
            }
          })
          break
        case 'workspace:automation_updated': {
          setAutomationSettings(msg.settings)
          setWorkspace((prev) => {
            if (!prev) return prev

            const overrides = msg.overrides || {}

            const nextWipLimits = {
              ...(prev.config.wipLimits || {}),
            }
            delete nextWipLimits.ready
            delete nextWipLimits.executing
            if (overrides.readyLimit !== undefined) {
              nextWipLimits.ready = overrides.readyLimit
            }
            if (overrides.executingLimit !== undefined) {
              nextWipLimits.executing = overrides.executingLimit
            }

            const nextWorkflowAutomation = {
              ...(prev.config.workflowAutomation || {}),
            }
            delete nextWorkflowAutomation.backlogToReady
            delete nextWorkflowAutomation.readyToExecuting
            if (overrides.backlogToReady !== undefined) {
              nextWorkflowAutomation.backlogToReady = overrides.backlogToReady
            }
            if (overrides.readyToExecuting !== undefined) {
              nextWorkflowAutomation.readyToExecuting = overrides.readyToExecuting
            }

            return {
              ...prev,
              config: {
                ...prev.config,
                wipLimits: nextWipLimits,
                workflowAutomation: nextWorkflowAutomation,
                queueProcessing: { enabled: msg.settings.readyToExecuting },
              },
            }
          })
          break
        }
        case 'agent:execution_status': {
          const task = tasksByIdRef.current.get(msg.taskId)

          setRunningExecutionTaskIds((prev) => {
            const next = new Set(prev)

            if (!task) {
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

          setAwaitingInputTaskIds((prev) => {
            const next = new Set(prev)

            if (!task) {
              next.delete(msg.taskId)
              return next
            }

            if (msg.status === 'awaiting_input') {
              next.add(msg.taskId)
            } else {
              next.delete(msg.taskId)
            }

            return next
          })

          break
        }
        case 'planning:session_reset':
          setSelectedArtifact(null)
          setAgentTaskFormUpdates(null)
          setNewTaskPrefill(null)
          setDraftTaskStates({})
          setCreatingDraftTaskIds(new Set())
          break
        case 'planning:task_form_updated':
          setAgentTaskFormUpdates(msg.formState)
          break
        case 'idea_backlog:updated':
          setIdeaBacklog(msg.backlog)
          break
        case 'shelf:updated':
          // Legacy event retained for compatibility with older clients/tools.
          break
      }
    })
  }, [subscribe, archivedTasksLoaded])

  // Create task
  const handleCreateTask = async (data: CreateTaskData) => {
    if (!workspaceId) return
    try {
      const { pendingFiles, sourceDraftId, ...taskData } = data
      const task = await api.createTask(workspaceId, taskData)
      if (pendingFiles && pendingFiles.length > 0) {
        try {
          await api.uploadAttachments(workspaceId, task.id, pendingFiles)
        } catch (uploadErr) {
          console.error('Failed to upload attachments:', uploadErr)
        }
      }

      if (sourceDraftId) {
        setDraftTaskStates((prev) => ({
          ...prev,
          [sourceDraftId]: { status: 'created', taskId: task.id },
        }))
      }

      setTasks((prev) => {
        if (prev.some((existingTask) => existingTask.id === task.id)) {
          return prev
        }
        return [task, ...prev]
      })

      setNewTaskPrefill(null)
      setAgentTaskFormUpdates(null)
      navigate(workspaceRootPath)
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

  const applyAutomationResult = useCallback((result: WorkflowAutomationResponse) => {
    setAutomationSettings(result.effective)
    setQueueStatus(result.queueStatus)
    setWorkspace((prev) => {
      if (!prev) return prev

      const nextWipLimits = {
        ...(prev.config.wipLimits || {}),
      }
      delete nextWipLimits.ready
      delete nextWipLimits.executing
      if (result.overrides.readyLimit !== undefined) {
        nextWipLimits.ready = result.overrides.readyLimit
      }
      if (result.overrides.executingLimit !== undefined) {
        nextWipLimits.executing = result.overrides.executingLimit
      }

      const nextWorkflowAutomation = {
        ...(prev.config.workflowAutomation || {}),
      }
      delete nextWorkflowAutomation.backlogToReady
      delete nextWorkflowAutomation.readyToExecuting
      if (result.overrides.backlogToReady !== undefined) {
        nextWorkflowAutomation.backlogToReady = result.overrides.backlogToReady
      }
      if (result.overrides.readyToExecuting !== undefined) {
        nextWorkflowAutomation.readyToExecuting = result.overrides.readyToExecuting
      }

      return {
        ...prev,
        config: {
          ...prev.config,
          wipLimits: nextWipLimits,
          workflowAutomation: nextWorkflowAutomation,
          queueProcessing: { enabled: result.effective.readyToExecuting },
        },
      }
    })
  }, [])

  const markTaskStopping = useCallback((id: string): boolean => {
    if (stoppingTaskIdsRef.current.has(id)) return false
    const next = new Set(stoppingTaskIdsRef.current)
    next.add(id)
    stoppingTaskIdsRef.current = next
    setStoppingTaskIds(next)
    return true
  }, [])

  const clearTaskStopping = useCallback((id: string) => {
    if (!stoppingTaskIdsRef.current.has(id)) return
    const next = new Set(stoppingTaskIdsRef.current)
    next.delete(id)
    stoppingTaskIdsRef.current = next
    setStoppingTaskIds(next)
  }, [])

  // Move task
  const handleMoveTask = async (task: Task, toPhase: Phase): Promise<boolean> => {
    if (!workspaceId) return false

    const updatedTask = {
      ...task,
      frontmatter: {
        ...task.frontmatter,
        phase: toPhase,
        updated: new Date().toISOString(),
      },
    }
    const archivedDelta = getArchivedCountDelta(task.frontmatter.phase, toPhase)

    setTasks((prev) => prev.map((t) => (t.id === task.id ? updatedTask : t)))
    tasksByIdRef.current.set(task.id, updatedTask)

    if (archivedDelta !== 0) {
      setArchivedTaskCount((prev) => clampArchivedCount(prev + archivedDelta))
    }

    if (task.frontmatter.phase === 'executing' && toPhase !== 'executing') {
      setRunningExecutionTaskIds((prev) => {
        if (!prev.has(task.id)) return prev
        const next = new Set(prev)
        next.delete(task.id)
        return next
      })
      setAwaitingInputTaskIds((prev) => {
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
      tasksByIdRef.current.set(task.id, result)
      return true
    } catch (err) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
      tasksByIdRef.current.set(task.id, task)

      if (archivedDelta !== 0) {
        setArchivedTaskCount((prev) => clampArchivedCount(prev - archivedDelta))
      }

      const message = err instanceof Error ? err.message : 'Failed to move task'
      setMoveError(message)
      showToast(message)
      console.error('Failed to move task:', err)
      return false
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

      try {
        // Reload active tasks to restore correct order on failure.
        const freshActiveTasks = await api.getTasks(workspaceId, 'active')
        setTasks((prev) => {
          if (!archivedTasksLoaded) {
            return freshActiveTasks
          }

          const knownArchivedTasks = prev.filter((task) => task.frontmatter.phase === 'archived')
          return mergeArchivedTasks(freshActiveTasks, knownArchivedTasks)
        })
      } catch (reloadErr) {
        console.error('Failed to reload tasks after reorder error:', reloadErr)
      }

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

  const handleStopTaskExecution = async (taskId: string) => {
    if (!workspaceId) return
    if (!markTaskStopping(taskId)) return

    try {
      const result = await api.stopTaskExecution(workspaceId, taskId)
      if (!result.stopped) {
        showToast('Agent is no longer running')
      }
    } catch (err) {
      console.error('Failed to stop task execution:', err)
      showToast('Failed to stop agent')
    } finally {
      clearTaskStopping(taskId)
    }
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

  const handleStopPlanningExecution = async () => {
    if (!workspaceId || stoppingPlanningRef.current) return
    stoppingPlanningRef.current = true
    setIsStoppingPlanning(true)
    try {
      const result = await api.stopPlanningExecution(workspaceId)
      if (!result.stopped) {
        showToast('Foreman is no longer running')
      }
    } catch (err) {
      console.error('Failed to stop planning execution:', err)
      showToast('Failed to stop foreman')
    } finally {
      stoppingPlanningRef.current = false
      setIsStoppingPlanning(false)
    }
  }

  const handleResetPlanning = async () => {
    if (!workspaceId) return
    try {
      await api.resetPlanningSession(workspaceId)
      setPlanningMessages([]) // Clear local state to reset the hook
      setSelectedArtifact(null)
      setAgentTaskFormUpdates(null)
      setNewTaskPrefill(null)
      setDraftTaskStates({})
      setCreatingDraftTaskIds(new Set())
    } catch (err) {
      console.error('Failed to reset planning session:', err)
    }
  }

  const handleOpenArtifact = useCallback((artifact: { id: string; name: string; html: string }) => {
    setSelectedArtifact({
      id: artifact.id,
      name: artifact.name,
      html: artifact.html,
      createdAt: new Date().toISOString(),
    })
    setActiveForemanPane('workspace')
    if (isCreateRoute || isArchiveRoute) {
      navigate(workspaceRootPath)
    }
  }, [isCreateRoute, isArchiveRoute, navigate, workspaceRootPath])

  const handleCloseArtifact = useCallback(() => {
    setSelectedArtifact(null)
  }, [])

  const handleAddIdea = useCallback(async (text: string) => {
    if (!workspaceId) return
    try {
      const updatedBacklog = await api.addIdeaBacklogItem(workspaceId, text)
      setIdeaBacklog(updatedBacklog)
    } catch (err) {
      console.error('Failed to add idea:', err)
      showToast('Failed to add idea')
    }
  }, [workspaceId, showToast])

  const handleDeleteIdea = useCallback(async (ideaId: string) => {
    if (!workspaceId) return
    try {
      const updatedBacklog = await api.removeIdeaBacklogItem(workspaceId, ideaId)
      setIdeaBacklog(updatedBacklog)
    } catch (err) {
      console.error('Failed to delete idea:', err)
      showToast('Failed to delete idea')
    }
  }, [workspaceId, showToast])

  const handleReorderIdeas = useCallback(async (ideaIds: string[]) => {
    if (!workspaceId || !ideaBacklog) return

    const originalBacklog = ideaBacklog
    const byId = new Map(originalBacklog.items.map((item) => [item.id, item] as const))
    const optimisticItems = ideaIds
      .map((id) => byId.get(id))
      .filter((item): item is IdeaBacklogItem => item !== undefined)

    if (optimisticItems.length !== originalBacklog.items.length) {
      return
    }

    setIdeaBacklog({ items: optimisticItems })

    try {
      const updatedBacklog = await api.reorderIdeaBacklog(workspaceId, ideaIds)
      setIdeaBacklog(updatedBacklog)
    } catch (err) {
      console.error('Failed to reorder ideas:', err)
      try {
        const latestBacklog = await api.getIdeaBacklog(workspaceId)
        setIdeaBacklog(latestBacklog)
      } catch {
        setIdeaBacklog(originalBacklog)
      }
      showToast('Failed to reorder ideas')
    }
  }, [workspaceId, ideaBacklog, showToast])

  const handlePromoteIdea = useCallback((idea: IdeaBacklogItem) => {
    setNewTaskPrefill({
      id: `${idea.id}-${Date.now()}`,
      formState: {
        content: idea.text,
      },
    })
    setAgentTaskFormUpdates(null)
    navigate(`${workspaceRootPath}/tasks/new`)
  }, [navigate, workspaceRootPath])

  const handleOpenDraftTask = useCallback((draftTask: DraftTask) => {
    const content = formatDraftTaskForNewTaskForm(draftTask)
    setNewTaskPrefill({
      id: `${draftTask.id}-${Date.now()}`,
      sourceDraftId: draftTask.id,
      formState: {
        content,
      },
    })
    setAgentTaskFormUpdates(null)
    navigate(`${workspaceRootPath}/tasks/new`)
  }, [navigate, workspaceRootPath])

  const handleCreateDraftTaskDirect = useCallback(async (draftTask: DraftTask) => {
    if (!workspaceId) return
    if (creatingDraftTaskIds.has(draftTask.id)) return

    setCreatingDraftTaskIds((prev) => {
      const next = new Set(prev)
      next.add(draftTask.id)
      return next
    })

    try {
      const task = await api.createTask(workspaceId, {
        title: draftTask.title,
        content: draftTask.content,
        acceptanceCriteria: draftTask.acceptanceCriteria,
        plan: draftTask.plan,
      })

      setDraftTaskStates((prev) => ({
        ...prev,
        [draftTask.id]: { status: 'created', taskId: task.id },
      }))
      showToast(`Added ${task.id} to backlog`)
    } catch (err) {
      console.error('Failed to create task from draft:', err)
      showToast('Failed to create task from draft')
    } finally {
      setCreatingDraftTaskIds((prev) => {
        const next = new Set(prev)
        next.delete(draftTask.id)
        return next
      })
    }
  }, [workspaceId, creatingDraftTaskIds, showToast])

  const handleDismissDraftTask = useCallback((draftTask: DraftTask) => {
    setDraftTaskStates((prev) => ({
      ...prev,
      [draftTask.id]: { status: 'dismissed' },
    }))
  }, [])

  // Q&A disambiguation handlers
  const handleQASubmit = async (answers: QAAnswer[]): Promise<boolean> => {
    if (!workspaceId || !planningStream.activeQARequest) return false
    try {
      await api.submitQAResponse(workspaceId, planningStream.activeQARequest.requestId, answers)
      return true
    } catch (err) {
      console.error('Failed to submit Q&A response:', err)
      showToast('Failed to submit answers')
      return false
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

  const handleToggleBacklogAutomation = async () => {
    if (!workspaceId || backlogAutomationToggling) return
    setBacklogAutomationToggling(true)
    try {
      const nextValue = !automationSettings.backlogToReady
      const result = await api.updateWorkflowAutomation(workspaceId, { backlogToReady: nextValue })
      applyAutomationResult(result)
    } catch (err) {
      console.error('Failed to toggle backlog auto-promotion:', err)
      showToast('Failed to toggle backlog auto-promotion')
    } finally {
      setBacklogAutomationToggling(false)
    }
  }

  const handleToggleReadyAutomation = async () => {
    if (!workspaceId || readyAutomationToggling) return
    setReadyAutomationToggling(true)
    try {
      const nextValue = !automationSettings.readyToExecuting
      const result = await api.updateWorkflowAutomation(workspaceId, { readyToExecuting: nextValue })
      applyAutomationResult(result)
    } catch (err) {
      console.error('Failed to toggle ready auto-execution:', err)
      showToast('Failed to toggle ready auto-execution')
    } finally {
      setReadyAutomationToggling(false)
    }
  }

  const handleToggleFactory = async () => {
    if (!workspaceId || factoryToggling) return

    setFactoryToggling(true)
    try {
      if (isFactoryRunning) {
        const automationResult = await api.updateWorkflowAutomation(workspaceId, {
          backlogToReady: false,
          readyToExecuting: false,
        })
        applyAutomationResult(automationResult)

        const taskIdsToStop = Array.from(liveExecutionTaskIds)
        let failedStops = 0

        await Promise.all(taskIdsToStop.map(async (activeTaskId) => {
          if (!markTaskStopping(activeTaskId)) return
          try {
            await api.stopTaskExecution(workspaceId, activeTaskId)
          } catch (err) {
            failedStops++
            console.error(`Failed to stop task ${activeTaskId}:`, err)
          } finally {
            clearTaskStopping(activeTaskId)
          }
        }))

        if (failedStops > 0) {
          showToast(`Factory paused, but ${failedStops} task${failedStops === 1 ? '' : 's'} failed to stop`)
        } else {
          showToast('Factory paused')
        }
      } else {
        const automationResult = await api.updateWorkflowAutomation(workspaceId, {
          backlogToReady: false,
          readyToExecuting: true,
        })
        applyAutomationResult(automationResult)
        showToast('Factory started')
      }
    } catch (err) {
      console.error('Failed to toggle factory state:', err)
      showToast('Failed to toggle factory state')
    } finally {
      setFactoryToggling(false)
    }
  }

  const handleOpenNewTask = useCallback(() => {
    setNewTaskPrefill(null)
    setAgentTaskFormUpdates(null)
    navigate(`${workspaceRootPath}/tasks/new`)
  }, [navigate, workspaceRootPath])

  const handleOpenIdeaBacklog = useCallback(() => {
    setActiveForemanPane('ideas')
    setSelectedArtifact(null)

    if (isTaskRoute || isCreateRoute || isArchiveRoute) {
      navigate(workspaceRootPath)
    }
  }, [isTaskRoute, isCreateRoute, isArchiveRoute, navigate, workspaceRootPath])

  const handleOpenArchive = useCallback(() => {
    setActiveForemanPane('workspace')
    setSelectedArtifact(null)
    navigate(workspaceArchivePath)
    void loadArchivedTasksIfNeeded()
  }, [navigate, workspaceArchivePath, loadArchivedTasksIfNeeded])

  const handleOpenArchiveInFileExplorer = useCallback(async () => {
    if (!workspaceId || openingArchiveExplorerRef.current) return

    openingArchiveExplorerRef.current = true
    setIsOpeningArchiveInFileExplorer(true)

    try {
      await api.openArchiveInFileExplorer(workspaceId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open archive in file explorer'
      showToast(message)
      console.error('Failed to open archive in file explorer:', err)
    } finally {
      openingArchiveExplorerRef.current = false
      setIsOpeningArchiveInFileExplorer(false)
    }
  }, [workspaceId, showToast])

  const handleRestoreArchivedTask = useCallback(async (
    targetTaskId: string,
    options?: { silent?: boolean },
  ): Promise<boolean> => {
    if (!workspaceId) return false
    const task = tasksByIdRef.current.get(targetTaskId)
    if (!task || task.frontmatter.phase !== 'archived') return false

    const optimisticTask: Task = {
      ...task,
      frontmatter: {
        ...task.frontmatter,
        phase: 'complete',
        updated: new Date().toISOString(),
      },
    }
    const archivedDelta = getArchivedCountDelta(task.frontmatter.phase, optimisticTask.frontmatter.phase)

    setTasks((prev) => prev.map((candidate) => (candidate.id === targetTaskId ? optimisticTask : candidate)))
    tasksByIdRef.current.set(targetTaskId, optimisticTask)

    if (archivedDelta !== 0) {
      setArchivedTaskCount((prev) => clampArchivedCount(prev + archivedDelta))
    }

    try {
      const result = await api.moveTask(workspaceId, targetTaskId, 'complete', 'restore from archive')
      setTasks((prev) => prev.map((candidate) => (candidate.id === targetTaskId ? result : candidate)))
      tasksByIdRef.current.set(targetTaskId, result)
      return true
    } catch (err) {
      setTasks((prev) => prev.map((candidate) => (candidate.id === targetTaskId ? task : candidate)))
      tasksByIdRef.current.set(targetTaskId, task)

      if (archivedDelta !== 0) {
        setArchivedTaskCount((prev) => clampArchivedCount(prev - archivedDelta))
      }

      if (!options?.silent) {
        const message = err instanceof Error ? err.message : 'Failed to restore archived task'
        showToast(message)
      }
      console.error('Failed to restore archived task:', err)
      return false
    }
  }, [workspaceId, showToast])

  const handleDeleteArchivedTask = useCallback(async (
    targetTaskId: string,
    options?: { silent?: boolean },
  ): Promise<boolean> => {
    if (!workspaceId) return false

    const existingTask = tasksByIdRef.current.get(targetTaskId)

    try {
      await api.deleteTask(workspaceId, targetTaskId)
      setTasks((prev) => prev.filter((candidate) => candidate.id !== targetTaskId))
      tasksByIdRef.current.delete(targetTaskId)

      if (existingTask?.frontmatter.phase === 'archived') {
        setArchivedTaskCount((prev) => clampArchivedCount(prev - 1))
      }

      if (taskId === targetTaskId) {
        navigate(workspaceRootPath)
      }

      return true
    } catch (err) {
      if (!options?.silent) {
        const message = err instanceof Error ? err.message : 'Failed to delete archived task'
        showToast(message)
      }
      console.error('Failed to delete archived task:', err)
      return false
    }
  }, [workspaceId, taskId, navigate, workspaceRootPath, showToast])

  const handleBulkRestoreArchivedTasks = useCallback(async (taskIds: string[]) => {
    const dedupedIds = Array.from(new Set(taskIds))
    if (dedupedIds.length === 0) return

    let restored = 0
    let failed = 0

    for (const taskId of dedupedIds) {
      const success = await handleRestoreArchivedTask(taskId, { silent: true })
      if (success) {
        restored++
      } else {
        failed++
      }
    }

    if (failed > 0 && restored > 0) {
      showToast(`Restored ${restored} task${restored === 1 ? '' : 's'}; ${failed} failed`)
    } else if (failed > 0) {
      showToast(`Failed to restore ${failed} task${failed === 1 ? '' : 's'}`)
    } else {
      showToast(`Restored ${restored} task${restored === 1 ? '' : 's'} to complete`)
    }
  }, [handleRestoreArchivedTask, showToast])

  const handleBulkDeleteArchivedTasks = useCallback(async (taskIds: string[]) => {
    const dedupedIds = Array.from(new Set(taskIds))
    if (dedupedIds.length === 0) return

    let deleted = 0
    let failed = 0

    for (const taskId of dedupedIds) {
      const success = await handleDeleteArchivedTask(taskId, { silent: true })
      if (success) {
        deleted++
      } else {
        failed++
      }
    }

    if (failed > 0 && deleted > 0) {
      showToast(`Deleted ${deleted} task${deleted === 1 ? '' : 's'}; ${failed} failed`)
    } else if (failed > 0) {
      showToast(`Failed to delete ${failed} task${failed === 1 ? '' : 's'}`)
    } else {
      showToast(`Deleted ${deleted} archived task${deleted === 1 ? '' : 's'}`)
    }
  }, [handleDeleteArchivedTask, showToast])

  const handleResize = useCallback((delta: number) => {
    // delta is positive when dragging right — expand the left pane
    setLeftPaneWidth((prev) => Math.min(LEFT_PANE_MAX, Math.max(LEFT_PANE_MIN, prev - delta)))
  }, [])

  const handleVoiceDictationStateChange = useCallback((nextIsDictating: boolean) => {
    setIsVoiceDictating(nextIsDictating)
  }, [])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onEscape: useCallback(() => {
      if (isTaskRoute || isCreateRoute || isArchiveRoute) {
        navigate(workspaceRootPath)
      }
    }, [isTaskRoute, isCreateRoute, isArchiveRoute, navigate, workspaceRootPath]),
    onFocusChat: useCallback(() => {
      const textarea = document.querySelector('[data-chat-input]') as HTMLTextAreaElement | null
      textarea?.focus()
    }, []),
    voiceInputHotkey,
    onVoiceHotkeyDown: useCallback(() => {
      setIsVoiceHotkeyPressed(true)
    }, []),
    onVoiceHotkeyUp: useCallback(() => {
      setIsVoiceHotkeyPressed(false)
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
  const isIdeaBacklogActive = mode === 'foreman' && !isCreateRoute && !isArchiveRoute && activeForemanPane === 'ideas'

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white shadow-lg shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <h1 className="text-lg font-bold tracking-tight">TASK FACTORY</h1>
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
              <>
                <div className="h-5 w-px bg-slate-700" />
                <span className="text-xs text-slate-500 font-mono">
                  {awaitingInputCount > 0 && <span className="text-amber-500">{awaitingInputCount} needs input</span>}
                  {runningCount > 0 && <span className={awaitingInputCount > 0 ? 'text-orange-400 ml-2' : 'text-orange-400'}>{runningCount} running</span>}
                  {counts.ready > 0 && <span className="text-blue-400 ml-2">{counts.ready} ready</span>}
                  {counts.complete > 0 && <span className="text-emerald-400 ml-2">{counts.complete} done</span>}
                </span>
              </>
            )
          })()}
          <div className="h-5 w-px bg-slate-700" />
          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenNewTask}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
                isCreateRoute
                  ? 'bg-blue-500 text-white border-blue-400'
                  : 'bg-slate-800 text-blue-200 border-slate-700 hover:bg-slate-700'
              }`}
              title="Create a new task"
            >
              <AppIcon icon={Plus} size="xs" />
              New Task
            </button>
            <button
              onClick={handleOpenIdeaBacklog}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
                isIdeaBacklogActive
                  ? 'bg-amber-500 text-slate-900 border-amber-400'
                  : 'bg-slate-800 text-amber-200 border-slate-700 hover:bg-slate-700'
              }`}
              title="Open workspace idea backlog"
            >
              <AppIcon icon={Lightbulb} size="xs" />
              Idea Backlog
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleToggleFactory}
            disabled={factoryToggling}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
              isFactoryRunning
                ? 'bg-red-600 text-white border-red-700 hover:bg-red-500'
                : 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-500'
            } ${factoryToggling ? 'opacity-60 cursor-not-allowed' : ''}`}
            title={isFactoryRunning ? 'Stop all workspace automation and running executions' : 'Start workspace automation'}
          >
            {factoryToggling ? (
              <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <AppIcon icon={Power} size="xs" />
            )}
            {isFactoryRunning ? 'STOP FACTORY' : 'START FACTORY'}
          </button>
          {isVoiceDictating && (
            <span
              className="inline-flex items-center gap-1.5 rounded-md border border-red-400/40 bg-red-500/20 px-2.5 py-1 text-xs font-mono text-red-100"
              role="status"
              aria-live="polite"
            >
              <span className="h-2 w-2 rounded-full bg-red-300 animate-pulse" />
              Listening… speak now
            </span>
          )}
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
            Workspace Config
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
                onStop={handleStopPlanningExecution}
                isStopping={isStoppingPlanning}
                onUploadFiles={handlePlanningUpload}
                getAttachmentUrl={(storedName) => api.getPlanningAttachmentUrl(workspaceId!, storedName)}
                onReset={handleResetPlanning}
                title="Foreman"
                emptyState={{ title: 'Foreman', subtitle: 'Ask me to research, plan, or decompose work into tasks. Try /help for slash commands.' }}
                slashCommands={foremanSlashCommands}
                headerSlot={
                  <ModelSelector
                    value={foremanModelConfig ?? undefined}
                    onChange={(config) => {
                      setForemanModelConfig(config ?? null).catch((err) => {
                        console.error('Failed to save foreman model:', err)
                      })
                    }}
                    compact
                  />
                }
                bottomSlot={
                  planningStream.activeQARequest ? (
                    <QADialog
                      request={planningStream.activeQARequest}
                      onSubmit={handleQASubmit}
                      onAbort={handleQAAbort}
                    />
                  ) : undefined
                }
                onOpenArtifact={handleOpenArtifact}
                onOpenDraftTask={handleOpenDraftTask}
                onCreateDraftTask={handleCreateDraftTaskDirect}
                onDismissDraftTask={handleDismissDraftTask}
                draftTaskStates={draftTaskStates}
                creatingDraftTaskIds={creatingDraftTaskIds}
                isVoiceHotkeyPressed={isVoiceHotkeyPressed}
                onVoiceDictationStateChange={handleVoiceDictationStateChange}
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
                      isAwaitingInput={awaitingTaskIds.has(selectedTask.id)}
                      workspaceId={workspaceId || ''}
                      entries={activity}
                      attachments={selectedTask.frontmatter.attachments || []}
                      agentStream={agentStream}
                      onSendMessage={(content, attachmentIds) => handleSendMessage(selectedTask.id, content, attachmentIds)}
                      onSteer={(content, attachmentIds) => handleSteer(selectedTask.id, content, attachmentIds)}
                      onFollowUp={(content, attachmentIds) => handleFollowUp(selectedTask.id, content, attachmentIds)}
                      onStop={() => handleStopTaskExecution(selectedTask.id)}
                      isStopping={stoppingTaskIds.has(selectedTask.id)}
                      isVoiceHotkeyPressed={isVoiceHotkeyPressed}
                      onVoiceDictationStateChange={handleVoiceDictationStateChange}
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
                  key={`create-task-${workspaceId || ''}`}
                  workspaceId={workspaceId || ''}
                  onCancel={() => {
                    setNewTaskPrefill(null)
                    setAgentTaskFormUpdates(null)
                    navigate(workspaceRootPath)
                  }}
                  onSubmit={handleCreateTask}
                  agentFormUpdates={agentTaskFormUpdates}
                  prefillRequest={newTaskPrefill}
                />
              ) : isArchiveRoute ? (
                archivedTasksLoading && !archivedTasksLoaded ? (
                  <div className="flex h-full items-center justify-center text-slate-500">
                    <p className="text-sm font-medium">Loading archive…</p>
                  </div>
                ) : (
                  <ArchivePane
                    archivedTasks={archivedTasks}
                    onBack={() => navigate(workspaceRootPath)}
                    onOpenInFileExplorer={handleOpenArchiveInFileExplorer}
                    isOpeningInFileExplorer={isOpeningArchiveInFileExplorer}
                    onRestoreTask={handleRestoreArchivedTask}
                    onDeleteTask={handleDeleteArchivedTask}
                    onBulkRestoreTasks={handleBulkRestoreArchivedTasks}
                    onBulkDeleteTasks={handleBulkDeleteArchivedTasks}
                  />
                )
              ) : activeForemanPane === 'ideas' ? (
                <IdeaBacklogPane
                  backlog={ideaBacklog}
                  onBack={() => setActiveForemanPane('workspace')}
                  onAddIdea={handleAddIdea}
                  onDeleteIdea={handleDeleteIdea}
                  onReorderIdeas={handleReorderIdeas}
                  onPromoteIdea={handlePromoteIdea}
                />
              ) : (
                <ShelfPane
                  activeArtifact={selectedArtifact}
                  onCloseArtifact={handleCloseArtifact}
                />
              )
            ) : selectedTask ? (
              <TaskDetailPane
                task={selectedTask}
                workspaceId={workspaceId || ''}
                moveError={moveError}
                isPlanGenerating={planGeneratingTaskIds.has(selectedTask.id)}
                isAgentRunning={runningTaskIds.has(selectedTask.id)}
                isAwaitingInput={awaitingTaskIds.has(selectedTask.id)}
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
            awaitingInputTaskIds={awaitingTaskIds}
            selectedTaskId={selectedTask?.id || null}
            automationSettings={effectiveAutomationSettings}
            backlogAutomationToggling={backlogAutomationToggling}
            readyAutomationToggling={readyAutomationToggling}
            onToggleBacklogAutomation={handleToggleBacklogAutomation}
            onToggleReadyAutomation={handleToggleReadyAutomation}
            onTaskClick={handleSelectTask}
            onMoveTask={handleMoveTask}
            onReorderTasks={handleReorderTasks}
            onCreateTask={handleOpenNewTask}
            archivedCount={effectiveArchivedCount}
            onOpenArchive={handleOpenArchive}
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

