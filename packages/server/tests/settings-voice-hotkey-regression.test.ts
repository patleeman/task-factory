import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const settingsPagePath = resolve(currentDir, '../../client/src/components/SettingsPage.tsx');
const apiPath = resolve(currentDir, '../../client/src/api.ts');

const settingsPage = readFileSync(settingsPagePath, 'utf-8');
const apiClient = readFileSync(apiPath, 'utf-8');

describe('settings voice hotkey regression checks', () => {
  it('includes a user-editable Voice input hotkey control in appearance settings', () => {
    expect(settingsPage).toContain('Voice input hotkey');
    expect(settingsPage).toContain('formatVoiceInputHotkeyFromEvent');
    expect(settingsPage).toContain('Save Voice Hotkey');
    expect(settingsPage).toContain('validateVoiceInputHotkeyForUi');
  });

  it('loads and saves voiceInputHotkey through PiFactorySettings', () => {
    expect(settingsPage).toContain('setVoiceInputHotkey(normalizeVoiceInputHotkey(settings.voiceInputHotkey))');
    expect(settingsPage).toContain('voiceInputHotkey: nextHotkey');
    expect(settingsPage).toContain('await api.savePiFactorySettings(nextSettings)');

    expect(apiClient).toContain('voiceInputHotkey?: string');
    expect(apiClient).toContain("fetch('/api/settings'");
  });
});
