import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function setTempHome(): string {
  const homePath = createTempDir('pi-factory-home-');
  process.env.HOME = homePath;
  process.env.USERPROFILE = homePath;
  return homePath;
}

async function importExtensionManagement() {
  vi.resetModules();
  return import('../src/extension-management-service.js');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();

  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('extension-management-service destination writes', () => {
  it('writes global destination extensions under ~/.taskfactory/extensions', async () => {
    const homePath = setTempHome();
    const { createFactoryExtension } = await importExtensionManagement();

    const result = await createFactoryExtension({
      name: 'global-test-ext',
      audience: 'all',
      typescript: 'export default function () {}\n',
      destination: 'global',
    });

    expect(result.success).toBe(true);
    expect(result.path).toBe(join(homePath, '.taskfactory', 'extensions', 'global-test-ext.ts'));
    expect(existsSync(result.path!)).toBe(true);
  });

  it('writes repo-local destination extensions under <workspace>/.taskfactory/extensions', async () => {
    setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');
    const { createFactoryExtension } = await importExtensionManagement();

    const result = await createFactoryExtension({
      name: 'repo-test-ext',
      audience: 'foreman',
      typescript: 'export default function () {}\n',
      destination: 'repo-local',
      workspacePath,
    });

    expect(result.success).toBe(true);
    expect(result.path).toBe(join(workspacePath, '.taskfactory', 'extensions', 'repo-test-ext.ts'));
    expect(existsSync(result.path!)).toBe(true);
  });

  it('rejects repo-local destination when workspacePath is missing', async () => {
    setTempHome();
    const { createFactoryExtension } = await importExtensionManagement();

    const result = await createFactoryExtension({
      name: 'repo-missing-workspace',
      audience: 'task',
      typescript: 'export default function () {}\n',
      destination: 'repo-local',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('workspacePath is required for repo-local extension destination');
  });
});
