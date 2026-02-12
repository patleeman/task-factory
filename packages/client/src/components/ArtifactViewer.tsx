import { useRef, useEffect } from 'react'

interface ArtifactViewerProps {
  html: string
}

/**
 * Renders HTML artifacts in a sandboxed iframe.
 * No access to parent app state — purely visual.
 */
export function ArtifactViewer({ html }: ArtifactViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    // Write HTML content into the sandboxed iframe
    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (doc) {
      doc.open()
      doc.write(html)
      doc.close()
    }
  }, [html])

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-scripts"
      className="w-full h-full border-0 bg-white"
      title="Artifact"
    />
  )
}
