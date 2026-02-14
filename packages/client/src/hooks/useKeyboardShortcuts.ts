import { useEffect, useRef } from 'react'
import {
  DEFAULT_VOICE_INPUT_HOTKEY,
  eventMatchesVoiceInputHotkey,
  parseVoiceInputHotkey,
  shouldStopVoiceInputHotkeyOnKeyup,
} from '../voiceHotkey'

interface KeyboardShortcutHandlers {
  /** Escape — deselect task (return to planning mode) */
  onEscape?: () => void
  /** Cmd/Ctrl+K — focus chat input */
  onFocusChat?: () => void
  /** Configurable press-and-hold voice input hotkey. */
  voiceInputHotkey?: string
  /** Fires once when voice hotkey becomes active (keydown). */
  onVoiceHotkeyDown?: () => void
  /** Fires once when voice hotkey is released (keyup/blur). */
  onVoiceHotkeyUp?: () => void
}

/**
 * Global keyboard shortcuts for the workspace.
 * Uses refs to always read latest handlers without re-registering listeners.
 * Cmd shortcuts are skipped when an input/textarea is focused.
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
  const ref = useRef(handlers)
  const hotkeyRef = useRef(parseVoiceInputHotkey(handlers.voiceInputHotkey ?? DEFAULT_VOICE_INPUT_HOTKEY))
  const hotkeyActiveRef = useRef(false)

  ref.current = handlers
  hotkeyRef.current = parseVoiceInputHotkey(handlers.voiceInputHotkey ?? DEFAULT_VOICE_INPUT_HOTKEY)

  useEffect(() => {
    const releaseVoiceHotkey = () => {
      if (!hotkeyActiveRef.current) return
      hotkeyActiveRef.current = false
      ref.current.onVoiceHotkeyUp?.()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      // Escape always works (even in inputs)
      if (e.key === 'Escape') {
        ref.current.onEscape?.()
        if (isInput) (target as HTMLElement).blur()
        return
      }

      // Preserve existing Cmd/Ctrl+K behavior when not actively typing.
      const mod = e.metaKey || e.ctrlKey
      if (!isInput && mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        ref.current.onFocusChat?.()
        return
      }

      const voiceHotkey = hotkeyRef.current
      if (voiceHotkey && eventMatchesVoiceInputHotkey(e, voiceHotkey)) {
        e.preventDefault()

        if (!hotkeyActiveRef.current) {
          hotkeyActiveRef.current = true
          ref.current.onVoiceHotkeyDown?.()
        }

        return
      }

      // Skip remaining Cmd shortcuts when typing in an input.
      if (isInput) return
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!hotkeyActiveRef.current) return

      const voiceHotkey = hotkeyRef.current
      if (!voiceHotkey) {
        releaseVoiceHotkey()
        return
      }

      if (shouldStopVoiceInputHotkeyOnKeyup(e, voiceHotkey)) {
        e.preventDefault()
        releaseVoiceHotkey()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', releaseVoiceHotkey)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', releaseVoiceHotkey)
    }
  }, [])
}
