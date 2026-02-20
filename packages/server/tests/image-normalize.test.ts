/**
 * Tests for image normalization and attachment loading with resize.
 *
 * Covers:
 * - canonicalizeImageMimeType: supported types, aliases, unsupported types
 * - normalizeAttachmentImage: unsupported MIME rejection, alias canonicalization,
 *   resize path, error fallback
 * - loadAttachmentsByIds: multi-image normalization, unsupported-MIME skip,
 *   per-image failure skip, non-image attachment no-op regression
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  canonicalizeImageMimeType,
  normalizeAttachmentImage,
  SUPPORTED_IMAGE_MIME_TYPES,
  _setResizeFnForTesting,
  _setResizeModulePathForTesting,
  _resetResizeFnCache,
  type AttachmentImageContent,
  type ResizeImageFn,
} from '../src/image-normalize.js';
import { loadAttachmentsByIds } from '../src/agent-execution-service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SMALL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function makeResizeFn(returnData?: string): ResizeImageFn {
  return vi.fn(async (img: AttachmentImageContent) => ({
    data: returnData ?? img.data,
    mimeType: img.mimeType,
    wasResized: returnData !== undefined,
    originalWidth: 3000,
    originalHeight: 2000,
    width: 2000,
    height: 1333,
  }));
}

function makeThrowingResizeFn(): ResizeImageFn {
  return vi.fn(async (_img: AttachmentImageContent) => {
    throw new Error('simulated resize failure');
  });
}

const tempRoots: string[] = [];

function createTempWorkspace(): { workspacePath: string } {
  const root = mkdtempSync(join(tmpdir(), 'pi-factory-image-normalize-'));
  tempRoots.push(root);
  const workspacePath = join(root, 'workspace');
  mkdirSync(workspacePath, { recursive: true });
  return { workspacePath };
}

function createTaskAttachmentDir(workspacePath: string, taskId: string): string {
  const dir = join(workspacePath, '.taskfactory', 'tasks', taskId.toLowerCase(), 'attachments');
  mkdirSync(dir, { recursive: true });
  return dir;
}

afterEach(() => {
  _resetResizeFnCache();
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// canonicalizeImageMimeType
// ---------------------------------------------------------------------------

describe('canonicalizeImageMimeType', () => {
  it('returns canonical form for each directly supported type', () => {
    for (const mime of SUPPORTED_IMAGE_MIME_TYPES) {
      expect(canonicalizeImageMimeType(mime)).toBe(mime);
    }
  });

  it('normalizes uppercase input to canonical lowercase', () => {
    expect(canonicalizeImageMimeType('image/JPEG')).toBe('image/jpeg');
    expect(canonicalizeImageMimeType('IMAGE/PNG')).toBe('image/png');
    expect(canonicalizeImageMimeType('Image/WebP')).toBe('image/webp');
  });

  it('strips MIME parameters before comparison', () => {
    expect(canonicalizeImageMimeType('image/jpeg; charset=utf-8')).toBe('image/jpeg');
    expect(canonicalizeImageMimeType('image/png;q=0.9')).toBe('image/png');
  });

  it('maps image/jpg alias to image/jpeg', () => {
    expect(canonicalizeImageMimeType('image/jpg')).toBe('image/jpeg');
  });

  it('maps image/jpe alias to image/jpeg', () => {
    expect(canonicalizeImageMimeType('image/jpe')).toBe('image/jpeg');
  });

  it('maps image/pjpeg alias to image/jpeg', () => {
    expect(canonicalizeImageMimeType('image/pjpeg')).toBe('image/jpeg');
  });

  it('maps image/x-png alias to image/png', () => {
    expect(canonicalizeImageMimeType('image/x-png')).toBe('image/png');
  });

  it('returns null for image/svg+xml', () => {
    expect(canonicalizeImageMimeType('image/svg+xml')).toBeNull();
  });

  it('returns null for image/tiff', () => {
    expect(canonicalizeImageMimeType('image/tiff')).toBeNull();
  });

  it('returns null for image/bmp', () => {
    expect(canonicalizeImageMimeType('image/bmp')).toBeNull();
  });

  it('returns null for non-image MIME types', () => {
    expect(canonicalizeImageMimeType('application/pdf')).toBeNull();
    expect(canonicalizeImageMimeType('text/plain')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(canonicalizeImageMimeType('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeAttachmentImage
// ---------------------------------------------------------------------------

describe('normalizeAttachmentImage', () => {
  it('returns null (without calling resize) for an unsupported MIME type', async () => {
    const resizeFn = makeResizeFn('SHOULD_NOT_BE_CALLED');
    _setResizeFnForTesting(resizeFn);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await normalizeAttachmentImage({
      type: 'image',
      data: SMALL_PNG_B64,
      mimeType: 'image/svg+xml',
    });

    expect(result).toBeNull();
    expect(resizeFn).not.toHaveBeenCalled();
    // Warning should name the offending MIME type to aid debugging.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('image/svg+xml'));
  });

  it('falls back to canonical input MIME when resizer returns an unrecognized MIME type', async () => {
    // Defensive: if the resize utility ever returns a non-canonical MIME
    // (shouldn't happen in practice), we fall back to the canonical input type.
    const strangeResizeFn: ResizeImageFn = vi.fn(async (img: AttachmentImageContent) => ({
      data: 'RESIZED',
      mimeType: 'image/x-unknown-format', // unexpected output from resizer
      wasResized: true,
      originalWidth: 100,
      originalHeight: 100,
      width: 100,
      height: 100,
    }));
    _setResizeFnForTesting(strangeResizeFn);

    const result = await normalizeAttachmentImage({
      type: 'image',
      data: SMALL_PNG_B64,
      mimeType: 'image/png',
    });

    expect(result).not.toBeNull();
    // Output MIME should be the canonical input type, not the unknown resizer output.
    expect(result!.mimeType).toBe('image/png');
  });

  it('normalizes image/jpg alias to image/jpeg before passing to resize', async () => {
    const resizeFn = makeResizeFn();
    _setResizeFnForTesting(resizeFn);

    const result = await normalizeAttachmentImage({
      type: 'image',
      data: SMALL_PNG_B64,
      mimeType: 'image/jpg',
    });

    expect(result).not.toBeNull();
    // The resize function should receive the canonical MIME type.
    expect((resizeFn as ReturnType<typeof vi.fn>).mock.calls[0][0].mimeType).toBe('image/jpeg');
  });

  it('returns the resized image data from the resize function', async () => {
    const resizedB64 = 'RESIZED_DATA';
    _setResizeFnForTesting(makeResizeFn(resizedB64));

    const result = await normalizeAttachmentImage({
      type: 'image',
      data: SMALL_PNG_B64,
      mimeType: 'image/png',
    });

    expect(result).not.toBeNull();
    expect(result!.type).toBe('image');
    expect(result!.data).toBe(resizedB64);
    expect(result!.mimeType).toBe('image/png');
  });

  it('returns original image unchanged when resize returns the same data', async () => {
    _setResizeFnForTesting(makeResizeFn(/* no override → returns img.data */));

    const result = await normalizeAttachmentImage({
      type: 'image',
      data: SMALL_PNG_B64,
      mimeType: 'image/jpeg',
    });

    expect(result).not.toBeNull();
    expect(result!.data).toBe(SMALL_PNG_B64);
    expect(result!.mimeType).toBe('image/jpeg');
  });

  it('loads the real resize utility path without export-path warnings', async () => {
    _setResizeFnForTesting(null);
    _setResizeModulePathForTesting(null);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await normalizeAttachmentImage({
      type: 'image',
      data: SMALL_PNG_B64,
      mimeType: 'image/png',
    });

    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe('image/png');
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('[ImageNormalize] Could not load resizeImage utility'),
      expect.anything(),
    );
  });

  it('falls back to no-op resize when utility loading fails for other reasons', async () => {
    _setResizeFnForTesting(null);
    _setResizeModulePathForTesting('/definitely-missing/image-resize.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await normalizeAttachmentImage({
      type: 'image',
      data: SMALL_PNG_B64,
      mimeType: 'image/png',
    });

    expect(result).not.toBeNull();
    expect(result!.data).toBe(SMALL_PNG_B64);
    expect(result!.mimeType).toBe('image/png');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ImageNormalize] Could not load resizeImage utility'),
      expect.any(Error),
    );
  });

  it('returns null and logs an error when the resize function throws', async () => {
    _setResizeFnForTesting(makeThrowingResizeFn());
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await normalizeAttachmentImage({
      type: 'image',
      data: SMALL_PNG_B64,
      mimeType: 'image/png',
    });

    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[ImageNormalize]'),
      expect.any(Error),
    );
  });
});

