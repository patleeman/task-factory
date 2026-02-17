import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GripVertical, Settings2, X } from 'lucide-react'
import type { PostExecutionSkill } from '../types/pi'
import { AppIcon } from './AppIcon'
import {
  buildLaneItems,
  buildLaneTokens,
  clampIndex,
  findDisplayIndexForSkill,
  parseLaneTokens,
  type SkillDragPosition,
} from './execution-pipeline-lane-model'
import { SkillConfigModal } from './SkillConfigModal'

type Lane = 'pre' | 'post'

interface ExecutionPipelineEditorProps {
  availableSkills: PostExecutionSkill[]
  selectedPreSkillIds: string[]
  selectedSkillIds: string[]
  onPreSkillsChange: (skillIds: string[]) => void
  onPostSkillsChange: (skillIds: string[]) => void
  skillConfigs?: Record<string, Record<string, string>>
  onSkillConfigChange?: (skillConfigs: Record<string, Record<string, string>>) => void
  showSkillConfigControls?: boolean
}

interface DragPayload extends SkillDragPosition {
  fromLane: Lane
}

interface DropTarget {
  lane: Lane
  displayIndex: number
}

const DRAG_MIME = 'application/task-factory-execution-pipeline-skill'

function supportsHook(skill: PostExecutionSkill, lane: Lane): boolean {
  if (!Array.isArray(skill.hooks) || skill.hooks.length === 0) {
    return true
  }
  return skill.hooks.includes(lane)
}

function parseSelection(selection: string): { lane: Lane; skillId: string } | null {
  const separatorIndex = selection.indexOf(':')
  if (separatorIndex === -1) return null

  const lane = selection.slice(0, separatorIndex)
  const skillId = selection.slice(separatorIndex + 1)

  if (!skillId) return null
  if (lane !== 'pre' && lane !== 'post') return null

  return { lane, skillId }
}

