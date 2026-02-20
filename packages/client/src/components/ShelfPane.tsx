import { X } from 'lucide-react'
import type { Artifact } from '@task-factory/shared'
import { AppIcon } from './AppIcon'
import { ArtifactViewer } from './ArtifactViewer'
import { WorkspacePipelineDashboard } from './WorkspacePipelineDashboard'

interface ShelfPaneProps {
  workspaceId: string
  activeArtifact: Artifact | null
  onCloseArtifact: () => void
}

export function ShelfPane({
  workspaceId,
  activeArtifact,
  onCloseArtifact,
}: ShelfPaneProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0">
        <h2 className="font-semibold text-xs text-slate-500 uppercase tracking-wide">
          Foreman Workspace
        </h2>
        {activeArtifact && (
          <button
            onClick={onCloseArtifact}
            className="text-xs text-slate-400 hover:text-slate-600 inline-flex items-center gap-1"
          >
            <AppIcon icon={X} size="xs" />
            Close artifact
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 bg-white">
        {activeArtifact ? (
          <div className="h-full flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-slate-200 bg-slate-50/60 shrink-0">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Artifact Viewer</div>
              <div className="text-sm text-slate-700 truncate font-medium">{activeArtifact.name}</div>
            </div>
            <div className="flex-1 min-h-0">
              <ArtifactViewer html={activeArtifact.html} />
            </div>
          </div>
        ) : (
          <WorkspacePipelineDashboard workspaceId={workspaceId} />
        )}
      </div>

    </div>
  )
}
