/**
 * Image normalization utilities for task/planning attachment images.
 *
 * Resizes images to fit within the 2000px dimension limit required for
 * multi-image requests (Anthropic and other providers reject images
 * exceeding this limit).
 *
 * Uses the resizeImage utility bundled with @mariozechner/pi-coding-agent.
 * That module is not re-exported from the package's public entry point, so we
 * load it at runtime via a file URL to bypass the `exports` field restriction.
 */

import { createRequire } from 'module';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';

export interface AttachmentImageContent {
  type: 'image';
  data: string;    // base64
  mimeType: string;
}

export type ResizeImageFn = (img: AttachmentImageContent) => Promise<{
  data: string;
  mimeType: string;
  wasResized: boolean;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
}>;

// Module-level cache so we only resolve once per server process.
let cachedResizeFn: ResizeImageFn | null = null;
let loadPromise: Promise<ResizeImageFn> | null = null;

async function getResizeFn(): Promise<ResizeImageFn> {
  if (cachedResizeFn) return cachedResizeFn;
  if (loadPromise) return loadPromise;

  loadPromise = (async (): Promise<ResizeImageFn> => {
    try {
      // Use createRequire so we can resolve the package's main entry path
      // without triggering the exports-field restrictions on sub-paths.
      const _require = createRequire(import.meta.url);
      const mainPath = _require.resolve('@mariozechner/pi-coding-agent');
      // Navigate from dist/index.js → dist/utils/image-resize.js
      const imageResizePath = join(dirname(mainPath), 'utils', 'image-resize.js');
      // File-URL import bypasses the package exports field entirely
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = await import(pathToFileURL(imageResizePath).href) as any;
      const fn: ResizeImageFn = mod.resizeImage;
      if (typeof fn !== 'function') {
        throw new Error('resizeImage export not found in image-resize module');
      }
      cachedResizeFn = fn;
      return fn;
    } catch (err) {
      console.warn(
        '[ImageNormalize] Could not load resizeImage utility – images will be sent unresized:',
        err,
      );
      // Fall back to a no-op so attachment loading still works even without WASM.
      const noop: ResizeImageFn = async (img) => ({
        data: img.data,
        mimeType: img.mimeType,
        wasResized: false,
        originalWidth: 0,
        originalHeight: 0,
        width: 0,
        height: 0,
      });
      cachedResizeFn = noop;
      return noop;
    }
  })();

  return loadPromise;
}

/**
 * Normalize an attachment image so it fits within the 2000px dimension limit.
 *
 * Returns the (possibly resized) ImageContent, or `null` when the image
 * cannot be processed.  Callers should skip `null` images and continue with
 * the rest of the request rather than aborting entirely.
 */
export async function normalizeAttachmentImage(
  img: AttachmentImageContent,
): Promise<AttachmentImageContent | null> {
  try {
    const resize = await getResizeFn();
    const result = await resize(img);
    return { type: 'image', data: result.data, mimeType: result.mimeType };
  } catch (err) {
    console.error('[ImageNormalize] Failed to normalize image, skipping it:', err);
    return null;
  }
}

/** Exposed for tests: reset the cached resize function. */
export function _resetResizeFnCache(): void {
  cachedResizeFn = null;
  loadPromise = null;
}

/** Exposed for tests: inject a specific resize function to use instead of the real one. */
export function _setResizeFnForTesting(fn: ResizeImageFn | null): void {
  cachedResizeFn = fn;
  loadPromise = null;
}
