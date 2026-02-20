import React from '../../client/node_modules/react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from '../../client/node_modules/react-dom/server';
import type { TaskPlan } from '@task-factory/shared';

vi.mock('../../client/src/components/AppIcon', () => ({
  AppIcon: () => null,
}));

import { VisualPlanPanel } from '../../client/src/components/TaskDetailPane';

function renderPlan(plan: TaskPlan): string {
  return renderToStaticMarkup(<VisualPlanPanel plan={plan} />);
}

describe('TaskDetail visual plan rendering', () => {
  it('renders required structured sections, including architecture diff diagrams', () => {
    const markup = renderPlan({
      goal: 'Goal',
      steps: ['Step'],
      validation: ['Check'],
      cleanup: ['Later'],
      generatedAt: new Date().toISOString(),
      visualPlan: {
        version: '1',
        sections: [
          { component: 'SummaryHero', problem: 'Problem', insight: 'Insight', outcome: 'Outcome' },
          { component: 'ImpactStats', stats: [{ label: 'Files', value: '6' }] },
          {
            component: 'ArchitectureDiff',
            current: { label: 'Current', code: 'graph TD\nA-->B' },
            planned: { label: 'Planned', code: 'graph TD\nA-->C' },
          },
          { component: 'ChangeList', items: [{ area: 'Server', change: 'Store visual plans' }] },
          { component: 'Risks', items: [{ risk: 'Migration regressions', severity: 'medium', mitigation: 'Legacy adapter' }] },
          { component: 'OpenQuestions', items: [{ question: 'Any extra sections?' }] },
          { component: 'ValidationPlan', checks: ['Run tests'] },
          { component: 'DecisionLog', entries: [{ decision: 'Mermaid-first', rationale: 'Readable diffs' }] },
          { component: 'NextSteps', items: ['Ship it'] },
          { component: 'FutureWork', items: ['Interactive editing'] },
        ],
      },
    });

    expect(markup).toContain('Problem');
    expect(markup).toContain('Files');
    expect(markup).toContain('Current');
    expect(markup).toContain('Planned');
    expect(markup).toContain('Store visual plans');
    expect(markup).toContain('Migration regressions');
    expect(markup).toContain('Any extra sections?');
    expect(markup).toContain('Run tests');
    expect(markup).toContain('Mermaid-first');
    expect(markup).toContain('Interactive editing');
  });

  it('shows graceful fallback for invalid mermaid and unknown sections', () => {
    const markup = renderPlan({
      goal: 'Goal',
      steps: [],
      validation: [],
      cleanup: [],
      generatedAt: new Date().toISOString(),
      visualPlan: {
        version: '1',
        sections: [
          {
            component: 'ArchitectureDiff',
            current: { label: 'Current', code: '<script>alert(1)</script>' },
            planned: { label: 'Planned', code: 'graph TD\nA-->B' },
          },
          {
            component: 'Unknown',
            originalComponent: 'MadeUp',
            reason: 'unsupported-component',
          },
        ],
      },
    });

    expect(markup).toContain('Invalid Mermaid diagram payload');
    expect(markup).toContain('Unknown plan section');
  });
});
