import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(currentDir, '../../../bin/task-factory.js');

describe('cli import regression', () => {
  it('workspace import handles missing file without module-resolution startup crash', () => {
    const missingFile = '/tmp/task-factory-cli-import-missing.json';

    const result = spawnSync(process.execPath, [cliPath, 'workspace', 'import', missingFile], {
      encoding: 'utf-8',
      env: process.env,
      timeout: 10_000,
    });

    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

    expect(output).toContain(`Error: File not found: ${missingFile}`);
    expect(output).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(output).not.toContain("Cannot find package 'commander'");
  });
});
