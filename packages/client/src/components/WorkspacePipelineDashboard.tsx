import { useEffect, useState } from 'react'
import type { PipelineModelReworkRow, WorkspacePipelineStats } from '../api'
import { api } from '../api'

interface WorkspacePipelineDashboardProps {
  workspaceId: string
}

interface PipelineStatsPanelProps {
  stats: WorkspacePipelineStats | null
  isLoading: boolean
  error: string | null
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0m'
  }

  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  }

  const minutes = seconds / 60
  if (minutes < 60) {
    return `${Math.round(minutes)}m`
  }

  return `${(minutes / 60).toFixed(1)}h`
}

function renderModelRows(rows: PipelineModelReworkRow[]) {
  if (rows.length === 0) {
    return <p className="text-xs text-slate-500">No completed tasks for this slice yet.</p>
  }

  return (
    <table className="w-full text-xs border border-slate-200 rounded-md overflow-hidden">
      <thead className="bg-slate-100 text-slate-600 uppercase tracking-wide">
        <tr>
          <th className="text-left px-2 py-1.5 font-semibold">Model</th>
          <th className="text-right px-2 py-1.5 font-semibold">Completed</th>
          <th className="text-right px-2 py-1.5 font-semibold">Reworked</th>
          <th className="text-right px-2 py-1.5 font-semibold">Rework Rate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.model} className="border-t border-slate-200">
            <td className="px-2 py-1.5 font-mono text-[11px] text-slate-700">{row.model}</td>
            <td className="px-2 py-1.5 text-right text-slate-700">{row.completedTaskCount}</td>
            <td className="px-2 py-1.5 text-right text-slate-700">{row.reworkedTaskCount}</td>
            <td className="px-2 py-1.5 text-right text-slate-700">{formatPercent(row.reworkRate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function PipelineStatsPanel({ stats, isLoading, error }: PipelineStatsPanelProps) {
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500">
        <p className="text-sm font-medium">Loading pipeline stats…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-center px-6">
        <div>
          <p className="text-sm font-semibold text-red-700 mb-1">Unable to load pipeline stats</p>
          <p className="text-xs text-red-600">{error}</p>
        </div>
      </div>
    )
  }

  if (!stats || stats.taskCount === 0) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400 px-6 text-center">
        <div>
          <p className="text-sm font-medium text-slate-500 mb-1">No pipeline data yet</p>
          <p className="text-xs">Create tasks and move them across phases to populate metrics.</p>
        </div>
      </div>
    )
  }

  const conversionRows = [
    stats.funnel.conversionRates.backlogToReady,
    stats.funnel.conversionRates.readyToExecuting,
    stats.funnel.conversionRates.executingToComplete,
    stats.funnel.conversionRates.completeToArchived,
  ]

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Tasks</div>
          <div className="text-lg font-semibold text-slate-800">{stats.taskCount}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Throughput / day</div>
          <div className="text-lg font-semibold text-slate-800">{stats.flow.throughputPerDay.toFixed(2)}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Rework rate</div>
          <div className="text-lg font-semibold text-slate-800">{formatPercent(stats.rework.reworkRate)}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Complete → Ready</div>
          <div className="text-lg font-semibold text-slate-800">{stats.rework.completeToReadyTransitionCount}</div>
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Funnel</h3>
        <table className="w-full text-xs border border-slate-200 rounded-md overflow-hidden">
          <thead className="bg-slate-100 text-slate-600 uppercase tracking-wide">
            <tr>
              <th className="text-left px-2 py-1.5 font-semibold">Phase</th>
              <th className="text-right px-2 py-1.5 font-semibold">Count</th>
              <th className="text-right px-2 py-1.5 font-semibold">In</th>
              <th className="text-right px-2 py-1.5 font-semibold">Out</th>
            </tr>
          </thead>
          <tbody>
            {(['backlog', 'ready', 'executing', 'complete', 'archived'] as const).map((phase) => (
              <tr key={phase} className="border-t border-slate-200">
                <td className="px-2 py-1.5 capitalize text-slate-700">{phase}</td>
                <td className="px-2 py-1.5 text-right text-slate-700">{stats.funnel.phaseCounts[phase]}</td>
                <td className="px-2 py-1.5 text-right text-slate-700">{stats.funnel.phaseTransitions[phase].in}</td>
                <td className="px-2 py-1.5 text-right text-slate-700">{stats.funnel.phaseTransitions[phase].out}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid grid-cols-1 gap-1">
          {conversionRows.map((row) => (
            <div key={`${row.from}-${row.to}`} className="text-xs text-slate-600 flex items-center justify-between border border-slate-200 rounded px-2 py-1.5 bg-white">
              <span className="font-mono text-[11px]">{row.from} → {row.to}</span>
              <span>{row.count}/{row.denominator} ({formatPercent(row.rate)})</span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Flow Time</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="border border-slate-200 rounded-md p-2 bg-white">
            <div className="font-semibold text-slate-700 mb-1">Cycle Time</div>
            <div className="text-slate-600">avg {formatDuration(stats.flow.cycleTime.average)}</div>
            <div className="text-slate-600">median {formatDuration(stats.flow.cycleTime.median)}</div>
            <div className="text-slate-600">p95 {formatDuration(stats.flow.cycleTime.p95)}</div>
          </div>
          <div className="border border-slate-200 rounded-md p-2 bg-white">
            <div className="font-semibold text-slate-700 mb-1">Lead Time</div>
            <div className="text-slate-600">avg {formatDuration(stats.flow.leadTime.average)}</div>
            <div className="text-slate-600">median {formatDuration(stats.flow.leadTime.median)}</div>
            <div className="text-slate-600">p95 {formatDuration(stats.flow.leadTime.p95)}</div>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rework by planning model</h3>
        {renderModelRows(stats.rework.planningModels)}
      </section>

      <section className="space-y-2 pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rework by execution model</h3>
        {renderModelRows(stats.rework.executionModels)}
      </section>
    </div>
  )
}

export function WorkspacePipelineDashboard({ workspaceId }: WorkspacePipelineDashboardProps) {
  const [stats, setStats] = useState<WorkspacePipelineStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)

    api.getWorkspacePipelineStats(workspaceId)
      .then((data) => {
        if (cancelled) return
        setStats(data)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load pipeline stats')
      })
      .finally(() => {
        if (cancelled) return
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId])

  return <PipelineStatsPanel stats={stats} isLoading={isLoading} error={error} />
}
