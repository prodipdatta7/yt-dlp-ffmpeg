# Product Requirement Document (PRD)

## 1. Document Control & Overview

### 1.1 Purpose
This document defines the complete product requirements, functional specifications, and technical constraints for **MediaForge Desktop**, an Electron-based desktop application. The product provides a robust, user-friendly Graphical User Interface (GUI) wrapper for the command-line interfaces (CLIs) of **yt-dlp** and **FFmpeg**.

### 1.2 High-Level Objective
To bridge the gap between advanced open-source terminal utilities and non-technical end-users. The application abstracts command-line arguments into an intuitive, zero-dependency desktop ecosystem while retaining 100% of the underlying tools' raw format capability, processing speed, and local privacy advantages.

---

## 2. Target Persona & Core Value Proposition

### 2.1 Target Personas
*   **The Casual Content Consumer:** Needs to download videos, background music, or educational clips for offline viewing (e.g., flights, commutes). Cannot or will not interact with a terminal wrapper.
*   **The Professional Content Creator / Archivist:** Requires specific high-definition streams (4K/8K), specific audio containers (FLAC/WAV), or rapid local format transcoding. They need reliability and granular format options without remembering syntactical flags.

### 2.2 Core Value Propositions
*   **Zero Dependencies:** The user does not need to install Python, Node.js, Git, FFmpeg, or yt-dlp on their host operating system. The application works out of the box.
*   **Ad-Free Privacy:** Replaces sketchy, malware-ridden browser extensions and web-based downloaders with a secure, sandboxed, 100% local processing engine.
*   **Maximum Quality Selection:** Solves the classic limitation where platforms serve high-resolution video tracks separate from high-quality audio tracks. The app handles background muxing (multiplexing) seamlessly.

---

## 3. Comprehensive Feature & Functional Requirements

```
                                  MEDIAFORGE DESKTOP
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  🌐 Input URL: [ https://www.youtube.com/watch?v=example                              ] │
│                 [ ANALYZE LINK ]                                                       │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 🎬 PREVIEW & CONFIGURATION PANEL (Populated Post-Analysis)                              │
│ ┌───────────────────┐  Title: Deep Dive into Distributed Systems                       │
│ │                   │  Channel/Author: TechEdu Labs                                    │
│ │     Thumbnail     │  Duration: 01:24:15                                              │
│ │      Preview      │                                                                  │
│ │                   │  Mode Selector: (•) Video + Audio   ( ) Audio Only  ( ) Advanced │
│ └───────────────────┘  Resolution:    [ 1080p (60fps) - MP4 (approx. 450MB)        ▼ ] │
│                        Output Folder: [ C:\Users\Username\Downloads          ][ BROWSE]│
│                                                                                        │
│                 [ START PRODUCTION-GRADE DOWNLOAD ]                                    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 📊 PIPELINE STATUS TRACKER                                                             │
│ Status: Downloading Video Stream (Chunk 4/10)                                          │
│ Progress: [================──────────────] 42.5%                                       │
│ Network Speed: 12.4 MB/s | ETA: 00:01:14                                               │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 URL Input & Validation Engine
The entry point of the app must safely ingest, validate, and clean user-provided text input strings.

*   **Supported Inputs:** Direct links to single videos, audio tracks, and supported third-party stream platforms (YouTube, Vimeo, Twitch, Soundcloud, TikTok).
*   **Client-Side Pre-Validation:** 
    *   Reject empty strings.
    *   Reject strings lacking standard web protocol prefixes (`http://` or `https://`).
    *   Strip leading/trailing whitespaces and tracking tokens automatically (e.g., clipping everything after the `?si=` or `&feature=` shared parameters if it breaks metadata retrieval).
*   **Error States:** Clear, colored visual warnings underneath the input bar for unsupported web domains or malformed text strings.

### 3.2 Metadata Extraction & Parsing Module
Once a URL is submitted, the application must query the site in the background without downloading the heavy payload.

*   **Extraction Payload:** Retrieve the absolute video/audio title, duration (formatted as `HH:MM:SS`), author/channel name, total views, upload date, and the URL string for the highest-resolution thumbnail image.
*   **Asynchronous UI Loading State:** The input form disables, and a loading spinner appears. The application remains interactive; users must be able to cancel an analysis task mid-flight.
*   **Format Matrix Parsing:** The app must parse the backend JSON data to isolate visual resolutions, frame rates, audio bitrates, and file formats into structured lists.

