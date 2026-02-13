import { describe, expect, it } from 'vitest';
import { buildPlanningPrompt } from '../src/agent-execution-service.js';
import { buildPlanningSystemPrompt } from '../src/planning-agent-service.js';

describe('planning prompt guidance', () => {
  it('asks task planning to save high-level plans instead of line-level implementation checklists', () => {
    const prompt = buildPlanningPrompt(
      {
        id: 'PIFA-43',
        frontmatter: {
          title: 'Simplify plans to high-level task summaries',
          acceptanceCriteria: [],
        },
        content: 'Plans are too detailed.',
      } as any,
      '',
      null,
    );

    expect(prompt).toContain('high-level task summary for humans');
    expect(prompt).toContain('Avoid line-level implementation details');
    expect(prompt).not.toContain('reference files/functions when possible');
  });

  it('guides foreman-created draft task plans to stay concise and high-level', async () => {
    const prompt = await buildPlanningSystemPrompt('/tmp/workspace', 'workspace-not-registered');

    expect(prompt).toContain('high-level summary plan');
    expect(prompt).toContain('Avoid line-level implementation details');
    expect(prompt).not.toContain('reference specific files, functions, and components');
  });
});
