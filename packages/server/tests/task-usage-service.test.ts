import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createTask as createTaskFile, discoverTasks } from '../src/task-service.js';
import {
  extractTaskUsageSampleFromAssistantMessage,
  mergeTaskUsageMetrics,
  persistTaskUsageFromAssistantMessage,
} from '../src/task-usage-service.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

function createTempWorkspace(): { workspacePath: string; tasksDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'pi-factory-task-usage-'));
  tempRoots.push(root);

  const workspacePath = join(root, 'workspace');
  const tasksDir = join(workspacePath, '.pi', 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  return { workspacePath, tasksDir };
}

describe('extractTaskUsageSampleFromAssistantMessage', () => {
  it('parses canonical assistant usage payloads', () => {
    const sample = extractTaskUsageSampleFromAssistantMessage({
      role: 'assistant',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      usage: {
        input: 120,
        output: 30,
        cacheRead: 10,
        cacheWrite: 5,
        totalTokens: 165,
        cost: { total: 0.0123 },
      },
    });

    expect(sample).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      totalTokens: 165,
      cost: 0.0123,
    });
  });

  it('supports partial payloads and computes totals when totalTokens is missing', () => {
    const sample = extractTaskUsageSampleFromAssistantMessage({
      role: 'assistant',
      provider: 'openai',
      model: 'gpt-5.2',
      usage: {
        inputTokens: 42,
      },
    });

    expect(sample).toEqual({
      provider: 'openai',
      modelId: 'gpt-5.2',
      inputTokens: 42,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 42,
      cost: 0,
    });
  });

  it('returns null when usage payload is missing or empty', () => {
    expect(extractTaskUsageSampleFromAssistantMessage({
      role: 'assistant',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    })).toBeNull();

    expect(extractTaskUsageSampleFromAssistantMessage({
      role: 'assistant',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      usage: {},
    })).toBeNull();
  });

  it('returns null when usage payload only contains zero or negative values', () => {
    expect(extractTaskUsageSampleFromAssistantMessage({
      role: 'assistant',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      usage: {
        input: -10,
        output: 0,
        totalTokens: 0,
        cost: { total: 0 },
      },
    })).toBeNull();
  });
});

describe('mergeTaskUsageMetrics', () => {
  it('accumulates totals and per-model usage across multiple samples', () => {
    const first = extractTaskUsageSampleFromAssistantMessage({
      role: 'assistant',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      usage: { input: 100, output: 25, totalTokens: 125, cost: { total: 0.01 } },
    });

    const second = extractTaskUsageSampleFromAssistantMessage({
      role: 'assistant',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      usage: { input: 40, output: 10, totalTokens: 50, cost: { total: 0.004 } },
    });

    const third = extractTaskUsageSampleFromAssistantMessage({
      role: 'assistant',
      provider: 'openai',
      model: 'gpt-5.2',
      usage: { input: 10, output: 5, totalTokens: 15, cost: { total: 0.002 } },
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(third).not.toBeNull();

    let usage = mergeTaskUsageMetrics(undefined, first!);
    usage = mergeTaskUsageMetrics(usage, second!);
    usage = mergeTaskUsageMetrics(usage, third!);

    expect(usage.totals).toEqual({
      inputTokens: 150,
      outputTokens: 40,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 190,
      cost: 0.016,
    });

    expect(usage.byModel).toHaveLength(2);

    expect(usage.byModel.find((entry) => entry.provider === 'anthropic' && entry.modelId === 'claude-sonnet-4-20250514'))
      .toEqual({
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-20250514',
        inputTokens: 140,
        outputTokens: 35,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 175,
        cost: 0.014,
      });

    expect(usage.byModel.find((entry) => entry.provider === 'openai' && entry.modelId === 'gpt-5.2'))
      .toEqual({
        provider: 'openai',
        modelId: 'gpt-5.2',
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 15,
        cost: 0.002,
      });
  });
});

describe('persistTaskUsageFromAssistantMessage', () => {
  it('persists cumulative usage to task metadata across multiple message writes', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const task = createTaskFile(workspacePath, tasksDir, {
      title: 'Track usage',
      content: 'usage tracking',
      acceptanceCriteria: ['store usage'],
    });

    const firstUpdate = persistTaskUsageFromAssistantMessage(task, {
      role: 'assistant',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      usage: { input: 80, output: 20, totalTokens: 100, cost: { total: 0.008 } },
    });

    const secondUpdate = persistTaskUsageFromAssistantMessage(task, {
      role: 'assistant',
      provider: 'openai',
      model: 'gpt-5.2',
      usage: { input: 10, output: 5, totalTokens: 15, cost: { total: 0.002 } },
    });

    expect(firstUpdate).not.toBeNull();
    expect(secondUpdate).not.toBeNull();

    const persisted = discoverTasks(tasksDir).find((candidate) => candidate.id === task.id)!;

    expect(persisted.frontmatter.usageMetrics?.totals).toEqual({
      inputTokens: 90,
      outputTokens: 25,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 115,
      cost: 0.01,
    });

    expect(persisted.frontmatter.usageMetrics?.byModel).toEqual([
      {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-20250514',
        inputTokens: 80,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 100,
        cost: 0.008,
      },
      {
        provider: 'openai',
        modelId: 'gpt-5.2',
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 15,
        cost: 0.002,
      },
    ]);
  });

  it('is a no-op when the assistant message has no usage payload', () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const task = createTaskFile(workspacePath, tasksDir, {
      title: 'No usage payload',
      content: 'no-op case',
      acceptanceCriteria: ['stay unchanged'],
    });

    const before = discoverTasks(tasksDir).find((candidate) => candidate.id === task.id)!;

    const result = persistTaskUsageFromAssistantMessage(task, {
      role: 'assistant',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    });

    const after = discoverTasks(tasksDir).find((candidate) => candidate.id === task.id)!;

    expect(result).toBeNull();
    expect(after.frontmatter.usageMetrics).toEqual(before.frontmatter.usageMetrics);
  });
});
