// =============================================================================
// Post-Execution Skills
// =============================================================================
// Discovers and runs Agent Skills (agentskills.io spec) from the repo-local
// skills/ directory. These run as additional prompts on the same Pi session
// after the main task execution completes.

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import type { PostExecutionSkill, SkillConfigField } from '@pi-factory/shared';
import { createSystemEvent } from './activity-service.js';

// =============================================================================
// Skill Discovery
// =============================================================================

/** Cached skills (discovered once, reloaded on demand) */
let _cachedSkills: PostExecutionSkill[] | null = null;

/**
 * Find the skills/ directory by walking up from this file to the repo root.
 */
function findSkillsDir(): string | null {
  const __filename = fileURLToPath(import.meta.url);
  let dir = dirname(__filename);

  for (let i = 0; i < 10; i++) {
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

/**
 * Parse a SKILL.md file into a PostExecutionSkill.
 * Follows the Agent Skills spec: YAML frontmatter + markdown body.
 */
function parseSkillFile(skillDir: string, dirName: string): PostExecutionSkill | null {
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
      maxIterations,
      doneSignal,
      promptTemplate: bodyContent.trim(),
      path: skillDir,
      metadata,
      configSchema,
    };
  } catch (err) {
    console.error(`[Skills] Failed to parse ${dirName}/SKILL.md:`, err);
    return null;
  }
}

/**
 * Discover all post-execution skills from the repo-local skills/ directory.
 */
export function discoverPostExecutionSkills(): PostExecutionSkill[] {
  if (_cachedSkills !== null) return _cachedSkills;

  const skillsDir = findSkillsDir();
  if (!skillsDir) {
    _cachedSkills = [];
    return _cachedSkills;
  }

  const skills: PostExecutionSkill[] = [];
  const entries = readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const skill = parseSkillFile(join(skillsDir, entry.name), entry.name);
    if (skill) {
      skills.push(skill);
    }
  }

  if (skills.length > 0) {
    console.log(`[Skills] Discovered ${skills.length} post-execution skill(s):`,
      skills.map(s => s.id).join(', '));
  }

  _cachedSkills = skills;
  return skills;
}

/**
 * Get a single skill by ID.
 */
export function getPostExecutionSkill(id: string): PostExecutionSkill | null {
  const skills = discoverPostExecutionSkills();
  return skills.find(s => s.id === id) || null;
}

/** Force re-discovery (e.g. after adding a new skill). */
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
/**
 * Apply configuration overrides from skillConfigs to a skill instance.
 * Returns a shallow copy with overridden values.
 */
function applySkillConfigOverrides(
  skill: PostExecutionSkill,
  overrides: Record<string, string> | undefined,
): PostExecutionSkill {
  if (!overrides || Object.keys(overrides).length === 0) return skill;

  const applied = { ...skill };

  // Apply known config keys that map to skill properties
  if (overrides['max-iterations'] !== undefined) {
    const parsed = parseInt(overrides['max-iterations'], 10);
    if (!isNaN(parsed) && parsed > 0) {
      applied.maxIterations = parsed;
    }
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
