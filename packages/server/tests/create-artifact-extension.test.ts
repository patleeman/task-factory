import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import createArtifactExtension from '../../../extensions/create-artifact.ts';

function extractResultText(result: any): string {
  if (!Array.isArray(result?.content)) return '';
  return result.content
    .filter((entry: any) => entry?.type === 'text' && typeof entry.text === 'string')
    .map((entry: any) => entry.text)
    .join('\n');
}

describe('create_artifact extension', () => {
  let tool: any;

  beforeEach(() => {
    tool = undefined;

    createArtifactExtension({
      registerTool: (registered: any) => {
        tool = registered;
      },
    } as any);
  });

  afterEach(() => {
    const globalObj = globalThis as any;
    delete globalObj.__piFactoryShelfCallbacks;
  });

  it('returns a fallback message when planning callbacks are unavailable', async () => {
    const result = await tool.execute(
      'tool-call-1',
      {
        name: 'OAuth Provider Comparison',
        html: '<!doctype html><html><body>hello</body></html>',
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(extractResultText(result)).toContain('callbacks not available');
    expect(result.details).toEqual({});
  });

  it('returns stable artifact metadata plus renderable HTML payload', async () => {
    const createArtifact = vi.fn().mockResolvedValue({
      id: 'artifact-abc12345',
      name: 'Voice Dictation Research',
      html: '<!doctype html><html></html>',
      createdAt: new Date().toISOString(),
    });

    (globalThis as any).__piFactoryShelfCallbacks = new Map([
      ['workspace-1', {
        createDraftTask: vi.fn(),
        createArtifact,
      }],
    ]);

    const result = await tool.execute(
      'tool-call-2',
      {
        name: 'Voice Dictation Research',
        html: '<!doctype html><html><body>artifact</body></html>',
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(createArtifact).toHaveBeenCalledWith({
      name: 'Voice Dictation Research',
      html: '<!doctype html><html><body>artifact</body></html>',
    });
    expect(result.details).toMatchObject({
      artifactId: 'artifact-abc12345',
      artifactName: 'Voice Dictation Research',
      artifactHtml: '<!doctype html><html></html>',
    });
  });
});
