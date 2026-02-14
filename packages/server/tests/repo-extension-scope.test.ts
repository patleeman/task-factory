import { describe, expect, it } from 'vitest';
import { getRepoExtensionPaths, reloadRepoExtensions } from '../src/agent-execution-service.js';

function isWebToolsPath(path: string): boolean {
  return /(?:^|[\\/])web-tools(?:\.ts|[\\/]index\.ts)$/.test(path);
}

describe('repo extension scope', () => {
  it('loads web-tools for foreman and excludes it for task sessions', () => {
    const all = reloadRepoExtensions();
    const foreman = getRepoExtensionPaths('foreman');
    const task = getRepoExtensionPaths('task');

    expect(all.some(isWebToolsPath)).toBe(true);
    expect(foreman.some(isWebToolsPath)).toBe(true);
    expect(task.some(isWebToolsPath)).toBe(false);
  });
});
