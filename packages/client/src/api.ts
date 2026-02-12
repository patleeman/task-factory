import type { Task, Workspace, ActivityEntry, Phase, Attachment, QueueStatus, PlanningMessage, PlanningAgentStatus, Shelf, DraftTask, TaskDefaults, PostExecutionSummary, CriterionStatus, QAAnswer } from '@pi-factory/shared'

export interface AvailableModel {
  provider: string
  id: string
  name: string
  reasoning: boolean
}

export interface ExecutionSnapshot {
  taskId: string
  workspaceId: string
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error'
  startTime: string
  endTime?: string
  isRunning: boolean
}

export type PiProviderAuthState = 'none' | 'api_key' | 'oauth' | 'external'

export interface PiAuthProviderOverview {
  id: string
  authState: PiProviderAuthState
  hasStoredCredential: boolean
  supportsOAuth: boolean
  oauthProviderName?: string
  usesCallbackServer: boolean
}

export interface PiOAuthProviderOverview {
  id: string
  name: string
  usesCallbackServer: boolean
  loggedIn: boolean
}

export interface PiAuthOverview {
  providers: PiAuthProviderOverview[]
  oauthProviders: PiOAuthProviderOverview[]
}

export type PiOAuthLoginStatus = 'running' | 'awaiting_input' | 'succeeded' | 'failed' | 'cancelled'

export interface PiOAuthLoginInputRequest {
  id: string
  type: 'prompt' | 'manual-code'
  message: string
  placeholder?: string
  allowEmpty?: boolean
}

export interface PiOAuthLoginSession {
  id: string
  providerId: string
  providerName: string
  status: PiOAuthLoginStatus
  startedAt: string
  updatedAt: string
  authUrl?: string
  authInstructions?: string
  progressMessages: string[]
  inputRequest?: PiOAuthLoginInputRequest
  error?: string
}

