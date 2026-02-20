import { describe, expect, it } from 'vitest';
import {
  normalizeTaskPlan,
  normalizeVisualPlan,
} from '../../shared/src/types.ts';

describe('visual plan normalization', () => {
  it('normalizes architecture diff sections with current/planned mermaid diagrams', () => {
    const normalized = normalizeVisualPlan({
      version: '1',
      sections: [
        {
          component: 'ArchitectureDiff',
          current: { label: 'Current', code: 'graph TD\nA-->B' },
          planned: { label: 'Planned', code: 'graph TD\nA-->C' },
        },
      ],
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.sections[0]).toMatchObject({
      component: 'ArchitectureDiff',
      current: { code: 'graph TD\nA-->B' },
      planned: { code: 'graph TD\nA-->C' },
    });
  });

  it('converts invalid architecture diff into unknown fallback metadata', () => {
    const normalized = normalizeVisualPlan({
      version: '1',
      sections: [
        {
          component: 'ArchitectureDiff',
          current: { label: 'Current', code: '' },
          planned: { label: 'Planned', code: 'graph TD\nA-->C' },
        },
      ],
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.sections[0]).toMatchObject({
      component: 'Unknown',
      originalComponent: 'ArchitectureDiff',
      reason: 'invalid-architecture-diff',
    });
  });

  it('backfills visualPlan from legacy plan fields', () => {
    const plan = normalizeTaskPlan({
      goal: 'Ship visual plan support',
      steps: ['Add shared schema'],
      validation: ['Run tests'],
      cleanup: [],
      generatedAt: '2026-02-20T00:00:00.000Z',
    });

    expect(plan).toBeDefined();
    expect(plan?.visualPlan?.sections.length).toBeGreaterThan(0);
    expect(plan?.visualPlan?.sections[0]).toMatchObject({ component: 'SummaryHero' });
  });
});
