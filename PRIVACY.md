# MediaForge Desktop — Privacy Policy

**Last updated: 21 September 2026**
**Applies to:** MediaForge Desktop (Microsoft Store package identity `prodip-datta.MediaForgeDesktop`) and
the standalone Windows installer published at <https://github.com/prodipdatta7/yt-dlp-ffmpeg/releases>.

MediaForge Desktop is a desktop application that runs entirely on your own computer. It is a graphical
front end for two open-source command-line tools, [yt-dlp](https://github.com/yt-dlp/yt-dlp) and
[FFmpeg](https://ffmpeg.org/), both of which are bundled inside the app.

**In one sentence: MediaForge has no servers, no account system, no telemetry, and no analytics. It
does not collect, transmit, sell, or share your personal information with the developer or with any
third party.**

---

## 1. Information the app stores on your device

Everything below is written to your local user-data folder — `%APPDATA%\MediaForge Desktop` for the
standalone installer, or the app's private per-package AppData folder for the Microsoft Store build.
None of it is uploaded anywhere.

| What                                                         | Why                                                                                                                 | Where                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Settings**                                                 | Your default output folder, theme, and preferences, so they persist between launches.                               | `settings.json`             |
| **Cookies file** (only if you import one)                    | Passed to yt-dlp so it can reach content that requires you to be signed in.                                         | `cookies.txt`               |
| **Download record**                                          | A local list of completed downloads, so the app can tell you a file already exists instead of downloading it twice. | `.mediaforge-manifest.json` |
| **Logs**                                                     | Plain-text diagnostic logs, kept for 7 days, so you can troubleshoot a failed download.                             | `logs\`                     |
| **Temporary files**                                          | In-progress downloads, deleted after the final file is verified.                                                    | `tmp\`                      |
| **Downloaded media**                                         | The videos and audio you asked for, saved to the folder you chose.                                                  | your chosen folder          |
| **Updated tool binaries** (only if you use "Update Drivers") | A newer `yt-dlp.exe` or `ffmpeg.exe`, kept alongside a `.bak` copy so a bad update can be rolled back.              | `binaries\win32\`           |

**Your downloads are yours.** MediaForge never sends a list of what you downloaded to anyone.

## 2. Information that leaves your device

The app makes network requests only as a direct result of something you asked it to do:

- **The media site you paste a URL from.** yt-dlp connects directly to that site to read metadata
  and download the file. That site will see your IP address and request, exactly as it would if you
  visited it in a browser.
- **Thumbnails.** Preview images are loaded straight from the media host into the app window, which
  means that host sees a request from your IP address when a preview is shown.
- **Search queries, when you use the Search tab.** A search term is sent to the platform you
  selected — YouTube, SoundCloud, or Bilibili — via their normal public endpoints. For Facebook,
  Instagram, X, TikTok, and Reddit, where no supported search API exists, the query is sent to
  [DuckDuckGo](https://duckduckgo.com/privacy) or, if that fails, [Brave Search](https://brave.com/privacy/),
  scoped to that site. **Search queries are the only text you type that is sent to a third party.**
- **Update checks.** If you click "Check for Updates", the app requests the latest release
  information from GitHub (`github.com`). No account, identifier, or usage data is sent — it is an
  ordinary public download of a release page.

No request is ever made to a server operated by the developer, because the developer operates none.

## 3. What the app does not do

- No telemetry, no crash reporting, no analytics, no usage statistics.
- No advertising, no ad identifiers, no tracking pixels.
- No user accounts, no sign-in, no email collection.
- No access to your contacts, calendar, location, camera, microphone, or health data.
- No reading of your files beyond the media folder you select and the app's own data folder.

## 4. Cookies

A cookies file is **only** stored if you deliberately import one, and it stays on your machine. It is
passed to yt-dlp as a local file argument so that downloads of content you are entitled to access can
authenticate. It is never transmitted to the developer or to any third party by MediaForge, and the
app's logging actively redacts cookie contents.

You can remove it at any time with **Settings → Cookies → Clear stored cookies**.

## 5. Logs and diagnostics

Logs record what the app and its bundled tools did, so a failure can be diagnosed. Before anything is
written or displayed, **URL query strings are stripped**, and cookie contents are never logged.

The **Diagnostics** section in Settings can produce a summary you can copy to your clipboard to share
in a bug report. It contains version numbers, capability status, and this app's privacy posture. It
does not contain your cookies, your download history, or your file paths unless you choose to paste
them yourself. You can open the log folder directly from Settings and delete it whenever you like.

## 6. Local network sharing

The **Local Share** feature starts a small web server on your own computer so another device on the
same Wi-Fi network can download a file you choose to offer. It:

- listens only on your local network and uses a per-session link,
- transfers the file directly from your computer to that device,
- never routes the file through the internet or through any server,
- stops when you turn it off or close the app.

## 7. Microsoft Store installations

If you installed MediaForge from the Microsoft Store, the Store handles updates for the app itself.
Microsoft may collect Store-level information (such as install and crash data) under
[Microsoft's own privacy statement](https://privacy.microsoft.com/privacystatement); that collection
is performed by Microsoft, not by MediaForge, and the developer receives only the aggregate,
anonymised reports the Store provides to all publishers.

The app's own behaviour is identical in both builds: no telemetry is sent by MediaForge.

## 8. Your controls

- **Delete everything:** uninstall the app, then delete `%APPDATA%\MediaForge Desktop`. That removes
  settings, cookies, logs, download records, and any updated tool binaries.
- **Remove cookies only:** Settings → Cookies → Clear stored cookies.
- **Remove logs only:** Settings → Diagnostics → Open Logs Folder, then delete its contents.
- **Read your data:** every file listed in section 1 is plain JSON or plain text. You can open any of
  them in a text editor.

## 9. Children

MediaForge is a general-purpose media tool and is not directed at children. It collects no personal
information from anyone, including children.

## 10. Changes to this policy

If a future version of the app changes what it stores or transmits, this document will be updated and
its date revised before that version is released. Because the app has no way to contact you, the
current version of this policy is always the one published at this URL.

## 11. Contact

Questions or corrections: open an issue at
<https://github.com/prodipdatta7/yt-dlp-ffmpeg/issues>.
