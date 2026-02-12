import { useState, useRef, useEffect, memo, useMemo, useCallback } from 'react'
import type { ActivityEntry, Attachment, Phase } from '@pi-factory/shared'
import type { AgentStreamState, ToolCallState } from '../hooks/useAgentStreaming'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api'

const REMARK_PLUGINS = [remarkGfm]

type SendMode = 'message' | 'steer' | 'followUp'

interface TaskChatProps {
  taskId?: string
  taskPhase?: Phase
  workspaceId?: string
  entries: ActivityEntry[]
  attachments?: Attachment[]
  agentStream: AgentStreamState
  onSendMessage: (content: string, attachmentIds?: string[]) => void
  onSteer?: (content: string, attachmentIds?: string[]) => void
  onFollowUp?: (content: string, attachmentIds?: string[]) => void

  onReset?: () => void
  onUploadFiles?: (files: File[]) => Promise<Attachment[]>
  getAttachmentUrl?: (storedName: string) => string
  title?: string
  emptyState?: { title: string; subtitle: string }
  /** Optional element rendered above the input area (e.g. QADialog) */
  bottomSlot?: React.ReactNode
}

const STATUS_CONFIG: Record<string, { label: string; color: string; pulse?: boolean }> = {
  idle: { label: 'Waiting for input', color: 'bg-amber-400' },
  streaming: { label: 'Generating', color: 'bg-blue-500', pulse: true },
  tool_use: { label: 'Running tool', color: 'bg-amber-500', pulse: true },
  thinking: { label: 'Thinking', color: 'bg-purple-500', pulse: true },
  completed: { label: 'Done', color: 'bg-green-500' },
  error: { label: 'Error', color: 'bg-red-500' },
  'post-hooks': { label: 'Running post-execution skills', color: 'bg-orange-500', pulse: true },
  awaiting_qa: { label: 'Waiting for your answers', color: 'bg-amber-500' },
}

const TOOL_PREVIEW_LINES = 2
const MAX_LINES = 100
const MAX_PREVIEW_CHARS = 500

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatToolHeader(name: string, args?: Record<string, unknown>): { prefix: string; detail: string } {
  const a = args || {}

  switch (name.toLowerCase()) {
    case 'bash': return { prefix: '$', detail: String(a.command || '') }
    case 'read': {
      const path = String(a.path || '')
      const offset = a.offset ? `:${a.offset}` : ''
      return { prefix: 'read', detail: `${path}${offset}` }
    }
    case 'write': return { prefix: 'write', detail: String(a.path || '') }
    case 'edit': return { prefix: 'edit', detail: String(a.path || '') }
    case 'web_search': return { prefix: 'search', detail: String(a.query || '') }
    case 'web_fetch': return { prefix: 'fetch', detail: String(a.url || '') }
    case 'save_plan': {
      const goal = String(a.goal || '')
      const preview = goal.length > 80 ? goal.slice(0, 77) + '...' : goal
      return { prefix: 'save_plan', detail: preview || String(a.taskId || '') }
    }
    case 'task_complete': {
      const summary = String(a.summary || '')
      const preview = summary.length > 80 ? summary.slice(0, 77) + '...' : summary
      return { prefix: '✅ complete', detail: preview || String(a.taskId || '') }
    }
    default: {
      const parts = Object.entries(a)
        .filter(([, v]) => v != null)
        .map(([k, v]) => {
          if (typeof v === 'string') return `${k}=${v.length > 50 ? v.slice(0, 47) + '...' : v}`
          return `${k}=${v}`
        })
      return { prefix: name.toLowerCase(), detail: parts.join(' ') }
    }
  }
}

function getOutputPreview(text: string, previewLines: number): { preview: string; lineCount: number; hasMore: boolean; hiddenCount: number } {
  // Truncate very long single-line output (e.g. minified JS) by character count
  if (text.length > MAX_PREVIEW_CHARS && text.split('\n').length <= previewLines) {
    return {
      preview: text.slice(0, MAX_PREVIEW_CHARS),
      lineCount: 1,
      hasMore: true,
      hiddenCount: Math.ceil((text.length - MAX_PREVIEW_CHARS) / 80), // approximate hidden "lines"
    }
  }

  const lines = text.split('\n')
  const lineCount = lines.length
  const hasMore = lineCount > previewLines
  const preview = lines.slice(0, previewLines).join('\n')
  return { preview, lineCount, hasMore, hiddenCount: lineCount - previewLines }
}

