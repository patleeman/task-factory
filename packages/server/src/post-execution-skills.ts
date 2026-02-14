// =============================================================================
// Post-Execution Skills
// =============================================================================
// Discovers and runs Agent Skills (agentskills.io spec) from the repo-local
// skills/ directory. These run as additional prompts on the same Pi session
// after the main task execution completes.

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import type { PostExecutionSkill, SkillConfigField, SkillHook, SkillSource } from '@pi-factory/shared';
import { createSystemEvent } from './activity-service.js';

// =============================================================================
// Skill Discovery
// =============================================================================

const DEFAULT_SKILL_HOOKS: SkillHook[] = ['pre', 'post'];
const SKILL_HOOK_SET = new Set<SkillHook>(DEFAULT_SKILL_HOOKS);
const USER_SKILLS_DIR = join(homedir(), '.pi', 'factory', 'skills');

/** Cached skills (discovered once, reloaded on demand) */
let _cachedSkills: PostExecutionSkill[] | null = null;

/** Resolve the packaged starter skills directory inside the Task Factory repo. */
function findStarterSkillsDir(): string | null {
  const __filename = fileURLToPath(import.meta.url);
  let dir = dirname(__filename);

  for (let i = 0; i < 10; i += 1) {
    const candidate = join(dir, 'skills');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

export function getFactoryUserSkillsDir(): string {
  return USER_SKILLS_DIR;
}

function parseSkillHooks(metadata: Record<string, string>, skillId: string): SkillHook[] {
  const rawHooks = metadata.hooks ?? metadata.hook;
  if (!rawHooks) {
    console.warn(`[Skills] ${skillId} missing metadata.hooks; defaulting to pre,post for backward compatibility`);
    return [...DEFAULT_SKILL_HOOKS];
  }

  const parsedHooks = rawHooks
    .split(/[\s,]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .filter((value): value is SkillHook => SKILL_HOOK_SET.has(value as SkillHook));

  const dedupedHooks = Array.from(new Set(parsedHooks));

  if (dedupedHooks.length === 0) {
    console.warn(`[Skills] ${skillId} has invalid metadata.hooks="${rawHooks}"; defaulting to pre,post`);
    return [...DEFAULT_SKILL_HOOKS];
  }

  return dedupedHooks;
}

function parseWorkflowId(metadata: Record<string, string>): string | undefined {
  const workflowId = metadata['workflow-id']?.trim();
  return workflowId ? workflowId : undefined;
}

function parsePairedSkillId(metadata: Record<string, string>): string | undefined {
  const pairedSkillId = metadata['pairs-with']?.trim();
  return pairedSkillId ? pairedSkillId : undefined;
}

/**
 * Parse a SKILL.md file into a PostExecutionSkill.
 * Follows the Agent Skills spec: YAML frontmatter + markdown body.
 */
function parseSkillFile(skillDir: string, dirName: string, source: SkillSource): PostExecutionSkill | null {
  const skillMdPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMdPath)) return null;

  try {
    const content = readFileSync(skillMdPath, 'utf-8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (!frontmatterMatch) {
      console.warn(`[Skills] ${dirName}/SKILL.md missing frontmatter, skipping`);
      return null;
    }

    const [, yamlContent, bodyContent] = frontmatterMatch;
    const parsed = YAML.parse(yamlContent) || {};

    // Spec requires name and description
    const name = parsed.name;
    const description = parsed.description;
    if (!name || !description) {
      console.warn(`[Skills] ${dirName}/SKILL.md missing required name or description`);
      return null;
    }

    // Spec: name must match directory name
    if (name !== dirName) {
      console.warn(`[Skills] ${dirName}/SKILL.md name "${name}" does not match directory name`);
      return null;
    }

    // Pi-factory extensions live in metadata (spec allows arbitrary key-value)
    const metadata: Record<string, string> = {};
    if (parsed.metadata && typeof parsed.metadata === 'object') {
      for (const [k, v] of Object.entries(parsed.metadata)) {
        metadata[k] = String(v);
      }
    }

    const type = metadata.type === 'loop' ? 'loop' : 'follow-up';
    const hooks = parseSkillHooks(metadata, dirName);
    const maxIterations = parseInt(metadata['max-iterations'] || '1', 10) || 1;
    const doneSignal = metadata['done-signal'] || 'HOOK_DONE';

    // Parse config schema from frontmatter
    const configSchema: SkillConfigField[] = [];
    if (Array.isArray(parsed.config)) {
      for (const item of parsed.config) {
        if (!item || typeof item !== 'object' || !item.key || !item.label || !item.type) continue;
        const field: SkillConfigField = {
          key: String(item.key),
          label: String(item.label),
          type: item.type as SkillConfigField['type'],
          default: String(item.default ?? ''),
          description: String(item.description ?? ''),
        };
        if (item.validation && typeof item.validation === 'object') {
          const v: SkillConfigField['validation'] = {};
          if (item.validation.min !== undefined) v.min = Number(item.validation.min);
          if (item.validation.max !== undefined) v.max = Number(item.validation.max);
          if (item.validation.pattern !== undefined) v.pattern = String(item.validation.pattern);
          if (Array.isArray(item.validation.options)) v.options = item.validation.options.map(String);
          field.validation = v;
        }
        configSchema.push(field);
      }
    }

    return {
      id: dirName,
      name,
      description,
      type,
      hooks,
      workflowId: parseWorkflowId(metadata),
      pairedSkillId: parsePairedSkillId(metadata),
      maxIterations,
      doneSignal,
      promptTemplate: bodyContent.trim(),
      path: skillDir,
      source,
      metadata,
      configSchema,
    };
  } catch (err) {
    console.error(`[Skills] Failed to parse ${dirName}/SKILL.md:`, err);
    return null;
  }
}

function discoverSkillsFromDir(skillsDir: string, source: SkillSource): PostExecutionSkill[] {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const skills: PostExecutionSkill[] = [];
  const entries = readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const skill = parseSkillFile(join(skillsDir, entry.name), entry.name, source);
    if (skill) {
      skills.push(skill);
    }
  }

  return skills;
}

