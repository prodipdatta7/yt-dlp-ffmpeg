import { SEARCH_PLATFORMS, type SearchResultItem } from '../../../shared/models'
import { CheckSquare, EntryThumb } from './PreviewPanel'
import { EyeIcon, FilmIcon, LayersIcon, LinkIcon, QueueIcon } from './icons'
import { Pill } from './ui'
import { fmtCount } from '../utils/format'
import {
  filteredResults,
  lastSearchedQuery,
  searchResults,
  selectedResultUrls,
  setAllResultsSelected,
  toggleResultSelection,
} from '../signals/searchState'

export function SearchResults({
  onOpenInDownloader,
  onAddToQueue,
  busy,
}: {
  onOpenInDownloader: (item: SearchResultItem) => void
  onAddToQueue: (items: SearchResultItem[]) => void
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
          class="group mf-focus-ring -ml-1 flex items-center gap-2 rounded-md px-1 py-0.5 text-xs font-medium text-slate-400 transition hover:text-ink"
        >
          <CheckSquare checked={allSelected} partial={someSelected} />
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
        <span class="flex items-center gap-2">
          <span class="mf-num text-[11px] font-medium text-slate-500">
            {selectedCount}/{results.length} selected
            {results.length !== total ? ` · ${total} fetched` : ''}
          </span>
          <button
            type="button"
            disabled={selectedCount !== 1 || busy}
            onClick={() => onOpenInDownloader(selectedItems[0])}
            title="Analyze this single result in the Downloader tab"
            class="mf-focus-ring flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-sky-400/50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
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

      {lastSearchedQuery.value && (
        <p class="px-3 pt-1.5 text-[11px] text-slate-500">
          Results for{' '}
          <span class="font-medium text-slate-300">“{lastSearchedQuery.value.query}”</span>
        </p>
      )}

      {results.length > 0 ? (
        <ol class="mt-1.5 grid min-h-0 flex-1 auto-rows-max grid-cols-1 gap-1 overflow-y-auto p-1.5 text-[13px] sm:grid-cols-2 xl:grid-cols-3">
          {results.map((entry) => {
            const checked = selected.has(entry.url)
            return (
              <li key={entry.url}>
                <button
                  type="button"
                  onClick={() => toggleResultSelection(entry.url)}
                  title={checked ? 'Deselect' : 'Select'}
                  class={`mf-row-hover group flex w-full items-start gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition hover:bg-wash-2 ${
                    checked ? 'bg-sky-500/[0.06]' : ''
                  }`}
                >
                  <CheckSquare checked={checked} />
                  <EntryThumb
                    url={entry.thumbnailUrl ?? null}
                    durationSec={entry.durationSec ?? null}
                  />
                  <span class="min-w-0 flex-1">
                    <span
                      className={`block truncate leading-tight ${checked ? 'text-slate-100' : 'text-slate-300'}`}
                      title={entry.title}
                    >
                      {entry.title}
                    </span>
                    <span class="mt-0.5 flex items-center gap-1.5 text-[10.5px] leading-tight text-slate-500">
                      {entry.uploader ? (
                        <span class="truncate">{entry.uploader}</span>
                      ) : (
                        <span class="italic text-slate-700">unknown channel</span>
                      )}
                      {entry.viewCount != null && (
                        <>
                          <span class="text-slate-700">·</span>
                          <EyeIcon class="size-2.5 shrink-0" />
                          <span class="mf-num shrink-0">{fmtCount(entry.viewCount)}</span>
                        </>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      ) : (
        <p class="flex min-h-0 flex-1 items-center justify-center px-4 py-6 text-center text-xs text-slate-600">
          No results match the current filters. Try loosening the duration/views range.
        </p>
      )}

      <div class="mt-2 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-wash-1 px-3 py-2 text-[10px] text-slate-500">
        <span class="inline-flex items-center gap-1.5">
          <LayersIcon class="size-3" />
          Flat search results — open one in the Downloader tab for full stream details.
        </span>
        {lastSearchedQuery.value && (
          <Pill>
            <FilmIcon class="size-3" />
            {SEARCH_PLATFORMS.find((p) => p.id === lastSearchedQuery.value?.platform)?.label ??
              lastSearchedQuery.value.platform}
          </Pill>
        )}
      </div>
    </div>
  )
}
