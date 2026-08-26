import { execFile, spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

export interface RunResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdoutLines: string[]
  stderrLines: string[]
  timedOut: boolean
}

export interface SpawnOptions {
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
  timeoutMs?: number
}

export interface SpawnHandle {
  pid: number
  result: Promise<RunResult>
  killTree(): Promise<void>
}

class LineBuffer {
  private decoder = new StringDecoder('utf8')
  private pending = ''
  readonly lines: string[] = []

  constructor(private readonly onLine?: (line: string) => void) {}

  push(chunk: Buffer): void {
    this.pending += this.decoder.write(chunk)
    let idx: number
    while ((idx = this.pending.indexOf('\n')) >= 0) {
      const line = this.strip(this.pending.slice(0, idx))
      if (line !== null) {
        this.lines.push(line)
        this.onLine?.(line)
      }
      this.pending = this.pending.slice(idx + 1)
    }
  }

  end(): void {
    this.pending += this.decoder.end()
    const line = this.strip(this.pending)
    if (line !== null) {
      this.lines.push(line)
      this.onLine?.(line)
    }
    this.pending = ''
  }

  private strip(raw: string): string | null {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    return line.length > 0 ? line : null
  }
}

export function spawnProcess(binaryPath: string, args: string[], opts: SpawnOptions = {}): SpawnHandle {
  const out = new LineBuffer(opts.onStdoutLine)
  const err = new LineBuffer(opts.onStderrLine)

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
      resolve({ code, signal, stdoutLines: out.lines, stderrLines: err.lines, timedOut })
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
