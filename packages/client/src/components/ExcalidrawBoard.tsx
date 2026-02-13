import { useCallback, useMemo } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawProps } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import type { WhiteboardSceneSnapshot } from './whiteboard'
import { useTheme } from '../hooks/useTheme'

interface ExcalidrawBoardProps {
  onSceneChange: (scene: WhiteboardSceneSnapshot) => void
  initialScene?: WhiteboardSceneSnapshot | null
  heightClassName?: string
}

export default function ExcalidrawBoard({
  onSceneChange,
  initialScene = null,
  heightClassName = 'h-96',
}: ExcalidrawBoardProps) {
  const { theme } = useTheme()

  const handleChange = useCallback<NonNullable<ExcalidrawProps['onChange']>>((elements, appState, files) => {
    onSceneChange({
      elements: elements as WhiteboardSceneSnapshot['elements'],
      appState: appState as unknown as WhiteboardSceneSnapshot['appState'],
      files: files as WhiteboardSceneSnapshot['files'],
    })
  }, [onSceneChange])

  const initialData = useMemo(() => {
    if (!initialScene) return null

    return {
      elements: initialScene.elements as any,
      appState: initialScene.appState as any,
      files: initialScene.files as any,
    }
  }, [initialScene])

  return (
    <div className={`${heightClassName} min-h-[280px] max-h-[80vh] resize-y overflow-auto rounded-lg border border-slate-200 bg-white`}>
      <div className="h-full min-h-[280px]">
        <Excalidraw
          onChange={handleChange}
          initialData={initialData}
          theme={theme}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: true,
              clearCanvas: true,
              export: false,
              loadScene: false,
              saveAsImage: false,
              saveToActiveFile: false,
              toggleTheme: false,
            },
          }}
        />
      </div>
    </div>
  )
}
