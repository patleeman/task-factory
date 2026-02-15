import { EditorView } from '@codemirror/view'
import { useCallback, useEffect, useRef, useState } from 'react'

type SpeechRecognitionErrorCode =
  | 'aborted'
  | 'audio-capture'
  | 'bad-grammar'
  | 'language-not-supported'
  | 'network'
  | 'no-speech'
  | 'not-allowed'
  | 'phrases-not-supported'
  | 'service-not-allowed'

interface SpeechRecognitionAlternativeLike {
  transcript: string
}

interface SpeechRecognitionResultLike {
  isFinal: boolean
  length: number
  [index: number]: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>
}

interface SpeechRecognitionErrorEventLike {
  error?: SpeechRecognitionErrorCode | string
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionCtor
  webkitSpeechRecognition?: SpeechRecognitionCtor
}

interface UseVoiceDictationOptions {
  /** When no editable element is focused, use this as a fallback dictation target. */
  fallbackSelector?: string
}

interface VoiceDictationState {
  isSupported: boolean
  isListening: boolean
  error: string | null
  start: () => void
  stop: () => void
  toggle: () => void
  clearError: () => void
}

interface NativeDictationTarget {
  kind: 'native'
  element: HTMLInputElement | HTMLTextAreaElement
  prefixAtStart: string
  replaceFrom: number
  replaceTo: number
}

interface CodeMirrorDictationTarget {
  kind: 'codemirror'
  view: EditorView
  prefixAtStart: string
  replaceFrom: number
  replaceTo: number
}

type DictationTarget = NativeDictationTarget | CodeMirrorDictationTarget

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'date',
  'datetime-local',
  'file',
  'hidden',
  'image',
  'month',
  'radio',
  'range',
  'reset',
  'submit',
  'time',
  'week',
])

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const speechWindow = window as SpeechRecognitionWindow
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null
}

function extractTranscript(results: ArrayLike<SpeechRecognitionResultLike>): string {
  let finalText = ''
  let interimText = ''

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i]
    if (!result || result.length === 0) continue
    const transcript = result[0]?.transcript || ''
    if (!transcript) continue

    if (result.isFinal) {
      finalText += transcript
    } else {
      interimText += transcript
    }
  }

  return `${finalText}${interimText}`.trimStart()
}

function buildInsertedText(base: string, transcript: string): string {
  if (!transcript) return ''
  if (!base) return transcript

  const needsSpace = !/\s$/.test(base) && !/^[,.;:!?)]/.test(transcript)
  return needsSpace ? ` ${transcript}` : transcript
}

function mapErrorMessage(errorCode?: string): string {
  switch (errorCode) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission was denied. Allow microphone access and try again.'
    case 'audio-capture':
      return 'No microphone was found. Connect a microphone and try again.'
    case 'no-speech':
      return 'No speech was detected. Try again and speak a little louder.'
    case 'network':
      return 'Speech recognition failed due to a network issue. Please try again.'
    case 'language-not-supported':
      return 'Your browser does not support recognition for this language.'
    default:
      return 'Voice dictation failed. Please try again.'
  }
}

function getRecognitionLanguage(): string {
  if (typeof navigator === 'undefined') return 'en-US'
  if (typeof navigator.language === 'string' && navigator.language.trim().length > 0) {
    return navigator.language
  }
  return 'en-US'
}

function getSelectionBounds(element: HTMLInputElement | HTMLTextAreaElement): { from: number; to: number } {
  const valueLength = element.value.length
  const rawFrom = typeof element.selectionStart === 'number' ? element.selectionStart : valueLength
  const rawTo = typeof element.selectionEnd === 'number' ? element.selectionEnd : rawFrom

  const from = Math.max(0, Math.min(rawFrom, valueLength))
  const to = Math.max(from, Math.min(rawTo, valueLength))

  return { from, to }
}

function isEditableInputElement(element: HTMLInputElement): boolean {
  if (element.disabled || element.readOnly) return false

  const type = element.type.toLowerCase()
  if (NON_TEXT_INPUT_TYPES.has(type)) return false

  return typeof element.selectionStart === 'number' && typeof element.selectionEnd === 'number'
}

function isEditableTextArea(element: HTMLTextAreaElement): boolean {
  if (element.disabled || element.readOnly) return false
  return true
}

function createNativeTarget(element: HTMLInputElement | HTMLTextAreaElement): NativeDictationTarget | null {
  if (element instanceof HTMLInputElement && !isEditableInputElement(element)) {
    return null
  }

  if (element instanceof HTMLTextAreaElement && !isEditableTextArea(element)) {
    return null
  }

  const { from, to } = getSelectionBounds(element)

  return {
    kind: 'native',
    element,
    prefixAtStart: element.value.slice(0, from),
    replaceFrom: from,
    replaceTo: to,
  }
}

function createCodeMirrorTarget(element: HTMLElement): CodeMirrorDictationTarget | null {
  const editorRoot = element.closest('.cm-editor')
  if (!(editorRoot instanceof HTMLElement)) {
    return null
  }

  const view = EditorView.findFromDOM(editorRoot)
  if (!view) {
    return null
  }

  const selection = view.state.selection.main

  return {
    kind: 'codemirror',
    view,
    prefixAtStart: view.state.doc.sliceString(0, selection.from),
    replaceFrom: selection.from,
    replaceTo: selection.to,
  }
}

function createDictationTarget(element: HTMLElement): DictationTarget | null {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return createNativeTarget(element)
  }

  return createCodeMirrorTarget(element)
}

