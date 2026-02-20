import { PHASES, type ModelConfig, type Phase, type Task } from '@task-factory/shared';

export interface PipelineDurationSummary {
  average: number;
  median: number;
  p95: number;
  sampleSize: number;
}

export interface PipelineTransitionConversion {
  from: Phase;
  to: Phase;
  count: number;
  denominator: number;
  rate: number;
}

export interface PipelineModelReworkRow {
  model: string;
  completedTaskCount: number;
  reworkedTaskCount: number;
  reworkRate: number;
}

export interface WorkspacePipelineStats {
  generatedAt: string;
  taskCount: number;
  funnel: {
    phaseCounts: Record<Phase, number>;
    phaseTransitions: Record<Phase, { in: number; out: number }>;
    conversionRates: {
      backlogToReady: PipelineTransitionConversion;
      readyToExecuting: PipelineTransitionConversion;
      executingToComplete: PipelineTransitionConversion;
      completeToArchived: PipelineTransitionConversion;
    };
  };
  rework: {
    completeToReadyTransitionCount: number;
    tasksReworkedAtLeastOnce: number;
    completedTaskCount: number;
    reworkRate: number;
    planningModels: PipelineModelReworkRow[];
    executionModels: PipelineModelReworkRow[];
  };
  flow: {
    completedTasksWithTimestamp: number;
    throughputPerDay: number;
    cycleTime: PipelineDurationSummary;
    leadTime: PipelineDurationSummary;
  };
}

interface MutableModelStats {
  completedTaskCount: number;
  reworkedTaskCount: number;
}

function createPhaseCountRecord<T>(factory: () => T): Record<Phase, T> {
  return {
    backlog: factory(),
    ready: factory(),
    executing: factory(),
    complete: factory(),
    archived: factory(),
  };
}

