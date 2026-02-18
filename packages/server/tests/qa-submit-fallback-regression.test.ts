import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const workspacePagePath = resolve(currentDir, '../../client/src/components/WorkspacePage.tsx');
const planningHookPath = resolve(currentDir, '../../client/src/hooks/usePlanningStreaming.ts');
const qaDialogPath = resolve(currentDir, '../../client/src/components/QADialog.tsx');

const workspacePageSource = readFileSync(workspacePagePath, 'utf-8');
const planningHookSource = readFileSync(planningHookPath, 'utf-8');
const qaDialogSource = readFileSync(qaDialogPath, 'utf-8');

describe('qa submit fallback regression checks', () => {
  it('clears active QA locally after successful submit so UI does not wait on websocket timing', () => {
    expect(workspacePageSource).toContain('const activeRequest = planningStream.activeQARequest');
    expect(workspacePageSource).toContain('await api.submitQAResponse(workspaceId, activeRequest.requestId, answers)');
    expect(workspacePageSource).toContain('planningStream.resolveQARequestLocally(activeRequest.requestId)');

    expect(planningHookSource).toContain('resolveQARequestLocally: (requestId: string) => void');
    expect(planningHookSource).toContain('const resolveQARequestLocally = useCallback((requestId: string) => {');
    expect(planningHookSource).toContain("id: `local-qa-response-${requestId}`");
    expect(planningHookSource).toContain('qaResponse: {');
    expect(planningHookSource).toContain('stopQAPoll()');
  });

  it('also clears active QA locally after successful abort so recovered dialogs close immediately', () => {
    expect(workspacePageSource).toContain('await api.abortQA(workspaceId, activeRequest.requestId)');
    expect(workspacePageSource).toContain('planningStream.resolveQARequestLocally(activeRequest.requestId)');
  });

  it('keeps retry flow intact when submit fails', () => {
    expect(workspacePageSource).toContain("showToast('Failed to submit answers')");
    expect(workspacePageSource).toContain('return false');

    expect(qaDialogSource).toContain('const submitted = await onSubmit(submissionAnswers)');
    expect(qaDialogSource).toContain('if (!submitted) {');
    expect(qaDialogSource).toContain('setSubmitting(false)');
  });
});
