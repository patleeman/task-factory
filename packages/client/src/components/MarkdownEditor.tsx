import { useRef, useEffect, useMemo, type MouseEvent } from 'react'
import { EditorView, keymap, placeholder as cmPlaceholder, highlightActiveLine } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'
import { useTheme } from '../hooks/useTheme'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  minHeight?: string
  readOnly?: boolean
  /** When true, editor stretches to fill its parent via flex. Wrap parent in .editor-fill */
  fill?: boolean
}

const sharedEditorTheme = {
  '&': {
    fontSize: '14px',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  '&.cm-focused': {
    outline: 'none',
    borderColor: '#3b82f6',
    boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.2)',
  },
  '.cm-content': {
    padding: '12px 16px',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    lineHeight: '1.7',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-cursor': {
    borderLeftWidth: '2px',
  },
  '.cm-placeholder': {
    fontStyle: 'italic',
  },
  '.cm-header-1': { fontSize: '1.5em', fontWeight: '700' },
  '.cm-header-2': { fontSize: '1.25em', fontWeight: '600' },
  '.cm-header-3': { fontSize: '1.1em', fontWeight: '600' },
  '.cm-strong': { fontWeight: '700' },
  '.cm-em': { fontStyle: 'italic' },
  '.cm-link': { textDecoration: 'underline' },
}

const lightEditorTheme = EditorView.theme({
  ...sharedEditorTheme,
  '&': {
    ...(sharedEditorTheme['&'] || {}),
    border: '1px solid #e2e8f0',
  },
  '.cm-content': {
    ...(sharedEditorTheme['.cm-content'] || {}),
    color: '#0f172a',
    caretColor: '#0f172a',
  },
  '.cm-activeLine': {
    background: '#f8fafc',
  },
  '.cm-selectionBackground, ::selection': {
    background: '#bfdbfe !important',
  },
  '.cm-cursor': {
    ...(sharedEditorTheme['.cm-cursor'] || {}),
    borderLeftColor: '#0f172a',
  },
  '.cm-placeholder': {
    ...(sharedEditorTheme['.cm-placeholder'] || {}),
    color: '#94a3b8',
  },
  '.cm-header-1': { ...(sharedEditorTheme['.cm-header-1'] || {}), color: '#0f172a' },
  '.cm-header-2': { ...(sharedEditorTheme['.cm-header-2'] || {}), color: '#1e293b' },
  '.cm-header-3': { ...(sharedEditorTheme['.cm-header-3'] || {}), color: '#334155' },
  '.cm-link': { ...(sharedEditorTheme['.cm-link'] || {}), color: '#3b82f6' },
  '.cm-url': { color: '#64748b' },
  '.cm-meta': { color: '#64748b' },
})

const darkEditorTheme = EditorView.theme({
  ...sharedEditorTheme,
  '&': {
    ...(sharedEditorTheme['&'] || {}),
    border: '1px solid #334155',
    backgroundColor: '#0b1220',
  },
  '.cm-content': {
    ...(sharedEditorTheme['.cm-content'] || {}),
    color: '#e2e8f0',
    caretColor: '#f8fafc',
  },
  '.cm-activeLine': {
    background: '#111b2e',
  },
  '.cm-selectionBackground, ::selection': {
    background: '#1e3a8a !important',
  },
  '.cm-cursor': {
    ...(sharedEditorTheme['.cm-cursor'] || {}),
    borderLeftColor: '#f8fafc',
  },
  '.cm-placeholder': {
    ...(sharedEditorTheme['.cm-placeholder'] || {}),
    color: '#64748b',
  },
  '.cm-header-1': { ...(sharedEditorTheme['.cm-header-1'] || {}), color: '#f8fafc' },
  '.cm-header-2': { ...(sharedEditorTheme['.cm-header-2'] || {}), color: '#f1f5f9' },
  '.cm-header-3': { ...(sharedEditorTheme['.cm-header-3'] || {}), color: '#e2e8f0' },
  '.cm-link': { ...(sharedEditorTheme['.cm-link'] || {}), color: '#93c5fd' },
  '.cm-url': { color: '#94a3b8' },
  '.cm-meta': { color: '#94a3b8' },
}, { dark: true })

export function MarkdownEditor({
  value,
  onChange,
  placeholder = '',
  autoFocus = false,
  minHeight = '200px',
  readOnly = false,
  fill = false,
}: MarkdownEditorProps) {
  const { theme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const updateListener = useMemo(
    () => EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString())
      }
    }),
    [],
  )

  useEffect(() => {
    if (!containerRef.current) return

    const editorTheme = theme === 'dark' ? darkEditorTheme : lightEditorTheme

    const extensions: import('@codemirror/state').Extension[] = [
      editorTheme,
      highlightActiveLine(),
      bracketMatching(),
      history(),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(defaultHighlightStyle),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      updateListener,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        style: `min-height: ${minHeight}`,
      }),
    ]

    if (placeholder) {
      extensions.push(cmPlaceholder(placeholder))
    }

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true))
    }

    const state = EditorState.create({ doc: value, extensions })
    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    if (autoFocus) {
      requestAnimationFrame(() => view.focus())
    }

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [autoFocus, minHeight, placeholder, readOnly, theme, updateListener])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const currentValue = view.state.doc.toString()
    if (currentValue !== value) {
      view.dispatch({
        changes: { from: 0, to: currentValue.length, insert: value },
      })
    }
  }, [value])

  const handleContainerMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (readOnly || event.button !== 0) return

    const view = viewRef.current
    if (!view) return

    const container = containerRef.current
    const target = event.target
    if (!(target instanceof HTMLElement)) return

    if (target === container || !target.closest('.cm-editor')) {
      view.focus()
      return
    }

    if (!target.closest('.cm-content')) {
      view.focus()
    }
  }

  return <div ref={containerRef} className={fill ? 'editor-fill h-full' : ''} onMouseDown={handleContainerMouseDown} />
}
