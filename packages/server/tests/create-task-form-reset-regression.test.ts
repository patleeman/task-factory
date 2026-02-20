import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const createTaskPanePath = resolve(currentDir, '../../client/src/components/CreateTaskPane.tsx');

const createTaskPaneSource = readFileSync(createTaskPanePath, 'utf-8');

describe('create-task form reset regression checks', () => {
  it('resets all form fields to workspace defaults on successful submission', () => {
    // Verify the success path resets all form state
    expect(createTaskPaneSource).toContain('// Success: reset form to clean state with workspace defaults');
    expect(createTaskPaneSource).toContain("const formDefaults = buildCreateTaskFormDefaults(taskDefaults)");
    expect(createTaskPaneSource).toContain("setContent('')");
    expect(createTaskPaneSource).toContain('setSelectedPrePlanningSkillIds(formDefaults.selectedPrePlanningSkillIds)');
    expect(createTaskPaneSource).toContain('setSelectedPreSkillIds(formDefaults.selectedPreSkillIds)');
    expect(createTaskPaneSource).toContain('setSelectedSkillIds(formDefaults.selectedSkillIds)');
    expect(createTaskPaneSource).toContain("setSkillConfigs({})");
    expect(createTaskPaneSource).toContain('setSelectedModelProfileId(formDefaults.selectedModelProfileId)');
    expect(createTaskPaneSource).toContain('setPlanningModelConfig(formDefaults.planningModelConfig)');
    expect(createTaskPaneSource).toContain('setExecutionModelConfig(formDefaults.executionModelConfig)');
    expect(createTaskPaneSource).toContain('setPendingFiles([])');
    expect(createTaskPaneSource).toContain('whiteboardSceneRef.current = null');
    expect(createTaskPaneSource).toContain('setInitialWhiteboardScene(null)');
    expect(createTaskPaneSource).toContain('clearStoredWhiteboardScene(whiteboardStorageKey)');
    expect(createTaskPaneSource).toContain('setEnablePlanning(true)');
    expect(createTaskPaneSource).toContain('clearDraft()');
  });

  it('preserves form state on submission failure for retry', () => {
    // Verify the failure path does NOT reset form state
    const handleSubmitMatch = createTaskPaneSource.match(/const handleSubmit = async \(\) => \{[\s\S]*?\n  \}/);
    expect(handleSubmitMatch).toBeTruthy();

    const handleSubmitBlock = handleSubmitMatch?.[0] ?? '';

    // Should have a catch block that does nothing (preserves state)
    expect(handleSubmitBlock).toContain('catch {');
    expect(handleSubmitBlock).toContain('// Failure: keep form populated for retry');

    // Catch block should NOT contain any setState calls that would clear form
    const catchBlockMatch = handleSubmitBlock.match(/catch \{[\s\S]*?\n    \}/);
    const catchBlock = catchBlockMatch?.[0] ?? '';
    expect(catchBlock).not.toContain('setContent');
    expect(catchBlock).not.toContain('setPendingFiles');
    expect(catchBlock).not.toContain('setSelectedSkillIds');
    expect(catchBlock).not.toContain('setSelectedModelProfileId');
  });

  it('shares the same reset logic between Clear button and successful submit', () => {
    // Both handleClearForm and successful handleSubmit should use buildCreateTaskFormDefaults
    expect(createTaskPaneSource).toMatch(/const handleClearForm = useCallback\(\(\) => \{[\s\S]*?const formDefaults = buildCreateTaskFormDefaults\(taskDefaults\)/);
    expect(createTaskPaneSource).toMatch(/\/\/ Success: reset form[\s\S]*?const formDefaults = buildCreateTaskFormDefaults\(taskDefaults\)/);

    // Both should reset the same fields
    expect(createTaskPaneSource).toContain("setContent('')");
    expect(createTaskPaneSource).toContain('setPendingFiles([])');
    expect(createTaskPaneSource).toContain('setEnablePlanning(true)');
  });
});
