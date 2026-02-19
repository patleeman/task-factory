import { describe, expect, it } from 'vitest'
import { isPreviewableImageMimeType } from '../../client/src/attachment-preview'

describe('attachment preview rules', () => {
  it('allows browser-previewable image MIME types', () => {
    expect(isPreviewableImageMimeType('image/png')).toBe(true)
    expect(isPreviewableImageMimeType('image/jpeg')).toBe(true)
    expect(isPreviewableImageMimeType('image/gif')).toBe(true)
    expect(isPreviewableImageMimeType('image/webp')).toBe(true)
  })

  it('normalizes common aliases and MIME parameters', () => {
    expect(isPreviewableImageMimeType('IMAGE/JPG')).toBe(true)
    expect(isPreviewableImageMimeType('image/pjpeg')).toBe(true)
    expect(isPreviewableImageMimeType('image/x-png; charset=utf-8')).toBe(true)
  })

  it('rejects unsupported image formats so UI can render file fallback safely', () => {
    expect(isPreviewableImageMimeType('image/heic')).toBe(false)
    expect(isPreviewableImageMimeType('image/tiff')).toBe(false)
    expect(isPreviewableImageMimeType('image/svg+xml')).toBe(false)
  })
})
