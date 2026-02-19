import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const taskChatSource = readFileSync(resolve(currentDir, '../../client/src/components/TaskChat.tsx'), 'utf-8')
const createTaskPaneSource = readFileSync(resolve(currentDir, '../../client/src/components/CreateTaskPane.tsx'), 'utf-8')

describe('attachment preview usage regression', () => {
  it('TaskChat uses previewable MIME rules for attached message images and pending files', () => {
    expect(taskChatSource).toContain("isPreviewableImageMimeType(att.mimeType)")
    expect(taskChatSource).toContain("isPreviewableImageMimeType(file.type)")
    expect(taskChatSource).toContain('setAttachmentPreview({ url, filename: att.filename })')
    expect(taskChatSource).not.toContain("att.mimeType.startsWith('image/')")
  })

  it('CreateTaskPane pending previews use previewable MIME rules', () => {
    expect(createTaskPaneSource).toContain("isPreviewableImageMimeType(file.type)")
    expect(createTaskPaneSource).not.toContain("file.type.startsWith('image/')")
  })
})