// Try to guess tool name + detail from content when metadata is missing (old entries)
function guessToolInfo(content: string): { prefix: string; detail: string } | null {
  const first = content.trimStart()
  const firstLine = first.split('\n')[0].trim()

  // File paths: likely bash ls or find output
  if (/^(\.\/|domains\/|src\/|packages\/|\.github\/|AGENTS|README|BUILD)/.test(first)) {
    return { prefix: '$', detail: firstLine }
  }
  // Git log output
  if (/^[a-f0-9]{7,40}\s/.test(first)) {
    return { prefix: '$', detail: 'git log' }
  }
  // Go code: likely read output — show package name as hint
  if (/^package \w+/.test(first)) {
    const pkg = first.match(/^package (\w+)/)?.[1]
    return { prefix: 'read', detail: pkg ? `(package ${pkg})` : firstLine }
  }
  // Other code imports
  if (/^(import |from |export |module |class |def )/.test(first)) {
    return { prefix: 'read', detail: firstLine.slice(0, 60) }
  }
  // Bazel BUILD files
  if (/^load\("/.test(first)) {
    const path = first.match(/^load\("([^"]+)"/)?.[1]
    return { prefix: 'read', detail: path ? `BUILD (${path.split('/').pop()})` : 'BUILD' }
  }

  // Code-dump fallback (legacy entries where tool metadata was missing).
  // This avoids markdown mangling of large source snippets.
  const lines = first.split('\n')
  if (lines.length >= 8) {
    let score = 0
    for (const line of lines.slice(0, 120)) {
      const t = line.trim()
      if (!t) continue
      if (/^(const |let |var |function |class |interface |type |if\b|else\b|for\b|while\b|return\b|import |export |\/\/|\/\*)/.test(t)) score += 2
      if (/[{};]/.test(t)) score += 1
      if (t.includes('=>') || t.includes('===') || t.includes('?.') || t.includes('await ')) score += 1
    }
    if (score >= 14) {
      return { prefix: 'read', detail: '(code output)' }
    }
  }

  // Do not infer generic long assistant prose as a tool call.
  // Structured tool entries now carry metadata; this heuristic is only for
  // obvious legacy outputs (code, file lists, git output, etc.).
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Line-numbered output display
// ─────────────────────────────────────────────────────────────────────────────

const LineNumberedOutput = memo(function LineNumberedOutput({
  content,
  startLine = 1,
  isError = false,
}: {
  content: string
  startLine?: number
  isError?: boolean
}) {
  const lines = content.split('\n')
  const gutterWidth = String(startLine + lines.length - 1).length

  return (
    <div className={`text-xs font-mono ${isError ? 'text-red-600' : 'text-slate-600'}`}>
      {lines.map((line, i) => (
        <div key={i} className="flex">
          <span
            className="text-slate-300 select-none mr-3 text-right shrink-0"
            style={{ minWidth: `${gutterWidth}ch` }}
          >
            {startLine + i}
          </span>
          <span className="flex-1 whitespace-pre-wrap break-all">{line}</span>
        </div>
      ))}
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Expand/collapse button
// ─────────────────────────────────────────────────────────────────────────────

function ExpandButton({ expanded, hiddenCount, onToggle }: { expanded: boolean; hiddenCount: number; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="text-slate-400 hover:text-slate-600 mt-1.5 text-[11px] font-mono cursor-pointer"
    >
      {expanded ? '(collapse)' : `… (${hiddenCount} more lines)`}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool call block — full-width with left border (live streaming)
// ─────────────────────────────────────────────────────────────────────────────

const ToolCallBlock = memo(function ToolCallBlock({ toolCall }: { toolCall: ToolCallState }) {
  const [expanded, setExpanded] = useState(false)

  const header = useMemo(
    () => formatToolHeader(toolCall.toolName, toolCall.input),
    [toolCall.toolName, toolCall.input]
  )

  const outputInfo = useMemo(() => {
    if (!toolCall.output) return null
    return getOutputPreview(toolCall.output, TOOL_PREVIEW_LINES)
  }, [toolCall.output])

  const displayText = expanded && toolCall.output
    ? toolCall.output.split('\n').slice(0, MAX_LINES).join('\n')
    : outputInfo?.preview || ''

  return (
    <div className={`-mx-4 border-l-2 ${
      toolCall.isError ? 'bg-red-50 border-red-400' : 'bg-emerald-50/60 border-emerald-400'
    }`}>
      <div className="px-4 py-2 flex items-start gap-2 font-mono text-[13px]">
        <span className="text-emerald-700 font-semibold shrink-0">{header.prefix}</span>
        <span className="text-slate-700 whitespace-pre-wrap break-all flex-1">{header.detail}</span>
        {!toolCall.isComplete && (
          <span className="text-emerald-500 text-[11px] shrink-0 animate-pulse">(running)</span>
        )}
        {toolCall.isComplete && toolCall.isError && (
          <span className="text-red-500 text-[11px] shrink-0">(error)</span>
        )}
      </div>
      {displayText && (
        <div className="px-4 pb-2.5">
          <LineNumberedOutput content={displayText} isError={toolCall.isError} />
          {outputInfo?.hasMore && (
            <ExpandButton expanded={expanded} hiddenCount={outputInfo.hiddenCount} onToggle={() => setExpanded(!expanded)} />
          )}
        </div>
      )}
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Persisted tool call (from activity entries with metadata)
// ─────────────────────────────────────────────────────────────────────────────

const PersistedToolBlock = memo(function PersistedToolBlock({
  toolName,
  args,
  result,
  isError,
}: {
  toolName: string
  args?: Record<string, unknown>
  result?: string
  isError?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const header = formatToolHeader(toolName, args)
  const outputInfo = result ? getOutputPreview(result, TOOL_PREVIEW_LINES) : null
  const displayText = expanded && result
    ? result.split('\n').slice(0, MAX_LINES).join('\n')
    : outputInfo?.preview || ''

  return (
    <div className={`-mx-4 border-l-2 ${
      isError ? 'bg-red-50 border-red-400' : 'bg-emerald-50/60 border-emerald-400'
    }`}>
      <div className="px-4 py-2 flex items-start gap-2 font-mono text-[13px]">
        <span className="text-emerald-700 font-semibold shrink-0">{header.prefix}</span>
        <span className="text-slate-700 whitespace-pre-wrap break-all flex-1">{header.detail}</span>
        {isError && <span className="text-red-500 text-[11px] shrink-0">(error)</span>}
      </div>
      {displayText && (
        <div className="px-4 pb-2.5">
          <LineNumberedOutput content={displayText} isError={isError} />
          {outputInfo?.hasMore && (
            <ExpandButton expanded={expanded} hiddenCount={outputInfo.hiddenCount} onToggle={() => setExpanded(!expanded)} />
          )}
        </div>
      )}
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Inferred tool block — old entries without metadata, detected by heuristic
// ─────────────────────────────────────────────────────────────────────────────

const InferredToolBlock = memo(function InferredToolBlock({
  content,
  prefix,
  detail,
}: {
  content: string
  prefix: string
  detail: string
}) {
  const [expanded, setExpanded] = useState(false)
  const outputInfo = getOutputPreview(content, TOOL_PREVIEW_LINES)
  const displayText = expanded
    ? content.split('\n').slice(0, MAX_LINES).join('\n')
    : outputInfo.preview

  return (
    <div className="-mx-4 border-l-2 bg-emerald-50/60 border-emerald-400">
      <div className="px-4 py-2 flex items-start gap-2 font-mono text-[13px]">
        <span className="text-emerald-700 font-semibold shrink-0">{prefix}</span>
        <span className="text-slate-700 whitespace-pre-wrap break-all flex-1">{detail}</span>
      </div>
      <div className="px-4 pb-2.5">
        <LineNumberedOutput content={displayText} />
        {outputInfo.hasMore && (
          <ExpandButton expanded={expanded} hiddenCount={outputInfo.hiddenCount} onToggle={() => setExpanded(!expanded)} />
        )}
      </div>
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Thinking block
// ─────────────────────────────────────────────────────────────────────────────

const ThinkingBlock = memo(function ThinkingBlock({ text }: { text: string }) {
  return (
    <div className="py-2 text-[13px] text-slate-400 italic font-mono whitespace-pre-wrap leading-relaxed">
      {text}
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Collapsible agent prose (short text that looks like natural language)
// ─────────────────────────────────────────────────────────────────────────────

const CollapsibleAgentMessage = memo(function CollapsibleAgentMessage({
  content,
}: {
  content: string
}) {
  return (
    <div className="chat-prose text-slate-700">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{content}</ReactMarkdown>
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Main chat component
// ─────────────────────────────────────────────────────────────────────────────

export function TaskChat({
  taskId,
  taskPhase,
  workspaceId,
  entries,
  attachments,
  agentStream,
  onSendMessage,
  onSteer,
  onFollowUp,
  onReset,
  onUploadFiles,
  getAttachmentUrl: getAttachmentUrlProp,
  title,
  emptyState,
  bottomSlot,
}: TaskChatProps) {
  const [input, setInput] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [sendMode, setSendMode] = useState<SendMode>('message')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Show agent activity for all phases (including complete), so chat mode
  // still displays running status while the model responds.
  const isAgentActive = agentStream.isActive

  // Steering/follow-up controls are only shown for executing tasks.
  const canSteer = taskPhase === 'executing' && !!onSteer

  const isWaitingForInput = taskPhase
    ? !agentStream.isActive && taskPhase === 'executing' && agentStream.status === 'idle'
    : false

  const taskEntries = useMemo(
    () => taskId ? entries.filter((e) => e.taskId === taskId).reverse() : entries,
    [entries, taskId]
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [taskEntries.length, agentStream.streamingText.length])

  useEffect(() => {
    setSendMode(isAgentActive && canSteer ? 'steer' : 'message')
  }, [isAgentActive, canSteer])

  const addFiles = useCallback((files: FileList | File[]) => {
    const newFiles = Array.from(files)
    if (newFiles.length === 0) return
    setPendingFiles(prev => [...prev, ...newFiles])
  }, [])

  const removePendingFile = useCallback((index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index))
  }, [])

  // Determine if file upload is supported (either via custom callback or task-specific upload)
  const canUploadFiles = !!(onUploadFiles || (workspaceId && taskId && attachments))

  const handleSend = async () => {
    const trimmed = input.trim()
    if (!trimmed && pendingFiles.length === 0) return

    // Upload pending files first (for any send mode)
    let attachmentIds: string[] | undefined
    if (pendingFiles.length > 0) {
      setIsUploading(true)
      try {
        let uploaded: Attachment[]
        if (onUploadFiles) {
          uploaded = await onUploadFiles(pendingFiles)
        } else if (workspaceId && taskId) {
          uploaded = await api.uploadAttachments(workspaceId, taskId, pendingFiles)
        } else {
          setIsUploading(false)
          return
        }
        attachmentIds = uploaded.map(a => a.id)
        setPendingFiles([])
      } catch (err) {
        console.error('Failed to upload attachments:', err)
        setIsUploading(false)
        return
      }
      setIsUploading(false)
    }

    if (sendMode === 'steer' && onSteer) {
      if (trimmed) onSteer(trimmed, attachmentIds)
    } else if (sendMode === 'followUp' && onFollowUp) {
      if (trimmed) onFollowUp(trimmed, attachmentIds)
    } else {
      if (trimmed || attachmentIds) {
        onSendMessage(trimmed || '(attached files)', attachmentIds)
      }
    }

    setInput('')
    setPendingFiles([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isComposing) return
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      handleSend()
    } else if (e.key === 'Enter' && e.altKey && isAgentActive && canSteer && onFollowUp) {
      e.preventDefault()
      const trimmed = input.trim()
      if (trimmed) { onFollowUp(trimmed); setInput('') }
    }
  }

  const statusConfig = STATUS_CONFIG[agentStream.status]

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      {/* Header — shown when title or reset is provided */}
      {(title || onReset) && (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0">
          {title && <h2 className="font-semibold text-xs text-slate-500 uppercase tracking-wide">{title}</h2>}
          {onReset && (
            <button onClick={onReset} className="text-[10px] text-slate-400 hover:text-slate-600 font-mono transition-colors" title="Reset conversation">
              reset
            </button>
          )}
        </div>
      )}

      {/* Waiting for input banner */}
      {isWaitingForInput && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 shrink-0">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="text-xs font-mono text-amber-700">Agent is waiting for your response</span>
        </div>
      )}

      {/* Status bar */}
      {isAgentActive && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-50 border-b border-slate-200 shrink-0">
          <span className={`w-2 h-2 rounded-full ${statusConfig.color} ${statusConfig.pulse ? 'animate-pulse' : ''}`} />
          <span className="text-xs font-mono text-slate-500">{statusConfig.label}</span>
          {agentStream.status === 'tool_use' && agentStream.toolCalls.length > 0 && (
            <span className="text-xs text-slate-400 font-mono">
              {agentStream.toolCalls[agentStream.toolCalls.length - 1].toolName}
            </span>
          )}

        </div>
      )}

      {/* Empty state */}
      {taskEntries.length === 0 && !isAgentActive && emptyState && (
        <div className="flex flex-col items-center justify-center text-slate-400 absolute inset-0 z-0 pointer-events-none">
          <p className="text-sm font-medium text-slate-500 mb-1">{emptyState.title}</p>
          <p className="text-xs">{emptyState.subtitle}</p>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto min-h-0 relative ${isDragOver ? 'ring-2 ring-inset ring-blue-400 bg-blue-50/30' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-blue-50/80 z-10 pointer-events-none">
            <div className="text-center">
              <p className="text-sm text-blue-600 font-medium">Drop files to attach</p>
            </div>
          </div>
        )}
        <div className="px-4 py-3 space-y-1 text-[14px] leading-relaxed">
          {taskEntries.length === 0 && !isAgentActive && !emptyState && (
            <div className="text-center py-16 text-slate-400">
              <p className="text-sm font-mono">no messages yet</p>
              <p className="text-xs mt-1">send a message or execute the task</p>
            </div>
          )}

          {taskEntries.map((entry) => {
            if (entry.type === 'system-event') {
              // Hide low-signal idle spam from historical logs.
              if (entry.message === 'Agent is waiting for user input') {
                return null
              }

              return (
                <div key={entry.id} className="text-center py-1">
                  <span className="text-[11px] font-mono text-slate-400">
                    — {entry.message} —
                  </span>
                </div>
              )
            }

            if (entry.type === 'chat-message') {
              // Tool call with metadata
              const meta = entry.metadata as Record<string, unknown> | undefined
              if (meta?.toolName) {
                return (
                  <PersistedToolBlock
                    key={entry.id}
                    toolName={String(meta.toolName)}
                    args={meta.args as Record<string, unknown> | undefined}
                    result={entry.content}
                    isError={Boolean(meta.isError)}
                  />
                )
              }

              // User message
              if (entry.role === 'user') {
                const msgAttachmentIds = (meta?.attachmentIds as string[]) || []
                const msgAttachments = msgAttachmentIds
                  .map(id => (attachments || []).find(a => a.id === id))
                  .filter(Boolean) as Attachment[]

                return (
                  <div key={entry.id} className="-mx-4 bg-blue-50 border-l-2 border-blue-400 px-4 py-2.5">
                    <div className="text-[14px] text-slate-800 whitespace-pre-wrap">{entry.content}</div>
                    {msgAttachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {msgAttachments.map(att => {
                          const url = getAttachmentUrlProp
                            ? getAttachmentUrlProp(att.storedName)
                            : workspaceId && taskId ? api.getAttachmentUrl(workspaceId, taskId, att.storedName) : ''
                          const isImage = att.mimeType.startsWith('image/')
                          return isImage ? (
                            <a key={att.id} href={url} target="_blank" rel="noopener noreferrer" className="block">
                              <img
                                src={url}
                                alt={att.filename}
                                className="max-h-32 rounded border border-blue-200 object-cover"
                                loading="lazy"
                              />
                            </a>
                          ) : (
                            <a
                              key={att.id}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-blue-100 border border-blue-200 text-xs text-blue-700 hover:bg-blue-200 transition-colors"
                            >
                              {att.filename}
                            </a>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              }

              // Agent message — check if it looks like tool output (old execution entries without metadata)
              // Skip for planning entries (taskId starting with __) — those always have proper metadata now
              const toolInfo = taskId && !taskId.startsWith('__') ? guessToolInfo(entry.content) : null
              if (toolInfo) {
                return (
                  <InferredToolBlock
                    key={entry.id}
                    content={entry.content}
                    prefix={toolInfo.prefix}
                    detail={toolInfo.detail}
                  />
                )
              }

              // Agent prose — no background
              return (
                <CollapsibleAgentMessage
                  key={entry.id}
                  content={entry.content}
                />
              )
            }

            return null
          })}

          {/* Live thinking — only show when agent is actually running */}
          {isAgentActive && agentStream.thinkingText && <ThinkingBlock text={agentStream.thinkingText} />}

          {/* Live tool calls — only show when agent is actually running */}
          {isAgentActive && agentStream.toolCalls.map((tc) => (
            <ToolCallBlock key={tc.toolCallId} toolCall={tc} />
          ))}

          {/* Live streaming text — only show when agent is actually running */}
          {isAgentActive && agentStream.streamingText && (
            <div>
              <div className="chat-prose text-slate-700">
                <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{agentStream.streamingText}</ReactMarkdown>
              </div>
              <span className="inline-block w-[2px] h-[14px] bg-slate-400 animate-pulse align-middle ml-0.5" />
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Optional slot above the input (e.g. QADialog) */}
      {bottomSlot}

      {/* Input */}
      <div className="shrink-0 border-t border-slate-200 bg-white">
        {isAgentActive && canSteer && (
          <div className="flex items-center gap-1 px-3 pt-2 pb-0">
            <button
              onClick={() => setSendMode('steer')}
              className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded transition-colors ${
                sendMode === 'steer'
                  ? 'bg-amber-100 text-amber-700'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              ⚡ steer
            </button>
            {onFollowUp && (
              <button
                onClick={() => setSendMode('followUp')}
                className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded transition-colors ${
                  sendMode === 'followUp'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                ↩ follow-up
              </button>
            )}
            <span className="text-[10px] text-slate-400 font-mono ml-auto">
              {sendMode === 'steer' ? 'interrupts after current tool' : 'queued for when agent finishes'}
            </span>
          </div>
        )}

        {/* Pending files preview */}
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2 pb-0">
            {pendingFiles.map((file, i) => {
              const isImage = file.type.startsWith('image/')
              return (
                <div
                  key={`${file.name}-${i}`}
                  className="group relative flex items-center gap-1.5 pl-1.5 pr-1 py-1 rounded-md border border-slate-200 bg-slate-50 text-xs max-w-[180px]"
                >
                  {isImage ? (
                    <img
                      src={URL.createObjectURL(file)}
                      alt={file.name}
                      className="w-6 h-6 rounded object-cover shrink-0"
                    />
                  ) : (
                    <span className="w-6 h-6 rounded bg-slate-200 flex items-center justify-center text-[9px] text-slate-400 font-mono shrink-0">file</span>
                  )}
                  <span className="text-slate-600 truncate">{file.name}</span>
                  <button
                    onClick={() => removePendingFile(i)}
                    className="w-4 h-4 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center text-[10px] shrink-0 transition-colors"
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex gap-2 items-end p-3">
          {/* Attach file button — shown when file upload is supported */}
          {canUploadFiles && (
            <>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="text-[10px] font-medium text-slate-400 hover:text-slate-600 transition-colors py-2 px-1.5 shrink-0 disabled:opacity-50"
              title="Attach files"
            >
              📎
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.json,.csv,.log"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files)
                e.target.value = ''
              }}
            />
            </>
          )}
          <textarea
            ref={textareaRef}
            data-chat-input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            placeholder={
              isAgentActive && canSteer
                ? sendMode === 'steer'
                  ? 'steer the agent… (enter to send)'
                  : 'queue follow-up… (enter to send)'
                : isWaitingForInput
                  ? 'reply to the agent… (enter to send)'
                  : isAgentActive
                    ? 'agent is running… (enter to send)'
                    : pendingFiles.length > 0
                      ? 'add a note… (enter to send with files)'
                      : 'message the agent… (enter to send)'
            }
            className={`flex-1 resize-none rounded-lg border bg-white text-slate-800 placeholder-slate-400 px-3 py-2 text-sm focus:outline-none focus:ring-1 min-h-[40px] max-h-[120px] transition-colors ${
              isAgentActive && canSteer && sendMode === 'steer'
                ? 'border-amber-300 focus:border-amber-400 focus:ring-amber-200'
                : isAgentActive && canSteer && sendMode === 'followUp'
                ? 'border-blue-300 focus:border-blue-400 focus:ring-blue-200'
                : 'border-slate-200 focus:border-slate-400 focus:ring-slate-200'
            }`}
            rows={1}
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement
              t.style.height = 'auto'
              t.style.height = Math.min(t.scrollHeight, 120) + 'px'
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() && pendingFiles.length === 0}
            className={`text-sm font-mono py-2 px-3 rounded-lg shrink-0 disabled:opacity-30 transition-colors ${
              isAgentActive && canSteer && sendMode === 'steer'
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'bg-slate-700 text-white hover:bg-slate-600'
            }`}
          >
            {isUploading ? '…' : isAgentActive && canSteer && sendMode === 'steer' ? '⚡' : '↩'}
          </button>
        </div>
      </div>
    </div>
  )
}
