import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createTask, parseTaskFile } from '../src/task-service.js';
import { attachTaskFileAndBroadcast, attachTaskFileToTask } from '../src/task-attachment-service.js';

const tempRoots: string[] = [];

function createTempWorkspace(): { workspacePath: string; tasksDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'pi-factory-attach-task-file-'));
  tempRoots.push(root);

  const workspacePath = join(root, 'workspace');
  const tasksDir = join(workspacePath, '.taskfactory', 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  return { workspacePath, tasksDir };
}

afterEach(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

describe('attachTaskFileToTask', () => {
  it('copies the file, persists attachment metadata, and broadcasts task updates', async () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const task = createTask(workspacePath, tasksDir, {
      title: 'Attach screenshot',
      content: 'Attach validation screenshot',
      acceptanceCriteria: [],
    });

    const screenshotPath = join(workspacePath, 'validation.png');
    writeFileSync(screenshotPath, 'fake-png-data', 'utf-8');

    const events: any[] = [];
    const result = await attachTaskFileAndBroadcast(
      workspacePath,
      task.id,
      {
        path: screenshotPath,
        filename: 'ui-validation.png',
      },
      (event) => events.push(event),
    );

    const attachmentPath = join(
      workspacePath,
      '.taskfactory',
      'tasks',
      task.id.toLowerCase(),
      'attachments',
      result.attachment.storedName,
    );

    expect(result.attachment.filename).toBe('ui-validation.png');
    expect(result.attachment.mimeType).toBe('image/png');
    expect(result.attachment.size).toBe('fake-png-data'.length);
    expect(existsSync(attachmentPath)).toBe(true);

    const persisted = parseTaskFile(task.filePath);
    expect(persisted.frontmatter.attachments.some((att) => att.id === result.attachment.id)).toBe(true);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'task:updated',
      task: {
        id: task.id,
      },
    });
  });

  it('fails clearly for missing files and does not mutate task attachment metadata', async () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const task = createTask(workspacePath, tasksDir, {
      title: 'Missing screenshot',
      content: 'Should fail cleanly',
      acceptanceCriteria: [],
    });

    await expect(
      attachTaskFileToTask(workspacePath, task.id, {
        path: join(workspacePath, 'does-not-exist.png'),
      }),
    ).rejects.toThrow('Source file not found');

    const persisted = parseTaskFile(task.filePath);
    expect(persisted.frontmatter.attachments).toEqual([]);
  });

  it('rejects directory paths and keeps attachments unchanged', async () => {
    const { workspacePath, tasksDir } = createTempWorkspace();

    const task = createTask(workspacePath, tasksDir, {
      title: 'Directory path should fail',
      content: 'Should reject non-file source',
      acceptanceCriteria: [],
    });

    const screenshotDir = join(workspacePath, 'screenshots');
    mkdirSync(screenshotDir, { recursive: true });

    await expect(
      attachTaskFileToTask(workspacePath, task.id, {
        path: screenshotDir,
      }),
    ).rejects.toThrow('Source path is not a file');

    const persisted = parseTaskFile(task.filePath);
    expect(persisted.frontmatter.attachments).toEqual([]);
  });
});
