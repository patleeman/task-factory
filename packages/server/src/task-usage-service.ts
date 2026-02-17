import { existsSync } from 'fs';
import {
  normalizeTaskUsageMetrics,
  type Task,
  type TaskModelUsage,
  type TaskUsageMetrics,
} from '@task-factory/shared';
import { parseTaskFile, saveTaskFile } from './task-service.js';

export interface TaskUsageSample {
  provider: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
}

interface NumericCandidate {
  value: number;
  found: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function pickNumericValue(candidates: unknown[]): NumericCandidate {
  for (const candidate of candidates) {
    const value = parseNumericValue(candidate);
    if (value == null) continue;
    return { value, found: true };
  }

  return { value: 0, found: false };
}

function normalizeTokenCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.round(value);
}

function normalizeCost(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value;
}

function readStringField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function addUsageTotals(
  current: Pick<TaskModelUsage, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'totalTokens' | 'cost'>,
  delta: Pick<TaskModelUsage, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'totalTokens' | 'cost'>,
): Pick<TaskModelUsage, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'totalTokens' | 'cost'> {
  return {
    inputTokens: current.inputTokens + delta.inputTokens,
    outputTokens: current.outputTokens + delta.outputTokens,
    cacheReadTokens: current.cacheReadTokens + delta.cacheReadTokens,
    cacheWriteTokens: current.cacheWriteTokens + delta.cacheWriteTokens,
    totalTokens: current.totalTokens + delta.totalTokens,
    cost: current.cost + delta.cost,
  };
}

/**
 * Parse provider/model and usage from an assistant message.
 * Returns null when no usable usage payload is present.
 */
export function extractTaskUsageSampleFromAssistantMessage(message: unknown): TaskUsageSample | null {
  const record = asRecord(message);
  if (!record) return null;

  if (record.role && record.role !== 'assistant') {
    return null;
  }

  const usage = asRecord(record.usage);
  if (!usage) {
    return null;
  }

  const input = pickNumericValue([
    usage.input,
    usage.inputTokens,
    usage.input_tokens,
    usage.promptTokens,
    usage.prompt_tokens,
  ]);

  const output = pickNumericValue([
    usage.output,
    usage.outputTokens,
    usage.output_tokens,
    usage.completionTokens,
    usage.completion_tokens,
  ]);

  const cacheRead = pickNumericValue([
    usage.cacheRead,
    usage.cacheReadTokens,
    usage.cache_read_input_tokens,
    usage.cacheReadInputTokens,
  ]);

  const cacheWrite = pickNumericValue([
    usage.cacheWrite,
    usage.cacheWriteTokens,
    usage.cache_creation_input_tokens,
    usage.cacheWriteInputTokens,
  ]);

  const explicitTotal = pickNumericValue([
    usage.totalTokens,
    usage.total_tokens,
    usage.total,
  ]);

  const nestedCost = asRecord(usage.cost);
  const cost = pickNumericValue([
    usage.cost,
    usage.costTotal,
    usage.totalCost,
    usage.costUsd,
    nestedCost?.total,
    nestedCost?.amount,
    nestedCost?.usd,
  ]);

  const hasUsageData = input.found
    || output.found
    || cacheRead.found
    || cacheWrite.found
    || explicitTotal.found
    || cost.found;

  if (!hasUsageData) {
    return null;
  }

  const provider = readStringField(record.provider)
    || readStringField(record.modelProvider)
    || 'unknown';

  const modelId = readStringField(record.model)
    || readStringField(record.modelId)
    || 'unknown';

  const inputTokens = normalizeTokenCount(input.value);
  const outputTokens = normalizeTokenCount(output.value);
  const cacheReadTokens = normalizeTokenCount(cacheRead.value);
  const cacheWriteTokens = normalizeTokenCount(cacheWrite.value);

  const computedTotal = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const explicitTotalTokens = normalizeTokenCount(explicitTotal.value);
  const totalTokens = explicitTotal.found && explicitTotalTokens > 0
    ? explicitTotalTokens
    : computedTotal;
  const normalizedCost = normalizeCost(cost.value);

  if (
    inputTokens === 0
    && outputTokens === 0
    && cacheReadTokens === 0
    && cacheWriteTokens === 0
    && totalTokens === 0
    && normalizedCost === 0
  ) {
    return null;
  }

  return {
    provider,
    modelId,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    cost: normalizedCost,
  };
}

export function mergeTaskUsageMetrics(
  current: TaskUsageMetrics | undefined,
  sample: TaskUsageSample,
): TaskUsageMetrics {
  const normalizedCurrent = normalizeTaskUsageMetrics(current);

  const byModel = [...normalizedCurrent.byModel];
  const existingIndex = byModel.findIndex(
    (entry) => entry.provider === sample.provider && entry.modelId === sample.modelId,
  );

  if (existingIndex >= 0) {
    const existing = byModel[existingIndex];
    byModel[existingIndex] = {
      ...existing,
      ...addUsageTotals(existing, sample),
    };
  } else {
    byModel.push({
      provider: sample.provider,
      modelId: sample.modelId,
      inputTokens: sample.inputTokens,
      outputTokens: sample.outputTokens,
      cacheReadTokens: sample.cacheReadTokens,
      cacheWriteTokens: sample.cacheWriteTokens,
      totalTokens: sample.totalTokens,
      cost: sample.cost,
    });
  }

  return {
    totals: addUsageTotals(normalizedCurrent.totals, sample),
    byModel,
  };
}

export function persistTaskUsageSample(task: Task, sample: TaskUsageSample): Task {
  const latestTask = existsSync(task.filePath) ? parseTaskFile(task.filePath) : task;

  latestTask.frontmatter.usageMetrics = mergeTaskUsageMetrics(
    latestTask.frontmatter.usageMetrics,
    sample,
  );
  latestTask.frontmatter.updated = new Date().toISOString();

  saveTaskFile(latestTask);
  return latestTask;
}

export function persistTaskUsageFromAssistantMessage(task: Task, message: unknown): Task | null {
  const sample = extractTaskUsageSampleFromAssistantMessage(message);
  if (!sample) {
    return null;
  }

  return persistTaskUsageSample(task, sample);
}
