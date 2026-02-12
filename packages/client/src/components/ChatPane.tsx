import { useState, useRef, useEffect } from 'react'
import type { PlanningMessage } from '@pi-factory/shared'
import type { PlanningStreamState, PlanningToolCallState } from '../hooks/usePlanningStreaming'
import ReactMarkdown from 'react-markdown'

interface ChatPaneProps {
  workspaceId: string
  planningStream: PlanningStreamState
  onSendMessage: (content: string) => void
  onReset: () => void
}

export function ChatPane({
  planningStream,
  onSendMessage,
  onReset,
}: ChatPaneProps) {
  const [input, setInput] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { messages, streamingText, thinkingText, toolCalls, isActive, status } = planningStream

  // Auto-scroll on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingText.length, toolCalls.length])

  // Clear sending state when agent starts responding
  useEffect(() => {
    if (isActive) setIsSending(false)
  }, [isActive])

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || isActive || isSending) return
    setIsSending(true)
    onSendMessage(trimmed)
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const busy = isActive || isSending

  const statusLabel = isSending && !isActive ? 'Initializing agent...'
    : status === 'streaming' ? 'Generating...'
    : status === 'tool_use' ? 'Running tool...'
    : status === 'thinking' ? 'Thinking...'
    : status === 'error' ? 'Error'
    : null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0">
        <h2 className="font-semibold text-xs text-slate-500 uppercase tracking-wide">
          Planning Agent
        </h2>
        <button
          onClick={onReset}
          className="text-[10px] text-slate-400 hover:text-slate-600 font-mono transition-colors"
          title="Reset conversation"
        >
          reset
        </button>
      </div>

      {/* Status bar */}
      {busy && statusLabel && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-blue-50 border-b border-blue-100 shrink-0">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-xs font-mono text-blue-600">{statusLabel}</span>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 relative">
        <div className="px-4 py-3 space-y-3 text-[14px] leading-relaxed">
          {messages.length === 0 && !busy && (
            <div className="flex flex-col items-center justify-center text-slate-400 absolute inset-0">
              <p className="text-sm font-medium text-slate-500 mb-1">Planning Agent</p>
              <p className="text-xs">
                Ask me to research, plan, or decompose work into tasks
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Live thinking */}
          {thinkingText && (
            <div className="-mx-4 px-4 py-2 text-[13px] text-purple-500/80 italic font-mono whitespace-pre-wrap leading-relaxed bg-purple-50/50 border-l-2 border-purple-300">
              {thinkingText}
            </div>
          )}

          {/* Live tool calls */}
          {toolCalls.map((tc) => (
            <ToolCallBlock key={tc.toolCallId} toolCall={tc} />
          ))}

          {/* Live streaming text */}
          {streamingText && (
            <div>
              <div className="chat-prose text-slate-700">
                <ReactMarkdown>{streamingText}</ReactMarkdown>
              </div>
              <span className="inline-block w-[2px] h-[14px] bg-slate-400 animate-pulse align-middle ml-0.5" />
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-slate-200 bg-white">
        <div className="flex gap-2 items-end p-3">
          <textarea
            ref={textareaRef}
            data-chat-input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            placeholder={busy ? 'Agent is working...' : 'Ask anything... (⌘K to focus)'}
            disabled={busy}
            className="flex-1 resize-none rounded-lg border border-slate-200 bg-white text-slate-800 placeholder-slate-400 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:border-slate-400 focus:ring-slate-200 min-h-[40px] max-h-[120px] disabled:opacity-50 disabled:cursor-not-allowed"
            rows={1}
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement
              t.style.height = 'auto'
              t.style.height = Math.min(t.scrollHeight, 120) + 'px'
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || busy}
            className="text-sm font-mono py-2 px-3 rounded-lg shrink-0 disabled:opacity-30 bg-slate-700 text-white hover:bg-slate-600 transition-colors"
          >
            ↩
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Message Bubble
// =============================================================================

function MessageBubble({ message }: { message: PlanningMessage }) {
  if (message.role === 'user') {
    return (
      <div className="-mx-4 bg-blue-50 border-l-2 border-blue-400 px-4 py-2.5">
        <div className="text-[14px] text-slate-800 whitespace-pre-wrap">{message.content}</div>
      </div>
    )
  }

  // Assistant message
  return (
    <div className="chat-prose text-slate-700">
      <ReactMarkdown>{message.content}</ReactMarkdown>
    </div>
  )
}

// =============================================================================
// Tool Call Block
// =============================================================================

function ToolCallBlock({ toolCall }: { toolCall: PlanningToolCallState }) {
  const isShelfTool = toolCall.toolName === 'create_draft_task' || toolCall.toolName === 'create_artifact'

  return (
    <div className={`-mx-4 border-l-2 ${
      toolCall.isError ? 'bg-red-50 border-red-400'
      : isShelfTool ? 'bg-emerald-50 border-emerald-400'
      : 'bg-slate-50 border-slate-300'
    }`}>
      <div className="px-4 py-2 flex items-center gap-2 font-mono text-[13px]">
        <span className={`${isShelfTool ? 'text-emerald-700' : 'text-amber-600'} font-semibold`}>
          {toolCall.toolName}
        </span>
        {!toolCall.isComplete && (
          <span className="text-amber-500 text-[11px] animate-pulse">(running)</span>
        )}
        {toolCall.isComplete && toolCall.isError && (
          <span className="text-red-500 text-[11px]">(error)</span>
        )}
      </div>
      {toolCall.output && (
        <div className="px-4 pb-2 text-xs font-mono text-slate-600 whitespace-pre-wrap max-h-32 overflow-y-auto">
          {toolCall.output.slice(0, 500)}
          {toolCall.output.length > 500 && '...'}
        </div>
      )}
    </div>
  )
}
