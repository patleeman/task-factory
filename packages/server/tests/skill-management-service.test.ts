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
    expect(getFactoryUserSkillsDir()).toContain('/.taskfactory/skills');
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
    expect(initialContent).toContain('hooks: pre,post');

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
    expect(updatedContent).toContain('hooks: pre,post');
    expect(updatedContent).toContain('max-iterations: "3"');
    expect(updatedContent).toContain('done-signal: DONE_NOW');
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
    expect(importedContent).toContain('hooks: pre,post');
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

  it('migrates legacy ~/.pi/factory/skills into ~/.taskfactory/skills', async () => {
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
    expect(existsSync(join(skillsDir, 'legacy-review', 'SKILL.md'))).toBe(true);
  });

  it('validates imported markdown shape', () => {
    expect(() => parseImportedSkillMarkdown('no frontmatter')).toThrow('YAML frontmatter');
  });
});
