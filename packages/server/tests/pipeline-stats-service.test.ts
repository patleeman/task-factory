import { describe, expect, it } from 'vitest';
import type { PhaseTransition, Task, TaskFrontmatter } from '@task-factory/shared';
import { buildWorkspacePipelineStats } from '../src/pipeline-stats-service.js';

function makeTask(
  id: string,
  overrides: Partial<TaskFrontmatter> = {},
  history: PhaseTransition[] = [],
): Task {
  const frontmatter: TaskFrontmatter = {
    id,
    title: id,
    phase: 'backlog',
    created: '2026-02-01T00:00:00.000Z',
    updated: '2026-02-01T00:00:00.000Z',
    workspace: '/tmp/workspace',
    project: 'workspace',
    blockedCount: 0,
    blockedDuration: 0,
    order: 0,
    acceptanceCriteria: [],
    testingInstructions: [],
    commits: [],
    attachments: [],
    blocked: { isBlocked: false },
    ...overrides,
  };

  return {
    id,
    frontmatter,
    content: '',
    history,
    filePath: `/tmp/workspace/tasks/${id}/task.yaml`,
  };
}

describe('pipeline-stats-service', () => {
  it('aggregates funnel, rework, model slices, and flow summaries', () => {
    const transitionsA: PhaseTransition[] = [
      { from: 'backlog', to: 'ready', timestamp: '2026-02-01T00:00:00.000Z', actor: 'user' },
      { from: 'ready', to: 'executing', timestamp: '2026-02-02T00:00:00.000Z', actor: 'system' },
      { from: 'executing', to: 'complete', timestamp: '2026-02-03T00:00:00.000Z', actor: 'agent' },
      { from: 'complete', to: 'ready', timestamp: '2026-02-04T00:00:00.000Z', actor: 'user' },
      { from: 'ready', to: 'executing', timestamp: '2026-02-05T00:00:00.000Z', actor: 'system' },
      { from: 'executing', to: 'complete', timestamp: '2026-02-06T00:00:00.000Z', actor: 'agent' },
      { from: 'complete', to: 'archived', timestamp: '2026-02-07T00:00:00.000Z', actor: 'user' },
    ];

    const transitionsB: PhaseTransition[] = [
      { from: 'backlog', to: 'ready', timestamp: '2026-02-01T00:00:00.000Z', actor: 'user' },
      { from: 'ready', to: 'executing', timestamp: '2026-02-02T00:00:00.000Z', actor: 'system' },
      { from: 'executing', to: 'complete', timestamp: '2026-02-04T00:00:00.000Z', actor: 'agent' },
    ];

    const tasks: Task[] = [
      makeTask('TASK-1', {
        phase: 'archived',
        completed: '2026-02-07T00:00:00.000Z',
        cycleTime: 300,
        leadTime: 600,
        planningModelConfig: { provider: 'openai', modelId: 'gpt-5' },
        executionModelConfig: { provider: 'anthropic', modelId: 'claude-sonnet-4' },
      }, transitionsA),
      makeTask('TASK-2', {
        phase: 'complete',
        completed: '2026-02-04T00:00:00.000Z',
        cycleTime: 600,
        leadTime: 900,
        modelConfig: { provider: 'openai', modelId: 'gpt-4.1' },
      }, transitionsB),
      makeTask('TASK-3', {
        phase: 'backlog',
      }),
    ];

    const stats = buildWorkspacePipelineStats(tasks, '2026-02-08T00:00:00.000Z');

    expect(stats.taskCount).toBe(3);
    expect(stats.funnel.phaseCounts.backlog).toBe(1);
    expect(stats.funnel.phaseCounts.complete).toBe(1);
    expect(stats.funnel.phaseCounts.archived).toBe(1);

    expect(stats.funnel.phaseTransitions.backlog.out).toBe(2);
    expect(stats.funnel.phaseTransitions.ready.in).toBe(3);
    expect(stats.funnel.phaseTransitions.ready.out).toBe(3);

    expect(stats.funnel.conversionRates.backlogToReady.count).toBe(2);
    expect(stats.funnel.conversionRates.backlogToReady.denominator).toBe(2);
    expect(stats.funnel.conversionRates.backlogToReady.rate).toBe(1);

    expect(stats.funnel.conversionRates.completeToArchived.count).toBe(1);
    expect(stats.funnel.conversionRates.completeToArchived.denominator).toBe(2);
    expect(stats.funnel.conversionRates.completeToArchived.rate).toBe(0.5);

    expect(stats.rework.completeToReadyTransitionCount).toBe(1);
    expect(stats.rework.tasksReworkedAtLeastOnce).toBe(1);
    expect(stats.rework.completedTaskCount).toBe(2);
    expect(stats.rework.reworkRate).toBe(0.5);

    expect(stats.rework.planningModels).toEqual([
      {
        model: 'openai/gpt-5',
        completedTaskCount: 1,
        reworkedTaskCount: 1,
        reworkRate: 1,
      },
      {
        model: 'openai/gpt-4.1',
        completedTaskCount: 1,
        reworkedTaskCount: 0,
        reworkRate: 0,
      },
    ]);

    expect(stats.rework.executionModels).toEqual([
      {
        model: 'anthropic/claude-sonnet-4',
        completedTaskCount: 1,
        reworkedTaskCount: 1,
        reworkRate: 1,
      },
      {
        model: 'openai/gpt-4.1',
        completedTaskCount: 1,
        reworkedTaskCount: 0,
        reworkRate: 0,
      },
    ]);

    expect(stats.flow.completedTasksWithTimestamp).toBe(2);
    expect(stats.flow.throughputPerDay).toBeCloseTo(2 / 3, 5);
    expect(stats.flow.cycleTime).toEqual({
      average: 450,
      median: 450,
      p95: 600,
      sampleSize: 2,
    });
    expect(stats.flow.leadTime).toEqual({
      average: 750,
      median: 750,
      p95: 900,
      sampleSize: 2,
    });
  });

  it('handles empty transitions, unknown models, and missing timing without NaN/Infinity', () => {
    const tasks: Task[] = [
      makeTask('TASK-9', {
        phase: 'ready',
      }, []),
      makeTask('TASK-10', {
        phase: 'archived',
        completed: 'invalid-date',
        cycleTime: 0,
        leadTime: undefined,
      }, []),
      makeTask('TASK-11', {
        phase: 'archived',
        completed: '2026-02-08T00:00:00.000Z',
      }, [
        { from: 'backlog', to: 'ready', timestamp: '2026-02-02T00:00:00.000Z', actor: 'user' },
        { from: 'ready', to: 'executing', timestamp: '2026-02-03T00:00:00.000Z', actor: 'user' },
        { from: 'executing', to: 'complete', timestamp: '2026-02-04T00:00:00.000Z', actor: 'user' },
      ]),
    ];

    const stats = buildWorkspacePipelineStats(tasks);

    expect(stats.funnel.conversionRates.completeToArchived.denominator).toBe(0);
    expect(stats.funnel.conversionRates.completeToArchived.rate).toBe(0);

    expect(stats.rework.completeToReadyTransitionCount).toBe(0);
    expect(stats.rework.tasksReworkedAtLeastOnce).toBe(0);
    expect(stats.rework.completedTaskCount).toBe(1);
    expect(stats.rework.planningModels).toEqual([
      {
        model: 'unknown',
        completedTaskCount: 1,
        reworkedTaskCount: 0,
        reworkRate: 0,
      },
    ]);
    expect(stats.rework.executionModels).toEqual([
      {
        model: 'unknown',
        completedTaskCount: 1,
        reworkedTaskCount: 0,
        reworkRate: 0,
      },
    ]);

    expect(stats.flow.cycleTime).toEqual({
      average: 0,
      median: 0,
      p95: 0,
      sampleSize: 0,
    });
    expect(stats.flow.leadTime).toEqual({
      average: 0,
      median: 0,
      p95: 0,
      sampleSize: 0,
    });
    expect(Number.isFinite(stats.flow.throughputPerDay)).toBe(true);

    // API response contract shape
    expect(stats).toMatchObject({
      funnel: {
        phaseCounts: expect.any(Object),
        phaseTransitions: expect.any(Object),
        conversionRates: {
          backlogToReady: expect.any(Object),
          readyToExecuting: expect.any(Object),
          executingToComplete: expect.any(Object),
          completeToArchived: expect.any(Object),
        },
      },
      rework: {
        completeToReadyTransitionCount: expect.any(Number),
        tasksReworkedAtLeastOnce: expect.any(Number),
        reworkRate: expect.any(Number),
        planningModels: expect.any(Array),
        executionModels: expect.any(Array),
      },
      flow: {
        throughputPerDay: expect.any(Number),
        cycleTime: expect.any(Object),
        leadTime: expect.any(Object),
      },
    });
  });
});
