import { CookieIcon } from '../icons'
import { SettingsCard } from '../SettingsCard'
import { btnDanger, btnPrimary } from './buttonStyles'

export function CookiesSection({
  cookieFileSet,
  onRefresh,
}: {
  cookieFileSet: boolean
  /** Called after import/clear so the parent can re-sync settings (and the sidebar badge). */
  onRefresh: () => void
}) {
  async function importCookies() {
    await window.mf.importCookies()
    onRefresh()
  }

  async function clearCookies() {
    await window.mf.clearCookies()
    onRefresh()
  }

  return (
    <SettingsCard
      icon={<CookieIcon class="size-4" />}
      title="Cookies"
      description="Some sites only let you in when you're logged in. Optional for normal public videos — only needed for age-gated, region-locked, members-only, or bot-checked content."
      footer={
        <>
          <span class="text-sm text-slate-300">
            {cookieFileSet ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                cookies.txt imported
              </span>
            ) : (
              <span className="text-slate-500">not configured</span>
            )}
          </span>
          {!cookieFileSet ? (
            <button onClick={() => void importCookies()} className={btnPrimary}>
              Import cookies.txt…
            </button>
          ) : (
            <button onClick={() => void clearCookies()} className={btnDanger}>
              Clear stored cookies
            </button>
          )}
        </>
      }
    >
      <p class="flex items-start gap-2 rounded-lg border border-line bg-recess p-3 text-xs leading-relaxed text-slate-500">
        <span>
          <span class="font-medium text-slate-400">Why:</span> a site blocks the download until it
          recognises a signed-in account. <span class="font-medium text-slate-400">How:</span> use a
          browser extension that exports <span class="mf-num">cookies.txt</span> (Netscape format),
          then import it here. The file is copied into your private user-data folder, read{' '}
          <em>locally</em> by the engine, and never uploaded, logged, or shared — clear it anytime
          to remove it.
        </span>
      </p>
    </SettingsCard>
  )
}
