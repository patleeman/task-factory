export interface SkillLaneItem {
  type: 'skill'
  skillId: string
  skillIndex: number
}

export type LaneItem = SkillLaneItem

export interface SkillDragPosition {
  skillId: string
  fromSkillIndex: number
  fromDisplayIndex: number
}

export function clampIndex(index: number, max: number): number {
  return Math.max(0, Math.min(index, max))
}

export function buildLaneTokens(skillIds: string[]): string[] {
  return [...skillIds]
}

export function parseLaneTokens(tokens: string[]): { skillIds: string[] } {
  return { skillIds: [...tokens] }
}

export function buildLaneItems(skillIds: string[]): LaneItem[] {
  return skillIds.map((skillId, skillIndex) => ({
    type: 'skill',
    skillId,
    skillIndex,
  }))
}

export function findDisplayIndexForSkill(tokens: string[], position: SkillDragPosition): number {
  if (
    position.fromDisplayIndex >= 0
    && position.fromDisplayIndex < tokens.length
    && tokens[position.fromDisplayIndex] === position.skillId
  ) {
    return position.fromDisplayIndex
  }

  if (
    position.fromSkillIndex >= 0
    && position.fromSkillIndex < tokens.length
    && tokens[position.fromSkillIndex] === position.skillId
  ) {
    return position.fromSkillIndex
  }

  return tokens.indexOf(position.skillId)
}
