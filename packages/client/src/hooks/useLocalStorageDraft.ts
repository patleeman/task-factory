import { useState, useCallback, useRef } from 'react'

const STORAGE_KEY = 'pi-factory:create-task-draft'

export interface TaskDraft {
  content: string
  selectedSkillIds: string[]
  modelConfig?: {
    provider: string
    modelId: string
    thinkingLevel?: string
  }
}

const EMPTY_DRAFT: TaskDraft = {
  content: '',
  selectedSkillIds: [],
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
    return {
      content: parsed.content || '',
      selectedSkillIds: Array.isArray(parsed.selectedSkillIds) ? parsed.selectedSkillIds : [],
      modelConfig: parsed.modelConfig || undefined,
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
