import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const settingsPagePath = resolve(currentDir, '../../client/src/components/SettingsPage.tsx');

const settingsPage = readFileSync(settingsPagePath, 'utf-8');

describe('settings planning guardrails regression checks', () => {
  it('shows timeout and max tool calls controls without max read output control', () => {
    expect(settingsPage).toContain('Timeout (seconds)');
    expect(settingsPage).toContain('Max tool calls');
    expect(settingsPage).not.toContain('Max read output (KB)');
  });

  it('saves planning guardrails without maxReadBytes', () => {
    expect(settingsPage).toContain('planningGuardrails: {');
    expect(settingsPage).toContain('timeoutMs: planningGuardrailsForm.timeoutMs');
    expect(settingsPage).toContain('maxToolCalls: planningGuardrailsForm.maxToolCalls');
    expect(settingsPage).not.toContain('maxReadBytes: planningGuardrailsForm.maxReadBytes');
  });
});