### 3.3 Target Format Options & Selection Matrix
The interface must offer three distinct download paths based on user preferences.

#### A. Video + Audio Mode (Default)
*   Provides a clean dropdown containing user-friendly resolution tags: `8K`, `4K`, `1440p`, `1080p`, `720p`, `480p`, `360p`.
*   Displays frame rate qualifiers (`60fps`, `30fps`) alongside container format recommendations (`MP4`, `MKV`, `WebM`).
*   Calculates and displays approximate file sizing estimations whenever byte-size parameters are passed in the metadata stream.

#### B. Audio-Only Mode
*   Hides all video-related configurations completely.
*   Presents a simplified audio quality hierarchy: `High (320kbps)`, `Medium (192kbps)`, `Low (128kbps)`.
*   Exposes a file extension container selection dropdown: `MP3`, `M4A`, `FLAC`, `WAV`, `OGG`.

#### C. Advanced Expert Mode
*   Exposes the raw streams matrix straight from `yt-dlp`.
*   Allows custom parameter injection where power users can explicitly match a specific Video Format ID to a specific Audio Format ID.

### 3.4 Local File System Integration
The app must give users direct control over their local storage destinations.

*   **Target Output Path Selection:** A native system file dialogue box triggers when clicking "Browse". It defaults to the user's primary operating system `Downloads` directory.
*   **Persistent Memory Location:** The application must cache the last confirmed save location across system restarts so users do not have to map folders repeatedly.
*   **Filename Sanitization Subsystem:**
    *   Automatically filters out operating system illegal string characters: `\`, `/`, `:`, `*`, `?`, `"`, `<`, `>`, `|`.
    *   Replaces emoji strings or illegal symbols with underscores `_` or clean dashes `-` to prevent disk write crashes.
    *   Triggers an auto-rename sequence (e.g., appending `_1`, `_2`) if a file with the exact same name already occupies the target directory.

### 3.5 Dual-Engine Processing Pipeline
The core execution engine managing the underlying CLI binary interactions.

*   **Phase 1: Downloading (yt-dlp):** Fetches the target audio and video tracks independently into a temporary sandbox cache directory.
*   **Phase 2: Muxing/Transcoding (FFmpeg):** Fires immediately upon download completion. It merges the separate audio and video layers into the user's chosen container file format without re-encoding unless explicitly specified (maximizing processing speed).
*   **Phase 3: Clean up:** Safely deletes temporary, un-muxed files from the hidden cache folder immediately after verifying successful creation of the target file wrapper.

### 3.6 Real-Time Progress Monitoring & Telemetry
Users must never be left guessing the state of an active process.

*   **Visual Elements:** A smooth linear progress bar displaying real-time task percentages (0.0% to 100.0%).
*   **Log Parsers:** A background scanner that intercepts the standard output (`stdout`) lines of the CLI streams to compute:
    *   Current download/transcode speeds (formatted in `KB/s` or `MB/s`).
    *   Estimated Time of Arrival countdown timer (`ETA: MM:SS`).
    *   Explicit step messages: `[Analyzing Source]`, `[Downloading Video Layer]`, `[Downloading Audio Layer]`, `[Merging Media Tracks]`, `[Finalizing File Output]`.

---

## 4. Edge Cases, Exception Handling & Robustness Matrix

| Case ID | Scenarios & Edge Cases | System Expected Behavior & Recovery Path |
| :--- | :--- | :--- |
| **EC-01** | User enters an aging or dead video URL. | Terminate process safely; trigger user notification: *"This media link appears to be private, deleted, or offline."* Re-enable the input bar. |
| **EC-02** | Platform updates its web player configuration, breaking `yt-dlp` parsing. | Catch stdout errors; prompt user: *"Engine update required. Click 'Update Core Drivers' in settings to apply the hotfix."* |
| **EC-03** | Local disk drive runs completely out of storage space mid-download. | Halt execution; trigger prompt explaining missing byte count needed; retain partial files for potential user recovery. |
| **EC-04** | User loses Wi-Fi connection or ethernet drops during a large file download. | Don't crash. Enter a 30-second loop attempting automatic network reconnections. If connection fails, pause task and expose a **"Resume Download"** button. |
| **EC-05** | User closes the desktop window app interface while a 4K transcode job is running. | Interrupt close sequence with an OS warning modal: *"Closing the app will abort your active video download. Confirm Cancel or Run in Background."* |
| **EC-06** | Target video platform serves a live video stream (Livestream/M3U8) instead of an VOD file. | Detect stream flags; change download workflow to record mode with an explicit **"Stop Recording & Save File"** control button. |
| **EC-07** | Target platform requires user authentication (Age-Gated or Private Content). | Display modal error message: *"This video is age-restricted or private."* Offer option in advanced settings to pass user cookies safely. |

