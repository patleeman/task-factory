// =============================================================================
// Pi Integration Service
// =============================================================================
// Integrates with Pi agent configuration, settings, extensions, and skills

import {
  readFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
} from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { TaskDefaults, PlanningGuardrails, WorkflowDefaultsConfig, ForemanSettings } from '@task-factory/shared';
import {
  getTaskFactoryAgentDir,
  getTaskFactoryGlobalExtensionsDir,
  getTaskFactoryHomeDir,
  getTaskFactoryPiSkillsDir,
} from './taskfactory-home.js';
import {
  loadWorkspaceConfigFromDiskSync,
  resolveWorkspaceArtifactRoot,
} from './workspace-storage.js';

const LEGACY_PI_AGENT_DIR = join(homedir(), '.pi', 'agent');
const TASK_FACTORY_AGENT_DIR = getTaskFactoryAgentDir();
const PI_FACTORY_DIR = getTaskFactoryHomeDir();

function getLegacyPiAgentPath(...segments: string[]): string {
  return join(LEGACY_PI_AGENT_DIR, ...segments);
}

function getTaskFactoryPiAgentPath(...segments: string[]): string {
  return join(TASK_FACTORY_AGENT_DIR, ...segments);
}

function getPreferredExistingPath(primaryPath: string, legacyPath: string): string | null {
  if (existsSync(primaryPath)) {
    return primaryPath;
  }

  if (existsSync(legacyPath)) {
    return legacyPath;
  }

  return null;
}

function resolveReadablePiAgentPath(...segments: string[]): string | null {
  return getPreferredExistingPath(
    getTaskFactoryPiAgentPath(...segments),
    getLegacyPiAgentPath(...segments),
  );
}

function resolveReadablePiSkillsDir(): string | null {
  const path = getTaskFactoryPiSkillsDir();
  return existsSync(path) ? path : null;
}

function resolveReadablePiExtensionsDir(): string | null {
  const path = getTaskFactoryGlobalExtensionsDir();
  return existsSync(path) ? path : null;
}

// =============================================================================
// Task Factory settings
// =============================================================================

export interface PiFactorySettings {
  // Task Factory specific settings
  defaultWorkspace?: string;
  theme?: string;
  voiceInputHotkey?: string;
  // Task creation defaults
  taskDefaults?: TaskDefaults;
  // Planning run guardrails
  planningGuardrails?: Partial<PlanningGuardrails>;
  // Global workflow defaults (slots + automation)
  workflowDefaults?: WorkflowDefaultsConfig;
  // Skill configuration
  skills?: {
    enabled: string[];
    config: Record<string, any>;
  };
  // Extension configuration
  extensions?: {
    enabled: string[];
    config: Record<string, any>;
  };
}

export interface PiSettings {
  lastChangelogVersion?: string;
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  theme?: string;
  [key: string]: any;
}

export interface MergedSettings extends PiSettings, PiFactorySettings {}

