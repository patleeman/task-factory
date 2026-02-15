import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(currentDir, '../../../bin/pi-factory.js');
const readmePath = resolve(currentDir, '../../../README.md');
const serverPath = resolve(currentDir, '../src/index.ts');

const cliSource = readFileSync(cliPath, 'utf-8');
const readmeSource = readFileSync(readmePath, 'utf-8');
const serverSource = readFileSync(serverPath, 'utf-8');

describe('network defaults regression checks', () => {
  it('defaults CLI HOST to loopback while preserving explicit HOST pass-through', () => {
    expect(cliSource).toContain("const host = process.env.HOST?.trim() || '127.0.0.1';");
    expect(cliSource).toContain('env: { ...process.env, PORT: port, HOST: host },');
  });

  it('documents loopback default and explicit network exposure in CLI help text', () => {
    expect(cliSource).toContain('HOST            Server host (default: 127.0.0.1)');
    expect(cliSource).toContain('HOST=0.0.0.0 pifactory');
    expect(cliSource).toContain('explicit opt-in');
  });

  it('documents loopback default and intentional HOST override in README', () => {
    expect(readmeSource).toContain('| `HOST` | `127.0.0.1` |');
    expect(readmeSource).toContain('set `HOST=0.0.0.0` to intentionally expose on your network');
    expect(readmeSource).toContain('HOST=0.0.0.0 pifactory  # Expose on your network (explicit opt-in)');
  });

  it('logs non-loopback startup warnings through server bootstrap', () => {
    expect(serverSource).toContain('const nonLoopbackWarning = getNonLoopbackBindWarning(HOST, PORT);');
    expect(serverSource).toContain('logger.warn(nonLoopbackWarning.message, nonLoopbackWarning.data);');
  });
});
