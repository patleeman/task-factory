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
  accessSync,
  constants,
} from 'fs';
import { join, resolve, isAbsolute } from 'path';
import { homedir } from 'os';
import type { TaskDefaults } from '@pi-factory/shared';

const PI_AGENT_DIR = join(homedir(), '.pi', 'agent');
const PI_FACTORY_DIR = join(homedir(), '.pi', 'factory');

// Ensure pi-factory directory exists
if (!existsSync(PI_FACTORY_DIR)) {
  mkdirSync(PI_FACTORY_DIR, { recursive: true });
}

// =============================================================================
// Pi-Factory Settings
// =============================================================================

export interface PiFactorySettings {
  // Pi-Factory specific settings
  defaultWorkspace?: string;
  theme?: string;
  // Task creation defaults
  taskDefaults?: TaskDefaults;
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
    console.error('Failed to load Pi-Factory settings:', err);
    return null;
  }
}

export function savePiFactorySettings(settings: PiFactorySettings): void {
  const settingsPath = join(PI_FACTORY_DIR, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

export function loadPiSettings(): PiSettings | null {
  const settingsPath = join(PI_AGENT_DIR, 'settings.json');
  
  if (!existsSync(settingsPath)) {
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
  const modelsPath = join(PI_AGENT_DIR, 'models.json');
  
  if (!existsSync(modelsPath)) {
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
  const extensionsDir = join(PI_AGENT_DIR, 'extensions');
  
  if (!existsSync(extensionsDir)) {
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
  const skillsDir = join(PI_AGENT_DIR, 'skills');
  
  if (!existsSync(skillsDir)) {
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
  const skillPath = join(PI_AGENT_DIR, 'skills', skillId);
  const skillMdPath = join(skillPath, 'SKILL.md');

  if (!existsSync(skillMdPath)) {
    return null;
  }

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
// Global + Workspace Rules (AGENTS.md)
// =============================================================================

export function loadGlobalAgentsMd(): string | null {
  const agentsPath = join(PI_AGENT_DIR, 'AGENTS.md');

  if (!existsSync(agentsPath)) {
    return null;
  }

  try {
    return readFileSync(agentsPath, 'utf-8');
  } catch (err) {
    console.error('Failed to load AGENTS.md:', err);
    return null;
  }
}

function resolveWorkspaceAgentsMdPath(workspacePath: string, agentsMdPath: string): string {
  if (isAbsolute(agentsMdPath)) {
    return agentsMdPath;
  }

  return resolve(workspacePath, agentsMdPath);
}

/**
 * Load workspace-specific AGENTS.md content.
 * Relative paths are resolved from the workspace root.
 */
export function loadWorkspaceAgentsMd(workspacePath: string, agentsMdPath?: string | null): string | null {
  if (!agentsMdPath) {
    return null;
  }

  const resolvedPath = resolveWorkspaceAgentsMdPath(workspacePath, agentsMdPath);

  if (!existsSync(resolvedPath)) {
    console.warn(
      `[PiIntegration] Workspace AGENTS.md not found: ${resolvedPath} (configured as "${agentsMdPath}")`,
    );
    return null;
  }

  try {
    accessSync(resolvedPath, constants.R_OK);
    return readFileSync(resolvedPath, 'utf-8');
  } catch (err) {
    console.warn(
      `[PiIntegration] Workspace AGENTS.md is not readable: ${resolvedPath} (${String(err)})`,
    );
    return null;
  }
}

function mergeAgentsMd(globalAgentsMd: string, workspaceAgentsMd: string | null): string {
  if (!workspaceAgentsMd || workspaceAgentsMd.trim().length === 0) {
    return globalAgentsMd;
  }

  if (!globalAgentsMd || globalAgentsMd.trim().length === 0) {
    return workspaceAgentsMd;
  }

  return `${globalAgentsMd.trimEnd()}\n\n${workspaceAgentsMd.trimStart()}`;
}

function loadWorkspaceAgentsMdPathFromConfig(workspacePath: string): string | undefined {
  const workspaceConfigPath = join(workspacePath, '.pi', 'factory.json');

  if (!existsSync(workspaceConfigPath)) {
    return undefined;
  }

  try {
    const raw = readFileSync(workspaceConfigPath, 'utf-8');
    const parsed = JSON.parse(raw) as { agentsMdPath?: unknown };

    if (typeof parsed.agentsMdPath === 'string' && parsed.agentsMdPath.trim().length > 0) {
      return parsed.agentsMdPath;
    }
  } catch (err) {
    console.warn(
      `[PiIntegration] Failed to parse workspace config at ${workspaceConfigPath}: ${String(err)}`,
    );
  }

  return undefined;
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

  const workspaceAgentsMdPath = resolvedWorkspacePath
    ? loadWorkspaceAgentsMdPathFromConfig(resolvedWorkspacePath)
    : undefined;

  const workspaceAgentsMd = resolvedWorkspacePath
    ? loadWorkspaceAgentsMd(resolvedWorkspacePath, workspaceAgentsMdPath)
    : null;

  const globalRules = mergeAgentsMd(globalAgentsMd, workspaceAgentsMd);

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
  const themesDir = join(PI_AGENT_DIR, 'themes');
  
  if (!existsSync(themesDir)) {
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
