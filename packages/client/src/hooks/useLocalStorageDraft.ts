import { useState, useCallback, useRef } from 'react'
import { DEFAULT_PRE_EXECUTION_SKILLS, DEFAULT_POST_EXECUTION_SKILLS } from '@pi-factory/shared'

const STORAGE_KEY = 'pi-factory:create-task-draft'

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

function loadDraft(): TaskDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
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

function saveDraft(draft: TaskDraft): void {
  try {
    // Only save if there's meaningful content
    const hasContent = draft.content.trim()
    if (!hasContent) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // localStorage might be full or unavailable — ignore
  }
}

export function useLocalStorageDraft() {
  const savedDraft = loadDraft()
  const [restoredFromDraft, setRestoredFromDraft] = useState(
    () => savedDraft !== null && savedDraft.content.trim() !== ''
  )

  const initialDraft = savedDraft || EMPTY_DRAFT
  const draftRef = useRef<TaskDraft>(initialDraft)

  const updateDraft = useCallback((partial: Partial<TaskDraft>) => {
    draftRef.current = { ...draftRef.current, ...partial }
    saveDraft(draftRef.current)
  }, [])

  const clearDraft = useCallback(() => {
    draftRef.current = EMPTY_DRAFT
    localStorage.removeItem(STORAGE_KEY)
    setRestoredFromDraft(false)
  }, [])

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
