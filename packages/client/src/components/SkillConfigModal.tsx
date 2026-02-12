import { useState, useEffect, useCallback } from 'react'
import type { PostExecutionSkill, SkillConfigField } from '../types/pi'

interface SkillConfigModalProps {
  skill: PostExecutionSkill
  savedValues: Record<string, string>
  onSave: (values: Record<string, string>) => void
  onClose: () => void
}

interface FieldError {
  key: string
  message: string
}

function validateField(field: SkillConfigField, value: string): string | null {
  if (field.type === 'number') {
    const num = Number(value)
    if (value.trim() === '' || isNaN(num)) {
      return `${field.label} must be a valid number`
    }
    if (!Number.isInteger(num)) {
      return `${field.label} must be a whole number`
    }
    if (field.validation?.min !== undefined && num < field.validation.min) {
      return `${field.label} must be at least ${field.validation.min}`
    }
    if (field.validation?.max !== undefined && num > field.validation.max) {
      return `${field.label} must be at most ${field.validation.max}`
    }
  }

  if (field.type === 'string' && field.validation?.pattern) {
    try {
      const regex = new RegExp(field.validation.pattern)
      if (!regex.test(value)) {
        return `${field.label} does not match the required pattern`
      }
    } catch {
      // Invalid regex in schema — skip validation
    }
  }

  if (field.type === 'select' && field.validation?.options) {
    if (!field.validation.options.includes(value)) {
      return `${field.label} must be one of: ${field.validation.options.join(', ')}`
    }
  }

  return null
}

export function SkillConfigModal({ skill, savedValues, onSave, onClose }: SkillConfigModalProps) {
  // Initialize form values from saved values or defaults
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const field of skill.configSchema) {
      initial[field.key] = savedValues[field.key] ?? field.default
    }
    return initial
  })
  const [errors, setErrors] = useState<FieldError[]>([])

  const handleChange = useCallback((key: string, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }))
    // Clear error for this field when user edits
    setErrors(prev => prev.filter(e => e.key !== key))
  }, [])

  const handleSave = useCallback(() => {
    // Validate all fields
    const newErrors: FieldError[] = []
    for (const field of skill.configSchema) {
      const error = validateField(field, values[field.key] ?? '')
      if (error) {
        newErrors.push({ key: field.key, message: error })
      }
    }

    if (newErrors.length > 0) {
      setErrors(newErrors)
      return
    }

    // Only include values that differ from defaults
    const overrides: Record<string, string> = {}
    for (const field of skill.configSchema) {
      const val = values[field.key]
      if (val !== undefined && val !== field.default) {
        overrides[field.key] = val
      }
    }

    onSave(overrides)
  }, [skill.configSchema, values, onSave])

  const handleReset = useCallback(() => {
    const defaults: Record<string, string> = {}
    for (const field of skill.configSchema) {
      defaults[field.key] = field.default
    }
    setValues(defaults)
    setErrors([])
  }, [skill.configSchema])

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const getError = (key: string) => errors.find(e => e.key === key)?.message

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Configure {skill.name}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{skill.description}</p>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200 flex items-center justify-center text-sm transition-colors"
          >
            ×
          </button>
        </div>

        {/* Fields */}
        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {skill.configSchema.map((field) => {
            const error = getError(field.key)
            return (
              <div key={field.key}>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  {field.label}
                </label>
                {field.description && (
                  <p className="text-xs text-slate-400 mb-1.5">{field.description}</p>
                )}

                {field.type === 'boolean' ? (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={values[field.key] === 'true'}
                      onChange={(e) => handleChange(field.key, e.target.checked ? 'true' : 'false')}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-slate-700">Enabled</span>
                  </label>
                ) : field.type === 'select' && field.validation?.options ? (
                  <select
                    value={values[field.key] ?? ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    className={`w-full rounded-lg border px-3 py-2 text-sm ${
                      error ? 'border-red-300 bg-red-50' : 'border-slate-200'
                    } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  >
                    {field.validation.options.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={values[field.key] ?? ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    min={field.validation?.min}
                    max={field.validation?.max}
                    step={field.type === 'number' ? 1 : undefined}
                    className={`w-full rounded-lg border px-3 py-2 text-sm ${
                      error ? 'border-red-300 bg-red-50' : 'border-slate-200'
                    } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    placeholder={field.default ? `Default: ${field.default}` : ''}
                  />
                )}

                {error && (
                  <p className="text-xs text-red-500 mt-1">{error}</p>
                )}

                {field.validation && field.type === 'number' && !error && (
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {field.validation.min !== undefined && field.validation.max !== undefined
                      ? `Range: ${field.validation.min}–${field.validation.max}`
                      : field.validation.min !== undefined
                        ? `Min: ${field.validation.min}`
                        : field.validation.max !== undefined
                          ? `Max: ${field.validation.max}`
                          : ''}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button
            onClick={handleReset}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            Reset to defaults
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
