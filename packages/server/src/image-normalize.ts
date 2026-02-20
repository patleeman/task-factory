/**
 * Image normalization utilities for task/planning attachment images.
 *
 * Responsibilities:
 * 1. Canonicalize MIME types – map aliases (e.g. "image/jpg") to standard
 *    forms and reject unsupported types before they reach a model API.
 * 2. Resize images to fit within the 2000px dimension limit required for
 *    multi-image requests (Anthropic and other providers reject images
 *    exceeding this limit).
 *
 * Supported inline image MIME types (per Anthropic / OpenAI API):
 *   image/jpeg, image/png, image/gif, image/webp
 *
 * Uses the resizeImage utility bundled with @mariozechner/pi-coding-agent.
 * The utility is not publicly exported, so we resolve the package entrypoint
 * via ESM resolution and then import the utility by absolute file URL.
 */

import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// =============================================================================
// MIME type allowlist & canonicalization
// =============================================================================

/**
 * The only image MIME types accepted as inline images by current model APIs
 * (Anthropic, OpenAI vision).  Anything else must be excluded before dispatch.
 */
export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

/**
 * Well-known aliases / non-standard variants that should be mapped to the
 * canonical supported type instead of being rejected outright.
 */
const MIME_ALIASES: Readonly<Record<string, SupportedImageMimeType>> = {
  'image/jpg': 'image/jpeg',
  'image/jpe': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
};

/**
 * Canonicalize an image MIME type string.
 *
 * - Lowercases and strips whitespace/parameters (e.g. `image/JPEG;charset=utf-8` → `image/jpeg`).
 * - Maps known aliases (e.g. `image/jpg` → `image/jpeg`).
 * - Returns `null` when the type is not in the supported set.
 */
export function canonicalizeImageMimeType(mimeType: string): SupportedImageMimeType | null {
  const normalized = mimeType.toLowerCase().split(';')[0].trim();
  const alias = MIME_ALIASES[normalized];
  if (alias) return alias;
  if ((SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(normalized)) {
    return normalized as SupportedImageMimeType;
  }
  return null;
}

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
let resizeModulePathForTesting: string | null = null;

function findResizeModulePathByWalkingParents(startDir: string): string | null {
  let currentDir = startDir;

  while (true) {
    const candidate = join(
      currentDir,
      'node_modules',
      '@mariozechner',
      'pi-coding-agent',
      'dist',
      'utils',
      'image-resize.js',
    );

    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function resolveResizeModulePath(): string {
  if (resizeModulePathForTesting) return resizeModulePathForTesting;

  // Prefer ESM-native resolution when available.
  try {
    const packageEntryUrl = import.meta.resolve('@mariozechner/pi-coding-agent');
    const packageEntryPath = fileURLToPath(packageEntryUrl);
    const resolvedPath = join(dirname(packageEntryPath), 'utils', 'image-resize.js');
    if (existsSync(resolvedPath)) {
      return resolvedPath;
    }
  } catch {
    // Some runners (e.g. Vitest module runner) do not support import.meta.resolve.
    // We fall back to locating the dependency on disk.
  }

  const currentModuleDir = dirname(fileURLToPath(import.meta.url));
  const fallbackPath = findResizeModulePathByWalkingParents(currentModuleDir);
  if (fallbackPath) {
    return fallbackPath;
  }

  throw new Error('Could not locate @mariozechner/pi-coding-agent/dist/utils/image-resize.js');
}

async function getResizeFn(): Promise<ResizeImageFn> {
  if (cachedResizeFn) return cachedResizeFn;
  if (loadPromise) return loadPromise;

  loadPromise = (async (): Promise<ResizeImageFn> => {
    try {
      const imageResizePath = resolveResizeModulePath();
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
 * Normalize an attachment image: canonicalize its MIME type and resize it to
 * fit within the 2000px dimension limit.
 *
 * Returns the processed `AttachmentImageContent`, or `null` when:
 * - The MIME type is unsupported (not jpeg/png/gif/webp after canonicalization).
 * - The resize step throws unexpectedly.
 *
 * Callers should skip `null` results rather than aborting the whole request.
 * When the image comes back `null` due to an unsupported MIME type, callers
 * in the task-execution path should fall back to a file-path reference in the
 * prompt so the agent can still read the file directly.
 */
export async function normalizeAttachmentImage(
  img: AttachmentImageContent,
): Promise<AttachmentImageContent | null> {
  // Reject unsupported MIME types before touching the image data.
  const canonicalMime = canonicalizeImageMimeType(img.mimeType);
  if (!canonicalMime) {
    console.warn(
      `[ImageNormalize] Unsupported image MIME type "${img.mimeType}" – skipping inline attachment.`,
    );
    return null;
  }

  try {
    const resize = await getResizeFn();
    // Pass the canonicalized MIME so the resizer doesn't see aliases.
    const result = await resize({ ...img, mimeType: canonicalMime });
    // Ensure the output MIME is also canonical (resizer may change format,
    // e.g. jpeg→png for lossless).
    const outputMime = canonicalizeImageMimeType(result.mimeType) ?? canonicalMime;
    return { type: 'image', data: result.data, mimeType: outputMime };
  } catch (err) {
    console.error('[ImageNormalize] Failed to normalize image, skipping it:', err);
    return null;
  }
}

/** Exposed for tests: reset the cached resize function. */
export function _resetResizeFnCache(): void {
  cachedResizeFn = null;
  loadPromise = null;
  resizeModulePathForTesting = null;
}

/** Exposed for tests: inject a specific resize function to use instead of the real one. */
export function _setResizeFnForTesting(fn: ResizeImageFn | null): void {
  cachedResizeFn = fn;
  loadPromise = null;
}

/** Exposed for tests: override the resolved resize module path. */
export function _setResizeModulePathForTesting(modulePath: string | null): void {
  resizeModulePathForTesting = modulePath;
  cachedResizeFn = null;
  loadPromise = null;
}
