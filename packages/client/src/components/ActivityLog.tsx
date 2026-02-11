import { useState, useRef, useEffect } from 'react'
import type { ActivityEntry, TaskType } from '@pi-factory/shared'
import { formatDistanceToNow } from 'date-fns'

interface ActivityLogProps {
  entries: ActivityEntry[]
  onTaskClick: (task: any) => void
  onSendMessage: (taskId: string, content: string) => void
}

const TYPE_COLORS: Record<string, string> = {
  feature: 'bg-blue-500',
  bug: 'bg-red-500',
  refactor: 'bg-purple-500',
  research: 'bg-amber-500',
  spike: 'bg-cyan-500',
}

export function ActivityLog({ entries, onTaskClick, onSendMessage }: ActivityLogProps) {
  const [inputValue, setInputValue] = useState('')
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [entries.length])

  // Group entries by task
  const groupedEntries = groupEntriesByTask(entries)

  const handleSend = () => {
    if (!inputValue.trim() || !activeTaskId) return
    onSendMessage(activeTaskId, inputValue)
    setInputValue('')
  }

  return (
    <div className="activity-log">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
        <h2 className="font-semibold text-sm text-slate-700">Activity Log</h2>
        <span className="text-xs text-slate-500">{entries.length} entries</span>
      </div>

      {/* Entries */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {groupedEntries.map((group, groupIndex) => (
          <div key={group.taskId + groupIndex}>
            {/* Task Separator */}
            <div
              className="task-separator cursor-pointer hover:bg-slate-100 transition-colors"
              onClick={() => onTaskClick({ id: group.taskId, frontmatter: { title: group.taskTitle, type: group.taskType } })}
            >
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${TYPE_COLORS[group.taskType] || 'bg-slate-400'}`} />
                <span className="font-mono text-xs text-slate-500">{group.taskId}</span>
                <span className="font-medium text-sm text-slate-800 truncate">{group.taskTitle}</span>
              </div>
              <div className="text-xs text-slate-400 mt-1">
                {formatDistanceToNow(new Date(group.startTime))} ago
              </div>
            </div>

            {/* Messages */}
            <div className="py-2">
              {group.messages.map((entry) => (
                <div
                  key={entry.id}
                  className={`px-4 py-2 ${entry.role === 'user' ? 'bg-blue-50' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-medium text-slate-500 w-12 shrink-0">
                      {entry.role === 'user' ? 'You' : 'Agent'}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm text-slate-800 whitespace-pre-wrap">{entry.content}</p>
                      <span className="text-xs text-slate-400 mt-1">
                        {formatDistanceToNow(new Date(entry.timestamp))} ago
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {group.systemEvents.map((entry) => (
                <div key={entry.id} className="px-4 py-1">
                  <div className="flex items-center justify-center">
                    <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                      {entry.message}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {entries.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <p className="text-sm">No activity yet</p>
            <p className="text-xs mt-1">Tasks will appear here when agents start working</p>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-slate-200 p-3 bg-white">
        {activeTaskId ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Replying to:</span>
              <span className="font-mono text-blue-600">{activeTaskId}</span>
              <button
                onClick={() => setActiveTaskId(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Type a message..."
                className="flex-1 input text-sm"
                autoFocus
              />
              <button
                onClick={handleSend}
                disabled={!inputValue.trim()}
                className="btn btn-primary text-sm py-1.5 px-3 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center text-sm text-slate-400">
            Click a task separator to reply
          </div>
        )}
      </div>
    </div>
  )
}

interface GroupedEntries {
  taskId: string
  taskTitle: string
  taskType: TaskType
  startTime: string
  messages: Extract<ActivityEntry, { type: 'chat-message' }>[]
  systemEvents: Extract<ActivityEntry, { type: 'system-event' }>[]
}

function groupEntriesByTask(entries: ActivityEntry[]): GroupedEntries[] {
  const groups: GroupedEntries[] = []
  let currentGroup: GroupedEntries | null = null

  // Process in reverse chronological order (newest first)
  for (const entry of entries) {
    if (entry.type === 'task-separator') {
      currentGroup = {
        taskId: entry.taskId,
        taskTitle: entry.taskTitle,
        taskType: entry.taskType,
        startTime: entry.timestamp,
        messages: [],
        systemEvents: [],
      }
      groups.push(currentGroup)
    } else if (currentGroup && entry.taskId === currentGroup.taskId) {
      if (entry.type === 'chat-message') {
        currentGroup.messages.push(entry)
      } else if (entry.type === 'system-event') {
        currentGroup.systemEvents.push(entry)
      }
    }
  }

  return groups
}
