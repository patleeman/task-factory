import { describe, expect, it } from 'vitest';

import {
  isJsonOutput,
  shouldSkipConfirmation,
  toWorkspaceJson,
  toTaskJson,
} from '../../../bin/task-factory.js';

describe('agent-friendly CLI option helpers', () => {
  it('detects JSON output mode via --json and --output json', () => {
    expect(isJsonOutput({ json: true })).toBe(true);
    expect(isJsonOutput({ output: 'json' })).toBe(true);
    expect(isJsonOutput({ output: 'JSON' })).toBe(true);
  });

  it('keeps default human output mode when no JSON flags are set', () => {
    expect(isJsonOutput({})).toBe(false);
    expect(isJsonOutput({ output: 'table' })).toBe(false);
  });

  it('supports non-interactive destructive command bypass via --yes or --force', () => {
    expect(shouldSkipConfirmation({ yes: true })).toBe(true);
    expect(shouldSkipConfirmation({ force: true })).toBe(true);
    expect(shouldSkipConfirmation({})).toBe(false);
  });
});

describe('agent-friendly JSON payload shapes', () => {
  it('maps workspace output to stable machine-readable fields', () => {
    const mapped = toWorkspaceJson({
      id: 'ws-123',
      name: 'Demo',
      path: '/tmp/demo',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      extra: 'ignored',
    });

    expect(mapped).toEqual({
      id: 'ws-123',
      name: 'Demo',
      path: '/tmp/demo',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('maps task output to stable machine-readable fields', () => {
    const mapped = toTaskJson({
      id: 'task-123',
      content: 'hello world',
      frontmatter: {
        title: 'My task',
        phase: 'ready',
        workspace: 'ws-123',
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-02T00:00:00.000Z',
        acceptanceCriteria: ['A', 'B'],
      },
    });

    expect(mapped).toEqual({
      id: 'task-123',
      title: 'My task',
      phase: 'ready',
      workspaceId: 'ws-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      acceptanceCriteria: ['A', 'B'],
      content: 'hello world',
    });
  });
});
