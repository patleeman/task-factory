import { useRef, useEffect } from 'react'
import { EditorView, keymap, placeholder as cmPlaceholder, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'

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

// Minimal, clean theme that blends into the UI
const editorTheme = EditorView.theme({
  '&': {
    fontSize: '14px',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  '&.cm-focused': {
    outline: 'none',
    borderColor: '#3b82f6',
    boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.15)',
  },
  '.cm-content': {
    padding: '12px 16px',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    lineHeight: '1.7',
    caretColor: '#0f172a',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-gutters': {
    background: '#f8fafc',
    borderRight: '1px solid #e2e8f0',
    color: '#94a3b8',
    fontSize: '12px',
    minWidth: '40px',
  },
  '.cm-activeLineGutter': {
    background: '#f1f5f9',
    color: '#475569',
  },
  '.cm-activeLine': {
    background: '#f8fafc',
  },
  '.cm-selectionBackground, ::selection': {
    background: '#bfdbfe !important',
  },
  '.cm-cursor': {
    borderLeftColor: '#0f172a',
    borderLeftWidth: '2px',
  },
  '.cm-placeholder': {
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  // Markdown-specific highlighting
  '.cm-header-1': { fontSize: '1.5em', fontWeight: '700', color: '#0f172a' },
  '.cm-header-2': { fontSize: '1.25em', fontWeight: '600', color: '#1e293b' },
  '.cm-header-3': { fontSize: '1.1em', fontWeight: '600', color: '#334155' },
  '.cm-strong': { fontWeight: '700' },
  '.cm-em': { fontStyle: 'italic' },
  '.cm-link': { color: '#3b82f6', textDecoration: 'underline' },
  '.cm-url': { color: '#64748b' },
  '.cm-meta': { color: '#64748b' },
})

export function MarkdownEditor({
  value,
  onChange,
  placeholder = '',
  autoFocus = false,
  minHeight = '200px',
  readOnly = false,
  fill = false,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Stable dispatch listener — created once, references mutable ref
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      onChangeRef.current(update.state.doc.toString())
    }
  })

  useEffect(() => {
    if (!containerRef.current) return

    const extensions: import('@codemirror/state').Extension[] = [
      editorTheme,
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
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
  }, []) // Intentionally empty — we handle value updates below

  // Sync external value changes (but don't loop back our own edits)
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

  return <div ref={containerRef} className={fill ? 'editor-fill' : ''} />
}
