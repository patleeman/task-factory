import type { Task, Workspace, ActivityEntry, Phase, Attachment, QueueStatus } from '@pi-factory/shared'

export interface AvailableModel {
  provider: string
  id: string
  name: string
  reasoning: boolean
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

  async regenerateCriteria(workspaceId: string, taskId: string): Promise<string[]> {
    const res = await fetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/regenerate-criteria`, {
      method: 'POST',
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Regeneration failed' }))
      throw new Error(err.error || `Regeneration failed (${res.status})`)
    }
    const data = await res.json()
    return data.criteria
  },

  async getAvailableModels(): Promise<AvailableModel[]> {
    const res = await fetch('/api/pi/available-models')
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
}