/**
 * Discover execution skills from starter skills + user-defined skills.
 * User-defined skills in ~/.pi/factory/skills override starter skills by ID.
 */
export function discoverPostExecutionSkills(): PostExecutionSkill[] {
  if (_cachedSkills !== null) return _cachedSkills;

  const starterSkillsDir = findStarterSkillsDir();
  const starterSkills = starterSkillsDir
    ? discoverSkillsFromDir(starterSkillsDir, 'starter')
    : [];

  const userSkills = discoverSkillsFromDir(getFactoryUserSkillsDir(), 'user');

  const byId = new Map<string, PostExecutionSkill>();
  for (const skill of starterSkills) {
    byId.set(skill.id, skill);
  }
  for (const skill of userSkills) {
    byId.set(skill.id, skill);
  }

  const mergedSkills = Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));

  if (mergedSkills.length > 0) {
    console.log(
      `[Skills] Discovered ${mergedSkills.length} execution skill(s):`,
      mergedSkills.map((skill) => skill.id).join(', '),
    );
  }

  _cachedSkills = mergedSkills;
  return mergedSkills;
}

export function skillSupportsHook(skill: PostExecutionSkill, hook: SkillHook): boolean {
  return skill.hooks.includes(hook);
}

/**
 * Get a single skill by ID.
 */
export function getPostExecutionSkill(id: string): PostExecutionSkill | null {
  const skills = discoverPostExecutionSkills();
  return skills.find((skill) => skill.id === id) || null;
}

/** Force re-discovery (e.g. after adding/updating a skill). */
export function reloadPostExecutionSkills(): PostExecutionSkill[] {
  _cachedSkills = null;
  return discoverPostExecutionSkills();
}

// =============================================================================
// Skill Runner
// =============================================================================

export interface RunSkillsContext {
  taskId: string;
  workspaceId: string;
  broadcastToWorkspace?: (event: any) => void;
  skillConfigs?: Record<string, Record<string, string>>;
}

interface SkillSession {
  prompt: (content: string) => Promise<void>;
  getLastAssistantText?: () => string | undefined;
  messages?: any[];
}

/**
 * Run pre-execution skills sequentially on an existing Pi session.
 * Each skill runs as a fresh prompt turn. Unlike post-execution skills,
 * pre-execution skills throw on first failure — preventing main execution
 * and post-execution from running.
 */
