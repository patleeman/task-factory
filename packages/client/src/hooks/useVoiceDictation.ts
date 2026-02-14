import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

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
  setInput: Dispatch<SetStateAction<string>>
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

export function useVoiceDictation({ setInput }: UseVoiceDictationOptions): VoiceDictationState {
  const [isSupported, setIsSupported] = useState(() => Boolean(getSpeechRecognitionCtor()))
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const sessionIdRef = useRef(0)
  const insertedTextRef = useRef('')

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
    insertedTextRef.current = ''
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

    const recognition = new RecognitionCtor()
    const sessionId = sessionIdRef.current + 1
    sessionIdRef.current = sessionId
    recognitionRef.current = recognition
    insertedTextRef.current = ''

    recognition.lang = 'en-US'
    recognition.interimResults = true
    recognition.continuous = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      if (sessionIdRef.current !== sessionId) return

      const transcript = extractTranscript(event.results)

      setInput((current) => {
        const previousInserted = insertedTextRef.current
        const base = previousInserted && current.endsWith(previousInserted)
          ? current.slice(0, current.length - previousInserted.length)
          : current

        const nextInserted = buildInsertedText(base, transcript)
        insertedTextRef.current = nextInserted
        return `${base}${nextInserted}`
      })
    }

    recognition.onerror = (event) => {
      if (sessionIdRef.current !== sessionId) return
      setError(mapErrorMessage(event.error))
      setIsListening(false)
      insertedTextRef.current = ''
      recognitionRef.current = null
      teardownRecognition(recognition)
    }

    recognition.onend = () => {
      if (sessionIdRef.current !== sessionId) return
      setIsListening(false)
      insertedTextRef.current = ''
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
      insertedTextRef.current = ''
      setIsListening(false)
      setError('Unable to start voice dictation. Check microphone permissions and try again.')
    }
  }, [setInput, stop, teardownRecognition])

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
