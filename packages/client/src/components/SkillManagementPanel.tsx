import { useEffect, useMemo, useState } from 'react'
import type { PostExecutionSkill, SkillConfigField } from '../types/pi'

interface SkillManagementPanelProps {
  skills: PostExecutionSkill[]
  onSkillsChange: (skills: PostExecutionSkill[]) => void
}

type SkillType = PostExecutionSkill['type']

interface ConfigFieldDraft {
  key: string
  label: string
  type: SkillConfigField['type']
  default: string
  description: string
  min: string
  max: string
  pattern: string
  options: string
}

interface SkillFormState {
  id: string
  description: string
  type: SkillType
  workflowId: string
  pairedSkillId: string
  maxIterations: string
  doneSignal: string
  promptTemplate: string
  configFields: ConfigFieldDraft[]
}

const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

function createBlankConfigField(): ConfigFieldDraft {
  return {
    key: '',
    label: '',
    type: 'string',
    default: '',
    description: '',
    min: '',
    max: '',
    pattern: '',
    options: '',
  }
}

function createBlankSkillForm(): SkillFormState {
  return {
    id: '',
    description: '',
    type: 'follow-up',
    workflowId: '',
    pairedSkillId: '',
    maxIterations: '1',
    doneSignal: 'HOOK_DONE',
    promptTemplate: '',
    configFields: [],
  }
}

function toSkillForm(skill: PostExecutionSkill): SkillFormState {
  return {
    id: skill.id,
    description: skill.description,
    type: skill.type,
    workflowId: skill.workflowId || '',
    pairedSkillId: skill.pairedSkillId || '',
    maxIterations: String(skill.maxIterations || 1),
    doneSignal: skill.doneSignal || 'HOOK_DONE',
    promptTemplate: skill.promptTemplate,
    configFields: skill.configSchema.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      default: field.default,
      description: field.description,
      min: field.validation?.min !== undefined ? String(field.validation.min) : '',
      max: field.validation?.max !== undefined ? String(field.validation.max) : '',
      pattern: field.validation?.pattern || '',
      options: field.validation?.options?.join(', ') || '',
    })),
  }
}

function buildConfigSchema(drafts: ConfigFieldDraft[]): { ok: true; value: SkillConfigField[] } | { ok: false; error: string } {
  const schema: SkillConfigField[] = []
  const seenKeys = new Set<string>()

  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index]
    const key = draft.key.trim()
    const label = draft.label.trim()
    const description = draft.description.trim()
    const defaultValue = draft.default

    const isCompletelyEmpty = !key && !label && !description && !defaultValue && !draft.pattern.trim() && !draft.options.trim() && !draft.min.trim() && !draft.max.trim()
    if (isCompletelyEmpty) {
      continue
    }

    if (!key) {
      return { ok: false, error: `Parameter #${index + 1} is missing a key` }
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
      return { ok: false, error: `Parameter "${key}" can only contain letters, numbers, underscores, and hyphens` }
    }

    if (!label) {
      return { ok: false, error: `Parameter "${key}" is missing a label` }
    }

    if (seenKeys.has(key)) {
      return { ok: false, error: `Parameter key "${key}" is duplicated` }
    }
    seenKeys.add(key)

    const field: SkillConfigField = {
      key,
      label,
      type: draft.type,
      default: defaultValue,
      description,
    }

    const validation: SkillConfigField['validation'] = {}

    if (draft.min.trim()) {
      const parsedMin = Number(draft.min)
      if (!Number.isFinite(parsedMin)) {
        return { ok: false, error: `Parameter "${key}" has an invalid min value` }
      }
      validation.min = parsedMin
    }

    if (draft.max.trim()) {
      const parsedMax = Number(draft.max)
      if (!Number.isFinite(parsedMax)) {
        return { ok: false, error: `Parameter "${key}" has an invalid max value` }
      }
      validation.max = parsedMax
    }

    if (draft.pattern.trim()) {
      validation.pattern = draft.pattern.trim()
    }

    if (draft.type === 'select') {
      const options = draft.options
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)

      if (options.length === 0) {
        return { ok: false, error: `Parameter "${key}" requires at least one option` }
      }

      validation.options = Array.from(new Set(options))

      if (defaultValue && !validation.options.includes(defaultValue)) {
        return { ok: false, error: `Parameter "${key}" default must match one of its options` }
      }
    }

    if (draft.type === 'number' && defaultValue.trim()) {
      const parsedDefault = Number(defaultValue)
      if (!Number.isFinite(parsedDefault)) {
        return { ok: false, error: `Parameter "${key}" default must be numeric` }
      }
    }

    if (Object.keys(validation).length > 0) {
      field.validation = validation
    }

    schema.push(field)
  }

  return { ok: true, value: schema }
}

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null)
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
    return payload.error
  }
  return fallback
}

