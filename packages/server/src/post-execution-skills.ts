// =============================================================================
// Post-Execution Skills
// =============================================================================
// Discovers and runs Agent Skills (agentskills.io spec) from the repo-local
// skills/ directory. These run as follow-up prompts on the same Pi session
// after the main task execution completes.

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import type { PostExecutionSkill } from '@pi-factory/shared';
import { createSystemEvent, createChatMessage } from './activity-service.js';

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
}

/**
 * Run post-execution skills sequentially on an existing Pi session.
 * Each skill is run as a followUp() call so the agent retains full context.
 */
export async function runPostExecutionSkills(
  piSession: { followUp: (content: string) => Promise<any> },
  skillIds: string[],
  ctx: RunSkillsContext,
): Promise<void> {
  const { taskId, workspaceId, broadcastToWorkspace } = ctx;

  for (const skillId of skillIds) {
    const skill = getPostExecutionSkill(skillId);
    if (!skill) {
      console.warn(`[Skills] Skill "${skillId}" not found, skipping`);
      const notFoundEntry = createSystemEvent(
        workspaceId,
        taskId,
        'phase-change',
        `Post-execution skill "${skillId}" not found — skipping`,
        { skillId }
      );
      broadcastToWorkspace?.({ type: 'activity:entry', entry: notFoundEntry });
      continue;
    }

    // Broadcast that we're starting this skill
    const startEntry = createSystemEvent(
      workspaceId,
      taskId,
      'phase-change',
      `Running post-execution skill: ${skill.name}`,
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
      console.error(`[Skills] Error running skill "${skillId}":`, err);
      const errEntry = createSystemEvent(
        workspaceId,
        taskId,
        'phase-change',
        `Post-execution skill "${skill.name}" failed: ${err}`,
        { skillId: skill.id, error: String(err) }
      );
      broadcastToWorkspace?.({ type: 'activity:entry', entry: errEntry });
      // Continue to next skill — don't fail the whole task
    }

    const doneEntry = createSystemEvent(
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
 * Run a single follow-up skill (one followUp call).
 */
async function runFollowUpSkill(
  piSession: { followUp: (content: string) => Promise<any> },
  skill: PostExecutionSkill,
  _ctx: RunSkillsContext,
): Promise<void> {
  console.log(`[Skills] Running follow-up skill "${skill.id}" — calling followUp()`);
  const result = await piSession.followUp(skill.promptTemplate);
  console.log(`[Skills] Follow-up skill "${skill.id}" completed`, result ? '(got result)' : '(no result)');
}

/**
 * Run a loop skill: call followUp repeatedly until the agent responds with
 * the done signal or we hit maxIterations.
 */
async function runLoopSkill(
  piSession: { followUp: (content: string) => Promise<any> },
  skill: PostExecutionSkill,
  ctx: RunSkillsContext,
): Promise<void> {
  const { taskId, workspaceId, broadcastToWorkspace } = ctx;

  for (let i = 0; i < skill.maxIterations; i++) {
    const iterEntry = createSystemEvent(
      workspaceId,
      taskId,
      'phase-change',
      `Grind loop iteration ${i + 1}/${skill.maxIterations}`,
      { skillId: skill.id, iteration: i + 1 }
    );
    broadcastToWorkspace?.({ type: 'activity:entry', entry: iterEntry });

    const result = await piSession.followUp(skill.promptTemplate);

    // Check if the agent signaled it's done.
    // The result from followUp may vary — try to extract text content.
    const responseText = extractResponseText(result);
    if (responseText.includes(skill.doneSignal)) {
      const doneEntry = createSystemEvent(
        workspaceId,
        taskId,
        'phase-change',
        `Grind loop: agent signaled done after ${i + 1} iteration(s)`,
        { skillId: skill.id, iterations: i + 1 }
      );
      broadcastToWorkspace?.({ type: 'activity:entry', entry: doneEntry });
      return;
    }
  }

  const maxEntry = createSystemEvent(
    workspaceId,
    taskId,
    'phase-change',
    `Grind loop: reached max iterations (${skill.maxIterations})`,
    { skillId: skill.id }
  );
  broadcastToWorkspace?.({ type: 'activity:entry', entry: maxEntry });
}

/**
 * Extract text from a Pi SDK followUp result.
 * The shape may vary — handle common cases gracefully.
 */
function extractResponseText(result: any): string {
  if (!result) return '';
  if (typeof result === 'string') return result;

  // Pi SDK may return a message object with content array
  if (result.content && Array.isArray(result.content)) {
    return result.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');
  }

  // Or it may return the last message
  if (result.message?.content && Array.isArray(result.message.content)) {
    return result.message.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');
  }

  return String(result);
}