function parseDragPayload(raw: string): DragPayload | null {
  try {
    const parsed = JSON.parse(raw) as DragPayload
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.skillId !== 'string') return null
    if (parsed.fromLane !== 'pre' && parsed.fromLane !== 'post') return null
    if (typeof parsed.fromSkillIndex !== 'number') return null
    if (typeof parsed.fromDisplayIndex !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

export function ExecutionPipelineEditor({
  availableSkills,
  selectedPreSkillIds,
  selectedSkillIds,
  onPreSkillsChange,
  onPostSkillsChange,
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

  const selectedPreSkillSet = useMemo(() => {
    return new Set(selectedPreSkillIds)
  }, [selectedPreSkillIds])

  const selectedPostSkillSet = useMemo(() => {
    return new Set(selectedSkillIds)
  }, [selectedSkillIds])

  const addablePreSkills = useMemo(() => {
    return availableSkills.filter((skill) => !selectedPreSkillSet.has(skill.id) && supportsHook(skill, 'pre'))
  }, [availableSkills, selectedPreSkillSet])

  const addablePostSkills = useMemo(() => {
    return availableSkills.filter((skill) => !selectedPostSkillSet.has(skill.id) && supportsHook(skill, 'post'))
  }, [availableSkills, selectedPostSkillSet])

  const configSkill = configSkillId
    ? skillById.get(configSkillId) ?? null
    : null

  useEffect(() => {
    if (!configSkillId) return

    const isStillSelected = selectedPreSkillIds.includes(configSkillId) || selectedSkillIds.includes(configSkillId)
    if (!isStillSelected) {
      setConfigSkillId(null)
    }
  }, [configSkillId, selectedPreSkillIds, selectedSkillIds])

  const resetDragState = useCallback(() => {
    if (dragNodeRef.current) {
      dragNodeRef.current.style.removeProperty('opacity')
      dragNodeRef.current = null
    }
    dragSourceRef.current = null
    setDragSource(null)
    setDropTarget(null)
  }, [])

  const getLaneTokens = useCallback((lane: Lane) => {
    if (lane === 'pre') {
      return buildLaneTokens(selectedPreSkillIds)
    }
    return buildLaneTokens(selectedSkillIds)
  }, [selectedPreSkillIds, selectedSkillIds])

  const applyLaneTokens = useCallback((lane: Lane, tokens: string[]) => {
    const parsed = parseLaneTokens(tokens)

    if (lane === 'pre') {
      onPreSkillsChange(parsed.skillIds)
    } else {
      onPostSkillsChange(parsed.skillIds)
    }
  }, [onPostSkillsChange, onPreSkillsChange])

  const moveSkill = useCallback((payload: DragPayload, toLane: Lane, toDisplayIndex: number) => {
    const skill = skillById.get(payload.skillId)
    if (skill && !supportsHook(skill, toLane)) {
      return
    }

    if (payload.fromLane === toLane) {
      const laneTokens = getLaneTokens(toLane)
      const sourceDisplayIndex = findDisplayIndexForSkill(laneTokens, payload)
      if (sourceDisplayIndex === -1) return

      const reordered = [...laneTokens]
      reordered.splice(sourceDisplayIndex, 1)

      let insertAt = toDisplayIndex
      if (sourceDisplayIndex < toDisplayIndex) {
        insertAt -= 1
      }

      insertAt = clampIndex(insertAt, reordered.length)
      reordered.splice(insertAt, 0, payload.skillId)
      applyLaneTokens(toLane, reordered)
      return
    }

    const sourceTokens = getLaneTokens(payload.fromLane)
    const sourceDisplayIndex = findDisplayIndexForSkill(sourceTokens, payload)
    if (sourceDisplayIndex === -1) return

    const sourceAfterRemoval = [...sourceTokens]
    sourceAfterRemoval.splice(sourceDisplayIndex, 1)

    const targetTokens = getLaneTokens(toLane)
    const targetAfterInsert = [...targetTokens]
    const insertAt = clampIndex(toDisplayIndex, targetAfterInsert.length)
    targetAfterInsert.splice(insertAt, 0, payload.skillId)

    applyLaneTokens(payload.fromLane, sourceAfterRemoval)
    applyLaneTokens(toLane, targetAfterInsert)
  }, [applyLaneTokens, getLaneTokens, skillById])

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

  const handleSlotDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, lane: Lane, displayIndex: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget((previous) => {
      if (previous?.lane === lane && previous.displayIndex === displayIndex) return previous
      return { lane, displayIndex }
    })
  }, [])

  const handleSlotDrop = useCallback((e: React.DragEvent<HTMLDivElement>, lane: Lane, displayIndex: number) => {
    e.preventDefault()
    const payload = readDragPayload(e)
    if (payload) {
      moveSkill(payload, lane, displayIndex)
    }
    resetDragState()
  }, [moveSkill, readDragPayload, resetDragState])

  const getCardDropIndex = useCallback((e: React.DragEvent<HTMLDivElement>, displayIndex: number) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const midpoint = rect.top + rect.height / 2
    return e.clientY < midpoint ? displayIndex : displayIndex + 1
  }, [])

  const handleCardDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, lane: Lane, displayIndex: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const dropDisplayIndex = getCardDropIndex(e, displayIndex)
    setDropTarget((previous) => {
      if (previous?.lane === lane && previous.displayIndex === dropDisplayIndex) return previous
      return { lane, displayIndex: dropDisplayIndex }
    })
  }, [getCardDropIndex])

  const handleCardDrop = useCallback((e: React.DragEvent<HTMLDivElement>, lane: Lane, displayIndex: number) => {
    e.preventDefault()
    const payload = readDragPayload(e)
    if (payload) {
      moveSkill(payload, lane, getCardDropIndex(e, displayIndex))
    }
    resetDragState()
  }, [getCardDropIndex, moveSkill, readDragPayload, resetDragState])

  const handleRemoveSkill = useCallback((lane: Lane, payload: DragPayload) => {
    const laneTokens = getLaneTokens(lane)
    const sourceDisplayIndex = findDisplayIndexForSkill(laneTokens, payload)
    if (sourceDisplayIndex === -1) return

    const nextTokens = [...laneTokens]
    nextTokens.splice(sourceDisplayIndex, 1)
    applyLaneTokens(lane, nextTokens)
  }, [applyLaneTokens, getLaneTokens])

  const handleAddSelection = useCallback(() => {
    const parsed = parseSelection(selection)
    if (!parsed) return

    const alreadySelected = parsed.lane === 'pre'
      ? selectedPreSkillSet.has(parsed.skillId)
      : selectedPostSkillSet.has(parsed.skillId)

    if (alreadySelected) {
      setSelection('')
      return
    }

    const skill = skillById.get(parsed.skillId)
    if (!skill || !supportsHook(skill, parsed.lane)) {
      return
    }

    if (parsed.lane === 'pre') {
      onPreSkillsChange([...selectedPreSkillIds, parsed.skillId])
    } else {
      onPostSkillsChange([...selectedSkillIds, parsed.skillId])
    }

    setSelection('')
  }, [
    onPostSkillsChange,
    onPreSkillsChange,
    selectedPreSkillIds,
    selectedPreSkillSet,
    selectedSkillIds,
    selectedPostSkillSet,
    selection,
    skillById,
  ])

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

  const renderDropSlot = (lane: Lane, displayIndex: number) => {
    const isActive = dropTarget?.lane === lane && dropTarget.displayIndex === displayIndex
    return (
      <div
        key={`slot-${lane}-${displayIndex}`}
        onDragOver={(e) => handleSlotDragOver(e, lane, displayIndex)}
        onDrop={(e) => handleSlotDrop(e, lane, displayIndex)}
        className="h-2 flex items-center"
      >
        <div className={`w-full border-t-2 rounded-full transition-colors ${
          isActive ? 'border-blue-400' : 'border-transparent'
        }`} />
      </div>
    )
  }

  const renderSkillCard = (lane: Lane, skillId: string, skillIndex: number, displayIndex: number) => {
    const skill = skillById.get(skillId)
    const hasConfig = Boolean(
      showSkillConfigControls
      && onSkillConfigChange
      && skill
      && skill.configSchema.length > 0,
    )
    const isConfigured = Boolean(skillConfigs[skillId] && Object.keys(skillConfigs[skillId]).length > 0)
    const isDragging = dragSource?.fromLane === lane && dragSource.fromDisplayIndex === displayIndex

    const dragPayload: DragPayload = {
      skillId,
      fromLane: lane,
      fromSkillIndex: skillIndex,
      fromDisplayIndex: displayIndex,
    }

    const hookMismatch = Boolean(skill && !supportsHook(skill, lane))

    return (
      <div
        key={`${lane}-${skillId}-${displayIndex}`}
        draggable
        onDragStart={(e) => handleDragStart(e, dragPayload)}
        onDragEnd={resetDragState}
        onDragOver={(e) => handleCardDragOver(e, lane, displayIndex)}
        onDrop={(e) => handleCardDrop(e, lane, displayIndex)}
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
          {skillIndex + 1}
        </span>

        <span className="text-[10px] font-mono text-slate-400 shrink-0">
          {skill ? (skill.type === 'loop' ? 'loop' : 'skill') : 'missing'}
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-slate-800 truncate">
            {skill?.name ?? skillId}
          </div>
          <div className="text-xs text-slate-500 truncate">
            {hookMismatch
              ? 'Skill does not support this hook'
              : (skill?.description ?? 'Skill is not available in this workspace')}
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
            handleRemoveSkill(lane, dragPayload)
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
    const items = buildLaneItems(skillIds)

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
          {items.length === 0 && (
            <div
              onDragOver={(e) => handleSlotDragOver(e, lane, 0)}
              onDrop={(e) => handleSlotDrop(e, lane, 0)}
              className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400"
            >
              Drop skills here
            </div>
          )}

          {items.length > 0 && (
            <div className="space-y-1">
              {items.map((item, displayIndex) => (
                <Fragment key={`${lane}-${item.skillId}-${displayIndex}`}>
                  {renderDropSlot(lane, displayIndex)}
                  {renderSkillCard(lane, item.skillId, item.skillIndex, displayIndex)}
                </Fragment>
              ))}
              {renderDropSlot(lane, items.length)}
            </div>
          )}
        </div>
      </div>
    )
  }

  const canAdd = useMemo(() => {
    const parsed = parseSelection(selection)
    if (!parsed) return false

    const alreadySelected = parsed.lane === 'pre'
      ? selectedPreSkillSet.has(parsed.skillId)
      : selectedPostSkillSet.has(parsed.skillId)

    if (alreadySelected) return false

    const skill = skillById.get(parsed.skillId)
    if (!skill) return false

    return supportsHook(skill, parsed.lane)
  }, [selection, selectedPreSkillSet, selectedPostSkillSet, skillById])

  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
          className="min-w-0 flex-1 basis-56 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select a skill…</option>
          {addablePreSkills.length > 0 && (
            <optgroup label="Add to pre-execution">
              {addablePreSkills.map((skill) => (
                <option key={`pre-${skill.id}`} value={`pre:${skill.id}`}>
                  {skill.name}
                </option>
              ))}
            </optgroup>
          )}
          {addablePostSkills.length > 0 && (
            <optgroup label="Add to post-execution">
              {addablePostSkills.map((skill) => (
                <option key={`post-${skill.id}`} value={`post:${skill.id}`}>
                  {skill.name}
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

      {availableSkills.length === 0 && (
        <p className="text-xs text-slate-400">
          No skills are available in this workspace yet.
        </p>
      )}

      <div className="space-y-3">
        {renderLane('pre')}

        <div className="execution-core-divider rounded-xl border-2 border-dashed border-slate-300 px-3 text-center text-sm font-medium text-slate-500">
          Task Execution
        </div>

        {renderLane('post')}
      </div>

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
