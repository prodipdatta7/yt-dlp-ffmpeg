import { activeView, type ViewId } from '../signals/uiState'
import {
  BookOpenIcon,
  CookieIcon,
  DownloadIcon,
  FolderIcon,
  GearIcon,
  HardDriveIcon,
  LinkIcon,
  QueueIcon,
  RefreshIcon,
  SearchIcon,
  ShareIcon,
  TerminalIcon,
} from './icons'

type Guide = {
  id: Exclude<ViewId, 'help'>
  label: string
  description: string
  steps: readonly string[]
  Icon: preact.ComponentType<{ class?: string }>
}

const GUIDES: readonly Guide[] = [
  {
    id: 'download',
    label: 'Downloader',
    description: 'Turn a direct media link into a local video or audio file.',
    steps: [
      'Paste a full http:// or https:// media link and choose Analyze.',
      'Review the preview, then choose Video + Audio, Audio only, or Advanced.',
      'Pick a destination and format, then choose Start Download. Keep the app open until Done.',
    ],
    Icon: DownloadIcon,
  },
  {
    id: 'search',
    label: 'Search',
    description: 'Discover public media before sending it to the Downloader or Queue.',
    steps: [
      'Choose a supported source, enter useful keywords, and run the search.',
      'Open a result to preview its details. Public-web sources can return fewer results.',
      'Send one result to Downloader, or select several and add them to Queue.',
    ],
    Icon: SearchIcon,
  },
  {
    id: 'queue',
    label: 'Queue',
    description: 'Watch, stop, retry, and review multi-item download runs.',
    steps: [
      'Build a queue from a playlist in Downloader or by selecting Search results.',
      'Choose sequential for one-at-a-time downloads or parallel for greater speed.',
      'Follow each row independently. Failed items keep their partial files and can be retried.',
    ],
    Icon: QueueIcon,
  },
  {
    id: 'share',
    label: 'Local Share',
    description: 'Hand a finished file to a nearby device without uploading it.',
    steps: [
      'Connect both devices to the same trusted Wi-Fi or local network.',
      'Choose a file, then scan the QR code or copy the private link.',
      'Keep MediaForge open until the transfer completes; stop sharing when finished.',
    ],
    Icon: ShareIcon,
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Set defaults, maintain the media engines, and solve common issues.',
    steps: [
      'Set your usual destination and playlist concurrency under Workspace.',
      'Update yt-dlp and FFmpeg under Drivers when a site stops working.',
      'Use Storage, Cookies, and Diagnostics only when a download needs recovery or access help.',
    ],
    Icon: GearIcon,
  },
]

const QUICK_STEPS = [
  { label: 'Paste', copy: 'Copy a media link into Downloader.', Icon: LinkIcon },
  { label: 'Analyze', copy: 'Let MediaForge inspect available streams.', Icon: SearchIcon },
  { label: 'Choose', copy: 'Select quality, format, and destination.', Icon: FolderIcon },
  { label: 'Download', copy: 'Start the job and follow its progress.', Icon: DownloadIcon },
] as const

export function HelpScreen({ onShowShortcuts }: { onShowShortcuts: () => void }) {
  function navigate(view: Guide['id']): void {
    activeView.value = view
    window.requestAnimationFrame(() => {
      if (view === 'download') window.dispatchEvent(new CustomEvent('mf:focus-url'))
      if (view === 'search') window.dispatchEvent(new CustomEvent('mf:focus-search'))
    })
  }

  return (
    <main class="mf-help-workspace mf-rise min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-3 pt-3.5">
      <div class="flex w-full flex-col gap-6">
        <header class="mf-help-hero">
          <div>
            <p class="mf-workspace-kicker">HELP CENTER</p>
            <h1>
              From link to local file<span>.</span>
            </h1>
            <p>
              Start with the four-step path below, or open a feature guide when you need a little
              more detail. MediaForge keeps downloads and processing on this computer.
            </p>
          </div>
          <span class="mf-help-hero-mark" aria-hidden="true">
            <BookOpenIcon class="size-10" />
          </span>
        </header>

        <section class="mf-help-quick" aria-labelledby="help-quick-title">
          <div class="mf-help-section-head">
            <div>
              <p>FIRST DOWNLOAD</p>
              <h2 id="help-quick-title">The shortest path</h2>
            </div>
            <button type="button" class="mf-focus-ring" onClick={() => navigate('download')}>
              Open Downloader
            </button>
          </div>
          <ol>
            {QUICK_STEPS.map(({ label, copy, Icon }, index) => (
              <li key={label}>
                <span class="mf-help-step-number">0{index + 1}</span>
                <Icon class="size-5" />
                <div>
                  <h3>{label}</h3>
                  <p>{copy}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="help-guides-title">
          <div class="mf-help-section-head">
            <div>
              <p>FEATURE GUIDES</p>
              <h2 id="help-guides-title">Choose where you are working</h2>
            </div>
          </div>
          <div class="mf-help-guide-grid">
            {GUIDES.map(({ id, label, description, steps, Icon }) => (
              <article key={id} class="mf-help-guide-card">
                <header>
                  <span>
                    <Icon class="size-5" />
                  </span>
                  <div>
                    <h3>{label}</h3>
                    <p>{description}</p>
                  </div>
                </header>
                <ol>
                  {steps.map((step, index) => (
                    <li key={step}>
                      <b>{index + 1}</b>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                <button type="button" class="mf-focus-ring" onClick={() => navigate(id)}>
                  Open {label}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section class="mf-help-recovery" aria-labelledby="help-recovery-title">
          <div class="mf-help-section-head">
            <div>
              <p>WHEN SOMETHING BLOCKS YOU</p>
              <h2 id="help-recovery-title">Three good places to look</h2>
            </div>
            <button type="button" class="mf-focus-ring" onClick={onShowShortcuts}>
              Keyboard shortcuts
            </button>
          </div>
          <div>
            <article>
              <RefreshIcon class="size-5" />
              <h3>A site suddenly fails</h3>
              <p>Open Settings → Drivers and update yt-dlp first. Media sites change often.</p>
            </article>
            <article>
              <CookieIcon class="size-5" />
              <h3>Age or sign-in required</h3>
              <p>Import a Netscape-format cookies.txt file in Settings → Cookies, then retry.</p>
            </article>
            <article>
              <HardDriveIcon class="size-5" />
              <h3>A job was interrupted</h3>
              <p>Retry or resume it. Review retained partial files in Settings → Storage.</p>
            </article>
            <article>
              <TerminalIcon class="size-5" />
              <h3>You need more detail</h3>
              <p>Open the Console in the footer, or copy a report from Settings → Diagnostics.</p>
            </article>
          </div>
        </section>

        <p class="mf-help-responsible-note">
          Download and share only media you own or have permission to use. Platform terms and local
          law still apply.
        </p>
      </div>
    </main>
  )
}
