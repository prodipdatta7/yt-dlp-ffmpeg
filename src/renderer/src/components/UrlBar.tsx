import { useEffect, useRef, useState } from 'preact/hooks'
import {
  analyzing,
  analysis,
  analyzeError,
  resetAnalysis,
  triggerAnalyze,
  urlInput,
} from '../signals/appState'
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

function clipboardHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return 'web link'
  }
}

export function UrlBar() {
  const value = urlInput.value
  const setValue = (v: string): void => {
    urlInput.value = v
  }
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null)
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const clipboardNoticeTimer = useRef<number | null>(null)
  const invalid = value.length > 0 && !URL_PATTERN.test(value.trim())

  async function submit() {
    const url = value.trim()
    if (!url || analyzing.value) return
    await triggerAnalyze(url)
  }

  function cancel() {
    void window.mf.analyzeCancel()
  }

  function reset() {
    setValue('')
    resetAnalysis()
  }

  function showClipboardNotice(message: string): void {
    if (clipboardNoticeTimer.current !== null) window.clearTimeout(clipboardNoticeTimer.current)
    setClipboardNotice(message)
    clipboardNoticeTimer.current = window.setTimeout(() => {
      clipboardNoticeTimer.current = null
      setClipboardNotice(null)
    }, 3200)
  }

  async function pasteClipboardUrl(): Promise<void> {
    if (analyzing.value) return
    const url = await window.mf.getClipboardUrl().catch(() => null)
    if (!url) {
      setClipboardUrl(null)
      showClipboardNotice('Clipboard needs a https:// link')
      return
    }
    if (clipboardNoticeTimer.current !== null) {
      window.clearTimeout(clipboardNoticeTimer.current)
      clipboardNoticeTimer.current = null
    }
    setClipboardNotice(null)
    setClipboardUrl(null)
    setValue(url)
    inputRef.current?.focus()
    requestAnimationFrame(() => inputRef.current?.select())
  }

  function acceptDrop(raw: string | undefined): void {
    if (analyzing.value) return
    const url = (raw ?? '').trim().split('\n')[0]?.trim() ?? ''
    if (!URL_PATTERN.test(url)) return
    setValue(url)
    void triggerAnalyze(url)
  }

  useEffect(() => {
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

    const onAnalyzeUrlRequest = (event: Event): void => {
      const url = (event as CustomEvent<{ url: string }>).detail?.url
      if (!url || analyzing.value) return
      void triggerAnalyze(url)
    }
    window.addEventListener('mf:analyze-url', onAnalyzeUrlRequest)

    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('mf:focus-url', onFocusRequest)
      window.removeEventListener('mf:analyze-url', onAnalyzeUrlRequest)
    }
  }, [])

  useEffect(() => {
    const refreshClipboardOffer = (): void => {
      window.mf
        .getClipboardUrl()
        .then((url) => setClipboardUrl(url && url !== urlInput.value.trim() ? url : null))
        .catch(() => setClipboardUrl(null))
    }
    refreshClipboardOffer()
    window.addEventListener('focus', refreshClipboardOffer)
    return () => window.removeEventListener('focus', refreshClipboardOffer)
  }, [])

  useEffect(
    () => () => {
      if (clipboardNoticeTimer.current !== null) window.clearTimeout(clipboardNoticeTimer.current)
    },
    [],
  )

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

  const clipboardReady = !analyzing.value && value.trim().length === 0 && clipboardUrl !== null

  return (
    <section
      class={`mf-url-bar${analyzing.value ? ' is-analyzing' : ''}${dropping ? ' is-dropping' : ''}${invalid ? ' is-invalid' : ''}`}
      aria-label="Add a media link"
    >
      <div class="mf-url-bar-shell">
        <span class="mf-url-bar-rail" aria-hidden="true">
          URL
        </span>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          class="mf-url-form app-no-drag"
        >
          <span class="mf-url-icon" aria-hidden="true">
            {analyzing.value ? (
              <Spinner class="size-4 text-sky-400" />
            ) : (
              <LinkIcon class="size-4" />
            )}
          </span>

          <div class="mf-url-input-wrap">
            <label class="mf-url-input-label" for="media-url">
              Media URL
            </label>
            <input
              ref={inputRef}
              id="media-url"
              type="url"
              name="media-url"
              autocomplete="url"
              inputMode="url"
              spellcheck={false}
              placeholder={
                dropping ? 'Drop the link to analyze…' : 'Paste a video, audio or playlist link…'
              }
              value={value}
              onInput={(e) => {
                if (clipboardNoticeTimer.current !== null) {
                  window.clearTimeout(clipboardNoticeTimer.current)
                  clipboardNoticeTimer.current = null
                }
                setClipboardNotice(null)
                setValue((e.target as HTMLInputElement).value)
              }}
              disabled={analyzing.value}
              aria-invalid={invalid}
              title="Ctrl+K to focus"
              class="mf-url-input"
            />
          </div>

          {invalid && !analyzing.value && (
            <span class="mf-url-invalid-note" aria-live="polite">
              must start with https://
            </span>
          )}

          {!analyzing.value && (
            <button
              type="button"
              onClick={() => void pasteClipboardUrl()}
              title={
                clipboardReady
                  ? `Use clipboard link from ${clipboardHost(clipboardUrl!)}`
                  : 'Paste a web link from the clipboard into the URL bar'
              }
              aria-label="Paste URL from clipboard"
              class={`mf-url-clipboard mf-focus-ring${clipboardReady ? ' is-ready' : ''}`}
            >
              <span class="mf-url-clipboard-glyph">
                <ClipboardIcon class="size-3" />
              </span>
              {clipboardReady ? (
                <span class="mf-url-clipboard-copy">
                  <strong>Link ready</strong>
                  <span>{clipboardHost(clipboardUrl!)}</span>
                </span>
              ) : (
                <span class="mf-url-clipboard-copy">Paste</span>
              )}
              {clipboardReady && <span class="mf-url-clipboard-action">Use</span>}
            </button>
          )}

          {clipboardNotice && !analyzing.value && (
            <span class="mf-url-clipboard-note" aria-live="polite">
              {clipboardNotice}
            </span>
          )}

          {value.length > 0 && !analyzing.value && (
            <button
              type="button"
              onClick={() => setValue('')}
              title="Clear"
              aria-label="Clear input"
              class="mf-url-clear mf-focus-ring"
            >
              <CloseIcon class="size-3.5" />
            </button>
          )}

          {analyzing.value ? (
            <button type="button" onClick={cancel} class="mf-url-cancel mf-focus-ring">
              <Spinner class="size-3.5" />
              Cancel
            </button>
          ) : (
            <>
              <button
                type="submit"
                disabled={value.trim().length === 0}
                class="mf-url-submit mf-focus-ring"
                title="Analyze (Enter)"
              >
                <span>Analyze</span>
                <ArrowRightIcon class="size-4" />
              </button>
              {analysis.value && (
                <button
                  type="button"
                  onClick={reset}
                  title="Reset and clear the current result"
                  aria-label="Reset for a new link"
                  class="mf-url-reset mf-focus-ring"
                >
                  Reset
                </button>
              )}
            </>
          )}
        </form>
      </div>

      {analyzeError.value && (
        <div
          class="flex items-start justify-between gap-4 rounded-xl border border-rose-500/25 bg-rose-950/40 px-3.5 py-2.5"
          role="alert"
          aria-live="assertive"
        >
          <div class="flex min-w-0 items-start gap-2.5">
            <AlertIcon class="mt-0.5 size-3.5 shrink-0 text-rose-400" />
            <p class="mf-select-text text-xs leading-relaxed text-rose-200">
              {analyzeError.value.message}
            </p>
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
    </section>
  )
}
