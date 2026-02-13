import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GripVertical, Settings2, X } from 'lucide-react'
import type { ExecutionWrapper } from '@pi-factory/shared'
import type { PostExecutionSkill } from '../types/pi'
import { AppIcon } from './AppIcon'
import { SkillConfigModal } from './SkillConfigModal'

type Lane = 'pre' | 'post'

interface ExecutionPipelineEditorProps {
  availableSkills: PostExecutionSkill[]
  availableWrappers: ExecutionWrapper[]
  selectedPreSkillIds: string[]
  selectedSkillIds: string[]
  selectedWrapperId: string
  onPreSkillsChange: (skillIds: string[]) => void
  onPostSkillsChange: (skillIds: string[]) => void
  onWrapperChange: (wrapperId: string) => void
  skillConfigs?: Record<string, Record<string, string>>
  onSkillConfigChange?: (skillConfigs: Record<string, Record<string, string>>) => void
  showSkillConfigControls?: boolean
}

interface DragPayload {
  skillId: string
  fromLane: Lane
  fromIndex: number
}

interface DropTarget {
  lane: Lane
  index: number
}

const DRAG_MIME = 'application/pi-factory-execution-pipeline-skill'

function dedupeSkillIds(skillIds: string[]): string[] {
  return Array.from(new Set(skillIds))
}

function parseSelection(selection: string): { type: 'skill' | 'wrapper'; id: string } | null {
  const separatorIndex = selection.indexOf(':')
  if (separatorIndex === -1) return null

  const type = selection.slice(0, separatorIndex)
  const id = selection.slice(separatorIndex + 1)

  if (!id) return null
  if (type !== 'skill' && type !== 'wrapper') return null

  return { type, id }
}

