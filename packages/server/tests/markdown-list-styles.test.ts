import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(currentDir, '../../client/src/index.css');
const css = readFileSync(cssPath, 'utf-8');

describe('markdown list styles', () => {
  it('keeps ordered and unordered list markers for chat and task detail prose', () => {
    expect(css).toMatch(/\.chat-prose ul,\s*\.chat-prose ol,\s*\.prose ul,\s*\.prose ol\s*\{/m);
    expect(css).toMatch(/\.chat-prose ul,\s*\.prose ul\s*\{\s*@apply list-disc;\s*\}/m);
    expect(css).toMatch(/\.chat-prose ol,\s*\.prose ol\s*\{\s*@apply list-decimal;\s*\}/m);
  });

  it('styles gfm task list checkboxes so checkbox states stay visible', () => {
    expect(css).toMatch(/\.chat-prose \.contains-task-list,\s*\.prose \.contains-task-list\s*\{/m);
    expect(css).toMatch(/\.chat-prose \.task-list-item,\s*\.prose \.task-list-item\s*\{/m);
    expect(css).toMatch(/\.chat-prose \.task-list-item > input\[type='checkbox'\],\s*\.prose \.task-list-item > input\[type='checkbox'\]\s*\{\s*@apply [^}]*opacity-100/m);
  });
});
