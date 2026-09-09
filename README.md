# MediaForge Desktop

<div align="center">

**A lightweight, zero-dependency desktop media downloader and transcoder powered by yt-dlp and FFmpeg.**

[![CI](https://github.com/prodipdatta7/yt-dlp-ffmpeg/actions/workflows/ci.yml/badge.svg)](https://github.com/prodipdatta7/yt-dlp-ffmpeg/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/prodipdatta7/yt-dlp-ffmpeg?color=blue&label=latest%20release)](https://github.com/prodipdatta7/yt-dlp-ffmpeg/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-informational)](https://github.com/prodipdatta7/yt-dlp-ffmpeg/releases)

[Download Installer](https://github.com/prodipdatta7/yt-dlp-ffmpeg/releases/latest) • [Features](#key-features) • [Installation](#installation) • [Development](#development)

</div>

---

## ✨ Key Features

- 🚀 **Zero Host Dependencies**: Comes pre-packaged with stable `yt-dlp` and `FFmpeg` binaries. No external Python or command-line setup required.
- 🎯 **Streamlined Modes**:
  - **Video + Audio**: Download in 4K, 1440p, 1080p, 720p, or 480p with auto-muxing to MP4, MKV, or WebM.
  - **Audio Only**: Extract audio to MP3, M4A, OGG (with 320k, 192k, 128k bitrate options) or lossless FLAC and WAV.
  - **Advanced Mode**: Granular format selector for specific video and audio stream IDs.
- 📋 **Playlist & Batch Queue**: Sequential download queue with selective video picking and automatic playlist folder sorting.
- ⚡ **Real-Time Progress**: Live bandwidth speed, ETA calculation, byte tracking, and phase feedback (analyzing, downloading, merging, finalizing).
- 🔄 **Built-in Driver Updates**: One-click in-app updater for both `yt-dlp` and `FFmpeg` with SHA-256 integrity verification—keep up with website changes without reinstalling the app.
- 🔒 **Security & Privacy First**: Strict sandboxed context isolation, zero telemetry or analytics, and local-only media processing.

---

## 📥 Installation

### Windows (x64)

1. Go to the [**Latest Releases**](https://github.com/prodipdatta7/yt-dlp-ffmpeg/releases/latest) page.
2. Download `MediaForge-Desktop-Setup-<version>.exe`.
3. Run the installer.

> **Note on Windows SmartScreen:**  
> MediaForge is an open-source project and doesn't (yet) carry a paid code-signing certificate, so Windows SmartScreen shows a warning on first launch (_"Windows protected your PC"_) — this is expected, not a sign the installer is broken or malicious. If you see a **More info** link, click it first to reveal the button below; either way, click **Run anyway** to proceed. Every release's installer hash is also published as [`SHA256SUMS`](https://github.com/prodipdatta7/yt-dlp-ffmpeg/releases/latest) if you'd like to verify it yourself.

---

## 🛠️ Development

### Prerequisites

- [Node.js](https://nodejs.org/) $\ge$ 20 LTS
- npm $\ge$ 10
- Windows 10/11 x64

### Setup & Run Locally

1. **Clone the repository:**

   ```bash
   git clone https://github.com/prodipdatta7/yt-dlp-ffmpeg.git
   cd yt-dlp-ffmpeg
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Fetch driver binaries (`yt-dlp` & `FFmpeg`):**

   ```bash
   npm run fetch-binaries
   ```

4. **Start development mode:**
   ```bash
   npm run dev
   ```

### Verification & Testing

```bash
# Run type checks (Node & Web targets)
npm run typecheck

# Run linter and formatting checks
npm run lint

# Run automated unit test suite
npm run test
```

### Packaging the Installer

To build the standalone Windows NSIS installer locally:

```bash
npm run dist
```

The packaged installer will be generated in the `dist/` directory.

---

## 🏗️ Architecture

- **Shell**: [Electron](https://www.electronjs.org/) (Strict sandboxing, context isolation, zero Node APIs exposed to renderer)
- **UI Framework**: [Preact](https://preactjs.com/) + `@preact/signals` for lightweight, reactive rendering
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) (Build-time compilation)
- **Build System**: [electron-vite](https://electron-vite.org/) + TypeScript
- **Packaging**: [electron-builder](https://www.electron.build/) (NSIS target)

---

## 📄 License & Attribution

- **MediaForge Desktop** is licensed under the [MIT License](LICENSE).
- **yt-dlp**: Released under The Unlicense ([yt-dlp license](resources/LICENSES/yt-dlp-Unlicense.txt)).
- **FFmpeg**: Licensed under the GNU LGPL v2.1+ ([FFmpeg notice](resources/LICENSES/ffmpeg-LGPL-notice.txt)).
