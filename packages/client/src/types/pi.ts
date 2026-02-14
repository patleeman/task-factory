// Pi Integration Types

export interface PiSettings {
  lastChangelogVersion?: string;
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  theme?: string;
  [key: string]: any;
}

export interface PiModel {
  id: string;
  name: string;
  provider: string;
  capabilities?: string[];
  [key: string]: any;
}

export interface PiModelsConfig {
  providers: Record<string, {
    name: string;
    models: PiModel[];
  }>;
}

export interface PiExtension {
  id: string;
  name: string;
  version: string;
  description?: string;
  entryPoint?: string;
  slots?: ('header' | 'footer' | 'task-panel' | 'activity-log')[];
  path: string;
}

export interface PiSkill {
  id: string;
  name: string;
  description: string;
  allowedTools: string[];
  content: string;
  path: string;
}

export interface PiTheme {
  id: string;
  name: string;
  path: string;
}

export interface AgentContext {
  globalRules: string;
  settings: PiSettings;
  availableSkills: PiSkill[];
  activeExtensions: PiExtension[];
}

export interface SkillConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  default: string;
  description: string;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    options?: string[];
  };
}

export type SkillHook = 'pre' | 'post'
export type SkillSource = 'starter' | 'user'

export interface PostExecutionSkill {
  id: string;
  name: string;
  description: string;
  type: 'follow-up' | 'loop';
  hooks: SkillHook[];
  workflowId?: string;
  pairedSkillId?: string;
  maxIterations: number;
  doneSignal: string;
  promptTemplate: string;
  path: string;
  source: SkillSource;
  metadata: Record<string, string>;
  configSchema: SkillConfigField[];
}
