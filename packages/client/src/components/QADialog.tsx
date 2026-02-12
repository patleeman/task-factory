import { useState } from 'react'
import type { QARequest, QAAnswer } from '@pi-factory/shared'

interface QADialogProps {
  request: QARequest
  onSubmit: (answers: QAAnswer[]) => void
}

export function QADialog({ request, onSubmit }: QADialogProps) {
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const allAnswered = request.questions.every((q) => selections[q.id])

  const handleSelect = (questionId: string, option: string) => {
    setSelections((prev) => ({ ...prev, [questionId]: option }))
  }

  const handleSubmit = () => {
    if (!allAnswered || submitting) return
    setSubmitting(true)

    const answers: QAAnswer[] = request.questions.map((q) => ({
      questionId: q.id,
      selectedOption: selections[q.id],
    }))

    onSubmit(answers)
  }

  return (
    <div className="border border-amber-200 bg-amber-50/80 rounded-lg p-4 mx-4 mb-3 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-amber-600 shrink-0">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <text x="8" y="12" textAnchor="middle" fill="currentColor" fontSize="11" fontWeight="bold">?</text>
        </svg>
        <span className="text-sm font-semibold text-amber-800">
          Clarification needed
        </span>
        <span className="text-xs text-amber-600">
          — select an answer for each question
        </span>
      </div>

      <div className="space-y-4">
        {request.questions.map((q) => (
          <div key={q.id}>
            <p className="text-sm font-medium text-slate-800 mb-2">{q.text}</p>
            <div className="space-y-1.5">
              {q.options.map((option) => {
                const isSelected = selections[q.id] === option
                return (
                  <label
                    key={option}
                    className={`flex items-start gap-2.5 p-2 rounded-md cursor-pointer transition-all text-sm ${
                      isSelected
                        ? 'bg-amber-100 border border-amber-300 text-slate-900'
                        : 'bg-white border border-slate-200 text-slate-700 hover:border-amber-200 hover:bg-amber-50/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`qa-${request.requestId}-${q.id}`}
                      value={option}
                      checked={isSelected}
                      onChange={() => handleSelect(q.id, option)}
                      className="mt-0.5 accent-amber-600"
                    />
                    <span className="leading-snug">{option}</span>
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-amber-600">
          {Object.keys(selections).length}/{request.questions.length} answered
        </span>
        <button
          onClick={handleSubmit}
          disabled={!allAnswered || submitting}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
            allAnswered && !submitting
              ? 'bg-amber-600 text-white hover:bg-amber-700 shadow-sm'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}
        >
          {submitting ? (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Submitting…
            </span>
          ) : (
            'Submit answers'
          )}
        </button>
      </div>
    </div>
  )
}
