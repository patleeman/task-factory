import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const indexPath = resolve(currentDir, '../src/index.ts');
const indexSource = readFileSync(indexPath, 'utf-8');

describe('task chat steer/follow-up fallback regression checks', () => {
  it('falls back to normal chat turn when steer has no active session', () => {
    expect(indexSource).toContain("let ok = await steerTask(req.params.taskId, content, steerImages);");
    expect(indexSource).toContain("if (!ok && !getActiveSession(req.params.taskId) && workspace && taskForMessage)");
    expect(indexSource).toContain('ok = taskForMessage.frontmatter.sessionFile');
    expect(indexSource).toContain('await resumeChat(');
    expect(indexSource).toContain('await startChat(');
  });

  it('falls back to normal chat turn when follow-up has no active session', () => {
    expect(indexSource).toContain("let ok = await followUpTask(req.params.taskId, content, followUpImages);");
    expect(indexSource).toContain('follow-up into a normal');
    expect(indexSource).toContain('await resumeChat(');
    expect(indexSource).toContain('await startChat(');
  });
});