export const api = {
  async getWorkspaces(): Promise<Workspace[]> {
    const res = await fetch('/api/workspaces')
    return res.json()
  },
  async getWorkspace(id: string): Promise<Workspace> {
    const res = await fetch(`/api/workspaces/${id}`)
    return res.json()
  },
  async createWorkspace(path: string): Promise<Workspace> {
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Create failed' }))
      throw new Error(err.error || `Create failed (${res.status})`)
    }
    return res.json()
  },
  async deleteWorkspace(id: string): Promise<void> {
    const res = await fetch(`/api/workspaces/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Delete failed' }))
      throw new Error(err.error || `Delete failed (${res.status})`)
    }
  },
  async getTasks(workspaceId: string): Promise<Task[]> {
    const res = await fetch(`/api/workspaces/${workspaceId}/tasks`)
    return res.json()
  },
  async getActivity(workspaceId: string, limit = 100): Promise<ActivityEntry[]> {
    const res = await fetch(`/api/workspaces/${workspaceId}/activity?limit=${limit}`)
    return res.json()
  },
  async getTaskActivity(workspaceId: string, taskId: string, limit = 200): Promise<ActivityEntry[]> {
    const res = await fetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/activity?limit=${limit}`)
    return res.json()
  },
  async createTask(workspaceId: string, data: any): Promise<Task> {
    const res = await fetch(`/api/workspaces/${workspaceId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Create failed' }))
      throw new Error(err.error || `Create failed (${res.status})`)
    }
    return res.json()
  },
  async regenerateTaskPlan(workspaceId: string, taskId: string): Promise<void> {
    const res = await fetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/plan/regenerate`, {
      method: 'POST',
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Plan regeneration failed' }))
      throw new Error(err.error || `Plan regeneration failed (${res.status})`)
    }
  },
  async reorderTasks(workspaceId: string, phase: Phase, taskIds: string[]): Promise<void> {
    const res = await fetch(`/api/workspaces/${workspaceId}/tasks/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase, taskIds }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Reorder failed' }))
      throw new Error(err.error || `Reorder failed (${res.status})`)
    }
  },
  async moveTask(workspaceId: string, taskId: string, toPhase: Phase, reason?: string): Promise<Task> {
    const res = await fetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toPhase, reason }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Move failed' }))
      throw new Error(err.error || `Move failed (${res.status})`)
    }
    return res.json()
  },
  async sendMessage(workspaceId: string, taskId: string, content: string, role: 'user' | 'agent', attachmentIds?: string[]): Promise<ActivityEntry> {
    const metadata = attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : undefined
    const res = await fetch(`/api/workspaces/${workspaceId}/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, content, role, metadata }),
    })
    return res.json()
  },

  async uploadAttachments(workspaceId: string, taskId: string, files: File[]): Promise<Attachment[]> {
    const formData = new FormData()
    for (const file of files) {
      formData.append('files', file)
    }
    const res = await fetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/attachments`, {
      method: 'POST',
      body: formData,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }))
      throw new Error(err.error || `Upload failed (${res.status})`)
    }
    return res.json()
  },

  async deleteAttachment(workspaceId: string, taskId: string, attachmentId: string): Promise<void> {
    const res = await fetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/attachments/${attachmentId}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Delete failed' }))
      throw new Error(err.error || `Delete failed (${res.status})`)
    }
  },

  getAttachmentUrl(workspaceId: string, taskId: string, storedName: string): string {
    return `/api/workspaces/${workspaceId}/tasks/${taskId}/attachments/${storedName}`
  },

  async getAvailableModels(): Promise<AvailableModel[]> {
    const res = await fetch('/api/pi/available-models')
    return res.json()
  },

  async getPiAuthOverview(): Promise<PiAuthOverview> {
    const res = await fetch('/api/pi/auth')
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to load auth settings' }))
      throw new Error(err.error || `Failed to load auth settings (${res.status})`)
    }
    return res.json()
  },

  async saveProviderApiKey(providerId: string, apiKey: string): Promise<PiAuthProviderOverview> {
    const res = await fetch(`/api/pi/auth/providers/${encodeURIComponent(providerId)}/api-key`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to save API key' }))
      throw new Error(err.error || `Failed to save API key (${res.status})`)
    }

    return res.json()
  },

  async clearProviderCredential(providerId: string): Promise<PiAuthProviderOverview> {
    const res = await fetch(`/api/pi/auth/providers/${encodeURIComponent(providerId)}`, {
      method: 'DELETE',
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to clear credential' }))
      throw new Error(err.error || `Failed to clear credential (${res.status})`)
    }

    return res.json()
  },

  async startOAuthLogin(providerId: string): Promise<PiOAuthLoginSession> {
    const res = await fetch('/api/pi/auth/login/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to start login flow' }))
      throw new Error(err.error || `Failed to start login flow (${res.status})`)
    }

    return res.json()
  },

  async getOAuthLoginSession(sessionId: string): Promise<PiOAuthLoginSession> {
    const res = await fetch(`/api/pi/auth/login/${encodeURIComponent(sessionId)}`)

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to read login session' }))
      throw new Error(err.error || `Failed to read login session (${res.status})`)
    }

    return res.json()
  },

  async submitOAuthLoginInput(sessionId: string, requestId: string, value: string): Promise<PiOAuthLoginSession> {
    const res = await fetch(`/api/pi/auth/login/${encodeURIComponent(sessionId)}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, value }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to submit login input' }))
      throw new Error(err.error || `Failed to submit login input (${res.status})`)
    }

    return res.json()
  },

  async cancelOAuthLogin(sessionId: string): Promise<PiOAuthLoginSession> {
    const res = await fetch(`/api/pi/auth/login/${encodeURIComponent(sessionId)}/cancel`, {
      method: 'POST',
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to cancel login flow' }))
      throw new Error(err.error || `Failed to cancel login flow (${res.status})`)
    }

    return res.json()
  },

  async getTaskDefaults(): Promise<TaskDefaults> {
    const res = await fetch('/api/task-defaults')
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to load task defaults' }))
      throw new Error(err.error || `Failed to load task defaults (${res.status})`)
    }
    return res.json()
  },

  async saveTaskDefaults(defaults: TaskDefaults): Promise<TaskDefaults> {
    const res = await fetch('/api/task-defaults', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(defaults),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to save task defaults' }))
      throw new Error(err.error || `Failed to save task defaults (${res.status})`)
    }
    return res.json()
  },

  async getQueueStatus(workspaceId: string): Promise<QueueStatus> {
    const res = await fetch(`/api/workspaces/${workspaceId}/queue/status`)
    return res.json()
  },

  async startQueue(workspaceId: string): Promise<QueueStatus> {
    const res = await fetch(`/api/workspaces/${workspaceId}/queue/start`, { method: 'POST' })
    return res.json()
  },

  async stopQueue(workspaceId: string): Promise<QueueStatus> {
    const res = await fetch(`/api/workspaces/${workspaceId}/queue/stop`, { method: 'POST' })
    return res.json()
  },

  async getActiveExecutions(workspaceId: string): Promise<ExecutionSnapshot[]> {
    const res = await fetch(`/api/workspaces/${workspaceId}/executions`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to load active executions' }))
      throw new Error(err.error || `Failed to load active executions (${res.status})`)
    }
    const data = await res.json()
    return Array.isArray(data) ? data : []
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Planning Agent
  // ─────────────────────────────────────────────────────────────────────────

  async sendPlanningMessage(workspaceId: string, content: string, attachmentIds?: string[]): Promise<void> {
    const res = await fetch(`/api/workspaces/${workspaceId}/planning/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, attachmentIds }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Send failed' }))
      throw new Error(err.error || `Send failed (${res.status})`)
    }
  },

  async uploadPlanningAttachments(workspaceId: string, files: File[]): Promise<Attachment[]> {
    const formData = new FormData()
    for (const file of files) {
      formData.append('files', file)
    }
    const res = await fetch(`/api/workspaces/${workspaceId}/planning/attachments`, {
      method: 'POST',
      body: formData,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }))
      throw new Error(err.error || `Upload failed (${res.status})`)
    }
    return res.json()
  },

  getPlanningAttachmentUrl(workspaceId: string, storedName: string): string {
    return `/api/workspaces/${workspaceId}/planning/attachments/${storedName}`
  },

  async getPlanningMessages(workspaceId: string): Promise<PlanningMessage[]> {
    const res = await fetch(`/api/workspaces/${workspaceId}/planning/messages`)
    return res.json()
  },

  async getPlanningStatus(workspaceId: string): Promise<PlanningAgentStatus> {
    const res = await fetch(`/api/workspaces/${workspaceId}/planning/status`)
    const data = await res.json()
    return data.status
  },

  async resetPlanningSession(workspaceId: string): Promise<void> {
    await fetch(`/api/workspaces/${workspaceId}/planning/reset`, { method: 'POST' })
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Shelf
  // ─────────────────────────────────────────────────────────────────────────

  async getShelf(workspaceId: string): Promise<Shelf> {
    const res = await fetch(`/api/workspaces/${workspaceId}/shelf`)
    return res.json()
  },

  async updateDraftTask(workspaceId: string, draftId: string, updates: Partial<DraftTask>): Promise<Shelf> {
    const res = await fetch(`/api/workspaces/${workspaceId}/shelf/drafts/${draftId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    return res.json()
  },

  async removeShelfItem(workspaceId: string, itemId: string): Promise<Shelf> {
    const res = await fetch(`/api/workspaces/${workspaceId}/shelf/items/${itemId}`, {
      method: 'DELETE',
    })
    return res.json()
  },

  async pushDraftToBacklog(workspaceId: string, draftId: string): Promise<Task> {
    const res = await fetch(`/api/workspaces/${workspaceId}/shelf/drafts/${draftId}/push`, {
      method: 'POST',
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Push failed' }))
      throw new Error(err.error || `Push failed (${res.status})`)
    }
    return res.json()
  },

  async pushAllDraftsToBacklog(workspaceId: string): Promise<{ tasks: Task[]; count: number }> {
    const res = await fetch(`/api/workspaces/${workspaceId}/shelf/push-all`, {
      method: 'POST',
    })
    return res.json()
  },

  async clearShelf(workspaceId: string): Promise<Shelf> {
    const res = await fetch(`/api/workspaces/${workspaceId}/shelf`, {
      method: 'DELETE',
    })
    return res.json()
  },

  // ─────────────────────────────────────────────────────────────────────────
  // New Task Form (planning agent integration)
  // ─────────────────────────────────────────────────────────────────────────

  async openTaskForm(workspaceId: string, formState: any): Promise<void> {
    await fetch(`/api/workspaces/${workspaceId}/task-form/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formState),
    })
  },

  async closeTaskForm(workspaceId: string): Promise<void> {
    await fetch(`/api/workspaces/${workspaceId}/task-form/close`, {
      method: 'POST',
    })
  },

  async syncTaskForm(workspaceId: string, updates: any): Promise<void> {
    await fetch(`/api/workspaces/${workspaceId}/task-form`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Post-Execution Summary
  // ─────────────────────────────────────────────────────────────────────────

  async getSummary(workspaceId: string, taskId: string): Promise<PostExecutionSummary | null> {
    const res = await fetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/summary`)
    if (res.status === 404) return null
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to fetch summary' }))
      throw new Error(err.error || `Failed (${res.status})`)
    }
    return res.json()
  },

  async generateSummary(workspaceId: string, taskId: string): Promise<PostExecutionSummary> {
    const res = await fetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/summary/generate`, {
      method: 'POST',
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to generate summary' }))
      throw new Error(err.error || `Failed (${res.status})`)
    }
    return res.json()
  },

  async updateCriterionStatus(
    workspaceId: string,
    taskId: string,
    index: number,
    status: CriterionStatus,
    evidence?: string,
  ): Promise<PostExecutionSummary> {
    const res = await fetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/summary/criteria/${index}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, evidence: evidence || '' }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update criterion' }))
      throw new Error(err.error || `Failed (${res.status})`)
    }
    return res.json()
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Q&A Disambiguation
  // ─────────────────────────────────────────────────────────────────────────

  async submitQAResponse(workspaceId: string, requestId: string, answers: QAAnswer[]): Promise<void> {
    const res = await fetch(`/api/workspaces/${workspaceId}/qa/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, answers }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Submit failed' }))
      throw new Error(err.error || `Submit failed (${res.status})`)
    }
  },

  async abortQA(workspaceId: string, requestId: string): Promise<void> {
    const res = await fetch(`/api/workspaces/${workspaceId}/qa/abort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Abort failed' }))
      throw new Error(err.error || `Abort failed (${res.status})`)
    }
  },
}
