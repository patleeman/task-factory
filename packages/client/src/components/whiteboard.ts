export interface WhiteboardElementSnapshot {
  id: string
  version: number
  versionNonce: number
  isDeleted?: boolean
}

export interface WhiteboardSceneSnapshot {
  elements: readonly WhiteboardElementSnapshot[]
  appState: Record<string, unknown>
  files: Record<string, unknown>
}

const WHITEBOARD_ATTACHMENT_PREFIX = 'excalidraw-sketch'

interface StoredWhiteboardScene {
  elements: WhiteboardSceneSnapshot['elements']
  appState: WhiteboardSceneSnapshot['appState']
  files: WhiteboardSceneSnapshot['files']
}

export function hasWhiteboardContent(scene: WhiteboardSceneSnapshot | null): boolean {
  if (!scene) return false
  return scene.elements.some((element) => !element.isDeleted)
}

export function buildWhiteboardSceneSignature(scene: WhiteboardSceneSnapshot | null): string {
  if (!scene) return ''

  const visibleElements = scene.elements
    .filter((element) => !element.isDeleted)
    .map((element) => ({
      id: element.id,
      version: element.version,
      versionNonce: element.versionNonce,
    }))
    .sort((a, b) => {
      const leftId = typeof a.id === 'string' ? a.id : ''
      const rightId = typeof b.id === 'string' ? b.id : ''
      return leftId.localeCompare(rightId)
    })

  if (visibleElements.length === 0) return ''
  return JSON.stringify(visibleElements)
}

export async function exportWhiteboardPngFile(
  scene: WhiteboardSceneSnapshot,
  filename: string,
): Promise<File> {
  const { exportToBlob } = await import('@excalidraw/excalidraw')

  const appState = {
    ...(scene.appState as Record<string, unknown>),
    exportBackground: true,
    exportEmbedScene: true,
  }

  const blob = await exportToBlob({
    elements: scene.elements as any,
    appState: appState as any,
    files: scene.files as any,
    mimeType: 'image/png',
  })

  if (!(blob instanceof Blob)) {
    throw new Error('Excalidraw export did not return an image blob')
  }

  return new File([blob], filename, { type: 'image/png' })
}

export function loadStoredWhiteboardScene(storageKey: string): WhiteboardSceneSnapshot | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<StoredWhiteboardScene>
    if (!parsed || !Array.isArray(parsed.elements)) return null

    return {
      elements: parsed.elements,
      appState: (parsed.appState || {}) as WhiteboardSceneSnapshot['appState'],
      files: (parsed.files || {}) as WhiteboardSceneSnapshot['files'],
    }
  } catch {
    return null
  }
}

export function persistWhiteboardScene(storageKey: string, scene: WhiteboardSceneSnapshot | null): void {
  try {
    if (!scene || !hasWhiteboardContent(scene)) {
      localStorage.removeItem(storageKey)
      return
    }

    const data: StoredWhiteboardScene = {
      elements: scene.elements,
      appState: scene.appState,
      files: scene.files,
    }
    localStorage.setItem(storageKey, JSON.stringify(data))
  } catch {
    // Ignore localStorage quota/unavailability errors.
  }
}

export function clearStoredWhiteboardScene(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey)
  } catch {
    // Ignore localStorage errors.
  }
}

export async function loadWhiteboardSceneFromBlob(blob: Blob): Promise<WhiteboardSceneSnapshot | null> {
  try {
    const { loadFromBlob } = await import('@excalidraw/excalidraw')
    const restored = await loadFromBlob(blob, null, null)
    if (!restored || !Array.isArray(restored.elements)) return null

    return {
      elements: restored.elements as WhiteboardSceneSnapshot['elements'],
      appState: restored.appState as WhiteboardSceneSnapshot['appState'],
      files: restored.files as WhiteboardSceneSnapshot['files'],
    }
  } catch {
    return null
  }
}

export function createWhiteboardAttachmentFilename(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${WHITEBOARD_ATTACHMENT_PREFIX}-${stamp}.png`
}

export function isWhiteboardAttachmentFilename(filename: string): boolean {
  return filename.startsWith(WHITEBOARD_ATTACHMENT_PREFIX)
}
