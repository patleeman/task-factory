import type { Attachment } from '@task-factory/shared'

const MIME_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/

function normalizeMimeType(mimeType: string): string {
  return mimeType.trim().toLowerCase().split(';', 1)[0].trim()
}

function isValidMimeType(mimeType: string): boolean {
  return MIME_TYPE_PATTERN.test(mimeType)
}

/**
 * Returns a normalized attachment MIME type from task metadata for a stored filename.
 * Falls back to null when missing/invalid so callers can keep default sendFile behavior.
 */
export function getAttachmentMimeType(
  attachments: Attachment[] | undefined,
  storedName: string,
): string | null {
  if (!attachments || attachments.length === 0) return null

  const attachment = attachments.find((item) => item.storedName === storedName)
  if (!attachment || typeof attachment.mimeType !== 'string') return null

  const normalized = normalizeMimeType(attachment.mimeType)
  if (!isValidMimeType(normalized)) return null

  return normalized
}
