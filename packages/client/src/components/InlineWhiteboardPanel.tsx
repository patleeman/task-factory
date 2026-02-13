import { lazy, Suspense, useMemo } from 'react'
import { buildWhiteboardSceneSignature, type WhiteboardSceneSnapshot } from './whiteboard'

const LazyExcalidrawBoard = lazy(() => import('./ExcalidrawBoard'))

interface InlineWhiteboardPanelProps {
  isActive: boolean
  onActivate?: () => void
  onSceneChange: (scene: WhiteboardSceneSnapshot) => void
  initialScene?: WhiteboardSceneSnapshot | null
  activateLabel?: string
  inactiveHint?: string
  heightClassName?: string
}

export function InlineWhiteboardPanel({
  isActive,
  onActivate,
  onSceneChange,
  initialScene = null,
  activateLabel = 'Open whiteboard',
  inactiveHint,
  heightClassName = 'h-96',
}: InlineWhiteboardPanelProps) {
  const sceneKey = useMemo(() => buildWhiteboardSceneSignature(initialScene), [initialScene])

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
        <div className={`${heightClassName} min-h-[280px] max-h-[80vh] resize-y overflow-auto rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-sm text-slate-500`}>
          Loading whiteboard…
        </div>
      )}
    >
      <LazyExcalidrawBoard
        key={sceneKey || 'blank-scene'}
        onSceneChange={onSceneChange}
        initialScene={initialScene}
        heightClassName={heightClassName}
      />
    </Suspense>
  )
}
