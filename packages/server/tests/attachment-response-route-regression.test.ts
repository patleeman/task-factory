import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const serverSource = readFileSync(resolve(currentDir, '../src/index.ts'), 'utf-8')

describe('task attachment response MIME regression', () => {
  it('serves task attachments using stored MIME metadata when available', () => {
    expect(serverSource).toContain('const attachmentMimeType = getAttachmentMimeType')
    expect(serverSource).toContain("res.setHeader('Content-Type', attachmentMimeType);")
  })
})
