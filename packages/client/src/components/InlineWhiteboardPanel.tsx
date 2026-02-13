import { lazy, Suspense } from 'react'
import type { WhiteboardSceneSnapshot } from './whiteboard'

const LazyExcalidrawBoard = lazy(() => import('./ExcalidrawBoard'))

interface InlineWhiteboardPanelProps {
  isActive: boolean
  onActivate?: () => void
  onSceneChange: (scene: WhiteboardSceneSnapshot) => void
  activateLabel?: string
  inactiveHint?: string
}

export function InlineWhiteboardPanel({
  isActive,
  onActivate,
  onSceneChange,
  activateLabel = 'Open whiteboard',
  inactiveHint,
}: InlineWhiteboardPanelProps) {
  if (!isActive) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
        <button
          type="button"
          onClick={onActivate}
          className="btn btn-secondary text-sm py-1.5 px-3"
          disabled={!onActivate}
        >
          {activateLabel}
        </button>
        {inactiveHint && (
          <p className="text-xs text-slate-400 mt-2">{inactiveHint}</p>
        )}
      </div>
    )
  }

  return (
    <Suspense
      fallback={(
        <div className="h-72 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-sm text-slate-500">
          Loading whiteboard…
        </div>
      )}
    >
      <LazyExcalidrawBoard onSceneChange={onSceneChange} />
    </Suspense>
  )
}
