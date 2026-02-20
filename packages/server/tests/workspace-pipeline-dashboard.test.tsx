import React from '../../client/node_modules/react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from '../../client/node_modules/react-dom/server';
import type { WorkspacePipelineStats } from '../../client/src/api';
import { PipelineStatsPanel } from '../../client/src/components/WorkspacePipelineDashboard';

function renderPanel(props: {
  stats: WorkspacePipelineStats | null;
  isLoading: boolean;
  error: string | null;
}): string {
  return renderToStaticMarkup(<PipelineStatsPanel {...props} />);
}

const sampleStats: WorkspacePipelineStats = {
  generatedAt: '2026-02-20T00:00:00.000Z',
  taskCount: 12,
  funnel: {
    phaseCounts: {
      backlog: 3,
      ready: 2,
      executing: 2,
      complete: 3,
      archived: 2,
    },
    phaseTransitions: {
      backlog: { in: 0, out: 4 },
      ready: { in: 5, out: 4 },
      executing: { in: 4, out: 3 },
      complete: { in: 3, out: 2 },
      archived: { in: 2, out: 0 },
    },
    conversionRates: {
      backlogToReady: { from: 'backlog', to: 'ready', count: 4, denominator: 4, rate: 1 },
      readyToExecuting: { from: 'ready', to: 'executing', count: 3, denominator: 4, rate: 0.75 },
      executingToComplete: { from: 'executing', to: 'complete', count: 3, denominator: 3, rate: 1 },
      completeToArchived: { from: 'complete', to: 'archived', count: 2, denominator: 2, rate: 1 },
    },
  },
  rework: {
    completeToReadyTransitionCount: 1,
    tasksReworkedAtLeastOnce: 1,
    completedTaskCount: 5,
    reworkRate: 0.2,
    planningModels: [
      { model: 'openai/gpt-5', completedTaskCount: 4, reworkedTaskCount: 1, reworkRate: 0.25 },
    ],
    executionModels: [
      { model: 'anthropic/claude-sonnet-4', completedTaskCount: 5, reworkedTaskCount: 1, reworkRate: 0.2 },
    ],
  },
  flow: {
    completedTasksWithTimestamp: 5,
    throughputPerDay: 1.25,
    cycleTime: { average: 3600, median: 3200, p95: 7000, sampleSize: 5 },
    leadTime: { average: 7200, median: 6500, p95: 11000, sampleSize: 5 },
  },
};

describe('WorkspacePipelineDashboard panel', () => {
  it('renders loading, empty, and error states', () => {
    const loadingMarkup = renderPanel({ stats: null, isLoading: true, error: null });
    expect(loadingMarkup).toContain('Loading pipeline stats');

    const emptyMarkup = renderPanel({
      stats: { ...sampleStats, taskCount: 0 },
      isLoading: false,
      error: null,
    });
    expect(emptyMarkup).toContain('No pipeline data yet');

    const errorMarkup = renderPanel({ stats: null, isLoading: false, error: 'boom' });
    expect(errorMarkup).toContain('Unable to load pipeline stats');
    expect(errorMarkup).toContain('boom');
  });

  it('renders summary cards, funnel view, and model rework tables', () => {
    const markup = renderPanel({ stats: sampleStats, isLoading: false, error: null });

    expect(markup).toContain('Throughput / day');
    expect(markup).toContain('Complete → Ready');
    expect(markup).toContain('backlog → ready');
    expect(markup).toContain('Rework by planning model');
    expect(markup).toContain('Rework by execution model');
    expect(markup).toContain('openai/gpt-5');
    expect(markup).toContain('anthropic/claude-sonnet-4');
  });
});