function focusFallbackElement(element: HTMLElement) {
  element.focus()

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const end = element.value.length
    try {
      element.setSelectionRange(end, end)
    } catch {
      // Ignore range errors for unsupported input types.
    }
  }
}

function resolveDictationTarget(fallbackSelector: string): DictationTarget | null {
  if (typeof document === 'undefined') return null

  const activeElement = document.activeElement
  const focusedElement = activeElement instanceof HTMLElement ? activeElement : null
  const focusedTarget = focusedElement ? createDictationTarget(focusedElement) : null
  if (focusedTarget) {
    return focusedTarget
  }

  const fallbackElement = document.querySelector(fallbackSelector)
  if (!(fallbackElement instanceof HTMLElement)) {
    return null
  }

  focusFallbackElement(fallbackElement)
  return createDictationTarget(fallbackElement)
}

function applyTranscriptToNativeTarget(target: NativeDictationTarget, transcript: string) {
  const { element } = target
  const nextInserted = buildInsertedText(target.prefixAtStart, transcript)
  const value = element.value
  const from = Math.max(0, Math.min(target.replaceFrom, value.length))
  const to = Math.max(from, Math.min(target.replaceTo, value.length))

  const nextValue = `${value.slice(0, from)}${nextInserted}${value.slice(to)}`
  const nextCaret = from + nextInserted.length
  target.replaceTo = nextCaret

  const valueChanged = element.value !== nextValue
  if (valueChanged) {
    element.value = nextValue
  }

  try {
    element.setSelectionRange(nextCaret, nextCaret)
  } catch {
    // Ignore selection updates for inputs that do not support text ranges.
  }

  if (valueChanged) {
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

function applyTranscriptToCodeMirrorTarget(target: CodeMirrorDictationTarget, transcript: string) {
  const nextInserted = buildInsertedText(target.prefixAtStart, transcript)
  const from = target.replaceFrom
  const to = target.replaceTo

  target.view.dispatch({
    changes: { from, to, insert: nextInserted },
    selection: { anchor: from + nextInserted.length },
    scrollIntoView: true,
  })

  target.replaceTo = from + nextInserted.length
}

function applyTranscriptToTarget(target: DictationTarget, transcript: string) {
  if (target.kind === 'native') {
    applyTranscriptToNativeTarget(target, transcript)
    return
  }

  applyTranscriptToCodeMirrorTarget(target, transcript)
}

export function useVoiceDictation({ fallbackSelector = '[data-chat-input]' }: UseVoiceDictationOptions = {}): VoiceDictationState {
  const [isSupported, setIsSupported] = useState(() => Boolean(getSpeechRecognitionCtor()))
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const sessionIdRef = useRef(0)
  const targetRef = useRef<DictationTarget | null>(null)

  const teardownRecognition = useCallback((recognition: SpeechRecognitionLike | null) => {
    if (!recognition) return
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
  }, [])

  const stop = useCallback(() => {
    sessionIdRef.current += 1
    const recognition = recognitionRef.current
    recognitionRef.current = null
    targetRef.current = null
    setIsListening(false)
    teardownRecognition(recognition)

    if (!recognition) return

    try {
      recognition.stop()
    } catch {
      // Ignore stop errors from stale recognition instances.
    }
  }, [teardownRecognition])

  const start = useCallback(() => {
    const RecognitionCtor = getSpeechRecognitionCtor()
    if (!RecognitionCtor) {
      setIsSupported(false)
      return
    }

    stop()

    const dictationTarget = resolveDictationTarget(fallbackSelector)
    if (!dictationTarget) {
      setError('Focus a text field before using voice dictation.')
      return
    }

    const recognition = new RecognitionCtor()
    const sessionId = sessionIdRef.current
    recognitionRef.current = recognition
    targetRef.current = dictationTarget

    recognition.lang = getRecognitionLanguage()
    recognition.interimResults = true
    recognition.continuous = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      if (sessionIdRef.current !== sessionId) return

      const transcript = extractTranscript(event.results)
      const target = targetRef.current
      if (!target) {
        return
      }

      try {
        applyTranscriptToTarget(target, transcript)
      } catch {
        setError('Unable to insert dictation text into this field.')
        stop()
      }
    }

    recognition.onerror = (event) => {
      if (sessionIdRef.current !== sessionId) return
      setError(mapErrorMessage(event.error))
      setIsListening(false)
      targetRef.current = null
      recognitionRef.current = null
      teardownRecognition(recognition)
    }

    recognition.onend = () => {
      if (sessionIdRef.current !== sessionId) return
      setIsListening(false)
      targetRef.current = null
      recognitionRef.current = null
      teardownRecognition(recognition)
    }

    try {
      setError(null)
      recognition.start()
      setIsListening(true)
    } catch {
      teardownRecognition(recognition)
      recognitionRef.current = null
      targetRef.current = null
      setIsListening(false)
      setError('Unable to start voice dictation. Check microphone permissions and try again.')
    }
  }, [fallbackSelector, stop, teardownRecognition])

  const toggle = useCallback(() => {
    if (isListening) {
      stop()
      return
    }

    start()
  }, [isListening, start, stop])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  useEffect(() => {
    setIsSupported(Boolean(getSpeechRecognitionCtor()))
  }, [])

  useEffect(() => {
    return () => {
      stop()
    }
  }, [stop])

  return {
    isSupported,
    isListening,
    error,
    start,
    stop,
    toggle,
    clearError,
  }
}
