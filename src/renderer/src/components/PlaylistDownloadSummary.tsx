import { useEffect, useState } from 'preact/hooks'
import type { AnalyzeResult } from '../../../shared/models'
import type { QueueRow } from '../signals/queueState'
import { fmtSize } from '../utils/format'
import {
  AlertIcon,
  CheckIcon,
  ClipboardIcon,
  DownloadIcon,
  FolderIcon,
  HardDriveIcon,
  LayersIcon,
  QueueIcon,
} from './icons'

function parentDirectory(path: string): string | null {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return cut > 0 ? path.slice(0, cut) : null
}

function outcomeLabel(row: QueueRow): string {
  if (row.status === 'done') return row.skipped ? 'Already present' : 'Downloaded'
  return row.status === 'failed' ? 'Needs retry' : 'Cancelled'
}

export function PlaylistDownloadSummary({
  result,
  rows,
  modeLabel,
  onDownloadAnother,
  onReviewQueue,
}: {
  result: AnalyzeResult
  rows: QueueRow[]
  modeLabel: string
  onDownloadAnother: () => void
  onReviewQueue: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [measuredBytesByPath, setMeasuredBytesByPath] = useState<Record<string, number>>({})
  const [isMeasuringSizes, setIsMeasuringSizes] = useState(true)
  const downloaded = rows.filter((row) => row.status === 'done')
  const newlyDownloaded = downloaded.filter((row) => !row.skipped)
  const alreadyPresent = downloaded.filter((row) => row.skipped)
  const needsAttention = rows.filter((row) => row.status === 'failed' || row.status === 'cancelled')
  const outputPath = downloaded.find((row) => row.outputPath)?.outputPath ?? null
  const outputFolder = outputPath ? parentDirectory(outputPath) : null
  const measuredRows = downloaded.flatMap((row) => {
    const bytes =
      (row.outputPath ? measuredBytesByPath[row.outputPath] : undefined) ?? row.outputBytes
    return typeof bytes === 'number' ? [{ ...row, outputBytes: bytes }] : []
  })
  const measuredBytes = measuredRows.reduce((total, row) => total + (row.outputBytes ?? 0), 0)
  const allDownloadedSizesKnown = measuredRows.length === downloaded.length && downloaded.length > 0
  const isFullyComplete = needsAttention.length === 0
  const visibleRows = rows.slice(0, 6)

  useEffect(() => {
    let disposed = false
    const outputPaths = downloaded.flatMap((row) => (row.outputPath ? [row.outputPath] : []))
    if (outputPaths.length === 0) {
      setMeasuredBytesByPath({})
      setIsMeasuringSizes(false)
      return
    }
    setIsMeasuringSizes(true)
    void window.mf
      .getOutputFileSizes(outputPaths)
      .then((sizes) => {
        if (!disposed) setMeasuredBytesByPath(sizes)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) setIsMeasuringSizes(false)
      })
    return () => {
      disposed = true
    }
  }, [rows])

  async function copyFolder() {
    if (!outputFolder) return
    try {
      await navigator.clipboard.writeText(outputFolder)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section
      class="mf-download-summary mf-playlist-summary mf-rise"
      aria-labelledby="playlist-complete-title"
    >
      <div class="mf-download-summary-card mf-playlist-summary-card">
        <header class="mf-download-summary-head">
          <div class="mf-download-summary-orbit" aria-hidden="true">
            <span>
              <LayersIcon class="size-6" />
            </span>
          </div>
          <div class="min-w-0 flex-1">
            <p class="mf-download-summary-kicker">PLAYLIST DELIVERY</p>
            <h2 id="playlist-complete-title">
              {isFullyComplete ? 'Your playlist is ready.' : 'Your playlist download finished.'}
            </h2>
            <p class="mf-download-summary-lede">
              {isFullyComplete
                ? `${downloaded.length} ${downloaded.length === 1 ? 'file is' : 'files are'} verified and ready in your chosen folder.`
                : `${downloaded.length} of ${rows.length} entries are ready. Review the remaining entries before closing this run.`}
            </p>
          </div>
          <span
            class={`mf-download-summary-state ${needsAttention.length > 0 ? 'mf-playlist-summary-state-alert' : ''}`}
          >
            {needsAttention.length > 0 ? (
              <AlertIcon class="size-3" />
            ) : (
              <CheckIcon class="size-3" />
            )}
            {needsAttention.length > 0 ? `${needsAttention.length} need attention` : 'Verified'}
          </span>
        </header>

        <div class="mf-playlist-summary-layout">
          <div class="mf-download-summary-main">
            <div class="mf-playlist-summary-source">
              {result.metadata.thumbnailUrl ? (
                <img src={result.metadata.thumbnailUrl} alt="" />
              ) : (
                <span class="mf-playlist-summary-source-fallback" aria-hidden="true">
                  <LayersIcon class="size-6" />
                </span>
              )}
              <div class="min-w-0">
                <p>PLAYLIST</p>
                <h3 class="mf-select-text truncate">{result.metadata.title}</h3>
                <span>
                  {result.metadata.uploader ?? 'Unknown creator'} · {modeLabel}
                </span>
              </div>
            </div>

            <div class="mf-playlist-summary-metrics" aria-label="Playlist completion summary">
              <div>
                <span>Downloaded</span>
                <strong>{newlyDownloaded.length}</strong>
              </div>
              <div>
                <span>Already ready</span>
                <strong>{alreadyPresent.length}</strong>
              </div>
              <div class={needsAttention.length > 0 ? 'mf-playlist-summary-metric-alert' : ''}>
                <span>Needs attention</span>
                <strong>{needsAttention.length}</strong>
              </div>
              <div>
                <span>{allDownloadedSizesKnown ? 'Downloaded size' : 'Known size'}</span>
                <strong>
                  {isMeasuringSizes
                    ? 'Measuring…'
                    : measuredRows.length > 0
                      ? fmtSize(measuredBytes)
                      : '—'}
                </strong>
              </div>
            </div>

            <section class="mf-playlist-summary-ledger" aria-labelledby="playlist-delivery-ledger">
              <div class="mf-playlist-summary-ledger-head">
                <div>
                  <p>DELIVERY LEDGER</p>
                  <h3 id="playlist-delivery-ledger">What happened to each entry</h3>
                </div>
                <button type="button" onClick={onReviewQueue} class="mf-focus-ring">
                  Review all <QueueIcon class="size-3.5" />
                </button>
              </div>
              <ol>
                {visibleRows.map((row, index) => (
                  <li key={row.url}>
                    <span class="mf-num">{String(index + 1).padStart(2, '0')}</span>
                    <span class="mf-select-text truncate">{row.title}</span>
                    <span
                      class={
                        row.status === 'done'
                          ? 'mf-playlist-summary-outcome-done'
                          : 'mf-playlist-summary-outcome-alert'
                      }
                    >
                      {outcomeLabel(row)}
                    </span>
                  </li>
                ))}
              </ol>
              {rows.length > visibleRows.length && (
                <p class="mf-playlist-summary-ledger-more">
                  + {rows.length - visibleRows.length} more entries in the queue
                </p>
              )}
            </section>
          </div>

          <aside class="mf-download-summary-handoff" aria-label="Playlist completion actions">
            <div>
              <p class="mf-download-summary-handoff-label">OUTPUT READY</p>
              <h3>Continue from here</h3>
              <p>
                {outputFolder
                  ? 'Your completed entries have been organized in one playlist folder.'
                  : 'No completed file is available to reveal yet.'}
              </p>
            </div>

            <div class="mf-download-summary-actions">
              <button
                type="button"
                disabled={!outputPath}
                onClick={() => outputPath && void window.mf.revealPath(outputPath)}
                class="mf-focus-ring mf-download-summary-primary disabled:cursor-not-allowed disabled:opacity-45"
              >
                <FolderIcon class="size-4" />
                Show files in folder
              </button>
              <button
                type="button"
                onClick={onReviewQueue}
                class="mf-focus-ring mf-download-summary-secondary"
              >
                <QueueIcon class="size-3.5" />
                Review queue
              </button>
              <button
                type="button"
                disabled={!outputFolder}
                onClick={() => void copyFolder()}
                class="mf-focus-ring mf-download-summary-secondary disabled:cursor-not-allowed disabled:opacity-45"
              >
                <ClipboardIcon class="size-3.5" />
                {copied ? 'Folder copied' : 'Copy folder'}
              </button>
            </div>

            <div class="mf-playlist-summary-folder" title={outputFolder ?? undefined}>
              <HardDriveIcon class="size-3.5" />
              <span class="truncate">{outputFolder ?? 'Output folder unavailable'}</span>
            </div>

            <div class="mf-download-summary-new">
              <span>Start a new download</span>
              <button
                type="button"
                onClick={onDownloadAnother}
                class="mf-focus-ring mf-download-summary-next"
              >
                <DownloadIcon class="size-4" />
                Download another
              </button>
            </div>
          </aside>
        </div>
      </div>
    </section>
  )
}
