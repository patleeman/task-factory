import type { ExtensionAPI, TruncationResult } from '@mariozechner/pi-coding-agent';
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

const WEB_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const WEB_FETCH_TIMEOUT_MS = 15_000;
const WEB_SEARCH_TIMEOUT_MS = 10_000;

interface ParsedSearchResult {
  title: string;
  url: string;
  snippet: string;
}

function combineAbortSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;

  const abortSignalAny = (AbortSignal as typeof AbortSignal & {
    any?: (signals: AbortSignal[]) => AbortSignal;
  }).any;

  if (typeof abortSignalAny === 'function') {
    return abortSignalAny([signal, timeoutSignal]);
  }

  if (signal.aborted) {
    return signal;
  }

  if (timeoutSignal.aborted) {
    return timeoutSignal;
  }

  const controller = new AbortController();

  const cleanup = () => {
    signal.removeEventListener('abort', onSignalAbort);
    timeoutSignal.removeEventListener('abort', onTimeoutAbort);
  };

  const abort = (source: AbortSignal) => {
    if (controller.signal.aborted) return;
    cleanup();
    controller.abort(source.reason);
  };

  const onSignalAbort = () => abort(signal);
  const onTimeoutAbort = () => abort(timeoutSignal);

  signal.addEventListener('abort', onSignalAbort, { once: true });
  timeoutSignal.addEventListener('abort', onTimeoutAbort, { once: true });

  return controller.signal;
}

function normalizeHttpUrl(input: string): string {
  let parsed: URL;

  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs are supported.');
  }

  return parsed.toString();
}

function toHttpUrlOrNull(input: string): string | null {
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function codePointToString(code: number, fallback: string): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) {
    return fallback;
  }

  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };

  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return codePointToString(code, match);
    })
    .replace(/&#(\d+);/g, (match, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return codePointToString(code, match);
    })
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => named[name] ?? match);
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function inlineTextFromHtml(value: string): string {
  return normalizeWhitespace(decodeHtmlEntities(stripTags(value)));
}

function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch) return '';
  return inlineTextFromHtml(titleMatch[1]);
}

function extractPrimaryHtml(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');

  const mainMatch = withoutNoise.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i);
  if (mainMatch) {
    return mainMatch[2];
  }

  const bodyMatch = withoutNoise.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    return bodyMatch[1];
  }

  return withoutNoise;
}

function resolveLinkHref(href: string, baseUrl: string): string | null {
  const decodedHref = decodeHtmlEntities(href).trim();
  if (!decodedHref) return null;

  try {
    const resolved = new URL(decodedHref, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

function htmlToMarkdown(html: string, baseUrl: string): string {
  let output = html;

  output = output.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_match, inner: string) => {
    const code = decodeHtmlEntities(stripTags(inner)).trim();
    if (!code) return '\n\n';
    return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
  });

  output = output.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_match, inner: string) => {
    const code = inlineTextFromHtml(inner);
    if (!code) return '';
    return `\`${code}\``;
  });

  output = output.replace(/<a[^>]*href=("|')(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_match, _quote: string, href: string, label: string) => {
    const text = inlineTextFromHtml(label);
    if (!text) return '';

    const resolved = resolveLinkHref(href, baseUrl);
    if (!resolved) return text;

    return `[${escapeMarkdownLinkText(text)}](${resolved})`;
  });

  output = output.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, heading: string) => {
    const headingText = inlineTextFromHtml(heading);
    if (!headingText) return '\n\n';
    const depth = Math.min(Math.max(Number.parseInt(level, 10), 1), 6);
    return `\n\n${'#'.repeat(depth)} ${headingText}\n\n`;
  });

  output = output.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_match, item: string) => {
    const itemText = inlineTextFromHtml(item);
    return itemText ? `\n- ${itemText}` : '';
  });

  output = output
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|blockquote|ul|ol|table|tr)>/gi, '\n\n')
    .replace(/<(p|div|section|article|header|footer|blockquote|ul|ol|table|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  output = decodeHtmlEntities(output);
  return normalizeMarkdown(output);
}

function formatTruncationNotice(truncation: TruncationResult): string {
  const omittedLines = truncation.totalLines - truncation.outputLines;
  const omittedBytes = truncation.totalBytes - truncation.outputBytes;

  return (
    `[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines ` +
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
    `${omittedLines} lines (${formatSize(omittedBytes)}) omitted.]`
  );
}

function truncateForModel(text: string): { text: string; truncated: boolean } {
  const truncation = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return { text: truncation.content, truncated: false };
  }

  return {
    text: `${truncation.content}\n\n${formatTruncationNotice(truncation)}`,
    truncated: true,
  };
}