export async function runPreExecutionSkills(
  piSession: SkillSession,
  skillIds: string[],
  ctx: RunSkillsContext,
): Promise<void> {
  const { taskId, workspaceId, broadcastToWorkspace, skillConfigs } = ctx;

  for (const skillId of skillIds) {
    let skill = getPostExecutionSkill(skillId);
    if (!skill) {
      const errMsg = `Pre-execution skill "${skillId}" not found`;
      console.warn(`[Skills] ${errMsg}`);
      const notFoundEntry = await createSystemEvent(
        workspaceId,
        taskId,
        'phase-change',
        errMsg,
        { skillId }
      );
      broadcastToWorkspace?.({ type: 'activity:entry', entry: notFoundEntry });
      throw new Error(errMsg);
    }

    if (!skillSupportsHook(skill, 'pre')) {
      const errMsg = `Skill "${skillId}" does not support the pre-execution hook`;
      console.warn(`[Skills] ${errMsg}`);
      const invalidHookEntry = await createSystemEvent(
        workspaceId,
        taskId,
        'phase-change',
        errMsg,
        { skillId, hooks: skill.hooks }
      );
      broadcastToWorkspace?.({ type: 'activity:entry', entry: invalidHookEntry });
      throw new Error(errMsg);
    }

    // Apply configuration overrides from task skillConfigs
    skill = applySkillConfigOverrides(skill, skillConfigs?.[skillId]);

    // Broadcast that we're starting this skill
    const startEntry = await createSystemEvent(
      workspaceId,
      taskId,
      'phase-change',
      `Running pre-execution skill: ${skill.name}`,
      { skillId: skill.id, skillType: skill.type }
    );
    broadcastToWorkspace?.({ type: 'activity:entry', entry: startEntry });

    try {
      if (skill.type === 'loop') {
        await runLoopSkill(piSession, skill, ctx);
      } else {
        await runFollowUpSkill(piSession, skill, ctx);
      }
    } catch (err) {
      console.error(`[Skills] Pre-execution skill "${skillId}" failed:`, err);
      const errEntry = await createSystemEvent(
        workspaceId,
        taskId,
        'phase-change',
        `Pre-execution skill "${skill.name}" failed: ${err}`,
        { skillId: skill.id, error: String(err) }
      );
      broadcastToWorkspace?.({ type: 'activity:entry', entry: errEntry });
      // Throw to prevent main execution and post-execution from running
      throw new Error(`Pre-execution skill "${skill.name}" failed: ${err}`);
    }

    const doneEntry = await createSystemEvent(
      workspaceId,
      taskId,
      'phase-change',
      `Pre-execution skill completed: ${skill.name}`,
      { skillId: skill.id }
    );
    broadcastToWorkspace?.({ type: 'activity:entry', entry: doneEntry });
  }
}

/**
 * Run post-execution skills sequentially on an existing Pi session.
 * Each skill runs as a fresh prompt turn so tool output/events are emitted
 * and visible in the task chat timeline.
 */
function buildResolvedSkillConfig(
  skill: PostExecutionSkill,
  overrides: Record<string, string> | undefined,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const field of skill.configSchema) {
    resolved[field.key] = field.default;
  }

  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      resolved[key] = String(value);
    }
  }

  if (resolved['max-iterations'] === undefined) {
    resolved['max-iterations'] = String(skill.maxIterations);
  }

  if (resolved['done-signal'] === undefined && skill.doneSignal) {
    resolved['done-signal'] = skill.doneSignal;
  }

  return resolved;
}

function interpolatePromptTemplate(
  promptTemplate: string,
  resolvedConfig: Record<string, string>,
): string {
  return promptTemplate.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(resolvedConfig, key)) {
      return resolvedConfig[key] ?? '';
    }
    return match;
  });
}

/**
 * Apply configuration overrides from skillConfigs to a skill instance.
 * Returns a shallow copy with overridden values.
 */
