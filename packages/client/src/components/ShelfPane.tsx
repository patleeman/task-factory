import { ArrowRight, FileCode2, Loader2, Pause, Play, X } from 'lucide-react'
import type { Artifact, DraftTask, Shelf, WorkspaceAutomationSettings } from '@pi-factory/shared'
import { AppIcon } from './AppIcon'
import { ArtifactViewer } from './ArtifactViewer'
import { DraftTaskCard } from './DraftTaskCard'

interface ShelfPaneProps {
  shelf: Shelf
  selectedArtifactId: string | null
  automationSettings: WorkspaceAutomationSettings
  readyTasksCount: number
  backlogAutomationToggling: boolean
  readyAutomationToggling: boolean
  onToggleBacklogAutomation: () => void
  onToggleReadyAutomation: () => void
  onSelectArtifact: (artifactId: string) => void
  onCloseArtifact: () => void
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

function ArtifactList({
  artifacts,
  selectedArtifactId,
  onSelectArtifact,
  onRemoveItem,
}: {
  artifacts: Artifact[]
  selectedArtifactId: string | null
  onSelectArtifact: (artifactId: string) => void
  onRemoveItem: (itemId: string) => void
}) {
  if (artifacts.length === 0) return null

  return (
    <div>
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2 px-0.5">
        Artifacts ({artifacts.length})
      </div>
      <div className="space-y-2">
        {artifacts.map((artifact) => {
          const isSelected = selectedArtifactId === artifact.id
          return (
            <div
              key={artifact.id}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors ${
                isSelected
                  ? 'border-indigo-300 bg-indigo-50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <button
                onClick={() => onSelectArtifact(artifact.id)}
                className="flex-1 min-w-0 text-left"
                title={`Open artifact: ${artifact.name}`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <AppIcon icon={FileCode2} size="xs" className={isSelected ? 'text-indigo-600' : 'text-slate-400'} />
                  <span className="text-sm text-slate-800 font-medium truncate">{artifact.name}</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 truncate">{artifact.id}</div>
              </button>
              <button
                onClick={() => onRemoveItem(artifact.id)}
                className="text-xs text-red-500 hover:text-red-700 font-medium shrink-0"
              >
                Remove
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ShelfPane({
  shelf,
  selectedArtifactId,
  automationSettings,
  readyTasksCount,
  backlogAutomationToggling,
  readyAutomationToggling,
  onToggleBacklogAutomation,
  onToggleReadyAutomation,
  onSelectArtifact,
  onCloseArtifact,
  onPushDraft,
  onPushAll,
  onRemoveItem,
  onUpdateDraft,
  onClearShelf,
}: ShelfPaneProps) {
  const drafts = shelf.items.filter((si): si is { type: 'draft-task'; item: DraftTask } => si.type === 'draft-task')
  const artifacts = shelf.items
    .filter((si): si is { type: 'artifact'; item: Artifact } => si.type === 'artifact')
    .map((si) => si.item)
  const selectedArtifact = selectedArtifactId
    ? artifacts.find((artifact) => artifact.id === selectedArtifactId) || null
    : null
  const hasShelfItems = shelf.items.length > 0
  const showArtifactViewer = selectedArtifactId !== null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0">
        <h2 className="font-semibold text-xs text-slate-500 uppercase tracking-wide">
          Production Queue
          {hasShelfItems && (
            <span className="ml-1.5 text-slate-400 font-normal">({shelf.items.length})</span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {drafts.length > 0 && (
            <button
              onClick={onPushAll}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors inline-flex items-center gap-1"
            >
              Push all to backlog
              <AppIcon icon={ArrowRight} size="xs" />
            </button>
          )}
          {hasShelfItems && (
            <button
              onClick={onClearShelf}
              className="text-xs text-slate-400 hover:text-red-500 font-medium transition-colors"
            >
              Clear
            </button>
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

      <div className="flex-1 min-h-0 flex flex-col">
        {/* Queue items list */}
        <div className={`${showArtifactViewer ? 'h-1/2 border-b border-slate-200' : 'flex-1'} overflow-y-auto min-h-0`}>
          {!hasShelfItems ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 px-6">
              <p className="text-sm font-medium text-slate-500 mb-1">Production queue is empty</p>
              <p className="text-xs text-center">
                Chat with the Foreman to create draft tasks
              </p>
            </div>
          ) : (
            <div className="p-3 space-y-4">
              {drafts.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide px-0.5">
                    Draft tasks ({drafts.length})
                  </div>
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

              <ArtifactList
                artifacts={artifacts}
                selectedArtifactId={selectedArtifactId}
                onSelectArtifact={onSelectArtifact}
                onRemoveItem={onRemoveItem}
              />
            </div>
          )}
        </div>

        {/* Artifact detail viewer */}
        {showArtifactViewer && (
          <div className="flex-1 min-h-0 flex flex-col bg-slate-50/30">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-200 bg-white shrink-0">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Artifact Viewer</div>
                <div className="text-sm text-slate-700 truncate font-medium">
                  {selectedArtifact ? selectedArtifact.name : selectedArtifactId}
                </div>
              </div>
              <button
                onClick={onCloseArtifact}
                className="text-xs text-slate-400 hover:text-slate-600 inline-flex items-center gap-1"
              >
                <AppIcon icon={X} size="xs" />
                Close
              </button>
            </div>

            <div className="flex-1 min-h-0 bg-white">
              {selectedArtifact ? (
                <ArtifactViewer html={selectedArtifact.html} />
              ) : (
                <div className="h-full flex items-center justify-center text-center px-6">
                  <div>
                    <p className="text-sm font-medium text-amber-700">Artifact unavailable</p>
                    <p className="text-xs text-slate-500 mt-1">
                      This artifact was removed from the shelf. Pick another artifact from the list.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
