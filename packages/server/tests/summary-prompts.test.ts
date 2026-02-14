import { describe, expect, it } from 'vitest';
import { buildSummaryPrompt } from '../src/summary-service.js';

describe('summary prompt guidance', () => {
  it('asks for concise, easy-to-scan execution summaries', () => {
    const prompt = buildSummaryPrompt({
      id: 'PIFA-99',
      frontmatter: {
        title: 'Tighten summary output',
        acceptanceCriteria: [],
      },
    } as any);

    expect(prompt).toContain('Keep the summary concise, easy to read, and quick to scan.');
    expect(prompt).toContain('Write 2-3 short sentences (target under ~90 words total).');
    expect(prompt).toContain('Avoid long, dense paragraphs and avoid unnecessary detail.');
    expect(prompt).toContain('trim verbosity so a reviewer can understand the work in a quick glance');
  });

  it('asks for concise evidence when validating acceptance criteria', () => {
    const prompt = buildSummaryPrompt({
      id: 'PIFA-100',
      frontmatter: {
        title: 'Validate concise criterion evidence',
        acceptanceCriteria: ['Feature X works'],
      },
    } as any);

    expect(prompt).toContain('For evidence, write one short sentence');
    expect(prompt).toContain('Keep it concise and concrete.');
  });
});
