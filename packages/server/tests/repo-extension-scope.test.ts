import { describe, expect, it } from 'vitest';
import { getRepoExtensionPaths, reloadRepoExtensions } from '../src/agent-execution-service.js';

function isWebToolsPath(path: string): boolean {
  return /(?:^|[\\/])web-tools(?:\.ts|[\\/]index\.ts)$/.test(path);
}

function isManageTasksPath(path: string): boolean {
  return /(?:^|[\\/])manage-tasks(?:\.ts|[\\/]index\.ts)$/.test(path);
}

function isMessageAgentPath(path: string): boolean {
  return /(?:^|[\\/])message-agent(?:\.ts|[\\/]index\.ts)$/.test(path);
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

  it('loads manage-tasks for foreman and excludes it for task sessions', () => {
    const all = reloadRepoExtensions();
    const foreman = getRepoExtensionPaths('foreman');
    const task = getRepoExtensionPaths('task');

    expect(all.some(isManageTasksPath)).toBe(true);
    expect(foreman.some(isManageTasksPath)).toBe(true);
    expect(task.some(isManageTasksPath)).toBe(false);
  });

  it('loads message-agent for foreman and excludes it for task sessions', () => {
    const all = reloadRepoExtensions();
    const foreman = getRepoExtensionPaths('foreman');
    const task = getRepoExtensionPaths('task');

    expect(all.some(isMessageAgentPath)).toBe(true);
    expect(foreman.some(isMessageAgentPath)).toBe(true);
    expect(task.some(isMessageAgentPath)).toBe(false);
  });
});
