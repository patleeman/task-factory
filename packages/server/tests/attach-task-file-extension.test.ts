import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import attachTaskFileExtension from '../../../extensions/attach-task-file.ts';

function extractResultText(result: any): string {
  if (!Array.isArray(result?.content)) return '';
  return result.content
    .filter((entry: any) => entry?.type === 'text' && typeof entry.text === 'string')
    .map((entry: any) => entry.text)
    .join('\n');
}

describe('attach_task_file extension', () => {
  let tool: any;

  beforeEach(() => {
    tool = undefined;

    attachTaskFileExtension({
      registerTool: (registered: any) => {
        tool = registered;
      },
    } as any);
  });

  afterEach(() => {
    const globalObj = globalThis as any;
    delete globalObj.__piFactoryAttachFileCallbacks;
  });

  it('returns a clear message when no active callback is registered', async () => {
    const result = await tool.execute(
      'tool-call-1',
      { path: '/tmp/screenshot.png' },
      undefined,
      undefined,
      {} as any,
    );

    expect(extractResultText(result)).toContain('no active task callback is registered');
    expect(result.isError).toBe(true);
  });

  it('attaches using the single active callback when taskId is omitted', async () => {
    const callback = vi.fn().mockResolvedValue({
      taskId: 'PIFA-60',
      attachmentId: 'abc12345',
      filename: 'validation-screenshot.png',
      storedName: 'abc12345.png',
      mimeType: 'image/png',
      size: 128,
      createdAt: new Date().toISOString(),
    });

    (globalThis as any).__piFactoryAttachFileCallbacks = new Map([
      ['PIFA-60', callback],
    ]);

    const result = await tool.execute(
      'tool-call-2',
      {
        path: '/tmp/screenshot.png',
        filename: 'validation-screenshot.png',
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(callback).toHaveBeenCalledWith({
      path: '/tmp/screenshot.png',
      filename: 'validation-screenshot.png',
    });
    expect(extractResultText(result)).toContain('Attached file to task PIFA-60');
  });

  it('requires taskId when multiple task callbacks are active', async () => {
    (globalThis as any).__piFactoryAttachFileCallbacks = new Map([
      ['PIFA-60', vi.fn()],
      ['PIFA-61', vi.fn()],
    ]);

    const result = await tool.execute(
      'tool-call-3',
      { path: '/tmp/screenshot.png' },
      undefined,
      undefined,
      {} as any,
    );

    expect(extractResultText(result)).toContain('requires taskId when multiple tasks are active');
    expect(result.isError).toBe(true);
  });
});