export function loadPiFactorySettings(): PiFactorySettings | null {
  const settingsPath = join(PI_FACTORY_DIR, 'settings.json');
  
  if (!existsSync(settingsPath)) {
    return null;
  }

  try {
    const content = readFileSync(settingsPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Failed to load Task Factory settings:', err);
    return null;
  }
}

export function savePiFactorySettings(settings: PiFactorySettings): void {
  const settingsPath = join(PI_FACTORY_DIR, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

export function loadPiSettings(): PiSettings | null {
  const settingsPath = resolveReadablePiAgentPath('settings.json');

  if (!settingsPath) {
    return null;
  }

  try {
    const content = readFileSync(settingsPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Failed to load Pi settings:', err);
    return null;
  }
}

export function loadMergedSettings(): MergedSettings {
  const piSettings = loadPiSettings() || {};
  const factorySettings = loadPiFactorySettings() || {};
  
  return {
    ...piSettings,
    ...factorySettings,
    // Pi settings take precedence for these fields
    defaultProvider: piSettings.defaultProvider,
    defaultModel: piSettings.defaultModel,
    defaultThinkingLevel: piSettings.defaultThinkingLevel,
  };
}

// =============================================================================
// Models
// =============================================================================

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

export function loadPiModels(): PiModelsConfig | null {
  const modelsPath = resolveReadablePiAgentPath('models.json');

  if (!modelsPath) {
    return null;
  }

  try {
    const content = readFileSync(modelsPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Failed to load Pi models:', err);
    return null;
  }
}

// =============================================================================
// Extensions
// =============================================================================

export interface PiExtension {
  id: string;
  name: string;
  version: string;
  description?: string;
  entryPoint?: string;
  slots?: ('header' | 'footer' | 'task-panel' | 'activity-log')[];
  path: string;
}

export function discoverPiExtensions(): PiExtension[] {
  const extensionsDir = resolveReadablePiExtensionsDir();

  if (!extensionsDir) {
    return [];
  }

  const extensions: PiExtension[] = [];
  const entries = readdirSync(extensionsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const extPath = join(extensionsDir, entry.name);
    const packagePath = join(extPath, 'package.json');

    if (!existsSync(packagePath)) continue;

    try {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
      
      extensions.push({
        id: entry.name,
        name: pkg.name || entry.name,
        version: pkg.version || '0.0.0',
        description: pkg.description,
        entryPoint: pkg.main,
        slots: pkg.pi?.slots || [],
        path: extPath,
      });
    } catch (err) {
      console.error(`Failed to load extension ${entry.name}:`, err);
    }
  }

  return extensions;
}

// =============================================================================
// Skills
// =============================================================================

export interface PiSkill {
  id: string;
  name: string;
  description: string;
  allowedTools: string[];
  content: string; // Full SKILL.md content
  path: string;
}

export function discoverPiSkills(): PiSkill[] {
  const skillsDir = resolveReadablePiSkillsDir();

  if (!skillsDir) {
    return [];
  }

  const skills: PiSkill[] = [];
  const entries = readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillPath = join(skillsDir, entry.name);
    const skillMdPath = join(skillPath, 'SKILL.md');

    if (!existsSync(skillMdPath)) continue;

    try {
      const content = readFileSync(skillMdPath, 'utf-8');
      
      // Parse frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      
      if (frontmatterMatch) {
        const [, yamlContent, bodyContent] = frontmatterMatch;
        
        // Simple YAML parsing for name and allowed-tools
        const nameMatch = yamlContent.match(/name:\s*(.+)/);
        const toolsMatch = yamlContent.match(/allowed-tools:\s*(.+)/);
        
        skills.push({
          id: entry.name,
          name: nameMatch ? nameMatch[1].trim() : entry.name,
          description: bodyContent.split('\n')[0]?.replace(/^#+\s*/, '') || '',
          allowedTools: toolsMatch 
            ? toolsMatch[1].split(',').map(t => t.trim()) 
            : [],
          content: content,
          path: skillPath,
        });
      } else {
        skills.push({
          id: entry.name,
          name: entry.name,
          description: '',
          allowedTools: [],
          content: content,
          path: skillPath,
        });
      }
    } catch (err) {
      console.error(`Failed to load skill ${entry.name}:`, err);
    }
  }

  return skills;
}

export function loadPiSkill(skillId: string): PiSkill | null {
  const skillMdPath = join(getTaskFactoryPiSkillsDir(), skillId, 'SKILL.md');

  if (!existsSync(skillMdPath)) {
    return null;
  }

  const skillPath = dirname(skillMdPath);

  try {
    const content = readFileSync(skillMdPath, 'utf-8');
    
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    
    if (frontmatterMatch) {
      const [, yamlContent, bodyContent] = frontmatterMatch;
      
      const nameMatch = yamlContent.match(/name:\s*(.+)/);
      const toolsMatch = yamlContent.match(/allowed-tools:\s*(.+)/);
      
      return {
        id: skillId,
        name: nameMatch ? nameMatch[1].trim() : skillId,
        description: bodyContent.split('\n')[0]?.replace(/^#+\s*/, '') || '',
        allowedTools: toolsMatch 
          ? toolsMatch[1].split(',').map(t => t.trim()) 
          : [],
        content: content,
        path: skillPath,
      };
    }
  } catch (err) {
    console.error(`Failed to load skill ${skillId}:`, err);
  }

  return null;
}

// =============================================================================
// Global Rules + Workspace Shared Context
// =============================================================================

export const WORKSPACE_SHARED_CONTEXT_REL_PATH = '.taskfactory/workspace-context.md';
export const LEGACY_WORKSPACE_SHARED_CONTEXT_REL_PATH = '.pi/workspace-context.md';

export function loadGlobalAgentsMd(): string | null {
  const agentsPath = resolveReadablePiAgentPath('AGENTS.md');

  if (!agentsPath) {
    return null;
  }

  try {
    return readFileSync(agentsPath, 'utf-8');
  } catch (err) {
    console.error('Failed to load AGENTS.md:', err);
    return null;
  }
}

/**
 * Return the canonical write path for the workspace shared context file.
 * When `artifactRoot` is provided, the file lives in the artifact root instead
 * of the workspace's local `.taskfactory` directory.
 */
export function getWorkspaceSharedContextPath(workspacePath: string, artifactRoot?: string): string {
  if (artifactRoot) {
    return join(artifactRoot, 'workspace-context.md');
  }
  return join(workspacePath, WORKSPACE_SHARED_CONTEXT_REL_PATH);
}

export function getLegacyWorkspaceSharedContextPath(workspacePath: string): string {
  return join(workspacePath, LEGACY_WORKSPACE_SHARED_CONTEXT_REL_PATH);
}

/**
 * Load the workspace shared context file.
 * Checks the artifact root first (when provided), then falls back to the local
 * `.taskfactory` directory and legacy `.pi` paths.
 */
export function loadWorkspaceSharedContext(workspacePath: string, artifactRoot?: string): string | null {
  const candidatePaths: string[] = [];

  if (artifactRoot) {
    candidatePaths.push(join(artifactRoot, 'workspace-context.md'));
  }

  // Always include local paths as fallback for backward compatibility.
  const localPath = join(workspacePath, WORKSPACE_SHARED_CONTEXT_REL_PATH);
  const legacyContextPath = getLegacyWorkspaceSharedContextPath(workspacePath);

  if (!artifactRoot || !candidatePaths.includes(localPath)) {
    candidatePaths.push(localPath);
  }
  candidatePaths.push(legacyContextPath);

  const readablePath = candidatePaths.find(existsSync) ?? null;

  if (!readablePath) {
    return null;
  }

  try {
    return readFileSync(readablePath, 'utf-8');
  } catch (err) {
    console.warn(
      `[PiIntegration] Failed to load workspace shared context: ${readablePath} (${String(err)})`,
    );
    return null;
  }
}

/**
 * Write the workspace shared context file.
 * When `artifactRoot` is provided, writes to `<artifactRoot>/workspace-context.md`;
 * otherwise writes to the local `.taskfactory/workspace-context.md`.
 */
export function saveWorkspaceSharedContext(workspacePath: string, content: string, artifactRoot?: string): void {
  const contextPath = getWorkspaceSharedContextPath(workspacePath, artifactRoot);
  const contextDir = dirname(contextPath);

  if (!existsSync(contextDir)) {
    mkdirSync(contextDir, { recursive: true });
  }

  writeFileSync(contextPath, content, 'utf-8');
}

function mergeGlobalRulesWithWorkspaceContext(globalAgentsMd: string, workspaceContext: string | null): string {
  const normalizedContext = workspaceContext?.trim();

  if (!normalizedContext) {
    return globalAgentsMd;
  }

  const contextSection =
    `## Workspace Shared Context (${WORKSPACE_SHARED_CONTEXT_REL_PATH})\n` +
    `${normalizedContext}\n`;

  if (!globalAgentsMd || globalAgentsMd.trim().length === 0) {
    return contextSection;
  }

  return `${globalAgentsMd.trimEnd()}\n\n${contextSection}`;
}

function loadWorkspacePathFromRegistry(workspaceId: string): string | undefined {
  const registryPath = join(PI_FACTORY_DIR, 'workspaces.json');

  if (!existsSync(registryPath)) {
    return undefined;
  }

  try {
    const raw = readFileSync(registryPath, 'utf-8');
    const entries = JSON.parse(raw) as Array<{ id?: unknown; path?: unknown }>;

    for (const entry of entries) {
      if (entry.id === workspaceId && typeof entry.path === 'string' && entry.path.length > 0) {
        return entry.path;
      }
    }
  } catch (err) {
    console.warn(
      `[PiIntegration] Failed to parse workspace registry at ${registryPath}: ${String(err)}`,
    );
  }

  return undefined;
}

// =============================================================================
// Workspace-Specific Configuration
// =============================================================================

export interface WorkspacePiConfig {
  skills: {
    enabled: string[];
    config: Record<string, any>;
  };
  extensions: {
    enabled: string[];
    config: Record<string, any>;
  };
}

export function loadWorkspacePiConfig(workspaceId: string): WorkspacePiConfig | null {
  const configPath = join(PI_FACTORY_DIR, 'workspaces', workspaceId, 'pi-config.json');
  
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`Failed to load workspace Pi config for ${workspaceId}:`, err);
    return null;
  }
}

export function saveWorkspacePiConfig(workspaceId: string, config: WorkspacePiConfig): void {
  const workspaceDir = join(PI_FACTORY_DIR, 'workspaces', workspaceId);
  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true });
  }
  
  const configPath = join(workspaceDir, 'pi-config.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

// =============================================================================
// Foreman Settings (per-workspace)
// =============================================================================

function isValidModelConfig(value: unknown): value is ForemanSettings['modelConfig'] {
  if (!value || typeof value !== 'object') return false;
  const config = value as Record<string, unknown>;
  return typeof config.provider === 'string' && typeof config.modelId === 'string';
}

export function loadForemanSettings(workspaceId: string): ForemanSettings {
  const settingsPath = join(PI_FACTORY_DIR, 'workspaces', workspaceId, 'foreman-settings.json');
  
  if (!existsSync(settingsPath)) {
    return {};
  }

  try {
    const content = readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(content);
    
    // Validate the parsed object
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn(`[ForemanSettings] Invalid settings file for workspace ${workspaceId}, returning defaults`);
      return {};
    }
    
    // Validate modelConfig if present
    if (parsed.modelConfig !== undefined && parsed.modelConfig !== null) {
      if (!isValidModelConfig(parsed.modelConfig)) {
        console.warn(`[ForemanSettings] Invalid modelConfig for workspace ${workspaceId}, ignoring`);
        parsed.modelConfig = undefined;
      }
    }
    
    return parsed as ForemanSettings;
  } catch (err) {
    console.error(`Failed to load foreman settings for workspace ${workspaceId}:`, err);
    return {};
  }
}

export function saveForemanSettings(workspaceId: string, settings: ForemanSettings): void {
  const workspaceDir = join(PI_FACTORY_DIR, 'workspaces', workspaceId);
  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true });
  }
  
  const settingsPath = join(workspaceDir, 'foreman-settings.json');
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

