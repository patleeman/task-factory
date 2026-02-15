import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, FolderOpen, RotateCcw, Trash2 } from 'lucide-react'
import type { Task } from '@pi-factory/shared'
import { AppIcon } from './AppIcon'

interface ArchivePaneProps {
  archivedTasks: Task[]
  onBack: () => void
  onOpenInFileExplorer: () => Promise<void>
  isOpeningInFileExplorer: boolean
  onRestoreTask: (taskId: string) => Promise<boolean>
  onDeleteTask: (taskId: string) => Promise<boolean>
  onBulkRestoreTasks: (taskIds: string[]) => Promise<void>
  onBulkDeleteTasks: (taskIds: string[]) => Promise<void>
}

const INITIAL_VISIBLE_ROWS = 40
const LOAD_MORE_ROWS = 40

export function ArchivePane({
  archivedTasks,
  onBack,
  onOpenInFileExplorer,
  isOpeningInFileExplorer,
  onRestoreTask,
  onDeleteTask,
  onBulkRestoreTasks,
  onBulkDeleteTasks,
}: ArchivePaneProps) {
  const [filter, setFilter] = useState('')
  const [visibleRows, setVisibleRows] = useState(INITIAL_VISIBLE_ROWS)
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set())
  const [busyTaskIds, setBusyTaskIds] = useState<Record<string, 'restore' | 'delete'>>({})
  const [isBulkRestoring, setIsBulkRestoring] = useState(false)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)

  const listRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)

  const normalizedFilter = filter.trim().toLowerCase()

  const filteredTasks = useMemo(() => {
    if (!normalizedFilter) return archivedTasks

    return archivedTasks.filter((task) => {
      return (
        task.id.toLowerCase().includes(normalizedFilter)
        || task.frontmatter.title.toLowerCase().includes(normalizedFilter)
      )
    })
  }, [archivedTasks, normalizedFilter])

  const visibleTasks = useMemo(() => {
    return filteredTasks.slice(0, visibleRows)
  }, [filteredTasks, visibleRows])

  const hasMoreRows = visibleRows < filteredTasks.length

  const filteredTaskIds = useMemo(() => filteredTasks.map((task) => task.id), [filteredTasks])
  const selectedFilteredTaskIds = useMemo(
    () => filteredTaskIds.filter((taskId) => selectedTaskIds.has(taskId)),
    [filteredTaskIds, selectedTaskIds],
  )

  const allFilteredSelected = filteredTaskIds.length > 0 && selectedFilteredTaskIds.length === filteredTaskIds.length
  const someFilteredSelected = selectedFilteredTaskIds.length > 0 && !allFilteredSelected

  const loadMore = useCallback(() => {
    setVisibleRows((prev) => Math.min(filteredTasks.length, prev + LOAD_MORE_ROWS))
  }, [filteredTasks.length])

  useEffect(() => {
    setVisibleRows(INITIAL_VISIBLE_ROWS)
  }, [normalizedFilter, archivedTasks.length])

  useEffect(() => {
    const archivedTaskIdSet = new Set(archivedTasks.map((task) => task.id))

    setSelectedTaskIds((prev) => {
      const next = new Set(Array.from(prev).filter((taskId) => archivedTaskIdSet.has(taskId)))
      if (next.size === prev.size) return prev
      return next
    })

    setBusyTaskIds((prev) => {
      const nextEntries = Object.entries(prev).filter(([taskId]) => archivedTaskIdSet.has(taskId))
      if (nextEntries.length === Object.keys(prev).length) return prev
      return Object.fromEntries(nextEntries)
    })
  }, [archivedTasks])

  useEffect(() => {
    if (!selectAllRef.current) return
    selectAllRef.current.indeterminate = someFilteredSelected
  }, [someFilteredSelected])

  useEffect(() => {
    if (!hasMoreRows) return

    const listEl = listRef.current
    const loadMoreEl = loadMoreRef.current

    if (!listEl || !loadMoreEl || typeof IntersectionObserver === 'undefined') {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleRows((prev) => Math.min(filteredTasks.length, prev + LOAD_MORE_ROWS))
        }
      },
      {
        root: listEl,
        rootMargin: '140px 0px',
      },
    )

    observer.observe(loadMoreEl)
    return () => observer.disconnect()
  }, [filteredTasks.length, hasMoreRows])

  const toggleTaskSelection = useCallback((taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) {
        next.delete(taskId)
      } else {
        next.add(taskId)
      }
      return next
    })
  }, [])

  const toggleSelectAllFiltered = useCallback(() => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev)

      if (allFilteredSelected) {
        for (const taskId of filteredTaskIds) {
          next.delete(taskId)
        }
      } else {
        for (const taskId of filteredTaskIds) {
          next.add(taskId)
        }
      }

      return next
    })
  }, [allFilteredSelected, filteredTaskIds])

  const markTaskBusy = useCallback((taskId: string, action: 'restore' | 'delete') => {
    setBusyTaskIds((prev) => ({ ...prev, [taskId]: action }))
  }, [])

  const clearTaskBusy = useCallback((taskId: string) => {
    setBusyTaskIds((prev) => {
      if (!(taskId in prev)) return prev
      const next = { ...prev }
      delete next[taskId]
      return next
    })
  }, [])

  const handleRestoreOne = useCallback(async (taskId: string) => {
    markTaskBusy(taskId, 'restore')
    try {
      const success = await onRestoreTask(taskId)
      if (success) {
        setSelectedTaskIds((prev) => {
          if (!prev.has(taskId)) return prev
          const next = new Set(prev)
          next.delete(taskId)
          return next
        })
      }
    } catch (err) {
      console.error('Failed to restore archived task:', err)
    } finally {
      clearTaskBusy(taskId)
    }
  }, [clearTaskBusy, markTaskBusy, onRestoreTask])

  const handleDeleteOne = useCallback(async (taskId: string) => {
    const confirmed = window.confirm('Delete this archived task permanently?')
    if (!confirmed) return

    markTaskBusy(taskId, 'delete')
    try {
      const success = await onDeleteTask(taskId)
      if (success) {
        setSelectedTaskIds((prev) => {
          if (!prev.has(taskId)) return prev
          const next = new Set(prev)
          next.delete(taskId)
          return next
        })
      }
    } catch (err) {
      console.error('Failed to delete archived task:', err)
    } finally {
      clearTaskBusy(taskId)
    }
  }, [clearTaskBusy, markTaskBusy, onDeleteTask])

  const handleBulkRestore = useCallback(async () => {
    if (selectedFilteredTaskIds.length === 0 || isBulkRestoring) return

    setIsBulkRestoring(true)
    try {
      await onBulkRestoreTasks(selectedFilteredTaskIds)
      setSelectedTaskIds((prev) => {
        const next = new Set(prev)
        for (const taskId of selectedFilteredTaskIds) {
          next.delete(taskId)
        }
        return next
      })
    } catch (err) {
      console.error('Failed to restore selected archived tasks:', err)
    } finally {
      setIsBulkRestoring(false)
    }
  }, [isBulkRestoring, onBulkRestoreTasks, selectedFilteredTaskIds])

  const handleBulkDelete = useCallback(async () => {
    if (selectedFilteredTaskIds.length === 0 || isBulkDeleting) return

    const confirmed = window.confirm(
      `Delete ${selectedFilteredTaskIds.length} archived task${selectedFilteredTaskIds.length === 1 ? '' : 's'} permanently?`,
    )
    if (!confirmed) return

    setIsBulkDeleting(true)
    try {
      await onBulkDeleteTasks(selectedFilteredTaskIds)
      setSelectedTaskIds((prev) => {
        const next = new Set(prev)
        for (const taskId of selectedFilteredTaskIds) {
          next.delete(taskId)
        }
        return next
      })
    } catch (err) {
      console.error('Failed to delete selected archived tasks:', err)
    } finally {
      setIsBulkDeleting(false)
    }
  }, [isBulkDeleting, onBulkDeleteTasks, selectedFilteredTaskIds])

  const disableAllActions = isBulkRestoring || isBulkDeleting

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0">
        <h2 className="font-semibold text-xs text-slate-500 uppercase tracking-wide">
          Archive
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { void onOpenInFileExplorer() }}
            disabled={isOpeningInFileExplorer}
            className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <AppIcon icon={FolderOpen} size="xs" />
            {isOpeningInFileExplorer ? 'Opening…' : 'Open in File Explorer'}
          </button>

          <button
            onClick={onBack}
            className="text-xs text-slate-400 hover:text-slate-600 inline-flex items-center gap-1"
          >
            <AppIcon icon={ArrowLeft} size="xs" />
            Back to workspace
          </button>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-slate-200 shrink-0 space-y-2.5">
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500" htmlFor="archive-search">
          Search
        </label>
        <input
          id="archive-search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter archived tasks by ID or title"
          className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
        />

        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <label className="inline-flex items-center gap-2">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAllFiltered}
              disabled={filteredTaskIds.length === 0 || disableAllActions}
            />
            <span>Select all filtered ({filteredTaskIds.length})</span>
          </label>

          <span className="text-slate-400">{selectedFilteredTaskIds.length} selected</span>

          <button
            onClick={handleBulkRestore}
            disabled={selectedFilteredTaskIds.length === 0 || disableAllActions}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <AppIcon icon={RotateCcw} size="xs" />
            Restore to Complete
          </button>

          <button
            onClick={handleBulkDelete}
            disabled={selectedFilteredTaskIds.length === 0 || disableAllActions}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-200 bg-red-50 text-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <AppIcon icon={Trash2} size="xs" />
            Delete Selected
          </button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
        {archivedTasks.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-400 px-6 text-center">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">No archived tasks</p>
              <p className="text-xs">Archive tasks from the pipeline to manage them here.</p>
            </div>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-400 px-6 text-center">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">No search matches</p>
              <p className="text-xs">Try a different ID or title search.</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {visibleTasks.map((task) => {
              const action = busyTaskIds[task.id]
              const isBusy = Boolean(action)

              return (
                <div key={task.id} className="px-4 py-3 flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedTaskIds.has(task.id)}
                    onChange={() => toggleTaskSelection(task.id)}
                    disabled={disableAllActions || isBusy}
                    className="mt-1"
                    aria-label={`Select archived task ${task.id}`}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono text-slate-400">{task.id}</div>
                    <div className="text-sm text-slate-800 font-medium break-words">{task.frontmatter.title}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Updated {new Date(task.frontmatter.updated).toLocaleString()}
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-1.5">
                    <button
                      onClick={() => handleRestoreOne(task.id)}
                      disabled={disableAllActions || isBusy}
                      className="text-[11px] px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                    >
                      <AppIcon icon={RotateCcw} size="xs" />
                      {action === 'restore' ? 'Restoring…' : 'Restore'}
                    </button>
                    <button
                      onClick={() => handleDeleteOne(task.id)}
                      disabled={disableAllActions || isBusy}
                      className="text-[11px] px-2 py-1 rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                    >
                      <AppIcon icon={Trash2} size="xs" />
                      {action === 'delete' ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              )
            })}

            {hasMoreRows && (
              <div ref={loadMoreRef} className="px-4 py-3 text-center">
                <button
                  onClick={loadMore}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  Load more archived tasks
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
