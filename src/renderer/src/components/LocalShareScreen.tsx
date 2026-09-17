import { useEffect, useState } from 'preact/hooks'
import QRCode from 'qrcode'
import type {
  LocalShareActivity,
  LocalShareInfo,
  LocalShareTransfer,
} from '../../../shared/ipcContract'
import {
  ClipboardIcon,
  ClockIcon,
  FolderIcon,
  HardDriveIcon,
  RefreshIcon,
  ShareIcon,
  ShieldIcon,
  Spinner,
} from './icons'

function formatCountdown(seconds: number): string {
  const safeSeconds = Math.max(0, seconds)
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(
    safeSeconds % 60,
  ).padStart(2, '0')}`
}

const EMPTY_ACTIVITY: LocalShareActivity = {
  linksOpened: 0,
  activeConnections: 0,
  downloadsStarted: 0,
  completedDownloads: 0,
  transfers: [],
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length)
  return `${(bytes / 1024 ** power).toFixed(power > 1 ? 1 : 0)} ${units[power - 1]}`
}

function formatSpeed(speedBps: number): string {
  return speedBps > 0 ? `${formatBytes(speedBps)}/s` : 'Calculating speed'
}

function formatEta(etaSec: number | null): string {
  if (etaSec === null) return 'Estimating time'
  if (etaSec < 60) return `${etaSec}s left`
  return `${Math.floor(etaSec / 60)}m ${etaSec % 60}s left`
}

function statusLabel(status: LocalShareTransfer['status']): string {
  return status === 'downloading' ? 'Downloading' : status === 'completed' ? 'Complete' : 'Stopped'
}

export function LocalShareScreen() {
  const [share, setShare] = useState<LocalShareInfo | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const [renewed, setRenewed] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [activity, setActivity] = useState<LocalShareActivity>(EMPTY_ACTIVITY)
  const activeTransfer = activity.transfers.find((transfer) => transfer.status === 'downloading')
  const recentTransfers = activity.transfers.filter((transfer) => transfer !== activeTransfer)

  async function chooseFile() {
    setChoosing(true)
    setError(null)
    try {
      const result = await window.mf.pickLocalShareFile()
      if (result.kind === 'ok') {
        setShare(result.share)
        setCopied(false)
        setActivity(EMPTY_ACTIVITY)
      } else if (result.message !== 'No file was selected.') {
        setError(result.message)
      }
    } catch {
      setError('The file picker could not open. Try again.')
    } finally {
      setChoosing(false)
    }
  }

  async function stop() {
    await window.mf.stopLocalShare()
    setShare(null)
    setQrDataUrl(null)
    setCopied(false)
    setActivity(EMPTY_ACTIVITY)
  }

  async function copyLink() {
    if (!share) return
    try {
      await navigator.clipboard.writeText(share.url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
      setError('The link could not be copied. Select it and copy it manually.')
    }
  }

  async function renew() {
    setRenewing(true)
    setError(null)
    try {
      const result = await window.mf.renewLocalShare()
      if (result.kind === 'ok') {
        setShare(result.share)
        setRenewed(true)
        window.setTimeout(() => setRenewed(false), 1800)
      } else {
        setError(result.message)
      }
    } catch {
      setError('The sharing window could not be extended. Try again.')
    } finally {
      setRenewing(false)
    }
  }

  useEffect(() => {
    let disposed = false
    if (!share) return
    void QRCode.toDataURL(share.url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 440,
      color: { dark: '#10213c', light: '#fbfdff' },
    })
      .then((url) => {
        if (!disposed) setQrDataUrl(url)
      })
      .catch(() => {
        if (!disposed) setQrDataUrl(null)
      })
    return () => {
      disposed = true
    }
  }, [share])

  useEffect(() => {
    if (!share) return
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((share.expiresAt - Date.now()) / 1000))
      setRemainingSeconds(seconds)
      if (seconds === 0) {
        setShare(null)
        setError('This share link expired. Choose the file again to create a new link.')
        void window.mf.stopLocalShare()
      }
    }
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [share])

  useEffect(() => {
    let disposed = false
    const unsubscribe = window.mf.onLocalShareActivity(setActivity)
    void window.mf
      .getLocalShareStatus()
      .then((snapshot) => {
        if (disposed) return
        setShare(snapshot.share)
        setActivity(snapshot.activity)
      })
      .catch(() => {
        if (!disposed)
          setError('Local Share is unavailable right now. Reopen this screen to retry.')
      })
      .finally(() => {
        if (!disposed) setRestoring(false)
      })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  return (
    <main
      class={`mf-local-share-workspace mf-rise min-h-0 min-w-0 flex-1 p-4 sm:p-6 ${share ? 'is-sharing' : ''}`}
    >
      <section class={`mf-local-share-station ${share ? 'is-sharing' : ''}`}>
        <header class="mf-local-share-head">
          <div>
            <p>MEDIAFORGE DIRECT</p>
            <h1>{share ? 'Your handoff is live.' : 'One scan. The file is theirs.'}</h1>
            <span>
              {share
                ? 'Keep this window open while the other device downloads.'
                : 'Full-quality handoffs over your private Wi-Fi or LAN.'}
            </span>
          </div>
          <span class={`mf-local-share-status ${share ? 'is-live' : ''}`}>
            <i />
            {restoring ? 'Checking' : share ? 'Handoff live' : 'Ready'}
          </span>
        </header>

        {error && (
          <p class="mf-local-share-global-error" role="alert">
            {error}
          </p>
        )}

        {share ? (
          <div class="mf-local-share-live">
            <div class="mf-local-share-ticket">
              <div class="mf-local-share-tile-label">
                <span>01</span>
                <p>Scan to receive</p>
              </div>
              <div class="mf-local-share-qr">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="Scan this QR code to open the private download page" />
                ) : (
                  <Spinner />
                )}
              </div>
              <div class="mf-local-share-ticket-copy">
                <p>Open the camera on the receiving device</p>
                <span>No app or account needed</span>
              </div>
            </div>
            <div class="mf-local-share-control">
              <div class="mf-local-share-tile-label">
                <span>02</span>
                <p>Share details</p>
              </div>
              <h2 title={share.fileName}>{share.fileName}</h2>
              <div class="mf-local-share-file-facts">
                <span>
                  <HardDriveIcon class="size-3.5" /> {formatBytes(share.fileSize)}
                </span>
                <span>
                  <ShieldIcon class="size-3.5" /> Original quality
                </span>
              </div>
              <div class="mf-local-share-countdown" aria-live="polite">
                <strong>{formatCountdown(remainingSeconds)}</strong>
                <span>time remaining</span>
              </div>
              <div class="mf-local-share-timebar" aria-hidden="true">
                <i style={{ width: `${Math.min(100, (remainingSeconds / (15 * 60)) * 100)}%` }} />
              </div>
              <div class="mf-local-share-recipient-note">
                <ShieldIcon class="size-4" />
                <p>
                  The receiver gets one clear download button. The file never goes to the cloud.
                </p>
              </div>
              <div class="mf-local-share-link">
                <code class="mf-select-text" title={share.url}>
                  {share.url}
                </code>
                <button type="button" class="mf-focus-ring" onClick={() => void copyLink()}>
                  <ClipboardIcon class="size-3.5" />
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
              <div class="mf-local-share-live-actions">
                <button
                  type="button"
                  class="mf-focus-ring is-renew"
                  onClick={() => void renew()}
                  disabled={renewing}
                >
                  {renewing ? <Spinner class="size-4" /> : <RefreshIcon class="size-4" />}
                  {renewed ? '15 minutes added' : 'Keep live 15 min'}
                </button>
                <button
                  type="button"
                  class="mf-focus-ring"
                  onClick={() => void chooseFile()}
                  disabled={choosing}
                >
                  <FolderIcon class="size-4" />
                  Different file
                </button>
                <button type="button" class="mf-focus-ring" onClick={() => void stop()}>
                  Stop sharing
                </button>
              </div>
            </div>
            <section class="mf-local-share-receivers" aria-label="Nearby download activity">
              <header>
                <div>
                  <p>
                    <b>03</b> LIVE ACTIVITY
                  </p>
                  <h3>{activeTransfer ? 'File on the move.' : 'Ready for the next device.'}</h3>
                </div>
                <span class={activity.activeConnections > 0 ? 'is-active' : ''}>
                  <i />
                  {activity.linksOpened} link{activity.linksOpened === 1 ? '' : 's'} opened
                </span>
              </header>
              {activeTransfer ? (
                <div class="mf-local-share-now">
                  <div class="mf-local-share-now-number">
                    <strong>
                      {Math.round(
                        activeTransfer.totalBytes
                          ? (activeTransfer.bytesSent / activeTransfer.totalBytes) * 100
                          : 0,
                      )}
                    </strong>
                    <span>%</span>
                  </div>
                  <div class="mf-local-share-now-copy">
                    <p>NOW DOWNLOADING</p>
                    <h4>{activeTransfer.receiverLabel}</h4>
                    <span>
                      {formatBytes(activeTransfer.bytesSent)} of{' '}
                      {formatBytes(activeTransfer.totalBytes)}
                    </span>
                    <div
                      class="mf-local-share-now-progress"
                      role="progressbar"
                      aria-label={`${activeTransfer.receiverLabel} download progress`}
                      aria-valuenow={Math.round(
                        activeTransfer.totalBytes
                          ? (activeTransfer.bytesSent / activeTransfer.totalBytes) * 100
                          : 0,
                      )}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <i
                        style={{
                          width: `${
                            activeTransfer.totalBytes
                              ? Math.min(
                                  100,
                                  (activeTransfer.bytesSent / activeTransfer.totalBytes) * 100,
                                )
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                    <small>
                      {formatSpeed(activeTransfer.speedBps)} <b>·</b>{' '}
                      {formatEta(activeTransfer.etaSec)}
                    </small>
                  </div>
                </div>
              ) : (
                <div class="mf-local-share-empty-receivers">
                  <span aria-hidden="true">⌁</span>
                  <p>
                    {activity.completedDownloads
                      ? `${activity.completedDownloads} download${activity.completedDownloads === 1 ? '' : 's'} delivered.`
                      : 'Waiting for a nearby device to scan the code.'}
                  </p>
                  <small>Progress appears here while a file is moving.</small>
                </div>
              )}
              <footer class="mf-local-share-receivers-footer">
                <span>
                  <b>{activity.downloadsStarted}</b> started
                </span>
                <span>
                  <b>{activity.completedDownloads}</b> delivered
                </span>
                <span class={activity.activeConnections > 0 ? 'is-moving' : ''}>
                  <i /> {activity.activeConnections ? 'Transfer active' : 'No active transfer'}
                </span>
              </footer>
              {recentTransfers.length > 0 && (
                <ol class="mf-local-share-recent" aria-label="Recent transfers">
                  {recentTransfers.slice(0, 2).map((transfer) => (
                    <li key={transfer.id} class={`is-${transfer.status}`}>
                      <span>
                        <i /> {transfer.receiverLabel}
                      </span>
                      <small>{statusLabel(transfer.status)}</small>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        ) : (
          <div class="mf-local-share-idle">
            <div class="mf-local-share-signal" aria-hidden="true">
              <span class="mf-local-share-signal-ring ring-one" />
              <span class="mf-local-share-signal-ring ring-two" />
              <span class="mf-local-share-signal-ring ring-three" />
              <span class="mf-local-share-signal-core">
                <ShareIcon class="size-11" />
              </span>
            </div>
            <div class="mf-local-share-idle-copy">
              <p class="mf-local-share-kicker">YOUR NETWORK · YOUR FILE · YOUR RULES</p>
              <h2>Skip the upload. Hand it over.</h2>
              <p>
                Send full-quality media to a nearby phone or computer. The receiver scans once and
                downloads in their browser—no account, cable, or cloud storage.
              </p>
              <div class="mf-local-share-proof" aria-label="Local Share benefits">
                <span>
                  <ShieldIcon class="size-4" /> Nothing uploaded
                </span>
                <span>
                  <HardDriveIcon class="size-4" /> Original quality
                </span>
                <span>
                  <ClockIcon class="size-4" /> Expires in 15 min
                </span>
              </div>
              <button
                type="button"
                class="mf-focus-ring mf-local-share-start"
                onClick={() => void chooseFile()}
                disabled={choosing || restoring}
              >
                {choosing ? <Spinner class="size-4" /> : <FolderIcon class="size-4" />}
                {restoring
                  ? 'Checking for an active share…'
                  : choosing
                    ? 'Opening file picker…'
                    : 'Choose a file'}
              </button>
              <small class="mf-local-share-cta-note">Creates a private, 15-minute link.</small>
            </div>
            <div class="mf-local-share-steps" aria-label="How local sharing works">
              <p>THE WHOLE HANDOFF</p>
              <span>
                <b>01</b>
                <i>Pick</i>
                <small>Any media file on this computer</small>
              </span>
              <span>
                <b>02</b>
                <i>Scan</i>
                <small>With the receiver's phone or tablet</small>
              </span>
              <span>
                <b>03</b>
                <i>Deliver</i>
                <small>Directly, at original quality</small>
              </span>
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