export function SkillManagementPanel({ skills, onSkillsChange }: SkillManagementPanelProps) {
  const sortedSkills = useMemo(
    () => [...skills].sort((a, b) => a.id.localeCompare(b.id)),
    [skills],
  )

  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(sortedSkills[0]?.id ?? null)
  const [isCreating, setIsCreating] = useState(sortedSkills.length === 0)
  const [form, setForm] = useState<SkillFormState>(() => {
    const initial = sortedSkills[0]
    return initial ? toSkillForm(initial) : createBlankSkillForm()
  })

  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (isCreating) return

    if (!selectedSkillId) {
      const firstSkill = sortedSkills[0]
      if (firstSkill) {
        setSelectedSkillId(firstSkill.id)
        setForm(toSkillForm(firstSkill))
      }
      return
    }

    const selected = sortedSkills.find((skill) => skill.id === selectedSkillId)
    if (selected) {
      setForm(toSkillForm(selected))
      return
    }

    if (sortedSkills.length > 0) {
      setSelectedSkillId(sortedSkills[0].id)
      setForm(toSkillForm(sortedSkills[0]))
    } else {
      setSelectedSkillId(null)
      setForm(createBlankSkillForm())
      setIsCreating(true)
    }
  }, [isCreating, selectedSkillId, sortedSkills])

  const refreshSkills = async (nextSelectedId?: string) => {
    const response = await fetch('/api/factory/skills')
    if (!response.ok) {
      throw new Error(await parseErrorMessage(response, 'Failed to refresh skills'))
    }

    const latestSkills = await response.json() as PostExecutionSkill[]
    onSkillsChange(latestSkills)

    if (latestSkills.length === 0) {
      setSelectedSkillId(null)
      setForm(createBlankSkillForm())
      setIsCreating(true)
      return
    }

    const preferredSkill = nextSelectedId
      ? latestSkills.find((skill) => skill.id === nextSelectedId)
      : latestSkills[0]

    const selected = preferredSkill || latestSkills[0]
    setSelectedSkillId(selected.id)
    setForm(toSkillForm(selected))
    setIsCreating(false)
  }

  const handleStartCreate = () => {
    setIsCreating(true)
    setSelectedSkillId(null)
    setForm(createBlankSkillForm())
    setSaveError(null)
    setSaveMessage(null)
  }

  const handleSelectSkill = (skill: PostExecutionSkill) => {
    setIsCreating(false)
    setSelectedSkillId(skill.id)
    setForm(toSkillForm(skill))
    setSaveError(null)
    setSaveMessage(null)
  }

  const updateConfigField = (index: number, updates: Partial<ConfigFieldDraft>) => {
    setForm((prev) => {
      const nextFields = [...prev.configFields]
      const current = nextFields[index]
      if (!current) {
        return prev
      }
      nextFields[index] = { ...current, ...updates }
      return {
        ...prev,
        configFields: nextFields,
      }
    })
  }

  const handleSave = async () => {
    setSaveError(null)
    setSaveMessage(null)

    const skillId = form.id.trim()
    if (!SKILL_ID_PATTERN.test(skillId)) {
      setSaveError('Skill id must use lowercase letters, numbers, or hyphens (max 64 chars)')
      return
    }

    if (!form.description.trim()) {
      setSaveError('Description is required')
      return
    }

    if (!form.promptTemplate.trim()) {
      setSaveError('Prompt template is required')
      return
    }

    const hooks: Array<'pre-planning' | 'pre' | 'post'> = ['pre-planning', 'pre', 'post']

    const parsedMaxIterations = Number.parseInt(form.maxIterations, 10)
    if (!Number.isInteger(parsedMaxIterations) || parsedMaxIterations <= 0) {
      setSaveError('Max iterations must be a positive integer')
      return
    }

    const configSchemaResult = buildConfigSchema(form.configFields)
    if (!configSchemaResult.ok) {
      setSaveError(configSchemaResult.error)
      return
    }

    const payload = {
      id: skillId,
      description: form.description.trim(),
      type: form.type,
      hooks,
      workflowId: form.workflowId.trim() || undefined,
      pairedSkillId: form.pairedSkillId.trim() || undefined,
      maxIterations: parsedMaxIterations,
      doneSignal: form.doneSignal.trim() || 'HOOK_DONE',
      promptTemplate: form.promptTemplate.trim(),
      configSchema: configSchemaResult.value,
    }

    setIsSaving(true)

    try {
      const response = await fetch(
        isCreating
          ? '/api/factory/skills'
          : `/api/factory/skills/${encodeURIComponent(skillId)}`,
        {
          method: isCreating ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )

      if (!response.ok) {
        throw new Error(await parseErrorMessage(response, 'Failed to save skill'))
      }

      const savedSkill = await response.json() as PostExecutionSkill
      await refreshSkills(savedSkill.id)
      setSaveMessage(isCreating ? `Created ${savedSkill.id}` : `Saved ${savedSkill.id}`)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save skill')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedSkillId || isCreating) return

    if (!confirm(`Delete skill "${selectedSkillId}"?`)) {
      return
    }

    setSaveError(null)
    setSaveMessage(null)
    setIsSaving(true)

    try {
      const response = await fetch(`/api/factory/skills/${encodeURIComponent(selectedSkillId)}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(await parseErrorMessage(response, 'Failed to delete skill'))
      }

      await refreshSkills()
      setSaveMessage(`Deleted ${selectedSkillId}`)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to delete skill')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Skill Library</h3>
        <p className="text-xs text-slate-500 mt-1">
          Create and manage reusable execution skills. Parameters defined here can be configured per task.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        <aside className="rounded-xl border border-slate-200 bg-white p-3 space-y-2 h-fit">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Skills</h4>
            <button
              type="button"
              onClick={handleStartCreate}
              className="text-xs text-blue-600 hover:text-blue-700"
            >
              + New
            </button>
          </div>

          {sortedSkills.length === 0 && (
            <p className="text-xs text-slate-400">No skills yet.</p>
          )}

          <div className="space-y-1">
            {sortedSkills.map((skill) => {
              const isSelected = !isCreating && selectedSkillId === skill.id
              return (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => handleSelectSkill(skill)}
                  className={`w-full text-left rounded-md border px-2.5 py-2 transition-colors ${
                    isSelected
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="text-xs font-semibold">{skill.id}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{skill.description}</div>
                </button>
              )
            })}
          </div>
        </aside>

        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-800">
                {isCreating ? 'Create Skill' : `Edit Skill · ${form.id}`}
              </h4>
              {!isCreating && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isSaving}
                  className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
                >
                  Delete
                </button>
              )}
            </div>

            {saveError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {saveError}
              </div>
            )}

            {saveMessage && !saveError && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
                {saveMessage}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-xs text-slate-600">
                Skill ID
                <input
                  value={form.id}
                  disabled={!isCreating}
                  onChange={(event) => setForm({ ...form, id: event.target.value.trim().toLowerCase() })}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-100"
                  placeholder="my-skill"
                />
              </label>

              <label className="text-xs text-slate-600">
                Type
                <select
                  value={form.type}
                  onChange={(event) => setForm({ ...form, type: event.target.value as SkillType })}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="follow-up">follow-up</option>
                  <option value="loop">loop</option>
                </select>
              </label>
            </div>

            <label className="block text-xs text-slate-600">
              Description
              <input
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="What this skill does"
              />
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-xs text-slate-600">
                Availability
                <div className="mt-1 rounded-lg border border-slate-200 px-3 py-2 bg-slate-50 text-xs text-slate-600">
                  Skills are available in pre-planning, pre-execution, and post-execution by default.
                </div>
              </label>

              <label className="text-xs text-slate-600">
                Workflow ID (optional)
                <input
                  value={form.workflowId}
                  onChange={(event) => setForm({ ...form, workflowId: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="e.g. tdd"
                />
              </label>
            </div>

            <label className="block text-xs text-slate-600">
              Paired Skill ID (optional)
              <input
                value={form.pairedSkillId}
                onChange={(event) => setForm({ ...form, pairedSkillId: event.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="e.g. tdd-verify-tests"
              />
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-xs text-slate-600">
                Max Iterations
                <input
                  type="number"
                  min={1}
                  value={form.maxIterations}
                  onChange={(event) => setForm({ ...form, maxIterations: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>

              <label className="text-xs text-slate-600">
                Done Signal
                <input
                  value={form.doneSignal}
                  onChange={(event) => setForm({ ...form, doneSignal: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <label className="block text-xs text-slate-600">
              Prompt Template
              <textarea
                value={form.promptTemplate}
                onChange={(event) => setForm({ ...form, promptTemplate: event.target.value })}
                className="mt-1 w-full min-h-[180px] rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                placeholder="Use {{parameter_key}} placeholders for configurable values"
              />
            </label>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Parameters</h5>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, configFields: [...form.configFields, createBlankConfigField()] })}
                  className="text-xs text-blue-600 hover:text-blue-700"
                >
                  + Add Parameter
                </button>
              </div>

              {form.configFields.length === 0 && (
                <p className="text-xs text-slate-400">No parameters. Add one to make this skill configurable per task.</p>
              )}

              <div className="space-y-3">
                {form.configFields.map((field, index) => (
                  <div key={`${field.key}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <input
                        value={field.key}
                        onChange={(event) => updateConfigField(index, { key: event.target.value })}
                        className="rounded border border-slate-200 px-2 py-1.5 text-xs"
                        placeholder="key"
                      />
                      <input
                        value={field.label}
                        onChange={(event) => updateConfigField(index, { label: event.target.value })}
                        className="rounded border border-slate-200 px-2 py-1.5 text-xs"
                        placeholder="label"
                      />
                      <select
                        value={field.type}
                        onChange={(event) => updateConfigField(index, { type: event.target.value as SkillConfigField['type'] })}
                        className="rounded border border-slate-200 px-2 py-1.5 text-xs"
                      >
                        <option value="string">string</option>
                        <option value="number">number</option>
                        <option value="boolean">boolean</option>
                        <option value="select">select</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input
                        value={field.default}
                        onChange={(event) => updateConfigField(index, { default: event.target.value })}
                        className="rounded border border-slate-200 px-2 py-1.5 text-xs"
                        placeholder="default value"
                      />
                      <input
                        value={field.description}
                        onChange={(event) => updateConfigField(index, { description: event.target.value })}
                        className="rounded border border-slate-200 px-2 py-1.5 text-xs"
                        placeholder="description"
                      />
                    </div>

                    {field.type === 'number' && (
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={field.min}
                          onChange={(event) => updateConfigField(index, { min: event.target.value })}
                          className="rounded border border-slate-200 px-2 py-1.5 text-xs"
                          placeholder="min"
                        />
                        <input
                          value={field.max}
                          onChange={(event) => updateConfigField(index, { max: event.target.value })}
                          className="rounded border border-slate-200 px-2 py-1.5 text-xs"
                          placeholder="max"
                        />
                      </div>
                    )}

                    {field.type === 'string' && (
                      <input
                        value={field.pattern}
                        onChange={(event) => updateConfigField(index, { pattern: event.target.value })}
                        className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs"
                        placeholder="regex pattern (optional)"
                      />
                    )}

                    {field.type === 'select' && (
                      <input
                        value={field.options}
                        onChange={(event) => updateConfigField(index, { options: event.target.value })}
                        className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs"
                        placeholder="options, comma-separated"
                      />
                    )}

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setForm((prev) => ({
                            ...prev,
                            configFields: prev.configFields.filter((_, fieldIndex) => fieldIndex !== index),
                          }))
                        }}
                        className="text-[11px] text-red-600 hover:text-red-700"
                      >
                        Remove parameter
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              {isCreating && (
                <button
                  type="button"
                  onClick={() => {
                    const fallback = sortedSkills[0]
                    if (fallback) {
                      setIsCreating(false)
                      setSelectedSkillId(fallback.id)
                      setForm(toSkillForm(fallback))
                    } else {
                      setForm(createBlankSkillForm())
                    }
                  }}
                  className="btn btn-secondary text-sm py-1.5 px-3"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="btn btn-primary text-sm py-1.5 px-3 disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : isCreating ? 'Create Skill' : 'Save Skill'}
              </button>
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
