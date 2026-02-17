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
    expect(prompt).toContain('Keep wording short and scannable');
    expect(prompt).toContain('Avoid walls of text');
    expect(prompt).toContain('Avoid line-level implementation details');
    expect(prompt).toContain('Agent Contract');
    expect(prompt).toContain('<state_contract version="2">');
    expect(prompt).not.toContain('reference files/functions when possible');
  });

  it('guides foreman outputs to be inline and session-scoped', async () => {
    const prompt = await buildPlanningSystemPrompt('/tmp/workspace', 'workspace-not-registered');

    expect(prompt).toContain('high-level summary plan');
    expect(prompt).toContain('Keep wording concise, easy to scan, and not wordy');
    expect(prompt).toContain('Avoid line-level implementation details');
    expect(prompt).toContain('Task Factory planning agent');
    expect(prompt).toContain('Agent Contract');
    expect(prompt).toContain('foreman');
    expect(prompt).toContain('### web_search');
    expect(prompt).toContain('### web_fetch');
    expect(prompt).toContain('### create_artifact');
    expect(prompt).toContain('### manage_new_task');
    expect(prompt).toContain('### manage_tasks');
    expect(prompt).toContain('### message_agent');
    expect(prompt).toContain('inline draft-task card');
    expect(prompt).not.toContain('draft task on the shelf');
    expect(prompt).not.toContain('reference specific files, functions, and components');
  });
});
