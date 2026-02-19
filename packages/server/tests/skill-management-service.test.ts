import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createFactorySkill,
  updateFactorySkill,
  importFactorySkill,
  deleteFactorySkill,
  getFactoryUserSkillsDir,
  parseImportedSkillMarkdown,
} from '../src/skill-management-service.js';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempDirs: string[] = [];

function createTempSkillsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-factory-skills-'));
  tempDirs.push(dir);
  return dir;
}

function setTempHome(): string {
  const homePath = mkdtempSync(join(tmpdir(), 'pi-factory-home-'));
  tempDirs.push(homePath);
  process.env.HOME = homePath;
  process.env.USERPROFILE = homePath;
  return homePath;
}

afterEach(() => {
  vi.resetModules();

  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('skill-management-service', () => {
  it('resolves user skill storage under ~/.taskfactory/skills by default', () => {
    expect(getFactoryUserSkillsDir()).toContain(join('.taskfactory', 'skills'));
  });

  it('writes a skill to a repo-local .taskfactory/skills directory when provided', () => {
    const workspacePath = createTempSkillsDir();
    const repoSkillsDir = join(workspacePath, '.taskfactory', 'skills');

    const createdId = createFactorySkill(
      {
        id: 'repo-skill',
        description: 'Repo-local skill',
        type: 'follow-up',
        maxIterations: 1,
        doneSignal: 'HOOK_DONE',
        promptTemplate: 'Use repo-local skill',
        configSchema: [],
      },
      { skillsDir: repoSkillsDir },
    );

    expect(createdId).toBe('repo-skill');
    expect(existsSync(join(repoSkillsDir, 'repo-skill', 'SKILL.md'))).toBe(true);
  });

  it('creates and updates a skill in the provided skills directory', () => {
    const skillsDir = createTempSkillsDir();

    const createdId = createFactorySkill(
      {
        id: 'custom-review',
        description: 'Review output using {{style}} tone.',
        type: 'follow-up',
        maxIterations: 1,
        doneSignal: 'HOOK_DONE',
        promptTemplate: 'Please review this task using a {{style}} tone.',
        configSchema: [
          {
            key: 'style',
            label: 'Style',
            type: 'select',
            default: 'concise',
            description: 'Review style',
            validation: {
              options: ['concise', 'detailed'],
            },
          },
        ],
      },
      { skillsDir },
    );

    expect(createdId).toBe('custom-review');

    const skillMdPath = join(skillsDir, 'custom-review', 'SKILL.md');
    const initialContent = readFileSync(skillMdPath, 'utf-8');
    expect(initialContent).toContain('name: custom-review');
    expect(initialContent).toContain('description: Review output using {{style}} tone.');
    expect(initialContent).toContain('hooks: pre-planning,pre,post');

    const updatedId = updateFactorySkill(
      'custom-review',
      {
        id: 'custom-review',
        description: 'Updated description',
        type: 'loop',
        maxIterations: 3,
        doneSignal: 'DONE_NOW',
        promptTemplate: 'Loop until DONE_NOW',
        configSchema: [],
      },
      { skillsDir },
    );

    expect(updatedId).toBe('custom-review');

    const updatedContent = readFileSync(skillMdPath, 'utf-8');
    expect(updatedContent).toContain('description: Updated description');
    expect(updatedContent).toContain('type: loop');
    expect(updatedContent).toContain('hooks: pre-planning,pre,post');
    expect(updatedContent).toContain('max-iterations: "3"');
    expect(updatedContent).toContain('done-signal: DONE_NOW');
  });

  it('creates a skill with pre-planning hook metadata', () => {
    const skillsDir = createTempSkillsDir();

    const createdId = createFactorySkill(
      {
        id: 'plan-context',
        description: 'Collect context before planning',
        type: 'follow-up',
        hooks: ['pre-planning'],
        maxIterations: 1,
        doneSignal: 'HOOK_DONE',
        promptTemplate: 'Collect context before planning.',
        configSchema: [],
      },
      { skillsDir },
    );

    expect(createdId).toBe('plan-context');

    const skillMdPath = join(skillsDir, 'plan-context', 'SKILL.md');
    const content = readFileSync(skillMdPath, 'utf-8');
    expect(content).toContain('hooks: pre-planning');
  });

  it('imports SKILL.md content and normalizes the skill id from name', () => {
    const skillsDir = createTempSkillsDir();

    const importedId = importFactorySkill(
      `---
name: Imported Skill
description: Import description
metadata:
  author: someone
  type: loop
  max-iterations: "4"
  done-signal: FINISHED
config:
  - key: style
    label: Style
    type: string
    default: neutral
---

Use {{style}} tone.
`,
      false,
      { skillsDir },
    );

    expect(importedId).toBe('imported-skill');

    const importedPath = join(skillsDir, 'imported-skill', 'SKILL.md');
    expect(existsSync(importedPath)).toBe(true);

    const importedContent = readFileSync(importedPath, 'utf-8');
    expect(importedContent).toContain('name: imported-skill');
    expect(importedContent).toContain('hooks: pre-planning,pre,post');
    expect(importedContent).toContain('done-signal: FINISHED');
    expect(importedContent).toContain('Use {{style}} tone.');
  });

  it('deletes a skill directory', () => {
    const skillsDir = createTempSkillsDir();

    createFactorySkill(
      {
        id: 'delete-me',
        description: 'Delete test',
        type: 'follow-up',
        maxIterations: 1,
        doneSignal: 'HOOK_DONE',
        promptTemplate: 'noop',
        configSchema: [],
      },
      { skillsDir },
    );

    const skillDir = join(skillsDir, 'delete-me');
    expect(existsSync(skillDir)).toBe(true);

    deleteFactorySkill('delete-me', { skillsDir });
    expect(existsSync(skillDir)).toBe(false);
  });

  it('does not read legacy ~/.pi/factory/skills without explicit migration', async () => {
    const homePath = setTempHome();

    const legacySkillDir = join(homePath, '.pi', 'factory', 'skills', 'legacy-review');
    mkdirSync(legacySkillDir, { recursive: true });
    writeFileSync(
      join(legacySkillDir, 'SKILL.md'),
      '---\nname: legacy-review\ndescription: Legacy review\n---\n\nReview output.\n',
      'utf-8',
    );

    vi.resetModules();
    const { getFactoryUserSkillsDir: getFactoryUserSkillsDirFresh } = await import('../src/skill-management-service.js');

    const skillsDir = getFactoryUserSkillsDirFresh();
    expect(skillsDir).toBe(join(homePath, '.taskfactory', 'skills'));
    expect(existsSync(join(skillsDir, 'legacy-review', 'SKILL.md'))).toBe(false);
  });

  it('parses pre-planning hook metadata from imported skills', () => {
    const parsed = parseImportedSkillMarkdown(`---
name: plan-context
description: Gather planning context
metadata:
  hooks: pre-planning, pre
---

Collect planning context before starting.
`);

    expect(parsed.id).toBe('plan-context');
    expect(parsed.hooks).toEqual(['pre-planning', 'pre']);
  });

  it('validates imported markdown shape', () => {
    expect(() => parseImportedSkillMarkdown('no frontmatter')).toThrow('YAML frontmatter');
  });

  it('creates a subagent skill and persists type: subagent in metadata', () => {
    const skillsDir = createTempSkillsDir();

    const createdId = createFactorySkill(
      {
        id: 'my-subagent',
        description: 'Delegates work to a subagent',
        type: 'subagent',
        maxIterations: 1,
        doneSignal: 'HOOK_DONE',
        promptTemplate: 'Spawn a subagent to complete the work.',
        configSchema: [],
      },
      { skillsDir },
    );

    expect(createdId).toBe('my-subagent');

    const skillMdPath = join(skillsDir, 'my-subagent', 'SKILL.md');
    const content = readFileSync(skillMdPath, 'utf-8');
    expect(content).toContain('type: subagent');
    // subagent does not emit loop-only fields
    expect(content).not.toContain('max-iterations');
    expect(content).not.toContain('done-signal');
  });

  it('updates a skill to subagent type and strips loop metadata', () => {
    const skillsDir = createTempSkillsDir();

    createFactorySkill(
      {
        id: 'loop-to-subagent',
        description: 'Originally a loop skill',
        type: 'loop',
        maxIterations: 5,
        doneSignal: 'ALL_DONE',
        promptTemplate: 'Loop prompt.',
        configSchema: [],
      },
      { skillsDir },
    );

    updateFactorySkill(
      'loop-to-subagent',
      {
        id: 'loop-to-subagent',
        description: 'Now a subagent skill',
        type: 'subagent',
        maxIterations: 1,
        doneSignal: 'HOOK_DONE',
        promptTemplate: 'Delegate to subagent.',
        configSchema: [],
      },
      { skillsDir },
    );

    const content = readFileSync(join(skillsDir, 'loop-to-subagent', 'SKILL.md'), 'utf-8');
    expect(content).toContain('type: subagent');
    expect(content).not.toContain('max-iterations');
    expect(content).not.toContain('done-signal');
  });

  it('imports a SKILL.md with type: subagent metadata', () => {
    const skillsDir = createTempSkillsDir();

    const importedId = importFactorySkill(
      `---
name: imported-subagent
description: Subagent skill via import
metadata:
  type: subagent
  author: tester
---

Delegate work to a subagent for this task.
`,
      false,
      { skillsDir },
    );

    expect(importedId).toBe('imported-subagent');

    const content = readFileSync(join(skillsDir, 'imported-subagent', 'SKILL.md'), 'utf-8');
    expect(content).toContain('type: subagent');
  });

  it('parseImportedSkillMarkdown resolves subagent type correctly', () => {
    const parsed = parseImportedSkillMarkdown(`---
name: inline-subagent
description: Inline subagent test
metadata:
  type: subagent
---

Run a subagent conversation.
`);
    expect(parsed.type).toBe('subagent');
  });

  it('parseImportedSkillMarkdown falls back to follow-up for unknown types', () => {
    const parsed = parseImportedSkillMarkdown(`---
name: unknown-type-skill
description: Unknown type skill
metadata:
  type: totally-unknown
---

Some prompt.
`);
    expect(parsed.type).toBe('follow-up');
  });

  it('rejects invalid type in createFactorySkill payload', () => {
    const skillsDir = createTempSkillsDir();
    expect(() =>
      createFactorySkill(
        {
          id: 'bad-type',
          description: 'Bad type skill',
          type: 'totally-unknown' as any,
          maxIterations: 1,
          doneSignal: 'HOOK_DONE',
          promptTemplate: 'Prompt.',
          configSchema: [],
        },
        { skillsDir },
      ),
    ).toThrow('type must be');
  });
});
