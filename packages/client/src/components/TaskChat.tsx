import { useState, useRef, useEffect, memo, useMemo, useCallback } from 'react'
import { CornerUpLeft, Loader2, Paperclip, PencilLine, SendHorizontal, X, Zap } from 'lucide-react'
import type { ActivityEntry, Attachment, DraftTask, Phase, AgentExecutionStatus } from '@task-factory/shared'
import type { AgentStreamState, ToolCallState } from '../hooks/useAgentStreaming'
import { useVoiceDictation } from '../hooks/useVoiceDictation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api'
import { AppIcon } from './AppIcon'
import { InlineWhiteboardPanel } from './InlineWhiteboardPanel'
import {
  clearStoredWhiteboardScene,
  createWhiteboardAttachmentFilename,
  exportWhiteboardPngFile,
  hasWhiteboardContent,
  loadStoredWhiteboardScene,
  persistWhiteboardScene,
  type WhiteboardSceneSnapshot,
} from './whiteboard'

const REMARK_PLUGINS = [remarkGfm]

type SendMode = 'message' | 'steer' | 'followUp'

interface TaskChatProps {
  taskId?: string
  taskPhase?: Phase
  isAwaitingInput?: boolean
  workspaceId?: string
  entries: ActivityEntry[]
  attachments?: Attachment[]
  agentStream: AgentStreamState
  onSendMessage: (content: string, attachmentIds?: string[]) => void
  onSteer?: (content: string, attachmentIds?: string[]) => void
  onFollowUp?: (content: string, attachmentIds?: string[]) => void
  onStop?: () => Promise<void> | void
  isStopping?: boolean
  isVoiceHotkeyPressed?: boolean
  /** Reports whether voice dictation is actively listening. */
  onVoiceDictationStateChange?: (isDictating: boolean) => void

  onReset?: () => void
  onUploadFiles?: (files: File[]) => Promise<Attachment[]>
  getAttachmentUrl?: (storedName: string) => string
  title?: string
  emptyState?: { title: string; subtitle: string }
  /** Optional element rendered in the header bar, next to reset button */
  headerSlot?: React.ReactNode
  /** Optional element rendered above the input area (e.g. QADialog) */
  bottomSlot?: React.ReactNode
  /** Planning-mode hook: open an inline artifact in the right pane. */
  onOpenArtifact?: (artifact: { id: string; name: string; html: string }) => void
  /** Planning-mode hook: open inline draft task in the New Task pane. */
  onOpenDraftTask?: (draftTask: DraftTask) => void
  /** Planning-mode hook: create a backlog task directly from an inline draft card. */
  onCreateDraftTask?: (draftTask: DraftTask) => Promise<void> | void
  /** Planning-mode hook: dismiss an inline draft card without creating a task. */
  onDismissDraftTask?: (draftTask: DraftTask) => void
  /** Per-draft collapse state for inline draft cards. */
  draftTaskStates?: Record<string, { status: 'created' | 'dismissed'; taskId?: string }>
  /** Draft IDs currently being created directly from inline cards. */
  creatingDraftTaskIds?: ReadonlySet<string>
}

const STATUS_CONFIG: Record<string, { label: string; color: string; pulse?: boolean }> = {
  idle: { label: 'Idle', color: 'bg-slate-400' },
  awaiting_input: { label: 'Waiting for your response', color: 'bg-amber-500' },
  streaming: { label: 'Generating', color: 'bg-blue-500', pulse: true },
  tool_use: { label: 'Running tool', color: 'bg-amber-500', pulse: true },
  thinking: { label: 'Thinking', color: 'bg-purple-500', pulse: true },
  completed: { label: 'Done', color: 'bg-green-500' },
  error: { label: 'Error', color: 'bg-red-500' },
  'post-hooks': { label: 'Running post-execution skills', color: 'bg-orange-500', pulse: true },
  awaiting_qa: { label: 'Waiting for your answers', color: 'bg-amber-500' },
}

const STOPPABLE_STATUSES = new Set<AgentExecutionStatus>([
  'streaming',
  'tool_use',
  'thinking',
  'post-hooks',
])

const TOOL_PREVIEW_LINES = 2
const MAX_LINES = 100
const MAX_PREVIEW_CHARS = 500
const TASK_CHAT_WHITEBOARD_STORAGE_KEY_PREFIX = 'task-factory:task-chat-whiteboard'
const VOICE_HOTKEY_RELEASE_GRACE_MS = 1500

