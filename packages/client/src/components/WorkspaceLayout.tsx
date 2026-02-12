import { Outlet } from 'react-router-dom'
import { WorkspaceRail } from './WorkspaceRail'

export function WorkspaceLayout() {
  return (
    <div className="flex h-screen">
      <WorkspaceRail />
      <div className="flex-1 min-w-0 h-full">
        <Outlet />
      </div>
    </div>
  )
}
