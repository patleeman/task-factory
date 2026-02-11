import { useState, useRef, useCallback } from 'react'
import type { PostExecutionSkill } from '../types/pi'

interface SkillSelectorProps {
  availableSkills: PostExecutionSkill[]
  selectedSkillIds: string[]
  onChange: (skillIds: string[]) => void
}

/**
 * Post-execution skill selector with drag-and-drop reordering.
 *
 * Selected skills appear at the top in execution order. Users can:
 * - Click to toggle skills on/off
 * - Drag selected skills to reorder them
 * - See execution order numbers
 */
export function SkillSelector({ availableSkills, selectedSkillIds, onChange }: SkillSelectorProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const dragNodeRef = useRef<HTMLDivElement | null>(null)

  const selectedSkills = selectedSkillIds
    .map(id => availableSkills.find(s => s.id === id))
    .filter(Boolean) as PostExecutionSkill[]

  const unselectedSkills = availableSkills.filter(s => !selectedSkillIds.includes(s.id))

  const toggleSkill = (skillId: string) => {
    if (selectedSkillIds.includes(skillId)) {
      onChange(selectedSkillIds.filter(id => id !== skillId))
    } else {
      onChange([...selectedSkillIds, skillId])
    }
  }

  // --- Drag-and-drop handlers for reordering selected skills ---

  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
    setDragIndex(index)
    dragNodeRef.current = e.currentTarget
    e.dataTransfer.effectAllowed = 'move'
    // Apply opacity after browser captures the drag ghost image at full opacity
    requestAnimationFrame(() => {
      if (dragNodeRef.current) {
        dragNodeRef.current.style.opacity = '0.4'
      }
    })
  }, [])

  const handleDragEnd = useCallback(() => {
    if (dragNodeRef.current) {
      // Clear the inline style so React's className controls appearance
      dragNodeRef.current.style.removeProperty('opacity')
    }
    setDragIndex(null)
    setDragOverIndex(null)
    dragNodeRef.current = null
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only clear if we're leaving the element (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverIndex(null)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
    e.preventDefault()
    if (dragIndex === null || dragIndex === dropIndex) {
      handleDragEnd()
      return
    }

    const reordered = [...selectedSkillIds]
    const [moved] = reordered.splice(dragIndex, 1)
    reordered.splice(dropIndex, 0, moved)
    onChange(reordered)
    handleDragEnd()
  }, [dragIndex, selectedSkillIds, onChange, handleDragEnd])

  return (
    <div className="space-y-2">
      {/* Selected skills (ordered, draggable) */}
      {selectedSkills.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">
            Selected · drag to reorder
          </p>
          {selectedSkills.map((skill, index) => {
            const isDragging = dragIndex === index
            const isDragOver = dragOverIndex === index && dragIndex !== null && dragIndex !== index

            return (
              <div
                key={skill.id}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-grab active:cursor-grabbing transition-colors ${
                  isDragOver
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-safety-orange bg-orange-50'
                } ${isDragging ? 'opacity-40' : ''}`}
              >
                {/* Drag handle */}
                <span className="text-slate-400 text-xs select-none shrink-0 w-4 text-center" title="Drag to reorder">
                  ⋮⋮
                </span>
                {/* Order number */}
                <span className="w-5 h-5 rounded-full bg-safety-orange text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                  {index + 1}
                </span>
                {/* Skill icon */}
                <span className="text-sm shrink-0">
                  {skill.type === 'loop' ? '🔄' : '🛡️'}
                </span>
                {/* Skill info */}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800 truncate">
                    {skill.name}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {skill.description}
                  </div>
                </div>
                {/* Remove button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleSkill(skill.id)
                  }}
                  className="w-5 h-5 rounded-full text-orange-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center text-xs shrink-0 transition-colors"
                  title="Remove skill"
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Unselected skills */}
      {unselectedSkills.length > 0 && (
        <div className="space-y-1.5">
          {selectedSkills.length > 0 && (
            <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide mt-3">
              Available
            </p>
          )}
          {unselectedSkills.map(skill => (
            <div
              key={skill.id}
              onClick={() => toggleSkill(skill.id)}
              className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 hover:border-slate-300 cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-sm shrink-0">
                  {skill.type === 'loop' ? '🔄' : '🛡️'}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">
                    {skill.name}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {skill.description}
                  </div>
                </div>
              </div>
              <div className="w-4 h-4 rounded border border-slate-300 flex items-center justify-center shrink-0 text-[10px]" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
