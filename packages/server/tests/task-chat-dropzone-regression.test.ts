import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const taskChatPath = resolve(currentDir, '../../client/src/components/TaskChat.tsx');

const taskChatSource = readFileSync(taskChatPath, 'utf-8');

describe('task chat drag-drop regression checks', () => {
  it('wires file drag-drop handlers to the full chat pane container', () => {
    expect(taskChatSource).toContain('data-chat-dropzone');
    expect(taskChatSource).toMatch(/data-chat-dropzone[\s\S]{0,520}onDragEnter=\{canUploadFiles \? handleDragEnter : undefined\}/);
    expect(taskChatSource).toMatch(/data-chat-dropzone[\s\S]{0,520}onDrop=\{canUploadFiles \? handleDrop : undefined\}/);
  });

  it('keeps message history and composer free of direct drop handlers', () => {
    expect(taskChatSource).toContain('data-chat-message-history');
    expect(taskChatSource).not.toMatch(/data-chat-message-history[\s\S]{0,260}onDragOver=\{handleDragOver\}/);
    expect(taskChatSource).not.toMatch(/data-chat-message-history[\s\S]{0,260}onDrop=\{handleDrop\}/);
    expect(taskChatSource).not.toContain('data-chat-composer-dropzone');
  });

  it('shows whole-pane drag-active styling and drop hint', () => {
    expect(taskChatSource).toContain('ring-2 ring-inset ring-blue-400 bg-blue-50/30');
    expect(taskChatSource).toContain('absolute inset-0 z-20 pointer-events-none flex items-center justify-center');
    expect(taskChatSource).toContain('Drop files to attach');
  });

  it('guards drag state to file drags and clears active state on leave/drop', () => {
    expect(taskChatSource).toContain("Array.from(e.dataTransfer.types).includes('Files')");
    expect(taskChatSource).toContain('dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)');
    expect(taskChatSource).toContain('dragDepthRef.current = 0');
    expect(taskChatSource).toContain('setIsDragOver(false)');
  });

  it('keeps drop behavior attachment-only without auto-sending messages', () => {
    expect(taskChatSource).toContain('addFiles(e.dataTransfer.files)');
    expect(taskChatSource).not.toMatch(/const handleDrop = \(e: React\.DragEvent\) => \{[\s\S]{0,320}(?:handleSend|onSendMessage)\(/);
  });

  it('keeps existing file picker and whiteboard attachment flows on pending files', () => {
    expect(taskChatSource).toContain('addFiles([sketchFile])');
    expect(taskChatSource).toContain('if (e.target.files) addFiles(e.target.files)');
    expect(taskChatSource).toContain('uploaded = await onUploadFiles(pendingFiles)');
    expect(taskChatSource).toContain('attachmentIds = uploaded.map(a => a.id)');
  });
});
