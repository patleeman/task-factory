import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { WelcomePage } from './components/WelcomePage'
import { WorkspacePage } from './components/WorkspacePage'
import { SettingsPage } from './components/SettingsPage'
import { WorkspaceConfigPage } from './components/WorkspaceConfigPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/workspace/:workspaceId" element={<WorkspacePage />} />
        <Route path="/workspace/:workspaceId/config" element={<WorkspaceConfigPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
