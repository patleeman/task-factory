import { describe, expect, it } from 'vitest'
import type { Attachment } from '@task-factory/shared'
import { getAttachmentMimeType } from '../src/attachment-response.js'

describe('getAttachmentMimeType', () => {
  const attachments: Attachment[] = [
    {
      id: 'att-1',
      filename: 'photo.weirdext',
      storedName: 'att-1.weirdext',
      mimeType: 'image/webp',
      size: 100,
      createdAt: '2026-02-19T00:00:00.000Z',
    },
    {
      id: 'att-2',
      filename: 'raw.heic',
      storedName: 'att-2.heic',
      mimeType: 'image/heic',
      size: 200,
      createdAt: '2026-02-19T00:00:00.000Z',
    },
  ]

  it('returns MIME metadata for stored filenames even with uncommon extensions', () => {
    expect(getAttachmentMimeType(attachments, 'att-1.weirdext')).toBe('image/webp')
    expect(getAttachmentMimeType(attachments, 'att-2.heic')).toBe('image/heic')
  })

  it('returns null when metadata is missing or invalid', () => {
    expect(getAttachmentMimeType(undefined, 'missing.png')).toBeNull()
    expect(getAttachmentMimeType(attachments, 'missing.png')).toBeNull()
    expect(getAttachmentMimeType([
      {
        id: 'att-3',
        filename: 'bad.bin',
        storedName: 'att-3.bin',
        mimeType: 'not-a-mime',
        size: 1,
        createdAt: '2026-02-19T00:00:00.000Z',
      },
    ], 'att-3.bin')).toBeNull()
    expect(getAttachmentMimeType([
      {
        id: 'att-4',
        filename: 'evil.bin',
        storedName: 'att-4.bin',
        mimeType: 'text/plain\r\nX-Test: injected',
        size: 1,
        createdAt: '2026-02-19T00:00:00.000Z',
      },
    ], 'att-4.bin')).toBeNull()
  })
})