// ---------------------------------------------------------------------------
// loadAttachmentsByIds — multi-image normalization
// ---------------------------------------------------------------------------

describe('loadAttachmentsByIds', () => {
  it('normalizes all image attachments via the resize function', async () => {
    const resizeFn = makeResizeFn('NORMALIZED');
    _setResizeFnForTesting(resizeFn);

    const { workspacePath } = createTempWorkspace();
    const taskId = 'TASK-NORM-1';
    const dir = createTaskAttachmentDir(workspacePath, taskId);

    writeFileSync(join(dir, 'img1.png'), Buffer.from(SMALL_PNG_B64, 'base64'));
    writeFileSync(join(dir, 'img2.png'), Buffer.from(SMALL_PNG_B64, 'base64'));

    const attachments = [
      { id: 'id1', filename: 'img1.png', storedName: 'img1.png', mimeType: 'image/png', size: 10, createdAt: '' },
      { id: 'id2', filename: 'img2.png', storedName: 'img2.png', mimeType: 'image/png', size: 10, createdAt: '' },
    ];

    const result = await loadAttachmentsByIds(['id1', 'id2'], attachments, workspacePath, taskId);

    expect(result).toHaveLength(2);
    expect(result[0].data).toBe('NORMALIZED');
    expect(result[1].data).toBe('NORMALIZED');
    expect(resizeFn).toHaveBeenCalledTimes(2);
  });

  it('skips an image with an unsupported MIME type (e.g. image/svg+xml)', async () => {
    const resizeFn = makeResizeFn('NORMALIZED');
    _setResizeFnForTesting(resizeFn);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { workspacePath } = createTempWorkspace();
    const taskId = 'TASK-SVG-1';
    const dir = createTaskAttachmentDir(workspacePath, taskId);

    writeFileSync(join(dir, 'icon.svg'), '<svg/>');
    writeFileSync(join(dir, 'img.png'), Buffer.from(SMALL_PNG_B64, 'base64'));

    const attachments = [
      { id: 'svg1', filename: 'icon.svg', storedName: 'icon.svg', mimeType: 'image/svg+xml', size: 6, createdAt: '' },
      { id: 'png1', filename: 'img.png', storedName: 'img.png', mimeType: 'image/png', size: 10, createdAt: '' },
    ];

    const result = await loadAttachmentsByIds(['svg1', 'png1'], attachments, workspacePath, taskId);

    // SVG is skipped; only the PNG comes through.
    expect(result).toHaveLength(1);
    expect(result[0].mimeType).toBe('image/png');
    // resize was only called for the PNG
    expect(resizeFn).toHaveBeenCalledTimes(1);
  });

  it('normalizes image/jpg alias attachment to image/jpeg', async () => {
    const resizeFn = makeResizeFn('NORMALIZED_JPEG');
    _setResizeFnForTesting(resizeFn);

    const { workspacePath } = createTempWorkspace();
    const taskId = 'TASK-JPG-ALIAS';
    const dir = createTaskAttachmentDir(workspacePath, taskId);

    writeFileSync(join(dir, 'photo.jpg'), Buffer.from(SMALL_PNG_B64, 'base64'));

    const attachments = [
      { id: 'j1', filename: 'photo.jpg', storedName: 'photo.jpg', mimeType: 'image/jpg', size: 10, createdAt: '' },
    ];

    const result = await loadAttachmentsByIds(['j1'], attachments, workspacePath, taskId);

    expect(result).toHaveLength(1);
    expect(result[0].data).toBe('NORMALIZED_JPEG');
  });

  it('skips an image that fails normalization, returning the rest', async () => {
    let callCount = 0;
    const mixedFn: ResizeImageFn = vi.fn(async (img: AttachmentImageContent) => {
      callCount++;
      if (callCount === 1) throw new Error('simulated resize failure for first image');
      return { data: 'OK', mimeType: img.mimeType, wasResized: true, originalWidth: 3000, originalHeight: 2000, width: 2000, height: 1333 };
    });
    _setResizeFnForTesting(mixedFn);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { workspacePath } = createTempWorkspace();
    const taskId = 'TASK-SKIP-1';
    const dir = createTaskAttachmentDir(workspacePath, taskId);

    writeFileSync(join(dir, 'bad.png'), Buffer.from(SMALL_PNG_B64, 'base64'));
    writeFileSync(join(dir, 'good.png'), Buffer.from(SMALL_PNG_B64, 'base64'));

    const attachments = [
      { id: 'a1', filename: 'bad.png', storedName: 'bad.png', mimeType: 'image/png', size: 10, createdAt: '' },
      { id: 'a2', filename: 'good.png', storedName: 'good.png', mimeType: 'image/png', size: 10, createdAt: '' },
    ];

    const result = await loadAttachmentsByIds(['a1', 'a2'], attachments, workspacePath, taskId);

    // The failed image is skipped; the second one succeeds.
    expect(result).toHaveLength(1);
    expect(result[0].data).toBe('OK');
  });

  it('does not include non-image attachments in the returned ImageContent array', async () => {
    _setResizeFnForTesting(makeResizeFn('NORMALIZED'));

    const { workspacePath } = createTempWorkspace();
    const taskId = 'TASK-NONIMG-1';
    const dir = createTaskAttachmentDir(workspacePath, taskId);

    writeFileSync(join(dir, 'doc.pdf'), 'pdf-content');
    writeFileSync(join(dir, 'img.png'), Buffer.from(SMALL_PNG_B64, 'base64'));

    const attachments = [
      { id: 'pdf1', filename: 'doc.pdf', storedName: 'doc.pdf', mimeType: 'application/pdf', size: 11, createdAt: '' },
      { id: 'img1', filename: 'img.png', storedName: 'img.png', mimeType: 'image/png', size: 10, createdAt: '' },
    ];

    const result = await loadAttachmentsByIds(['pdf1', 'img1'], attachments, workspacePath, taskId);

    // Only the image is included; the PDF is silently ignored.
    expect(result).toHaveLength(1);
    expect(result[0].mimeType).toBe('image/png');
  });

  it('returns an empty array when given an empty ID list', async () => {
    _setResizeFnForTesting(makeResizeFn());
    const { workspacePath } = createTempWorkspace();
    const result = await loadAttachmentsByIds([], [], workspacePath, 'TASK-EMPTY');
    expect(result).toHaveLength(0);
  });

  it('skips attachment IDs that do not exist in the attachment list', async () => {
    _setResizeFnForTesting(makeResizeFn('NORMALIZED'));
    const { workspacePath } = createTempWorkspace();
    const taskId = 'TASK-MISSING-1';
    createTaskAttachmentDir(workspacePath, taskId);

    const result = await loadAttachmentsByIds(
      ['unknown-id'],
      [{ id: 'other-id', filename: 'img.png', storedName: 'img.png', mimeType: 'image/png', size: 10, createdAt: '' }],
      workspacePath,
      taskId,
    );

    expect(result).toHaveLength(0);
  });
});