// =============================================================================
// Enabled Skills for Workspace
// =============================================================================

export function getEnabledSkillsForWorkspace(workspaceId?: string): PiSkill[] {
  const allSkills = discoverPiSkills();
  
  if (!workspaceId) {
    // Return globally enabled skills or all skills
    const factorySettings = loadPiFactorySettings();
    const enabledIds = factorySettings?.skills?.enabled;
    return enabledIds 
      ? allSkills.filter(s => enabledIds.includes(s.id))
      : allSkills;
  }
  
  const workspaceConfig = loadWorkspacePiConfig(workspaceId);
  if (workspaceConfig?.skills?.enabled) {
    return allSkills.filter(s => workspaceConfig.skills.enabled.includes(s.id));
  }
  
  // Fall back to global factory settings
  const factorySettings = loadPiFactorySettings();
  const enabledIds = factorySettings?.skills?.enabled;
  return enabledIds 
    ? allSkills.filter(s => enabledIds.includes(s.id))
    : allSkills;
}

// =============================================================================
// Enabled Extensions for Workspace
// =============================================================================

export function getEnabledExtensionsForWorkspace(workspaceId?: string): PiExtension[] {
  const allExtensions = discoverPiExtensions();
  
  if (!workspaceId) {
    const factorySettings = loadPiFactorySettings();
    const enabledIds = factorySettings?.extensions?.enabled;
    return enabledIds 
      ? allExtensions.filter(e => enabledIds.includes(e.id))
      : allExtensions;
  }
  
  const workspaceConfig = loadWorkspacePiConfig(workspaceId);
  if (workspaceConfig?.extensions?.enabled) {
    return allExtensions.filter(e => workspaceConfig.extensions.enabled.includes(e.id));
  }
  
  const factorySettings = loadPiFactorySettings();
  const enabledIds = factorySettings?.extensions?.enabled;
  return enabledIds 
    ? allExtensions.filter(e => enabledIds.includes(e.id))
    : allExtensions;
}

