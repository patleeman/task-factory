import { Loader2, Pause, Play } from 'lucide-react'
import type { WorkspaceAutomationSettings } from '@pi-factory/shared'
import { AppIcon } from './AppIcon'

interface WorkflowAutomationControlsProps {
  settings: WorkspaceAutomationSettings
  readyTasksCount: number
  backlogAutomationToggling: boolean
  readyAutomationToggling: boolean
  onToggleBacklogAutomation: () => void
  onToggleReadyAutomation: () => void
  variant?: 'header' | 'shelf'
}

interface AutomationToggleButtonProps {
  label: string
  title: string
  enabled: boolean
  loading: boolean
  onClick: () => void
  readyCountBadge?: number
  variant: 'header' | 'shelf'
}

function AutomationToggleButton({
  label,
  title,
  enabled,
  loading,
  onClick,
  readyCountBadge,
  variant,
}: AutomationToggleButtonProps) {
  const variantClasses = variant === 'shelf'
    ? (enabled
      ? 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-500'
      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50')
    : (enabled
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30 hover:bg-emerald-500/30'
      : 'bg-slate-700 text-slate-300 border-slate-600 hover:bg-slate-600')

  const badgeClasses = variant === 'shelf'
    ? 'bg-emerald-700/70 text-emerald-100'
    : 'bg-emerald-500/30 text-emerald-200'

  return (
    <button
      onClick={onClick}
      disabled={loading}
      title={title}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${variantClasses} ${loading ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      {loading ? (
        <AppIcon icon={Loader2} size="xs" className="animate-spin" />
      ) : enabled ? (
        <AppIcon icon={Pause} size="xs" />
      ) : (
        <AppIcon icon={Play} size="xs" />
      )}
      <span>{label}</span>
      {typeof readyCountBadge === 'number' && enabled && readyCountBadge > 0 && (
        <span className={`text-[10px] px-1 py-0.5 rounded-full ${badgeClasses}`}>
          {readyCountBadge}
        </span>
      )}
    </button>
  )
}

export function WorkflowAutomationControls({
  settings,
  readyTasksCount,
  backlogAutomationToggling,
  readyAutomationToggling,
  onToggleBacklogAutomation,
  onToggleReadyAutomation,
  variant = 'header',
}: WorkflowAutomationControlsProps) {
  return (
    <div className="flex items-center gap-2">
      <AutomationToggleButton
        label="Backlog→Ready"
        title="Auto-promote backlog tasks to Ready when planning completes"
        enabled={settings.backlogToReady}
        loading={backlogAutomationToggling}
        onClick={onToggleBacklogAutomation}
        variant={variant}
      />
      <AutomationToggleButton
        label="Ready→Exec"
        title="Auto-execute Ready tasks via queue manager"
        enabled={settings.readyToExecuting}
        loading={readyAutomationToggling}
        onClick={onToggleReadyAutomation}
        readyCountBadge={readyTasksCount}
        variant={variant}
      />
    </div>
  )
}
