import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDir = dirname(fileURLToPath(import.meta.url))
const pipelineBarPath = resolve(currentDir, '../../client/src/components/PipelineBar.tsx')

const pipelineBarSource = readFileSync(pipelineBarPath, 'utf-8')

function sliceSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  if (start < 0) {
    throw new Error(`Start marker not found: ${startMarker}`)
  }

  const end = source.indexOf(endMarker, start)
  if (end < 0 || end <= start) {
    throw new Error(`End marker not found after start marker: ${endMarker}`)
  }

  return source.slice(start, end)
}

describe('backlog new-task tile placement regression checks', () => {
  it('renders the backlog New Task tile before mapped backlog task cards', () => {
    const nonEmptyBranch = sliceSection(
      pipelineBarSource,
      '{isEmpty ? (',
      '{/* Drop indicator after last card */}',
    )

    const backlogTileIndex = nonEmptyBranch.indexOf('{isBacklog && (')
    const mappedCardsIndex = nonEmptyBranch.indexOf('{phaseTasks.map((task, i) => {')

    expect(backlogTileIndex).toBeGreaterThan(-1)
    expect(mappedCardsIndex).toBeGreaterThan(-1)
    expect(backlogTileIndex).toBeLessThan(mappedCardsIndex)
  })

  it('keeps the non-empty New Task tile backlog-only and wired to onCreateTask', () => {
    const nonEmptyBranch = sliceSection(
      pipelineBarSource,
      '{isEmpty ? (',
      '{/* Drop indicator after last card */}',
    )

    expect(nonEmptyBranch).toContain('{isBacklog && (')
    expect(nonEmptyBranch).toContain('onClick={onCreateTask}')
    expect(nonEmptyBranch).toContain('<span className="text-[10px] text-slate-400 font-medium">New Task</span>')
  })

  it('keeps the empty backlog placeholder create affordance', () => {
    expect(pipelineBarSource).toContain("{isDragOver ? 'Drop here' : isBacklog ? '+ New Task' : 'Empty'}")
    expect(pipelineBarSource).toContain('onClick={isBacklog ? onCreateTask : undefined}')
  })
})
