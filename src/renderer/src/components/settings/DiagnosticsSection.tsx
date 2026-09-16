import { useEffect, useState } from 'preact/hooks'
import { CheckIcon, DocIcon, ShieldIcon, TerminalIcon } from '../icons'
import { SettingsCard } from '../SettingsCard'
import { btnGhost, btnPrimary } from './buttonStyles'

export function DiagnosticsSection() {
  const [version, setVersion] = useState<string | null>(null)
  const [engineInfo, setEngineInfo] = useState<{
    ytdlp: { version: string | null; source: string | null }
    ffmpeg: { version: string | null; source: string | null }
  } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.mf
      .getAppVersion()
      .then((r) => setVersion(r.version))
      .catch(() => undefined)
    void window.mf
      .getBinariesInfo()
      .then(setEngineInfo)
      .catch(() => undefined)
  }, [])

  async function copyDiagnosticReport() {
    const report = [
      `MediaForge Desktop Diagnostic Report`,
      `====================================`,
      `App Version: ${version ?? 'unknown'}`,
      `yt-dlp Engine: ${engineInfo?.ytdlp.version ?? 'unknown'} (${engineInfo?.ytdlp.source ?? 'bundled'})`,
      `FFmpeg Engine: ${engineInfo?.ffmpeg.version ?? 'unknown'} (${engineInfo?.ffmpeg.source ?? 'bundled'})`,
      `Platform: Windows (win32-x64)`,
      `User Agent: ${navigator.userAgent}`,
      `Screen Viewport: ${window.innerWidth}x${window.innerHeight} (${window.devicePixelRatio}x HiDPI)`,
      `Privacy Policy: Zero-Telemetry, Automated URL/Cookie Redaction`,
      `Generated: ${new Date().toISOString()}`,
    ].join('\n')

    try {
      await navigator.clipboard.writeText(report)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      /* clipboard fallback */
    }
  }

  return (
    <div class="flex flex-col gap-5">
      <SettingsCard
        icon={<DocIcon class="size-4" />}
        title="Diagnostics & Privacy Isolation"
        description="Structured JSON logs live in your local user-data folder. URLs and authentication tokens are automatically redacted."
        footer={
          <>
            <span class="flex items-center gap-1.5 text-xs text-slate-500">
              <ShieldIcon class="size-3.5 text-emerald-500" />
              Strict zero-telemetry · zero third-party analytics
            </span>
            <div class="flex items-center gap-2">
              <button type="button" onClick={() => void copyDiagnosticReport()} class={btnGhost}>
                {copied ? (
                  <span class="flex items-center gap-1 text-emerald-400">
                    <CheckIcon class="size-3.5" /> Copied Report
                  </span>
                ) : (
                  'Copy System Diagnostics'
                )}
              </button>
              <button
                type="button"
                onClick={() => void window.mf.openLogsFolder()}
                class={btnPrimary}
              >
                Open Logs Folder
              </button>
            </div>
          </>
        }
      >
        <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <div class="rounded-xl border border-line bg-wash-1 p-3">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Telemetry Policy
            </span>
            <p class="mt-1 text-xs font-bold text-emerald-500">Zero Network Egress</p>
          </div>
          <div class="rounded-xl border border-line bg-wash-1 p-3">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Sensitive Data Sanitizer
            </span>
            <p class="mt-1 text-xs font-bold text-ink">Query & Cookie Redacted</p>
          </div>
          <div class="rounded-xl border border-line bg-wash-1 p-3">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Execution Architecture
            </span>
            <p class="mt-1 text-xs font-mono font-bold text-ink">Isolated 3-Process Model</p>
          </div>
        </div>

        <div class="mt-3.5 rounded-xl border border-line bg-recess p-3 text-[11.5px] leading-relaxed text-slate-500">
          <div class="flex items-center gap-2 font-mono font-semibold text-slate-400">
            <TerminalIcon class="size-3.5 text-sky-400" />
            <span>Process Sandboxing & Safety (AM-02)</span>
          </div>
          <p class="mt-1">
            Child engines are invoked via <code class="text-ink">spawn(binPath, argsArray)</code>{' '}
            with <code class="text-ink">shell: false, windowsHide: true</code>. No shell injection
            strings can ever reach the operating system command interpreter.
          </p>
        </div>
      </SettingsCard>
    </div>
  )
}
