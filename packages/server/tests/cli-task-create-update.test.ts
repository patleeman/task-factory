import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildTaskUpdateRequest,
  resolveTaskContentFromOptions,
} from '../../../bin/task-factory.js';

describe('task create content source resolution', () => {
  it('reads UTF-8 content from --file', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'task-factory-create-file-'));

    try {
      const contentFile = join(tempDir, 'task.md');
      writeFileSync(contentFile, '# Spec\n\nShip file-based content.\n', 'utf-8');

      const content = resolveTaskContentFromOptions({
        content: 'inline fallback',
        file: contentFile,
      });

      expect(content).toBe('# Spec\n\nShip file-based content.\n');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('throws a user-facing error when --file cannot be read', () => {
    const missingFile = join(tmpdir(), 'task-factory-missing-file.md');

    expect(() => resolveTaskContentFromOptions({ file: missingFile })).toThrow(
      `Failed to read file ${missingFile}`,
    );
  });
});

describe('task update payload mapping', () => {
  it('maps supported update flags into the server update contract', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'task-factory-update-file-'));

    try {
      const contentFile = join(tempDir, 'update.md');
      writeFileSync(contentFile, 'Updated from file\n', 'utf-8');

      const updateRequest = buildTaskUpdateRequest({
        title: 'Updated title',
        content: 'inline content should be overridden',
        file: contentFile,
        acceptanceCriteria: 'one,two',
        planGoal: 'Ship CLI lifecycle improvements',
        planSteps: 'Add file support,Add update tests',
        modelProvider: 'openai',
        modelId: 'gpt-5-codex',
        prePlanningSkills: 'plan-a,plan-b',
        preExecutionSkills: 'exec-a,exec-b',
        postExecutionSkills: 'post-a,post-b',
      });

      expect(updateRequest).toEqual({
        title: 'Updated title',
        content: 'Updated from file\n',
        acceptanceCriteria: ['one', 'two'],
        prePlanningSkills: ['plan-a', 'plan-b'],
        preExecutionSkills: ['exec-a', 'exec-b'],
        postExecutionSkills: ['post-a', 'post-b'],
        executionModelConfig: {
          provider: 'openai',
          modelId: 'gpt-5-codex',
        },
        modelConfig: {
          provider: 'openai',
          modelId: 'gpt-5-codex',
        },
        plan: {
          goal: 'Ship CLI lifecycle improvements',
          steps: ['Add file support', 'Add update tests'],
        },
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
