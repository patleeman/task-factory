import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

const executionPipelineEditor = readFileSync(resolve(currentDir, '../../client/src/components/ExecutionPipelineEditor.tsx'), 'utf-8');
const createTaskPane = readFileSync(resolve(currentDir, '../../client/src/components/CreateTaskPane.tsx'), 'utf-8');
const taskDetailPane = readFileSync(resolve(currentDir, '../../client/src/components/TaskDetailPane.tsx'), 'utf-8');
const settingsPage = readFileSync(resolve(currentDir, '../../client/src/components/SettingsPage.tsx'), 'utf-8');
const workspaceConfigPage = readFileSync(resolve(currentDir, '../../client/src/components/WorkspaceConfigPage.tsx'), 'utf-8');
const skillManagementPanel = readFileSync(resolve(currentDir, '../../client/src/components/SkillManagementPanel.tsx'), 'utf-8');
const serverIndex = readFileSync(resolve(currentDir, '../src/index.ts'), 'utf-8');
const taskDefaultsService = readFileSync(resolve(currentDir, '../src/task-defaults-service.ts'), 'utf-8');
const postExecutionSkills = readFileSync(resolve(currentDir, '../src/post-execution-skills.ts'), 'utf-8');

describe('universal skill availability regression checks', () => {
  it('removes hook-based filtering from pipeline and settings UIs', () => {
    expect(executionPipelineEditor).not.toContain('supportsHook(');
    expect(executionPipelineEditor).not.toContain('Skill does not support this hook');

    expect(createTaskPane).not.toContain("skill.hooks.includes('pre-planning')");
    expect(createTaskPane).not.toContain("skill.hooks.includes('pre')");
    expect(createTaskPane).not.toContain("skill.hooks.includes('post')");

    expect(taskDetailPane).not.toContain("skill.hooks.includes('pre-planning')");
    expect(taskDetailPane).not.toContain("skill.hooks.includes('pre')");
    expect(taskDetailPane).not.toContain("skill.hooks.includes('post')");

    expect(settingsPage).not.toContain("skill.hooks.includes('pre-planning')");
    expect(settingsPage).not.toContain("skill.hooks.includes('pre')");
    expect(settingsPage).not.toContain("skill.hooks.includes('post')");

    expect(workspaceConfigPage).not.toContain("skill.hooks.includes('pre-planning')");
    expect(workspaceConfigPage).not.toContain("skill.hooks.includes('pre')");
    expect(workspaceConfigPage).not.toContain("skill.hooks.includes('post')");
    expect(workspaceConfigPage).not.toContain("setActiveTab('extensions')");
    expect(workspaceConfigPage).not.toContain('Extensions (');
    expect(workspaceConfigPage).not.toContain('Select extensions active in this workspace.');

    expect(skillManagementPanel).toContain("const hooks: Array<'pre-planning' | 'pre' | 'post'> = ['pre-planning', 'pre', 'post']");
    expect(skillManagementPanel).not.toContain('Select at least one hook');
  });

  it('removes server-side hook compatibility gates while preserving skill ID validation', () => {
    expect(serverIndex).not.toContain('do not support pre-planning hook');
    expect(serverIndex).not.toContain('do not support pre hook');
    expect(serverIndex).not.toContain('do not support post hook');
    expect(serverIndex).toContain('Unknown ${fieldName}: ${unknown.join(\', \')}');
    expect(serverIndex).toContain("'pre-planning skills'");
    expect(serverIndex).toContain("'pre-execution skills'");
    expect(serverIndex).toContain("'post-execution skills'");

    expect(taskDefaultsService).not.toContain('do not support pre-planning hook');
    expect(taskDefaultsService).not.toContain('do not support pre hook');
    expect(taskDefaultsService).not.toContain('do not support post hook');

    expect(postExecutionSkills).not.toContain('does not support the pre-execution hook');
    expect(postExecutionSkills).not.toContain('does not support the pre-planning hook');
    expect(postExecutionSkills).not.toContain('does not support the post hook — skipping');
  });
});
