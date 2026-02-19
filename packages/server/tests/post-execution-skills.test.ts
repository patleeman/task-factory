import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reloadPostExecutionSkills, type RunSkillsContext } from '../src/post-execution-skills.js';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempDirs: string[] = [];

function createTempHome(): string {
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

describe('execution skill discovery', () => {
  it('discovers starter skills with universal hook metadata and prompt content', () => {
    const skills = reloadPostExecutionSkills();
    const captureScreenshot = skills.find((skill) => skill.id === 'capture-screenshot');

    expect(captureScreenshot).toBeDefined();
    expect(captureScreenshot?.source).toBe('starter');
    expect(captureScreenshot?.type).toBe('follow-up');
    expect(captureScreenshot?.hooks).toEqual(['pre-planning', 'pre', 'post']);
    expect(captureScreenshot?.promptTemplate).toContain('attach_task_file');
    expect(captureScreenshot?.promptTemplate).toContain('agent-browser screenshot');
  });

  it('discovers update-docs as a starter universal hook skill with documentation guidance', () => {
    const skills = reloadPostExecutionSkills();
    const updateDocs = skills.find((skill) => skill.id === 'update-docs');

    expect(updateDocs).toBeDefined();
    expect(updateDocs?.source).toBe('starter');
    expect(updateDocs?.type).toBe('follow-up');
    expect(updateDocs?.hooks).toEqual(['pre-planning', 'pre', 'post']);

    const prompt = updateDocs?.promptTemplate ?? '';
    expect(prompt).toContain('README.md');
    expect(prompt).toContain('docs/**');
    expect(prompt).toContain('CHANGELOG.md');
    expect(prompt).toContain('No documentation updates were needed for this task.');
  });

  it('discovers tdd skills as a paired workflow with universal hooks', () => {
    const skills = reloadPostExecutionSkills();

    const tddPre = skills.find((skill) => skill.id === 'tdd-test-first');
    expect(tddPre).toBeDefined();
    expect(tddPre?.type).toBe('follow-up');
    expect(tddPre?.hooks).toEqual(['pre-planning', 'pre', 'post']);
    expect(tddPre?.workflowId).toBe('tdd');
    expect(tddPre?.pairedSkillId).toBe('tdd-verify-tests');

    const tddPrePrompt = tddPre?.promptTemplate.toLowerCase() ?? '';
    expect(tddPrePrompt).toContain('write or update all required tests before implementing');
    expect(tddPrePrompt).toContain('run the relevant tests in this pre-execution phase');
    expect(tddPrePrompt).toContain('do not implement production code in this pre-execution step');

    const tddPost = skills.find((skill) => skill.id === 'tdd-verify-tests');
    expect(tddPost).toBeDefined();
    expect(tddPost?.type).toBe('follow-up');
    expect(tddPost?.hooks).toEqual(['pre-planning', 'pre', 'post']);
    expect(tddPost?.workflowId).toBe('tdd');
    expect(tddPost?.pairedSkillId).toBe('tdd-test-first');

    const tddPostPrompt = tddPost?.promptTemplate.toLowerCase() ?? '';
    expect(tddPostPrompt).toContain('run the relevant tests after implementation');
    expect(tddPostPrompt).toContain('fix implementation and/or tests until they pass');
    expect(tddPostPrompt).toContain('do not consider the task complete until the added tests are green');
  });

  it('does not include removed starter skills', () => {
    const skills = reloadPostExecutionSkills();
    const skillIds = new Set(skills.map((skill) => skill.id));

    expect(skillIds.has('validate-web')).toBe(false);
    expect(skillIds.has('wrapup')).toBe(false);
  });
});

describe('subagent skill type', () => {
  it('discovers a user-defined subagent skill with type subagent', async () => {
    const homePath = createTempHome();
    const skillDir = join(homePath, '.taskfactory', 'skills', 'my-subagent');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: my-subagent
description: Delegates to a subagent
metadata:
  type: subagent
  hooks: post
---

Spawn a subagent to complete this task.
`);

    vi.resetModules();
    const { reloadPostExecutionSkills: reload } = await import('../src/post-execution-skills.js');
    const skills = reload();
    const skill = skills.find((s) => s.id === 'my-subagent');

    expect(skill).toBeDefined();
    expect(skill?.type).toBe('subagent');
    expect(skill?.hooks).toEqual(['post']);
    expect(skill?.source).toBe('user');
  });

  it('falls back to follow-up for unknown metadata types on discovery', async () => {
    const homePath = createTempHome();
    const skillDir = join(homePath, '.taskfactory', 'skills', 'weird-type');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: weird-type
description: Unknown type skill
metadata:
  type: totally-unknown
  hooks: post
---

Some prompt.
`);

    vi.resetModules();
    const { reloadPostExecutionSkills: reload } = await import('../src/post-execution-skills.js');
    const skills = reload();
    const skill = skills.find((s) => s.id === 'weird-type');

    expect(skill).toBeDefined();
    expect(skill?.type).toBe('follow-up');
  });
});
