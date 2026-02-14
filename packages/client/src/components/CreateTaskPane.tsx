import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import type { ModelConfig, NewTaskFormState, TaskDefaults, ExecutionWrapper } from '@pi-factory/shared'
import { DEFAULT_PRE_EXECUTION_SKILLS, DEFAULT_POST_EXECUTION_SKILLS } from '@pi-factory/shared'
import { AppIcon } from './AppIcon'
import { MarkdownEditor } from './MarkdownEditor'
import { ModelSelector } from './ModelSelector'
import { ExecutionPipelineEditor } from './ExecutionPipelineEditor'
import { buildCreateTaskFormDefaults } from './task-default-form'
import { clearStoredWhiteboardScene, createWhiteboardAttachmentFilename, exportWhiteboardPngFile, hasWhiteboardContent, loadStoredWhiteboardScene, persistWhiteboardScene, type WhiteboardSceneSnapshot } from './whiteboard'
import { InlineWhiteboardPanel } from './InlineWhiteboardPanel'
import { useLocalStorageDraft } from '../hooks/useLocalStorageDraft'
import { api } from '../api'
import type { PostExecutionSkill } from '../types/pi'

export interface CreateTaskData {
  content: string
  preExecutionSkills?: string[]
  postExecutionSkills?: string[]
  skillConfigs?: Record<string, Record<string, string>>
  planningModelConfig?: ModelConfig
  executionModelConfig?: ModelConfig
  pendingFiles?: File[]
}

interface CreateTaskPaneProps {
  workspaceId: string
  onCancel: () => void
  onSubmit: (data: CreateTaskData) => void
  /** Incoming form updates from the planning agent (via WebSocket) */
  agentFormUpdates?: Partial<NewTaskFormState> | null
  /** Optional one-shot prefill payload when opening from inline draft-task cards. */
  prefillRequest?: { id: string; formState: Partial<NewTaskFormState> } | null
}

const CREATE_TASK_WHITEBOARD_STORAGE_KEY_PREFIX = 'pi-factory:create-task-whiteboard'