function decodeDuckDuckGoResultUrl(href: string): string | null {
  const normalizedHref = decodeHtmlEntities(href).trim();
  if (!normalizedHref) return null;

  const absoluteHref = normalizedHref.startsWith('//')
    ? `https:${normalizedHref}`
    : normalizedHref.startsWith('/')
      ? `https://duckduckgo.com${normalizedHref}`
      : normalizedHref;

  try {
    const parsed = new URL(absoluteHref);
    const redirectTarget = parsed.searchParams.get('uddg');
    if (redirectTarget) {
      const decodedTarget = decodeURIComponent(redirectTarget);
      return toHttpUrlOrNull(decodedTarget);
    }

    return toHttpUrlOrNull(absoluteHref);
  } catch {
    const redirectMatch = absoluteHref.match(/[?&]uddg=([^&]+)/);
    if (redirectMatch) {
      const decodedTarget = decodeURIComponent(redirectMatch[1]);
      return toHttpUrlOrNull(decodedTarget);
    }

    return toHttpUrlOrNull(absoluteHref);
  }
}

function extractSnippetNearIndex(html: string, startIndex: number): string {
  const window = html.slice(startIndex, startIndex + 2500);
  const snippetMatch = window.match(
    /<(?:a|div|span)[^>]*class=("|')[^"']*result__snippet[^"']*\1[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i,
  );

  if (!snippetMatch) return '';
  return inlineTextFromHtml(snippetMatch[2]);
}

function parseDuckDuckGoResults(html: string, maxResults: number): ParsedSearchResult[] {
  const results: ParsedSearchResult[] = [];
  const seenUrls = new Set<string>();
  const resultLinkPattern =
    /<a\b([^>]*\bclass=("|')[^"']*result__a[^"']*\2[^>]*)>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null = null;
  while ((match = resultLinkPattern.exec(html)) && results.length < maxResults) {
    const anchorAttributes = match[1] ?? '';
    const titleHtml = match[3] ?? '';

    const hrefMatch = anchorAttributes.match(/\bhref=("|')(.*?)\1/i);
    if (!hrefMatch) continue;

    const href = hrefMatch[2];
    const title = inlineTextFromHtml(titleHtml);
    if (!title) continue;

    const url = decodeDuckDuckGoResultUrl(href);
    if (!url || seenUrls.has(url)) continue;

    const snippet = extractSnippetNearIndex(html, match.index);

    results.push({
      title,
      url,
      snippet,
    });

    seenUrls.add(url);
  }

  return results;
}

function escapeMarkdownLinkText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function normalizeBoundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(Math.floor(value), max));
}

function formatSearchMarkdown(
  query: string,
  page: number,
  offset: number,
  results: ParsedSearchResult[],
): string {
  const lines: string[] = [];

  lines.push(`# DuckDuckGo results for "${query}"`);
  lines.push('');
  lines.push(`Page ${page} · Results ${offset + 1}-${offset + results.length}`);
  lines.push('');

  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    const number = offset + i + 1;

    lines.push(`${number}. [${escapeMarkdownLinkText(item.title)}](${item.url})`);
    if (item.snippet) {
      lines.push(`   - ${item.snippet}`);
    }
    lines.push('');
  }

  lines.push(`Use \`page: ${page + 1}\` to fetch more results.`);

  return lines.join('\n').trim();
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'web_fetch',
    label: 'Fetch Web Page',
    description:
      'Fetch a URL and extract its readable content as markdown. Useful for reading documentation, articles, API references, or any web page. Returns clean markdown text extracted from the page.',
    parameters: Type.Object({
      url: Type.String({ description: 'URL to fetch' }),
      raw: Type.Optional(Type.Boolean({
        description: 'Return raw HTML instead of extracted markdown (default: false)',
      })),
    }),

    async execute(_toolCallId, params, signal) {
      try {
        const normalizedUrl = normalizeHttpUrl(params.url);
        const response = await fetch(normalizedUrl, {
          headers: {
            'User-Agent': WEB_USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: combineAbortSignals(signal, WEB_FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
          return {
            content: [{ type: 'text' as const, text: `Fetch failed: HTTP ${response.status} ${response.statusText}` }],
            details: { url: normalizedUrl } as Record<string, unknown>,
            isError: true,
          };
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const body = await response.text();

        let outputText = '';
        let pageTitle = '';

        if (params.raw) {
          outputText = body;
        } else if (contentType.includes('html')) {
          pageTitle = extractTitle(body);
          const primaryHtml = extractPrimaryHtml(body);
          const markdownBody = htmlToMarkdown(primaryHtml, normalizedUrl);

          if (pageTitle && markdownBody) {
            outputText = `# ${pageTitle}\n\n${markdownBody}`;
          } else if (pageTitle) {
            outputText = `# ${pageTitle}`;
          } else {
            outputText = markdownBody;
          }

          if (!outputText.trim()) {
            outputText = '(Could not extract readable content from page)';
          }
        } else {
          outputText = body.trim() ? body : '(Empty response body)';
        }

        const truncated = truncateForModel(outputText);

        return {
          content: [{ type: 'text' as const, text: truncated.text }],
          details: {
            url: normalizedUrl,
            contentType,
            title: pageTitle || undefined,
            raw: !!params.raw,
            truncated: truncated.truncated,
          } as Record<string, unknown>,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error fetching ${params.url}: ${message}` }],
          details: { url: params.url } as Record<string, unknown>,
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: 'web_search',
    label: 'Web Search',
    description:
      'Search the web using DuckDuckGo HTML scraping. Returns markdown-formatted titles, URLs, and snippets. Use web_fetch to read full page content from the returned URLs.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query' }),
      count: Type.Optional(Type.Number({
        description: 'Number of results to return (default: 5, max: 20)',
      })),
      page: Type.Optional(Type.Number({
        description: 'Page number for pagination (default: 1). Each page returns up to ~20 results. Page 2 starts at result 21, etc.',
      })),
    }),

    async execute(_toolCallId, params, signal) {
      const query = params.query.trim();
      if (!query) {
        return {
          content: [{ type: 'text' as const, text: 'Search query cannot be empty.' }],
          details: {} as Record<string, unknown>,
          isError: true,
        };
      }

      const count = normalizeBoundedInteger(params.count, 5, 1, 20);
      const page = normalizeBoundedInteger(params.page, 1, 1, Number.MAX_SAFE_INTEGER);
      const offset = (page - 1) * 20;

      const searchParams = new URLSearchParams({ q: query });
      if (offset > 0) {
        searchParams.set('s', String(offset));
        searchParams.set('dc', String(offset + 1));
      }

      const searchUrl = `https://html.duckduckgo.com/html/?${searchParams.toString()}`;

      try {
        const response = await fetch(searchUrl, {
          headers: {
            'User-Agent': WEB_USER_AGENT,
            Accept: 'text/html,application/xhtml+xml',
          },
          signal: combineAbortSignals(signal, WEB_SEARCH_TIMEOUT_MS),
        });

        if (!response.ok) {
          return {
            content: [{ type: 'text' as const, text: `Search failed: HTTP ${response.status}` }],
            details: { query, page } as Record<string, unknown>,
            isError: true,
          };
        }

        const html = await response.text();
        const results = parseDuckDuckGoResults(html, count);

        if (results.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No results found for "${query}" (page ${page}).` }],
            details: { query, page, count: 0, source: 'duckduckgo' } as Record<string, unknown>,
          };
        }

        const markdown = formatSearchMarkdown(query, page, offset, results);
        const truncated = truncateForModel(markdown);

        return {
          content: [{ type: 'text' as const, text: truncated.text }],
          details: {
            query,
            page,
            count: results.length,
            source: 'duckduckgo',
            truncated: truncated.truncated,
          } as Record<string, unknown>,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Search error: ${message}` }],
          details: { query, page } as Record<string, unknown>,
          isError: true,
        };
      }
    },
  });
}
