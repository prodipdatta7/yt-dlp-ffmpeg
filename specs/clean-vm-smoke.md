# Clean-VM Smoke Matrix — v0.1.0

Run on a **snapshot-reverted** Windows 10 (22H2) and Windows 11 VM with no dev tools installed.
Artifact: `dist/MediaForge Desktop-Setup-0.1.0.exe` (unsigned — expect SmartScreen).

| # | Step | Expected | Win10 | Win11 |
|---|------|----------|-------|-------|
| 1 | Run installer, accept UAC | Installs to `%LOCALAPPDATA%\Programs`; desktop + start-menu shortcuts created | ☐ | ☐ |
| 2 | SmartScreen prompt | "More info → Run anyway" works (signing placeholder) | ☐ | ☐ |
| 3 | First launch | Dark shell opens; amber ToS notice visible; footer shows yt-dlp + ffmpeg green badges `[BUNDLED]` within ~5 s (no network needed) | ☐ | ☐ |
| 4 | Click "Understood" | Notice disappears and stays dismissed after relaunch | ☐ | ☐ |
| 5 | Paste `https://www.youtube.com/watch?v=jNQXAC9IVRw` → Analyze | Preview card + format matrix populate (~3–8 s) | ☐ | ☐ |
| 6 | Download 360p MP4 to default Downloads | Progress bar/speed/ETA live; phase chips advance; green "Saved to…" banner; file plays in Movies & TV | ☐ | ☐ |
| 7 | Re-run same download | Saves as `…_1.mp4`, no overwrite | ☐ | ☐ |
| 8 | Paste playlist URL → Download All (2+ entries) | Queue rows complete strictly top-to-bottom | ☐ | ☐ |
| 9 | Audio-only MP3 128K | `.mp3` produced; plays | ☐ | ☐ |
| 10 | Close window mid-download | Guard modal appears; "Run in Background" hides to tray; job finishes; tray ▸ restores | ☐ | ☐ |
| 11 | Kill network mid-download | Amber retry banners (5s/15s/30s); after exhaust, Resume button completes once network returns | ☐ | ☐ |
| 12 | Settings ⚙ → Check for updates | Talks to GitHub API; up-to-date or update applies with SHA-256 gate; engines badge updates | ☐ | ☐ |
| 13 | Uninstall from Settings ▸ Apps | App removed; `%APPDATA%\MediaForge Desktop` remains (user data by design) | ☐ | ☐ |

## Memory measurement on VM

```powershell
$env:MF_MEMORY_PROBE='1'   # packaged app reads env at launch
# run installer build, idle 60 s, then one download; then collect:
Get-Content "$env:APPDATA\MediaForge Desktop\logs\mem.jsonl"
```

Record: idle electronSumMB min/max, per-type breakdown, peak during download,
plus Task-Manager *private* working set per process for the refined metric
(see perf-report.md deviation note). Fill results below.

| Metric | Target | Win10 | Win11 |
|---|---|---|---|
| Idle electron sum | ≤120 MB (or approved deviation) | ☐ ___ | ☐ ___ |
| Idle private WS (sum of processes) | informational | ☐ ___ | ☐ ___ |
| Peak during 1080p download | ≤450 MB | ☐ ___ | ☐ ___ |

Sign-off requires all rows checked or deviations logged in AGENTS.md §2.
