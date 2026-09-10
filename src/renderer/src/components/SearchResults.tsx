import type { SearchResultItem } from '../../../shared/models'
import { CheckSquare } from './PreviewPanel'
import { LinkIcon, QueueIcon, RotateCcwIcon } from './icons'
import {
  activePreviewUrl,
  filteredResults,
  resetSearch,
  searchResults,
  selectedResultUrls,
  setAllResultsSelected,
  toggleResultSelection,
} from '../signals/searchState'
import { SearchResultCard } from './SearchResultCard'
import type { FormatPresetOption } from '../utils/estimate'

export function SearchResults({
  onOpenInDownloader,
  onAddToQueue,
  onQuickDownload,
  busy,
}: {
  onOpenInDownloader: (item: SearchResultItem) => void
  onAddToQueue: (items: SearchResultItem[], preset?: FormatPresetOption) => void
  onQuickDownload?: (item: SearchResultItem, preset: FormatPresetOption) => void
  busy: boolean
}) {
  const results = filteredResults.value
  const total = searchResults.value.length
  const selected = selectedResultUrls.value
  const selectedCount = results.filter((r) => selected.has(r.url)).length
  const allSelected = results.length > 0 && selectedCount === results.length
  const someSelected = selectedCount > 0 && !allSelected

  if (total === 0) return null

  const selectedItems = results.filter((r) => selected.has(r.url))

  return (
    <div class="mf-card flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 px-3 pt-2.5">
        <button
          onClick={() => setAllResultsSelected(!allSelected)}
          disabled={results.length === 0}
          class="group mf-focus-ring -ml-1 flex items-center gap-2 rounded-md px-1 py-0.5 text-xs font-medium text-neutral-600 dark:text-slate-400 transition hover:text-ink"
        >
          <CheckSquare checked={allSelected} partial={someSelected} />
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
        <span class="flex items-center gap-2">
          <span class="mf-num text-[11px] font-medium text-neutral-500 dark:text-slate-400">
            {selectedCount}/{results.length} selected
            {results.length !== total ? ` · ${total} fetched` : ''}
          </span>
          <button
            type="button"
            disabled={selectedCount !== 1 || busy}
            onClick={() => onOpenInDownloader(selectedItems[0])}
            title="Analyze this single result in the Downloader tab"
            class="mf-focus-ring flex items-center gap-1.5 rounded-lg border border-neutral-300 dark:border-line-strong px-2.5 py-1 text-[11px] font-semibold text-neutral-700 dark:text-slate-200 transition hover:border-sky-400/50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <LinkIcon class="size-3.5" />
            Open in Downloader
          </button>
          <button
            type="button"
            disabled={selectedCount === 0 || busy}
            onClick={() => onAddToQueue(selectedItems)}
            title="Queue the selected results for download"
            class="mf-focus-ring flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow shadow-sky-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <QueueIcon class="size-3.5" />
            Add to Queue{selectedCount > 0 ? ` · ${selectedCount}` : ''}
          </button>
        </span>
      </div>

      {results.length > 0 ? (
        <ol
          class={`mt-2 flex min-h-0 flex-1 flex-col gap-3.5 ${
            activePreviewUrl.value !== null ? 'overflow-y-hidden' : 'overflow-y-auto'
          } p-2.5`}
        >
          {results.map((entry) => (
            <SearchResultCard
              key={entry.url}
              entry={entry}
              selected={selected.has(entry.url)}
              onToggleSelect={toggleResultSelection}
              onOpenInDownloader={onOpenInDownloader}
              onQuickDownload={(item, preset) => {
                if (onQuickDownload) {
                  onQuickDownload(item, preset)
                } else {
                  onAddToQueue([item], preset)
                }
              }}
              onAddToQueue={(item, preset) => onAddToQueue([item], preset)}
              disabled={busy}
            />
          ))}
        </ol>
      ) : (
        <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-6 text-center text-xs text-slate-500">
          <p>No results match the current filters. Try loosening the duration/views range.</p>
          <button
            type="button"
            onClick={() => resetSearch()}
            class="mf-focus-ring inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-slate-300 hover:border-line-strong hover:text-ink transition"
          >
            <RotateCcwIcon class="size-3.5" />
            <span>Reset Search</span>
          </button>
        </div>
      )}
    </div>
  )
}
