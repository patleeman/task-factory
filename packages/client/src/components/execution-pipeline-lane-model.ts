export const WRAPPER_MARKER_TOKEN = '__pi_factory_wrapper_marker__'

export interface SkillLaneItem {
  type: 'skill'
  skillId: string
  skillIndex: number
}

export interface MarkerLaneItem {
  type: 'marker'
}

export type LaneItem = SkillLaneItem | MarkerLaneItem

export interface SkillDragPosition {
  skillId: string
  fromSkillIndex: number
  fromDisplayIndex: number
}

export function clampIndex(index: number, max: number): number {
  return Math.max(0, Math.min(index, max))
}

export function buildLaneTokens(
  skillIds: string[],
  markerIndex: number,
  hasMarker: boolean,
): string[] {
  if (!hasMarker) {
    return [...skillIds]
  }

  const clampedMarkerIndex = clampIndex(markerIndex, skillIds.length)
  return [
    ...skillIds.slice(0, clampedMarkerIndex),
    WRAPPER_MARKER_TOKEN,
    ...skillIds.slice(clampedMarkerIndex),
  ]
}

export function parseLaneTokens(tokens: string[], hasMarker: boolean): { skillIds: string[]; markerIndex: number } {
  const skillIds = tokens.filter((token) => token !== WRAPPER_MARKER_TOKEN)

  if (!hasMarker) {
    return { skillIds, markerIndex: 0 }
  }

  const markerDisplayIndex = tokens.indexOf(WRAPPER_MARKER_TOKEN)
  if (markerDisplayIndex === -1) {
    return {
      skillIds,
      markerIndex: skillIds.length,
    }
  }

  let markerSkillIndex = 0
  for (let i = 0; i < markerDisplayIndex; i += 1) {
    if (tokens[i] !== WRAPPER_MARKER_TOKEN) {
      markerSkillIndex += 1
    }
  }

  return {
    skillIds,
    markerIndex: markerSkillIndex,
  }
}

export function buildLaneItems(skillIds: string[], markerIndex: number, hasMarker: boolean): LaneItem[] {
  const items: LaneItem[] = []

  if (!hasMarker) {
    for (let skillIndex = 0; skillIndex < skillIds.length; skillIndex += 1) {
      items.push({ type: 'skill', skillId: skillIds[skillIndex], skillIndex })
    }
    return items
  }

  const clampedMarkerIndex = clampIndex(markerIndex, skillIds.length)

  for (let skillIndex = 0; skillIndex < skillIds.length; skillIndex += 1) {
    if (skillIndex === clampedMarkerIndex) {
      items.push({ type: 'marker' })
    }

    items.push({
      type: 'skill',
      skillId: skillIds[skillIndex],
      skillIndex,
    })
  }

  if (clampedMarkerIndex === skillIds.length) {
    items.push({ type: 'marker' })
  }

  return items
}

export function findDisplayIndexForSkill(tokens: string[], position: SkillDragPosition): number {
  if (
    position.fromDisplayIndex >= 0
    && position.fromDisplayIndex < tokens.length
    && tokens[position.fromDisplayIndex] === position.skillId
  ) {
    return position.fromDisplayIndex
  }

  let skillIndex = 0
  for (let displayIndex = 0; displayIndex < tokens.length; displayIndex += 1) {
    const token = tokens[displayIndex]
    if (token === WRAPPER_MARKER_TOKEN) continue

    if (skillIndex === position.fromSkillIndex && token === position.skillId) {
      return displayIndex
    }

    skillIndex += 1
  }

  return tokens.indexOf(position.skillId)
}
