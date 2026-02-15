import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const taskChatPath = resolve(currentDir, '../../client/src/components/TaskChat.tsx');
const workspacePagePath = resolve(currentDir, '../../client/src/components/WorkspacePage.tsx');
const createTaskPanePath = resolve(currentDir, '../../client/src/components/CreateTaskPane.tsx');
const keyboardShortcutsPath = resolve(currentDir, '../../client/src/hooks/useKeyboardShortcuts.ts');
const dictationHookPath = resolve(currentDir, '../../client/src/hooks/useVoiceDictation.ts');

const taskChat = readFileSync(taskChatPath, 'utf-8');
const workspacePage = readFileSync(workspacePagePath, 'utf-8');
const createTaskPane = readFileSync(createTaskPanePath, 'utf-8');
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

  it('starts on keydown and stops with a short release grace window while preserving send/task stop guards', () => {
    expect(taskChat).toContain('isVoiceHotkeyPressed?: boolean');
    expect(taskChat).toContain('dictationStartedForCurrentPressRef.current = false');
    expect(taskChat).toContain('if (dictationStartedForCurrentPressRef.current)');
    expect(taskChat).toContain('VOICE_HOTKEY_RELEASE_GRACE_MS');
    expect(taskChat).toContain('voiceHotkeyReleaseTimerRef.current = setTimeout');
    expect(taskChat).toContain('clearVoiceHotkeyReleaseTimer()');
    expect(taskChat).toMatch(/clearDictationError\(\)\s*startDictation\(\)/);
    expect(taskChat).toMatch(/clearVoiceHotkeyReleaseTimer\(\)\s*dictationStartedForCurrentPressRef\.current = false\s*stopDictation\(\)\s*const trimmed = input\.trim\(\)/);
    expect(taskChat).toContain('useEffect(() => {\n    clearVoiceHotkeyReleaseTimer()');
  });

  it('keeps escape and Cmd/Ctrl+K shortcuts while voice hotkey no longer force-focuses chat', () => {
    expect(keyboardShortcuts).toContain('onVoiceHotkeyDown');
    expect(keyboardShortcuts).toContain('onVoiceHotkeyUp');
    expect(keyboardShortcuts).toContain("window.addEventListener('keyup', handleKeyUp)");
    expect(keyboardShortcuts).toContain("if (e.key === 'Escape')");
    expect(keyboardShortcuts).toContain("if (!isInput && mod && (e.key === 'k' || e.key === 'K'))");

    expect(workspacePage).toContain('voiceInputHotkey');
    expect(workspacePage).toContain('onVoiceHotkeyDown');
    expect(workspacePage).toContain('setIsVoiceHotkeyPressed(true)');
    expect(workspacePage).not.toContain("onVoiceHotkeyDown: useCallback(() => {\n      const textarea = document.querySelector('[data-chat-input]') as HTMLTextAreaElement | null");
  });

  it('routes dictation to focused native fields and CodeMirror-backed task description editors', () => {
    expect(dictationHook).toContain("fallbackSelector = '[data-chat-input]'");
    expect(dictationHook).toContain('if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)');
    expect(dictationHook).toContain("const editorRoot = element.closest('.cm-editor')");
    expect(dictationHook).toContain('EditorView.findFromDOM(editorRoot)');
    expect(dictationHook).toContain('changes: { from, to, insert: nextInserted }');
    expect(createTaskPane).toContain('<MarkdownEditor');
    expect(createTaskPane).toContain('Task Description');
  });

  it('keeps lifecycle teardown in the dictation hook', () => {
    expect(dictationHook).toContain('sessionIdRef.current += 1');
    expect(dictationHook).toContain('teardownRecognition(recognition)');
  });
});