function getTaskChatWhiteboardStorageKey(workspaceId?: string, taskId?: string): string | null {
  if (!workspaceId || !taskId) return null
  return `${TASK_CHAT_WHITEBOARD_STORAGE_KEY_PREFIX}:${workspaceId}:${taskId}`
}

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
      return { prefix: 'complete', detail: preview || String(a.taskId || '') }
    }
    case 'ask_questions': {
      const questions = Array.isArray(a.questions) ? a.questions : []
      const count = questions.length
      const firstQ = questions[0]
      const preview = firstQ?.text
        ? (firstQ.text.length > 60 ? firstQ.text.slice(0, 57) + '...' : firstQ.text)
        : ''
      const suffix = count > 1 ? ` (+${count - 1} more)` : ''
      return { prefix: 'ask', detail: `${preview}${suffix}` }
    }
    default: {
      const parts = Object.entries(a)
        .filter(([, v]) => v != null)
        .map(([k, v]) => {
          if (typeof v === 'string') return `${k}=${v.length > 50 ? v.slice(0, 47) + '...' : v}`
          if (typeof v === 'object') return `${k}=[${Array.isArray(v) ? `${v.length} items` : 'object'}]`
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

function formatContextUsageLabel(percent: number | null | undefined): string {
  if (percent == null) return 'ctx ?'
  const rounded = percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10
  return `ctx ${rounded}%`
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

function isDraftTaskMetadata(value: unknown): value is DraftTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const draft = value as Partial<DraftTask>

  const hasValidPlan = (() => {
    if (draft.plan == null) return true
    if (typeof draft.plan !== 'object' || Array.isArray(draft.plan)) return false

    const plan = draft.plan as any
    return (
      typeof plan.goal === 'string'
      && Array.isArray(plan.steps)
      && Array.isArray(plan.validation)
      && Array.isArray(plan.cleanup)
    )
  })()

  return (
    typeof draft.id === 'string'
    && typeof draft.title === 'string'
    && typeof draft.content === 'string'
    && Array.isArray(draft.acceptanceCriteria)
    && hasValidPlan
  )
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
// Artifact reopen widget (planning create_artifact tool output)
// ─────────────────────────────────────────────────────────────────────────────

const ArtifactReopenWidget = memo(function ArtifactReopenWidget({
  artifactId,
  artifactName,
  artifactHtml,
  onOpen,
  result,
}: {
  artifactId: string
  artifactName: string
  artifactHtml?: string
  onOpen?: (artifact: { id: string; name: string; html: string }) => void
  result?: string
}) {
  const canOpen = !!onOpen && typeof artifactHtml === 'string' && artifactHtml.length > 0

  return (
    <div className="-mx-4 border-l-2 border-indigo-400 bg-indigo-100 px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wide">Artifact</div>
          <div className="text-sm font-medium text-slate-800 truncate">{artifactName}</div>
          <div className={`text-xs mt-0.5 ${canOpen ? 'text-slate-500' : 'text-amber-700'}`}>
            {canOpen ? 'Open in the right pane' : 'Artifact payload unavailable for reopen'}
          </div>
        </div>

        <button
          onClick={() => {
            if (!canOpen || !artifactHtml) return
            onOpen?.({ id: artifactId, name: artifactName, html: artifactHtml })
          }}
          disabled={!canOpen}
          className={`shrink-0 text-xs px-2.5 py-1 rounded font-medium transition-colors ${
            canOpen
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          }`}
        >
          Open
        </button>
      </div>

      {result && (
        <div className="text-xs text-slate-400 mt-2 font-mono truncate" title={result}>
          {result}
        </div>
      )}
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Inline draft-task reopen widget (planning create_draft_task tool output)
// ─────────────────────────────────────────────────────────────────────────────

const InlineDraftTaskWidget = memo(function InlineDraftTaskWidget({
  draftTask,
  onOpen,
  onCreate,
  onDismiss,
  state,
  isCreating,
}: {
  draftTask: DraftTask
  onOpen?: (draftTask: DraftTask) => void
  onCreate?: (draftTask: DraftTask) => Promise<void> | void
  onDismiss?: (draftTask: DraftTask) => void
  state?: { status: 'created' | 'dismissed'; taskId?: string }
  isCreating?: boolean
}) {
  if (state?.status === 'created') {
    return (
      <div className="-mx-4 border-l-2 border-blue-400 bg-blue-50/80 px-4 py-2.5">
        <div className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">Draft Task · Added to Backlog</div>
        <div className="text-sm font-medium text-slate-800 mt-0.5">{draftTask.title}</div>
        {state.taskId && (
          <div className="text-xs text-slate-500 mt-1 font-mono">Created {state.taskId}</div>
        )}
      </div>
    )
  }

  if (state?.status === 'dismissed') {
    return (
      <div className="-mx-4 border-l-2 border-slate-300 bg-slate-100/80 px-4 py-2.5">
        <div className="text-[10px] font-semibold text-slate-600 uppercase tracking-wide">Draft Task · Won’t Do</div>
        <div className="text-sm font-medium text-slate-700 mt-0.5">{draftTask.title}</div>
      </div>
    )
  }

  const canCreate = !!onCreate && !isCreating
  const canOpen = !!onOpen && !isCreating
  const canDismiss = !!onDismiss && !isCreating

  return (
    <div className="-mx-4 border-l-2 border-blue-300 bg-blue-50/60 px-4 py-2.5">
      <div className="min-w-0">
        <div className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">Draft Task</div>
        <div className="text-sm font-medium text-slate-800">{draftTask.title}</div>

        {draftTask.content.trim() && (
          <div className="text-xs text-slate-600 mt-1 whitespace-pre-wrap line-clamp-3">{draftTask.content.trim()}</div>
        )}

        <div className="mt-2">
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Acceptance Criteria</div>
          {draftTask.acceptanceCriteria.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {draftTask.acceptanceCriteria.map((criterion, index) => (
                <li key={index} className="text-xs text-slate-600 flex items-start gap-1">
                  <span className="text-slate-400 shrink-0">•</span>
                  <span>{criterion}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-slate-500 mt-1">(none)</div>
          )}
        </div>

        <div className="mt-2">
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Plan</div>
          {draftTask.plan ? (
            <div className="text-xs text-slate-600 mt-1 space-y-1">
              <div><span className="font-medium">Goal:</span> {draftTask.plan.goal}</div>
              <div>
                <span className="font-medium">Steps:</span> {draftTask.plan.steps.length} ·
                <span className="font-medium"> Validation:</span> {draftTask.plan.validation.length} ·
                <span className="font-medium"> Cleanup:</span> {draftTask.plan.cleanup.length}
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-500 mt-1">(none)</div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => onCreate?.(draftTask)}
            disabled={!canCreate}
            className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${
              canCreate
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-blue-200 text-blue-500 cursor-not-allowed'
            }`}
          >
            {isCreating ? 'Creating…' : 'Create Task'}
          </button>
          <button
            onClick={() => onOpen?.(draftTask)}
            disabled={!canOpen}
            className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${
              canOpen
                ? 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}
          >
            Edit Draft
          </button>
          <button
            onClick={() => onDismiss?.(draftTask)}
            disabled={!canDismiss}
            className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${
              canDismiss
                ? 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-100'
                : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
            }`}
          >
            Won’t do
          </button>
        </div>
      </div>
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
  isAwaitingInput,
  workspaceId,
  entries,
  attachments,
  agentStream,
  onSendMessage,
  onSteer,
  onFollowUp,
  onStop,
  isStopping,
  isVoiceHotkeyPressed = false,
  onVoiceDictationStateChange,
  onReset,
  onUploadFiles,
  getAttachmentUrl: getAttachmentUrlProp,
  title,
  emptyState,
  headerSlot,
  bottomSlot,
  onOpenArtifact,
  onOpenDraftTask,
  onCreateDraftTask,
  onDismissDraftTask,
  draftTaskStates,
  creatingDraftTaskIds,
}: TaskChatProps) {
  const [input, setInput] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [sendMode, setSendMode] = useState<SendMode>('message')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [attachmentPreview, setAttachmentPreview] = useState<{ url: string; filename: string } | null>(null)
  const [isWhiteboardModalOpen, setIsWhiteboardModalOpen] = useState(false)
  const [initialWhiteboardScene, setInitialWhiteboardScene] = useState<WhiteboardSceneSnapshot | null>(null)
  const [whiteboardError, setWhiteboardError] = useState<string | null>(null)
  const [isAttachingWhiteboard, setIsAttachingWhiteboard] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const whiteboardSceneRef = useRef<WhiteboardSceneSnapshot | null>(null)
  const dragDepthRef = useRef(0)
  const dictationStartedForCurrentPressRef = useRef(false)
  const voiceHotkeyReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const whiteboardStorageKey = useMemo(
    () => getTaskChatWhiteboardStorageKey(workspaceId, taskId),
    [workspaceId, taskId],
  )

  const {
    isSupported: isDictationSupported,
    isListening: isDictating,
    error: dictationError,
    start: startDictation,
    stop: stopDictation,
    clearError: clearDictationError,
  } = useVoiceDictation()

  useEffect(() => {
    onVoiceDictationStateChange?.(isDictating)
  }, [isDictating, onVoiceDictationStateChange])

  useEffect(() => {
    return () => {
      onVoiceDictationStateChange?.(false)
    }
  }, [onVoiceDictationStateChange])

  const resizeComposer = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'
  }, [])

  const clearVoiceHotkeyReleaseTimer = useCallback(() => {
    if (!voiceHotkeyReleaseTimerRef.current) return
    clearTimeout(voiceHotkeyReleaseTimerRef.current)
    voiceHotkeyReleaseTimerRef.current = null
  }, [])

  // Show agent activity for all phases (including complete), so chat mode
  // still displays running status while the model responds.
  const isAgentActive = agentStream.isActive

  // Steering controls are available whenever callbacks are provided.
  const hasSteerHandler = !!onSteer
  const hasFollowUpHandler = !!onFollowUp
  const showSteerControls = isAgentActive && hasSteerHandler
  const showStopControl = !!onStop && STOPPABLE_STATUSES.has(agentStream.status)

  const isWaitingForInput = taskPhase === 'executing'
    ? Boolean(isAwaitingInput) || (!agentStream.isActive && agentStream.status === 'awaiting_input')
    : false

  const taskEntries = useMemo(
    () => taskId ? entries.filter((e) => e.taskId === taskId).reverse() : entries,
    [entries, taskId]
  )
  const latestEntryId = taskEntries.length > 0 ? taskEntries[taskEntries.length - 1].id : null
  const liveToolScrollKey = useMemo(
    () => agentStream.toolCalls
      .map((tc) => `${tc.toolCallId}:${tc.output.length}:${tc.result?.length ?? 0}:${tc.isComplete ? 1 : 0}:${tc.isError ? 1 : 0}`)
      .join('|'),
    [agentStream.toolCalls],
  )
  const statusConfig = STATUS_CONFIG[agentStream.status]
  const showStatusBar = isAgentActive
    || (agentStream.status as string) === 'awaiting_qa'
    || agentStream.status === 'awaiting_input'
  const contextUsageLabel = agentStream.contextUsage
    ? formatContextUsageLabel(agentStream.contextUsage.percent)
    : null
  const showControlRow = showSteerControls || showStopControl
  const hasBottomSlot = !!bottomSlot

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const scroller = scrollRef.current
    if (!scroller) return
    scroller.scrollTo({ top: scroller.scrollHeight, behavior })
  }, [])

  const scheduleScrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    scrollToBottom(behavior)

    const rafId = requestAnimationFrame(() => {
      scrollToBottom(behavior)
    })
    const timeoutId = setTimeout(() => {
      scrollToBottom(behavior)
    }, 50)

    return () => {
      cancelAnimationFrame(rafId)
      clearTimeout(timeoutId)
    }
  }, [scrollToBottom])

  useEffect(() => {
    clearVoiceHotkeyReleaseTimer()
    dictationStartedForCurrentPressRef.current = false
    stopDictation()
  }, [taskId, clearVoiceHotkeyReleaseTimer, stopDictation])

  useEffect(() => {
    setIsWhiteboardModalOpen(false)
    setIsAttachingWhiteboard(false)
    setWhiteboardError(null)

    if (!whiteboardStorageKey) {
      whiteboardSceneRef.current = null
      setInitialWhiteboardScene(null)
      return
    }

    const storedScene = loadStoredWhiteboardScene(whiteboardStorageKey)
    const restoredScene = hasWhiteboardContent(storedScene) ? storedScene : null
    whiteboardSceneRef.current = restoredScene
    setInitialWhiteboardScene(restoredScene)
  }, [whiteboardStorageKey])

  useEffect(() => {
    if (isVoiceHotkeyPressed) {
      clearVoiceHotkeyReleaseTimer()

      if (dictationStartedForCurrentPressRef.current) {
        return
      }

      dictationStartedForCurrentPressRef.current = true

      if (!isDictationSupported) {
        return
      }

      clearDictationError()
      startDictation()
      return
    }

    dictationStartedForCurrentPressRef.current = false
    clearVoiceHotkeyReleaseTimer()

    if (!isDictating) {
      stopDictation()
      return
    }

    voiceHotkeyReleaseTimerRef.current = setTimeout(() => {
      voiceHotkeyReleaseTimerRef.current = null
      stopDictation()
    }, VOICE_HOTKEY_RELEASE_GRACE_MS)
  }, [
    clearDictationError,
    clearVoiceHotkeyReleaseTimer,
    isDictating,
    isDictationSupported,
    isVoiceHotkeyPressed,
    startDictation,
    stopDictation,
  ])

  useEffect(() => {
    return () => {
      clearVoiceHotkeyReleaseTimer()
    }
  }, [clearVoiceHotkeyReleaseTimer])

  useEffect(() => {
    resizeComposer()
  }, [input, resizeComposer])

  useEffect(() => {
    return scheduleScrollToBottom()
  }, [
    scheduleScrollToBottom,
    taskEntries.length,
    latestEntryId,
    agentStream.streamingText.length,
    agentStream.thinkingText.length,
    liveToolScrollKey,
    agentStream.status,
    isAgentActive,
    isWaitingForInput,
    showStatusBar,
    showControlRow,
    hasBottomSlot,
  ])

  useEffect(() => {
    setSendMode(showSteerControls ? 'steer' : 'message')
  }, [showSteerControls])

  useEffect(() => {
    if (sendMode === 'followUp' && !hasFollowUpHandler) {
      setSendMode(showSteerControls ? 'steer' : 'message')
    }
  }, [sendMode, hasFollowUpHandler, showSteerControls])

  useEffect(() => {
    if (!isWhiteboardModalOpen && !attachmentPreview) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (isWhiteboardModalOpen) setIsWhiteboardModalOpen(false)
      if (attachmentPreview) setAttachmentPreview(null)
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [isWhiteboardModalOpen, attachmentPreview])

  const addFiles = useCallback((files: FileList | File[]) => {
    const newFiles = Array.from(files)
    if (newFiles.length === 0) return
    setPendingFiles(prev => [...prev, ...newFiles])
  }, [])

  const removePendingFile = useCallback((index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index))
  }, [])

  const openWhiteboardModal = useCallback(() => {
    setInitialWhiteboardScene(whiteboardSceneRef.current)
    setWhiteboardError(null)
    setIsWhiteboardModalOpen(true)
  }, [])

  const closeWhiteboardModal = useCallback(() => {
    setWhiteboardError(null)
    setIsWhiteboardModalOpen(false)
  }, [])

  const handleWhiteboardSceneChange = useCallback((scene: WhiteboardSceneSnapshot) => {
    whiteboardSceneRef.current = scene
    if (whiteboardStorageKey) {
      persistWhiteboardScene(whiteboardStorageKey, scene)
    }
  }, [whiteboardStorageKey])

  const attachWhiteboardToPendingFiles = useCallback(async () => {
    const scene = whiteboardSceneRef.current
    if (!scene || !hasWhiteboardContent(scene)) {
      setWhiteboardError('Draw something before attaching.')
      return
    }

    setIsAttachingWhiteboard(true)
    setWhiteboardError(null)
    try {
      const sketchFile = await exportWhiteboardPngFile(scene, createWhiteboardAttachmentFilename())
      addFiles([sketchFile])
      whiteboardSceneRef.current = null
      setInitialWhiteboardScene(null)
      if (whiteboardStorageKey) {
        clearStoredWhiteboardScene(whiteboardStorageKey)
      }
      setIsWhiteboardModalOpen(false)
    } catch (err) {
      console.error('Failed to export whiteboard image:', err)
      setWhiteboardError('Failed to export whiteboard image. Please try again.')
    } finally {
      setIsAttachingWhiteboard(false)
    }
  }, [addFiles, whiteboardStorageKey])

  // Determine if file upload is supported (either via custom callback or task-specific upload)
  const canUploadFiles = !!(onUploadFiles || (workspaceId && taskId && attachments))

  useEffect(() => {
    if (canUploadFiles) return
    dragDepthRef.current = 0
    setIsDragOver(false)
  }, [canUploadFiles])

  const handleSend = async (modeOverride?: SendMode) => {
    clearVoiceHotkeyReleaseTimer()
    dictationStartedForCurrentPressRef.current = false
    stopDictation()
    const trimmed = input.trim()
    if (!trimmed && pendingFiles.length === 0) return

    const activeSendMode = modeOverride ?? sendMode

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

    const messageContent = trimmed || (attachmentIds ? '(attached files)' : '')

    if (activeSendMode === 'steer' && onSteer) {
      if (messageContent) onSteer(messageContent, attachmentIds)
    } else if (activeSendMode === 'followUp' && onFollowUp) {
      if (messageContent) onFollowUp(messageContent, attachmentIds)
    } else {
      if (messageContent) {
        onSendMessage(messageContent, attachmentIds)
      }
    }

    setInput('')
    setPendingFiles([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleStopClick = useCallback(() => {
    if (!onStop || isStopping) return
    Promise.resolve(onStop()).catch((err) => {
      console.error('Failed to stop task execution:', err)
    })
  }, [onStop, isStopping])

  const isFileDragEvent = (e: React.DragEvent): boolean => {
    return Array.from(e.dataTransfer.types).includes('Files')
  }

  const handleDragEnter = (e: React.DragEvent) => {
    if (!canUploadFiles || !isFileDragEvent(e)) return
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current += 1
    setIsDragOver(true)
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (!canUploadFiles || !isFileDragEvent(e)) return
    e.preventDefault()
    e.stopPropagation()
    if (!isDragOver) setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (!canUploadFiles) return
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setIsDragOver(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    if (!canUploadFiles) return

    dragDepthRef.current = 0
    setIsDragOver(false)

    if (e.dataTransfer.files.length === 0) {
      return
    }

    e.preventDefault()
    e.stopPropagation()
    addFiles(e.dataTransfer.files)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isComposing) return
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      void handleSend()
    } else if (e.key === 'Enter' && e.altKey && showSteerControls && hasFollowUpHandler) {
      e.preventDefault()
      void handleSend('followUp')
    }
  }

  return (
    <div
      data-chat-dropzone
      className={`flex flex-col h-full min-h-0 relative transition-colors ${
        canUploadFiles && isDragOver
          ? 'ring-2 ring-inset ring-blue-400 bg-blue-50/30'
          : ''
      }`}
      onDragEnter={canUploadFiles ? handleDragEnter : undefined}
      onDragOver={canUploadFiles ? handleDragOver : undefined}
      onDragLeave={canUploadFiles ? handleDragLeave : undefined}
      onDrop={canUploadFiles ? handleDrop : undefined}
    >
      {/* Header — shown when title, reset, or headerSlot is provided */}
      {(title || onReset || headerSlot) && (
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0">
          {title && <h2 className="font-semibold text-xs text-slate-500 uppercase tracking-wide shrink-0">{title}</h2>}
          {headerSlot && <div className="flex-1 min-w-0">{headerSlot}</div>}
          {onReset && (
            <button onClick={onReset} className="text-[10px] text-slate-400 hover:text-slate-600 font-mono transition-colors shrink-0" title="Reset conversation">
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
      {showStatusBar && statusConfig && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-50 border-b border-slate-200 shrink-0">
          <span className={`w-2 h-2 rounded-full ${statusConfig.color} ${statusConfig.pulse ? 'animate-pulse' : ''}`} />
          <span className="text-xs font-mono text-slate-500">{statusConfig.label}</span>
          {agentStream.status === 'tool_use' && agentStream.toolCalls.length > 0 && (
            <span className="text-xs text-slate-400 font-mono">
              {agentStream.toolCalls[agentStream.toolCalls.length - 1].toolName}
            </span>
          )}
          {contextUsageLabel && (
            <span className="ml-auto text-xs text-slate-400 font-mono">{contextUsageLabel}</span>
          )}

        </div>
      )}

      {/* Empty state */}
      {taskEntries.length === 0 && !isAgentActive && (agentStream.status as string) !== 'awaiting_qa' && emptyState && (
        <div className="flex flex-col items-center justify-center text-slate-400 absolute inset-0 z-0 pointer-events-none">
          <p className="text-sm font-medium text-slate-500 mb-1">{emptyState.title}</p>
          <p className="text-xs">{emptyState.subtitle}</p>
        </div>
      )}

      {canUploadFiles && isDragOver && (
        <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">
          <div className="rounded-md border border-dashed border-blue-400 bg-blue-50/95 px-4 py-2 text-sm font-medium text-blue-700 shadow-sm">
            Drop files to attach
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        data-chat-message-history
        className="flex-1 overflow-y-auto min-h-0 relative"
      >
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

              const meta = entry.metadata as Record<string, unknown> | undefined
              if (meta?.kind === 'state-transition') {
                const to = meta.to as Record<string, unknown> | undefined
                const from = meta.from as Record<string, unknown> | undefined
                const toPhase = typeof to?.phase === 'string' ? to.phase : 'unknown'
                const toMode = typeof to?.mode === 'string' ? to.mode : 'unknown'
                const toPlanning = typeof to?.planningStatus === 'string' ? to.planningStatus : 'none'
                const fromPhase = typeof from?.phase === 'string' ? from.phase : 'unknown'

                return (
                  <div key={entry.id} className="text-center py-1">
                    <span className="text-[11px] font-mono text-indigo-500">
                      state {fromPhase} to {toPhase} · {toMode} · {toPlanning}
                    </span>
                  </div>
                )
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
                const toolName = String(meta.toolName)
                const artifactId = typeof meta.artifactId === 'string' ? meta.artifactId : undefined
                const artifactName = typeof meta.artifactName === 'string' ? meta.artifactName : undefined
                const artifactHtml = typeof meta.artifactHtml === 'string' ? meta.artifactHtml : undefined
                const draftTask = isDraftTaskMetadata(meta.draftTask) ? meta.draftTask : undefined

                if (
                  toolName === 'create_artifact' &&
                  artifactId &&
                  artifactName &&
                  !Boolean(meta.isError)
                ) {
                  return (
                    <ArtifactReopenWidget
                      key={entry.id}
                      artifactId={artifactId}
                      artifactName={artifactName}
                      artifactHtml={artifactHtml}
                      onOpen={onOpenArtifact}
                      result={entry.content}
                    />
                  )
                }

                if (
                  toolName === 'create_draft_task' &&
                  draftTask &&
                  !Boolean(meta.isError)
                ) {
                  return (
                    <InlineDraftTaskWidget
                      key={entry.id}
                      draftTask={draftTask}
                      onOpen={onOpenDraftTask}
                      onCreate={onCreateDraftTask}
                      onDismiss={onDismissDraftTask}
                      state={draftTaskStates?.[draftTask.id]}
                      isCreating={creatingDraftTaskIds?.has(draftTask.id)}
                    />
                  )
                }

                return (
                  <PersistedToolBlock
                    key={entry.id}
                    toolName={toolName}
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
                            <button
                              key={att.id}
                              type="button"
                              onClick={() => setAttachmentPreview({ url, filename: att.filename })}
                              className="block cursor-zoom-in"
                              title={`Preview ${att.filename}`}
                              aria-label={`Preview ${att.filename}`}
                            >
                              <img
                                src={url}
                                alt={att.filename}
                                className="max-h-32 rounded border border-blue-200 object-cover"
                                loading="lazy"
                              />
                            </button>
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

        </div>
      </div>

      {/* Optional slot above the input (e.g. QADialog) */}
      {bottomSlot}

      {/* Input */}
      <div className="shrink-0 border-t border-slate-200 bg-white">
        {(showSteerControls || showStopControl) && (
          <div className="flex items-center gap-1 px-3 pt-2 pb-0">
            {showSteerControls && (
              <>
                <button
                  onClick={() => setSendMode('steer')}
                  className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded transition-colors inline-flex items-center gap-1 ${
                    sendMode === 'steer'
                      ? 'bg-amber-100 text-amber-700'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <AppIcon icon={Zap} size="xs" />
                  steer
                </button>
                {hasFollowUpHandler && (
                  <button
                    onClick={() => setSendMode('followUp')}
                    className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded transition-colors inline-flex items-center gap-1 ${
                      sendMode === 'followUp'
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    <AppIcon icon={CornerUpLeft} size="xs" />
                    follow-up
                  </button>
                )}
              </>
            )}

            {showStopControl && (
              <button
                type="button"
                onClick={handleStopClick}
                disabled={!!isStopping}
                className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded transition-colors inline-flex items-center gap-1 ${
                  isStopping
                    ? 'bg-red-100 text-red-500 cursor-not-allowed'
                    : 'bg-red-100 text-red-700 hover:bg-red-200'
                }`}
                title={isStopping ? 'Stopping agent…' : 'Stop agent execution'}
                aria-label={isStopping ? 'Stopping agent execution' : 'Stop agent execution'}
              >
                {isStopping ? (
                  <AppIcon icon={Loader2} size="xs" className="animate-spin" />
                ) : (
                  <AppIcon icon={X} size="xs" />
                )}
                stop
              </button>
            )}

            {showSteerControls && (
              <span className="text-[10px] text-slate-400 font-mono ml-auto">
                {sendMode === 'steer' ? 'interrupts after current tool' : 'queued for when agent finishes'}
              </span>
            )}
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
                    title="Remove attachment"
                    aria-label="Remove attachment"
                  >
                    <AppIcon icon={X} size="xs" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {dictationError && (
          <div className="px-3 pt-2 pb-0">
            <p className="text-xs text-red-600" role="status">
              {dictationError}
            </p>
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
                aria-label="Attach files"
              >
                <AppIcon icon={Paperclip} size="sm" />
              </button>
              <button
                onClick={openWhiteboardModal}
                disabled={isUploading || isAttachingWhiteboard}
                className="text-[10px] font-medium text-slate-400 hover:text-slate-600 transition-colors py-2 px-1.5 shrink-0 disabled:opacity-50"
                title="Add Excalidraw sketch"
                aria-label="Add Excalidraw sketch"
              >
                <AppIcon icon={PencilLine} size="sm" />
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
            onChange={(e) => {
              if (dictationError) clearDictationError()
              setInput(e.target.value)
            }}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            placeholder={
              isDictating
                ? 'listening… speak now'
                : showSteerControls
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
              showSteerControls && sendMode === 'steer'
                ? 'border-amber-300 focus:border-amber-400 focus:ring-amber-200'
                : showSteerControls && sendMode === 'followUp'
                ? 'border-blue-300 focus:border-blue-400 focus:ring-blue-200'
                : 'border-slate-200 focus:border-slate-400 focus:ring-slate-200'
            }`}
            rows={1}
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() && pendingFiles.length === 0}
            className={`text-sm font-mono py-2 px-3 rounded-lg shrink-0 disabled:opacity-30 transition-colors ${
              showSteerControls && sendMode === 'steer'
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'bg-slate-700 text-white hover:bg-slate-600'
            }`}
            aria-label={
              isUploading
                ? 'Uploading attachments'
                : showSteerControls && sendMode === 'steer'
                  ? 'Send steer message'
                  : showSteerControls && sendMode === 'followUp'
                    ? 'Send follow-up message'
                    : 'Send message'
            }
            title={
              isUploading
                ? 'Uploading attachments'
                : showSteerControls && sendMode === 'steer'
                  ? 'Send steer message'
                  : showSteerControls && sendMode === 'followUp'
                    ? 'Send follow-up message'
                    : 'Send message'
            }
          >
            {isUploading ? (
              <AppIcon icon={Loader2} size="sm" className="animate-spin" />
            ) : showSteerControls && sendMode === 'steer' ? (
              <AppIcon icon={Zap} size="sm" />
            ) : showSteerControls && sendMode === 'followUp' ? (
              <AppIcon icon={CornerUpLeft} size="sm" />
            ) : (
              <AppIcon icon={SendHorizontal} size="sm" />
            )}
          </button>
        </div>
      </div>

      {attachmentPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setAttachmentPreview(null)}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setAttachmentPreview(null)
            }}
            className="absolute top-4 right-4 h-8 w-8 rounded-full bg-white/20 text-white hover:bg-white/30 flex items-center justify-center"
            title="Close attachment preview"
            aria-label="Close attachment preview"
          >
            <AppIcon icon={X} size="md" />
          </button>
          <img
            src={attachmentPreview.url}
            alt={attachmentPreview.filename}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}

      {isWhiteboardModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closeWhiteboardModal}
        >
          <div
            className="w-full max-w-6xl max-h-[92vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-700">Add Excalidraw sketch</h3>
              <button
                type="button"
                onClick={closeWhiteboardModal}
                className="h-7 w-7 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 flex items-center justify-center"
                title="Close"
                aria-label="Close whiteboard"
              >
                <AppIcon icon={X} size="sm" />
              </button>
            </div>

            <div className="p-4">
              <InlineWhiteboardPanel
                isActive
                onSceneChange={handleWhiteboardSceneChange}
                initialScene={initialWhiteboardScene}
                heightClassName="h-[70vh]"
              />
              <p className="mt-2 text-xs text-slate-400">
                Click “Attach sketch” to add this drawing as a PNG attachment to your next message.
              </p>
              {whiteboardError && (
                <p className="mt-2 text-xs text-red-600">{whiteboardError}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                onClick={closeWhiteboardModal}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void attachWhiteboardToPendingFiles()}
                disabled={isAttachingWhiteboard}
                className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-600 disabled:opacity-60"
              >
                {isAttachingWhiteboard ? 'Attaching…' : 'Attach sketch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
