import { useState, useEffect, useRef, useCallback } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, ExternalLink, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import type {
  Task,
  Phase,
  ModelConfig,
  PostExecutionSummary as PostExecutionSummaryType,
  TaskModelUsage,
} from '@task-factory/shared'
import { PHASES, PHASE_DISPLAY_NAMES, getPromotePhase, getDemotePhase } from '@task-factory/shared'
import { AppIcon } from './AppIcon'
import { MarkdownEditor } from './MarkdownEditor'
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
import type { PostExecutionSkill } from '../types/pi'
import { ModelSelector } from './ModelSelector'
import { ExecutionPipelineEditor } from './ExecutionPipelineEditor'
import { PostExecutionSummary, GenerateSummaryButton } from './PostExecutionSummary'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api'
import { isPreviewableImageMimeType } from '../attachment-preview'

const REMARK_PLUGINS = [remarkGfm]

interface TaskDetailPaneProps {
  task: Task
  workspaceId: string
  moveError: string | null
  isPlanGenerating?: boolean
  isAgentRunning?: boolean
  isAwaitingInput?: boolean
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
  isAgentRunning,
  isAwaitingInput,
  onDelete,
}: TaskDetailPaneProps) {
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editedTitle, setEditedTitle] = useState(task.frontmatter.title)
  const [editedContent, setEditedContent] = useState(task.content)
  const [editedCriteria, setEditedCriteria] = useState(
    formatAcceptanceCriteriaForEditor(task.frontmatter.acceptanceCriteria)
  )
  const [availableSkills, setAvailableSkills] = useState<PostExecutionSkill[]>([])
  const [selectedPrePlanningSkillIds, setSelectedPrePlanningSkillIds] = useState<string[]>(
    task.frontmatter.prePlanningSkills || []
  )
  const [selectedPreSkillIds, setSelectedPreSkillIds] = useState<string[]>(
    task.frontmatter.preExecutionSkills || []
  )
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(
    task.frontmatter.postExecutionSkills || []
  )
  const [editedPlanningModelConfig, setEditedPlanningModelConfig] = useState<ModelConfig | undefined>(
    task.frontmatter.planningModelConfig
      ?? task.frontmatter.executionModelConfig
      ?? task.frontmatter.modelConfig
  )
  const [editedExecutionModelConfig, setEditedExecutionModelConfig] = useState<ModelConfig | undefined>(
    task.frontmatter.executionModelConfig
      ?? task.frontmatter.modelConfig
  )
  const [editedSkillConfigs, setEditedSkillConfigs] = useState<Record<string, Record<string, string>>>(
    task.frontmatter.skillConfigs || {}
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const { frontmatter } = task

  // Determine which fields to highlight based on move error
  const noPlanMode = frontmatter.planningSkipped === true
  const missingAcceptanceCriteria =
    !noPlanMode &&
    moveError?.toLowerCase().includes('acceptance criteria') &&
    frontmatter.acceptanceCriteria.length === 0

  // Fetch available execution skills
  useEffect(() => {
    fetch('/api/factory/skills')
      .then(r => r.json())
      .then(setAvailableSkills)
      .catch(err => console.error('Failed to load execution skills:', err))
  }, [])

  // Reset edit state when task changes
  useEffect(() => {
    setIsEditing(false)
    setEditedTitle(task.frontmatter.title)
    setEditedContent(task.content)
    setEditedCriteria(formatAcceptanceCriteriaForEditor(task.frontmatter.acceptanceCriteria))
    setSelectedPrePlanningSkillIds(task.frontmatter.prePlanningSkills || [])
    setSelectedPreSkillIds(task.frontmatter.preExecutionSkills || [])
    setSelectedSkillIds(task.frontmatter.postExecutionSkills || [])
    setEditedPlanningModelConfig(
      task.frontmatter.planningModelConfig
        ?? task.frontmatter.executionModelConfig
        ?? task.frontmatter.modelConfig
    )
    setEditedExecutionModelConfig(
      task.frontmatter.executionModelConfig
        ?? task.frontmatter.modelConfig
    )
    setEditedSkillConfigs(task.frontmatter.skillConfigs || {})
  }, [task.id])



  const handleSaveEdit = async () => {
    try {
      const shouldSanitizeByKnownSkills = availableSkills.length > 0
      const knownSkillIds = new Set(availableSkills.map((skill) => skill.id))
      const sanitizedPrePlanningSkillIds = shouldSanitizeByKnownSkills
        ? selectedPrePlanningSkillIds.filter((skillId) => knownSkillIds.has(skillId))
        : [...selectedPrePlanningSkillIds]
      const sanitizedPreSkillIds = shouldSanitizeByKnownSkills
        ? selectedPreSkillIds.filter((skillId) => knownSkillIds.has(skillId))
        : [...selectedPreSkillIds]
      const sanitizedPostSkillIds = shouldSanitizeByKnownSkills
        ? selectedSkillIds.filter((skillId) => knownSkillIds.has(skillId))
        : [...selectedSkillIds]

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
          prePlanningSkills: sanitizedPrePlanningSkillIds,
          preExecutionSkills: sanitizedPreSkillIds,
          postExecutionSkills: sanitizedPostSkillIds,
          skillConfigs: Object.keys(editedSkillConfigs).length > 0 ? editedSkillConfigs : undefined,
          planningModelConfig: editedPlanningModelConfig,
          executionModelConfig: editedExecutionModelConfig,
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
          {isAwaitingInput && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Needs input
            </span>
          )}
          {isAgentRunning && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 text-orange-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
              Running
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Demote button */}
          {(() => {
            const demoteTo = getDemotePhase(frontmatter.phase);
            return (
              <button
                onClick={() => demoteTo && onMove(demoteTo)}
                disabled={!demoteTo}
                className="btn text-xs py-1 px-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
              >
                <AppIcon icon={ArrowLeft} size="xs" />
                {demoteTo ? PHASE_DISPLAY_NAMES[demoteTo] : 'None'}
              </button>
            );
          })()}
          <div className="relative">
            <button
              onClick={() => setShowMoveMenu(!showMoveMenu)}
              className="btn btn-secondary text-xs py-1 px-2.5 inline-flex items-center gap-1"
            >
              Move
              <AppIcon icon={ChevronDown} size="xs" />
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
          {/* Promote button */}
          {(() => {
            const promoteTo = getPromotePhase(frontmatter.phase);
            return (
              <button
                onClick={() => promoteTo && onMove(promoteTo)}
                disabled={!promoteTo}
                className="btn text-xs py-1 px-2.5 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
              >
                {promoteTo ? PHASE_DISPLAY_NAMES[promoteTo] : 'None'}
                <AppIcon icon={ArrowRight} size="xs" />
              </button>
            );
          })()}
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
          editedPlanningModelConfig={editedPlanningModelConfig}
          setEditedPlanningModelConfig={setEditedPlanningModelConfig}
          editedExecutionModelConfig={editedExecutionModelConfig}
          setEditedExecutionModelConfig={setEditedExecutionModelConfig}
          selectedPrePlanningSkillIds={selectedPrePlanningSkillIds}
          setSelectedPrePlanningSkillIds={setSelectedPrePlanningSkillIds}
          selectedPreSkillIds={selectedPreSkillIds}
          setSelectedPreSkillIds={setSelectedPreSkillIds}
          selectedSkillIds={selectedSkillIds}
          setSelectedSkillIds={setSelectedSkillIds}
          editedSkillConfigs={editedSkillConfigs}
          setEditedSkillConfigs={setEditedSkillConfigs}
          availableSkills={availableSkills}
          missingAcceptanceCriteria={missingAcceptanceCriteria}
          noPlanMode={noPlanMode}
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

function DetailsContent({ task, workspaceId, frontmatter, isEditing, setIsEditing, editedTitle, setEditedTitle, editedContent, setEditedContent, editedCriteria, setEditedCriteria, editedPlanningModelConfig, setEditedPlanningModelConfig, editedExecutionModelConfig, setEditedExecutionModelConfig, selectedPrePlanningSkillIds, setSelectedPrePlanningSkillIds, selectedPreSkillIds, setSelectedPreSkillIds, selectedSkillIds, setSelectedSkillIds, editedSkillConfigs, setEditedSkillConfigs, availableSkills, missingAcceptanceCriteria, noPlanMode, isPlanGenerating, onSaveEdit, onDelete }: any) {
  const isCompleted = frontmatter.phase === 'complete' || frontmatter.phase === 'archived'
  const hasSummary = Boolean(task.frontmatter.postExecutionSummary)
  const normalizedFrontmatterCriteria = normalizeAcceptanceCriteria(frontmatter.acceptanceCriteria)
  const frontmatterCriteriaSignature = JSON.stringify(normalizedFrontmatterCriteria)
  const [criteriaDraftItems, setCriteriaDraftItems] = useState<string[]>(() => normalizedFrontmatterCriteria)
  const displayAcceptanceCriteria = isEditing ? normalizedFrontmatterCriteria : criteriaDraftItems
  const [isCriteriaEditing, setIsCriteriaEditing] = useState(false)
  const [isSavingCriteria, setIsSavingCriteria] = useState(false)
  const [criteriaEditError, setCriteriaEditError] = useState<string | null>(null)
  const [isRegeneratingPlan, setIsRegeneratingPlan] = useState(false)
  const [planRegenerationError, setPlanRegenerationError] = useState<string | null>(null)
  const [isRegeneratingCriteria, setIsRegeneratingCriteria] = useState(false)
  const [criteriaRegenerationError, setCriteriaRegenerationError] = useState<string | null>(null)
  const [isGeneratedSectionExpanded, setIsGeneratedSectionExpanded] = useState(() => !hasSummary)
  const [isPlanExpanded, setIsPlanExpanded] = useState(() => !hasSummary)
  const hadSummaryRef = useRef(hasSummary)

  useEffect(() => {
    const nextHasSummary = Boolean(task.frontmatter.postExecutionSummary)
    hadSummaryRef.current = nextHasSummary
    setIsGeneratedSectionExpanded(!nextHasSummary)
    setIsPlanExpanded(!nextHasSummary)
  }, [task.id])

  useEffect(() => {
    if (hadSummaryRef.current !== hasSummary) {
      setIsGeneratedSectionExpanded(!hasSummary)
      setIsPlanExpanded(!hasSummary)
      hadSummaryRef.current = hasSummary
    }
  }, [hasSummary])

  useEffect(() => {
    setPlanRegenerationError(null)
    setIsRegeneratingPlan(false)
    setCriteriaRegenerationError(null)
    setIsRegeneratingCriteria(false)
  }, [task.id, frontmatter.plan?.generatedAt, frontmatter.planningStatus, frontmatterCriteriaSignature])

  useEffect(() => {
    setCriteriaDraftItems(normalizedFrontmatterCriteria)
    setIsCriteriaEditing(false)
    setCriteriaEditError(null)
    setIsSavingCriteria(false)
  }, [task.id, frontmatterCriteriaSignature])

  useEffect(() => {
    if (!isEditing) return
    setIsCriteriaEditing(false)
    setCriteriaEditError(null)
  }, [isEditing])

  const handleStartCriteriaEdit = () => {
    setCriteriaRegenerationError(null)
    setCriteriaEditError(null)
    setCriteriaDraftItems(normalizedFrontmatterCriteria)
    setIsCriteriaEditing(true)
  }

  const handleCriteriaItemChange = (index: number, value: string) => {
    setCriteriaDraftItems((previous) => previous.map((item, itemIndex) => (
      itemIndex === index ? value : item
    )))
  }

  const handleAddCriteriaItem = () => {
    setCriteriaDraftItems((previous) => [...previous, ''])
  }

  const handleDeleteCriteriaItem = (index: number) => {
    setCriteriaDraftItems((previous) => previous.filter((_, itemIndex) => itemIndex !== index))
  }

  const handleCancelCriteriaEdit = () => {
    setCriteriaDraftItems(normalizedFrontmatterCriteria)
    setCriteriaEditError(null)
    setIsCriteriaEditing(false)
  }

  const handleSaveCriteriaEdit = async () => {
    setCriteriaEditError(null)
    setIsSavingCriteria(true)

    const sanitizedCriteria = normalizeCriteriaDraftItems(criteriaDraftItems)

    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acceptanceCriteria: sanitizedCriteria }),
      })

      if (!response.ok) {
        throw new Error(await parseResponseError(response, 'Failed to save acceptance criteria'))
      }

      const updatedTask = await response.json().catch(() => null)
      const updatedCriteria = normalizeAcceptanceCriteria(
        updatedTask?.frontmatter?.acceptanceCriteria ?? sanitizedCriteria,
      )

      setCriteriaDraftItems(updatedCriteria)
      setEditedCriteria(formatAcceptanceCriteriaForEditor(updatedCriteria))
      setIsCriteriaEditing(false)
    } catch (err) {
      setCriteriaEditError(err instanceof Error ? err.message : 'Failed to save acceptance criteria')
    } finally {
      setIsSavingCriteria(false)
    }
  }

  const handleRegeneratePlan = async () => {
    setPlanRegenerationError(null)
    setIsRegeneratingPlan(true)

    try {
      await api.regenerateTaskPlan(workspaceId, task.id)
    } catch (err) {
      setPlanRegenerationError(err instanceof Error ? err.message : 'Failed to regenerate plan')
    } finally {
      setIsRegeneratingPlan(false)
    }
  }

  const handleRegenerateAcceptanceCriteria = async () => {
    setCriteriaRegenerationError(null)
    setIsRegeneratingCriteria(true)

    try {
      const criteria = await api.regenerateAcceptanceCriteria(workspaceId, task.id)
      if (criteria.length === 0) {
        setCriteriaRegenerationError('No acceptance criteria were generated. Try again after adding more task context.')
      }
    } catch (err) {
      setCriteriaRegenerationError(err instanceof Error ? err.message : 'Failed to regenerate acceptance criteria')
    } finally {
      setIsRegeneratingCriteria(false)
    }
  }

  const handleSummaryGenerated = () => {
    hadSummaryRef.current = true
    setIsGeneratedSectionExpanded(false)
    setIsPlanExpanded(false)
  }

  const collapsedGoalPreview = frontmatter.plan
    ? summarizePlanGoal(frontmatter.plan.goal)
    : ''

  return (
    <div className="p-5 space-y-5">
      {/* Title */}
      <div>
        {isEditing ? (
          <div className="flex items-start justify-between gap-4">
            <input
              type="text"
              value={editedTitle}
              onChange={(e: any) => setEditedTitle(e.target.value)}
              className="text-xl font-bold text-slate-900 w-full bg-transparent border-b-2 border-blue-400 outline-none pb-1 min-w-0"
            />
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={onSaveEdit} className="btn btn-primary text-xs py-1.5 px-3">Save Changes</button>
              <button onClick={() => { setIsEditing(false); setEditedTitle(task.frontmatter.title); setEditedContent(task.content); setEditedCriteria(formatAcceptanceCriteriaForEditor(task.frontmatter.acceptanceCriteria)); setSelectedPrePlanningSkillIds(task.frontmatter.prePlanningSkills || []); setSelectedPreSkillIds(task.frontmatter.preExecutionSkills || []); setSelectedSkillIds(task.frontmatter.postExecutionSkills || []); setEditedSkillConfigs(task.frontmatter.skillConfigs || {}); setEditedPlanningModelConfig(task.frontmatter.planningModelConfig ?? task.frontmatter.executionModelConfig ?? task.frontmatter.modelConfig); setEditedExecutionModelConfig(task.frontmatter.executionModelConfig ?? task.frontmatter.modelConfig) }} className="btn btn-secondary text-xs py-1.5 px-3">Discard</button>
            </div>
          </div>
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
      {(isEditing || frontmatter.planningModelConfig || frontmatter.executionModelConfig || frontmatter.modelConfig) && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Models</h3>
          {isEditing ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Planning Model</label>
                <ModelSelector value={editedPlanningModelConfig} onChange={setEditedPlanningModelConfig} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Execution Model</label>
                <ModelSelector value={editedExecutionModelConfig} onChange={setEditedExecutionModelConfig} />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <ModelBadgeRow
                label="Planning"
                model={frontmatter.planningModelConfig ?? frontmatter.executionModelConfig ?? frontmatter.modelConfig}
              />
              <ModelBadgeRow
                label="Execution"
                model={frontmatter.executionModelConfig ?? frontmatter.modelConfig}
              />
            </div>
          )}
        </div>
      )}

      {/* Planning + Execution Pipelines (editing) */}
      {isEditing && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Planning + Execution Pipelines</h3>
          <p className="text-xs text-slate-400 mb-2">Add skills, then drag cards to pre-planning, pre-execution, and post-execution lanes.</p>
          <ExecutionPipelineEditor
            availableSkills={availableSkills}
            selectedPrePlanningSkillIds={selectedPrePlanningSkillIds}
            selectedPreSkillIds={selectedPreSkillIds}
            selectedSkillIds={selectedSkillIds}
            onPrePlanningSkillsChange={setSelectedPrePlanningSkillIds}
            onPreSkillsChange={setSelectedPreSkillIds}
            onPostSkillsChange={setSelectedSkillIds}
            skillConfigs={editedSkillConfigs}
            onSkillConfigChange={setEditedSkillConfigs}
          />
        </div>
      )}

      {/* Pre-Planning Skills */}
      {!isEditing && (frontmatter.prePlanningSkills || []).length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Pre-Planning Skills</h3>
          <div className="flex flex-wrap gap-1.5">
            {(frontmatter.prePlanningSkills || []).map((skillId: string, index: number) => {
              const skill = availableSkills.find((s: any) => s.id === skillId)
              return (
                <span key={skillId} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-violet-50 border border-violet-200 text-xs font-medium text-violet-700">
                  <span className="text-[10px] text-violet-400 font-bold">{index + 1}.</span>
                  <span className="text-[10px] text-slate-400 font-mono">{skill?.type === 'loop' ? 'loop' : skill?.type === 'subagent' ? 'subagent' : 'gate'}</span>
                  {skill?.name || skillId}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Pre-Execution Skills */}
      {!isEditing && (frontmatter.preExecutionSkills || []).length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Pre-Execution Skills</h3>
          <div className="flex flex-wrap gap-1.5">
            {(frontmatter.preExecutionSkills || []).map((skillId: string, index: number) => {
              const skill = availableSkills.find((s: any) => s.id === skillId)
              return (
                <span key={skillId} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 border border-blue-200 text-xs font-medium text-blue-700">
                  <span className="text-[10px] text-blue-400 font-bold">{index + 1}.</span>
                  <span className="text-[10px] text-slate-400 font-mono">{skill?.type === 'loop' ? 'loop' : skill?.type === 'subagent' ? 'subagent' : 'gate'}</span>
                  {skill?.name || skillId}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Post-Execution Skills */}
      {!isEditing && (frontmatter.postExecutionSkills || []).length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Post-Execution Skills</h3>
          <div className="flex flex-wrap gap-1.5">
            {(frontmatter.postExecutionSkills || []).map((skillId: string, index: number) => {
              const skill = availableSkills.find((s: any) => s.id === skillId)
              return (
                <span key={skillId} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-orange-50 border border-orange-200 text-xs font-medium text-orange-700">
                  <span className="text-[10px] text-orange-400 font-bold">{index + 1}.</span>
                  <span className="text-[10px] text-slate-400 font-mono">{skill?.type === 'loop' ? 'loop' : skill?.type === 'subagent' ? 'subagent' : 'gate'}</span>
                  {skill?.name || skillId}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Section 1: Original description + attachments */}
      <section className="rounded-xl border border-slate-200 bg-slate-50/40 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 bg-white/70">
          <h2 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">1. Original Description & Attachments</h2>
        </div>
        <div className="p-4 space-y-5">
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

          <AttachmentsSection task={task} workspaceId={workspaceId} isEditing={isEditing} />
        </div>
      </section>

      {/* Section 2: Generated plan + acceptance criteria */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">2. Generated Plan & Acceptance Criteria</h2>
            <button
              type="button"
              onClick={() => setIsGeneratedSectionExpanded((prev) => !prev)}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
              aria-expanded={isGeneratedSectionExpanded}
            >
              <AppIcon icon={isGeneratedSectionExpanded ? ChevronDown : ChevronRight} size="xs" />
              {isGeneratedSectionExpanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>
        {isGeneratedSectionExpanded && (
          <div className="p-4 space-y-5">
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
          {!frontmatter.plan && frontmatter.planningStatus === 'error' && !isPlanGenerating && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
              <div>
                <h3 className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Plan not available</h3>
                <p className="text-xs text-amber-700/80 mt-1">Plan generation failed. Regenerate to try again.</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleRegeneratePlan}
                  disabled={isRegeneratingPlan}
                  className="btn text-xs py-1.5 px-3 bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                >
                  {isRegeneratingPlan ? (
                    'Regenerating…'
                  ) : (
                    <>
                      <AppIcon icon={RotateCcw} size="xs" />
                      Regenerate Plan
                    </>
                  )}
                </button>
                {planRegenerationError && (
                  <span className="text-xs text-red-600">{planRegenerationError}</span>
                )}
              </div>
            </div>
          )}
          {!frontmatter.plan && !isPlanGenerating && frontmatter.planningStatus !== 'error' && (
            <div className="bg-white border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-slate-500">No generated plan yet.</p>
            </div>
          )}
          {frontmatter.plan && (
            <>
              <div className="py-1 flex items-center gap-2">
                <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Plan Document</h3>
                <span className="text-[10px] text-slate-500 ml-auto">Generated {new Date(frontmatter.plan.generatedAt).toLocaleString()}</span>
                <button
                  type="button"
                  onClick={() => setIsPlanExpanded((prev) => !prev)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                  aria-expanded={isPlanExpanded}
                >
                  <AppIcon icon={isPlanExpanded ? ChevronDown : ChevronRight} size="xs" />
                  {isPlanExpanded ? 'Collapse' : 'Expand'}
                </button>
              </div>

              {!isPlanExpanded && (
                <div className="pb-1 text-sm text-slate-700">
                  <span className="font-semibold text-slate-600 mr-1">Goal:</span>
                  <span>{collapsedGoalPreview || 'Plan details hidden to reduce visual noise.'}</span>
                </div>
              )}

              {isPlanExpanded && (
                <VisualPlanPanel plan={frontmatter.plan} />
              )}
            </>
          )}

          <div className={missingAcceptanceCriteria ? 'rounded-lg border-2 border-red-300 bg-red-50 p-3 -mx-1 mt-4' : 'pt-4 mt-4 border-t border-slate-200/80'}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className={`text-xs font-semibold uppercase tracking-wide ${missingAcceptanceCriteria ? 'text-red-600' : 'text-slate-500'}`}>
                  {missingAcceptanceCriteria && <span className="mr-1 text-red-500">!</span>}Acceptance Criteria
                </h3>
                <p className="mt-1 text-xs text-slate-500">If implementation is correct, these checks should all pass.</p>
              </div>
              {!isEditing && (
                <div className="flex flex-wrap items-center gap-2">
                  {isCriteriaEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={handleAddCriteriaItem}
                        disabled={isSavingCriteria}
                        className="btn text-xs py-1 px-2.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <AppIcon icon={Plus} size="xs" />
                        Add Item
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelCriteriaEdit}
                        disabled={isSavingCriteria}
                        className="btn text-xs py-1 px-2.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSaveCriteriaEdit()}
                        disabled={isSavingCriteria}
                        className="btn text-xs py-1 px-2.5 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSavingCriteria ? 'Saving…' : 'Save Criteria'}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={handleStartCriteriaEdit}
                        className="btn text-xs py-1 px-2.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                      >
                        Edit Criteria
                      </button>
                      <button
                        type="button"
                        onClick={handleRegenerateAcceptanceCriteria}
                        disabled={isRegeneratingCriteria}
                        className="btn text-xs py-1 px-2.5 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                      >
                        {isRegeneratingCriteria ? (
                          'Regenerating…'
                        ) : (
                          <>
                            <AppIcon icon={RotateCcw} size="xs" />
                            Regenerate Criteria
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            {criteriaRegenerationError && !isEditing && !isCriteriaEditing && (
              <p className="text-xs text-red-600 mb-2">{criteriaRegenerationError}</p>
            )}
            {criteriaEditError && !isEditing && isCriteriaEditing && (
              <p className="text-xs text-red-600 mb-2">{criteriaEditError}</p>
            )}
            {isEditing ? (
              <MarkdownEditor value={editedCriteria} onChange={setEditedCriteria} placeholder="One criterion per line" minHeight="160px" />
            ) : isCriteriaEditing ? (
              <div className="space-y-2">
                {criteriaDraftItems.length === 0 && (
                  <p className="text-sm italic text-slate-400">No criteria yet. Add an item to get started.</p>
                )}
                {criteriaDraftItems.map((criteria: string, i: number) => (
                  <div key={`criteria-edit-${i}`} className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded border border-slate-300 flex items-center justify-center text-[10px] text-slate-400 shrink-0 mt-2">{i + 1}</span>
                    <textarea
                      value={criteria}
                      onChange={(event) => handleCriteriaItemChange(i, event.target.value)}
                      rows={2}
                      disabled={isSavingCriteria}
                      className="flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
                      placeholder={`Criterion ${i + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => handleDeleteCriteriaItem(i)}
                      disabled={isSavingCriteria}
                      className="mt-1 inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                      title={`Delete criterion ${i + 1}`}
                      aria-label={`Delete criterion ${i + 1}`}
                    >
                      <AppIcon icon={Trash2} size="xs" />
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            ) : displayAcceptanceCriteria.length > 0 ? (
              <ul className="space-y-1.5">
                {displayAcceptanceCriteria.map((criteria: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="w-5 h-5 rounded border border-slate-300 flex items-center justify-center text-[10px] text-slate-400 shrink-0 mt-0.5">{i + 1}</span>
                    <div className="prose prose-slate prose-sm max-w-none min-w-0 text-slate-700 [&>p]:m-0"><ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{criteria}</ReactMarkdown></div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={`text-sm italic ${missingAcceptanceCriteria ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                {noPlanMode ? 'Acceptance criteria skipped (no-plan mode)' : 'No acceptance criteria defined'}
              </p>
            )}
          </div>
          </div>
        )}
      </section>

      {/* Section 3: Summary + diffs + verified criteria */}
      <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-emerald-200 bg-emerald-50/70">
          <h2 className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">3. Summary, Diffs & Verified Criteria</h2>
        </div>
        <div className="p-4">
          {(isCompleted || hasSummary) ? (
            <PostExecutionSummarySection
              task={task}
              workspaceId={workspaceId}
              onSummaryGenerated={handleSummaryGenerated}
            />
          ) : (
            <p className="text-sm text-slate-500">
              No execution summary yet. Summary, file diffs, and verified acceptance criteria appear here after task completion.
            </p>
          )}
        </div>
      </section>

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
        {(() => {
          const usageMetrics = frontmatter.usageMetrics
          if (!usageMetrics) return null

          const usageTotals = usageMetrics.totals
          const hasUsageMetrics =
            usageTotals.totalTokens > 0
            || usageTotals.cost > 0
            || usageMetrics.byModel.length > 0

          if (!hasUsageMetrics) return null

          return (
            <>
              <div className="flex justify-between">
                <span>Total Tokens</span>
                <span className="font-mono">{formatTokenCount(usageTotals.totalTokens)}</span>
              </div>
              <div className="flex justify-between">
                <span>Input / Output</span>
                <span className="font-mono">{formatTokenCount(usageTotals.inputTokens)} / {formatTokenCount(usageTotals.outputTokens)}</span>
              </div>
              {(usageTotals.cacheReadTokens > 0 || usageTotals.cacheWriteTokens > 0) && (
                <div className="flex justify-between">
                  <span>Cache Read / Write</span>
                  <span className="font-mono">{formatTokenCount(usageTotals.cacheReadTokens)} / {formatTokenCount(usageTotals.cacheWriteTokens)}</span>
                </div>
              )}
              {usageTotals.cost > 0 && (
                <div className="flex justify-between">
                  <span>Usage Cost</span>
                  <span className="font-mono">${formatUsageCost(usageTotals.cost)}</span>
                </div>
              )}
              {usageMetrics.byModel.length > 0 && (
                <div className="flex justify-between gap-3">
                  <span>Models Used</span>
                  <span className="text-right break-all">{formatModelUsageList(usageMetrics.byModel)}</span>
                </div>
              )}
            </>
          )
        })()}
        {frontmatter.branch && <div className="flex justify-between"><span>Branch</span><span className="font-mono">{frontmatter.branch}</span></div>}
        {frontmatter.prUrl && (
          <div className="flex justify-between">
            <span>PR</span>
            <a
              href={frontmatter.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline inline-flex items-center gap-1"
            >
              View PR
              <AppIcon icon={ExternalLink} size="xs" />
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

function ModelBadgeRow({ label, model }: { label: string; model?: ModelConfig }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="inline-flex items-center px-2 py-1 rounded-md bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
        {label}
      </span>
      {model ? (
        <>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 border border-blue-200 text-xs font-medium text-blue-700">
            <span className="text-blue-400">{model.provider}</span>
            <span className="text-blue-300">/</span>
            {model.modelId}
          </span>
          {model.thinkingLevel && (
            <span className="inline-flex items-center px-2 py-1 rounded-md bg-purple-50 border border-purple-200 text-xs font-medium text-purple-700">
              reasoning: {model.thinkingLevel}
            </span>
          )}
        </>
      ) : (
        <span className="text-xs text-slate-400">Default (from settings)</span>
      )}
    </div>
  )
}

// =============================================================================
// Attachments Section
// =============================================================================

function isImageMime(mimeType: string): boolean {
  return isPreviewableImageMimeType(mimeType)
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const TASK_DETAIL_WHITEBOARD_STORAGE_KEY_PREFIX = 'task-factory:task-detail-whiteboard'

function getTaskDetailWhiteboardStorageKey(workspaceId: string, taskId: string): string | null {
  if (!workspaceId || !taskId) return null
  return `${TASK_DETAIL_WHITEBOARD_STORAGE_KEY_PREFIX}:${workspaceId}:${taskId}`
}

export function AttachmentsSection({ task, workspaceId, isEditing }: { task: Task; workspaceId: string; isEditing: boolean }) {
  const [isUploading, setIsUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isWhiteboardModalOpen, setIsWhiteboardModalOpen] = useState(false)
  const [isAttachingWhiteboard, setIsAttachingWhiteboard] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const whiteboardStorageKey = getTaskDetailWhiteboardStorageKey(workspaceId, task.id)
  const [initialWhiteboardScene, setInitialWhiteboardScene] = useState<WhiteboardSceneSnapshot | null>(() => {
    if (!whiteboardStorageKey) return null
    const loaded = loadStoredWhiteboardScene(whiteboardStorageKey)
    return hasWhiteboardContent(loaded) ? loaded : null
  })
  const whiteboardSceneRef = useRef<WhiteboardSceneSnapshot | null>(initialWhiteboardScene)
  const attachments = task.frontmatter.attachments || []

  useEffect(() => {
    if (isEditing) return
    setIsDragOver(false)
    setIsWhiteboardModalOpen(false)
  }, [isEditing])

  useEffect(() => {
    setIsWhiteboardModalOpen(false)
    setIsAttachingWhiteboard(false)

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
    if (!isEditing || !isWhiteboardModalOpen) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setIsWhiteboardModalOpen(false)
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [isEditing, isWhiteboardModalOpen])

  const handleUpload = useCallback(async (files: FileList | File[]) => {
    if (!isEditing) return

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
  }, [workspaceId, task.id, isEditing])

  const handleWhiteboardSceneChange = useCallback((scene: WhiteboardSceneSnapshot) => {
    whiteboardSceneRef.current = scene
    if (whiteboardStorageKey) {
      persistWhiteboardScene(whiteboardStorageKey, scene)
    }
  }, [whiteboardStorageKey])

  const attachWhiteboard = useCallback(async () => {
    if (!isEditing) return

    const scene = whiteboardSceneRef.current
    if (!scene || !hasWhiteboardContent(scene)) return
    setIsAttachingWhiteboard(true)
    try {
      const file = await exportWhiteboardPngFile(scene, createWhiteboardAttachmentFilename())
      await api.uploadAttachments(workspaceId, task.id, [file])
      whiteboardSceneRef.current = null
      setInitialWhiteboardScene(null)
      if (whiteboardStorageKey) {
        clearStoredWhiteboardScene(whiteboardStorageKey)
      }
      setIsWhiteboardModalOpen(false)
    } catch (err) {
      console.error('Failed to attach whiteboard sketch:', err)
    } finally {
      setIsAttachingWhiteboard(false)
    }
  }, [workspaceId, task.id, isEditing, whiteboardStorageKey])

  const handleDelete = async (attachmentId: string) => {
    if (!isEditing) return
    if (!confirm('Delete this attachment?')) return

    try {
      await api.deleteAttachment(workspaceId, task.id, attachmentId)
    } catch (err) {
      console.error('Failed to delete attachment:', err)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (!isEditing) return
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (!isEditing) return
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    if (!isEditing) return
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      void handleUpload(e.dataTransfer.files)
    }
  }

  if (!isEditing && attachments.length === 0) {
    return null
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
        {isEditing && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setInitialWhiteboardScene(whiteboardSceneRef.current); setIsWhiteboardModalOpen(true) }}
              className="text-xs text-violet-600 hover:text-violet-800 font-medium"
            >
              + Add Excalidraw
            </button>
            <button
              type="button"
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
                if (e.target.files) {
                  void handleUpload(e.target.files)
                }
                e.target.value = ''
              }}
            />
          </div>
        )}
      </div>

      {/* Drop zone (shown when no attachments or dragging) */}
      {isEditing && (attachments.length === 0 || isDragOver) && (
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
          onDragOver={isEditing ? handleDragOver : undefined}
          onDragLeave={isEditing ? handleDragLeave : undefined}
          onDrop={isEditing ? handleDrop : undefined}
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

                {isEditing && (
                  <button
                    onClick={() => handleDelete(att.id)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                    title="Delete attachment"
                    aria-label="Delete attachment"
                  >
                    <AppIcon icon={X} size="xs" />
                  </button>
                )}
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
            aria-label="Close preview"
            title="Close preview"
          >
            <AppIcon icon={X} size="md" />
          </button>
          <img
            src={previewUrl}
            alt="Preview"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Excalidraw modal */}
      {isEditing && isWhiteboardModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setIsWhiteboardModalOpen(false)}
        >
          <div
            className="w-full max-w-6xl max-h-[92vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-700">Draw a sketch</h3>
              <button
                type="button"
                onClick={() => setIsWhiteboardModalOpen(false)}
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
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                onClick={() => setIsWhiteboardModalOpen(false)}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void attachWhiteboard()}
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

// =============================================================================
// Post-Execution Summary Section
// =============================================================================

function PostExecutionSummarySection({
  task,
  workspaceId,
  onSummaryGenerated,
}: {
  task: Task
  workspaceId: string
  onSummaryGenerated?: () => void
}) {
  const [summary, setSummary] = useState<PostExecutionSummaryType | undefined>(
    task.frontmatter.postExecutionSummary
  )
  const activeTaskIdRef = useRef(task.id)

  // Sync with task data when task changes
  useEffect(() => {
    activeTaskIdRef.current = task.id
    setSummary(task.frontmatter.postExecutionSummary)
  }, [task.id, task.frontmatter.postExecutionSummary])

  const applySummaryUpdate = (
    targetTaskId: string,
    nextSummary: PostExecutionSummaryType,
    collapsePlan: boolean,
  ) => {
    if (activeTaskIdRef.current !== targetTaskId) {
      return
    }

    setSummary(nextSummary)

    if (collapsePlan) {
      onSummaryGenerated?.()
    }
  }

  if (summary) {
    return (
      <PostExecutionSummary
        key={task.id}
        summary={summary}
        workspaceId={workspaceId}
        taskId={task.id}
        onSummaryUpdated={(updatedSummary) => {
          applySummaryUpdate(task.id, updatedSummary, false)
        }}
      />
    )
  }

  return (
    <GenerateSummaryButton
      key={task.id}
      workspaceId={workspaceId}
      taskId={task.id}
      onGenerated={(generatedSummary) => {
        applySummaryUpdate(task.id, generatedSummary, true)
      }}
    />
  )
}

// =============================================================================
// Helpers
// =============================================================================

type VisualPlanSection = {
  component: string
  [key: string]: unknown
}

type TaskPlanWithVisual = {
  goal: string
  steps: string[]
  validation: string[]
  cleanup: string[]
  generatedAt: string
  visualPlan?: {
    version?: string
    planType?: string
    sections?: VisualPlanSection[]
    generatedAt?: string
  }
}

function isLikelyMermaidDiagram(code: string): boolean {
  const normalized = code.trim().toLowerCase()
  if (!normalized) return false
  if (normalized.includes('<script') || normalized.includes('<iframe') || normalized.includes('</')) {
    return false
  }

  return (
    normalized.startsWith('graph ')
    || normalized.startsWith('flowchart ')
    || normalized.startsWith('sequencediagram')
    || normalized.startsWith('classdiagram')
    || normalized.startsWith('statediagram')
    || normalized.startsWith('erdiagram')
    || normalized.startsWith('journey')
    || normalized.startsWith('gantt')
    || normalized.startsWith('pie')
    || normalized.startsWith('mindmap')
    || normalized.startsWith('timeline')
    || normalized.startsWith('quadrantchart')
  )
}

function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function safeArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function MermaidDiagramPanel({ title, code }: { title: string; code: string }) {
  const startsInvalid = !isLikelyMermaidDiagram(code)
  const [svg, setSvg] = useState<string | null>(null)
  const [renderError, setRenderError] = useState<string | null>(startsInvalid ? 'invalid' : null)

  useEffect(() => {
    setSvg(null)
    setRenderError(null)

    if (!isLikelyMermaidDiagram(code)) {
      setRenderError('invalid')
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const mermaidModule = await import('mermaid')
        const mermaid = mermaidModule.default
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' })

        const diagramId = `mermaid-${Math.random().toString(36).slice(2, 10)}`
        const result = await mermaid.render(diagramId, code)

        if (!cancelled) {
          setSvg(result.svg)
        }
      } catch {
        if (!cancelled) {
          setRenderError('render-failed')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [code])

  if (renderError === 'invalid') {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
        Invalid Mermaid diagram payload. Showing raw text fallback.
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-white p-2 text-[11px] text-slate-700">{code || '(empty)'}</pre>
      </div>
    )
  }

  return (
    <figure className="space-y-2">
      <figcaption className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</figcaption>
      {svg ? (
        <div
          className="overflow-x-auto [&>svg]:h-auto [&>svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="rounded bg-slate-50 p-2 text-xs text-slate-500 border border-slate-200">
          {renderError === 'render-failed' ? 'Mermaid render failed. Showing source:' : 'Rendering Mermaid diagram...'}
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-white p-2 text-[11px] text-slate-700">{code}</pre>
        </div>
      )}
    </figure>
  )
}

function hasVisualPlanContent(section: VisualPlanSection): boolean {
  switch (section.component) {
    case 'SummaryHero':
      return Boolean(safeString((section as any).problem) || safeString((section as any).insight) || safeString((section as any).outcome))
    case 'ImpactStats':
      return safeArray((section as any).stats).length > 0
    case 'ArchitectureDiff':
      return Boolean(safeString((section as any)?.current?.code) || safeString((section as any)?.planned?.code))
    case 'ChangeList':
    case 'Risks':
    case 'OpenQuestions':
    case 'NextSteps':
    case 'FutureWork':
      return safeArray((section as any).items).length > 0
    case 'ValidationPlan':
      return safeArray((section as any).checks).length > 0
    case 'DecisionLog':
      return safeArray((section as any).entries).length > 0
    default:
      return true
  }
}

export function VisualPlanPanel({ plan }: { plan: TaskPlanWithVisual }) {
  const sections = (plan.visualPlan?.sections || []).filter((section) => hasVisualPlanContent(section))

  const summary = sections.find((section) => section.component === 'SummaryHero') as any
  const architectureSections = sections.filter((section) => section.component === 'ArchitectureDiff') as any[]
  const impactSections = sections.filter((section) => section.component === 'ImpactStats') as any[]
  const changeSections = sections.filter((section) => section.component === 'ChangeList') as any[]
  const riskSections = sections.filter((section) => section.component === 'Risks') as any[]
  const decisionSections = sections.filter((section) => section.component === 'DecisionLog') as any[]
  const openQuestionSections = sections.filter((section) => section.component === 'OpenQuestions') as any[]
  const validationSections = sections.filter((section) => section.component === 'ValidationPlan') as any[]
  const unknownSections = sections.filter((section) => section.component === 'Unknown') as any[]
  const nextSections = sections.filter((section) => section.component === 'NextSteps' || section.component === 'FutureWork') as any[]

  const mediumLevelBullets: string[] = []
  for (const section of impactSections) {
    const stats = safeArray<any>(section.stats)
    for (const stat of stats) {
      const label = safeString(stat?.label, 'Metric')
      const value = safeString(stat?.value)
      const detail = safeString(stat?.detail)
      if (value || detail) {
        mediumLevelBullets.push(`${label}: ${value}${detail ? ` — ${detail}` : ''}`)
      }
    }
  }
  for (const section of changeSections) {
    const items = safeArray<any>(section.items)
    for (const item of items) {
      const area = safeString(item?.area)
      const change = safeString(item?.change)
      const rationale = safeString(item?.rationale)
      if (change) {
        mediumLevelBullets.push(`${area ? `${area}: ` : ''}${change}${rationale ? ` (${rationale})` : ''}`)
      }
    }
  }
  for (const section of decisionSections) {
    const entries = safeArray<any>(section.entries)
    for (const entry of entries) {
      const decision = safeString(entry?.decision)
      const rationale = safeString(entry?.rationale)
      if (decision) {
        mediumLevelBullets.push(`Decision: ${decision}${rationale ? ` — Trade-off: ${rationale}` : ''}`)
      }
    }
  }
  for (const section of riskSections) {
    const items = safeArray<any>(section.items)
    for (const item of items) {
      const risk = safeString(item?.risk)
      const mitigation = safeString(item?.mitigation)
      if (risk) {
        mediumLevelBullets.push(`Risk: ${risk}${mitigation ? ` → Mitigation: ${mitigation}` : ''}`)
      }
    }
  }
  for (const section of openQuestionSections) {
    const items = safeArray<any>(section.items)
    for (const item of items) {
      const question = safeString(item?.question)
      if (question) mediumLevelBullets.push(`Open question: ${question}`)
    }
  }
  for (const section of validationSections) {
    const checks = safeArray<string>(section.checks)
    for (const check of checks) {
      const text = safeString(check)
      if (text) mediumLevelBullets.push(`Validation check: ${text}`)
    }
  }

  const implementationBullets: string[] = []
  for (const section of nextSections) {
    const items = safeArray<any>(section.items)
    for (const item of items) {
      const text = safeString(item)
      if (text) implementationBullets.push(text)
    }
  }

  const keyFiles = new Set<string>()
  const pathRegex = /(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+/g
  for (const bullet of [...mediumLevelBullets, ...implementationBullets]) {
    const matches = bullet.match(pathRegex)
    if (!matches) continue
    for (const match of matches) keyFiles.add(match)
  }

  const highLevelDescription = (() => {
    const firstArchitecture = architectureSections[0]
    if (firstArchitecture) {
      const notes = safeArray<string>(firstArchitecture.notes)
      if (notes.length > 0) return notes[0]
      const title = safeString(firstArchitecture.title)
      if (title) return `Planned architecture change: ${title}.`
    }

    if (safeString(summary?.outcome)) return safeString(summary.outcome)

    const goalPreview = summarizePlanGoal(plan.goal, 180)
    if (goalPreview) return goalPreview

    return 'We will evolve the current architecture to match the planned target while keeping behavior stable.'
  })()

  const renderLabeledText = (text: string) => {
    const match = text.match(/^([A-Za-z][A-Za-z\s-]+):\s*(.*)$/)
    if (!match) return text

    const label = match[1]
    const rest = match[2]
    return (
      <>
        <span className="font-extrabold text-slate-100">{label}:</span>{rest ? ` ${rest}` : ''}
      </>
    )
  }

  return (
    <div className="px-0 pb-4 pt-3 border-t border-slate-200">
      <div className="space-y-6 text-slate-800">
        <section className="space-y-2 pb-4 border-b border-slate-200/70">
          <h4 className="text-base font-semibold text-slate-900">Goal</h4>
          {summary ? (
            <ul className="list-disc pl-5 space-y-1.5 text-sm leading-6">
              {safeString(summary.problem) && <li>{renderLabeledText(`Problem: ${safeString(summary.problem)}`)}</li>}
              {safeString(summary.insight) && <li>{renderLabeledText(`Insight: ${safeString(summary.insight)}`)}</li>}
              {safeString(summary.outcome) && <li>{renderLabeledText(`Outcome: ${safeString(summary.outcome)}`)}</li>}
            </ul>
          ) : (
            <div className="prose prose-slate prose-sm max-w-none leading-relaxed"><ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{plan.goal}</ReactMarkdown></div>
          )}
        </section>

        <section className="space-y-3 pb-4 border-b border-slate-200/70">
          <h4 className="text-base font-semibold text-slate-900">High level</h4>
          <p className="text-sm leading-6 text-slate-700">{highLevelDescription}</p>
          {architectureSections.length > 0 && architectureSections.map((section, index) => {
            const current = (section.current && typeof section.current === 'object') ? section.current as Record<string, unknown> : {}
            const planned = (section.planned && typeof section.planned === 'object') ? section.planned as Record<string, unknown> : {}
            const notes = safeArray<string>(section.notes)
            return (
              <div key={`arch-${index}`} className="space-y-2">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <MermaidDiagramPanel title={safeString(current.label, 'Current')} code={safeString(current.code)} />
                  <MermaidDiagramPanel title={safeString(planned.label, 'Planned')} code={safeString(planned.code)} />
                </div>
                {notes.length > 0 && (
                  <ul className="list-disc pl-5 space-y-1 text-sm leading-6 text-slate-700">
                    {notes.map((note: string, noteIndex: number) => <li key={`arch-note-${noteIndex}`}>{note}</li>)}
                  </ul>
                )}
              </div>
            )
          })}
        </section>

        <section className="space-y-2 pb-4 border-b border-slate-200/70">
          <h4 className="text-base font-semibold text-slate-900">Medium level</h4>
          {mediumLevelBullets.length > 0 ? (
            <ul className="list-disc pl-5 space-y-1.5 text-sm leading-6">
              {mediumLevelBullets.map((bullet, index) => <li key={`medium-${index}`}>{renderLabeledText(bullet)}</li>)}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">Implementation approach details were not provided for this plan.</p>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-base font-semibold text-slate-900">Implementation details</h4>
          {keyFiles.size > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Key files from exploration</p>
              <ul className="list-disc pl-5 space-y-1 text-sm leading-6">
                {Array.from(keyFiles).map((file) => <li key={file}><code>{file}</code></li>)}
              </ul>
            </div>
          )}
          {implementationBullets.length > 0 && (
            <ul className="list-disc pl-5 space-y-1.5 text-sm leading-6">
              {implementationBullets.map((bullet, index) => <li key={`impl-${index}`}>{bullet}</li>)}
            </ul>
          )}
          {unknownSections.length > 0 && (
            <div className="space-y-1">
              {unknownSections.map((section, index) => (
                <p key={`unknown-${index}`} className="text-xs text-amber-700">
                  Unknown plan section "{safeString(section.originalComponent)}" ({safeString(section.reason)}).
                </p>
              ))}
            </div>
          )}
          {keyFiles.size === 0 && implementationBullets.length === 0 && unknownSections.length === 0 && (
            <p className="text-sm text-slate-600">No implementation detail bullets provided.</p>
          )}
        </section>
      </div>
    </div>
  )
}

function summarizePlanGoal(goal: unknown, maxLength = 180): string {
  const goalText = typeof goal === 'string' ? goal : ''
  const normalized = goalText.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

function normalizeAcceptanceCriteria(criteria: unknown): string[] {
  if (!Array.isArray(criteria)) return []

  return criteria
    .map((criterion) => {
      if (typeof criterion === 'string') {
        return criterion.trim()
      }

      if (criterion == null) {
        return ''
      }

      if (typeof criterion === 'object') {
        const parts = Object.entries(criterion as Record<string, unknown>).map(([key, value]) => {
          const valueText = formatCriterionValue(value)
          return valueText ? `${key}: ${valueText}` : key
        })
        return parts.join(' ').trim()
      }

      return String(criterion).trim()
    })
    .filter(Boolean)
}

function formatCriterionValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (value == null) {
    return ''
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  return String(value).trim()
}

function formatAcceptanceCriteriaForEditor(criteria: unknown): string {
  return normalizeAcceptanceCriteria(criteria).join('\n')
}

function normalizeCriteriaDraftItems(criteriaItems: string[]): string[] {
  return criteriaItems
    .map((criterion) => criterion.trim())
    .filter(Boolean)
}

async function parseResponseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) {
      return body.error
    }
  } catch {
    // ignore JSON parse errors and use fallback below
  }

  return `${fallback} (${response.status})`
}

const TOKEN_COUNT_FORMATTER = new Intl.NumberFormat()

function formatTokenCount(value: number): string {
  if (!Number.isFinite(value)) {
    return '0'
  }

  return TOKEN_COUNT_FORMATTER.format(Math.max(0, Math.round(value)))
}

function formatUsageCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0.00'
  }

  if (value >= 1) return value.toFixed(2)
  if (value >= 0.01) return value.toFixed(4)
  return value.toFixed(6)
}

function formatModelUsageList(models: TaskModelUsage[]): string {
  if (models.length === 0) {
    return '—'
  }

  return models
    .map((modelUsage) => `${modelUsage.provider}/${modelUsage.modelId}`)
    .join(', ')
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.round((seconds % 3600) / 60)
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}