// =============================================================================
// Agent Context Builder
// =============================================================================

export interface AgentContext {
  globalRules: string;
  settings: MergedSettings;
  availableSkills: PiSkill[];
  activeExtensions: PiExtension[];
  workspaceConfig?: WorkspacePiConfig;
}

export function buildAgentContext(
  workspaceId?: string,
  skillIds?: string[],
  workspacePath?: string,
): AgentContext {
  const settings = loadMergedSettings();
  const globalAgentsMd = loadGlobalAgentsMd() || '';

  let resolvedWorkspacePath = workspacePath;

  if (!resolvedWorkspacePath && workspaceId) {
    resolvedWorkspacePath = loadWorkspacePathFromRegistry(workspaceId);
  }

  let resolvedArtifactRoot: string | undefined;
  if (resolvedWorkspacePath) {
    const wsConfig = loadWorkspaceConfigFromDiskSync(resolvedWorkspacePath);
    resolvedArtifactRoot = resolveWorkspaceArtifactRoot(resolvedWorkspacePath, wsConfig);
  }

  const workspaceContext = resolvedWorkspacePath
    ? loadWorkspaceSharedContext(resolvedWorkspacePath, resolvedArtifactRoot)
    : null;

  const globalRules = mergeGlobalRulesWithWorkspaceContext(globalAgentsMd, workspaceContext);

  // Load skills - either specified ones or enabled for workspace
  let availableSkills: PiSkill[];
  if (skillIds) {
    availableSkills = skillIds.map(id => loadPiSkill(id)).filter(Boolean) as PiSkill[];
  } else {
    availableSkills = getEnabledSkillsForWorkspace(workspaceId);
  }

  const activeExtensions = getEnabledExtensionsForWorkspace(workspaceId);
  const workspaceConfig = workspaceId ? loadWorkspacePiConfig(workspaceId) : undefined;

  return {
    globalRules,
    settings,
    availableSkills,
    activeExtensions,
    workspaceConfig: workspaceConfig || undefined,
  };
}

// =============================================================================
// Themes
// =============================================================================

export interface PiTheme {
  id: string;
  name: string;
  path: string;
}

export function discoverPiThemes(): PiTheme[] {
  const themesDir = resolveReadablePiAgentPath('themes');

  if (!themesDir) {
    return [];
  }

  const themes: PiTheme[] = [];
  const entries = readdirSync(themesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    themes.push({
      id: entry.name,
      name: entry.name,
      path: join(themesDir, entry.name),
    });
  }

  return themes;
}
