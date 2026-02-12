import { useEffect, useState } from 'react'
import type { PostExecutionSummary as PostExecutionSummaryType, FileDiff, DiffHunk, CriterionValidation, SummaryArtifact } from '@pi-factory/shared'
import { api } from '../api'

interface PostExecutionSummaryProps {
  summary: PostExecutionSummaryType
  workspaceId: string
  taskId: string
  onSummaryUpdated?: (summary: PostExecutionSummaryType) => void
}

export function PostExecutionSummary({
  summary,
  workspaceId,
  taskId,
  onSummaryUpdated,
}: PostExecutionSummaryProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(
    () => new Set(summary.fileDiffs.map(diff => diff.filePath))
  )
  const [isRegenerating, setIsRegenerating] = useState(false)
  const diffExpansionKey = summary.fileDiffs.map(diff => diff.filePath).join('\n')

  useEffect(() => {
    setExpandedFiles(new Set(summary.fileDiffs.map(diff => diff.filePath)))
  }, [summary.completedAt, diffExpansionKey])

  const toggleFile = (filePath: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev)
      if (next.has(filePath)) {
        next.delete(filePath)
      } else {
        next.add(filePath)
      }
      return next
    })
  }

  const handleRegenerate = async () => {
    setIsRegenerating(true)
    try {
      const updated = await api.generateSummary(workspaceId, taskId)
      onSummaryUpdated?.(updated)
    } catch (err) {
      console.error('Failed to regenerate summary:', err)
    } finally {
      setIsRegenerating(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Execution Summary</h3>
          <span className="text-[10px] text-emerald-400 ml-auto">
            {new Date(summary.completedAt).toLocaleString()}
          </span>
          <button
            onClick={handleRegenerate}
            disabled={isRegenerating}
            className="text-[10px] text-emerald-600 hover:text-emerald-800 font-medium disabled:opacity-50 disabled:cursor-wait flex items-center gap-1"
            title="Regenerate summary using the agent session"
          >
            {isRegenerating ? (
              <><span className="inline-block w-2.5 h-2.5 border border-emerald-500 border-t-transparent rounded-full animate-spin" />Regenerating…</>
            ) : '↻ Regenerate'}
          </button>
        </div>
        <p className="text-sm text-slate-700 leading-relaxed">{summary.summary}</p>
      </div>

      {/* Acceptance Criteria Validation */}
      {summary.criteriaValidation.length > 0 && (
        <CriteriaValidationSection
          criteria={summary.criteriaValidation}
          workspaceId={workspaceId}
          taskId={taskId}
          onSummaryUpdated={onSummaryUpdated}
        />
      )}

      {/* File Diffs */}
      {summary.fileDiffs.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Changed Files
            <span className="ml-1.5 text-slate-400 font-normal">({summary.fileDiffs.length})</span>
          </h3>
          <div className="space-y-1">
            {summary.fileDiffs.map((diff) => (
              <FileDiffView
                key={diff.filePath}
                diff={diff}
                isExpanded={expandedFiles.has(diff.filePath)}
                onToggle={() => toggleFile(diff.filePath)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Artifacts */}
      {summary.artifacts.length > 0 && (
        <ArtifactsGallery artifacts={summary.artifacts} />
      )}
    </div>
  )
}

// =============================================================================
// Generate Summary Button (for tasks without a summary)
// =============================================================================

interface GenerateSummaryButtonProps {
  workspaceId: string
  taskId: string
  onGenerated: (summary: PostExecutionSummaryType) => void
}

export function GenerateSummaryButton({ workspaceId, taskId, onGenerated }: GenerateSummaryButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false)

  const handleGenerate = async () => {
    setIsGenerating(true)
    try {
      const summary = await api.generateSummary(workspaceId, taskId)
      onGenerated(summary)
    } catch (err) {
      console.error('Failed to generate summary:', err)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="bg-slate-50 border border-slate-200 border-dashed rounded-lg p-6 text-center">
      <p className="text-sm text-slate-500 mb-3">No post-execution summary available.</p>
      <button
        onClick={handleGenerate}
        disabled={isGenerating}
        className="btn btn-primary text-sm py-1.5 px-4 disabled:opacity-50"
      >
        {isGenerating ? (
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Generating…
          </span>
        ) : (
          'Generate Summary'
        )}
      </button>
    </div>
  )
}

// =============================================================================
// Criteria Validation Section
// =============================================================================

function CriteriaValidationSection({
  criteria,
}: {
  criteria: CriterionValidation[]
  workspaceId: string
  taskId: string
  onSummaryUpdated?: (summary: PostExecutionSummaryType) => void
}) {
  const passCount = criteria.filter(c => c.status === 'pass').length
  const failCount = criteria.filter(c => c.status === 'fail').length
  const pendingCount = criteria.filter(c => c.status === 'pending').length
  const total = criteria.length

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Acceptance Criteria
        </h3>
        <span className="text-xs font-medium">
          {failCount > 0 ? (
            <span className="text-red-600">{passCount}/{total} passing</span>
          ) : pendingCount > 0 ? (
            <span className="text-amber-600">{passCount}/{total} passing</span>
          ) : (
            <span className="text-emerald-600">{passCount}/{total} passing</span>
          )}
        </span>
      </div>
      <ul className="space-y-1.5">
        {criteria.map((cv, index) => (
          <CriterionRow key={index} criterion={cv} />
        ))}
      </ul>
    </div>
  )
}

function CriterionRow({ criterion }: { criterion: CriterionValidation }) {
  const isPassing = criterion.status === 'pass'
  const isFailing = criterion.status === 'fail'

  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span className={`shrink-0 mt-0.5 text-sm ${
        isPassing ? 'text-emerald-500' : isFailing ? 'text-red-500' : 'text-slate-300'
      }`}>
        {isPassing ? '✓' : isFailing ? '✗' : '○'}
      </span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${isFailing ? 'text-red-700' : 'text-slate-700'}`}>
          {criterion.criterion}
        </p>
        {criterion.evidence && (
          <p className="text-xs text-slate-400 mt-0.5">{criterion.evidence}</p>
        )}
      </div>
    </li>
  )
}

// =============================================================================
// File Diff View
// =============================================================================

function FileDiffView({
  diff,
  isExpanded,
  onToggle,
}: {
  diff: FileDiff
  isExpanded: boolean
  onToggle: () => void
}) {
  const addCount = diff.hunks.filter(h => h.type === 'add').length
  const delCount = diff.hunks.filter(h => h.type === 'del').length

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-left transition-colors"
      >
        <span className="text-xs text-slate-400">{isExpanded ? '▼' : '▶'}</span>
        <span className="text-xs font-mono text-slate-700 truncate flex-1">{diff.filePath}</span>
        <span className="flex items-center gap-2 shrink-0">
          {addCount > 0 && <span className="text-[10px] text-emerald-600 font-medium">+{addCount}</span>}
          {delCount > 0 && <span className="text-[10px] text-red-600 font-medium">−{delCount}</span>}
        </span>
      </button>
      {isExpanded && (
        <div className="px-3 py-2 bg-white border-t border-slate-200 overflow-x-auto">
          <pre className="text-xs leading-5 font-mono whitespace-pre-wrap break-words">
            {diff.hunks.map((hunk, i) => (
              <DiffHunkSpan key={i} hunk={hunk} />
            ))}
          </pre>
        </div>
      )}
    </div>
  )
}

function DiffHunkSpan({ hunk }: { hunk: DiffHunk }) {
  if (hunk.type === 'add') {
    return (
      <span className="bg-emerald-100 text-emerald-800 rounded-sm px-0.5">{hunk.content}</span>
    )
  }
  if (hunk.type === 'del') {
    return (
      <span className="bg-red-100 text-red-800 line-through rounded-sm px-0.5">{hunk.content}</span>
    )
  }
  return <span className="text-slate-500">{hunk.content}</span>
}

// =============================================================================
// Artifacts Gallery
// =============================================================================

function ArtifactsGallery({ artifacts }: { artifacts: SummaryArtifact[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
        Artifacts
        <span className="ml-1.5 text-slate-400 font-normal">({artifacts.length})</span>
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {artifacts.map((artifact, i) => (
          <a
            key={i}
            href={artifact.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 p-3 border border-slate-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors group"
          >
            <span className="text-xs text-slate-400 group-hover:text-blue-500 uppercase font-medium shrink-0">
              {artifact.type}
            </span>
            <span className="text-sm text-slate-700 group-hover:text-blue-700 truncate">
              {artifact.name}
            </span>
            <span className="text-slate-300 group-hover:text-blue-400 ml-auto shrink-0">→</span>
          </a>
        ))}
      </div>
    </div>
  )
}
