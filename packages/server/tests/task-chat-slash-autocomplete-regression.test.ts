import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const taskChatPath = resolve(currentDir, '../../client/src/components/TaskChat.tsx');
const workspacePagePath = resolve(currentDir, '../../client/src/components/WorkspacePage.tsx');

const taskChatSource = readFileSync(taskChatPath, 'utf-8');
const workspacePageSource = readFileSync(workspacePagePath, 'utf-8');

describe('task chat slash autocomplete regression checks', () => {
  it('accepts slash command and hook skill options with combined slash catalog data', () => {
    expect(taskChatSource).toContain('export interface SlashCommandOption');
    expect(taskChatSource).toContain('export interface HookSkillOption');
    expect(taskChatSource).toContain('slashCommands?: SlashCommandOption[]');
    expect(taskChatSource).toContain('hookSkills?: HookSkillOption[]');
    expect(taskChatSource).toContain('const slashCatalog = new Map<string, SlashCommandOption>()');
  });

  it('supports keyboard navigation and tab completion for slash suggestions', () => {
    expect(taskChatSource).toContain("if (e.key === 'ArrowDown')");
    expect(taskChatSource).toContain("if (e.key === 'ArrowUp')");
    expect(taskChatSource).toContain("if (e.key === 'Tab')");
    expect(taskChatSource).toContain('applySlashCommand(selectedCommand.command)');
    expect(taskChatSource).toContain('selectedSuggestion?.scrollIntoView({ block: \'nearest\' })');
  });

  it('uses fuzzy matching to rank slash command suggestions', () => {
    expect(taskChatSource).toContain('function fuzzyMatchScore(query: string, candidate: string): number | null');
    expect(taskChatSource).toContain('const score = fuzzyMatchScore(query, candidateQuery)');
    expect(taskChatSource).toContain('if (a.score !== b.score) return a.score - b.score');
  });

  it('renders a flat slash list with no section headers and clickable /skill entries', () => {
    expect(taskChatSource).toContain('buildHookSkillSlashDescription(skill)');
    expect(taskChatSource).toContain('const command = `/skill:${skill.id}`');
    expect(taskChatSource).toContain('onClick={() => applySlashCommand(option.command)}');
    expect(taskChatSource).not.toContain('command autocomplete');
    expect(taskChatSource).not.toContain('slash commands · tab to autocomplete');
    expect(taskChatSource).not.toContain('execution hook skills · informational only');
  });

  it('wires split skill catalog data for both foreman and task chats', () => {
    expect(workspacePageSource).toContain('const BASE_TASK_SLASH_COMMANDS');
    expect(workspacePageSource).toContain('buildTaskSlashCommands');
    expect(workspacePageSource).toContain('buildHookSkillOptions');
    expect(workspacePageSource).toContain('api.getWorkspaceSkillCatalog(workspaceId)');
    expect(workspacePageSource).toContain('setHookSkillOptions(buildHookSkillOptions(workspaceSkillCatalog.hookSkills))');
    expect(workspacePageSource).toContain('hookSkills={hookSkillOptions}');
    expect(workspacePageSource).toContain('slashCommands={taskSlashCommands}');
    expect(workspacePageSource).toContain('slashCommands={foremanSlashCommands}');
  });
});
