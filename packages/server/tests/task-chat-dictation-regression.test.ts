import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const taskChatPath = resolve(currentDir, '../../client/src/components/TaskChat.tsx');
const dictationHookPath = resolve(currentDir, '../../client/src/hooks/useVoiceDictation.ts');

const taskChat = readFileSync(taskChatPath, 'utf-8');
const dictationHook = readFileSync(dictationHookPath, 'utf-8');

describe('task chat dictation regression checks', () => {
  it('keeps native Web Speech API detection for SpeechRecognition and webkitSpeechRecognition', () => {
    expect(dictationHook).toContain('speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null');
  });

  it('only renders the dictation control when recognition support is available', () => {
    expect(taskChat).toContain('{isDictationSupported && (');
    expect(taskChat).toContain("aria-label={isDictating ? 'Stop voice dictation' : 'Start voice dictation'}");
  });

  it('stops dictation on send and task context changes to avoid stale transcript writes', () => {
    expect(taskChat).toContain('stopDictation()\n    const trimmed = input.trim()');
    expect(taskChat).toContain('useEffect(() => {\n    stopDictation()\n  }, [taskId, stopDictation])');
  });

  it('surfaces dictation errors to the user and keeps lifecycle teardown in the hook', () => {
    expect(taskChat).toContain('<p className="text-xs text-red-600" role="status">');
    expect(dictationHook).toContain('sessionIdRef.current += 1');
    expect(dictationHook).toContain('teardownRecognition(recognition)');
  });
});
