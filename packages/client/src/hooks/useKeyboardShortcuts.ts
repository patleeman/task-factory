import { useEffect, useRef } from 'react'

interface KeyboardShortcutHandlers {
  /** Escape — deselect task (return to planning mode) */
  onEscape?: () => void
  /** Cmd/Ctrl+K — focus chat input */
  onFocusChat?: () => void
}

/**
 * Global keyboard shortcuts for the workspace.
 * Uses a ref to always read latest handlers without re-registering the listener.
 * Cmd shortcuts are skipped when an input/textarea is focused.
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      // Escape always works (even in inputs)
      if (e.key === 'Escape') {
        ref.current.onEscape?.()
        if (isInput) (target as HTMLElement).blur()
        return
      }

      // Skip Cmd shortcuts when typing in an input
      if (isInput) return

      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault()
        ref.current.onFocusChat?.()
        return
      }
    }

    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [])
}
