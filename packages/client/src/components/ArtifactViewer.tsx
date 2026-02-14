interface ArtifactViewerProps {
  html: string
}

/**
 * Renders HTML artifacts in a sandboxed iframe.
 * No access to parent app state — purely visual.
 */
export function ArtifactViewer({ html }: ArtifactViewerProps) {
  return (
    <iframe
      // srcDoc avoids parent-frame document access, which is blocked for sandboxed iframes.
      srcDoc={html}
      sandbox="allow-scripts"
      className="w-full h-full border-0 bg-white"
      title="Artifact"
    />
  )
}
