import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const settingsPagePath = resolve(currentDir, '../../client/src/components/SettingsPage.tsx');

const settingsPage = readFileSync(settingsPagePath, 'utf-8');

describe('settings theme controls regression checks', () => {
  it('does not render ThemeToggle in the Settings header', () => {
    expect(settingsPage).not.toContain("import { ThemeToggle } from './ThemeToggle'");
    expect(settingsPage).not.toContain('<ThemeToggle');
  });

  it('keeps the Appearance theme selector options', () => {
    expect(settingsPage).toContain('>Theme</label>');
    expect(settingsPage).toContain('<option value="light">Light</option>');
    expect(settingsPage).toContain('<option value="dark">Dark</option>');
    expect(settingsPage).toContain('<option value="system">System</option>');
  });
});