---

## 5. Non-Functional, Technical & Performance Constraints

### 5.1 Security Framework & Process Sandboxing
*   **Context Isolation:** The web renderer process must have absolutely zero direct access to the local machine file system or shell execution loops (`nodeIntegration: false`, `contextIsolation: true`).
*   **Preload Bridge:** Communication between the HTML user interface and system architectures must occur through explicit, strictly defined Inter-Process Communication channels (`ipcRenderer.invoke` / `ipcMain.handle`) inside `preload.js`.
*   **Input Sanitization:** Sanitize input strings before passing them to the shell process execution string to prevent command injection exploits.

### 5.2 Performance & UI Responsiveness Bounds
*   **Thread Isolation:** The graphical user interface thread must never block or drop frame updates, regardless of how intense the backend CPU conversion is. Move all file streaming operations, regex scraping, and CLI sub-processes into asynchronous workers or background child tasks.
*   **Memory Ceiling:** Average runtime idle footprint must remain below 120MB RAM. Peak processing footprint during heavy 4K stream muxing cycles must not exceed 450MB RAM.

### 5.3 Distribution Size Optimization
*   Electron apps are naturally heavy because they bundle Chromium. Avoid adding large frameworks like React, Angular, or heavy UI icon libraries unless absolutely necessary. Stick to light, performance-focused frontend designs to keep the installer package small.

---

## 6. Binary Bundling & Multi-Platform Delivery Strategy

### 6.1 Internal Binary Structure
The product must pack stable, pre-compiled platform executables directly inside the installation container directory. The application must identify and map runtime operations dynamically to these internal relative paths:

```text
📦 application-root/
 └── 📂 binaries/
      ├── 📂 win32/
      │    ├── 📄 yt-dlp.exe
      │    └── 📄 ffmpeg.exe
      ├── 📂 darwin-x64/ (Intel Mac Core)
      │    ├── 📄 yt-dlp
      │    └── 📄 ffmpeg
      └── 📂 darwin-arm64/ (Apple M-Series Silicon)
           ├── 📄 yt-dlp
           └── 📄 ffmpeg
```

### 6.2 Operating System Execution Protocols
*   **Windows Configuration (`win32`):** Run background execution modules cleanly without showing unwanted flashing terminal command boxes or external command shell prompts to the end-user.
*   **macOS Configuration (`darwin`):** The app must run permission checks at startup. If needed, it must programmatically trigger execution flags (`chmod +x`) on the internal binary locations so gatekeeper systems don't throw permission errors.

### 6.3 Over-The-Air Core Driver Update Subsystem
Because media sites frequently update their players, `yt-dlp` updates often. The app can't require a full reinstall every time a video platform makes a minor tweak.
*   **Independent Core Updating:** Include a hidden check-for-updates sequence that verifies the version of the internal `yt-dlp` binary against its repository release log.
*   **In-Place Swapping:** Download the new utility binary asset directly to the local application cache directory, swap the outdated version out, and refresh the execution pipeline without needing to reinstall the core desktop application.

---

## 7. Out of Scope (Future Phases)

*   **Simultaneous Multi-Threaded Batch Processing:** Downloading or converting multi-video queues or complex channel libraries at the exact same moment (Phase 1 supports single links/playlists handled sequentially).
*   **Visual Timeline Editing Tools:** Adding visual UI timelines to cut video files, stitch audio tracks at specific timestamps, or preview effects inside this tool.
*   **Cloud Multi-Machine Synchronization:** Creating a remote server infrastructure database to save download logs, history archives, or custom format templates in the cloud.
