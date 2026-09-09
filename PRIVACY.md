# Privacy Policy — MediaForge Desktop

_Last updated: 2026-09-09_

MediaForge Desktop is a local desktop application. This policy is short because there isn't much to disclose.

## What we collect

**Nothing.** MediaForge has no telemetry, no analytics, and no crash reporting that leaves your device. We do not operate a server that the app talks to for its core features.

## What stays on your device

- **Settings** (theme, last output folder, cookie-import status, license activation) are stored in a local JSON file in your Windows user-data folder.
- **Cookies you import** (for age-gated/region-locked/members-only content) are copied into that same local folder and read only by the download engine on your machine. They are never uploaded anywhere.
- **Logs** are written locally for troubleshooting and automatically redact URLs and cookie values. You can open or clear them from Settings → Diagnostics.

## Network access the app does make

- **Downloading media**: the app runs `yt-dlp`, which contacts the site you give it a URL for, the same way your browser would.
- **Keeping its engines current**: the app fetches `yt-dlp` and `FFmpeg` updates over HTTPS from their official GitHub releases and verifies each download's SHA-256 checksum before installing it.
- **License activation**: license keys are verified **entirely offline**, using a cryptographic signature check on your device. No license server is contacted, and no license key or email address is ever transmitted anywhere by the app.

## Third parties

MediaForge does not sell, share, or transmit your data to any third party, because it does not collect any in the first place.

## Your content

Any media you download is fetched directly from the source you point the app at. **You are responsible for having the right to download and use that content** — see [TERMS.md](TERMS.md).

## Contact

Questions about this policy can be raised via the project's issue tracker.

---

_Note for the developer: Microsoft Partner Center requires this policy to be hosted at a public URL (e.g. GitHub Pages) — paste that URL into your Store listing, not this file path._
