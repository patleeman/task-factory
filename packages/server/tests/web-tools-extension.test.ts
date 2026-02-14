import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import webToolsExtension from '../../../extensions/web-tools.ts';

function extractResultText(result: any): string {
  if (!Array.isArray(result?.content)) return '';
  return result.content
    .filter((entry: any) => entry?.type === 'text' && typeof entry.text === 'string')
    .map((entry: any) => entry.text)
    .join('\n');
}

function createMockResponse(
  body: string,
  options?: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
  },
): any {
  const status = options?.status ?? 200;
  const statusText = options?.statusText ?? 'OK';
  const headers = new Map<string, string>();

  for (const [key, value] of Object.entries(options?.headers ?? {})) {
    headers.set(key.toLowerCase(), value);
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? null,
    },
    text: async () => body,
  };
}

describe('web tools extension', () => {
  let tools: Record<string, any>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tools = {};
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    webToolsExtension({
      registerTool: (tool: any) => {
        tools[tool.name] = tool;
      },
    } as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers web_search and web_fetch tools', () => {
    expect(Object.keys(tools).sort()).toEqual(['web_fetch', 'web_search']);
  });

  it('web_search scrapes DuckDuckGo HTML and returns markdown-formatted results', async () => {
    const html = `
      <html><body>
        <div class="result">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpi-factory">Pi Factory</a>
          <a class="result__snippet">First snippet.</a>
        </div>
        <div class="result">
          <a class="result__a" href="https://example.org/docs">Second Result</a>
          <div class="result__snippet">Second <b>snippet</b>.</div>
        </div>
      </body></html>
    `;

    let requestedUrl = '';
    fetchMock.mockImplementation(async (input: unknown) => {
      requestedUrl = typeof input === 'string' ? input : String(input);
      return createMockResponse(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });

    const result = await tools.web_search.execute(
      'tool-call-1',
      { query: 'pi factory', count: 2, page: 2 },
      undefined,
      undefined,
      {} as any,
    );

    const parsedUrl = new URL(requestedUrl);
    expect(parsedUrl.hostname).toBe('html.duckduckgo.com');
    expect(parsedUrl.searchParams.get('q')).toBe('pi factory');
    expect(parsedUrl.searchParams.get('s')).toBe('20');
    expect(parsedUrl.searchParams.get('dc')).toBe('21');

    const text = extractResultText(result);
    expect(text).toContain('# DuckDuckGo results for "pi factory"');
    expect(text).toContain('21. [Pi Factory](https://example.com/pi-factory)');
    expect(text).toContain('22. [Second Result](https://example.org/docs)');
    expect(text).toContain('- First snippet.');
    expect(text).toContain('- Second snippet.');

    expect(result.details).toMatchObject({
      query: 'pi factory',
      page: 2,
      count: 2,
      source: 'duckduckgo',
    });
  });

  it('web_search parses result links when href appears before class and attributes use single quotes', async () => {
    const html = `
      <html><body>
        <div class='result'>
          <a href='//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.net%2Fguide' class='result__a'>Single Quote Result</a>
          <span class='result__snippet'>Snippet from single-quote markup.</span>
        </div>
      </body></html>
    `;

    fetchMock.mockResolvedValue(createMockResponse(html, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));

    const result = await tools.web_search.execute(
      'tool-call-1b',
      { query: 'single quote parsing', count: 1 },
      undefined,
      undefined,
      {} as any,
    );

    const text = extractResultText(result);
    expect(text).toContain('[Single Quote Result](https://example.net/guide)');
    expect(text).toContain('Snippet from single-quote markup.');
  });

  it('web_search returns a no-results message when no result links are found', async () => {
    fetchMock.mockResolvedValue(createMockResponse('<html><body>No matches</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));

    const result = await tools.web_search.execute(
      'tool-call-2',
      { query: 'no hits' },
      undefined,
      undefined,
      {} as any,
    );

    expect(extractResultText(result)).toContain('No results found for "no hits"');
    expect(result.details).toMatchObject({ query: 'no hits', page: 1, count: 0, source: 'duckduckgo' });
  });

  it('web_search rejects empty queries', async () => {
    const result = await tools.web_search.execute(
      'tool-call-2b',
      { query: '   ' },
      undefined,
      undefined,
      {} as any,
    );

    expect(extractResultText(result)).toContain('Search query cannot be empty');
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('web_search reports HTTP errors as tool errors', async () => {
    fetchMock.mockResolvedValue(createMockResponse('bad gateway', { status: 502, statusText: 'Bad Gateway' }));

    const result = await tools.web_search.execute(
      'tool-call-3',
      { query: 'failure mode' },
      undefined,
      undefined,
      {} as any,
    );

    expect(extractResultText(result)).toContain('Search failed: HTTP 502');
    expect(result.isError).toBe(true);
  });

  it('web_fetch extracts readable markdown by default', async () => {
    const html = `
      <html>
        <head><title>Example Docs</title></head>
        <body>
          <main>
            <h1>Introduction</h1>
            <p>Read the <a href="/guide">API guide</a> for details.</p>
          </main>
        </body>
      </html>
    `;

    fetchMock.mockResolvedValue(createMockResponse(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));

    const result = await tools.web_fetch.execute(
      'tool-call-4',
      { url: 'https://example.com/docs' },
      undefined,
      undefined,
      {} as any,
    );

    const text = extractResultText(result);
    expect(text).toContain('# Example Docs');
    expect(text).toContain('# Introduction');
    expect(text).toContain('[API guide](https://example.com/guide)');
    expect(result.details).toMatchObject({
      url: 'https://example.com/docs',
      raw: false,
      title: 'Example Docs',
      truncated: false,
    });
  });

  it('web_fetch supports raw HTML mode', async () => {
    const html = '<html><head><title>Raw</title></head><body><p>hello</p></body></html>';
    fetchMock.mockResolvedValue(createMockResponse(html, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));

    const result = await tools.web_fetch.execute(
      'tool-call-5',
      { url: 'https://example.com/raw', raw: true },
      undefined,
      undefined,
      {} as any,
    );

    expect(extractResultText(result)).toContain('<html>');
    expect(result.details).toMatchObject({ raw: true });
  });

  it('web_fetch truncates oversized output with an explicit notice', async () => {
    const longBody = Array.from({ length: 2505 }, (_, i) => `line ${i}`).join('\n');
    fetchMock.mockResolvedValue(createMockResponse(longBody, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));

    const result = await tools.web_fetch.execute(
      'tool-call-6',
      { url: 'https://example.com/large.txt' },
      undefined,
      undefined,
      {} as any,
    );

    const text = extractResultText(result);
    expect(text).toContain('[Output truncated: showing');
    expect(result.details).toMatchObject({ truncated: true });
  });

  it('web_fetch rejects non-http URLs', async () => {
    const result = await tools.web_fetch.execute(
      'tool-call-7',
      { url: 'ftp://example.com/file.txt' },
      undefined,
      undefined,
      {} as any,
    );

    expect(extractResultText(result)).toContain('Only http/https URLs are supported');
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
