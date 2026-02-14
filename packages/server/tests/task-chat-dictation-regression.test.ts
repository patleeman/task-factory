import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const taskChatPath = resolve(currentDir, '../../client/src/components/TaskChat.tsx');
const workspacePagePath = resolve(currentDir, '../../client/src/components/WorkspacePage.tsx');
const keyboardShortcutsPath = resolve(currentDir, '../../client/src/hooks/useKeyboardShortcuts.ts');
const dictationHookPath = resolve(currentDir, '../../client/src/hooks/useVoiceDictation.ts');

const taskChat = readFileSync(taskChatPath, 'utf-8');
const workspacePage = readFileSync(workspacePagePath, 'utf-8');
const keyboardShortcuts = readFileSync(keyboardShortcutsPath, 'utf-8');
const dictationHook = readFileSync(dictationHookPath, 'utf-8');

describe('task chat dictation regression checks', () => {
  it('keeps native Web Speech API detection for SpeechRecognition and webkitSpeechRecognition', () => {
    expect(dictationHook).toMatch(/speechWindow\.SpeechRecognition\s*\|\|\s*speechWindow\.webkitSpeechRecognition\s*\|\|\s*null/);
  });

  it('removes per-input dictation button while keeping listening/error feedback text', () => {
    expect(taskChat).not.toContain("aria-label={isDictating ? 'Stop voice dictation' : 'Start voice dictation'}");
    expect(taskChat).not.toContain('AppIcon icon={Mic}');
    expect(taskChat).toContain('<p className="text-xs text-red-600" role="status">');
  });

  it('starts and stops dictation from global hotkey state while preserving send/task stop guards', () => {
    expect(taskChat).toContain('isVoiceHotkeyPressed?: boolean');
    expect(taskChat).toContain('dictationStartedForCurrentPressRef.current = false');
    expect(taskChat).toContain('if (dictationStartedForCurrentPressRef.current)');
    expect(taskChat).toContain('stopDictation()');
    expect(taskChat).toMatch(/clearDictationError\(\)\s*startDictation\(\)/);
    expect(taskChat).toMatch(/stopDictation\(\)\s*const trimmed = input\.trim\(\)/);
    expect(taskChat).toMatch(/useEffect\(\(\) => \{\s*stopDictation\(\)\s*\}, \[taskId, stopDictation\]\)/);
  });

  it('keeps escape and Cmd/Ctrl+K shortcuts while adding voice hotkey keydown/keyup plumbing', () => {
    expect(keyboardShortcuts).toContain('onVoiceHotkeyDown');
    expect(keyboardShortcuts).toContain('onVoiceHotkeyUp');
    expect(keyboardShortcuts).toContain("window.addEventListener('keyup', handleKeyUp)");
    expect(keyboardShortcuts).toContain("if (e.key === 'Escape')");
    expect(keyboardShortcuts).toContain("if (!isInput && mod && (e.key === 'k' || e.key === 'K'))");

    expect(workspacePage).toContain('voiceInputHotkey');
    expect(workspacePage).toContain('onVoiceHotkeyDown');
    expect(workspacePage).toContain('isVoiceHotkeyPressed={isVoiceHotkeyPressed}');
  });

  it('keeps lifecycle teardown in the dictation hook', () => {
    expect(dictationHook).toContain('sessionIdRef.current += 1');
    expect(dictationHook).toContain('teardownRecognition(recognition)');
  });
});