function parseDragPayload(raw: string): DragPayload | null {
  try {
    const parsed = JSON.parse(raw) as DragPayload
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.skillId !== 'string') return null
    if (parsed.fromLane !== 'pre' && parsed.fromLane !== 'post') return null
    if (typeof parsed.fromIndex !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

export function ExecutionPipelineEditor({
  availableSkills,
  availableWrappers,
  selectedPreSkillIds,
  selectedSkillIds,
  selectedWrapperId,
  onPreSkillsChange,
  onPostSkillsChange,
  onWrapperChange,
  skillConfigs = {},
  onSkillConfigChange,
  showSkillConfigControls = true,
}: ExecutionPipelineEditorProps) {
  const [selection, setSelection] = useState('')
  const [dragSource, setDragSource] = useState<DragPayload | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [configSkillId, setConfigSkillId] = useState<string | null>(null)
  const dragSourceRef = useRef<DragPayload | null>(null)
  const dragNodeRef = useRef<HTMLDivElement | null>(null)

  const skillById = useMemo(() => {
    const map = new Map<string, PostExecutionSkill>()
    for (const skill of availableSkills) {
      map.set(skill.id, skill)
    }
    return map
  }, [availableSkills])

  const wrapperById = useMemo(() => {
    const map = new Map<string, ExecutionWrapper>()
    for (const wrapper of availableWrappers) {
      map.set(wrapper.id, wrapper)
    }
    return map
  }, [availableWrappers])

  const selectedWrapper = selectedWrapperId
    ? wrapperById.get(selectedWrapperId) ?? null
    : null

  const selectedSkillSet = useMemo(() => {
    return new Set([...selectedPreSkillIds, ...selectedSkillIds])
  }, [selectedPreSkillIds, selectedSkillIds])

  const addableSkills = useMemo(() => {
    return availableSkills.filter((skill) => !selectedSkillSet.has(skill.id))
  }, [availableSkills, selectedSkillSet])

  const configSkill = configSkillId
    ? skillById.get(configSkillId) ?? null
    : null

  useEffect(() => {
    if (configSkillId && !selectedSkillIds.includes(configSkillId)) {
      setConfigSkillId(null)
    }
  }, [configSkillId, selectedSkillIds])

  const clearWrapperIfNeeded = useCallback(() => {
    if (selectedWrapperId) {
      onWrapperChange('')
    }
  }, [onWrapperChange, selectedWrapperId])

  const resetDragState = useCallback(() => {
    if (dragNodeRef.current) {
      dragNodeRef.current.style.removeProperty('opacity')
      dragNodeRef.current = null
    }
    dragSourceRef.current = null
    setDragSource(null)
    setDropTarget(null)
  }, [])

  const moveSkill = useCallback((payload: DragPayload, toLane: Lane, toIndex: number) => {
    const fromSkills = payload.fromLane === 'pre' ? selectedPreSkillIds : selectedSkillIds
    const targetSkills = toLane === 'pre' ? selectedPreSkillIds : selectedSkillIds

    const sourceIndex = fromSkills[payload.fromIndex] === payload.skillId
      ? payload.fromIndex
      : fromSkills.indexOf(payload.skillId)

    if (sourceIndex === -1) return

    if (payload.fromLane === toLane) {
      const reordered = [...fromSkills]
      const [movedSkillId] = reordered.splice(sourceIndex, 1)

      let insertAt = sourceIndex < toIndex ? toIndex - 1 : toIndex
      insertAt = Math.max(0, Math.min(insertAt, reordered.length))

      if (insertAt === sourceIndex) return
      reordered.splice(insertAt, 0, movedSkillId)
      clearWrapperIfNeeded()

      if (toLane === 'pre') {
        onPreSkillsChange(reordered)
      } else {
        onPostSkillsChange(reordered)
      }
      return
    }

    const sourceAfterRemoval = [...fromSkills]
    sourceAfterRemoval.splice(sourceIndex, 1)

    const targetAfterInsert = [...targetSkills]
    const insertAt = Math.max(0, Math.min(toIndex, targetAfterInsert.length))
    targetAfterInsert.splice(insertAt, 0, payload.skillId)
    clearWrapperIfNeeded()

    if (payload.fromLane === 'pre') {
      onPreSkillsChange(sourceAfterRemoval)
      onPostSkillsChange(targetAfterInsert)
    } else {
      onPostSkillsChange(sourceAfterRemoval)
      onPreSkillsChange(targetAfterInsert)
    }
  }, [clearWrapperIfNeeded, onPostSkillsChange, onPreSkillsChange, selectedPreSkillIds, selectedSkillIds])

  const readDragPayload = useCallback((e: React.DragEvent): DragPayload | null => {
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (raw) {
      const parsed = parseDragPayload(raw)
      if (parsed) return parsed
    }
    return dragSourceRef.current
  }, [])

  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, payload: DragPayload) => {
    dragSourceRef.current = payload
    dragNodeRef.current = e.currentTarget
    setDragSource(payload)

    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))

    requestAnimationFrame(() => {
      if (dragNodeRef.current) {
        dragNodeRef.current.style.opacity = '0.45'
      }
    })
  }, [])

  const handleSlotDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, lane: Lane, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget((prev) => {
      if (prev?.lane === lane && prev.index === index) return prev
      return { lane, index }
    })
  }, [])

  const handleSlotDrop = useCallback((e: React.DragEvent<HTMLDivElement>, lane: Lane, index: number) => {
    e.preventDefault()
    const payload = readDragPayload(e)
    if (payload) {
      moveSkill(payload, lane, index)
    }
    resetDragState()
  }, [moveSkill, readDragPayload, resetDragState])

  const getCardDropIndex = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const midpoint = rect.top + rect.height / 2
    return e.clientY < midpoint ? index : index + 1
  }, [])

  const handleCardDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, lane: Lane, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const dropIndex = getCardDropIndex(e, index)
    setDropTarget((prev) => {
      if (prev?.lane === lane && prev.index === dropIndex) return prev
      return { lane, index: dropIndex }
    })
  }, [getCardDropIndex])

  const handleCardDrop = useCallback((e: React.DragEvent<HTMLDivElement>, lane: Lane, index: number) => {
    e.preventDefault()
    const payload = readDragPayload(e)
    if (payload) {
      moveSkill(payload, lane, getCardDropIndex(e, index))
    }
    resetDragState()
  }, [getCardDropIndex, moveSkill, readDragPayload, resetDragState])

  const handleRemoveSkill = useCallback((lane: Lane, index: number) => {
    clearWrapperIfNeeded()
    if (lane === 'pre') {
      onPreSkillsChange(selectedPreSkillIds.filter((_, i) => i !== index))
    } else {
      onPostSkillsChange(selectedSkillIds.filter((_, i) => i !== index))
    }
  }, [clearWrapperIfNeeded, onPostSkillsChange, onPreSkillsChange, selectedPreSkillIds, selectedSkillIds])

  const handleAddSelection = useCallback(() => {
    const parsed = parseSelection(selection)
    if (!parsed) return

    if (parsed.type === 'skill') {
      if (!selectedSkillSet.has(parsed.id)) {
        clearWrapperIfNeeded()
        onPostSkillsChange([...selectedSkillIds, parsed.id])
      }
      setSelection('')
      return
    }

    const wrapper = wrapperById.get(parsed.id)
    if (!wrapper) return

    onWrapperChange(wrapper.id)
    onPreSkillsChange(dedupeSkillIds(wrapper.preExecutionSkills))
    onPostSkillsChange(dedupeSkillIds(wrapper.postExecutionSkills))
    setSelection('')
  }, [clearWrapperIfNeeded, onPostSkillsChange, onPreSkillsChange, onWrapperChange, selection, selectedSkillIds, selectedSkillSet, wrapperById])

  const handleConfigSave = useCallback((values: Record<string, string>) => {
    if (!configSkillId || !onSkillConfigChange) return

    const updated = { ...skillConfigs }
    if (Object.keys(values).length === 0) {
      delete updated[configSkillId]
    } else {
      updated[configSkillId] = values
    }

    onSkillConfigChange(updated)
    setConfigSkillId(null)
  }, [configSkillId, onSkillConfigChange, skillConfigs])

  const renderDropSlot = (lane: Lane, index: number) => {
    const isActive = dropTarget?.lane === lane && dropTarget.index === index
    return (
      <div
        key={`slot-${lane}-${index}`}
        onDragOver={(e) => handleSlotDragOver(e, lane, index)}
        onDrop={(e) => handleSlotDrop(e, lane, index)}
        className="h-2 flex items-center"
      >
        <div className={`w-full border-t-2 rounded-full transition-colors ${
          isActive ? 'border-blue-400' : 'border-transparent'
        }`} />
      </div>
    )
  }

  const renderSkillCard = (lane: Lane, skillId: string, index: number) => {
    const skill = skillById.get(skillId)
    const isPostLane = lane === 'post'
    const hasConfig = Boolean(
      showSkillConfigControls
      && isPostLane
      && onSkillConfigChange
      && skill
      && skill.configSchema.length > 0,
    )
    const isConfigured = Boolean(skillConfigs[skillId] && Object.keys(skillConfigs[skillId]).length > 0)
    const isDragging = dragSource?.fromLane === lane && dragSource.fromIndex === index

    return (
      <div
        key={`${lane}-${skillId}-${index}`}
        draggable
        onDragStart={(e) => handleDragStart(e, { skillId, fromLane: lane, fromIndex: index })}
        onDragEnd={resetDragState}
        onDragOver={(e) => handleCardDragOver(e, lane, index)}
        onDrop={(e) => handleCardDrop(e, lane, index)}
        className={`flex items-center gap-2 rounded-lg border p-2.5 cursor-grab active:cursor-grabbing transition-colors ${
          lane === 'pre'
            ? 'border-blue-200 bg-blue-50'
            : 'border-orange-200 bg-orange-50'
        } ${isDragging ? 'opacity-40' : ''}`}
      >
        <span
          className="w-4 text-center text-xs text-slate-400 select-none flex items-center justify-center"
          title="Drag to reorder"
        >
          <AppIcon icon={GripVertical} size="sm" />
        </span>

        <span className={`w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center ${
          lane === 'pre' ? 'bg-blue-500' : 'bg-orange-500'
        }`}>
          {index + 1}
        </span>

        <span className="text-[10px] font-mono text-slate-400 shrink-0">
          {skill ? (skill.type === 'loop' ? 'loop' : 'skill') : 'missing'}
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-slate-800 truncate">
            {skill?.name ?? skillId}
          </div>
          <div className="text-xs text-slate-500 truncate">
            {skill?.description ?? 'Skill is not available in this workspace'}
          </div>
        </div>

        {hasConfig && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setConfigSkillId(skillId)
            }}
            className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors inline-flex items-center gap-1 ${
              isConfigured
                ? 'border-blue-200 bg-blue-100 text-blue-700 hover:bg-blue-200'
                : 'border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
            title={`Configure ${skill?.name ?? skillId}`}
          >
            <AppIcon icon={Settings2} size="xs" />
            {isConfigured ? 'Configured' : 'Configure'}
          </button>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleRemoveSkill(lane, index)
          }}
          className={`w-5 h-5 rounded-full text-xs flex items-center justify-center transition-colors ${
            lane === 'pre'
              ? 'text-blue-400 hover:text-red-500 hover:bg-red-50'
              : 'text-orange-400 hover:text-red-500 hover:bg-red-50'
          }`}
          title="Remove skill"
          aria-label="Remove skill"
        >
          <AppIcon icon={X} size="xs" />
        </button>
      </div>
    )
  }

  const renderLane = (lane: Lane) => {
    const skillIds = lane === 'pre' ? selectedPreSkillIds : selectedSkillIds

    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {lane === 'pre' ? 'Pre-Execution' : 'Post-Execution'}
          </h4>
          <span className="text-[11px] text-slate-400">
            {skillIds.length} skill{skillIds.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="mt-2">
          {skillIds.length === 0 && (
            <div
              onDragOver={(e) => handleSlotDragOver(e, lane, 0)}
              onDrop={(e) => handleSlotDrop(e, lane, 0)}
              className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400"
            >
              Drop skills here
            </div>
          )}

          {skillIds.length > 0 && (
            <div className="space-y-1">
              {skillIds.map((skillId, index) => (
                <Fragment key={`${lane}-${skillId}-${index}`}>
                  {renderDropSlot(lane, index)}
                  {renderSkillCard(lane, skillId, index)}
                </Fragment>
              ))}
              {renderDropSlot(lane, skillIds.length)}
            </div>
          )}
        </div>
      </div>
    )
  }

  const canAdd = useMemo(() => {
    const parsed = parseSelection(selection)
    if (!parsed) return false

    if (parsed.type === 'skill') {
      return skillById.has(parsed.id) && !selectedSkillSet.has(parsed.id)
    }

    return wrapperById.has(parsed.id)
  }, [selection, selectedSkillSet, skillById, wrapperById])

  const executionCore = (
    <div className={selectedWrapper ? 'ml-3 border-l border-violet-200/80 pl-3 space-y-3' : 'space-y-3'}>
      {renderLane('pre')}

      <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white px-3 py-6 text-center text-sm font-medium text-slate-500">
        Task Execution
      </div>

      {renderLane('post')}
    </div>
  )

  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
          className="min-w-0 flex-1 basis-56 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select a skill or execution wrapper…</option>
          {addableSkills.length > 0 && (
            <optgroup label="Skills">
              {addableSkills.map((skill) => (
                <option key={skill.id} value={`skill:${skill.id}`}>
                  {skill.name}
                </option>
              ))}
            </optgroup>
          )}
          {availableWrappers.length > 0 && (
            <optgroup label="Execution Wrappers">
              {availableWrappers.map((wrapper) => (
                <option key={wrapper.id} value={`wrapper:${wrapper.id}`}>
                  {wrapper.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        <button
          type="button"
          onClick={handleAddSelection}
          disabled={!canAdd}
          className="shrink-0 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Add selected item"
        >
          + Add
        </button>
      </div>

      {(availableSkills.length === 0 && availableWrappers.length === 0) && (
        <p className="text-xs text-slate-400">
          No skills or wrappers are available in this workspace yet.
        </p>
      )}

      {selectedWrapper && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-violet-700">Wrapper Start · {selectedWrapper.name}</div>
              <div className="text-[11px] text-violet-600 truncate">{selectedWrapper.description}</div>
            </div>
            <button
              type="button"
              onClick={() => onWrapperChange('')}
              className="text-[11px] text-violet-500 hover:text-violet-700"
              title="Remove wrapper markers"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {executionCore}

      {selectedWrapper && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2">
          <div className="text-xs font-semibold text-violet-700">Wrapper End · {selectedWrapper.name}</div>
        </div>
      )}

      {configSkill && showSkillConfigControls && onSkillConfigChange && (
        <SkillConfigModal
          skill={configSkill}
          savedValues={skillConfigs[configSkill.id] ?? {}}
          onSave={handleConfigSave}
          onClose={() => setConfigSkillId(null)}
        />
      )}
    </div>
  )
}
