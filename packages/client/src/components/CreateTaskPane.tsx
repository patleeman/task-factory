import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import type { ModelConfig, NewTaskFormState, TaskDefaults, ExecutionWrapper } from '@pi-factory/shared'
import { DEFAULT_PRE_EXECUTION_SKILLS, DEFAULT_POST_EXECUTION_SKILLS } from '@pi-factory/shared'
import { MarkdownEditor } from './MarkdownEditor'
import { SkillSelector } from './SkillSelector'
import { ModelSelector } from './ModelSelector'
import { InlineWhiteboardPanel } from './InlineWhiteboardPanel'
import { clearStoredWhiteboardScene, createWhiteboardAttachmentFilename, exportWhiteboardPngFile, hasWhiteboardContent, loadStoredWhiteboardScene, persistWhiteboardScene, type WhiteboardSceneSnapshot } from './whiteboard'
import { useLocalStorageDraft } from '../hooks/useLocalStorageDraft'
import { api } from '../api'
import type { PostExecutionSkill } from '../types/pi'

export interface CreateTaskData {
  content: string
  preExecutionSkills?: string[]
  postExecutionSkills?: string[]
  skillConfigs?: Record<string, Record<string, string>>
  modelConfig?: ModelConfig
  pendingFiles?: File[]
}

interface CreateTaskPaneProps {
  workspaceId: string
  onCancel: () => void
  onSubmit: (data: CreateTaskData) => void
  /** Incoming form updates from the planning agent (via WebSocket) */
  agentFormUpdates?: Partial<NewTaskFormState> | null
}

