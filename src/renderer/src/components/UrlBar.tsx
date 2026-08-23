import { useState } from 'preact/hooks'
import { analyzing, analysis, analyzeError, resetAnalysis } from '../signals/appState'
import { openSettings } from '../signals/uiState'
import {
  AlertIcon,
  ArrowRightIcon,
  CloseIcon,
  CookieIcon,
  LinkIcon,
  RefreshIcon,
  Spinner,
} from './icons'

const URL_PATTERN = /^https?:\/\/\S+$/i

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
    <div class="flex flex-col gap-2">
      <div class="mf-card mf-hairline flex items-stretch gap-1.5 rounded-xl p-1.5 pl-3.5">
        <span class="pointer-events-none flex items-center">
          <LinkIcon class="size-4 text-slate-500" />
        </span>
        <input
          type="url"
          spellcheck={false}
          placeholder="Paste a video, audio or playlist link…"
          value={value}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          disabled={analyzing.value}
          aria-invalid={invalid}
          class={`min-w-0 flex-1 bg-transparent py-1.5 pr-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 disabled:opacity-60 ${
            invalid ? 'text-rose-300' : ''
          }`}
        />
        {invalid && (
          <span class="pointer-events-none flex items-center text-[11px] font-medium text-rose-400">
            must start with https://
          </span>
        )}
        {value.length > 0 && (
          <button
            onClick={() => setValue('')}
            title="Clear"
            aria-label="Clear input"
            class="mf-focus-ring my-auto flex size-7 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-200"
          >
            <CloseIcon class="size-3.5" />
          </button>
        )}
        {analyzing.value ? (
          <button
            onClick={cancel}
            class="inline-flex shrink-0 items-center gap-2 rounded-lg border border-white/[0.1] px-3.5 text-xs font-medium text-slate-300 transition hover:border-rose-500/50 hover:text-rose-300 active:scale-[0.98]"
          >
            <Spinner class="size-3.5" />
            Cancel
          </button>
        ) : (
          <button
            onClick={() => void submit()}
            disabled={invalid || value.trim().length === 0}
            className={`mf-focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-500 px-4 text-xs font-semibold text-white shadow-lg shadow-sky-500/25 transition-all duration-150 hover:brightness-110 active:scale-[0.98] ${
              invalid || value.trim().length === 0
                ? 'cursor-not-allowed opacity-40 shadow-none'
                : ''
            }`}
          >
            Analyze
            <ArrowRightIcon class="size-3.5" />
          </button>
        )}
      </div>

      {analyzeError.value && (
        <div class="flex items-start justify-between gap-4 rounded-xl border border-rose-500/25 bg-rose-950/40 px-3.5 py-2.5">
          <div class="flex min-w-0 items-start gap-2.5">
            <AlertIcon class="mt-0.5 size-3.5 shrink-0 text-rose-400" />
            <p class="text-xs leading-relaxed text-rose-200">{analyzeError.value.message}</p>
          </div>
          <span class="flex shrink-0 gap-2">
            {(analyzeError.value.code === 'MF_AGE_RESTRICTED' ||
              analyzeError.value.code === 'MF_BOT_CHECK') && (
              <button
                onClick={() => void window.mf.importCookies()}
                class="mf-focus-ring inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-sky-500"
              >
                <CookieIcon class="size-3" />
                Import cookies.txt…
              </button>
            )}
            {analyzeError.value.code === 'MF_EXTRACTOR_STALE' && (
              <button
                onClick={openSettings}
                class="mf-focus-ring inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-sky-500"
              >
                <RefreshIcon class="size-3" />
                Update Core Drivers…
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  )
}