export function applySkillConfigOverrides(
  skill: PostExecutionSkill,
  overrides: Record<string, string> | undefined,
): PostExecutionSkill {
  const resolvedConfig = buildResolvedSkillConfig(skill, overrides);
  const applied = { ...skill };

  const maxIterationsRaw = resolvedConfig['max-iterations'];
  if (maxIterationsRaw !== undefined) {
    const parsed = parseInt(maxIterationsRaw, 10);
    if (!isNaN(parsed) && parsed > 0) {
      applied.maxIterations = parsed;
    }
  }

  const doneSignalRaw = resolvedConfig['done-signal'];
  if (doneSignalRaw !== undefined) {
    const doneSignal = doneSignalRaw.trim();
    if (doneSignal.length > 0) {
      applied.doneSignal = doneSignal;
    }
  }

  applied.promptTemplate = interpolatePromptTemplate(skill.promptTemplate, resolvedConfig);

  if (
    applied.maxIterations === skill.maxIterations
    && applied.doneSignal === skill.doneSignal
    && applied.promptTemplate === skill.promptTemplate
  ) {
    return skill;
  }

  return applied;
}

export async function runPostExecutionSkills(
  piSession: SkillSession,
  skillIds: string[],
  ctx: RunSkillsContext,
): Promise<void> {
  const { taskId, workspaceId, broadcastToWorkspace, skillConfigs } = ctx;

  for (const skillId of skillIds) {
    let skill = getPostExecutionSkill(skillId);
    if (!skill) {
      console.warn(`[Skills] Skill "${skillId}" not found, skipping`);
      const notFoundEntry = await createSystemEvent(
        workspaceId,
        taskId,
        'phase-change',
        `Post-execution skill "${skillId}" not found — skipping`,
        { skillId }
      );
      broadcastToWorkspace?.({ type: 'activity:entry', entry: notFoundEntry });
      continue;
    }

    if (!skillSupportsHook(skill, 'post')) {
      const invalidHookEntry = await createSystemEvent(
        workspaceId,
        taskId,
        'phase-change',
        `Post-execution skill "${skillId}" does not support the post hook — skipping`,
        { skillId, hooks: skill.hooks }
      );
      broadcastToWorkspace?.({ type: 'activity:entry', entry: invalidHookEntry });
      continue;
    }

    // Apply configuration overrides from task skillConfigs
    skill = applySkillConfigOverrides(skill, skillConfigs?.[skillId]);

    // Broadcast that we're starting this skill
    const startEntry = await createSystemEvent(
      workspaceId,
      taskId,
      'phase-change',
      `Running post-execution skill: ${skill.name}`,
      { skillId: skill.id, skillType: skill.type }
    );
    broadcastToWorkspace?.({ type: 'activity:entry', entry: startEntry });

    let producedOutput = false;

    try {
      if (skill.type === 'loop') {
        producedOutput = await runLoopSkill(piSession, skill, ctx);
      } else {
        producedOutput = await runFollowUpSkill(piSession, skill, ctx);
      }

      if (!producedOutput) {
        const emptyEntry = await createSystemEvent(
          workspaceId,
          taskId,
          'phase-change',
          `Post-execution skill produced no chat output: ${skill.name}`,
          { skillId: skill.id }
        );
        broadcastToWorkspace?.({ type: 'activity:entry', entry: emptyEntry });
      }
    } catch (err) {
      console.error(`[Skills] Error running skill "${skillId}":`, err);
      const errEntry = await createSystemEvent(
        workspaceId,
        taskId,
        'phase-change',
        `Post-execution skill "${skill.name}" failed: ${err}`,
        { skillId: skill.id, error: String(err) }
      );
      broadcastToWorkspace?.({ type: 'activity:entry', entry: errEntry });
      // Continue to next skill — don't fail the whole task
    }

    const doneEntry = await createSystemEvent(
      workspaceId,
      taskId,
      'phase-change',
      `Post-execution skill completed: ${skill.name}`,
      { skillId: skill.id }
    );
    broadcastToWorkspace?.({ type: 'activity:entry', entry: doneEntry });
  }
}

/**
 * Run a single follow-up skill (one prompt turn).
 */
