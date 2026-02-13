import { describe, expect, it } from 'vitest';
import { reloadPostExecutionSkills } from '../src/post-execution-skills.js';

describe('post-execution skill discovery', () => {
  it('discovers the capture-screenshot skill with attach workflow instructions', () => {
    const skills = reloadPostExecutionSkills();
    const captureScreenshot = skills.find((skill) => skill.id === 'capture-screenshot');

    expect(captureScreenshot).toBeDefined();
    expect(captureScreenshot?.type).toBe('follow-up');
    expect(captureScreenshot?.promptTemplate).toContain('attach_task_file');
    expect(captureScreenshot?.promptTemplate).toContain('agent-browser screenshot');
  });

  it('discovers tdd skills with explicit test-first and green-test instructions', () => {
    const skills = reloadPostExecutionSkills();

    const tddPre = skills.find((skill) => skill.id === 'tdd-test-first');
    expect(tddPre).toBeDefined();
    expect(tddPre?.type).toBe('follow-up');

    const tddPrePrompt = tddPre?.promptTemplate.toLowerCase() ?? '';
    expect(tddPrePrompt).toContain('write or update all required tests before implementing');
    expect(tddPrePrompt).toContain('run the relevant tests in this pre-execution phase');
    expect(tddPrePrompt).toContain('do not implement production code in this pre-execution step');

    const tddPost = skills.find((skill) => skill.id === 'tdd-verify-tests');
    expect(tddPost).toBeDefined();
    expect(tddPost?.type).toBe('follow-up');

    const tddPostPrompt = tddPost?.promptTemplate.toLowerCase() ?? '';
    expect(tddPostPrompt).toContain('run the relevant tests after implementation');
    expect(tddPostPrompt).toContain('fix implementation and/or tests until they pass');
    expect(tddPostPrompt).toContain('do not consider the task complete until the added tests are green');
  });
});
