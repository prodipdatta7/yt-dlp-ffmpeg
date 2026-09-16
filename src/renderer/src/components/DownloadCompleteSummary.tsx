import { useEffect, useState } from 'preact/hooks'
import type { AnalyzeResult } from '../../../shared/models'
import type { JobDonePayload } from '../../../shared/ipcContract'
import { fmtDuration, fmtSize } from '../utils/format'
import { VideoBanner } from './PreviewPanel'
import { CheckIcon, ClipboardIcon, DownloadIcon, FolderIcon, LinkIcon, PlayIcon } from './icons'

type SelectionSummary = {
  mode: 'video-audio' | 'audio-only' | 'advanced'
  tier: number
  container: 'mp4' | 'mkv' | 'webm'
  audioFormat: 'mp3' | 'm4a' | 'flac' | 'wav' | 'ogg'
  bitrate: '320K' | '192K' | '128K' | null
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function formatLabel(selection: SelectionSummary | null): string {
  if (!selection) return 'Download verified'
  if (selection.mode === 'audio-only') {
    return `${selection.audioFormat.toUpperCase()}${selection.bitrate ? ` · ${selection.bitrate}` : ''}`
  }
  if (selection.mode === 'advanced') return `Custom streams · ${selection.container.toUpperCase()}`
  const quality =
    selection.tier === 2160 ? '4K' : selection.tier === 4320 ? '8K' : `${selection.tier}p`
  return `${quality} · ${selection.container.toUpperCase()}`
}

export function DownloadCompleteSummary({
  result,
  done,
  selection,
  onDownloadAnother,
}: {
  result: AnalyzeResult
  done: JobDonePayload
  selection: SelectionSummary | null
  onDownloadAnother: () => void
}) {
  const [copied, setCopied] = useState(false)
  const outputPath = done.outputPath ?? ''
  const metadata = result.metadata
  const [outputBytes, setOutputBytes] = useState<number | null>(done.outputBytes ?? null)
  const [isMeasuringSize, setIsMeasuringSize] = useState(Boolean(outputPath))

  useEffect(() => {
    let disposed = false
    if (!outputPath) {
      setOutputBytes(null)
      setIsMeasuringSize(false)
      return
    }
    setIsMeasuringSize(true)
    void window.mf
      .getOutputFileSizes([outputPath])
      .then((sizes) => {
        if (!disposed) setOutputBytes(sizes[outputPath] ?? done.outputBytes ?? null)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) setIsMeasuringSize(false)
      })
    return () => {
      disposed = true
    }
  }, [done.outputBytes, outputPath])

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(outputPath)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section class="mf-download-summary mf-rise" aria-labelledby="download-complete-title">
      <div class="mf-download-summary-card">
        <header class="mf-download-summary-head">
          <div class="mf-download-summary-orbit" aria-hidden="true">
            <span>
              <CheckIcon class="size-6" />
            </span>
          </div>
          <div class="min-w-0 flex-1">
            <p class="mf-download-summary-kicker">TRANSFER COMPLETE</p>
            <h2 id="download-complete-title">
              {done.skipped ? 'Your file was already ready.' : 'Your file is ready.'}
            </h2>
            <p class="mf-download-summary-lede">
              {done.skipped
                ? 'A matching verified file already exists in your chosen folder.'
                : 'Download finished, output verified, and temporary files cleaned up.'}
            </p>
          </div>
          <span class="mf-download-summary-state">
            <CheckIcon class="size-3" />
            Verified
          </span>
        </header>

        <div class="mf-download-summary-layout">
          <div class="mf-download-summary-main">
            <div class="mf-download-summary-preview">
              <VideoBanner result={result} readOnly />
            </div>

            <div class="mf-download-summary-file" title={outputPath}>
              <span class="mf-download-summary-file-icon">
                <FolderIcon class="size-4" />
              </span>
              <span class="min-w-0 flex-1">
                <small>OUTPUT FILE</small>
                <strong class="mf-select-text truncate">{fileName(outputPath)}</strong>
                <span class="mf-select-text truncate">{outputPath}</span>
              </span>
              <span class="mf-download-summary-format">{formatLabel(selection)}</span>
            </div>

            <details class="mf-download-summary-details">
              <summary>View full source details</summary>
              <dl>
                <div>
                  <dt>Title</dt>
                  <dd class="mf-select-text">{metadata.title}</dd>
                </div>
                <div>
                  <dt>Creator</dt>
                  <dd>{metadata.uploader ?? 'Unknown'}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{fmtDuration(metadata.durationSec)}</dd>
                </div>
                <div>
                  <dt>Downloaded size</dt>
                  <dd>{isMeasuringSize ? 'Measuring…' : fmtSize(outputBytes)}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd class="mf-select-text">
                    <LinkIcon class="mr-1 inline size-3" />
                    {metadata.webpageUrl}
                  </dd>
                </div>
              </dl>
            </details>
          </div>

          <aside class="mf-download-summary-handoff" aria-label="Completed download actions">
            <div>
              <p class="mf-download-summary-handoff-label">READY TO USE</p>
              <h3>What would you like to do?</h3>
              <p>Your downloaded file is available locally and ready to play or move.</p>
            </div>

            <div class="mf-download-summary-actions">
              <button
                type="button"
                onClick={() => void window.mf.revealPath(outputPath)}
                class="mf-focus-ring mf-download-summary-primary"
              >
                <FolderIcon class="size-4" />
                Show in folder
              </button>
              <button
                type="button"
                onClick={() => void window.mf.openFile(outputPath)}
                class="mf-focus-ring mf-download-summary-secondary"
              >
                <PlayIcon class="size-4" />
                Play file
              </button>
              <button
                type="button"
                onClick={() => void copyPath()}
                class="mf-focus-ring mf-download-summary-secondary"
              >
                <ClipboardIcon class="size-3.5" />
                {copied ? 'Path copied' : 'Copy path'}
              </button>
            </div>

            <div class="mf-download-summary-new">
              <span>Continue your workflow</span>
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
