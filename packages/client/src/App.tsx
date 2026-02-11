import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { WelcomePage } from './components/WelcomePage'
import { WorkspacePage } from './components/WorkspacePage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/workspace/:workspaceId" element={<WorkspacePage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
