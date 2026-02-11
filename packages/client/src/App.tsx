import { useState, useEffect, useCallback } from 'react'
import type { Task, Workspace, ActivityEntry, Phase } from '@pi-factory/shared'
import { PHASES } from '@pi-factory/shared'
import { KanbanBoard } from './components/KanbanBoard'
import { ActivityLog } from './components/ActivityLog'
import { TaskDetail } from './components/TaskDetail'
import { WorkspaceSelector } from './components/WorkspaceSelector'
import { CreateTaskModal } from './components/CreateTaskModal'
import { PiSettings } from './components/PiSettings'
import { WorkspacePiConfig } from './components/WorkspacePiConfig'
import { useWebSocket } from './hooks/useWebSocket'

// API client
const api = {
  async getWorkspaces(): Promise<Workspace[]> {
    const res = await fetch('/api/workspaces')
    return res.json()
  },
  async getWorkspace(id: string): Promise<Workspace> {
    const res = await fetch(`/api/workspaces/${id}`)
    return res.json()
  },
  async getTasks(workspaceId: string): Promise<Task[]> {
    const res = await fetch(`/api/workspaces/${workspaceId}/tasks`)
    return res.json()
  },
  async getActivity(workspaceId: string, limit = 100): Promise<ActivityEntry[]> {
    const res = await fetch(`/api/workspaces/${workspaceId}/activity?limit=${limit}`)
    return res.json()
  },
  async createTask(workspaceId: string, data: any): Promise<Task> {
    const res = await fetch(`/api/workspaces/${workspaceId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return res.json()
  },
  async moveTask(workspaceId: string, taskId: string, toPhase: Phase, reason?: string): Promise<Task> {
    const res = await fetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toPhase, reason }),
    })
    return res.json()
  },
  async sendMessage(workspaceId: string, taskId: string, content: string, role: 'user' | 'agent'): Promise<ActivityEntry> {
    const res = await fetch(`/api/workspaces/${workspaceId}/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, content, role }),
    })
    return res.json()
  },
}

