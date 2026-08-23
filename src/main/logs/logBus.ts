import { redactUrls } from '../store/logger'
import type { LogEntryPayload } from '../../shared/ipcContract'

const MAX_ENTRIES = 2000

type Sink = (entry: LogEntryPayload) => void

/**
 * In-memory tail of raw CLI output from yt-dlp child processes (the same lines
 * a terminal would show), broadcast live to the renderer's console view.
 * URL query strings are redacted before anything is stored or emitted.
 */
export class LogBus {
  private readonly entries: LogEntryPayload[] = []
  private readonly sinks = new Set<Sink>()

  push(
    source: LogEntryPayload['source'],
    stream: LogEntryPayload['stream'],
    rawText: string,
  ): void {
    const text = redactUrls(rawText).trimEnd()
    if (text.length === 0) return
    const entry: LogEntryPayload = { ts: Date.now(), source, stream, text }
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES)
    }
    for (const sink of this.sinks) sink(entry)
  }

  tap(
    source: LogEntryPayload['source'],
  ): (line: string, stream: LogEntryPayload['stream']) => void {
    return (line, stream) => this.push(source, stream, line)
  }

  tail(max = 1000): LogEntryPayload[] {
    return this.entries.slice(-max)
  }

  clear(): void {
    this.entries.length = 0
  }

  subscribe(sink: Sink): () => void {
    this.sinks.add(sink)
    return () => this.sinks.delete(sink)
  }
}
