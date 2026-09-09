# Store Submission Notes (internal — not user-facing)

Read this before submitting MediaForge to the Microsoft Store. It's a candid risk memo, not marketing copy.

## The core risk

Microsoft Store has a real, repeated history of **rejecting or delisting apps that download media from sites like YouTube**, under Store Policy 10.2 ("apps must not... facilitate the ability to... infringe another party's intellectual property rights or... violate the terms of service of a third-party service"). This has happened to well-known apps in this exact category, sometimes years after they were initially approved. Certification is manual and can be inconsistent, but "downloads from YouTube" is the single most common trigger.

**This is not a bug this codebase can fix.** It's about what the app does and how it's presented, not a technical compliance checkbox.

## What lowers the risk (not eliminates it)

1. **Don't lead with platform names in the Store listing.** Avoid "YouTube Downloader" as the app name, icon, or headline description. Frame it generically — a URL-based media fetch/transcode utility — and let the in-app experience speak for itself. This is written in Partner Center, not in this repo, but flag it to whoever fills that in.
2. **Keep the in-app compliance notice prominent.** The app already shows a first-run notice ("MediaForge is a passive client — you are responsible for complying with the terms and copyright of the sites you download from") — don't remove or bury it. It won't prevent a rejection on its own, but it's the honest and correct thing to have regardless.
3. **Reference [TERMS.md](TERMS.md) and [PRIVACY.md](PRIVACY.md) from the Store listing** — Partner Center requires a privacy policy URL, and having clear terms reduces ambiguity about what the app is for.
4. **Expect the possibility of rejection or later delisting**, and don't build the business as if Store approval is guaranteed or permanent.

## Why direct distribution should stay alive regardless

The app already builds an NSIS installer published to GitHub Releases (`.github/workflows/release.yml`) — keep that pipeline working even after a Store submission. If revenue depends entirely on the Store listing and it gets pulled, there's no fallback. Selling license keys (see the Free/Pro system in Settings → License) works identically whether someone installs via the Store or via the direct `.exe` — the license verification is fully offline and doesn't care which channel the binary came from.

## MSIX packaging status

`electron-builder.yml` now has an `appx` target scaffolded alongside the existing `nsis` one, but three fields are placeholders (`identityName`, `publisher`, and by extension the certificate Microsoft issues for it) — they can only be filled in after reserving the app name in Microsoft Partner Center. The appx target will not build successfully until then.

## Before you submit

- [ ] Reserve the app name in Partner Center, copy the real `identityName`/`publisher` into `electron-builder.yml`.
- [ ] Host `PRIVACY.md`'s content at a public URL and add it to the listing.
- [ ] Write Store listing copy that doesn't foreground a specific platform's trademark.
- [ ] Decide, going in, what you'll do if the listing is rejected or later delisted — the direct-download channel is the answer, not a surprise.
