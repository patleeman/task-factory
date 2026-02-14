import { Outlet, useParams } from 'react-router-dom'
import { WorkspaceRail } from './WorkspaceRail'
import { useWebSocket } from '../hooks/useWebSocket'

export function WorkspaceLayout() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  // Keep one socket per workspace while navigating between task routes.
  const webSocket = useWebSocket(workspaceId || null)

  return (
    <div className="flex h-screen">
      <WorkspaceRail />
      <div className="flex-1 min-w-0 h-full">
        <Outlet context={webSocket} />
      </div>
    </div>
  )
}
