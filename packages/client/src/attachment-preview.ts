const PREVIEWABLE_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

const IMAGE_MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/jpe': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
}

function normalizeMimeType(mimeType: string): string {
  return mimeType
    .trim()
    .toLowerCase()
    .split(';', 1)[0]
    .trim()
}

export function isPreviewableImageMimeType(mimeType: string): boolean {
  if (!mimeType) return false

  const normalized = normalizeMimeType(mimeType)
  if (!normalized) return false

  const canonical = IMAGE_MIME_ALIASES[normalized] ?? normalized
  return PREVIEWABLE_IMAGE_MIME_TYPES.has(canonical)
}
