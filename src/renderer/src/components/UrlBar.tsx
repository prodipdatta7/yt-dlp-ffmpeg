import { useState } from 'preact/hooks'
import { analyzing, analysis, analyzeError, resetAnalysis } from '../signals/appState'
import { settingsOpen } from '../signals/uiState'

const URL_PATTERN = /^https?:\/\/\S+$/i

function LinkIcon() {
  return (
    <svg
      class="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

function Spinner({ className = 'size-4' }: { className?: string }) {
  return (
    <svg class={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  )
}

export function UrlBar() {
  const [value, setValue] = useState('')
  const invalid = value.length > 0 && !URL_PATTERN.test(value.trim())

  async function submit() {
    const url = value.trim()
    if (!url || analyzing.value) return
    resetAnalysis()
    analyzing.value = true
    try {
      const response = await window.mf.analyzeStart(url)
      if (response.kind === 'ok') analysis.value = response.result
      else analyzeError.value = { code: response.code, message: response.message }
    } catch {
      analyzeError.value = { code: 'MF_UNKNOWN', message: 'Unexpected IPC failure.' }
    } finally {
      analyzing.value = false
    }
  }

  function cancel() {
    void window.mf.analyzeCancel()
  }

  return (
    <div class="flex w-full max-w-2xl flex-col gap-2">
      <div class="flex flex-col gap-2 sm:flex-row">
        <div class="relative flex-1">
          <LinkIcon />
          <input
            type="url"
            placeholder="Paste a video, audio or playlist link…"
            value={value}
            onInput={(e) => setValue((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            disabled={analyzing.value}
            class={`w-full rounded-xl border bg-slate-900/70 py-3 pl-10 pr-4 text-sm text-slate-100 outline-none transition-all duration-150 placeholder:text-slate-600 focus:bg-slate-900 disabled:opacity-60 ${
              invalid
                ? 'border-rose-500/60 shadow-[0_0_0_4px_rgb(244_63_94/0.10)]'
                : 'border-slate-700/60 focus:border-sky-500/60 focus:shadow-[0_0_0_4px_rgb(56_189_248/0.12)]'
            }`}
          />
        </div>

        {analyzing.value ? (
          <button
            onClick={cancel}
            class="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-600 px-5 py-3 text-sm font-medium text-slate-300 transition hover:border-rose-500/60 hover:text-rose-300 active:scale-[0.98]"
          >
            <Spinner />
            Cancel
          </button>
        ) : (
          <button
            onClick={() => void submit()}
            disabled={invalid || value.trim().length === 0}
            class="mf-focus-ring inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/25 transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            Analyze
            <svg
              viewBox="0 0 24 24"
              class="size-4"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </button>
        )}
      </div>

      {invalid && (
        <p class="text-xs text-rose-400">Enter a full link starting with http:// or https://</p>
      )}

      {analyzeError.value && (
        <div class="flex items-center justify-between gap-3 rounded-xl border-l-4 border-rose-500/80 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          <span>{analyzeError.value.message}</span>
          <span class="flex shrink-0 gap-2">
            {(analyzeError.value.code === 'MF_AGE_RESTRICTED' ||
              analyzeError.value.code === 'MF_BOT_CHECK') && (
              <button
                onClick={() => void window.mf.importCookies()}
                class="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
              >
                Import cookies.txt…
              </button>
            )}
            {analyzeError.value.code === 'MF_EXTRACTOR_STALE' && (
              <button
                onClick={() => (settingsOpen.value = true)}
                class="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
              >
                Update Core Drivers…
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  )
}

export { Spinner }
