import { useState, useEffect, useRef, useCallback } from 'react'
import type { Task, Phase, ModelConfig, PostExecutionSummary as PostExecutionSummaryType } from '@pi-factory/shared'
import { PHASES, PHASE_DISPLAY_NAMES, getPromotePhase, getDemotePhase } from '@pi-factory/shared'
import { MarkdownEditor } from './MarkdownEditor'
import type { PostExecutionSkill } from '../types/pi'
import { SkillSelector } from './SkillSelector'
import { ModelSelector } from './ModelSelector'
import { PostExecutionSummary, GenerateSummaryButton } from './PostExecutionSummary'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api'

const REMARK_PLUGINS = [remarkGfm]

interface TaskDetailPaneProps {
  task: Task
  workspaceId: string
  moveError: string | null
  isPlanGenerating?: boolean
  onClose: () => void
  onMove: (phase: Phase) => void
  onDelete?: () => void
}

export function TaskDetailPane({
  task,
  workspaceId,
  onClose,
  onMove,
  moveError,
  isPlanGenerating,
  onDelete,
}: TaskDetailPaneProps) {
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editedTitle, setEditedTitle] = useState(task.frontmatter.title)
  const [editedContent, setEditedContent] = useState(task.content)
  const [editedCriteria, setEditedCriteria] = useState(
    task.frontmatter.acceptanceCriteria.join('\n')
  )
  const [availableSkills, setAvailableSkills] = useState<PostExecutionSkill[]>([])
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(
    task.frontmatter.postExecutionSkills || []
  )
  const [editedModelConfig, setEditedModelConfig] = useState<ModelConfig | undefined>(
    task.frontmatter.modelConfig
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const { frontmatter } = task

  // Determine which fields to highlight based on move error
  const missingAcceptanceCriteria =
    moveError?.toLowerCase().includes('acceptance criteria') &&
    frontmatter.acceptanceCriteria.length === 0

  // Fetch available post-execution skills
  useEffect(() => {
    fetch('/api/factory/skills')
      .then(r => r.json())
      .then(setAvailableSkills)
      .catch(err => console.error('Failed to load post-execution skills:', err))
  }, [])

  // Reset edit state when task changes
  useEffect(() => {
    setIsEditing(false)
    setEditedTitle(task.frontmatter.title)
    setEditedContent(task.content)
    setEditedCriteria(task.frontmatter.acceptanceCriteria.join('\n'))
    setSelectedSkillIds(task.frontmatter.postExecutionSkills || [])
    setEditedModelConfig(task.frontmatter.modelConfig)
  }, [task.id])



  const handleSaveEdit = async () => {
    try {
      await fetch(`/api/workspaces/${workspaceId}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editedTitle,
          content: editedContent,
          acceptanceCriteria: editedCriteria
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          postExecutionSkills: selectedSkillIds,
          modelConfig: editedModelConfig,
        }),
      })
      setIsEditing(false)
    } catch (err) {
      console.error('Failed to save task:', err)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this task?')) return
    try {
      await fetch(`/api/workspaces/${workspaceId}/tasks/${task.id}`, {
        method: 'DELETE',
      })
      onDelete?.()
      onClose()
    } catch (err) {
      console.error('Failed to delete task:', err)
    }
  }

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-10 border-b border-slate-200 bg-slate-50 shrink-0">
        <div className="flex items-center gap-2">
          <span className={`phase-badge phase-badge-${frontmatter.phase}`}>
            {PHASE_DISPLAY_NAMES[frontmatter.phase]}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Demote button */}
          {(() => {
            const demoteTo = getDemotePhase(frontmatter.phase);
            return (
              <button
                onClick={() => demoteTo && onMove(demoteTo)}
                disabled={!demoteTo}
                className="btn text-xs py-1 px-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← {demoteTo ? PHASE_DISPLAY_NAMES[demoteTo] : 'None'}
              </button>
            );
          })()}
          {/* Promote button */}
          {(() => {
            const promoteTo = getPromotePhase(frontmatter.phase);
            return (
              <button
                onClick={() => promoteTo && onMove(promoteTo)}
                disabled={!promoteTo}
                className="btn text-xs py-1 px-2.5 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {promoteTo ? PHASE_DISPLAY_NAMES[promoteTo] : 'None'} →
              </button>
            );
          })()}
          <div className="relative">
            <button
              onClick={() => setShowMoveMenu(!showMoveMenu)}
              className="btn btn-secondary text-xs py-1 px-2.5"
            >
              Move ▾
            </button>
            {showMoveMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 min-w-[150px]">
                {PHASES.map((phase) => (
                  <button
                    key={phase}
                    onClick={() => {
                      onMove(phase)
                      setShowMoveMenu(false)
                    }}
                    disabled={phase === frontmatter.phase}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed first:rounded-t-lg last:rounded-b-lg"
                  >
                    <span className={`inline-block w-2 h-2 rounded-full mr-2 phase-dot-${phase}`} />
                    {PHASE_DISPLAY_NAMES[phase]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Move error banner */}
      {moveError && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm shrink-0">
          <span className="text-amber-600 shrink-0 text-xs font-semibold">!</span>
          <span>{moveError}</span>
        </div>
      )}

      {/* Details content — chat is now in the left pane */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <DetailsContent
          task={task}
          workspaceId={workspaceId}
          frontmatter={frontmatter}
          isEditing={isEditing}
          setIsEditing={setIsEditing}
          editedTitle={editedTitle}
          setEditedTitle={setEditedTitle}
          editedContent={editedContent}
          setEditedContent={setEditedContent}
          editedCriteria={editedCriteria}
          setEditedCriteria={setEditedCriteria}
          editedModelConfig={editedModelConfig}
          setEditedModelConfig={setEditedModelConfig}
          selectedSkillIds={selectedSkillIds}
          setSelectedSkillIds={setSelectedSkillIds}
          availableSkills={availableSkills}
          missingAcceptanceCriteria={missingAcceptanceCriteria}
          isPlanGenerating={isPlanGenerating}
          onSaveEdit={handleSaveEdit}
          onDelete={handleDelete}
        />
      </div>
    </div>
  )
}

// =============================================================================
// Details Content — shared between tabbed and side-by-side layouts
// =============================================================================

function DetailsContent({ task, workspaceId, frontmatter, isEditing, setIsEditing, editedTitle, setEditedTitle, editedContent, setEditedContent, editedCriteria, setEditedCriteria, editedModelConfig, setEditedModelConfig, selectedSkillIds, setSelectedSkillIds, availableSkills, missingAcceptanceCriteria, isPlanGenerating, onSaveEdit, onDelete }: any) {
  const isCompleted = frontmatter.phase === 'complete' || frontmatter.phase === 'archived'

  return (
    <div className="p-5 space-y-5">
      {/* Post-Execution Summary (for completed tasks) */}
      {isCompleted && (
        <PostExecutionSummarySection
          task={task}
          workspaceId={workspaceId}
        />
      )}

      {/* Title */}
      <div>
        {isEditing ? (
          <input type="text" value={editedTitle} onChange={(e: any) => setEditedTitle(e.target.value)} className="text-xl font-bold text-slate-900 w-full bg-transparent border-b-2 border-blue-400 outline-none pb-1" />
        ) : (
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-xl font-bold text-slate-900 leading-tight">{frontmatter.title}</h1>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => setIsEditing(true)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Edit</button>
              <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-700 font-medium">Delete</button>
            </div>
          </div>
        )}
      </div>

      {/* Model Configuration */}
      {(isEditing || frontmatter.modelConfig) && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Model</h3>
          {isEditing ? (
            <ModelSelector value={editedModelConfig} onChange={setEditedModelConfig} />
          ) : frontmatter.modelConfig ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 border border-blue-200 text-xs font-medium text-blue-700">
                <span className="text-blue-400">{frontmatter.modelConfig.provider}</span>
                <span className="text-blue-300">/</span>
                {frontmatter.modelConfig.modelId}
              </span>
              {frontmatter.modelConfig.thinkingLevel && (
                <span className="inline-flex items-center px-2 py-1 rounded-md bg-purple-50 border border-purple-200 text-xs font-medium text-purple-700">
                  reasoning: {frontmatter.modelConfig.thinkingLevel}
                </span>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Post-Execution Skills */}
      {(isEditing ? availableSkills.length > 0 : (frontmatter.postExecutionSkills || []).length > 0) && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Post-Execution Skills</h3>
          {isEditing ? (
            <div>
              <p className="text-xs text-slate-400 mb-2">Skills run automatically after the agent completes its main work.</p>
              <SkillSelector availableSkills={availableSkills} selectedSkillIds={selectedSkillIds} onChange={setSelectedSkillIds} />
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {(frontmatter.postExecutionSkills || []).map((skillId: string, index: number) => {
                const skill = availableSkills.find((s: any) => s.id === skillId)
                return (
                  <span key={skillId} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-orange-50 border border-orange-200 text-xs font-medium text-orange-700">
                    <span className="text-[10px] text-orange-400 font-bold">{index + 1}.</span>
                    <span className="text-[10px] text-slate-400 font-mono">{skill?.type === 'loop' ? 'loop' : 'gate'}</span>
                    {skill?.name || skillId}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Plan */}
      {!frontmatter.plan && isPlanGenerating && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <svg className="animate-spin h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <div>
              <h3 className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Generating Plan…</h3>
              <p className="text-xs text-blue-500 mt-0.5">Planning agent is exploring the codebase — follow along in the chat</p>
            </div>
          </div>
        </div>
      )}
      {frontmatter.plan && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Plan</h3>
            <span className="text-[10px] text-blue-400 ml-auto">Generated {new Date(frontmatter.plan.generatedAt).toLocaleString()}</span>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-slate-600 mb-1">Goal</h4>
            <div className="prose prose-slate prose-sm max-w-none text-slate-800"><ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{frontmatter.plan.goal}</ReactMarkdown></div>
          </div>
          {frontmatter.plan.steps.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-600 mb-1">Steps</h4>
              <ol className="space-y-2">
                {frontmatter.plan.steps.map((step: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="text-blue-600 font-semibold shrink-0 min-w-[1.5rem] text-right">{i + 1}.</span>
                    <div className="prose prose-slate prose-sm max-w-none min-w-0 [&>p]:m-0"><ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{step}</ReactMarkdown></div>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {frontmatter.plan.validation.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-600 mb-1">Validation</h4>
              <ul className="space-y-1.5">
                {frontmatter.plan.validation.map((item: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700"><span className="text-green-500 shrink-0 mt-0.5">✓</span><div className="prose prose-slate prose-sm max-w-none min-w-0 [&>p]:m-0"><ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{item}</ReactMarkdown></div></li>
                ))}
              </ul>
            </div>
          )}
          {frontmatter.plan.cleanup.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-600 mb-1">Cleanup</h4>
              <ul className="space-y-1.5">
                {frontmatter.plan.cleanup.map((item: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700"><span className="text-slate-400 shrink-0 mt-0.5 text-xs">—</span><div className="prose prose-slate prose-sm max-w-none min-w-0 [&>p]:m-0"><ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{item}</ReactMarkdown></div></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Description */}
      <div>
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Description</h3>
        {isEditing ? (
          <MarkdownEditor value={editedContent} onChange={setEditedContent} placeholder="Task description in markdown..." minHeight="400px" />
        ) : task.content ? (
          <div className="prose prose-slate prose-sm max-w-none"><ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{task.content}</ReactMarkdown></div>
        ) : (
          <p className="text-sm text-slate-400 italic">No description</p>
        )}
      </div>

      {/* Acceptance Criteria */}
      <div className={missingAcceptanceCriteria ? 'rounded-lg border-2 border-red-300 bg-red-50 p-3 -mx-1' : ''}>
        <div className="mb-2">
          <h3 className={`text-xs font-semibold uppercase tracking-wide ${missingAcceptanceCriteria ? 'text-red-600' : 'text-slate-500'}`}>
            {missingAcceptanceCriteria && <span className="mr-1 text-red-500">!</span>}Acceptance Criteria
          </h3>
        </div>
        {isEditing ? (
          <MarkdownEditor value={editedCriteria} onChange={setEditedCriteria} placeholder="One criterion per line" minHeight="160px" />
        ) : frontmatter.acceptanceCriteria.length > 0 ? (
          <ul className="space-y-1.5">
            {frontmatter.acceptanceCriteria.map((criteria: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="w-5 h-5 rounded border border-slate-300 flex items-center justify-center text-[10px] text-slate-400 shrink-0 mt-0.5">{i + 1}</span>
                <div className="prose prose-slate prose-sm max-w-none min-w-0 text-slate-700 [&>p]:m-0"><ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{criteria}</ReactMarkdown></div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`text-sm italic ${missingAcceptanceCriteria ? 'text-red-500 font-medium' : 'text-slate-400'}`}>No acceptance criteria defined</p>
        )}
      </div>

      {/* Edit actions */}
      {isEditing && (
        <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
          <button onClick={onSaveEdit} className="btn btn-primary text-sm py-1.5 px-4">Save Changes</button>
          <button onClick={() => { setIsEditing(false); setEditedTitle(task.frontmatter.title); setEditedContent(task.content); setEditedCriteria(task.frontmatter.acceptanceCriteria.join('\n')); setSelectedSkillIds(task.frontmatter.postExecutionSkills || []); setEditedModelConfig(task.frontmatter.modelConfig) }} className="btn btn-secondary text-sm py-1.5 px-4">Discard</button>
        </div>
      )}

      {/* Attachments */}
      <AttachmentsSection task={task} workspaceId={workspaceId} />

      {/* Metadata */}
      <div className="text-xs text-slate-400 pt-4 border-t border-slate-100 space-y-1">
        <div className="flex justify-between"><span>Created</span><span>{new Date(frontmatter.created).toLocaleString()}</span></div>
        <div className="flex justify-between"><span>Updated</span><span>{new Date(frontmatter.updated).toLocaleString()}</span></div>
        {frontmatter.started && <div className="flex justify-between"><span>Started</span><span>{new Date(frontmatter.started).toLocaleString()}</span></div>}
        {frontmatter.completed && <div className="flex justify-between"><span>Completed</span><span>{new Date(frontmatter.completed).toLocaleString()}</span></div>}
        {frontmatter.cycleTime != null && (
          <div className="flex justify-between">
            <span>Cycle Time</span>
            <span className="font-mono">{formatDuration(frontmatter.cycleTime)}</span>
          </div>
        )}
        {frontmatter.leadTime != null && (
          <div className="flex justify-between">
            <span>Lead Time</span>
            <span className="font-mono">{formatDuration(frontmatter.leadTime)}</span>
          </div>
        )}
        {frontmatter.branch && <div className="flex justify-between"><span>Branch</span><span className="font-mono">{frontmatter.branch}</span></div>}
        {frontmatter.prUrl && <div className="flex justify-between"><span>PR</span><a href={frontmatter.prUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">View PR →</a></div>}
      </div>
    </div>
  )
}

// =============================================================================
// Attachments Section
// =============================================================================

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function AttachmentsSection({ task, workspaceId }: { task: Task; workspaceId: string }) {
  const [isUploading, setIsUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachments = task.frontmatter.attachments || []

  const handleUpload = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return

    setIsUploading(true)
    try {
      await api.uploadAttachments(workspaceId, task.id, fileArray)
    } catch (err) {
      console.error('Failed to upload attachments:', err)
    } finally {
      setIsUploading(false)
    }
  }, [workspaceId, task.id])

  const handleDelete = async (attachmentId: string) => {
    if (!confirm('Delete this attachment?')) return
    try {
      await api.deleteAttachment(workspaceId, task.id, attachmentId)
    } catch (err) {
      console.error('Failed to delete attachment:', err)
    }
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
      handleUpload(e.dataTransfer.files)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Attachments
          {attachments.length > 0 && (
            <span className="ml-1.5 text-slate-400 font-normal">({attachments.length})</span>
          )}
        </h3>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
        >
          {isUploading ? 'Uploading...' : '+ Add Files'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.md,.json,.csv,.log"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleUpload(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {/* Drop zone (shown when no attachments or dragging) */}
      {(attachments.length === 0 || isDragOver) && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !isUploading && fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            isUploading
              ? 'border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed'
              : 'cursor-pointer ' + (isDragOver
                ? 'border-blue-400 bg-blue-50'
                : 'border-slate-200 bg-slate-50 hover:border-slate-300')
          }`}
        >
          <div className="text-slate-300 text-sm font-medium mb-1">No files</div>
          <p className="text-sm text-slate-500">
            {isDragOver ? 'Drop files here' : 'Drag & drop or click to add files'}
          </p>
          <p className="text-xs text-slate-400 mt-1">Images, PDFs, text files — up to 20 MB each</p>
        </div>
      )}

      {/* Attachment grid */}
      {attachments.length > 0 && (
        <div
          className="grid grid-cols-3 gap-2"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {attachments.map((att) => {
            const url = api.getAttachmentUrl(workspaceId, task.id, att.storedName)
            const isImage = isImageMime(att.mimeType)

            return (
              <div
                key={att.id}
                className="group relative border border-slate-200 rounded-lg overflow-hidden bg-slate-50 hover:border-slate-300 transition-colors"
              >
                {isImage ? (
                  <button
                    onClick={() => setPreviewUrl(url)}
                    className="block w-full aspect-square"
                  >
                    <img
                      src={url}
                      alt={att.filename}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </button>
                ) : (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center justify-center w-full aspect-square p-2"
                  >
                    <span className="text-xs text-slate-400 font-mono mb-1">FILE</span>
                    <span className="text-[10px] text-slate-500 text-center truncate w-full px-1">
                      {att.filename}
                    </span>
                  </a>
                )}

                {/* File info overlay */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-[10px] text-white truncate">{att.filename}</p>
                  <p className="text-[10px] text-white/70">{formatFileSize(att.size)}</p>
                </div>

                {/* Delete button */}
                <button
                  onClick={() => handleDelete(att.id)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                  title="Delete attachment"
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Image preview modal */}
      {previewUrl && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8"
          onClick={() => setPreviewUrl(null)}
        >
          <button
            onClick={() => setPreviewUrl(null)}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/20 text-white text-lg flex items-center justify-center hover:bg-white/30"
          >
            ×
          </button>
          <img
            src={previewUrl}
            alt="Preview"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Post-Execution Summary Section
// =============================================================================

function PostExecutionSummarySection({ task, workspaceId }: { task: Task; workspaceId: string }) {
  const [summary, setSummary] = useState<PostExecutionSummaryType | undefined>(
    task.frontmatter.postExecutionSummary
  )

  // Sync with task data when task changes
  useEffect(() => {
    setSummary(task.frontmatter.postExecutionSummary)
  }, [task.id, task.frontmatter.postExecutionSummary])

  if (summary) {
    return (
      <PostExecutionSummary
        key={task.id}
        summary={summary}
        workspaceId={workspaceId}
        taskId={task.id}
        onSummaryUpdated={setSummary}
      />
    )
  }

  return (
    <GenerateSummaryButton
      key={task.id}
      workspaceId={workspaceId}
      taskId={task.id}
      onGenerated={setSummary}
    />
  )
}

// =============================================================================
// Helpers
// =============================================================================

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.round((seconds % 3600) / 60)
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}