const CREATE_TASK_WHITEBOARD_STORAGE_KEY = 'pi-factory:create-task-whiteboard'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function CreateTaskPane({ workspaceId, onCancel, onSubmit, agentFormUpdates }: CreateTaskPaneProps) {
  const { initialDraft, restoredFromDraft, updateDraft, clearDraft, dismissRestoredBanner } = useLocalStorageDraft()
  const hasRestoredDraftContent = initialDraft.content.trim().length > 0

  const [content, setContent] = useState(initialDraft.content)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [availableSkills, setAvailableSkills] = useState<PostExecutionSkill[]>([])
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(initialDraft.selectedSkillIds)
  const [selectedPreSkillIds, setSelectedPreSkillIds] = useState<string[]>(initialDraft.selectedPreSkillIds || [])
  const [skillConfigs, setSkillConfigs] = useState<Record<string, Record<string, string>>>({})
  const [modelConfig, setModelConfig] = useState<ModelConfig | undefined>(initialDraft.modelConfig as ModelConfig | undefined)
  const [availableWrappers, setAvailableWrappers] = useState<ExecutionWrapper[]>([])
  const [selectedWrapperId, setSelectedWrapperId] = useState<string>('')
  const [taskDefaults, setTaskDefaults] = useState<TaskDefaults>({
    modelConfig: undefined,
    preExecutionSkills: [...DEFAULT_PRE_EXECUTION_SKILLS],
    postExecutionSkills: [...DEFAULT_POST_EXECUTION_SKILLS],
  })
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [isWhiteboardActive, setIsWhiteboardActive] = useState(false)
  const [initialWhiteboardScene, setInitialWhiteboardScene] = useState<WhiteboardSceneSnapshot | null>(() => {
    const loaded = loadStoredWhiteboardScene(CREATE_TASK_WHITEBOARD_STORAGE_KEY)
    return hasWhiteboardContent(loaded) ? loaded : null
  })
  const [isDragOver, setIsDragOver] = useState(false)
  const [isWide, setIsWide] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const whiteboardSceneRef = useRef<WhiteboardSceneSnapshot | null>(initialWhiteboardScene)
  const whiteboardPersistTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

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
    api.getTaskDefaults()
      .then((defaults) => {
        setTaskDefaults(defaults)

        // Preserve restored drafts with user-entered content.
        if (hasRestoredDraftContent) {
          return
        }

        setSelectedPreSkillIds([...defaults.preExecutionSkills])
        setSelectedSkillIds([...defaults.postExecutionSkills])
        setModelConfig(defaults.modelConfig ? { ...defaults.modelConfig } : undefined)
      })
      .catch((err) => {
        console.error('Failed to load task defaults:', err)
      })
  }, [hasRestoredDraftContent])

  // Register form with server when pane opens, unregister on close
  useEffect(() => {
    const formState: NewTaskFormState = {
      content,
      selectedSkillIds,
      selectedPreSkillIds,
      modelConfig,
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
      api.syncTaskForm(workspaceId, { content, selectedSkillIds, selectedPreSkillIds, modelConfig }).catch(() => {})
    }, 300)
    return () => { if (syncTimer.current) clearTimeout(syncTimer.current) }
  }, [workspaceId, content, selectedSkillIds, selectedPreSkillIds, modelConfig])

  // Apply incoming updates from the planning agent
  useEffect(() => {
    if (!agentFormUpdates) return
    if (agentFormUpdates.content !== undefined) setContent(agentFormUpdates.content)
    if (agentFormUpdates.selectedSkillIds !== undefined) setSelectedSkillIds(agentFormUpdates.selectedSkillIds)
    if (agentFormUpdates.selectedPreSkillIds !== undefined) setSelectedPreSkillIds(agentFormUpdates.selectedPreSkillIds)
    if (agentFormUpdates.modelConfig !== undefined) setModelConfig(agentFormUpdates.modelConfig)
  }, [agentFormUpdates])

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

  useEffect(() => {
    return () => {
      if (whiteboardPersistTimerRef.current) {
        clearTimeout(whiteboardPersistTimerRef.current)
      }
    }
  }, [])

  // Auto-save draft to localStorage when form fields change
  useEffect(() => {
    updateDraft({ content })
  }, [content, updateDraft])

  useEffect(() => {
    updateDraft({ selectedSkillIds })
  }, [selectedSkillIds, updateDraft])

  useEffect(() => {
    updateDraft({ modelConfig })
  }, [modelConfig, updateDraft])

  const handleClearForm = useCallback(() => {
    setContent('')
    setSelectedPreSkillIds([...taskDefaults.preExecutionSkills])
    setSelectedSkillIds([...taskDefaults.postExecutionSkills])
    setSkillConfigs({})
    setModelConfig(taskDefaults.modelConfig ? { ...taskDefaults.modelConfig } : undefined)
    setSelectedWrapperId('')
    setPendingFiles([])
    setIsWhiteboardActive(false)
    if (whiteboardPersistTimerRef.current) {
      clearTimeout(whiteboardPersistTimerRef.current)
      whiteboardPersistTimerRef.current = undefined
    }
    whiteboardSceneRef.current = null
    setInitialWhiteboardScene(null)
    clearStoredWhiteboardScene(CREATE_TASK_WHITEBOARD_STORAGE_KEY)
    clearDraft()
  }, [clearDraft, taskDefaults])

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

    if (whiteboardPersistTimerRef.current) {
      clearTimeout(whiteboardPersistTimerRef.current)
    }

    whiteboardPersistTimerRef.current = setTimeout(() => {
      persistWhiteboardScene(CREATE_TASK_WHITEBOARD_STORAGE_KEY, scene)
    }, 200)
  }, [])

  const handleSubmit = async () => {
    if (!content.trim()) return
    setIsSubmitting(true)

    try {
      // Only include skillConfigs if there are actual overrides
      const hasSkillConfigs = Object.keys(skillConfigs).length > 0
      const filesToSubmit = [...pendingFiles]

      const sceneToAttach = whiteboardSceneRef.current
      if (sceneToAttach && hasWhiteboardContent(sceneToAttach)) {
        try {
          const whiteboardFile = await exportWhiteboardPngFile(
            sceneToAttach,
            createWhiteboardAttachmentFilename(),
          )
          filesToSubmit.push(whiteboardFile)
        } catch (err) {
          console.error('Failed to export whiteboard image:', err)
        }
      }

      await onSubmit({
        content,
        preExecutionSkills: selectedPreSkillIds,
        postExecutionSkills: selectedSkillIds,
        skillConfigs: hasSkillConfigs ? skillConfigs : undefined,
        modelConfig,
        pendingFiles: filesToSubmit.length > 0 ? filesToSubmit : undefined,
      })

      if (whiteboardPersistTimerRef.current) {
        clearTimeout(whiteboardPersistTimerRef.current)
        whiteboardPersistTimerRef.current = undefined
      }
      whiteboardSceneRef.current = null
      setInitialWhiteboardScene(null)
      clearStoredWhiteboardScene(CREATE_TASK_WHITEBOARD_STORAGE_KEY)
      clearDraft()
    } finally {
      setIsSubmitting(false)
    }
  }

  // Shared sub-components for DRY between layouts
  const descriptionSection = (
    <div className="flex flex-col shrink-0">
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 shrink-0">
        Task Description
      </label>
      <div className="h-80 min-h-[220px] max-h-[75vh] resize-y overflow-auto">
        <MarkdownEditor
          value={content}
          onChange={setContent}
          placeholder="Describe what needs to be done..."
          autoFocus
          minHeight="100%"
          fill
        />
      </div>

      <div className="mt-3 shrink-0">
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
          Whiteboard (Optional)
        </label>
        <p className="text-xs text-slate-400 mb-2">
          Draw inline and we will auto-attach a PNG when you create the task.
        </p>
        <InlineWhiteboardPanel
          isActive={isWhiteboardActive}
          onActivate={() => setIsWhiteboardActive(true)}
          onSceneChange={handleWhiteboardSceneChange}
          initialScene={initialWhiteboardScene}
          activateLabel="Open Excalidraw"
          inactiveHint="No manual save needed — non-empty boards are exported automatically on submit."
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
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
        >
          + Add Files
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
                  title="Remove"
                >
                  ×
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
    <div className="shrink-0">
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
        Model
      </label>
      <ModelSelector value={modelConfig} onChange={setModelConfig} />
    </div>
  )

  const handleWrapperToggle = (wrapperId: string) => {
    if (selectedWrapperId === wrapperId) {
      // Deselect — clear wrapper and reset skills to defaults
      setSelectedWrapperId('')
      setSelectedPreSkillIds([...taskDefaults.preExecutionSkills])
      setSelectedSkillIds([...taskDefaults.postExecutionSkills])
    } else {
      // Select — apply wrapper's skill arrays
      setSelectedWrapperId(wrapperId)
      const wrapper = availableWrappers.find(w => w.id === wrapperId)
      if (wrapper) {
        setSelectedPreSkillIds([...wrapper.preExecutionSkills])
        setSelectedSkillIds([...wrapper.postExecutionSkills])
      }
    }
  }

  const wrapperSection = availableWrappers.length > 0 ? (
    <div className="shrink-0">
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
        Execution Wrapper
      </label>
      <p className="text-xs text-slate-400 mb-2">
        Pre-configured skill pairs that wrap execution. Click to apply.
      </p>
      <div className="space-y-1.5">
        {availableWrappers.map(w => {
          const isSelected = selectedWrapperId === w.id
          return (
            <div
              key={w.id}
              onClick={() => handleWrapperToggle(w.id)}
              className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-colors ${
                isSelected
                  ? 'border-violet-400 bg-violet-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-[10px] text-slate-400 font-mono shrink-0">wrap</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">
                    {w.name}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {w.description}
                  </div>
                  {isSelected && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {w.preExecutionSkills.length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600">
                          pre: {w.preExecutionSkills.join(', ')}
                        </span>
                      )}
                      {w.postExecutionSkills.length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-600">
                          post: {w.postExecutionSkills.join(', ')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 text-[10px] transition-colors ${
                isSelected
                  ? 'border-violet-500 bg-violet-500 text-white'
                  : 'border-slate-300'
              }`}>
                {isSelected && '✓'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  ) : null

  const preSkillsSection = availableSkills.length > 0 ? (
    <div className="shrink-0">
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
        Pre-Execution Skills
      </label>
      <p className="text-xs text-slate-400 mb-2">
        Run before the agent starts its main work. Failure blocks execution.
      </p>
      <SkillSelector
        availableSkills={availableSkills}
        selectedSkillIds={selectedPreSkillIds}
        onChange={setSelectedPreSkillIds}
      />
    </div>
  ) : null

  const skillsSection = availableSkills.length > 0 ? (
    <div className="shrink-0">
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
        Post-Execution Skills
      </label>
      <p className="text-xs text-slate-400 mb-2">
        Run automatically after the agent completes its main work.
      </p>
      <SkillSelector
        availableSkills={availableSkills}
        selectedSkillIds={selectedSkillIds}
        onChange={setSelectedSkillIds}
        skillConfigs={skillConfigs}
        onSkillConfigChange={setSkillConfigs}
      />
    </div>
  ) : null

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600 transition-colors text-sm"
          >
            ← Back
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
      {restoredFromDraft && (
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
        /* ── Wide: side-by-side — Left: description/criteria/attachments | Right: config ── */
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left panel — content editing */}
          <div className="flex-[2] flex flex-col min-h-0 min-w-0 p-5 gap-4 overflow-y-auto border-r border-slate-200">
            {descriptionSection}
            {attachmentsSection}
          </div>
          {/* Right panel — configuration */}
          <div className="flex-1 min-w-0 p-5 space-y-5 overflow-y-auto">
            {modelSection}
            {wrapperSection}
            {preSkillsSection}
            {skillsSection}
          </div>
        </div>
      ) : (
        /* ── Narrow: single column stacked ── */
        <div className="flex-1 flex flex-col min-h-0 p-5 gap-4 overflow-y-auto">
          {descriptionSection}
          {attachmentsSection}
          {modelSection}
          {wrapperSection}
          {preSkillsSection}
          {skillsSection}
        </div>
      )}
    </div>
  )
}
