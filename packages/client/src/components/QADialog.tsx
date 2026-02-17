import { useState, useEffect, useMemo, useRef } from 'react'
import { Loader2, SendHorizontal } from 'lucide-react'
import type { QARequest, QAAnswer } from '@task-factory/shared'
import { AppIcon } from './AppIcon'

interface QADialogProps {
  request: QARequest
  onSubmit: (answers: QAAnswer[]) => Promise<boolean>
  onAbort: () => void
}

export function QADialog({ request, onSubmit, onAbort }: QADialogProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answersByQuestionId, setAnswersByQuestionId] = useState<Record<string, string>>({})
  const [customInput, setCustomInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const question = request.questions[currentIndex]
  const total = request.questions.length

  const uniqueQuestionIds = useMemo(() => {
    const seen = new Set<string>()
    const ids: string[] = []
    for (const item of request.questions) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      ids.push(item.id)
    }
    return ids
  }, [request.questions])

  const answeredCount = useMemo(
    () => uniqueQuestionIds.reduce((count, questionId) => {
      const answer = answersByQuestionId[questionId]
      return answer && answer.trim() ? count + 1 : count
    }, 0),
    [uniqueQuestionIds, answersByQuestionId],
  )

  const allAnswered = uniqueQuestionIds.length > 0 && answeredCount === uniqueQuestionIds.length
  const selectedAnswer = question ? answersByQuestionId[question.id] ?? '' : ''

  // Reset when request changes
  useEffect(() => {
    setCurrentIndex(0)
    setAnswersByQuestionId({})
    setCustomInput('')
    setSubmitting(false)
  }, [request.requestId])

  // Show existing answer when revisiting a question
  useEffect(() => {
    if (!question) return
    setCustomInput(answersByQuestionId[question.id] ?? '')
  }, [question?.id, answersByQuestionId])

  // Auto-focus input on each question
  useEffect(() => {
    inputRef.current?.focus()
  }, [currentIndex, request.requestId])

  function saveAnswer(selectedOption: string) {
    if (submitting || !question) return

    const trimmed = selectedOption.trim()
    if (!trimmed) return

    setAnswersByQuestionId((prev) => ({
      ...prev,
      [question.id]: trimmed,
    }))
    setCustomInput(trimmed)

    if (currentIndex < total - 1) {
      setCurrentIndex((index) => Math.min(total - 1, index + 1))
    }
  }

  function handleOptionClick(option: string) {
    saveAnswer(option)
  }

  function handleInputSubmit() {
    const trimmed = customInput.trim()
    if (!trimmed || submitting || !question) return

    // If user typed a number, pick the corresponding option
    const num = parseInt(trimmed, 10)
    if (num >= 1 && num <= question.options.length) {
      saveAnswer(question.options[num - 1])
      return
    }

    // Custom free-text answer
    saveAnswer(trimmed)
  }

  function handleBack() {
    if (submitting || currentIndex === 0) return
    setCurrentIndex((index) => Math.max(0, index - 1))
  }

  function handleForward() {
    if (submitting || currentIndex >= total - 1) return
    setCurrentIndex((index) => Math.min(total - 1, index + 1))
  }

  async function handleFinalSubmit() {
    if (submitting || !allAnswered) return

    const submissionAnswers = uniqueQuestionIds.map((questionId) => ({
      questionId,
      selectedOption: (answersByQuestionId[questionId] || '').trim(),
    }))

    if (submissionAnswers.some((answer) => !answer.selectedOption)) {
      return
    }

    setSubmitting(true)

    try {
      const submitted = await onSubmit(submissionAnswers)
      if (!submitted) {
        setSubmitting(false)
      }
    } catch {
      setSubmitting(false)
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
              {request.questions.map((item, i) => {
                const answered = Boolean(answersByQuestionId[item.id]?.trim())
                return (
                  <span
                    key={item.id + i}
                    className={`w-1.5 h-1.5 rounded-full ${
                      i === currentIndex
                        ? 'bg-amber-600'
                        : answered
                          ? 'bg-amber-400'
                          : 'bg-amber-200'
                    }`}
                  />
                )
              })}
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
        {question.options.map((option, i) => {
          const isSelected = selectedAnswer === option
          return (
            <button
              key={`${i}:${option}`}
              onClick={() => handleOptionClick(option)}
              disabled={submitting}
              className={`flex items-baseline gap-2 w-full text-left px-2.5 py-1.5 rounded-md text-sm
                         border bg-white text-slate-700
                         hover:border-amber-300 hover:bg-amber-50 hover:text-slate-900
                         transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                           isSelected ? 'border-amber-400 bg-amber-100 text-slate-900' : 'border-slate-200'
                         }`}
            >
              <span className="text-xs font-mono text-amber-600 shrink-0 w-4 text-right">{i + 1}.</span>
              <span className="leading-snug">{option}</span>
            </button>
          )
        })}
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
          aria-label={submitting ? 'Saving answer' : 'Save answer'}
          title={submitting ? 'Saving answer' : 'Save answer'}
        >
          {submitting ? (
            <AppIcon icon={Loader2} size="sm" className="animate-spin" />
          ) : (
            <AppIcon icon={SendHorizontal} size="sm" />
          )}
        </button>
      </div>

      {/* Navigation + final submit */}
      <div className="flex items-center gap-2 mt-2.5">
        <button
          onClick={handleBack}
          disabled={submitting || currentIndex === 0}
          className="text-[11px] font-mono uppercase px-2.5 py-1 rounded border border-slate-300 text-slate-600
                     hover:border-slate-400 hover:text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          back
        </button>
        <button
          onClick={handleForward}
          disabled={submitting || currentIndex >= total - 1}
          className="text-[11px] font-mono uppercase px-2.5 py-1 rounded border border-slate-300 text-slate-600
                     hover:border-slate-400 hover:text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          next
        </button>

        <span className="ml-auto text-[11px] text-slate-500 font-mono">
          {answeredCount}/{uniqueQuestionIds.length} answered
        </span>

        <button
          onClick={handleFinalSubmit}
          disabled={!allAnswered || submitting}
          className="text-[11px] font-mono uppercase px-2.5 py-1 rounded bg-emerald-600 text-white
                     hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400
                     disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'submitting…' : 'submit all'}
        </button>
      </div>
    </div>
  )
}
