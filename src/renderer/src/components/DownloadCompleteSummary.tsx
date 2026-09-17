import { useEffect, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import QRCode from 'qrcode'
import type { AnalyzeResult } from '../../../shared/models'
import type {
  JobDonePayload,
  LocalShareActivity,
  LocalShareInfo,
} from '../../../shared/ipcContract'
import { fmtDuration, fmtSize } from '../utils/format'
import { VideoBanner } from './PreviewPanel'
import {
  CheckIcon,
  ClipboardIcon,
  DownloadIcon,
  FolderIcon,
  LinkIcon,
  PlayIcon,
  ShareIcon,
} from './icons'

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

function formatShareCountdown(seconds: number): string {
  const safeSeconds = Math.max(0, seconds)
  const minutes = Math.floor(safeSeconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`
}

const EMPTY_SHARE_ACTIVITY: LocalShareActivity = {
  linksOpened: 0,
  activeConnections: 0,
  downloadsStarted: 0,
  completedDownloads: 0,
  transfers: [],
}

function formatShareSpeed(bytesPerSecond: number): string {
  return bytesPerSecond > 0 ? `${fmtSize(bytesPerSecond)}/s` : 'Calculating speed'
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
  const [share, setShare] = useState<LocalShareInfo | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [shareLinkCopied, setShareLinkCopied] = useState(false)
  const [shareQrDataUrl, setShareQrDataUrl] = useState<string | null>(null)
  const [shareSheetOpen, setShareSheetOpen] = useState(false)
  const [shareSecondsRemaining, setShareSecondsRemaining] = useState(0)
  const [shareActivity, setShareActivity] = useState<LocalShareActivity>(EMPTY_SHARE_ACTIVITY)
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

  async function startShare() {
    if (!outputPath) return
    setShareError(null)
    const result = await window.mf.startLocalShare(outputPath)
    if (result.kind === 'ok') {
      setShare(result.share)
      setShareActivity(EMPTY_SHARE_ACTIVITY)
      setShareSheetOpen(true)
    } else {
      setShare(null)
      setShareError(result.message)
    }
  }

  async function stopShare() {
    await window.mf.stopLocalShare()
    setShare(null)
    setShareError(null)
    setShareLinkCopied(false)
    setShareActivity(EMPTY_SHARE_ACTIVITY)
    setShareSheetOpen(false)
  }

  async function copyShareLink() {
    if (!share) return
    try {
      await navigator.clipboard.writeText(share.url)
      setShareLinkCopied(true)
      window.setTimeout(() => setShareLinkCopied(false), 1800)
    } catch {
      setShareLinkCopied(false)
    }
  }

  useEffect(() => {
    return window.mf.onLocalShareActivity(setShareActivity)
  }, [])

  useEffect(() => {
    let disposed = false
    if (!share) {
      setShareQrDataUrl(null)
      return
    }
    void QRCode.toDataURL(share.url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
      color: { dark: '#12213d', light: '#f8fbff' },
    })
      .then((dataUrl) => {
        if (!disposed) setShareQrDataUrl(dataUrl)
      })
      .catch(() => {
        if (!disposed) setShareQrDataUrl(null)
      })
    return () => {
      disposed = true
    }
  }, [share])

  useEffect(() => {
    if (!share) {
      setShareSecondsRemaining(0)
      return
    }
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((share.expiresAt - Date.now()) / 1000))
      setShareSecondsRemaining(remaining)
      if (remaining === 0) {
        setShare(null)
        setShareSheetOpen(false)
        setShareError('This sharing link expired. Start a new share to create another one.')
        void window.mf.stopLocalShare()
      }
    }
    updateCountdown()
    const timer = window.setInterval(updateCountdown, 250)
    return () => window.clearInterval(timer)
  }, [share])

  useEffect(() => {
    if (!shareSheetOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShareSheetOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shareSheetOpen])

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
                onClick={() => void (share ? setShareSheetOpen(true) : startShare())}
                class="mf-focus-ring mf-download-summary-share"
                title={
                  share
                    ? 'Show the QR code and sharing controls'
                    : 'Share this file with another device on your Wi-Fi or LAN'
                }
              >
                <ShareIcon class="size-4" />
                {share ? 'Show QR code' : 'Share wirelessly'}
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

            {shareError && <p class="mf-download-summary-share-error">{shareError}</p>}

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
      {share &&
        shareSheetOpen &&
        createPortal(
          <div
            class="mf-share-sheet-backdrop"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) setShareSheetOpen(false)
            }}
          >
            <section
              class="mf-share-sheet mf-rise"
              role="dialog"
              aria-modal="true"
              aria-labelledby="local-share-title"
            >
              <header>
                <div>
                  <p>PRIVATE LOCAL TRANSFER</p>
                  <h2 id="local-share-title">Scan to download</h2>
                  <span>Keep this window open while the other device downloads your file.</span>
                </div>
                <button
                  type="button"
                  class="mf-focus-ring"
                  onClick={() => setShareSheetOpen(false)}
                  aria-label="Close share sheet"
                  title="Close"
                >
                  ×
                </button>
              </header>
              <div class="mf-share-sheet-body">
                <div class="mf-share-sheet-qr-wrap">
                  {shareQrDataUrl ? (
                    <img
                      src={shareQrDataUrl}
                      alt="QR code for the temporary nearby-device download link"
                    />
                  ) : (
                    <span>Preparing secure code…</span>
                  )}
                </div>
                <div class="mf-share-sheet-instructions">
                  <h3>{fileName(share.fileName)}</h3>
                  <ol>
                    <li>Open your camera or QR scanner on the receiving device.</li>
                    <li>Scan this code, then download the file in its browser.</li>
                  </ol>
                  <p>Both devices must be connected to the same Wi-Fi or local network.</p>
                </div>
              </div>
              <section class="mf-share-sheet-activity" aria-label="Live nearby download activity">
                <header>
                  <span>
                    <i class={shareActivity.activeConnections > 0 ? 'is-active' : ''} />
                    {shareActivity.activeConnections > 0
                      ? `${shareActivity.activeConnections} downloading now`
                      : 'Waiting for a scan'}
                  </span>
                  <small>
                    {shareActivity.linksOpened} opened · {shareActivity.completedDownloads} complete
                  </small>
                </header>
                {shareActivity.transfers.length ? (
                  <ol>
                    {shareActivity.transfers.map((transfer) => {
                      const percent = transfer.totalBytes
                        ? Math.min(100, (transfer.bytesSent / transfer.totalBytes) * 100)
                        : 0
                      return (
                        <li key={transfer.id} class={`is-${transfer.status}`}>
                          <div>
                            <span>
                              {transfer.receiverLabel} · Download {transfer.id.slice(-2)}
                            </span>
                            <b>{Math.round(percent)}%</b>
                          </div>
                          <span class="mf-share-sheet-activity-bar">
                            <i style={{ width: `${percent}%` }} />
                          </span>
                          <small>
                            {fmtSize(transfer.bytesSent)} / {fmtSize(transfer.totalBytes)} ·{' '}
                            {formatShareSpeed(transfer.speedBps)}
                          </small>
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <p>Open the link on a nearby device and its download will appear here.</p>
                )}
              </section>
              <div class="mf-share-sheet-link">
                <code class="mf-select-text" title={share.url}>
                  {share.url}
                </code>
                <button type="button" class="mf-focus-ring" onClick={() => void copyShareLink()}>
                  <ClipboardIcon class="size-3.5" />
                  {shareLinkCopied ? 'Link copied' : 'Copy link'}
                </button>
              </div>
              <footer>
                <span class="mf-share-sheet-countdown" aria-live="polite">
                  <strong>{formatShareCountdown(shareSecondsRemaining)}</strong>
                  <small>time remaining</small>
                </span>
                <button type="button" class="mf-focus-ring" onClick={() => void stopShare()}>
                  Stop sharing
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </section>
  )
}
