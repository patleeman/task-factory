import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function writeWorkspaceFactoryConfig(workspacePath: string) {
  const storageDir = join(workspacePath, '.taskfactory');
  mkdirSync(storageDir, { recursive: true });
  writeFileSync(
    join(storageDir, 'factory.json'),
    JSON.stringify({
      taskLocations: ['tasks'],
      defaultTaskLocation: 'tasks',
    }),
    'utf-8',
  );
}

describe('workspace-service', () => {
  let testHome: string;

  beforeEach(() => {
    testHome = join(tmpdir(), `tf-workspace-service-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    process.env.HOME = testHome;
    process.env.USERPROFILE = testHome;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
  });

  it('resolves workspaces by unique ID prefix', async () => {
    const workspacePath = join(testHome, 'repo-a');
    mkdirSync(workspacePath, { recursive: true });
    writeWorkspaceFactoryConfig(workspacePath);

    const registryPath = join(testHome, '.taskfactory', 'workspaces.json');
    mkdirSync(join(testHome, '.taskfactory'), { recursive: true });
    writeFileSync(
      registryPath,
      JSON.stringify([
        {
          id: '12345678-aaaa-bbbb-cccc-111111111111',
          name: 'repo-a',
          path: workspacePath,
        },
      ]),
      'utf-8',
    );

    const { getWorkspaceById } = await import('../src/workspace-service.js');
    const workspace = await getWorkspaceById('12345678-aa');

    expect(workspace?.id).toBe('12345678-aaaa-bbbb-cccc-111111111111');
  });

  it('returns null for ambiguous prefixes', async () => {
    const workspaceAPath = join(testHome, 'repo-a');
    const workspaceBPath = join(testHome, 'repo-b');
    mkdirSync(workspaceAPath, { recursive: true });
    mkdirSync(workspaceBPath, { recursive: true });
    writeWorkspaceFactoryConfig(workspaceAPath);
    writeWorkspaceFactoryConfig(workspaceBPath);

    const registryPath = join(testHome, '.taskfactory', 'workspaces.json');
    mkdirSync(join(testHome, '.taskfactory'), { recursive: true });
    writeFileSync(
      registryPath,
      JSON.stringify([
        {
          id: 'abcd0000-aaaa-bbbb-cccc-111111111111',
          name: 'repo-a',
          path: workspaceAPath,
        },
        {
          id: 'abcd1111-aaaa-bbbb-cccc-222222222222',
          name: 'repo-b',
          path: workspaceBPath,
        },
      ]),
      'utf-8',
    );

    const { getWorkspaceById } = await import('../src/workspace-service.js');
    const workspace = await getWorkspaceById('abcd');

    expect(workspace).toBeNull();
  });

  it('prunes stale registry entries during listWorkspaces', async () => {
    const workspacePath = join(testHome, 'repo-a');
    mkdirSync(workspacePath, { recursive: true });
    writeWorkspaceFactoryConfig(workspacePath);

    const staleWorkspacePath = join(testHome, 'missing-repo');

    const registryPath = join(testHome, '.taskfactory', 'workspaces.json');
    mkdirSync(join(testHome, '.taskfactory'), { recursive: true });
    writeFileSync(
      registryPath,
      JSON.stringify([
        {
          id: '11111111-aaaa-bbbb-cccc-111111111111',
          name: 'repo-a',
          path: workspacePath,
        },
        {
          id: '22222222-aaaa-bbbb-cccc-222222222222',
          name: 'missing',
          path: staleWorkspacePath,
        },
      ]),
      'utf-8',
    );

    const { listWorkspaces } = await import('../src/workspace-service.js');
    const workspaces = await listWorkspaces();

    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].id).toBe('11111111-aaaa-bbbb-cccc-111111111111');

    expect(existsSync(registryPath)).toBe(true);
    const registryAfter = JSON.parse(readFileSync(registryPath, 'utf-8')) as Array<{ id: string }>;
    expect(registryAfter).toHaveLength(1);
    expect(registryAfter[0].id).toBe('11111111-aaaa-bbbb-cccc-111111111111');
  });
});
