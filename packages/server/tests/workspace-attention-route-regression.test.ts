import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const serverIndexPath = resolve(currentDir, '../src/index.ts');
const serverIndexSource = readFileSync(serverIndexPath, 'utf-8');

describe('workspace attention route regression checks', () => {
  it('builds per-workspace phase maps from active-only task discovery', () => {
    expect(serverIndexSource).toContain(
      "const tasks = discoverTasks(getTasksDir(workspace), { scope: 'active' });",
    );
  });
});
