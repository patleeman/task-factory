import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(currentDir, '../../../bin/task-factory.js');
const readmePath = resolve(currentDir, '../../../README.md');
const serverPath = resolve(currentDir, '../src/index.ts');

const cliSource = readFileSync(cliPath, 'utf-8');
const readmeSource = readFileSync(readmePath, 'utf-8');
const serverSource = readFileSync(serverPath, 'utf-8');

describe('network defaults regression checks', () => {
  it('defaults CLI HOST to loopback while preserving explicit HOST pass-through', () => {
    expect(cliSource).toContain("const host = process.env.HOST || config.host || DEFAULT_HOST;");
    expect(cliSource).toContain('env: { ...process.env, PORT: port, HOST: host },');
  });

  it('documents HOST environment variable usage in CLI source', () => {
    expect(cliSource).toContain("process.env.HOST");
  });

  it('documents HOST configuration and explicit network exposure in README', () => {
    expect(readmeSource).toContain('HOST=0.0.0.0 task-factory');
    expect(readmeSource).toContain('explicit opt-in');
  });

  it('logs non-loopback startup warnings through server bootstrap', () => {
    expect(serverSource).toContain('const nonLoopbackWarning = getNonLoopbackBindWarning(HOST, PORT);');
    expect(serverSource).toContain('logger.warn(nonLoopbackWarning.message, nonLoopbackWarning.data);');
  });
});
