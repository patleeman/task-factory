import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { WelcomePage } from './components/WelcomePage'
import { WorkspacePage } from './components/WorkspacePage'
import { SettingsPage } from './components/SettingsPage'
import { WorkspaceConfigPage } from './components/WorkspaceConfigPage'
import { WorkspaceLayout } from './components/WorkspaceLayout'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/settings" element={<SettingsPage />} />

        <Route element={<WorkspaceLayout />}>
          <Route path="/workspace/:workspaceId" element={<WorkspacePage />} />
          <Route path="/workspace/:workspaceId/archive" element={<WorkspacePage />} />
          <Route path="/workspace/:workspaceId/tasks/new" element={<WorkspacePage />} />
          <Route path="/workspace/:workspaceId/tasks/:taskId" element={<WorkspacePage />} />
          <Route path="/workspace/:workspaceId/config" element={<WorkspaceConfigPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
