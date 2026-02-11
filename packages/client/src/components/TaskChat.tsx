import { useState, useRef, useEffect } from 'react'
import type { ActivityEntry, AgentExecutionStatus } from '@pi-factory/shared'
import type { AgentStreamState, ToolCallState } from '../hooks/useAgentStreaming'
import { formatDistanceToNow } from 'date-fns'
import ReactMarkdown from 'react-markdown'

type SendMode = 'message' | 'steer' | 'followUp'

interface TaskChatProps {
  taskId: string
  workspaceId?: string
  entries: ActivityEntry[]
  agentStream: AgentStreamState
  onSendMessage: (content: string) => void
  onSteer: (content: string) => void
  onFollowUp: (content: string) => void
}

// Status label + color
const STATUS_CONFIG: Record<AgentExecutionStatus, { label: string; color: string; pulse?: boolean }> = {
  idle: { label: 'Idle', color: 'bg-slate-400' },
  streaming: { label: 'Generating', color: 'bg-blue-500', pulse: true },
  tool_use: { label: 'Running tool', color: 'bg-orange-500', pulse: true },
  thinking: { label: 'Thinking', color: 'bg-purple-500', pulse: true },
  completed: { label: 'Done', color: 'bg-green-500' },
  error: { label: 'Error', color: 'bg-red-500' },
}