async function runFollowUpSkill(
  piSession: SkillSession,
  skill: PostExecutionSkill,
  _ctx: RunSkillsContext,
): Promise<boolean> {
  console.log(`[Skills] Running follow-up skill "${skill.id}" — calling prompt()`);

  const beforeMessageCount = getMessageCount(piSession);
  const beforeLastAssistantText = getLastAssistantText(piSession);

  const startTime = Date.now();
  await piSession.prompt(skill.promptTemplate);
  const elapsed = Date.now() - startTime;

  console.log(`[Skills] Follow-up skill "${skill.id}" completed in ${elapsed}ms`);

  return didSessionProduceOutput(piSession, beforeMessageCount, beforeLastAssistantText);
}

/**
 * Run a loop skill: call prompt repeatedly until the agent responds with
 * the done signal or we hit maxIterations.
 */
async function runLoopSkill(
  piSession: SkillSession,
  skill: PostExecutionSkill,
  ctx: RunSkillsContext,
): Promise<boolean> {
  const { taskId, workspaceId, broadcastToWorkspace } = ctx;
  let producedOutput = false;

  for (let i = 0; i < skill.maxIterations; i++) {
    const iterEntry = await createSystemEvent(
      workspaceId,
      taskId,
      'phase-change',
      `Grind loop iteration ${i + 1}/${skill.maxIterations}`,
      { skillId: skill.id, iteration: i + 1 }
    );
    broadcastToWorkspace?.({ type: 'activity:entry', entry: iterEntry });

    const beforeMessageCount = getMessageCount(piSession);
    const beforeLastAssistantText = getLastAssistantText(piSession);

    await piSession.prompt(skill.promptTemplate);

    if (didSessionProduceOutput(piSession, beforeMessageCount, beforeLastAssistantText)) {
      producedOutput = true;
    }

    // Check if the agent signaled it's done.
    const responseText = getLastAssistantText(piSession);
    if (responseText.includes(skill.doneSignal)) {
      const doneEntry = await createSystemEvent(
        workspaceId,
        taskId,
        'phase-change',
        `Grind loop: agent signaled done after ${i + 1} iteration(s)`,
        { skillId: skill.id, iterations: i + 1 }
      );
      broadcastToWorkspace?.({ type: 'activity:entry', entry: doneEntry });
      return producedOutput;
    }
  }

  const maxEntry = await createSystemEvent(
    workspaceId,
    taskId,
    'phase-change',
    `Grind loop: reached max iterations (${skill.maxIterations})`,
    { skillId: skill.id }
  );
  broadcastToWorkspace?.({ type: 'activity:entry', entry: maxEntry });
  return producedOutput;
}

function getMessageCount(piSession: SkillSession): number {
  return Array.isArray(piSession.messages) ? piSession.messages.length : -1;
}

function extractTextFromMessage(message: any): string {
  if (!message) return '';

  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');
  }

  return '';
}

function didSessionProduceOutput(
  piSession: SkillSession,
  beforeMessageCount: number,
  beforeLastAssistantText: string,
): boolean {
  if (beforeMessageCount >= 0 && Array.isArray(piSession.messages)) {
    const newMessages = piSession.messages.slice(beforeMessageCount);

    for (const message of newMessages) {
      if (message?.role === 'toolResult') {
        if (extractTextFromMessage(message).trim().length > 0) {
          return true;
        }
      }

      if (message?.role === 'assistant') {
        if (extractTextFromMessage(message).trim().length > 0) {
          return true;
        }

        if (Array.isArray(message.content)) {
          const hasToolCall = message.content.some((c: any) => c?.type === 'toolCall');
          if (hasToolCall) {
            return true;
          }
        }
      }
    }
  }

  const afterLastAssistantText = getLastAssistantText(piSession);
  return afterLastAssistantText.trim().length > 0 && afterLastAssistantText !== beforeLastAssistantText;
}

/**
 * Best-effort extraction of the latest assistant text from the active session.
 */
function getLastAssistantText(piSession: SkillSession): string {
  if (typeof piSession.getLastAssistantText === 'function') {
    return piSession.getLastAssistantText() || '';
  }

  if (Array.isArray(piSession.messages)) {
    for (let i = piSession.messages.length - 1; i >= 0; i--) {
      const message = piSession.messages[i];
      if (message?.role !== 'assistant') continue;
      return extractTextFromAssistantMessage(message);
    }
  }

  return '';
}

function extractTextFromAssistantMessage(message: any): string {
  if (!message) return '';

  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');
  }

  return '';
}
