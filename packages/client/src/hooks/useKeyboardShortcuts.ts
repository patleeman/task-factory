import { useEffect } from 'react'

interface KeyboardShortcutHandlers {
  /** Escape — deselect task (return to planning mode) */
  onEscape?: () => void
  /** Cmd/Ctrl+N — create new task */
  onNewTask?: () => void
  /** Cmd/Ctrl+K — focus chat input */
  onFocusChat?: () => void
}

/**
 * Global keyboard shortcuts for the workspace.
 * Only fires when no input/textarea is focused (except Escape).
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      // Escape always works (even in inputs)
      if (e.key === 'Escape') {
        handlers.onEscape?.()
        // Blur any focused input
        if (isInput) (target as HTMLElement).blur()
        return
      }

      // Cmd/Ctrl shortcuts
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        handlers.onNewTask?.()
        return
      }

      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault()
        handlers.onFocusChat?.()
        return
      }
    }

    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [handlers])
}
