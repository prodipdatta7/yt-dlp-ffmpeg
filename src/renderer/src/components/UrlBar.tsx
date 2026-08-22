import { useState } from 'preact/hooks'
import { analyzing, analysis, analyzeError, resetAnalysis } from '../signals/appState'
import { settingsOpen } from '../signals/uiState'

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
    <div class="flex w-full max-w-3xl flex-col gap-2">
      <div class="flex gap-2">
        <input
          type="url"
          placeholder="https://www.youtube.com/watch?v=…"
          value={value}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          disabled={analyzing.value}
          class={`flex-1 rounded-lg border bg-slate-900 px-4 py-2.5 text-sm outline-none placeholder:text-slate-600 focus:border-sky-500 disabled:opacity-60 ${
            invalid ? 'border-red-500' : 'border-slate-700'
          }`}
        />
        {analyzing.value ? (
          <button
            onClick={cancel}
            class="rounded-lg bg-slate-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-600"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={() => void submit()}
            disabled={invalid || value.trim().length === 0}
            class="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Analyze
          </button>
        )}
      </div>
      {invalid && (
        <p class="text-xs text-red-400">Enter a full link starting with http:// or https://</p>
      )}
      {analyzeError.value && (
        <div class="flex items-center justify-between gap-3 rounded-lg border border-red-800 bg-red-950/60 px-4 py-3 text-sm text-red-300">
          <span>{analyzeError.value.message}</span>
          {(analyzeError.value.code === 'MF_AGE_RESTRICTED' ||
            analyzeError.value.code === 'MF_BOT_CHECK') && (
            <button
              onClick={() => void window.mf.importCookies()}
              class="shrink-0 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-600"
            >
              Import cookies.txt…
            </button>
          )}
          {analyzeError.value.code === 'MF_EXTRACTOR_STALE' && (
            <button
              onClick={() => (settingsOpen.value = true)}
              class="shrink-0 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-600"
            >
              Update Core Drivers…
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export const _analysisRef = analysis
