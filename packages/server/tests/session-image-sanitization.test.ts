/**
 * Tests for session file image sanitization and MIME error detection.
 *
 * Covers:
 * - isImageMimeTypeError: Anthropic 400 pattern, false positives
 * - sanitizeSessionFileImages: removes bad-MIME image blocks, leaves
 *   supported images intact, handles edge cases (missing file, bad JSON,
 *   no changes needed)
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  _sanitizeSessionFileImages,
  _isImageMimeTypeError,
} from '../src/agent-execution-service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempRoots: string[] = [];

function makeTempFile(content: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pi-factory-session-san-'));
  tempRoots.push(root);
  const file = join(root, 'session.jsonl');
  writeFileSync(file, content, 'utf-8');
  return file;
}

function jsonl(...objs: object[]): string {
  return objs.map(o => JSON.stringify(o)).join('\n');
}

/** Build a session JSONL message entry. */
function messageEntry(role: 'user' | 'assistant', content: object[]): object {
  return {
    type: 'message',
    id: 'test-id',
    parentId: null,
    timestamp: new Date().toISOString(),
    message: { role, content },
  };
}

/** A minimal session header line. */
const sessionHeader = {
  type: 'session',
  version: 3,
  id: 'test-session-id',
  timestamp: new Date().toISOString(),
  cwd: '/tmp',
};

afterEach(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// isImageMimeTypeError
// ---------------------------------------------------------------------------

describe('isImageMimeTypeError', () => {
  it('detects the Anthropic media_type validation pattern', () => {
    const msg = `messages.68.content.1.image.source.base64.media_type: Input should be 'image/jpeg', 'image/png', 'image/gif' or 'image/webp'`;
    expect(_isImageMimeTypeError(msg)).toBe(true);
  });

  it('detects errors that mention media_type and image.source', () => {
    expect(_isImageMimeTypeError('image.source.base64.media_type is invalid')).toBe(true);
  });

  it('returns false for rate-limit errors', () => {
    expect(_isImageMimeTypeError('Rate limit exceeded (429)')).toBe(false);
  });

  it('returns false for generic 500 errors', () => {
    expect(_isImageMimeTypeError('Internal server error 500')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(_isImageMimeTypeError('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sanitizeSessionFileImages
// ---------------------------------------------------------------------------

describe('sanitizeSessionFileImages', () => {
  it('removes image blocks with unsupported MIME types and replaces with text note', () => {
    const badImageBlock = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/svg+xml', data: 'PHN2Zy8+' },
    };
    const file = makeTempFile(jsonl(
      sessionHeader,
      messageEntry('user', [{ type: 'text', text: 'here is an image' }, badImageBlock]),
    ));

    _sanitizeSessionFileImages(file);

    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    const msg = JSON.parse(lines[1]);
    expect(msg.message.content).toHaveLength(2);
    expect(msg.message.content[0]).toEqual({ type: 'text', text: 'here is an image' });
    // Bad image replaced with explanatory text note
    expect(msg.message.content[1].type).toBe('text');
    expect(msg.message.content[1].text).toContain('image/svg+xml');
    expect(msg.message.content[1].text).toContain('removed');
  });

  it('leaves supported image blocks (image/png, image/jpeg, image/gif, image/webp) untouched', () => {
    const goodImageBlock = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
    };
    const original = jsonl(
      sessionHeader,
      messageEntry('user', [goodImageBlock]),
    );
    const file = makeTempFile(original);

    _sanitizeSessionFileImages(file);

    // File should not have been rewritten (no changes needed).
    expect(readFileSync(file, 'utf-8')).toBe(original);
  });

  it('handles multiple messages — only rewrites messages containing bad images', () => {
    const goodBlock = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'ok' } };
    const badBlock = { type: 'image', source: { type: 'base64', media_type: 'image/tiff', data: 'bad' } };

    const file = makeTempFile(jsonl(
      sessionHeader,
      messageEntry('user', [{ type: 'text', text: 'first' }, goodBlock]),
      messageEntry('user', [badBlock]),
    ));

    _sanitizeSessionFileImages(file);

    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    const msg1 = JSON.parse(lines[1]);
    const msg2 = JSON.parse(lines[2]);

    // First message unchanged (good image).
    expect(msg1.message.content[1]).toEqual(goodBlock);
    // Second message: bad image replaced.
    expect(msg2.message.content[0].type).toBe('text');
    expect(msg2.message.content[0].text).toContain('image/tiff');
  });

  it('does not rewrite the file when no unsupported images are found', () => {
    const original = jsonl(sessionHeader, messageEntry('user', [{ type: 'text', text: 'hello' }]));
    const file = makeTempFile(original);

    _sanitizeSessionFileImages(file);

    // No image blocks at all — file content should be byte-for-byte identical.
    expect(readFileSync(file, 'utf-8')).toBe(original);
  });

  it('does not throw when the file does not exist', () => {
    expect(() => _sanitizeSessionFileImages('/nonexistent/path/session.jsonl')).not.toThrow();
  });

  it('does not throw when the file contains invalid JSON lines', () => {
    const file = makeTempFile('not-json\n{"type":"session"}\ninvalid{}\n');
    expect(() => _sanitizeSessionFileImages(file)).not.toThrow();
  });

  it('does not throw when the file is empty', () => {
    const file = makeTempFile('');
    expect(() => _sanitizeSessionFileImages(file)).not.toThrow();
  });
});
