import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { DEFAULT_PRE_EXECUTION_SKILLS, DEFAULT_POST_EXECUTION_SKILLS } from '@pi-factory/shared'

const STORAGE_KEY_PREFIX = 'pi-factory:create-task-draft'

interface DraftModelConfig {
  provider: string
  modelId: string
  thinkingLevel?: string
}

export interface TaskDraft {
  content: string
  selectedSkillIds: string[]
  selectedPreSkillIds: string[]
  planningModelConfig?: DraftModelConfig
  executionModelConfig?: DraftModelConfig
  /** Legacy single-model field (treated as execution model). */
  modelConfig?: DraftModelConfig
}

const EMPTY_DRAFT: TaskDraft = {
  content: '',
  selectedSkillIds: [...DEFAULT_POST_EXECUTION_SKILLS],
  selectedPreSkillIds: [...DEFAULT_PRE_EXECUTION_SKILLS],
  planningModelConfig: undefined,
  executionModelConfig: undefined,
  modelConfig: undefined,
}

function getStorageKey(workspaceId: string): string {
  return `${STORAGE_KEY_PREFIX}:${workspaceId}`
}

function loadDraft(storageKey: string): TaskDraft | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    // Basic validation: must have at least some content
    if (typeof parsed.content !== 'string') {
      return null
    }

    const legacyModelConfig = parsed.modelConfig || undefined
    const executionModelConfig = parsed.executionModelConfig || legacyModelConfig

    return {
      content: parsed.content || '',
      selectedSkillIds: Array.isArray(parsed.selectedSkillIds) ? parsed.selectedSkillIds : [],
      selectedPreSkillIds: Array.isArray(parsed.selectedPreSkillIds) ? parsed.selectedPreSkillIds : [],
      planningModelConfig: parsed.planningModelConfig || undefined,
      executionModelConfig,
      modelConfig: executionModelConfig,
    }
  } catch {
    return null
  }
}

function saveDraft(storageKey: string, draft: TaskDraft): void {
  try {
    // Only save if there's meaningful content
    const hasContent = draft.content.trim()
    if (!hasContent) {
      localStorage.removeItem(storageKey)
      return
    }

    localStorage.setItem(storageKey, JSON.stringify(draft))
  } catch {
    // localStorage might be full or unavailable — ignore
  }
}

function removeDraft(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey)
  } catch {
    // localStorage might be unavailable — ignore
  }
}

function hasRestorableContent(draft: TaskDraft | null): boolean {
  return draft !== null && draft.content.trim() !== ''
}

export function useLocalStorageDraft(workspaceId: string) {
  const storageKey = getStorageKey(workspaceId)
  const savedDraft = useMemo(() => loadDraft(storageKey), [storageKey])
  const initialDraft = savedDraft || EMPTY_DRAFT
  const hasSavedDraftContent = hasRestorableContent(savedDraft)

  const draftRef = useRef<TaskDraft>(initialDraft)
  const [restoredFromDraft, setRestoredFromDraft] = useState(hasSavedDraftContent)

  // Keep local refs/banner state aligned if workspace changes while mounted.
  useEffect(() => {
    draftRef.current = initialDraft
    setRestoredFromDraft(hasSavedDraftContent)
  }, [initialDraft, hasSavedDraftContent])

  const updateDraft = useCallback((partial: Partial<TaskDraft>) => {
    draftRef.current = { ...draftRef.current, ...partial }
    saveDraft(storageKey, draftRef.current)
  }, [storageKey])

  const clearDraft = useCallback(() => {
    draftRef.current = EMPTY_DRAFT
    removeDraft(storageKey)
    setRestoredFromDraft(false)
  }, [storageKey])

  const dismissRestoredBanner = useCallback(() => {
    setRestoredFromDraft(false)
  }, [])

  return {
    initialDraft,
    restoredFromDraft,
    updateDraft,
    clearDraft,
    dismissRestoredBanner,
  }
}
