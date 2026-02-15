import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@pi-factory/shared';
import { prepareTaskUpdateRequest } from '../src/task-update-service.js';

function createTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();

  return {
    id: 'TASK-1',
    frontmatter: {
      id: 'TASK-1',
      title: 'Original Title',
      phase: 'backlog',
      created: now,
      updated: now,
      workspace: '/tmp/workspace',
      project: 'workspace',
      blockedCount: 0,
      blockedDuration: 0,
      order: 0,
      acceptanceCriteria: ['Existing criterion'],
      testingInstructions: [],
      commits: [],
      attachments: [],
      blocked: { isBlocked: false },
    },
    content: 'Original description',
    history: [],
    filePath: '/tmp/workspace/.taskfactory/tasks/task-1.md',
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('prepareTaskUpdateRequest', () => {
  it('regenerates title when content changes', async () => {
    const task = createTask();
    const generateTitle = vi.fn(async () => 'Regenerated Title');

    const result = await prepareTaskUpdateRequest(
      task,
      {
        content: 'Updated description',
      },
      generateTitle,
    );

    expect(result.titleRegenerated).toBe(true);
    expect(generateTitle).toHaveBeenCalledWith('Updated description', ['Existing criterion']);
    expect(result.request.title).toBe('Regenerated Title');
    expect(result.request.content).toBe('Updated description');
  });

  it('does not regenerate title when content is unchanged', async () => {
    const task = createTask();
    const generateTitle = vi.fn(async () => 'Should not be used');

    const request = {
      content: 'Original description',
      title: 'Manual title stays',
    };

    const result = await prepareTaskUpdateRequest(task, request, generateTitle);

    expect(result.titleRegenerated).toBe(false);
    expect(generateTitle).not.toHaveBeenCalled();
    expect(result.request).toEqual(request);
  });

  it('does not regenerate title when content is omitted', async () => {
    const task = createTask();
    const generateTitle = vi.fn(async () => 'Should not be used');

    const request = {
      title: 'Manual title stays',
    };

    const result = await prepareTaskUpdateRequest(task, request, generateTitle);

    expect(result.titleRegenerated).toBe(false);
    expect(generateTitle).not.toHaveBeenCalled();
    expect(result.request).toEqual(request);
  });

  it('overrides client-supplied title when content changes', async () => {
    const task = createTask();
    const generateTitle = vi.fn(async () => 'Generated from content');

    const result = await prepareTaskUpdateRequest(
      task,
      {
        content: 'New description context',
        title: 'Client provided title',
      },
      generateTitle,
    );

    expect(result.titleRegenerated).toBe(true);
    expect(result.request.title).toBe('Generated from content');
  });

  it('uses updated acceptance criteria when regenerating title', async () => {
    const task = createTask();
    const generateTitle = vi.fn(async () => 'Generated from updated context');

    await prepareTaskUpdateRequest(
      task,
      {
        content: 'New description context',
        acceptanceCriteria: ['New criterion'],
      },
      generateTitle,
    );

    expect(generateTitle).toHaveBeenCalledWith('New description context', ['New criterion']);
  });

  it('falls back to description-based title when generation fails', async () => {
    const task = createTask();
    const generateTitle = vi.fn(async () => {
      throw new Error('model failure');
    });

    const result = await prepareTaskUpdateRequest(
      task,
      {
        content: 'Use this updated description as fallback title',
      },
      generateTitle,
    );

    expect(result.titleRegenerated).toBe(true);
    expect(result.request.title).toBe('Use this updated description as fallback title');
  });

  it('falls back to description-based title when generation returns an empty title', async () => {
    const task = createTask();
    const generateTitle = vi.fn(async () => '   ');

    const result = await prepareTaskUpdateRequest(
      task,
      {
        content: 'Fallback title for empty output',
      },
      generateTitle,
    );

    expect(result.titleRegenerated).toBe(true);
    expect(result.request.title).toBe('Fallback title for empty output');
  });

  it('falls back to description-based title when generation times out', async () => {
    vi.useFakeTimers();

    const task = createTask();
    const generateTitle = vi.fn(() => new Promise<string>(() => {}));

    const resultPromise = prepareTaskUpdateRequest(
      task,
      {
        content: 'Timeout fallback title',
      },
      generateTitle,
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const result = await resultPromise;

    expect(result.titleRegenerated).toBe(true);
    expect(result.request.title).toBe('Timeout fallback title');
  });
});
