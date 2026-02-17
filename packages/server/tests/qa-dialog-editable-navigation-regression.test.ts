import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const qaDialogPath = resolve(currentDir, '../../client/src/components/QADialog.tsx');

const qaDialogSource = readFileSync(qaDialogPath, 'utf-8');

describe('qa dialog editable navigation regression checks', () => {
  it('supports backward/forward navigation and explicit final submission', () => {
    expect(qaDialogSource).toContain('function handleBack()');
    expect(qaDialogSource).toContain('function handleForward()');
    expect(qaDialogSource).toContain('onClick={handleBack}');
    expect(qaDialogSource).toContain('onClick={handleForward}');
    expect(qaDialogSource).toContain('submit all');
    expect(qaDialogSource).toContain('disabled={!allAnswered || submitting}');
  });

  it('stores answers by questionId and replaces prior values when users edit', () => {
    expect(qaDialogSource).toContain('const [answersByQuestionId, setAnswersByQuestionId] = useState<Record<string, string>>({})');
    expect(qaDialogSource).toContain('[question.id]: trimmed');
    expect(qaDialogSource).not.toContain('const updated = [...answers, answer]');
    expect(qaDialogSource).not.toContain('onSubmit(updated)');
  });

  it('builds one final payload with exactly one latest answer per questionId', () => {
    expect(qaDialogSource).toContain('const uniqueQuestionIds = useMemo(() => {');
    expect(qaDialogSource).toContain('const submissionAnswers = uniqueQuestionIds.map((questionId) => ({');
    expect(qaDialogSource).toContain("selectedOption: (answersByQuestionId[questionId] || '').trim(),");
    expect(qaDialogSource).toContain('if (submissionAnswers.some((answer) => !answer.selectedOption))');
    expect(qaDialogSource).toContain('onSubmit(submissionAnswers)');
  });

  it('re-enables the dialog when final submission fails so users can retry', () => {
    expect(qaDialogSource).toContain('const submitted = await onSubmit(submissionAnswers)');
    expect(qaDialogSource).toContain('if (!submitted) {');
    expect(qaDialogSource).toContain('setSubmitting(false)');
    expect(qaDialogSource).toContain('} catch {');
  });

  it('keeps option click, numeric/custom input, Enter submit, and Esc abort flows', () => {
    expect(qaDialogSource).toContain('onClick={() => handleOptionClick(option)}');
    expect(qaDialogSource).toContain('const num = parseInt(trimmed, 10)');
    expect(qaDialogSource).toContain('if (e.key === \'Enter\' && !e.shiftKey)');
    expect(qaDialogSource).toContain("} else if (e.key === 'Escape') {");
    expect(qaDialogSource).toContain('onAbort()');
    expect(qaDialogSource).toContain('skip');
  });
});
