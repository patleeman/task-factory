import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const taskChatPath = resolve(currentDir, '../../client/src/components/TaskChat.tsx');

const taskChatSource = readFileSync(taskChatPath, 'utf-8');

describe('task chat auto-scroll regression checks', () => {
  it('scrolls the message history container to its true bottom with follow-up passes', () => {
    expect(taskChatSource).toContain("const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {");
    expect(taskChatSource).toContain('const scroller = scrollRef.current');
    expect(taskChatSource).toContain('scroller.scrollTo({ top: scroller.scrollHeight, behavior })');
    expect(taskChatSource).toContain('const rafId = requestAnimationFrame(() => {');
    expect(taskChatSource).toContain('const timeoutId = setTimeout(() => {');
  });

  it('re-runs auto-scroll on new entries, live stream growth, and layout-affecting UI toggles', () => {
    expect(taskChatSource).toContain('const liveToolScrollKey = useMemo(');
    expect(taskChatSource).toContain('latestEntryId');
    expect(taskChatSource).toContain('agentStream.streamingText.length');
    expect(taskChatSource).toContain('agentStream.thinkingText.length');
    expect(taskChatSource).toContain('agentStream.status');
    expect(taskChatSource).toContain('isWaitingForInput');
    expect(taskChatSource).toContain('showStatusBar');
    expect(taskChatSource).toContain('showControlRow');
    expect(taskChatSource).toContain('hasBottomSlot');
    expect(taskChatSource).toContain('return scheduleScrollToBottom()');
  });
});
