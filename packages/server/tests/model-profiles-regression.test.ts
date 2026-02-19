import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const settingsPagePath = resolve(currentDir, '../../client/src/components/SettingsPage.tsx');
const createTaskPanePath = resolve(currentDir, '../../client/src/components/CreateTaskPane.tsx');
const workspaceConfigPath = resolve(currentDir, '../../client/src/components/WorkspaceConfigPage.tsx');
const draftHookPath = resolve(currentDir, '../../client/src/hooks/useLocalStorageDraft.ts');

const settingsPageSource = readFileSync(settingsPagePath, 'utf-8');
const createTaskPaneSource = readFileSync(createTaskPanePath, 'utf-8');
const workspaceConfigSource = readFileSync(workspaceConfigPath, 'utf-8');
const draftHookSource = readFileSync(draftHookPath, 'utf-8');

describe('model profile settings + create-task regression checks', () => {
  it('adds model profile management to Settings and persists profiles through PiFactorySettings', () => {
    expect(settingsPageSource).toContain('Default Model Profile');
    expect(settingsPageSource).toContain('Model Profiles');
    expect(settingsPageSource).toContain('Add Profile');
    expect(settingsPageSource).toContain('modelProfiles: normalizedProfiles');
    expect(settingsPageSource).toContain('normalizeModelProfilesForUi(settings, availableModels)');
  });

  it('shows workspace default profile selector with a link to global settings', () => {
    expect(workspaceConfigSource).toContain('Default Model Profile');
    expect(workspaceConfigSource).toContain('Global Settings');
    expect(workspaceConfigSource).toContain("navigate('/settings')");
  });

  it('adds profile selection to New Task and locks model selectors when profile is selected', () => {
    expect(createTaskPaneSource).toContain('Model Profile');
    expect(createTaskPaneSource).toContain('No profile (manual selection)');
    expect(createTaskPaneSource).toContain('disabled={Boolean(selectedModelProfile)}');
    expect(createTaskPaneSource).toContain('const resolvedPlanningModelConfig = selectedModelProfile');
    expect(createTaskPaneSource).toContain('const resolvedExecutionModelConfig = selectedModelProfile');
  });

  it('resolves new-task defaults by preserving explicit state before applying default profile IDs', () => {
    expect(createTaskPaneSource).toContain('const hasExplicitPrefillState = Boolean(prefillRequest)');
    expect(createTaskPaneSource).toContain('if (hasRestoredDraftContent || hasExplicitPrefillState)');
    expect(createTaskPaneSource).toContain('setSelectedModelProfileId(formDefaults.selectedModelProfileId)');
  });

  it('keeps selectedModelProfileId in local draft persistence', () => {
    expect(draftHookSource).toContain('selectedModelProfileId?: string');
    expect(draftHookSource).toContain('selectedModelProfileId: typeof parsed.selectedModelProfileId === \'string\'');
  });
});