export function TaskChat({
  taskId,
  entries,
  agentStream,
  onSendMessage,
  onSteer,
  onFollowUp,
}: TaskChatProps) {
  const [input, setInput] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [sendMode, setSendMode] = useState<SendMode>('message')
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Filter entries for this task, chronological (oldest first)
  const taskEntries = entries.filter((e) => e.taskId === taskId).reverse()

  // Auto-scroll on new messages or streaming text
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [taskEntries.length, agentStream.streamingText.length])

  // When agent starts streaming, auto-switch to steer mode
  useEffect(() => {
    if (agentStream.isActive) {
      setSendMode('steer')
    } else {
      setSendMode('message')
    }
  }, [agentStream.isActive])

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed) return

    switch (sendMode) {
      case 'steer':
        onSteer(trimmed)
        break
      case 'followUp':
        onFollowUp(trimmed)
        break
      default:
        onSendMessage(trimmed)
    }

    setInput('')
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isComposing) return

    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      handleSend()
    } else if (e.key === 'Enter' && e.altKey) {
      // Alt+Enter = follow-up (like Pi)
      e.preventDefault()
      if (agentStream.isActive) {
        const trimmed = input.trim()
        if (trimmed) {
          onFollowUp(trimmed)
          setInput('')
        }
      }
    }
  }

  const statusConfig = STATUS_CONFIG[agentStream.status]

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Status bar */}
      {agentStream.isActive && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-50 border-t border-b border-slate-200 shrink-0">
          <span className={`w-2 h-2 rounded-full ${statusConfig.color} ${statusConfig.pulse ? 'animate-pulse' : ''}`} />
          <span className="text-xs font-medium text-slate-600">{statusConfig.label}</span>
          {agentStream.status === 'tool_use' && agentStream.toolCalls.length > 0 && (
            <span className="text-xs text-slate-400 font-mono">
              {agentStream.toolCalls[agentStream.toolCalls.length - 1].toolName}
            </span>
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        <div className="p-4 space-y-1">
          {taskEntries.length === 0 && !agentStream.isActive && (
            <div className="text-center py-12">
              <div className="text-slate-300 text-3xl mb-3">💬</div>
              <p className="text-sm text-slate-400">No messages yet</p>
              <p className="text-xs text-slate-400 mt-1">
                Send a message or execute the task to start chatting
              </p>
            </div>
          )}

          {taskEntries.map((entry) => {
            if (entry.type === 'system-event') {
              return (
                <div key={entry.id} className="flex justify-center py-2">
                  <span className="text-xs text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
                    {entry.message}
                  </span>
                </div>
              )
            }

            if (entry.type === 'chat-message') {
              const isUser = entry.role === 'user'
              return (
                <div key={entry.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-1`}>
                  <div className={`chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-agent'}`}>
                    <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${
                      isUser ? 'text-blue-200' : 'text-slate-400'
                    }`}>
                      {isUser ? 'You' : 'Agent'}
                    </div>
                    {isUser ? (
                      <p className="text-sm whitespace-pre-wrap break-words">{entry.content}</p>
                    ) : (
                      <div className="chat-markdown text-sm">
                        <ReactMarkdown>{entry.content}</ReactMarkdown>
                      </div>
                    )}
                    <div className={`text-[10px] mt-1.5 ${isUser ? 'text-blue-200' : 'text-slate-400'}`}>
                      {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              )
            }

            return null
          })}

          {/* Live thinking block */}
          {agentStream.thinkingText && (
            <ThinkingBlock text={agentStream.thinkingText} />
          )}

          {/* Live tool calls */}
          {agentStream.toolCalls.map((tc) => (
            <ToolCallBlock key={tc.toolCallId} toolCall={tc} />
          ))}

          {/* Live streaming text */}
          {agentStream.streamingText && (
            <div className="flex justify-start mb-1">
              <div className="chat-bubble chat-bubble-agent">
                <div className="text-[10px] font-semibold uppercase tracking-wider mb-1 text-slate-400">
                  Agent
                  <span className="inline-block w-1 h-3 bg-slate-400 ml-1 animate-pulse align-middle" />
                </div>
                <div className="chat-markdown text-sm">
                  <ReactMarkdown>{agentStream.streamingText}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-slate-200 bg-white">
        {/* Send mode selector (only when agent is active) */}
        {agentStream.isActive && (
          <div className="flex items-center gap-1 px-3 pt-2 pb-0">
            <button
              onClick={() => setSendMode('steer')}
              className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full transition-colors ${
                sendMode === 'steer'
                  ? 'bg-orange-100 text-orange-700'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              ⚡ Steer
            </button>
            <button
              onClick={() => setSendMode('followUp')}
              className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full transition-colors ${
                sendMode === 'followUp'
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              📋 Follow-up
            </button>
            <span className="text-[10px] text-slate-300 ml-auto">
              {sendMode === 'steer' ? 'Interrupts after current tool' : 'Delivered when agent finishes'}
            </span>
          </div>
        )}

        <div className="flex gap-2 items-end p-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            placeholder={
              agentStream.isActive
                ? sendMode === 'steer'
                  ? 'Steer the agent... (Enter to send)'
                  : 'Queue follow-up... (Enter to send)'
                : 'Message the agent... (Enter to send, Shift+Enter for newline)'
            }
            className={`flex-1 resize-none rounded-lg border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 min-h-[36px] max-h-[120px] transition-colors ${
              agentStream.isActive && sendMode === 'steer'
                ? 'border-orange-300 focus:border-orange-400 focus:ring-orange-200'
                : agentStream.isActive && sendMode === 'followUp'
                ? 'border-blue-300 focus:border-blue-400 focus:ring-blue-200'
                : 'border-slate-300 focus:border-blue-400 focus:ring-blue-200'
            }`}
            rows={1}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement
              target.style.height = 'auto'
              target.style.height = Math.min(target.scrollHeight, 120) + 'px'
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className={`btn text-sm py-1.5 px-3 shrink-0 disabled:opacity-40 ${
              agentStream.isActive && sendMode === 'steer'
                ? 'bg-orange-600 text-white hover:bg-orange-700'
                : 'btn-primary'
            }`}
          >
            {agentStream.isActive && sendMode === 'steer' ? '⚡ Steer' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Thinking Block
// =============================================================================

function ThinkingBlock({ text }: { text: string }) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="flex justify-start mb-1">
      <div className="max-w-[85%] rounded-lg border border-purple-200 bg-purple-50 overflow-hidden">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-purple-100 transition-colors"
        >
          <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
          <span className="text-xs font-medium text-purple-700">Thinking...</span>
          <span className="text-[10px] text-purple-400 ml-auto">{isExpanded ? '▼' : '▶'}</span>
        </button>
        {isExpanded && (
          <div className="px-3 pb-2 text-xs text-purple-800 whitespace-pre-wrap font-mono max-h-[200px] overflow-y-auto border-t border-purple-200">
            {text}
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Tool Call Block
// =============================================================================

function ToolCallBlock({ toolCall }: { toolCall: ToolCallState }) {
  const [isExpanded, setIsExpanded] = useState(false)

  const iconMap: Record<string, string> = {
    read: '📄',
    write: '✏️',
    edit: '🔧',
    bash: '💻',
    grep: '🔍',
    find: '📁',
    ls: '📂',
  }
  const icon = iconMap[toolCall.toolName] || '🔧'

  return (
    <div className="flex justify-start mb-1">
      <div className={`max-w-[85%] rounded-lg border overflow-hidden ${
        toolCall.isError
          ? 'border-red-200 bg-red-50'
          : toolCall.isComplete
          ? 'border-slate-200 bg-slate-50'
          : 'border-orange-200 bg-orange-50'
      }`}>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-opacity-80 transition-colors"
        >
          {!toolCall.isComplete ? (
            <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
          ) : toolCall.isError ? (
            <span className="text-xs text-red-500">✕</span>
          ) : (
            <span className="text-xs text-green-500">✓</span>
          )}
          <span className="text-xs">{icon}</span>
          <span className="text-xs font-mono font-medium text-slate-700">{toolCall.toolName}</span>
          {toolCall.output.length > 0 && (
            <span className="text-[10px] text-slate-400 ml-auto">{isExpanded ? '▼' : '▶'}</span>
          )}
        </button>
        {isExpanded && toolCall.output && (
          <div className="px-3 pb-2 text-xs text-slate-700 whitespace-pre-wrap font-mono max-h-[300px] overflow-y-auto border-t border-slate-200">
            {toolCall.output}
          </div>
        )}
      </div>
    </div>
  )
}
