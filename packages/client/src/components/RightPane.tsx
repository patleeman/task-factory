import type { Task, Phase, ActivityEntry } from '@pi-factory/shared'
import type { AgentStreamState } from '../hooks/useAgentStreaming'
import { TaskDetailPane } from './TaskDetailPane'
import { CreateTaskPane, type CreateTaskData } from './CreateTaskPane'
import { ActivityLog } from './ActivityLog'

export type RightPaneMode =
  | { type: 'activity' }
  | { type: 'task-detail'; task: Task }
  | { type: 'create-task' }

interface RightPaneProps {
  mode: RightPaneMode
  workspaceId: string | undefined

  // Activity log props
  activity: ActivityEntry[]
  onActivityTaskClick: (task: any) => void
  onSendMessage: (taskId: string, content: string, attachmentIds?: string[]) => void

  // Agent streaming state
  agentStream: AgentStreamState

  // Task detail props
  moveError: string | null
  onTaskClose: () => void
  onTaskMove: (phase: Phase) => void
  onTaskDelete: () => void
  onSteer: (taskId: string, content: string, attachmentIds?: string[]) => void
  onFollowUp: (taskId: string, content: string, attachmentIds?: string[]) => void

  // Create task props
  onCreateCancel: () => void
  onCreateSubmit: (data: CreateTaskData) => void
}

export function RightPane({
  mode,
  workspaceId,
  activity,
  onActivityTaskClick,
  onSendMessage,
  agentStream,
  moveError,
  onTaskClose,
  onTaskMove,
  onTaskDelete,
  onSteer,
  onFollowUp,
  onCreateCancel,
  onCreateSubmit,
}: RightPaneProps) {
  switch (mode.type) {
    case 'task-detail':
      return (
        <TaskDetailPane
          task={mode.task}
          workspaceId={workspaceId || ''}
          activity={activity}
          agentStream={agentStream}
          moveError={moveError}
          onClose={onTaskClose}
          onMove={onTaskMove}
          onDelete={onTaskDelete}
          onSendMessage={onSendMessage}
          onSteer={onSteer}
          onFollowUp={onFollowUp}
        />
      )

    case 'create-task':
      return (
        <CreateTaskPane
          onCancel={onCreateCancel}
          onSubmit={onCreateSubmit}
        />
      )

    case 'activity':
    default:
      return (
        <ActivityLog
          entries={activity}
          onTaskClick={onActivityTaskClick}
        />
      )
  }
}
