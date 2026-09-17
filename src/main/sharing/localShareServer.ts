import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { basename } from 'node:path'
import { networkInterfaces } from 'node:os'
import type {
  LocalShareActivity,
  LocalShareSnapshot,
  LocalShareTransfer,
} from '../../shared/ipcContract'

export const LOCAL_SHARE_TTL_MS = 15 * 60 * 1000

export interface LocalShare {
  url: string
  fileName: string
  fileSize: number
  expiresAt: number
}

export type LocalShareStartResult =
  { kind: 'ok'; share: LocalShare } | { kind: 'error'; message: string }

interface ActiveShare extends LocalShare {
  token: string
  filePath: string
}

interface Transfer extends LocalShareTransfer {
  remoteKey: string
  activeConnections: number
  finishTimer: NodeJS.Timeout | null
  lastSampleAt: number
  lastSampleBytes: number
  lastUpdatedAt: number
}

export interface LocalShareServerOptions {
  /** Dependency injection keeps the network choice and expiry deterministic in unit tests. */
  getHost?: () => string | null
  ttlMs?: number
  /** Activity is session-only and deliberately excludes IP addresses/device names. */
  onActivity?: (activity: LocalShareActivity) => void
}

/** Return an address reachable by nearby devices, never loopback or a public interface. */
export function findPrivateIpv4Address(): string | null {
  return selectPrivateIpv4Address(networkInterfaces())
}

/**
 * Node lists virtual adapters before the active Wi-Fi adapter on many Windows hosts. A Hyper-V,
 * WSL, Docker, or VPN address is private but cannot be reached by a nearby phone, so keep it out
 * of the sharing link and prefer the physical LAN interface instead.
 */
export function selectPrivateIpv4Address(
  interfaces: ReturnType<typeof networkInterfaces>,
): string | null {
  const candidates: Array<{ address: string; score: number }> = []
  for (const [name, entries] of Object.entries(interfaces)) {
    const score = interfaceScore(name)
    if (score === Number.NEGATIVE_INFINITY) continue
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || !isPrivateIpv4(entry.address)) continue
      candidates.push({ address: entry.address, score })
    }
  }
  candidates.sort((left, right) => right.score - left.score)
  return candidates[0]?.address ?? null
}

function interfaceScore(name: string): number {
  const normalized = name.toLowerCase()
  if (
    /virtual|vethernet|hyper-v|wsl|docker|vmware|virtualbox|vpn|pritunl|tap|tun/.test(normalized)
  ) {
    return Number.NEGATIVE_INFINITY
  }
  if (/wi-?fi|wlan|wireless/.test(normalized)) return 200
  if (/ethernet|^eth\d*$/.test(normalized)) return 100
  return 1
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) return false
  const [a, b] = octets
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

function safeAttachmentName(name: string): string {
  return name.replace(/[\r\n"\\]/g, '_').slice(0, 200) || 'mediaforge-download'
}

/**
 * Node rejects non-Latin-1 header values. Keep a conservative ASCII fallback for older clients
 * and provide the original filename using RFC 5987's percent-encoded UTF-8 form.
 */
function contentDisposition(name: string): string {
  const fallback =
    name
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '_')
      .trim() || 'mediaforge-download'
  const encoded = encodeURIComponent(name).replace(/'/g, '%27')
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

function contentType(name: string): string {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return (
    {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mkv': 'video/x-matroska',
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
      '.wav': 'audio/wav',
    }[ext] ?? 'application/octet-stream'
  )
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  )
}

function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length)
  return `${(bytes / 1024 ** power).toFixed(power > 1 ? 1 : 0)} ${units[power - 1]}`
}

interface ReceiverPage {
  html: string
  scriptNonce: string
}

