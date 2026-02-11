import { useRef, useEffect, useMemo, useState } from 'react'
import type { ActivityEntry, Task } from '@pi-factory/shared'
import { formatDistanceToNow } from 'date-fns'

interface ActivityLogProps {
  entries: ActivityEntry[]
  tasks?: Task[]
  onTaskClick: (task: any) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Summarise a single entry into icon + text, or null to skip it
// ─────────────────────────────────────────────────────────────────────────────

interface Summary {
  icon: string
  text: string
  style: 'tool' | 'prose' | 'user' | 'system' | 'error'
  toolType?: string   // for collapsing consecutive same-type tool calls
  toolDetail?: string // short detail for collapsed groups
}

function shortPath(p: string): string {
  const parts = p.split('/')
  return parts.slice(-2).join('/')
}

function summariseToolCall(toolName: string, args?: Record<string, unknown>): Summary | null {
  const a = args || {}
  const name = toolName.toLowerCase()
  switch (name) {
    case 'bash': {
      const cmd = String(a.command || '').split('\n')[0].slice(0, 80)
      return { icon: '$', text: cmd, style: 'tool', toolType: 'bash', toolDetail: cmd.slice(0, 30) }
    }
    case 'read': {
      const p = String(a.path || '')
      const short = shortPath(p)
      return { icon: '📄', text: short, style: 'tool', toolType: 'read', toolDetail: short }
    }
    case 'write': {
      const p = String(a.path || '')
      const short = shortPath(p)
      return { icon: '✏️', text: `wrote ${short}`, style: 'tool', toolType: 'write', toolDetail: short }
    }
    case 'edit': {
      const p = String(a.path || '')
      const short = shortPath(p)
      return { icon: '✏️', text: `edited ${short}`, style: 'tool', toolType: 'edit', toolDetail: short }
    }
    case 'web_search':
      return { icon: '🔍', text: String(a.query || '').slice(0, 50), style: 'tool', toolType: 'search' }
    case 'web_fetch':
      return { icon: '🌐', text: String(a.url || '').slice(0, 50), style: 'tool', toolType: 'fetch' }
    case 'save_plan':
      return { icon: '📋', text: 'Saved execution plan', style: 'tool', toolType: 'plan' }
    case 'output': {
      const t = String(a.content || a.text || '').split('\n')[0].slice(0, 50)
      if (!t || t.length < 5) return null
      return { icon: '💬', text: t, style: 'tool', toolType: 'output' }
    }
    default:
      return { icon: '🔧', text: toolName, style: 'tool', toolType: name }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AC2: System event messages to filter out
// ─────────────────────────────────────────────────────────────────────────────

const FILTERED_SYSTEM_MESSAGES = [
  'Agent started executing task',
  'Agent execution completed',
  'Compacting conversation...',
  'Conversation compacted',
  'Retrying after error...',
  'Retry completed',
]

function isFilteredSystemEvent(message: string): boolean {
  return FILTERED_SYSTEM_MESSAGES.some(pattern => message.startsWith(pattern))
}

// Patterns that indicate tool output / code, not useful prose
const JUNK_PATTERNS = [
  /^\s*[\{\}\(\)\[\];,]\s*$/,          // lone brackets / punctuation
  /^\s*\/[/*]/,                         // comment lines
  /^\s*\*\//,                           // end-of-comment
  /^\s*import\s/,                       // import statements
  /^\s*export\s/,                       // export statements
  /^\s*from\s/,                         // from statements
  /^\s*package\s/,                      // package declaration
  /^\s*class\s/,                        // class declaration
  /^\s*def\s/,                          // python def
  /^\s*module\s/,                       // module declaration
  /^\s*load\("/,                        // bazel load
  /^\(no output\)/i,                    // empty output
  /^total\s+\d+/,                       // ls output
  /^[a-f0-9]{7,40}\s/,                 // git hashes
  /^\d+:\s/,                            // line-numbered output
  /^drwx|^-rw/,                         // ls -la output
  /^\s*\d+\s*$/,                        // just a number
  /^={5,}/,                             // separator lines
  /^\s*\/\//,                           // // comments
]

function isJunkProse(content: string): boolean {
  const trimmed = content.trim()
  if (trimmed.length < 8) return true
  const firstLine = trimmed.split('\n')[0]
  return JUNK_PATTERNS.some(p => p.test(firstLine))
}

function summariseEntry(entry: ActivityEntry): Summary | null {
  // AC2: Filter out noisy system events
  if (entry.type === 'system-event') {
    if (isFilteredSystemEvent(entry.message)) return null
    return { icon: '—', text: entry.message, style: 'system' }
  }

  if (entry.type === 'chat-message') {
    const meta = entry.metadata as Record<string, unknown> | undefined

    // AC8: Tool call with metadata — show only summarized path/command, never content
    if (meta?.toolName) {
      const summary = summariseToolCall(String(meta.toolName), meta.args as Record<string, unknown> | undefined)
      if (!summary) return null
      return { ...summary, style: meta.isError ? 'error' : summary.style }
    }

    // User message — always show
    if (entry.role === 'user') {
      const firstLine = entry.content.split('\n')[0].slice(0, 60)
      return { icon: '👤', text: firstLine, style: 'user' }
    }

    // Agent prose — filter aggressively
    if (isJunkProse(entry.content)) return null

    const firstLine = entry.content.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 70)
    return { icon: '💬', text: firstLine, style: 'prose' }
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Collapse consecutive same-type tool calls AND consecutive prose messages
// ─────────────────────────────────────────────────────────────────────────────

interface DisplayLine {
  id: string
  icon: string
  text: string
  style: Summary['style']
}

function collapseConsecutive(items: { id: string; summary: Summary }[]): DisplayLine[] {
  const result: DisplayLine[] = []
  let i = 0

  while (i < items.length) {
    const current = items[i]
    const { summary } = current

    // AC1: Collapse tool calls at threshold of 2+ (was 3+)
    if (summary.toolType && summary.style === 'tool') {
      let j = i + 1
      while (j < items.length && items[j].summary.toolType === summary.toolType && items[j].summary.style === 'tool') {
        j++
      }
      const count = j - i

      if (count >= 2) {
        const details = items.slice(i, j)
          .map(x => x.summary.toolDetail || '')
          .filter(Boolean)

        const label = summary.toolType === 'read' ? `Read ${count} files`
          : summary.toolType === 'edit' ? `Edited ${count} files`
          : summary.toolType === 'write' ? `Wrote ${count} files`
          : summary.toolType === 'bash' ? `Ran ${count} commands`
          : `${summary.toolType} ×${count}`

        const hint = details.slice(0, 2).join(', ')
        const text = hint ? `${label} (${hint}${count > 2 ? ', …' : ''})` : label

        result.push({ id: current.id, icon: summary.icon, text, style: 'tool' })
        i = j
        continue
      }
    }

    // AC3: Collapse 3+ consecutive prose messages
    if (summary.style === 'prose') {
      let j = i + 1
      while (j < items.length && items[j].summary.style === 'prose') {
        j++
      }
      const count = j - i

      if (count >= 3) {
        result.push({
          id: current.id,
          icon: '💬',
          text: `${count} messages`,
          style: 'prose',
        })
        i = j
        continue
      }
    }

    // Not collapsed — show as-is
    result.push({
      id: current.id,
      icon: summary.icon,
      text: summary.text,
      style: summary.style,
    })
    i++
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// AC6: Compute per-group progress summary
// ─────────────────────────────────────────────────────────────────────────────

function computeGroupSummary(entries: ActivityEntry[], startTime: string): string {
  let toolCalls = 0
  let messages = 0

  for (const entry of entries) {
    if (entry.type === 'chat-message') {
      const meta = entry.metadata as Record<string, unknown> | undefined
      if (meta?.toolName) {
        toolCalls++
      } else {
        messages++
      }
    }
  }

  const parts: string[] = []
  if (toolCalls > 0) parts.push(`${toolCalls} tool call${toolCalls !== 1 ? 's' : ''}`)
  if (messages > 0) parts.push(`${messages} message${messages !== 1 ? 's' : ''}`)

  try {
    const relative = formatDistanceToNow(new Date(startTime), { addSuffix: true })
    parts.push(relative)
  } catch {
    // skip if timestamp is invalid
  }

  return parts.join(' · ') || 'No activity'
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const MAX_VISIBLE_LINES = 8

export function ActivityLog({ entries, tasks, onTaskClick }: ActivityLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // AC7: Track which groups are expanded (persists during session via state)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries.length])

  const groupedEntries = useMemo(() => groupEntriesByTask(entries, tasks), [entries, tasks])

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) {
        next.delete(groupKey)
      } else {
        next.add(groupKey)
      }
      return next
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* AC5: Header — no entry count badge */}
      <div className="flex items-center px-4 py-2.5 border-b border-slate-100 shrink-0">
        <h2 className="font-semibold text-xs text-slate-500 uppercase tracking-wide">Activity</h2>
      </div>

      {/* Entries */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {groupedEntries.map((group, groupIndex) => {
          const isActive = groupIndex === groupedEntries.length - 1
          const groupKey = group.taskId + groupIndex

          const summaries = group.entries
            .map(e => ({ id: e.id, summary: summariseEntry(e) }))
            .filter((s): s is { id: string; summary: Summary } => s.summary !== null)

          const lines = collapseConsecutive(summaries)

          // AC6: Progress summary
          const progressSummary = computeGroupSummary(group.entries, group.startTime)

          // AC7: Show only last MAX_VISIBLE_LINES unless expanded
          const isExpanded = expandedGroups.has(groupKey)
          const totalLines = lines.length
          const hiddenCount = totalLines > MAX_VISIBLE_LINES ? totalLines - MAX_VISIBLE_LINES : 0
          const visibleLines = (hiddenCount > 0 && !isExpanded)
            ? lines.slice(totalLines - MAX_VISIBLE_LINES)
            : lines

          return (
            <div key={groupKey}>
              {/* Task header — AC5: static dot (no animate-pulse), task ID de-emphasized */}
              <div
                className={`sticky top-0 z-10 px-3 py-2 cursor-pointer transition-colors border-b ${
                  isActive
                    ? 'bg-orange-50 border-l-[3px] border-l-safety-orange border-b-orange-100 hover:bg-orange-100'
                    : 'bg-slate-50 border-b-slate-100 hover:bg-slate-100'
                }`}
                onClick={() => onTaskClick({ id: group.taskId, frontmatter: { title: group.taskTitle } })}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-safety-orange' : 'bg-slate-300'}`} />
                  <span className="text-xs font-medium text-slate-700 truncate">{group.taskTitle}</span>
                </div>
                {/* AC6: Progress summary line */}
                <div className="text-[10px] text-slate-400 mt-0.5 ml-4">{progressSummary}</div>
              </div>

              {/* Compact event list */}
              <div className="py-0.5">
                {/* AC7: "Show N more..." link */}
                {hiddenCount > 0 && !isExpanded && (
                  <button
                    className="px-3 py-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); toggleGroup(groupKey) }}
                  >
                    Show {hiddenCount} more…
                  </button>
                )}
                {/* AC7: Collapse link when expanded */}
                {hiddenCount > 0 && isExpanded && (
                  <button
                    className="px-3 py-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); toggleGroup(groupKey) }}
                  >
                    Show less
                  </button>
                )}
                {visibleLines.map(({ id, icon, text, style }) => (
                  <div
                    key={id}
                    className="flex items-center gap-1.5 px-3 py-[3px] min-w-0 hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => onTaskClick({ id: group.taskId, frontmatter: { title: group.taskTitle } })}
                  >
                    {/* AC4: Tool icons in muted gray (text-slate-400) */}
                    <span className={`text-[11px] shrink-0 w-4 text-center ${
                      style === 'error' ? 'text-red-500'
                      : style === 'user' ? 'text-blue-600'
                      : 'text-slate-400'
                    }`}>
                      {icon}
                    </span>
                    {/* AC4: Unified text colors — error=red, user=blue, everything else=text-slate-500 */}
                    <span className={`text-[11px] truncate min-w-0 ${
                      style === 'error' ? 'text-red-600'
                      : style === 'user' ? 'text-blue-700'
                      : 'text-slate-500'
                    }${style === 'tool' ? ' font-mono' : ''}`}>
                      {text}
                    </span>
                  </div>
                ))}
                {lines.length === 0 && summaries.length === 0 && (
                  <div className="px-3 py-1 text-[11px] text-slate-300 italic">No events</div>
                )}
              </div>
            </div>
          )
        })}

        {entries.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <p className="text-sm">No activity yet</p>
            <p className="text-xs mt-1">Tasks will appear here when agents start working</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Grouping
// ─────────────────────────────────────────────────────────────────────────────

interface GroupedEntries {
  taskId: string
  taskTitle: string
  startTime: string
  entries: ActivityEntry[]
}

function groupEntriesByTask(entries: ActivityEntry[], tasks?: Task[]): GroupedEntries[] {
  // Sort chronologically (oldest first)
  const sorted = [...entries].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0
  )

  // Build a title lookup from tasks list + separator entries
  const taskTitles = new Map<string, string>()
  if (tasks) {
    for (const t of tasks) {
      taskTitles.set(t.id, t.frontmatter.title)
    }
  }
  for (const entry of sorted) {
    if (entry.type === 'task-separator') {
      taskTitles.set(entry.taskId, entry.taskTitle)
    }
  }

  // Group entries, using separator boundaries to start new groups
  const groups: GroupedEntries[] = []
  let currentGroup: GroupedEntries | null = null

  for (const entry of sorted) {
    if (entry.type === 'task-separator') {
      currentGroup = {
        taskId: entry.taskId,
        taskTitle: entry.taskTitle,
        startTime: entry.timestamp,
        entries: [],
      }
      groups.push(currentGroup)
    } else if (currentGroup && entry.taskId === currentGroup.taskId) {
      currentGroup.entries.push(entry)
    } else {
      // Different task or no current group — look up title from tasks
      const title = taskTitles.get(entry.taskId) || 'Unknown Task'
      currentGroup = {
        taskId: entry.taskId,
        taskTitle: title,
        startTime: entry.timestamp,
        entries: [entry],
      }
      groups.push(currentGroup)
    }
  }

  return groups
}
