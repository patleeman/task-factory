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
});
