import { execFile, spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

/**
 * Retention policy for a captured stream. `onLine` always fires regardless of mode —
 * capture governs only what `RunResult` retains (P-01).
 */
export type CaptureMode = 'none' | 'tail' | 'full'

export interface CapturePolicy {
  /** Retention for RunResult.stdoutLines. Default 'tail'. */
  stdout?: CaptureMode
  /** Retention for RunResult.stderrLines. Default 'tail'. */
  stderr?: CaptureMode
  /** Lines retained per stream under 'tail'. Default 200. */
  tailLines?: number
  /**
   * Per-line character cap under 'tail'; longer lines are truncated with a trailing
   * ellipsis and `truncated` is set. Default 4096. Not applied under 'full', whose whole
   * purpose is an exact payload (a `-J` JSON document is one very long line) — 'full' is
   * bounded by `maxCaptureBytes` instead.
   */
  maxLineChars?: number
  /** Byte ceiling under 'full'. On overflow, capture stops and `truncated` is set. Default 64 MiB. */
  maxCaptureBytes?: number
}

export const DEFAULT_TAIL_LINES = 200
export const DEFAULT_MAX_LINE_CHARS = 4096
export const DEFAULT_MAX_CAPTURE_BYTES = 64 * 1024 * 1024

export interface RunResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdoutLines: string[]
  stderrLines: string[]
  timedOut: boolean
  /** True when a stream hit its byte ceiling or its tail dropped lines. */
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

export interface SpawnOptions {
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
  timeoutMs?: number
  capture?: CapturePolicy
}

export interface SpawnHandle {
  pid: number
  result: Promise<RunResult>
  killTree(): Promise<void>
}

interface ResolvedCapture {
  mode: CaptureMode
  tailLines: number
  maxLineChars: number
  maxCaptureBytes: number
}

function resolveCapture(policy: CapturePolicy | undefined, stream: 'stdout' | 'stderr'): ResolvedCapture {
  return {
    mode: policy?.[stream] ?? 'tail',
    tailLines: policy?.tailLines ?? DEFAULT_TAIL_LINES,
    maxLineChars: policy?.maxLineChars ?? DEFAULT_MAX_LINE_CHARS,
    maxCaptureBytes: policy?.maxCaptureBytes ?? DEFAULT_MAX_CAPTURE_BYTES
  }
}

/**
 * Splits a stream into lines and retains them per the capture policy. 'tail' uses a
 * fixed-capacity ring (O(1) per line — never front-splice); 'full' appends until a byte
 * ceiling; 'none' retains nothing. `onLine` always receives the untruncated line.
 */
class LineBuffer {
  private decoder = new StringDecoder('utf8')
  private pending = ''
  private ring: string[] = []
  private ringStart = 0
  private ringCount = 0
  private bytes = 0
  private overflowed = false

  constructor(
    private readonly policy: ResolvedCapture,
    private readonly onLine?: (line: string) => void
  ) {
    if (policy.mode === 'tail' && policy.tailLines > 0) {
      this.ring = new Array<string>(policy.tailLines)
    }
  }

  /** True when retention dropped lines (tail overwrite) or stopped (full overflow). */
  get truncated(): boolean {
    return this.overflowed
  }

  get lines(): string[] {
    if (this.policy.mode === 'none') return []
    if (this.policy.mode === 'full') return this.ring.slice(0, this.ringCount)
    const out: string[] = new Array<string>(this.ringCount)
    for (let i = 0; i < this.ringCount; i++) {
      out[i] = this.ring[(this.ringStart + i) % this.ring.length]
    }
    return out
  }

  push(chunk: Buffer): void {
    this.pending += this.decoder.write(chunk)
    let idx: number
    while ((idx = this.pending.indexOf('\n')) >= 0) {
      this.emit(this.strip(this.pending.slice(0, idx)))
      this.pending = this.pending.slice(idx + 1)
    }
  }

  end(): void {
    this.pending += this.decoder.end()
    this.emit(this.strip(this.pending))
    this.pending = ''
  }

  private emit(line: string | null): void {
    if (line === null) return
    this.retain(line)
    this.onLine?.(line)
  }

  private retain(line: string): void {
    const { mode, maxLineChars, maxCaptureBytes, tailLines } = this.policy
    if (mode === 'none') return
    if (mode === 'full') {
      if (this.overflowed) return
      this.bytes += Buffer.byteLength(line, 'utf8') + 1
      if (this.bytes > maxCaptureBytes) {
        this.overflowed = true
        return
      }
      this.ring[this.ringCount++] = line
      return
    }
    let stored = line
    if (stored.length > maxLineChars) {
      stored = `${stored.slice(0, maxLineChars)}…`
      this.overflowed = true
    }
    if (tailLines <= 0) {
      this.overflowed = true
      return
    }
    if (this.ringCount < tailLines) {
      this.ring[(this.ringStart + this.ringCount) % tailLines] = stored
      this.ringCount++
      return
    }
    this.ring[this.ringStart] = stored
    this.ringStart = (this.ringStart + 1) % tailLines
    this.overflowed = true
  }

  private strip(raw: string): string | null {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    return line.length > 0 ? line : null
  }
}

export function spawnProcess(binaryPath: string, args: string[], opts: SpawnOptions = {}): SpawnHandle {
  const out = new LineBuffer(resolveCapture(opts.capture, 'stdout'), opts.onStdoutLine)
  const err = new LineBuffer(resolveCapture(opts.capture, 'stderr'), opts.onStderrLine)

  const child = spawn(binaryPath, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

  child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
  child.stderr?.on('data', (chunk: Buffer) => err.push(chunk))

  let timedOut = false
  let timer: NodeJS.Timeout | undefined
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true
      void killTree(child.pid ?? -1)
    }, opts.timeoutMs)
    timer.unref?.()
  }

  const result = new Promise<RunResult>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code, signal) => {
      out.end()
      err.end()
      if (timer) clearTimeout(timer)
      resolve({
        code,
        signal,
        stdoutLines: out.lines,
        stderrLines: err.lines,
        timedOut,
        stdoutTruncated: out.truncated,
        stderrTruncated: err.truncated
      })
    })
  })

  const pid = child.pid
  if (typeof pid !== 'number') {
    return { pid: -1, result, killTree: () => Promise.resolve() }
  }

  return {
    pid,
    result,
    killTree: () => killTree(pid)
  }
}

export async function runCapture(binaryPath: string, args: string[], opts: SpawnOptions = {}): Promise<RunResult> {
  return spawnProcess(binaryPath, args, opts).result
}

export async function killTree(pid: number): Promise<void> {
  if (!Number.isFinite(pid) || pid <= 0) return
  if (process.platform === 'win32') {
    try {
      await execFileP('taskkill', ['/PID', String(pid), '/T', '/F'])
    } catch {
      return
    }
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      return
    }
  }
}
