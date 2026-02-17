import { useState, useEffect, useRef } from 'react'
import { Loader2, SendHorizontal } from 'lucide-react'
import type { QARequest, QAAnswer } from '@task-factory/shared'
import { AppIcon } from './AppIcon'

interface QADialogProps {
  request: QARequest
  onSubmit: (answers: QAAnswer[]) => void
  onAbort: () => void
}

export function QADialog({ request, onSubmit, onAbort }: QADialogProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<QAAnswer[]>([])
  const [customInput, setCustomInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const question = request.questions[currentIndex]
  const total = request.questions.length
  const isLast = currentIndex === total - 1

  // Reset when request changes
  useEffect(() => {
    setCurrentIndex(0)
    setAnswers([])
    setCustomInput('')
    setSubmitting(false)
  }, [request.requestId])

  // Auto-focus input on each question
  useEffect(() => {
    inputRef.current?.focus()
  }, [currentIndex, request.requestId])

  function advanceOrSubmit(answer: QAAnswer) {
    const updated = [...answers, answer]
    setAnswers(updated)
    setCustomInput('')

    if (isLast) {
      setSubmitting(true)
      onSubmit(updated)
    } else {
      setCurrentIndex((i) => i + 1)
    }
  }

  function handleOptionClick(option: string) {
    if (submitting) return
    advanceOrSubmit({ questionId: question.id, selectedOption: option })
  }

  function handleInputSubmit() {
    const trimmed = customInput.trim()
    if (!trimmed || submitting) return

    // If user typed a number, pick the corresponding option
    const num = parseInt(trimmed, 10)
    if (num >= 1 && num <= question.options.length) {
      advanceOrSubmit({ questionId: question.id, selectedOption: question.options[num - 1] })
    } else {
      // Custom free-text answer
      advanceOrSubmit({ questionId: question.id, selectedOption: trimmed })
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleInputSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onAbort()
    }
  }

  if (!question) return null

  return (
    <div className="border-t border-amber-200 bg-amber-50/60 px-4 py-3 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
            Question {currentIndex + 1}{total > 1 ? ` of ${total}` : ''}
          </span>
          {total > 1 && (
            <div className="flex gap-0.5">
              {request.questions.map((_, i) => (
                <span
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full ${
                    i < currentIndex ? 'bg-amber-400' : i === currentIndex ? 'bg-amber-600' : 'bg-amber-200'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
        <button
          onClick={onAbort}
          className="text-[10px] text-slate-400 hover:text-slate-600 font-mono transition-colors"
          title="Skip questions and type your own message (Esc)"
        >
          skip
        </button>
      </div>

      {/* Question text */}
      <p className="text-sm font-medium text-slate-800 mb-2">{question.text}</p>

      {/* Numbered options — clickable */}
      <div className="space-y-1 mb-2.5">
        {question.options.map((option, i) => (
          <button
            key={option}
            onClick={() => handleOptionClick(option)}
            disabled={submitting}
            className="flex items-baseline gap-2 w-full text-left px-2.5 py-1.5 rounded-md text-sm
                       border border-slate-200 bg-white text-slate-700
                       hover:border-amber-300 hover:bg-amber-50 hover:text-slate-900
                       transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="text-xs font-mono text-amber-600 shrink-0 w-4 text-right">{i + 1}.</span>
            <span className="leading-snug">{option}</span>
          </button>
        ))}
      </div>

      {/* Input for typing a number or custom answer */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={submitting}
          placeholder="type a number or your own answer…"
          className="flex-1 text-sm border border-slate-200 rounded-md px-2.5 py-1.5 bg-white
                     placeholder-slate-400 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-200
                     disabled:opacity-50"
        />
        <button
          onClick={handleInputSubmit}
          disabled={!customInput.trim() || submitting}
          className="text-sm font-medium px-3 py-1.5 rounded-md bg-amber-600 text-white
                     hover:bg-amber-700 disabled:bg-slate-200 disabled:text-slate-400
                     disabled:cursor-not-allowed transition-colors shrink-0"
          aria-label={submitting ? 'Submitting answer' : 'Submit answer'}
          title={submitting ? 'Submitting answer' : 'Submit answer'}
        >
          {submitting ? (
            <AppIcon icon={Loader2} size="sm" className="animate-spin" />
          ) : (
            <AppIcon icon={SendHorizontal} size="sm" />
          )}
        </button>
      </div>
    </div>
  )
}