function getCreateTaskWhiteboardStorageKey(workspaceId: string): string {
  return `${CREATE_TASK_WHITEBOARD_STORAGE_KEY_PREFIX}:${workspaceId}`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function CreateTaskPane({ workspaceId, onCancel, onSubmit, agentFormUpdates, prefillRequest }: CreateTaskPaneProps) {
  const { initialDraft, restoredFromDraft, updateDraft, clearDraft, dismissRestoredBanner } = useLocalStorageDraft(workspaceId)
  const whiteboardStorageKey = getCreateTaskWhiteboardStorageKey(workspaceId)
  const hasRestoredDraftContent = !prefillRequest && initialDraft.content.trim().length > 0

  const [content, setContent] = useState(
    typeof prefillRequest?.formState.content === 'string'
      ? prefillRequest.formState.content
      : initialDraft.content,
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [availableSkills, setAvailableSkills] = useState<PostExecutionSkill[]>([])
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(
    Array.isArray(prefillRequest?.formState.selectedSkillIds)
      ? prefillRequest.formState.selectedSkillIds
      : initialDraft.selectedSkillIds,
  )
  const [selectedPreSkillIds, setSelectedPreSkillIds] = useState<string[]>(
    Array.isArray(prefillRequest?.formState.selectedPreSkillIds)
      ? prefillRequest.formState.selectedPreSkillIds
      : (initialDraft.selectedPreSkillIds || []),
  )
  const [skillConfigs, setSkillConfigs] = useState<Record<string, Record<string, string>>>({})
  const [planningModelConfig, setPlanningModelConfig] = useState<ModelConfig | undefined>(
    (prefillRequest?.formState.planningModelConfig ?? initialDraft.planningModelConfig) as ModelConfig | undefined
  )
  const [executionModelConfig, setExecutionModelConfig] = useState<ModelConfig | undefined>(
    (prefillRequest?.formState.executionModelConfig
      ?? prefillRequest?.formState.modelConfig
      ?? initialDraft.executionModelConfig
      ?? initialDraft.modelConfig) as ModelConfig | undefined
  )
  const [availableWrappers, setAvailableWrappers] = useState<ExecutionWrapper[]>([])
  const [selectedWrapperId, setSelectedWrapperId] = useState<string>('')
  const [taskDefaults, setTaskDefaults] = useState<TaskDefaults>({
    planningModelConfig: undefined,
    executionModelConfig: undefined,
    modelConfig: undefined,
    preExecutionSkills: [...DEFAULT_PRE_EXECUTION_SKILLS],
    postExecutionSkills: [...DEFAULT_POST_EXECUTION_SKILLS],
  })
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [isWhiteboardModalOpen, setIsWhiteboardModalOpen] = useState(false)
  const [isAttachingWhiteboard, setIsAttachingWhiteboard] = useState(false)
  const [initialWhiteboardScene, setInitialWhiteboardScene] = useState<WhiteboardSceneSnapshot | null>(() => {
    const loaded = loadStoredWhiteboardScene(whiteboardStorageKey)
    return hasWhiteboardContent(loaded) ? loaded : null
  })
  const [isDragOver, setIsDragOver] = useState(false)
  const [isWide, setIsWide] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const whiteboardSceneRef = useRef<WhiteboardSceneSnapshot | null>(initialWhiteboardScene)
  const appliedPrefillIdRef = useRef<string | null>(prefillRequest?.id ?? null)

  useEffect(() => {
    fetch('/api/factory/skills')
      .then(r => r.json())
      .then(setAvailableSkills)
      .catch(err => console.error('Failed to load skills:', err))

    fetch('/api/wrappers')
      .then(r => r.json())
      .then(setAvailableWrappers)
      .catch(err => console.error('Failed to load execution wrappers:', err))
  }, [])

  useEffect(() => {
    api.getWorkspaceTaskDefaults(workspaceId)
      .then((defaults) => {
        setTaskDefaults(defaults)

        // Preserve restored drafts with user-entered content.
        if (hasRestoredDraftContent) {
          return
        }

        const formDefaults = buildCreateTaskFormDefaults(defaults)
        setSelectedPreSkillIds(formDefaults.selectedPreSkillIds)
        setSelectedSkillIds(formDefaults.selectedSkillIds)
        setPlanningModelConfig(formDefaults.planningModelConfig)
        setExecutionModelConfig(formDefaults.executionModelConfig)
      })
      .catch((err) => {
        console.error('Failed to load task defaults:', err)
      })
  }, [workspaceId, hasRestoredDraftContent])

  // Register form with server when pane opens, unregister on close
  useEffect(() => {
    const formState: NewTaskFormState = {
      content,
      selectedSkillIds,
      selectedPreSkillIds,
      planningModelConfig,
      executionModelConfig,
      // Keep legacy field aligned for older agent extensions.
      modelConfig: executionModelConfig,
    }
    api.openTaskForm(workspaceId, formState).catch(() => {})
    return () => {
      api.closeTaskForm(workspaceId).catch(() => {})
    }
  }, [workspaceId]) // Only on mount/unmount

  // Sync form changes to server (debounced)
  const syncTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => {
      api.syncTaskForm(workspaceId, {
        content,
        selectedSkillIds,
        selectedPreSkillIds,
        planningModelConfig,
        executionModelConfig,
        // Keep legacy field aligned for older agent extensions.
        modelConfig: executionModelConfig,
      }).catch(() => {})
    }, 300)
    return () => { if (syncTimer.current) clearTimeout(syncTimer.current) }
  }, [workspaceId, content, selectedSkillIds, selectedPreSkillIds, planningModelConfig, executionModelConfig])

  // Apply incoming updates from the planning agent
  useEffect(() => {
    if (!agentFormUpdates) return

    const hasPipelineUpdate =
      agentFormUpdates.selectedSkillIds !== undefined ||
      agentFormUpdates.selectedPreSkillIds !== undefined

    if (agentFormUpdates.content !== undefined) setContent(agentFormUpdates.content)
    if (agentFormUpdates.selectedSkillIds !== undefined) setSelectedSkillIds(agentFormUpdates.selectedSkillIds)
    if (agentFormUpdates.selectedPreSkillIds !== undefined) setSelectedPreSkillIds(agentFormUpdates.selectedPreSkillIds)
    if (agentFormUpdates.planningModelConfig !== undefined) {
      setPlanningModelConfig(agentFormUpdates.planningModelConfig)
    }
    if (agentFormUpdates.executionModelConfig !== undefined) {
      setExecutionModelConfig(agentFormUpdates.executionModelConfig)
    } else if (agentFormUpdates.modelConfig !== undefined) {
      // Legacy update path from older agent extensions.
      setExecutionModelConfig(agentFormUpdates.modelConfig)
    }
    if (hasPipelineUpdate) setSelectedWrapperId('')
  }, [agentFormUpdates])

  // Apply one-shot prefill payloads (e.g. opening from inline draft-task cards)
  useEffect(() => {
    if (!prefillRequest) return
    if (appliedPrefillIdRef.current === prefillRequest.id) return

    appliedPrefillIdRef.current = prefillRequest.id

    const updates = prefillRequest.formState
    const hasPipelineUpdate =
      updates.selectedSkillIds !== undefined ||
      updates.selectedPreSkillIds !== undefined

    if (updates.content !== undefined) setContent(updates.content)
    if (updates.selectedSkillIds !== undefined) setSelectedSkillIds(updates.selectedSkillIds)
    if (updates.selectedPreSkillIds !== undefined) setSelectedPreSkillIds(updates.selectedPreSkillIds)
    if (updates.planningModelConfig !== undefined) setPlanningModelConfig(updates.planningModelConfig)
    if (updates.executionModelConfig !== undefined) {
      setExecutionModelConfig(updates.executionModelConfig)
    } else if (updates.modelConfig !== undefined) {
      setExecutionModelConfig(updates.modelConfig)
    }

    if (hasPipelineUpdate) setSelectedWrapperId('')
  }, [prefillRequest])

  // Measure container width to decide side-by-side vs stacked layout
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsWide(entry.contentRect.width >= 800)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Auto-save draft to localStorage when form fields change
  useEffect(() => {
    updateDraft({ content })
  }, [content, updateDraft])

  useEffect(() => {
    updateDraft({ selectedSkillIds })
  }, [selectedSkillIds, updateDraft])

  useEffect(() => {
    updateDraft({ selectedPreSkillIds })
  }, [selectedPreSkillIds, updateDraft])

  useEffect(() => {
    updateDraft({ planningModelConfig })
  }, [planningModelConfig, updateDraft])

  useEffect(() => {
    updateDraft({
      executionModelConfig,
      // Keep legacy field aligned for backward compatibility.
      modelConfig: executionModelConfig,
    })
  }, [executionModelConfig, updateDraft])

  const handleClearForm = useCallback(() => {
    const formDefaults = buildCreateTaskFormDefaults(taskDefaults)

    setContent('')
    setSelectedPreSkillIds(formDefaults.selectedPreSkillIds)
    setSelectedSkillIds(formDefaults.selectedSkillIds)
    setSkillConfigs({})
    setPlanningModelConfig(formDefaults.planningModelConfig)
    setExecutionModelConfig(formDefaults.executionModelConfig)
    setSelectedWrapperId('')
    setPendingFiles([])
    setIsWhiteboardModalOpen(false)
    whiteboardSceneRef.current = null
    setInitialWhiteboardScene(null)
    clearStoredWhiteboardScene(whiteboardStorageKey)
    clearDraft()
  }, [clearDraft, taskDefaults, whiteboardStorageKey])

  const addFiles = useCallback((files: FileList | File[]) => {
    const newFiles = Array.from(files)
    if (newFiles.length === 0) return
    setPendingFiles(prev => [...prev, ...newFiles])
  }, [])

  const removeFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index))
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

  const handleWhiteboardSceneChange = useCallback((scene: WhiteboardSceneSnapshot) => {
    whiteboardSceneRef.current = scene
    persistWhiteboardScene(whiteboardStorageKey, scene)
  }, [whiteboardStorageKey])

  const openWhiteboardModal = useCallback(() => {
    setInitialWhiteboardScene(whiteboardSceneRef.current)
    setIsWhiteboardModalOpen(true)
  }, [])

  const closeWhiteboardModal = useCallback(() => {
    setIsWhiteboardModalOpen(false)
  }, [])

  const attachWhiteboardToPendingFiles = useCallback(async () => {
    const scene = whiteboardSceneRef.current
    if (!scene || !hasWhiteboardContent(scene)) return
    setIsAttachingWhiteboard(true)
    try {
      const file = await exportWhiteboardPngFile(scene, createWhiteboardAttachmentFilename())
      setPendingFiles(prev => [...prev, file])
      whiteboardSceneRef.current = null
      setInitialWhiteboardScene(null)
      clearStoredWhiteboardScene(whiteboardStorageKey)
      setIsWhiteboardModalOpen(false)
    } catch (err) {
      console.error('Failed to export whiteboard image:', err)
    } finally {
      setIsAttachingWhiteboard(false)
    }
  }, [whiteboardStorageKey])

  const handleSubmit = async () => {
    if (!content.trim()) return
    setIsSubmitting(true)

    try {
      // Only include skillConfigs if there are actual overrides
      const hasSkillConfigs = Object.keys(skillConfigs).length > 0

      await onSubmit({
        content,
        preExecutionSkills: selectedPreSkillIds,
        postExecutionSkills: selectedSkillIds,
        skillConfigs: hasSkillConfigs ? skillConfigs : undefined,
        planningModelConfig,
        executionModelConfig,
        pendingFiles: pendingFiles.length > 0 ? pendingFiles : undefined,
      })

      whiteboardSceneRef.current = null
      setInitialWhiteboardScene(null)
      clearStoredWhiteboardScene(whiteboardStorageKey)
      clearDraft()
    } finally {
      setIsSubmitting(false)
    }
  }

  // Shared sub-components for DRY between layouts
  const descriptionSection = (
    <div className={`flex flex-col min-h-0 ${isWide ? 'flex-1' : 'shrink-0'}`}>
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 shrink-0">
        Task Description
      </label>
      <div className={isWide ? 'flex flex-1 min-h-0' : 'h-80 min-h-[220px] max-h-[75vh] resize-y overflow-auto'}>
        <MarkdownEditor
          value={content}
          onChange={setContent}
          placeholder="Describe what needs to be done..."
          autoFocus
          minHeight="100%"
          fill
        />
      </div>
    </div>
  )

  const attachmentsSection = (
    <div className="shrink-0">
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Attachments
          {pendingFiles.length > 0 && (
            <span className="ml-1.5 text-slate-400 font-normal">({pendingFiles.length})</span>
          )}
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openWhiteboardModal}
            className="text-xs text-violet-600 hover:text-violet-800 font-medium"
          >
            + Add Excalidraw
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            + Add Files
          </button>
        </div>
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
      </div>

      {/* Pending files list */}
      {pendingFiles.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {pendingFiles.map((file, i) => {
            const isImage = file.type.startsWith('image/')
            return (
              <div
                key={`${file.name}-${i}`}
                className="flex items-center gap-2.5 p-2 rounded-lg border border-slate-200 bg-slate-50"
              >
                {isImage ? (
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="w-8 h-8 rounded object-cover shrink-0"
                  />
                ) : (
                  <span className="w-8 h-8 rounded bg-slate-200 flex items-center justify-center text-[9px] text-slate-400 font-mono shrink-0">file</span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-700 truncate">{file.name}</div>
                  <div className="text-xs text-slate-400">{formatFileSize(file.size)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="w-5 h-5 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center text-xs shrink-0 transition-colors"
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

      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${
          isDragOver
            ? 'border-blue-400 bg-blue-50'
            : 'border-slate-200 bg-slate-50 hover:border-slate-300'
        }`}
      >
        <p className="text-sm text-slate-500">
          {isDragOver ? 'Drop files here' : 'Drag & drop or click to add files'}
        </p>
        <p className="text-xs text-slate-400 mt-0.5">Images, PDFs, text files</p>
      </div>
    </div>
  )

  const modelSection = (
    <div className="shrink-0 space-y-3">
      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
          Planning Model
        </label>
        <ModelSelector value={planningModelConfig} onChange={setPlanningModelConfig} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
          Execution Model
        </label>
        <ModelSelector value={executionModelConfig} onChange={setExecutionModelConfig} />
      </div>
    </div>
  )

  const executionPipelineSection = (
    <div className="shrink-0">
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
        Execution Pipeline
      </label>
      <p className="text-xs text-slate-400 mb-2">
        Add skills or wrappers, then drag cards to pre/post lanes to control execution order.
      </p>
      <ExecutionPipelineEditor
        availableSkills={availableSkills}
        availableWrappers={availableWrappers}
        selectedPreSkillIds={selectedPreSkillIds}
        selectedSkillIds={selectedSkillIds}
        selectedWrapperId={selectedWrapperId}
        onPreSkillsChange={setSelectedPreSkillIds}
        onPostSkillsChange={setSelectedSkillIds}
        onWrapperChange={setSelectedWrapperId}
        skillConfigs={skillConfigs}
        onSkillConfigChange={setSkillConfigs}
      />
    </div>
  )

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600 transition-colors text-sm inline-flex items-center gap-1"
          >
            <AppIcon icon={ArrowLeft} size="xs" />
            Back
          </button>
          <h2 className="font-semibold text-sm text-slate-800">New Task</h2>
        </div>
        <div className="flex items-center gap-2">
          {content.trim() && (
            <button
              onClick={handleClearForm}
              className="text-xs text-slate-400 hover:text-red-500 transition-colors py-1.5 px-2"
              title="Clear form and discard draft"
            >
              Clear
            </button>
          )}
          <button
            onClick={onCancel}
            className="btn btn-secondary text-sm py-1.5 px-3"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!content.trim() || isSubmitting}
            className="btn btn-primary text-sm py-1.5 px-3 disabled:opacity-50"
          >
            {isSubmitting ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </div>

      {/* Restored draft banner */}
      {restoredFromDraft && !prefillRequest && (
        <div className="flex items-center justify-between px-5 py-2 bg-blue-50 border-b border-blue-200 text-blue-800 text-sm shrink-0">
          <span className="flex items-center gap-2">
            <span>Draft restored from your previous session</span>
          </span>
          <button
            onClick={dismissRestoredBanner}
            className="ml-4 text-blue-400 hover:text-blue-600 font-medium text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {isWide ? (
        /* ── Wide: side-by-side — Left: description | Right: config + attachments ── */
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left panel — content editing */}
          <div className="flex-[2] flex flex-col min-h-0 min-w-0 p-5 border-r border-slate-200">
            {descriptionSection}
          </div>
          {/* Right panel — configuration */}
          <div className="flex-1 min-w-0 p-5 space-y-5 overflow-y-auto">
            {modelSection}
            {executionPipelineSection}
            {attachmentsSection}
          </div>
        </div>
      ) : (
        /* ── Narrow: single column stacked ── */
        <div className="flex-1 flex flex-col min-h-0 p-5 gap-4 overflow-y-auto">
          {descriptionSection}
          {modelSection}
          {executionPipelineSection}
          {attachmentsSection}
        </div>
      )}

      {isWhiteboardModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closeWhiteboardModal}
        >
          <div
            className="w-full max-w-6xl max-h-[92vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-700">Draw a sketch</h3>
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
