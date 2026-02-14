import { describe, expect, it } from 'vitest';
import { reloadPostExecutionSkills } from '../src/post-execution-skills.js';

describe('execution skill discovery', () => {
  it('discovers starter skills with hook metadata and prompt content', () => {
    const skills = reloadPostExecutionSkills();
    const captureScreenshot = skills.find((skill) => skill.id === 'capture-screenshot');

    expect(captureScreenshot).toBeDefined();
    expect(captureScreenshot?.source).toBe('starter');
    expect(captureScreenshot?.type).toBe('follow-up');
    expect(captureScreenshot?.hooks).toEqual(['post']);
    expect(captureScreenshot?.promptTemplate).toContain('attach_task_file');
    expect(captureScreenshot?.promptTemplate).toContain('agent-browser screenshot');
  });

  it('discovers tdd skills as a paired workflow split across pre/post hooks', () => {
    const skills = reloadPostExecutionSkills();

    const tddPre = skills.find((skill) => skill.id === 'tdd-test-first');
    expect(tddPre).toBeDefined();
    expect(tddPre?.type).toBe('follow-up');
    expect(tddPre?.hooks).toEqual(['pre']);
    expect(tddPre?.workflowId).toBe('tdd');
    expect(tddPre?.pairedSkillId).toBe('tdd-verify-tests');

    const tddPrePrompt = tddPre?.promptTemplate.toLowerCase() ?? '';
    expect(tddPrePrompt).toContain('write or update all required tests before implementing');
    expect(tddPrePrompt).toContain('run the relevant tests in this pre-execution phase');
    expect(tddPrePrompt).toContain('do not implement production code in this pre-execution step');

    const tddPost = skills.find((skill) => skill.id === 'tdd-verify-tests');
    expect(tddPost).toBeDefined();
    expect(tddPost?.type).toBe('follow-up');
    expect(tddPost?.hooks).toEqual(['post']);
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