function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showPiSettings, setShowPiSettings] = useState(false)
  const [showWorkspaceConfig, setShowWorkspaceConfig] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // WebSocket connection
  const { lastMessage, isConnected } = useWebSocket(
    currentWorkspace?.id || null
  )

  // Load workspaces on mount
  useEffect(() => {
    api.getWorkspaces().then((w) => {
      setWorkspaces(w)
      if (w.length > 0 && !currentWorkspace) {
        loadWorkspace(w[0].id)
      }
      setIsLoading(false)
    })
  }, [])

  // Load workspace data
  const loadWorkspace = useCallback(async (id: string) => {
    setIsLoading(true)
    const [workspace, tasksData, activityData] = await Promise.all([
      api.getWorkspace(id),
      api.getTasks(id),
      api.getActivity(id, 100),
    ])
    setCurrentWorkspace(workspace)
    setTasks(tasksData)
    setActivity(activityData)
    setIsLoading(false)
  }, [])

  // Handle WebSocket messages
  useEffect(() => {
    if (!lastMessage) return

    switch (lastMessage.type) {
      case 'task:created':
        setTasks((prev) => [lastMessage.task, ...prev])
        break
      case 'task:updated':
        setTasks((prev) =>
          prev.map((t) => (t.id === lastMessage.task.id ? lastMessage.task : t))
        )
        if (selectedTask?.id === lastMessage.task.id) {
          setSelectedTask(lastMessage.task)
        }
        break
      case 'task:moved':
        setTasks((prev) =>
          prev.map((t) => (t.id === lastMessage.task.id ? lastMessage.task : t))
        )
        // Also update selected task if it's the one that moved
        if (selectedTask?.id === lastMessage.task.id) {
          setSelectedTask(lastMessage.task)
        }
        break
      case 'activity:entry':
        setActivity((prev) => [lastMessage.entry, ...prev])
        break
    }
  }, [lastMessage, selectedTask])

  // Create workspace
  const handleCreateWorkspace = async (path: string, name: string) => {
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name }),
    })
    const workspace = await res.json()
    setWorkspaces((prev) => [workspace, ...prev])
    await loadWorkspace(workspace.id)
  }

  // Create task
  const handleCreateTask = async (data: any) => {
    if (!currentWorkspace) return
    await api.createTask(currentWorkspace.id, data)
    setShowCreateModal(false)
  }

  // Move task
  const handleMoveTask = async (task: Task, toPhase: Phase) => {
    if (!currentWorkspace) return
    
    // Optimistically update the task in local state
    const updatedTask = {
      ...task,
      frontmatter: {
        ...task.frontmatter,
        phase: toPhase,
        updated: new Date().toISOString(),
      },
    }
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? updatedTask : t))
    )
    
    try {
      const result = await api.moveTask(currentWorkspace.id, task.id, toPhase)
      // Update with server response
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? result : t))
      )
    } catch (err) {
      // Revert on error
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? task : t))
      )
      console.error('Failed to move task:', err)
    }
  }

  // Send message
  const handleSendMessage = async (taskId: string, content: string) => {
    if (!currentWorkspace) return
    await api.sendMessage(currentWorkspace.id, taskId, content, 'user')
  }

  // Group tasks by phase
  const tasksByPhase = PHASES.reduce((acc, phase) => {
    acc[phase] = tasks.filter((t) => t.frontmatter.phase === phase)
    return acc
  }, {} as Record<Phase, Task[]>)

  if (isLoading && !currentWorkspace) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-slate-300 border-t-safety-orange rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600 font-medium">Loading Pi-Factory...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white shadow-lg">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-safety-orange rounded-lg flex items-center justify-center font-bold text-sm">
              π
            </div>
            <h1 className="text-lg font-bold tracking-tight">PI-FACTORY</h1>
          </div>
          <div className="h-6 w-px bg-slate-700" />
          <WorkspaceSelector
            workspaces={workspaces}
            current={currentWorkspace}
            onSelect={loadWorkspace}
            onCreate={handleCreateWorkspace}
          />
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
          {currentWorkspace && (
            <button
              onClick={() => setShowWorkspaceConfig(true)}
              className="text-slate-400 hover:text-white transition-colors"
              title="Workspace Pi Config"
            >
              🛠️
            </button>
          )}
          <button
            onClick={() => setShowPiSettings(true)}
            className="text-slate-400 hover:text-white transition-colors"
            title="Pi Settings"
          >
            ⚙️
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn btn-primary text-sm py-1.5 px-3"
          >
            + New Task
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Kanban Board */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <KanbanBoard
            tasksByPhase={tasksByPhase}
            onTaskClick={setSelectedTask}
            onMoveTask={handleMoveTask}
            wipLimits={currentWorkspace?.config.wipLimits}
          />
        </div>

        {/* Activity Log Sidebar */}
        <div className="w-[380px] flex-shrink-0">
          <ActivityLog
            entries={activity}
            onTaskClick={setSelectedTask}
            onSendMessage={handleSendMessage}
          />
        </div>
      </div>

      {/* Modals */}
      {selectedTask && currentWorkspace && (
        <TaskDetail
          task={selectedTask}
          workspaceId={currentWorkspace.id}
          onClose={() => setSelectedTask(null)}
          onMove={(phase) => handleMoveTask(selectedTask, phase)}
          onDelete={() => {
            setTasks(prev => prev.filter(t => t.id !== selectedTask.id))
          }}
        />
      )}

      {showCreateModal && (
        <CreateTaskModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateTask}
        />
      )}

      {showPiSettings && (
        <PiSettings
          onClose={() => setShowPiSettings(false)}
        />
      )}

      {showWorkspaceConfig && currentWorkspace && (
        <WorkspacePiConfig
          workspaceId={currentWorkspace.id}
          onClose={() => setShowWorkspaceConfig(false)}
        />
      )}
    </div>
  )
}

export default App
