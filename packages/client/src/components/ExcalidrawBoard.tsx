import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawProps } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import type { WhiteboardSceneSnapshot } from './whiteboard'

interface ExcalidrawBoardProps {
  onSceneChange: (scene: WhiteboardSceneSnapshot) => void
}

export default function ExcalidrawBoard({ onSceneChange }: ExcalidrawBoardProps) {
  const handleChange: NonNullable<ExcalidrawProps['onChange']> = (elements, appState, files) => {
    onSceneChange({
      elements: elements as WhiteboardSceneSnapshot['elements'],
      appState: appState as unknown as WhiteboardSceneSnapshot['appState'],
      files: files as WhiteboardSceneSnapshot['files'],
    })
  }

  return (
    <div className="h-72 rounded-lg border border-slate-200 overflow-hidden bg-white">
      <Excalidraw
        onChange={handleChange}
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
  )
}