function incrementTransitionCounter(map: Map<string, number>, from: Phase, to: Phase): void {
  const key = `${from}->${to}`;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function getTransitionCount(map: Map<string, number>, from: Phase, to: Phase): number {
  return map.get(`${from}->${to}`) ?? 0;
}

function buildConversionRate(
  transitionCounts: Map<string, number>,
  phaseTransitions: Record<Phase, { in: number; out: number }>,
  from: Phase,
  to: Phase,
): PipelineTransitionConversion {
  const count = getTransitionCount(transitionCounts, from, to);
  const denominator = phaseTransitions[from].out;
  return {
    from,
    to,
    count,
    denominator,
    rate: denominator > 0 ? count / denominator : 0,
  };
}

function hasValidDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function extractModelIdentity(modelConfig: ModelConfig | undefined): string {
  if (!modelConfig || typeof modelConfig !== 'object') return 'unknown';
  const provider = typeof modelConfig.provider === 'string' ? modelConfig.provider.trim() : '';
  const modelId = typeof modelConfig.modelId === 'string' ? modelConfig.modelId.trim() : '';

  if (!provider || !modelId) {
    return 'unknown';
  }

  return `${provider}/${modelId}`;
}

function resolvePlanningModel(task: Task): ModelConfig | undefined {
  return task.frontmatter.planningModelConfig ?? task.frontmatter.modelConfig;
}

function resolveExecutionModel(task: Task): ModelConfig | undefined {
  return task.frontmatter.executionModelConfig ?? task.frontmatter.modelConfig;
}

function buildDurationSummary(values: number[]): PipelineDurationSummary {
  if (values.length === 0) {
    return {
      average: 0,
      median: 0,
      p95: 0,
      sampleSize: 0,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));

  return {
    average: sum / sorted.length,
    median,
    p95: sorted[p95Index],
    sampleSize: sorted.length,
  };
}

function hasTaskReachedComplete(task: Task): boolean {
  if (task.frontmatter.phase === 'complete') {
    return true;
  }

  if (hasValidDate(task.frontmatter.completed)) {
    return true;
  }

  return task.history.some((transition) => transition.to === 'complete');
}

function toModelRows(modelStats: Map<string, MutableModelStats>): PipelineModelReworkRow[] {
  return Array.from(modelStats.entries())
    .map(([model, stats]) => ({
      model,
      completedTaskCount: stats.completedTaskCount,
      reworkedTaskCount: stats.reworkedTaskCount,
      reworkRate: stats.completedTaskCount > 0 ? stats.reworkedTaskCount / stats.completedTaskCount : 0,
    }))
    .sort((left, right) => {
      if (right.reworkedTaskCount !== left.reworkedTaskCount) {
        return right.reworkedTaskCount - left.reworkedTaskCount;
      }

      if (right.completedTaskCount !== left.completedTaskCount) {
        return right.completedTaskCount - left.completedTaskCount;
      }

      return left.model.localeCompare(right.model);
    });
}

function upsertModelStats(
  map: Map<string, MutableModelStats>,
  model: string,
  isReworked: boolean,
): void {
  const current = map.get(model) ?? { completedTaskCount: 0, reworkedTaskCount: 0 };
  current.completedTaskCount += 1;
  if (isReworked) {
    current.reworkedTaskCount += 1;
  }
  map.set(model, current);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function buildWorkspacePipelineStats(tasks: Task[], generatedAt = new Date().toISOString()): WorkspacePipelineStats {
  const phaseCounts = createPhaseCountRecord(() => 0);
  const phaseTransitions = createPhaseCountRecord(() => ({ in: 0, out: 0 }));
  const transitionCounts = new Map<string, number>();

  const reworkedTaskIds = new Set<string>();
  let completeToReadyTransitionCount = 0;

  for (const task of tasks) {
    const phase = task.frontmatter.phase;
    if (PHASES.includes(phase)) {
      phaseCounts[phase] += 1;
    }

    for (const transition of task.history) {
      if (!PHASES.includes(transition.from) || !PHASES.includes(transition.to)) {
        continue;
      }

      phaseTransitions[transition.from].out += 1;
      phaseTransitions[transition.to].in += 1;
      incrementTransitionCounter(transitionCounts, transition.from, transition.to);

      if (transition.from === 'complete' && transition.to === 'ready') {
        completeToReadyTransitionCount += 1;
        reworkedTaskIds.add(task.id);
      }
    }
  }

  const completedTasks = tasks.filter((task) => hasTaskReachedComplete(task));

  const planningModelStats = new Map<string, MutableModelStats>();
  const executionModelStats = new Map<string, MutableModelStats>();

  for (const task of completedTasks) {
    const isReworked = reworkedTaskIds.has(task.id);
    const planningModel = extractModelIdentity(resolvePlanningModel(task));
    const executionModel = extractModelIdentity(resolveExecutionModel(task));

    upsertModelStats(planningModelStats, planningModel, isReworked);
    upsertModelStats(executionModelStats, executionModel, isReworked);
  }

  const completedWithTimestamp = tasks.filter((task) => {
    const phase = task.frontmatter.phase;
    return (phase === 'complete' || phase === 'archived') && hasValidDate(task.frontmatter.completed);
  });

  const completedTimestamps = completedWithTimestamp
    .map((task) => Date.parse(task.frontmatter.completed!))
    .sort((left, right) => left - right);

  let throughputPerDay = 0;
  if (completedTimestamps.length > 0) {
    const first = completedTimestamps[0];
    const last = completedTimestamps[completedTimestamps.length - 1];
    const durationDays = Math.max(1, (last - first) / (24 * 60 * 60 * 1000));
    throughputPerDay = completedTimestamps.length / durationDays;
  }

  const cycleTimes = tasks
    .filter((task) => task.frontmatter.phase === 'complete' || task.frontmatter.phase === 'archived')
    .map((task) => task.frontmatter.cycleTime)
    .filter(isPositiveNumber);

  const leadTimes = tasks
    .filter((task) => task.frontmatter.phase === 'complete' || task.frontmatter.phase === 'archived')
    .map((task) => task.frontmatter.leadTime)
    .filter(isPositiveNumber);

  return {
    generatedAt,
    taskCount: tasks.length,
    funnel: {
      phaseCounts,
      phaseTransitions,
      conversionRates: {
        backlogToReady: buildConversionRate(transitionCounts, phaseTransitions, 'backlog', 'ready'),
        readyToExecuting: buildConversionRate(transitionCounts, phaseTransitions, 'ready', 'executing'),
        executingToComplete: buildConversionRate(transitionCounts, phaseTransitions, 'executing', 'complete'),
        completeToArchived: buildConversionRate(transitionCounts, phaseTransitions, 'complete', 'archived'),
      },
    },
    rework: {
      completeToReadyTransitionCount,
      tasksReworkedAtLeastOnce: reworkedTaskIds.size,
      completedTaskCount: completedTasks.length,
      reworkRate: completedTasks.length > 0 ? reworkedTaskIds.size / completedTasks.length : 0,
      planningModels: toModelRows(planningModelStats),
      executionModels: toModelRows(executionModelStats),
    },
    flow: {
      completedTasksWithTimestamp: completedWithTimestamp.length,
      throughputPerDay,
      cycleTime: buildDurationSummary(cycleTimes),
      leadTime: buildDurationSummary(leadTimes),
    },
  };
}
