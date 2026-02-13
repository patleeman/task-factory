import { useState, useEffect } from 'react'
import { Settings } from 'lucide-react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Workspace } from '@pi-factory/shared'
import { api } from '../api'
import { AppIcon } from './AppIcon'

/**
 * Deterministic HSL hue from a string name.
 * Simple hash → hue in [0, 360).
 */
function nameToHue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash) % 360
}

/**
 * Extract 1-2 uppercase initials from a folder name.
 * e.g. "pi-factory" → "PF", "myapp" → "MY", "x" → "X"
 */
function getInitials(name: string): string {
  // Split on common separators
  const parts = name.split(/[-_.\s]+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  // Single word: take first two chars
  return name.slice(0, 2).toUpperCase()
}

/**
 * Extract the folder name from a workspace path.
 */
function getFolderName(ws: Workspace): string {
  return ws.path.split('/').filter(Boolean).pop() || ws.name
}

export function WorkspaceRail() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [attentionByWorkspaceId, setAttentionByWorkspaceId] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    api.getWorkspaces().then(setWorkspaces).catch(console.error)
  }, [])

  useEffect(() => {
    let mounted = true

    const refreshAttention = async () => {
      try {
        const attention = await api.getWorkspaceAttention()
        if (!mounted) return

        const next = new Map<string, number>()
        for (const item of attention) {
          next.set(item.workspaceId, item.awaitingInputCount)
        }
        setAttentionByWorkspaceId(next)
      } catch (err) {
        if (mounted) {
          console.warn('Failed to load workspace attention summary:', err)
        }
      }
    }

    const intervalId = window.setInterval(() => {
      void refreshAttention()
    }, 5000)

    const handleFocus = () => {
      if (document.visibilityState === 'hidden') return
      void refreshAttention()
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleFocus)
    void refreshAttention()

    return () => {
      mounted = false
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleFocus)
    }
  }, [])

  return (
    <div className="flex flex-col items-center w-16 bg-slate-900 py-3 shrink-0 h-full">
      {/* Workspace icons — scrollable area */}
      <div className="flex-1 flex flex-col items-center gap-2 overflow-y-auto overflow-x-hidden min-h-0 w-full px-2 scrollbar-thin">
        {workspaces.map((ws) => {
          const isActive = ws.id === workspaceId
          const folderName = getFolderName(ws)
          const initials = getInitials(folderName)
          const hue = nameToHue(folderName)
          const awaitingInputCount = attentionByWorkspaceId.get(ws.id) || 0

          return (
            <div key={ws.id} className="relative group flex items-center justify-center w-full shrink-0">
              {/* Active indicator pill */}
              <div
                className={`absolute left-0 w-1 rounded-r-full bg-white transition-all duration-200 ${
                  isActive ? 'h-8' : 'h-0 group-hover:h-4'
                }`}
              />

              {/* Icon button */}
              <button
                onClick={() => navigate(`/workspace/${ws.id}`)}
                onMouseEnter={() => setHoveredId(ws.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`relative w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-semibold transition-all duration-200 cursor-pointer ${
                  isActive
                    ? 'ring-2 ring-white/30 scale-110'
                    : 'hover:scale-105 hover:brightness-110'
                } ${awaitingInputCount > 0 ? 'ring-2 ring-amber-300/80' : ''}`}
                style={{ backgroundColor: `hsl(${hue}, 55%, 45%)` }}
                title={folderName}
              >
                {initials}
                {awaitingInputCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-[9px] leading-4 font-bold text-white shadow">
                    {awaitingInputCount > 9 ? '9+' : awaitingInputCount}
                  </span>
                )}
              </button>

              {/* Tooltip */}
              {hoveredId === ws.id && (
                <div className="absolute left-[60px] z-50 px-3 py-2 bg-slate-800 text-white rounded-lg shadow-xl text-xs whitespace-nowrap pointer-events-none animate-fade-in">
                  <div className="font-semibold">{folderName}</div>
                  <div className="text-slate-400 text-[10px] mt-0.5">{ws.path}</div>
                  {awaitingInputCount > 0 && (
                    <div className="text-amber-300 text-[10px] mt-1">{awaitingInputCount} task{awaitingInputCount === 1 ? '' : 's'} awaiting input</div>
                  )}
                  {/* Arrow */}
                  <div className="absolute left-[-4px] top-1/2 -translate-y-1/2 w-2 h-2 bg-slate-800 rotate-45" />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Divider */}
      <div className="w-8 h-px bg-slate-700 my-2 shrink-0" />

      <div className="flex flex-col items-center gap-2 shrink-0">
        {/* Global settings button */}
        <button
          onClick={() => navigate('/settings')}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 transition-all duration-200 cursor-pointer"
          title="Open global settings"
          aria-label="Open global settings"
        >
          <AppIcon icon={Settings} size="md" />
        </button>

        {/* Add workspace button */}
        <button
          onClick={() => navigate('/')}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 transition-all duration-200 cursor-pointer"
          title="Open folder browser"
          aria-label="Open folder browser"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="10" y1="4" x2="10" y2="16" />
            <line x1="4" y1="10" x2="16" y2="10" />
          </svg>
        </button>
      </div>
    </div>
  )
}