/** A calm, self-contained receiver page makes an unfamiliar LAN address feel intentional. */
function receiverPage(share: ActiveShare): ReceiverPage {
  const fileName = escapeHtml(share.fileName)
  const downloadPath = `/share/${share.token}/download`
  const statusPath = `/share/${share.token}/status`
  const scriptNonce = Buffer.from(share.token).toString('base64')
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${fileName} · MediaForge</title>
  <style>
    :root{color-scheme:dark;--ink:#f7fbff;--muted:#9db0c7;--line:#29415f;--panel:#132944;--teal:#45d6c1;--blue:#5a84ff}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 72% 8%,#164b58 0,transparent 32%),linear-gradient(145deg,#091728,#102642);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
    main{width:min(100%,560px);overflow:hidden;border:1px solid var(--line);border-radius:28px;background:linear-gradient(145deg,rgba(19,41,68,.96),rgba(10,29,49,.96));box-shadow:0 28px 80px rgba(0,0,0,.38)}
    header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 24px;border-bottom:1px solid var(--line)}
    .brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.02em}.mark{display:grid;width:34px;height:34px;place-items:center;border-radius:11px;background:linear-gradient(135deg,var(--teal),var(--blue));color:#071827;font-size:18px}.live{display:flex;align-items:center;gap:7px;color:#a7f7e9;font-size:11px;font-weight:750;text-transform:uppercase;letter-spacing:.1em}.live i{width:7px;height:7px;border-radius:50%;background:var(--teal);box-shadow:0 0 0 5px rgba(69,214,193,.12)}
    .hero{padding:42px 32px 32px}.eyebrow{margin:0;color:var(--teal);font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}h1{margin:12px 0 0;font-size:clamp(30px,8vw,48px);line-height:1.02;letter-spacing:-.055em}p{color:var(--muted)}.file{margin:28px 0 0;padding:18px;border:1px solid var(--line);border-radius:16px;background:rgba(5,20,35,.42)}.file strong{display:block;overflow-wrap:anywhere;font-size:16px}.file span{display:block;margin-top:4px;color:var(--muted);font-size:12px}
    .download{display:flex;align-items:center;justify-content:center;gap:9px;margin-top:16px;padding:14px 18px;border-radius:13px;background:linear-gradient(135deg,var(--teal),#68a1ff);color:#071827;text-decoration:none;font-weight:850;box-shadow:0 12px 32px rgba(69,214,193,.18)}.download:hover{filter:brightness(1.08)}.download:focus-visible,.get:focus-visible{outline:3px solid #fff;outline-offset:3px}
    .transfer{margin-top:14px;padding:16px;border:1px solid rgba(69,214,193,.25);border-radius:14px;background:rgba(5,20,35,.5)}.transfer[hidden]{display:none}.transfer-top,.transfer-meta{display:flex;align-items:center;justify-content:space-between;gap:12px}.transfer-top span{font-size:12px;font-weight:800}.transfer-top strong{color:var(--teal);font-size:18px}.bar{height:9px;overflow:hidden;margin-top:12px;border-radius:99px;background:rgba(157,176,199,.15)}.bar i{display:block;width:0;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--teal),#68a1ff);box-shadow:0 0 16px rgba(69,214,193,.45);transition:width .25s linear}.transfer-meta{margin-top:9px;color:var(--muted);font-size:11px}.transfer.is-complete{border-color:rgba(69,214,193,.45);background:rgba(69,214,193,.09)}.transfer.is-interrupted{border-color:rgba(255,155,130,.4)}.transfer.is-interrupted .transfer-top strong{color:#ffab95}.transfer.is-interrupted .bar i{background:#ff8f73;box-shadow:none}
    .trust{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:22px}.trust span{padding:9px 7px;border:1px solid rgba(69,214,193,.16);border-radius:10px;color:#bdd0e2;background:rgba(69,214,193,.05);font-size:11px;text-align:center}
    footer{padding:20px 24px;border-top:1px solid var(--line);background:rgba(5,20,35,.28)}footer p{margin:0;font-size:12px}.get{display:inline-block;margin-top:8px;color:#b9fff3;font-size:12px;font-weight:800;text-underline-offset:3px}
    @media(max-width:480px){body{padding:12px}.hero{padding:32px 22px 24px}.trust{grid-template-columns:1fr}header{padding:17px 20px}}
  </style>
</head>
<body>
  <main>
    <header><div class="brand"><span class="mark">M</span> MediaForge</div><span class="live"><i></i><span id="handoff-state">Private handoff</span></span></header>
    <section class="hero">
      <p class="eyebrow" id="eyebrow">A nearby file is ready</p>
      <h1 id="headline">One tap. Original quality.</h1>
      <p id="description">This file travels directly from the sender's computer to this device. Nothing is uploaded to a cloud service.</p>
      <div class="file"><strong>${fileName}</strong><span>${humanFileSize(share.fileSize)}</span></div>
      <a class="download" id="download" href="${downloadPath}" download>Download original file&nbsp; ↓</a>
      <div class="transfer" id="transfer" hidden aria-live="polite">
        <div class="transfer-top"><span id="transfer-label">Starting private transfer…</span><strong id="transfer-percent">0%</strong></div>
        <div class="bar" role="progressbar" aria-label="Download progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="transfer-bar"></i></div>
        <div class="transfer-meta"><span id="transfer-bytes">Preparing file</span><span id="transfer-telemetry">Connecting locally</span></div>
      </div>
      <div class="trust"><span>No account</span><span>No compression</span><span>Same local network</span></div>
    </section>
    <footer><p>Want to send downloads this way? MediaForge is a private desktop toolkit for downloading, converting, and sharing media.</p><a class="get" href="https://github.com/prodipdatta7/yt-dlp-ffmpeg/releases/latest" rel="noreferrer">Get MediaForge for Windows →</a></footer>
  </main>
  <script nonce="${scriptNonce}">
    (function(){
      var download=document.getElementById('download');
      var transfer=document.getElementById('transfer');
      var label=document.getElementById('transfer-label');
      var percent=document.getElementById('transfer-percent');
      var bar=document.getElementById('transfer-bar');
      var progress=bar.parentElement;
      var bytes=document.getElementById('transfer-bytes');
      var telemetry=document.getElementById('transfer-telemetry');
      var headline=document.getElementById('headline');
      var eyebrow=document.getElementById('eyebrow');
      var description=document.getElementById('description');
      var handoffState=document.getElementById('handoff-state');
      var requested=false;
      var sawTransfer=false;
      function size(value){
        if(value<1024)return value+' B';
        var units=['KB','MB','GB','TB'];
        var power=Math.min(Math.floor(Math.log(value)/Math.log(1024)),units.length);
        return (value/Math.pow(1024,power)).toFixed(power>1?1:0)+' '+units[power-1];
      }
      function showStarting(){
        transfer.hidden=false;transfer.className='transfer';label.textContent='Starting private transfer…';percent.textContent='0%';bar.style.width='0%';progress.setAttribute('aria-valuenow','0');bytes.textContent='Preparing file';telemetry.textContent='Connecting locally';
      }
      function render(item){
        if(item.status==='waiting'){if(requested&&!sawTransfer)showStarting();return;}
        sawTransfer=true;transfer.hidden=false;
        var value=item.totalBytes?Math.min(100,Math.round(item.bytesSent/item.totalBytes*100)):0;
        percent.textContent=value+'%';bar.style.width=value+'%';progress.setAttribute('aria-valuenow',String(value));bytes.textContent=size(item.bytesSent)+' of '+size(item.totalBytes);
        if(item.status==='downloading'){
          transfer.className='transfer';label.textContent=value===100?'Finishing download…':'Downloading original file';telemetry.textContent=item.speedBps>0?size(item.speedBps)+'/s'+(item.etaSec===null?'':' · '+item.etaSec+'s left'):'Measuring local speed';download.textContent='Download in progress…';handoffState.textContent='File moving';
        }else if(item.status==='completed'){
          transfer.className='transfer is-complete';label.textContent='Download complete';percent.textContent='100%';bar.style.width='100%';progress.setAttribute('aria-valuenow','100');bytes.textContent=size(item.totalBytes)+' delivered';telemetry.textContent='Saved by your browser';eyebrow.textContent='Handoff complete';headline.textContent='Delivered. Full quality.';description.textContent='The complete file has reached this device directly from the sender.';download.textContent='Download again  ↓';handoffState.textContent='Delivered';
        }else{
          transfer.className='transfer is-interrupted';label.textContent='Transfer interrupted';telemetry.textContent='Keep both devices on the same network';headline.textContent='The handoff paused.';description.textContent='The connection ended before the file finished. Start the download again to resume the handoff.';download.textContent='Try download again  ↓';handoffState.textContent='Needs attention';
        }
      }
      async function poll(){
        try{var response=await fetch('${statusPath}',{cache:'no-store'});if(!response.ok)throw new Error();render(await response.json());}
        catch(error){if(requested){transfer.hidden=false;label.textContent='Checking connection…';telemetry.textContent='Waiting for the sender';}}
      }
      download.addEventListener('click',function(){requested=true;sawTransfer=false;showStarting();download.textContent='Starting download…';window.setTimeout(poll,100);});
      poll();window.setInterval(poll,450);
    })();
  </script>
</body>
</html>`
  return { html, scriptNonce }
}

function parseRange(
  rangeHeader: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!rangeHeader) return { start: 0, end: size - 1 }
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) return null
  const start = match[1] === '' ? 0 : Number(match[1])
  const end = match[2] === '' ? size - 1 : Number(match[2])
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  )
    return null
  return { start, end: Math.min(end, size - 1) }
}

/**
 * Serves exactly one verified output file from a private LAN address. The opaque token is a
 * capability: requests never carry a filesystem path, and starting another share revokes the
 * prior link immediately.
 */
export class LocalShareServer {
  private server: Server | null = null
  private active: ActiveShare | null = null
  private expiryTimer: NodeJS.Timeout | null = null
  private readonly getHost: () => string | null
  private readonly ttlMs: number
  private readonly onActivity?: (activity: LocalShareActivity) => void
  private readonly openResponses = new Set<ServerResponse>()
  private readonly transfers = new Map<string, Transfer>()
  private readonly receiverTransfers = new Map<string, string>()
  private readonly receiverLabels = new Map<string, string>()
  private readonly openedReceivers = new Set<string>()
  private linksOpened = 0
  private downloadsStarted = 0
  private completedDownloads = 0
  private transferSequence = 0
  private receiverSequence = 0
  private lastActivityEmitAt = 0

  constructor(options: LocalShareServerOptions = {}) {
    this.getHost = options.getHost ?? findPrivateIpv4Address
    this.ttlMs = options.ttlMs ?? LOCAL_SHARE_TTL_MS
    this.onActivity = options.onActivity
  }

  async start(filePath: string): Promise<LocalShareStartResult> {
    let fileStat: Awaited<ReturnType<typeof stat>>
    try {
      fileStat = await stat(filePath)
    } catch {
      return { kind: 'error', message: 'That completed file is no longer available.' }
    }
    if (!fileStat.isFile() || fileStat.size <= 0) {
      return { kind: 'error', message: 'Only a completed, non-empty file can be shared.' }
    }

    const host = this.getHost()
    if (!host) {
      return {
        kind: 'error',
        message: 'No private Wi-Fi or LAN connection was found. Connect to a local network first.',
      }
    }

    await this.stop()
    this.resetActivity()
    const token = randomBytes(32).toString('base64url')
    const fileName = safeAttachmentName(basename(filePath))
    const expiresAt = Date.now() + this.ttlMs
    this.active = {
      token,
      filePath,
      fileSize: fileStat.size,
      fileName,
      expiresAt,
      url: '',
    }

    this.server = createServer((request, response) => this.handleRequest(request, response))
    try {
      const port = await this.listen(this.server, host)
      this.active.url = `http://${host}:${port}/share/${token}`
      this.scheduleExpiry()
      this.emitActivity(true)
      return { kind: 'ok', share: this.publicShare(this.active) }
    } catch {
      await this.stop()
      return { kind: 'error', message: 'MediaForge could not start a local share on this network.' }
    }
  }

  getShare(): LocalShare | null {
    return this.active ? this.publicShare(this.active) : null
  }

  getSnapshot(): LocalShareSnapshot {
    return { share: this.getShare(), activity: this.activitySnapshot() }
  }

  renew(): LocalShareStartResult {
    if (!this.active) {
      return { kind: 'error', message: 'This sharing window has ended. Choose the file again.' }
    }
    this.active.expiresAt = Date.now() + this.ttlMs
    this.scheduleExpiry()
    return { kind: 'ok', share: this.publicShare(this.active) }
  }

  async stop(): Promise<void> {
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    this.expiryTimer = null
    this.active = null
    for (const response of this.openResponses) response.destroy()
    this.openResponses.clear()
    const server = this.server
    this.server = null
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    this.resetActivity()
    this.emitActivity(true)
  }

  private publicShare(share: ActiveShare): LocalShare {
    return {
      url: share.url,
      fileName: share.fileName,
      fileSize: share.fileSize,
      expiresAt: share.expiresAt,
    }
  }

  private scheduleExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    this.expiryTimer = setTimeout(() => void this.stop(), this.ttlMs)
    this.expiryTimer.unref()
  }

  private listen(server: Server, host: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const fail = (error: Error) => {
        server.removeListener('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.removeListener('error', fail)
        const address = server.address()
        if (!address || typeof address === 'string')
          return reject(new Error('Missing local share port'))
        resolve(address.port)
      }
      server.once('error', fail)
      server.once('listening', onListening)
      server.listen({ host, port: 0, exclusive: true })
    })
  }

  private handleRequest(request: IncomingMessage, response: ServerResponse): void {
    const active = this.active
    const url = new URL(request.url ?? '/', 'http://local.invalid')
    const pathParts = url.pathname.split('/').filter(Boolean)
    const receivedToken = pathParts[1] ?? ''
    const isLandingRequest = pathParts.length === 2
    const isDownloadRequest = pathParts.length === 3 && pathParts[2] === 'download'
    const isStatusRequest = pathParts.length === 3 && pathParts[2] === 'status'
    if (
      !active ||
      (request.method !== 'GET' && request.method !== 'HEAD') ||
      pathParts[0] !== 'share' ||
      !sameToken(receivedToken, active.token) ||
      (!isLandingRequest && !isDownloadRequest && !isStatusRequest)
    ) {
      response.writeHead(404, { 'Cache-Control': 'no-store' })
      response.end()
      return
    }

    if (isStatusRequest) {
      const body = JSON.stringify(this.receiverStatus(request, active.fileSize))
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body),
        'Content-Type': 'application/json; charset=utf-8',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end(request.method === 'HEAD' ? undefined : body)
      return
    }

    // A QR code is static and cannot report a camera scan. Its browser navigation can: record
    // that first touch, then offer an explicit download from a trustworthy receiver page.
    if (isLandingRequest) {
      if (request.method === 'GET') this.recordLinkOpen(request)
      const { html, scriptNonce } = receiverPage(active)
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(html),
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${scriptNonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-Robots-Tag': 'noindex, nofollow',
      })
      response.end(request.method === 'HEAD' ? undefined : html)
      return
    }

    const range = parseRange(request.headers.range, active.fileSize)
    if (!range) {
      response.writeHead(416, {
        'Content-Range': `bytes */${active.fileSize}`,
        'Cache-Control': 'no-store',
      })
      response.end()
      return
    }

    const partial = range.start !== 0 || range.end !== active.fileSize - 1
    const length = range.end - range.start + 1
    response.writeHead(partial ? 206 : 200, {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Disposition': contentDisposition(active.fileName),
      'Content-Length': length,
      'Content-Type': contentType(active.fileName),
      'Content-Security-Policy': "default-src 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      ...(partial
        ? { 'Content-Range': `bytes ${range.start}-${range.end}/${active.fileSize}` }
        : {}),
    })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    const { transfer, started } = this.beginTransfer(request, active.fileSize)
    if (started) this.downloadsStarted += 1
    this.openResponses.add(response)
    this.emitActivity(true)

    const stream = createReadStream(active.filePath, { start: range.start, end: range.end })
    let settled = false
    const settle = (status: 'completed' | 'interrupted'): void => {
      if (settled) return
      settled = true
      this.openResponses.delete(response)
      transfer.lastUpdatedAt = Date.now()
      transfer.activeConnections = Math.max(0, transfer.activeConnections - 1)
      if (status === 'interrupted') transfer.status = 'interrupted'
      if (transfer.activeConnections === 0) this.scheduleTransferFinish(transfer)
      this.emitActivity(true)
    }
    stream.on('data', (chunk: Buffer) => this.recordChunk(transfer, chunk.length))
    stream.once('error', () => {
      settle('interrupted')
      response.destroy()
    })
    response.once('finish', () => settle('completed'))
    response.once('close', () => {
      if (!response.writableEnded) {
        stream.destroy()
        settle('interrupted')
      }
    })
    stream.pipe(response)
  }

  private resetActivity(): void {
    for (const transfer of this.transfers.values()) {
      if (transfer.finishTimer) clearTimeout(transfer.finishTimer)
    }
    this.transfers.clear()
    this.receiverTransfers.clear()
    this.receiverLabels.clear()
    this.openedReceivers.clear()
    this.linksOpened = 0
    this.downloadsStarted = 0
    this.completedDownloads = 0
    this.transferSequence = 0
    this.receiverSequence = 0
    this.lastActivityEmitAt = 0
  }

  private beginTransfer(
    request: IncomingMessage,
    totalBytes: number,
  ): { transfer: Transfer; started: boolean } {
    const { remoteKey, receiverLabel } = this.receiverFor(request)
    const currentId = this.receiverTransfers.get(remoteKey)
    const current = currentId ? this.transfers.get(currentId) : undefined
    if (
      current &&
      (current.status === 'downloading' || Date.now() - current.lastUpdatedAt < 12_000)
    ) {
      if (current.finishTimer) clearTimeout(current.finishTimer)
      current.finishTimer = null
      current.activeConnections += 1
      current.status = 'downloading'
      current.lastUpdatedAt = Date.now()
      return { transfer: current, started: false }
    }
    const now = Date.now()
    const transfer: Transfer = {
      id: `transfer-${String(++this.transferSequence).padStart(2, '0')}`,
      receiverLabel,
      status: 'downloading',
      bytesSent: 0,
      totalBytes,
      speedBps: 0,
      etaSec: null,
      remoteKey,
      activeConnections: 1,
      finishTimer: null,
      lastSampleAt: now,
      lastSampleBytes: 0,
      lastUpdatedAt: now,
    }
    this.transfers.set(transfer.id, transfer)
    this.receiverTransfers.set(remoteKey, transfer.id)
    this.pruneTransfers()
    return { transfer, started: true }
  }

  private recordLinkOpen(request: IncomingMessage): void {
    const { remoteKey } = this.receiverFor(request)
    if (this.openedReceivers.has(remoteKey)) return
    this.openedReceivers.add(remoteKey)
    this.linksOpened += 1
    this.receiverTransfers.delete(remoteKey)
    this.emitActivity(true)
  }

  private scheduleTransferFinish(transfer: Transfer): void {
    if (transfer.finishTimer) clearTimeout(transfer.finishTimer)
    transfer.finishTimer = setTimeout(() => {
      transfer.finishTimer = null
      if (transfer.activeConnections > 0) return
      transfer.status = transfer.bytesSent >= transfer.totalBytes ? 'completed' : 'interrupted'
      if (transfer.status === 'completed') this.completedDownloads += 1
      transfer.lastUpdatedAt = Date.now()
      this.pruneTransfers()
      this.emitActivity(true)
    }, 1_500)
    transfer.finishTimer.unref()
  }

  private receiverFor(request: IncomingMessage): { remoteKey: string; receiverLabel: string } {
    const remoteKey = request.socket.remoteAddress ?? `connection-${request.socket.remotePort ?? 0}`
    let receiverLabel = this.receiverLabels.get(remoteKey)
    if (!receiverLabel) {
      receiverLabel = `Nearby device ${String(++this.receiverSequence).padStart(2, '0')}`
      this.receiverLabels.set(remoteKey, receiverLabel)
    }
    return { remoteKey, receiverLabel }
  }

  private receiverStatus(
    request: IncomingMessage,
    totalBytes: number,
  ): Pick<LocalShareTransfer, 'bytesSent' | 'totalBytes' | 'speedBps' | 'etaSec'> & {
    status: LocalShareTransfer['status'] | 'waiting'
  } {
    const remoteKey = request.socket.remoteAddress ?? `connection-${request.socket.remotePort ?? 0}`
    const transferId = this.receiverTransfers.get(remoteKey)
    const transfer = transferId ? this.transfers.get(transferId) : undefined
    if (!transfer) {
      return { status: 'waiting', bytesSent: 0, totalBytes, speedBps: 0, etaSec: null }
    }
    return {
      status: transfer.status,
      bytesSent: transfer.bytesSent,
      totalBytes: transfer.totalBytes,
      speedBps: transfer.speedBps,
      etaSec: transfer.etaSec,
    }
  }

  private recordChunk(transfer: Transfer, bytes: number): void {
    transfer.bytesSent = Math.min(transfer.totalBytes, transfer.bytesSent + bytes)
    const now = Date.now()
    const elapsedMs = now - transfer.lastSampleAt
    if (elapsedMs >= 80) {
      const sampledSpeed = ((transfer.bytesSent - transfer.lastSampleBytes) * 1000) / elapsedMs
      transfer.speedBps =
        transfer.speedBps === 0 ? sampledSpeed : transfer.speedBps * 0.65 + sampledSpeed * 0.35
      transfer.etaSec =
        transfer.speedBps > 0
          ? Math.max(0, Math.ceil((transfer.totalBytes - transfer.bytesSent) / transfer.speedBps))
          : null
      transfer.lastSampleAt = now
      transfer.lastSampleBytes = transfer.bytesSent
    }
    transfer.lastUpdatedAt = now
    this.emitActivity(false)
  }

  /** Keep all active streams and a short useful tail of the most recent finished transfers. */
  private pruneTransfers(): void {
    const finished = [...this.transfers.values()]
      .filter((transfer) => transfer.status !== 'downloading')
      .sort((left, right) => left.lastUpdatedAt - right.lastUpdatedAt)
    while (this.transfers.size > 12 && finished.length) {
      const oldest = finished.shift()
      if (oldest) this.transfers.delete(oldest.id)
    }
  }

  private emitActivity(force: boolean): void {
    if (!this.onActivity) return
    const now = Date.now()
    if (!force && now - this.lastActivityEmitAt < 150) return
    this.lastActivityEmitAt = now
    this.onActivity(this.activitySnapshot())
  }

  private activitySnapshot(): LocalShareActivity {
    const transfers = [...this.transfers.values()]
      .sort((left, right) => right.lastUpdatedAt - left.lastUpdatedAt)
      .map(
        ({
          remoteKey: _remoteKey,
          activeConnections: _activeConnections,
          finishTimer: _finishTimer,
          lastSampleAt: _lastSampleAt,
          lastSampleBytes: _lastSampleBytes,
          lastUpdatedAt: _lastUpdatedAt,
          ...transfer
        }) => transfer,
      )
    return {
      linksOpened: this.linksOpened,
      activeConnections: transfers.filter((transfer) => transfer.status === 'downloading').length,
      downloadsStarted: this.downloadsStarted,
      completedDownloads: this.completedDownloads,
      transfers,
    }
  }
}

function sameToken(received: string, expected: string): boolean {
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}
