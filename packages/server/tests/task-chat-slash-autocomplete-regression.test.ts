import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const taskChatPath = resolve(currentDir, '../../client/src/components/TaskChat.tsx');

const taskChatSource = readFileSync(taskChatPath, 'utf-8');

describe('task chat slash autocomplete regression checks', () => {
  it('accepts slash command options and derives filtered slash suggestions', () => {
    expect(taskChatSource).toContain('export interface SlashCommandOption');
    expect(taskChatSource).toContain('slashCommands?: SlashCommandOption[]');
    expect(taskChatSource).toContain('const slashSuggestions = slashAutocomplete.suggestions');
    expect(taskChatSource).toContain('const showSlashAutocomplete = slashAutocomplete.visible');
  });

  it('supports keyboard navigation and tab completion for slash suggestions', () => {
    expect(taskChatSource).toContain("if (e.key === 'ArrowDown')");
    expect(taskChatSource).toContain("if (e.key === 'ArrowUp')");
    expect(taskChatSource).toContain("if (e.key === 'Tab')");
    expect(taskChatSource).toContain('applySlashCommand(selectedCommand.command)');
  });

  it('renders a clickable slash command suggestion menu above the composer', () => {
    expect(taskChatSource).toContain('role="listbox"');
    expect(taskChatSource).toContain('slash commands · tab to autocomplete');
    expect(taskChatSource).toContain('role="option"');
    expect(taskChatSource).toContain('onClick={() => applySlashCommand(option.command)}');
  });
});
