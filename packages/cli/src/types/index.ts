// =============================================================================
// CLI Types
// =============================================================================

export interface ApiClientConfig {
  baseUrl: string;
}

export interface ActivityEntry {
  id: string;
  timestamp: string;
  type: 'chat-message' | 'system-event' | 'task-separator' | 'attachment' | 'phase-change';
  role?: 'user' | 'agent';
  content?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
  attachmentIds?: string[];
  fromPhase?: string;
  toPhase?: string;
}

export interface ConversationOptions {
  limit?: number;
  since?: string;
  follow?: boolean;
  export?: string;
  json?: boolean;
  compact?: boolean;
  only?: 'user' | 'agent' | 'all';
  search?: string;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
}

export interface ShelfDraft {
  id: string;
  content: string;
  createdAt: string;
}

export interface Idea {
  id: string;
  description: string;
  order: number;
}

export interface PlanningStatus {
  status: 'idle' | 'running' | 'completed' | 'error';
  messages: PlanningMessage[];
}

export interface PlanningMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
}

export interface QAPending {
  pending: boolean;
  questions?: QAQuestion[];
}

export interface QAQuestion {
  id: string;
  question: string;
  type: 'text' | 'choice';
  options?: string[];
}

export interface AutomationSettings {
  readyLimit: number;
  executingLimit: number;
  backlogToReady: boolean;
  readyToExecuting: boolean;
}

export interface TaskDefaults {
  model?: string;
  preExecutionSkills?: string[];
  postExecutionSkills?: string[];
}

export interface AuthProvider {
  id: string;
  name: string;
  hasCredential: boolean;
  type: 'api_key' | 'oauth';
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  hooks: string[];
}
