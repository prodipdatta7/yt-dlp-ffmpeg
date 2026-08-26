import { useEffect, useRef, useState } from 'preact/hooks'
import { analyzing, analysis, analyzeError, resetAnalysis, urlInput } from '../signals/appState'
import { openSettings } from '../signals/uiState'
import {
  AlertIcon,
  ArrowRightIcon,
  ClipboardIcon,
  CloseIcon,
  CookieIcon,
  LinkIcon,
  RefreshIcon,
  Spinner,
} from './icons'

const URL_PATTERN = /^https?:\/\/\S+$/i

export function UrlBar() {
  const value = urlInput.value
  const setValue = (v: string): void => {
    urlInput.value = v
  }
  const [clipUrl, setClipUrl] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const invalid = value.length > 0 && !URL_PATTERN.test(value.trim())

  async function runAnalyze(url: string) {
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

  async function submit() {
    const url = value.trim()
    if (!url || analyzing.value) return
    await runAnalyze(url)
  }

  function cancel() {
    void window.mf.analyzeCancel()
  }

  function reset() {
    setValue('')
    resetAnalysis()
  }

  function acceptDrop(raw: string | undefined): void {
    if (analyzing.value) return
    const url = (raw ?? '').trim().split('\n')[0]?.trim() ?? ''
    if (!URL_PATTERN.test(url)) return
    setValue(url)
    void runAnalyze(url)
  }

  useEffect(() => {
    const refreshClip = (): void => {
      window.mf
        .getClipboardUrl()
        .then((url) => setClipUrl(url && url !== value.trim() ? url : null))
        .catch(() => undefined)
    }
    refreshClip()
    window.addEventListener('focus', refreshClip)

    const onDragOver = (e: DragEvent): void => {
      e.preventDefault()
      setDropping(true)
    }
    const onDragLeave = (e: DragEvent): void => {
      if (!e.relatedTarget) setDropping(false)
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      setDropping(false)
      acceptDrop(
        e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '',
      )
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)

    const onFocusRequest = (): void => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('mf:focus-url', onFocusRequest)

    return () => {
      window.removeEventListener('focus', refreshClip)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('mf:focus-url', onFocusRequest)
    }
  }, [value])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'l')) {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const showClipChip = !analyzing.value && value.trim().length === 0 && clipUrl !== null

  return (
    <div class="flex flex-col gap-2">
      <div class="relative">
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute -inset-0.5 rounded-[18px] bg-gradient-to-r from-sky-500/50 via-indigo-500/40 to-emerald-400/40 opacity-0 blur-md transition-opacity duration-500 ${
            analyzing.value ? 'opacity-70' : 'group-focus-within:opacity-0'
          }`}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className={`app-no-drag group relative flex items-stretch overflow-hidden rounded-2xl border bg-[var(--surface-input)] transition-all duration-200 ${
            dropping
              ? 'border-sky-400/80 bg-sky-500/[0.07]'
              : analyzing.value
                ? 'border-sky-400/40'
                : invalid
                  ? 'border-rose-500/50'
                  : 'border-white/[0.12] focus-within:border-sky-400/60 focus-within:shadow-[0_0_0_3px_var(--mf-glow)]'
          }`}
        >
          <span class="flex w-11 shrink-0 items-center justify-center border-r border-white/[0.06]">
            {analyzing.value ? (
              <Spinner class="size-4 text-sky-400" />
            ) : (
              <LinkIcon class={`size-4 ${dropping ? 'text-sky-300' : 'text-slate-500'}`} />
            )}
          </span>

          <input
            ref={inputRef}
            type="url"
            spellcheck={false}
            placeholder={
              dropping ? 'Drop the link to analyze…' : 'Paste a video, audio or playlist link…'
            }
            value={value}
            onInput={(e) => setValue((e.target as HTMLInputElement).value)}
            disabled={analyzing.value}
            aria-invalid={invalid}
            aria-label="Media link"
            title="Ctrl+K to focus"
            className={`min-w-0 flex-1 bg-transparent px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 disabled:opacity-60 ${
              invalid ? 'text-rose-300' : ''
            }`}
          />

          {invalid && !analyzing.value && (
            <span class="pointer-events-none flex items-center pr-1 text-[11px] font-medium text-rose-400">
              must start with https://
            </span>
          )}

          {showClipChip && (
            <button
              type="button"
              onClick={() => {
                setValue(clipUrl)
                inputRef.current?.focus()
              }}
              title={`From clipboard: ${clipUrl}`}
              class="mf-focus-ring my-auto mr-1 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] px-2.5 py-1 text-[11px] font-medium text-emerald-300 transition hover:bg-emerald-500/[0.15]"
            >
              <ClipboardIcon class="size-3" />
              from clipboard
            </button>
          )}

          {value.length > 0 && !analyzing.value && (
            <button
              type="button"
              onClick={() => setValue('')}
              title="Clear"
              aria-label="Clear input"
              class="mf-focus-ring my-auto flex size-7 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-white/[0.06] hover:text-slate-200"
            >
              <CloseIcon class="size-3.5" />
            </button>
          )}

          {analyzing.value ? (
            <button
              type="button"
              onClick={cancel}
              class="mf-focus-ring m-1.5 inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/[0.12] px-4 text-xs font-semibold text-slate-200 transition hover:border-rose-500/60 hover:text-rose-300 active:scale-[0.98]"
            >
              <Spinner class="size-3.5" />
              Cancel
            </button>
          ) : (
            <>
              <button
                type="submit"
                disabled={value.trim().length === 0}
                className={`mf-focus-ring m-1.5 inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 px-5 text-sm font-bold text-white shadow-lg shadow-sky-500/25 transition-all duration-150 hover:brightness-110 active:scale-[0.98] ${
                  value.trim().length === 0 ? 'cursor-not-allowed opacity-35 shadow-none' : ''
                }`}
                title="Analyze (Enter)"
              >
                Analyze
                <ArrowRightIcon class="size-4" />
              </button>
              {analysis.value && (
                <button
                  type="button"
                  onClick={reset}
                  title="Reset and clear the current result"
                  aria-label="Reset for a new link"
                  class="mf-focus-ring m-1.5 inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/[0.12] px-4 text-xs font-semibold text-slate-200 transition hover:border-rose-500/60 hover:text-rose-300 active:scale-[0.98]"
                >
                  Reset
                </button>
              )}
            </>
          )}
        </form>
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
