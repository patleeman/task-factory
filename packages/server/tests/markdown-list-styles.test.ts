import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(currentDir, '../../client/src/index.css');
const css = readFileSync(cssPath, 'utf-8');

describe('markdown list styles', () => {
  it('keeps ordered and unordered list markers for chat and task detail prose', () => {
    expect(css).toMatch(/\.chat-prose ul, \.chat-prose ol,\s*\n\.prose ul, \.prose ol \{/m);
    expect(css).toMatch(/\.chat-prose ul, \.prose ul \{\s*@apply list-disc;\s*\}/m);
    expect(css).toMatch(/\.chat-prose ol, \.prose ol \{\s*@apply list-decimal;\s*\}/m);
  });

  it('styles gfm task list checkboxes so checkbox states stay visible', () => {
    expect(css).toMatch(/\.chat-prose \.contains-task-list,\s*\n\.prose \.contains-task-list \{/m);
    expect(css).toMatch(/\.chat-prose \.task-list-item,\s*\n\.prose \.task-list-item \{/m);
    expect(css).toMatch(/\.chat-prose \.task-list-item > input\[type='checkbox'\],\s*\n\.prose \.task-list-item > input\[type='checkbox'\] \{\s*@apply [^}]*opacity-100/m);
  });
});
