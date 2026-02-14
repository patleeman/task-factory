import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearStoredWhiteboardScene,
  loadStoredWhiteboardScene,
  persistWhiteboardScene,
} from '../../client/src/components/whiteboard';

const currentDir = dirname(fileURLToPath(import.meta.url));
const taskChatPath = resolve(currentDir, '../../client/src/components/TaskChat.tsx');
const taskDetailPath = resolve(currentDir, '../../client/src/components/TaskDetailPane.tsx');

const taskChatSource = readFileSync(taskChatPath, 'utf-8');
const taskDetailSource = readFileSync(taskDetailPath, 'utf-8');

function createMemoryStorage() {
  const store = new Map<string, string>();

  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

const POPULATED_SCENE = {
  elements: [{ id: 'el-1', version: 1, versionNonce: 11, isDeleted: false }],
  appState: { viewBackgroundColor: '#ffffff' },
  files: {},
};

const EMPTY_SCENE = {
  elements: [{ id: 'el-deleted', version: 1, versionNonce: 5, isDeleted: true }],
  appState: {},
  files: {},
};

describe('whiteboard draft storage helpers', () => {
  const originalLocalStorage = (globalThis as any).localStorage;

  beforeEach(() => {
    (globalThis as any).localStorage = createMemoryStorage();
  });

  afterEach(() => {
    (globalThis as any).localStorage = originalLocalStorage;
  });

  it('round-trips persisted scenes with loadStoredWhiteboardScene', () => {
    const storageKey = 'pi-factory:test:whiteboard';

    persistWhiteboardScene(storageKey, POPULATED_SCENE as any);
    const loaded = loadStoredWhiteboardScene(storageKey);

    expect(loaded).toEqual(POPULATED_SCENE);
  });

  it('removes persisted scene data when content becomes empty or clear is called', () => {
    const storageKey = 'pi-factory:test:whiteboard';

    persistWhiteboardScene(storageKey, POPULATED_SCENE as any);
    expect(loadStoredWhiteboardScene(storageKey)).toEqual(POPULATED_SCENE);

    persistWhiteboardScene(storageKey, EMPTY_SCENE as any);
    expect(loadStoredWhiteboardScene(storageKey)).toBeNull();

    persistWhiteboardScene(storageKey, POPULATED_SCENE as any);
    clearStoredWhiteboardScene(storageKey);
    expect(loadStoredWhiteboardScene(storageKey)).toBeNull();
  });
});

describe('task whiteboard draft persistence regressions', () => {
  it('scopes task-chat and task-detail draft keys by workspace and task', () => {
    expect(taskChatSource).toContain("const TASK_CHAT_WHITEBOARD_STORAGE_KEY_PREFIX = 'pi-factory:task-chat-whiteboard'");
    expect(taskChatSource).toContain('return `${TASK_CHAT_WHITEBOARD_STORAGE_KEY_PREFIX}:${workspaceId}:${taskId}`');

    expect(taskDetailSource).toContain("const TASK_DETAIL_WHITEBOARD_STORAGE_KEY_PREFIX = 'pi-factory:task-detail-whiteboard'");
    expect(taskDetailSource).toContain('return `${TASK_DETAIL_WHITEBOARD_STORAGE_KEY_PREFIX}:${workspaceId}:${taskId}`');
  });

  it('loads persisted scene drafts and persists ongoing edits for chat and task detail', () => {
    expect(taskChatSource).toContain('const storedScene = loadStoredWhiteboardScene(whiteboardStorageKey)');
    expect(taskChatSource).toContain('persistWhiteboardScene(whiteboardStorageKey, scene)');

    expect(taskDetailSource).toContain('const storedScene = loadStoredWhiteboardScene(whiteboardStorageKey)');
    expect(taskDetailSource).toContain('persistWhiteboardScene(whiteboardStorageKey, scene)');
  });

  it('clears draft storage on attach while keeping close/cancel/escape paths non-destructive', () => {
    expect(taskChatSource).toMatch(/const attachWhiteboardToPendingFiles = useCallback\(async \(\) => \{[\s\S]{0,1100}clearStoredWhiteboardScene\(whiteboardStorageKey\)/);
    expect(taskChatSource).toMatch(/const closeWhiteboardModal = useCallback\(\(\) => \{[\s\S]{0,220}setIsWhiteboardModalOpen\(false\)/);
    expect(taskChatSource).not.toMatch(/const closeWhiteboardModal = useCallback\(\(\) => \{[\s\S]{0,220}clearStoredWhiteboardScene/);

    expect(taskDetailSource).toMatch(/const attachWhiteboard = useCallback\(async \(\) => \{[\s\S]{0,1100}clearStoredWhiteboardScene\(whiteboardStorageKey\)/);
    expect(taskDetailSource).toMatch(/const handleEscape = \(event: KeyboardEvent\) => \{[\s\S]{0,260}if \(event.key !== 'Escape'\) return[\s\S]{0,260}setIsWhiteboardModalOpen\(false\)/);
    expect(taskDetailSource).not.toMatch(/const handleEscape = \(event: KeyboardEvent\) => \{[\s\S]{0,360}clearStoredWhiteboardScene\(/);
    expect(taskDetailSource).toContain('onClick={() => setIsWhiteboardModalOpen(false)}');
  });
});
