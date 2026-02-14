import { ArrowRight, Pause, Play, Loader2 } from 'lucide-react'
import type { Shelf, DraftTask, WorkspaceAutomationSettings } from '@pi-factory/shared'
import { AppIcon } from './AppIcon'
import { DraftTaskCard } from './DraftTaskCard'

interface ShelfPaneProps {
  shelf: Shelf
  automationSettings: WorkspaceAutomationSettings
  readyTasksCount: number
  backlogAutomationToggling: boolean
  readyAutomationToggling: boolean
  onToggleBacklogAutomation: () => void
  onToggleReadyAutomation: () => void
  onPushDraft: (draftId: string) => void
  onPushAll: () => void
  onRemoveItem: (itemId: string) => void
  onUpdateDraft: (draftId: string, updates: Partial<DraftTask>) => void
  onClearShelf: () => void
}

interface AutomationToggleButtonProps {
  label: string
  description: string
  enabled: boolean
  loading: boolean
  onClick: () => void
  readyCountBadge?: number
}

function AutomationToggleButton({
  label,
  description,
  enabled,
  loading,
  onClick,
  readyCountBadge,
}: AutomationToggleButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border text-left transition-colors ${
        enabled
          ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100'
          : 'border-slate-200 bg-white hover:border-slate-300'
      } ${loading ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      <div className="min-w-0">
        <div className="text-xs font-semibold text-slate-800 leading-4">{label}</div>
        <div className="text-[11px] text-slate-500 leading-4">{description}</div>
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        {typeof readyCountBadge === 'number' && enabled && readyCountBadge > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
            {readyCountBadge} ready
          </span>
        )}
        {loading ? (
          <AppIcon icon={Loader2} size="sm" className="text-slate-500 animate-spin" />
        ) : enabled ? (
          <AppIcon icon={Pause} size="sm" className="text-emerald-700" />
        ) : (
          <AppIcon icon={Play} size="sm" className="text-slate-500" />
        )}
      </div>
    </button>
  )
}

export function ShelfPane({
  shelf,
  automationSettings,
  readyTasksCount,
  backlogAutomationToggling,
  readyAutomationToggling,
  onToggleBacklogAutomation,
  onToggleReadyAutomation,
  onPushDraft,
  onPushAll,
  onRemoveItem,
  onUpdateDraft,
  onClearShelf,
}: ShelfPaneProps) {
  const drafts = shelf.items.filter((si): si is { type: 'draft-task'; item: DraftTask } => si.type === 'draft-task')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0">
        <h2 className="font-semibold text-xs text-slate-500 uppercase tracking-wide">
          Production Queue
          {drafts.length > 0 && (
            <span className="ml-1.5 text-slate-400 font-normal">({drafts.length})</span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {drafts.length > 0 && (
            <>
              <button
                onClick={onPushAll}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors inline-flex items-center gap-1"
              >
                Push all to backlog
                <AppIcon icon={ArrowRight} size="xs" />
              </button>
              <button
                onClick={onClearShelf}
                className="text-xs text-slate-400 hover:text-red-500 font-medium transition-colors"
              >
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {/* Workflow automation control bar */}
      <div className="px-3 py-2 border-b border-slate-200 bg-slate-50/70 shrink-0">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 px-1 mb-1.5">
          Workflow Automation
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          <AutomationToggleButton
            label="Backlog → Ready"
            description="Auto-promote after planning saves a valid plan"
            enabled={automationSettings.backlogToReady}
            loading={backlogAutomationToggling}
            onClick={onToggleBacklogAutomation}
          />
          <AutomationToggleButton
            label="Ready → Executing"
            description="Queue manager continuously auto-starts ready tasks"
            enabled={automationSettings.readyToExecuting}
            loading={readyAutomationToggling}
            onClick={onToggleReadyAutomation}
            readyCountBadge={readyTasksCount}
          />
        </div>
      </div>

      {/* Draft tasks */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {drafts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 px-6">
            <p className="text-sm font-medium text-slate-500 mb-1">Production queue is empty</p>
            <p className="text-xs text-center">
              Chat with the Foreman to create draft tasks
            </p>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {drafts.map(({ item: draft }) => (
              <DraftTaskCard
                key={draft.id}
                draft={draft}
                onPush={() => onPushDraft(draft.id)}
                onRemove={() => onRemoveItem(draft.id)}
                onUpdate={(updates) => onUpdateDraft(draft.id, updates)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
