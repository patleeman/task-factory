/**
 * Tests for image normalization and attachment loading with resize.
 *
 * Covers:
 * - normalizeAttachmentImage: resize path, error fallback
 * - loadAttachmentsByIds: multi-image normalization, per-image failure skip,
 *   non-image attachment no-op regression
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  normalizeAttachmentImage,
  _setResizeFnForTesting,
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
// normalizeAttachmentImage
// ---------------------------------------------------------------------------

describe('normalizeAttachmentImage', () => {
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

  it('skips an image whose file is absent on disk', async () => {
    _setResizeFnForTesting(makeResizeFn('NORMALIZED'));

    const { workspacePath } = createTempWorkspace();
    const taskId = 'TASK-NODISK-1';
    const dir = createTaskAttachmentDir(workspacePath, taskId);

    // Only write the second file; leave the first absent.
    writeFileSync(join(dir, 'present.png'), Buffer.from(SMALL_PNG_B64, 'base64'));

    const attachments = [
      { id: 'a1', filename: 'absent.png', storedName: 'absent.png', mimeType: 'image/png', size: 10, createdAt: '' },
      { id: 'a2', filename: 'present.png', storedName: 'present.png', mimeType: 'image/png', size: 10, createdAt: '' },
    ];

    const result = await loadAttachmentsByIds(['a1', 'a2'], attachments, workspacePath, taskId);

    // The absent file is silently skipped; the present file is normalized.
    expect(result).toHaveLength(1);
    expect(result[0].data).toBe('NORMALIZED');
  });
});
