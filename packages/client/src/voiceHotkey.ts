export const DEFAULT_VOICE_INPUT_HOTKEY = 'Alt+Space'

export interface VoiceInputHotkeyConfig {
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  key: string | null
  display: string
}

interface KeyboardEventLike {
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

type ModifierField = 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'

const MODIFIER_LABELS: Record<ModifierField, string> = {
  ctrlKey: 'Ctrl',
  altKey: 'Alt',
  shiftKey: 'Shift',
  metaKey: 'Meta',
}

const MODIFIER_ORDER: ModifierField[] = ['ctrlKey', 'altKey', 'shiftKey', 'metaKey']

function toLowerToken(value: string): string {
  return value.trim().toLowerCase()
}

function modifierFromToken(token: string): ModifierField | null {
  const normalized = toLowerToken(token)

  switch (normalized) {
    case 'ctrl':
    case 'control':
      return 'ctrlKey'
    case 'alt':
    case 'option':
      return 'altKey'
    case 'shift':
      return 'shiftKey'
    case 'meta':
    case 'cmd':
    case 'command':
    case 'os':
    case 'win':
    case 'super':
      return 'metaKey'
    default:
      return null
  }
}

function normalizeNonModifierKey(value: string): string | null {
  if (value === ' ') {
    return 'space'
  }

  const normalized = toLowerToken(value)
  if (!normalized) return null

  if (modifierFromToken(normalized)) {
    return null
  }

  switch (normalized) {
    case 'space':
    case 'spacebar':
      return 'space'
    case 'esc':
      return 'escape'
    default:
      return normalized
  }
}

function formatNonModifierKey(key: string): string {
  switch (key) {
    case 'space':
      return 'Space'
    case 'escape':
      return 'Escape'
    case 'arrowup':
      return 'ArrowUp'
    case 'arrowdown':
      return 'ArrowDown'
    case 'arrowleft':
      return 'ArrowLeft'
    case 'arrowright':
      return 'ArrowRight'
    case 'backspace':
      return 'Backspace'
    case 'enter':
      return 'Enter'
    case 'tab':
      return 'Tab'
    case 'delete':
      return 'Delete'
    default:
      if (key.length === 1) {
        return key.toUpperCase()
      }

      if (/^f\d{1,2}$/.test(key)) {
        return key.toUpperCase()
      }

      return key.charAt(0).toUpperCase() + key.slice(1)
  }
}

function normalizeKeyFromEvent(event: KeyboardEventLike): string | null {
  return normalizeNonModifierKey(event.key)
}

export function formatVoiceInputHotkey(config: Omit<VoiceInputHotkeyConfig, 'display'>): string {
  const parts: string[] = []

  for (const modifier of MODIFIER_ORDER) {
    if (config[modifier]) {
      parts.push(MODIFIER_LABELS[modifier])
    }
  }

  if (config.key) {
    parts.push(formatNonModifierKey(config.key))
  }

  return parts.join('+')
}

export function parseVoiceInputHotkey(value: unknown): VoiceInputHotkeyConfig | null {
  if (typeof value !== 'string') return null

  const tokens = value
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean)

  if (tokens.length === 0) return null

  const config: Omit<VoiceInputHotkeyConfig, 'display'> = {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    key: null,
  }

  for (const token of tokens) {
    const modifier = modifierFromToken(token)
    if (modifier) {
      config[modifier] = true
      continue
    }

    const parsedKey = normalizeNonModifierKey(token)
    if (!parsedKey || config.key) {
      return null
    }

    config.key = parsedKey
  }

  if (!config.ctrlKey && !config.altKey && !config.shiftKey && !config.metaKey && !config.key) {
    return null
  }

  return {
    ...config,
    display: formatVoiceInputHotkey(config),
  }
}

export function normalizeVoiceInputHotkey(
  value: unknown,
  fallback = DEFAULT_VOICE_INPUT_HOTKEY,
): string {
  const parsed = parseVoiceInputHotkey(value)
  if (parsed) {
    return parsed.display
  }

  const parsedFallback = parseVoiceInputHotkey(fallback)
  return parsedFallback ? parsedFallback.display : DEFAULT_VOICE_INPUT_HOTKEY
}

export function formatVoiceInputHotkeyFromEvent(event: KeyboardEventLike): string | null {
  const key = normalizeKeyFromEvent(event)

  const config: Omit<VoiceInputHotkeyConfig, 'display'> = {
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    key,
  }

  if (!config.ctrlKey && !config.altKey && !config.shiftKey && !config.metaKey && !config.key) {
    return null
  }

  return formatVoiceInputHotkey(config)
}

export function eventMatchesVoiceInputHotkey(
  event: KeyboardEventLike,
  hotkey: VoiceInputHotkeyConfig,
): boolean {
  if (
    event.ctrlKey !== hotkey.ctrlKey
    || event.altKey !== hotkey.altKey
    || event.shiftKey !== hotkey.shiftKey
    || event.metaKey !== hotkey.metaKey
  ) {
    return false
  }

  const eventKey = normalizeKeyFromEvent(event)

  if (!hotkey.key) {
    return !eventKey
  }

  return eventKey === hotkey.key
}

export function shouldStopVoiceInputHotkeyOnKeyup(
  event: KeyboardEventLike,
  hotkey: VoiceInputHotkeyConfig,
): boolean {
  const eventModifier = modifierFromToken(event.key)
  if (eventModifier && hotkey[eventModifier]) {
    return true
  }

  if (!hotkey.key) {
    return false
  }

  const eventKey = normalizeKeyFromEvent(event)
  return eventKey === hotkey.key
}
