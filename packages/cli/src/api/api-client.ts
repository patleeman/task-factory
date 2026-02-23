// =============================================================================
// ApiClient - HTTP client for Task Factory API
// =============================================================================

import type {
  ActivityEntry,
  Attachment,
  ShelfDraft,
  Idea,
  PlanningStatus,
  PlanningMessage,
  QAPending,
  AutomationSettings,
  TaskDefaults,
  AuthProvider,
  Skill,
} from '../types/index.js';

export class ApiClient {
  private baseUrl: string;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(baseUrl?: string, timeoutMs = 30000, maxRetries = 3) {
    this.baseUrl = baseUrl || this.getServerUrl();
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
  }

  private getServerUrl(): string {
    // In a real implementation, this would read from config
    const port = process.env.PORT || '3000';
    const host = process.env.HOST || '127.0.0.1';
    return `http://${host}:${port}`;
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw err;
    }
  }

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    retries: number
  ): Promise<T> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await operation();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        
        // Don't retry on client errors (4xx) except 429 (rate limit)
        const status = (err as Error & { status?: number }).status;
        if (status && status >= 400 && status < 500 && status !== 429) {
          throw err;
        }
        
        // Don't retry on the last attempt
        if (attempt === retries) {
          throw err;
        }
        
        // Exponential backoff: 2^attempt * 1000ms (1s, 2s, 4s)
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { noJson?: boolean }
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const fetchOptions: RequestInit = {
      method,
      headers: {},
    };

    if (body && !options?.noJson) {
      (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    } else if (body && options?.noJson) {
      // For FormData, let the browser set the Content-Type with boundary
      fetchOptions.body = body as globalThis.BodyInit;
    }

    return this.retryWithBackoff(async () => {
      try {
        const response = await this.fetchWithTimeout(url, fetchOptions, this.timeoutMs);
        
        // Handle rate limiting (429)
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
          await new Promise(resolve => setTimeout(resolve, delay));
          throw new Error('Rate limited'); // Will trigger retry
        }
        
        // Handle non-OK responses
        if (!response.ok) {
          const data = await response.json().catch(() => null) as { error?: string } | null;
          const errorMessage = data?.error || `HTTP ${response.status}`;
          const error = new Error(errorMessage);
          (error as Error & { status: number }).status = response.status;
          (error as Error & { data: unknown }).data = data;
          throw error;
        }

        // For DELETE or empty responses
        if (response.status === 204) {
          return undefined as T;
        }

        // Try to parse JSON
        const data = await response.json().catch(() => null) as T;
        return data;
      } catch (err) {
        // Re-throw API errors
        if (err instanceof Error && 'status' in err) {
          throw err;
        }
        // Wrap network errors
        throw new Error(
          `Cannot connect to Task Factory server at ${this.baseUrl}. Is the daemon running?`
        );
      }
    }, this.maxRetries);
  }

  // ==========================================================================
  // Health
  // ==========================================================================
  async health(): Promise<{ status: string; timestamp: string }> {
    return this.request('GET', '/api/health');
  }

  // ==========================================================================
  // Workspaces
  // ==========================================================================
  async listWorkspaces(): Promise<Array<{ id: string; name: string; path: string; createdAt: string }>> {
    return this.request('GET', '/api/workspaces');
  }

  async getWorkspace(id: string): Promise<{ id: string; name: string; path: string; createdAt: string }> {
    return this.request('GET', `/api/workspaces/${encodeURIComponent(id)}`);
  }

  async createWorkspace(
    path: string,
    name: string,
    config?: Record<string, unknown>
  ): Promise<{ id: string; name: string; path: string }> {
    return this.request('POST', '/api/workspaces', { path, name, config });
  }

  async deleteWorkspace(id: string): Promise<void> {
    return this.request('DELETE', `/api/workspaces/${encodeURIComponent(id)}`);
  }

  // ==========================================================================
  // Tasks (existing methods)
  // ==========================================================================
  async listTasks(
    workspaceId: string,
    scope = 'active'
  ): Promise<Array<{ id: string; frontmatter: Record<string, unknown>; content?: string }>> {
    return this.request('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks?scope=${scope}`);
  }

  async getTask(workspaceId: string, taskId: string): Promise<{ id: string; frontmatter: Record<string, unknown>; content?: string }> {
    return this.request('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}`);
  }

  async createTask(
    workspaceId: string,
    request: Record<string, unknown>
  ): Promise<{ id: string; frontmatter: Record<string, unknown> }> {
    return this.request('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks`, request);
  }

  // ==========================================================================
  // Phase 1: Core Task Management
  // ==========================================================================
  async updateTask(
    workspaceId: string,
    taskId: string,
    request: Record<string, unknown>
  ): Promise<{ id: string; frontmatter: Record<string, unknown> }> {
    return this.request('PATCH', `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}`, request);
  }

  async reorderTasks(
    workspaceId: string,
    phase: string,
    taskIds: string[]
  ): Promise<{ success: boolean; count: number }> {
    return this.request('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/reorder`, {
      phase,
      taskIds,
    });
  }

  async regeneratePlan(workspaceId: string, taskId: string): Promise<{ success: boolean }> {
    return this.request('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/plan/regenerate`);
  }

  async regenerateAcceptanceCriteria(
    workspaceId: string,
    taskId: string
  ): Promise<{ acceptanceCriteria: string[] }> {
    return this.request(
      'POST',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/acceptance-criteria/regenerate`
    );
  }

  async updateAcceptanceCriteria(
    workspaceId: string,
    taskId: string,
    index: number,
    status: string
  ): Promise<{ success: boolean }> {
    return this.request(
      'PATCH',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/summary/criteria/${index}`,
      { status }
    );
  }

  async moveTask(
    workspaceId: string,
    taskId: string,
    toPhase: string,
    reason?: string
  ): Promise<{ id: string; frontmatter: Record<string, unknown> }> {
    return this.request(
      'POST',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/move`,
      { toPhase, reason }
    );
  }

  async deleteTask(workspaceId: string, taskId: string): Promise<void> {
    return this.request('DELETE', `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}`);
  }

  async executeTask(workspaceId: string, taskId: string): Promise<void> {
    return this.request('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/execute`);
  }

  async stopTask(workspaceId: string, taskId: string): Promise<void> {
    return this.request('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/stop`);
  }

  // ==========================================================================
  // Phase 2: Activity & Messaging
  // ==========================================================================
  async getWorkspaceActivity(workspaceId: string, limit = 100): Promise<ActivityEntry[]> {
    return this.request('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}/activity?limit=${limit}`);
  }

  async getTaskActivity(workspaceId: string, taskId: string, limit = 50): Promise<ActivityEntry[]> {
    return this.request(
      'GET',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/activity?limit=${limit}`
    );
  }

  async getTaskConversation(workspaceId: string, taskId: string, limit = 100): Promise<ActivityEntry[]> {
    // This returns activity entries filtered to conversation
    return this.request(
      'GET',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/activity?limit=${limit}`
    );
  }

  async sendMessage(
    workspaceId: string,
    taskId: string,
    content: string,
    role: 'user' | 'agent',
    attachmentIds?: string[]
  ): Promise<ActivityEntry> {
    const metadata = attachmentIds ? { attachmentIds } : undefined;
    return this.request('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/activity`, {
      taskId,
      content,
      role,
      metadata,
    });
  }

  async steerTask(workspaceId: string, taskId: string, instruction: string): Promise<{ success: boolean }> {
    return this.request(
      'POST',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/steer`,
      { instruction }
    );
  }

  async followUpTask(workspaceId: string, taskId: string, message: string): Promise<{ success: boolean }> {
    return this.request(
      'POST',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/follow-up`,
      { message }
    );
  }

  // ==========================================================================
  // Phase 3: Attachment Management
  // ==========================================================================
  async listAttachments(workspaceId: string, taskId: string): Promise<Attachment[]> {
    return this.request(
      'GET',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/attachments`
    );
  }

  async uploadAttachment(workspaceId: string, taskId: string, file: File): Promise<Attachment> {
    const formData = new FormData();
    formData.append('file', file);
    return this.request(
      'POST',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/attachments`,
      formData,
      { noJson: true }
    );
  }

  async downloadAttachment(workspaceId: string, taskId: string, attachmentId: string): Promise<Blob> {
    const url = `${this.baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}`;
    
    return this.retryWithBackoff(async () => {
      const response = await this.fetchWithTimeout(url, {}, this.timeoutMs);
      
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
        await new Promise(resolve => setTimeout(resolve, delay));
        throw new Error('Rate limited');
      }
      
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        (error as Error & { status: number }).status = response.status;
        throw error;
      }
      
      // Validate content type if provided
      const contentType = response.headers.get('Content-Type');
      if (contentType && !this.isValidContentType(contentType)) {
        throw new Error(`Invalid content type: ${contentType}`);
      }
      
      return response.blob();
    }, this.maxRetries);
  }
  
  private isValidContentType(contentType: string): boolean {
    // Allow common safe content types
    const allowedTypes = [
      'text/',
      'application/json',
      'application/pdf',
      'image/',
      'audio/',
      'video/',
      'application/octet-stream',
      'multipart/form-data',
    ];
    return allowedTypes.some(type => contentType.includes(type));
  }

  async deleteAttachment(workspaceId: string, taskId: string, attachmentId: string): Promise<{ success: boolean }> {
    return this.request(
      'DELETE',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}`
    );
  }

  // ==========================================================================
  // Phase 4: Planning Session Management
  // ==========================================================================
  async getPlanningStatus(workspaceId: string): Promise<PlanningStatus> {
    return this.request('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}/planning/status`);
  }

  async getPlanningMessages(workspaceId: string): Promise<PlanningMessage[]> {
    return this.request('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}/planning/messages`);
  }

  async sendPlanningMessage(workspaceId: string, content: string): Promise<{ success: boolean }> {
    return this.request('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/planning/message`, { content });
  }

  async stopPlanning(workspaceId: string): Promise<{ success: boolean }> {
    return this.request('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/planning/stop`);
  }

  async resetPlanning(workspaceId: string): Promise<{ success: boolean }> {
    return this.request('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/planning/reset`);
  }

  async getPendingQA(workspaceId: string): Promise<QAPending> {
    return this.request('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}/qa/pending`);
  }

  async respondToQA(workspaceId: string, answers: string[]): Promise<{ success: boolean }> {
    return this.request('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/qa/respond`, { answers });
  }

  async abortQA(workspaceId: string): Promise<{ success: boolean }> {
    return this.request('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/qa/abort`);
  }

  // ==========================================================================
  // Phase 5: Shelf & Idea Backlog
  // ==========================================================================
  async getShelf(workspaceId: string): Promise<ShelfDraft[]> {
    return this.request('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}/shelf`);
  }

  async pushDraftToTask(
    workspaceId: string,
    draftId: string
  ): Promise<{ id: string; frontmatter: Record<string, unknown> }> {
    return this.request(
      'POST',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/shelf/drafts/${encodeURIComponent(draftId)}/push`
    );
  }

  async updateDraft(workspaceId: string, draftId: string, content: string): Promise<ShelfDraft> {
    return this.request(
      'PATCH',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/shelf/drafts/${encodeURIComponent(draftId)}`,
      { content }
    );
  }

  async removeShelfItem(workspaceId: string, itemId: string): Promise<{ success: boolean }> {
    return this.request(
      'DELETE',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/shelf/items/${encodeURIComponent(itemId)}`
    );
  }

  async clearShelf(workspaceId: string): Promise<{ success: boolean; count: number }> {
    return this.request('DELETE', `/api/workspaces/${encodeURIComponent(workspaceId)}/shelf`);
  }

  async listIdeas(workspaceId: string): Promise<Idea[]> {
    return this.request('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}/idea-backlog`);
  }

  async addIdea(workspaceId: string, description: string): Promise<Idea> {
    return this.request('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/idea-backlog/items`, {
      description,
    });
  }

  async updateIdea(workspaceId: string, ideaId: string, description: string): Promise<Idea> {
    return this.request(
      'PATCH',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/idea-backlog/items/${encodeURIComponent(ideaId)}`,
      { description }
    );
  }

  async deleteIdea(workspaceId: string, ideaId: string): Promise<{ success: boolean }> {
    return this.request(
      'DELETE',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/idea-backlog/items/${encodeURIComponent(ideaId)}`
    );
  }

  async reorderIdeas(workspaceId: string, order: string[]): Promise<{ success: boolean }> {
    return this.request('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/idea-backlog/reorder`, { order });
  }

  // ==========================================================================
  // Phase 6: Workspace Configuration
  // ==========================================================================
  async getWorkspaceConfig(workspaceId: string): Promise<{ id: string; name: string; path: string; config?: Record<string, unknown> }> {
    return this.request('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}`);
  }

  async setWorkspaceConfig(workspaceId: string, config: Record<string, unknown>): Promise<{ success: boolean }> {
    return this.request('PATCH', `/api/workspaces/${encodeURIComponent(workspaceId)}/config`, config);
  }

  async openWorkspaceInExplorer(workspaceId: string): Promise<{ success: boolean; path: string }> {
    return this.request(
      'POST',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/archive/open-in-explorer`
    );
  }

  async getWorkspaceAttention(): Promise<
    Array<{ workspaceId: string; needsAttention: boolean; executingCount: number }>
  > {
    return this.request('GET', '/api/workspaces/attention');
  }

  async getSharedContext(workspaceId: string): Promise<{ content: string }> {
    return this.request('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}/shared-context`);
  }

  async setSharedContext(workspaceId: string, content: string): Promise<{ success: boolean }> {
    return this.request('PUT', `/api/workspaces/${encodeURIComponent(workspaceId)}/shared-context`, { content });
  }

  // ==========================================================================
  // Phase 7: Pi/Agent Configuration
  // ==========================================================================
  async getGlobalSettings(): Promise<Record<string, unknown>> {
    return this.request('GET', '/api/settings');
  }

  async setGlobalSettings(settings: Record<string, unknown>): Promise<{ success: boolean }> {
    return this.request('POST', '/api/settings', settings);
  }

  async getPiSettings(): Promise<Record<string, unknown>> {
    return this.request('GET', '/api/pi/settings');
  }

  async getPiModels(): Promise<Record<string, unknown>> {
    return this.request('GET', '/api/pi/models');
  }

  async getTaskDefaults(): Promise<TaskDefaults> {
    return this.request('GET', '/api/task-defaults');
  }

  async setTaskDefaults(defaults: TaskDefaults): Promise<TaskDefaults> {
    return this.request('POST', '/api/task-defaults', defaults);
  }

  async getWorkspaceTaskDefaults(workspaceId: string): Promise<TaskDefaults> {
    return this.request('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}/task-defaults`);
  }

  async setWorkspaceTaskDefaults(workspaceId: string, defaults: TaskDefaults): Promise<TaskDefaults> {
    return this.request('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/task-defaults`, defaults);
  }

  async getAuthStatus(): Promise<{ providers: AuthProvider[] }> {
    return this.request('GET', '/api/pi/auth');
  }

  async setProviderApiKey(provider: string, apiKey: string): Promise<AuthProvider> {
    return this.request('PUT', `/api/pi/auth/providers/${encodeURIComponent(provider)}/api-key`, { apiKey });
  }

  async clearProviderCredential(provider: string): Promise<AuthProvider> {
    return this.request('DELETE', `/api/pi/auth/providers/${encodeURIComponent(provider)}`);
  }

  // ==========================================================================
  // Phase 8: Workflow Automation
  // ==========================================================================
  async getAutomationSettings(workspaceId: string): Promise<AutomationSettings> {
    return this.request('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}/automation`);
  }

  async setAutomationSettings(
    workspaceId: string,
    settings: Partial<AutomationSettings>
  ): Promise<AutomationSettings & { success: boolean }> {
    return this.request('PATCH', `/api/workspaces/${encodeURIComponent(workspaceId)}/automation`, settings);
  }

  // ==========================================================================
  // Phase 9: Extensions & Skills
  // ==========================================================================
  async listExtensions(factory = false): Promise<Array<{ name: string; path: string }>> {
    const endpoint = factory ? '/api/factory/extensions' : '/api/pi/extensions';
    return this.request('GET', endpoint);
  }

  async reloadExtensions(): Promise<{ count: number; paths: string[] }> {
    return this.request('POST', '/api/factory/extensions/reload');
  }

  async listSkills(): Promise<Skill[]> {
    return this.request('GET', '/api/pi/skills');
  }

  async getSkill(skillId: string): Promise<Skill> {
    return this.request('GET', `/api/pi/skills/${encodeURIComponent(skillId)}`);
  }

  async listFactorySkills(): Promise<Skill[]> {
    return this.request('GET', '/api/factory/skills');
  }

  async reloadFactorySkills(): Promise<{ count: number; skills: string[] }> {
    return this.request('POST', '/api/factory/skills/reload');
  }

  // ==========================================================================
  // Queue Management
  // ==========================================================================
  async getQueueStatus(workspaceId: string): Promise<{ status: string; running: boolean }> {
    return this.request('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}/queue/status`);
  }

  async startQueue(workspaceId: string): Promise<void> {
    return this.request('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/queue/start`);
  }

  async stopQueue(workspaceId: string): Promise<void> {
    return this.request('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/queue/stop`);
  }
}
