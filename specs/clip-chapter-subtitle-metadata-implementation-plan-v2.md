# MediaForge Desktop — Clip, Chapter, Subtitle & Metadata Packaging — Plan v2

Supersedes `specs/clip-chapter-subtitle-metadata-implementation-plan.md` (v1).

v1 was structurally sound but deferred every binary-behavior question to the implementing agent
("the agent must verify the installed yt-dlp option spelling…"). Those questions have now been
answered empirically against the **bundled** binaries, and six of the answers invalidate v1
design decisions. v1 also assumed repository facts that are not true today.

This document keeps v1's scope and its safety rules, replaces the parts the evidence contradicts,
and closes the gaps found by reading the current code.

**Precedence:** `AGENTS.md` > this plan > v1. Where this plan and v1 disagree, this plan wins;
v1 is retained only as the scope record.

---

## 0. Status of v1 (what changed and why)

| v1 § | v1 said | v2 says | Why |
|---|---|---|---|
| 8.3 | Section template "must include section number/start/end/label" | Template must key on **`section_start`/`section_end` only** | `%(section_number)s` and `%(section_title)s` render `NA` for `*start-end` sections (verified) |
| 8.3 | "Use a section-aware output template for multi-range jobs" | Non-negotiable, plus an orchestrator **count assertion** | Without it, sections silently overwrite each other *and* `after_move:filepath` prints the same path N times — a silent data loss that dedup would hide (verified) |
| 4.5 / 8.3 | Precise cut "may require FFmpeg to re-encode… can be slower" | Precise cut **re-encodes to MPEG-4 Part 2 by default** on the bundled LGPL FFmpeg; the encoder must be pinned | Verified: output codec was `mpeg4`, not H.264. Quality/compat regression, not just a speed cost |
| 8.4 | "For split all chapters, prefer yt-dlp's native chapter-splitting" | Strategy is **provenance-gated**; native split is one of two paths | `--split-chapters` splits on yt-dlp's own `chapters` field. MediaForge's chapter list is often **parsed from the description** — native split would produce zero files while the UI shows twelve |
| 9.2 / 9.3 | `after_move:filepath` is authoritative for primary outputs | True for sections, **false for `--split-chapters`** | Verified: a 22-chapter split printed exactly **one** line (the original). Chapter files are invisible to `--print` |
| 9.3 | "Exclude `.part`/`.ytdl`… classify by role" | Also: the original full file is **still produced** by `--split-chapters` | Verified: 22 chapter files **plus** the 5.1 MB source. ~2× disk, and the original must be classified deliberately |
| 13.3 | "Sidecar overhead gets a bounded fixed reserve" | `.info.json` reserve is **~2 MB per entry**, not a few KB | Verified: 980 KB `.info.json` for a **19-second** video |
| 9.7 | "Register the completion waiter before `downloadStart`… before this feature is complete" | **Already done** (P-08, `earlyResults` in `queueState.ts`) | Demoted to a regression-test line item |
| 6.3 | Subtitle packaging composes freely with clip/chapter selection | v1 delivery **disallows** it | Verified: subtitle sidecars and embedded tracks are **not retimed** to the section. A 10–14 s clip ships a full-video SRT whose cues are all wrong |
| 10.1 | "Extend `parseJobConfig`" | Extend **and repair** it | `parseJobConfig` already silently drops `audioBoost` and `isLive`. Adding fields to `JobConfig` without touching every `return` branch reproduces the bug |
| 3 (table) | "Reuse existing chapter retrieval" | Chapters must first be **brought to the Downloader path at all** | `MF_FETCH_CHAPTERS` is wired only into the search/preview surface; `MediaMetadata` has neither `chapters` nor `subtitles` |

---

## 1. Mission and scope (unchanged from v1, with one subtraction)

1. **Clip & Chapter Studio** — one custom range; multiple ranges; preserve chapters; split into
   per-chapter files; download selected chapters; fast vs. precise cut with an honest warning.
2. **Subtitle & Metadata Packaging** — discover manual/automatic tracks; download selected
   languages; embed where the container supports it; sidecar files; thumbnail and metadata
   embedding; optional `info.json` and description sidecars.

**Removed from v1 delivery:** subtitle packaging combined with a clip/chapter selection
(see §4.6). Everything else stands. Local-file inspection/editing stays deferred.

Existing behavior must be byte-identical when every new option is at its default.

## 2. Non-negotiable rules

All of v1 §2 applies unchanged. Read `AGENTS.md` §§2, 4, 6, 7, 8, 9, 10, 11 first. In particular:
no shell strings, no renderer fs/net/child-process, `spawn(bin, argv, {shell:false,
windowsHide:true})` only, all argv composed in `src/main/jobs/argBuilders.ts`, no new runtime
dependency, no regex-scraping of human-readable CLI output, verify-before-delete (AM-06).

Three additions specific to this feature:

- **Never build a filesystem path from a chapter title in app code.** Titles reach the filesystem
  only through a yt-dlp output template, then through `sanitizeFileName` at finalization.
- **Never build a regex from a chapter title.** `--download-sections` accepts a title regex; using
  it with untrusted titles is both a correctness and a ReDoS hazard. Use explicit time ranges.
- **Never log, IPC, or persist a subtitle or format URL.** Verified: these carry the user's public
  IP address and a signed expiry.

---

## 3. Verified binary behavior (the reference the implementation builds on)

Measured 2026-09-11 against the repository's own `binaries/win32/`:

- **yt-dlp `2026.08.19`**
- **FFmpeg**: BtbN LGPL build (AM-13). **No `libx264`/`libx265`.** H.264 encoding is available
  only as `libopenh264`, plus hardware encoders (`h264_nvenc`, `h264_qsv`, `h264_amf`, `h264_mf`).

All of the following flags exist on this binary: `--download-sections`,
`--force-keyframes-at-cuts`, `--split-chapters`, `--write-subs`, `--write-auto-subs`,
`--sub-langs`, `--sub-format`, `--convert-subs`, `--embed-subs`, `--embed-metadata`,
`--embed-chapters`, `--embed-thumbnail`, `--write-info-json`, `--write-description`,
`--remove-chapters`, `-P/--paths`, `-o [TYPES:]TEMPLATE`.

### V-01 — Multiple sections without a section-aware template destroy data, silently

```
-o "…%(title)s [%(id)s].%(ext)s"  --download-sections "*3-6"  --download-sections "*10-14"
```

Result: **one** file on disk (the second section overwrote the first), and **two identical**
`after_move:filepath` lines. Naive dedup of printed paths turns this into "1 output, success".

**Binding:** any job with more than one section MUST use a section-aware template, and the
orchestrator MUST assert `distinct validated primary paths === expected section count` before
reporting `completed`.

### V-02 — `section_number` and `section_title` are `NA` for time-range sections

`-o "…[sn=%(section_number)s st=%(section_start)s en=%(section_end)s ti=%(section_title)s]…"`
produced `[sn=NA st=3.25 en=6.5 ti=NA]`.

**Binding:** the section template keys on `section_start`/`section_end` only. Uniqueness of the
filename therefore rests entirely on range-uniqueness, which validation must guarantee
(§6.3 invariants: no duplicates, no overlaps). Values render at full precision (`3.25`, `6.5`),
so sub-second ranges do not collide.

Approved template:

```
%(title).150B [%(id)s] [%(section_start)s-%(section_end)s].%(ext)s
```

### V-03 — Under the `chapter:` output prefix, `section_number`/`section_title` DO work

`-o "chapter:…%(title).150B - %(section_number)03d %(section_title)s.%(ext)s"` produced
`… - 001 Introduction.mp4` … `… - 022 Final Note.mp4`. The asymmetry with V-02 is real and must
be encoded in two separate templates, not one shared helper.

### V-04 — `--split-chapters` keeps the original, and `--print` cannot see the chapter files

A 22-chapter split emitted **one** `after_move:filepath` line (the full source) and left
**23 files**: 22 chapter files plus the original 5.1 MB source.

**Binding:**

- Primary-output discovery for a split job is a **directory scan**, not the printed path.
- Disk preflight for a native split reserves **≈2× the source estimate**.
- The original file's fate is an explicit product decision (§4.4), not an accident of cleanup.

### V-05 — Precise cut re-encodes to MPEG-4 Part 2 on the bundled FFmpeg

| Job | Output video codec | Output audio codec |
|---|---|---|
| `--download-sections "*3-6"` (fast) | `av1` (source, stream-copied) | `opus` (source) |
| `--download-sections "*3.25-6.5" --force-keyframes-at-cuts` | **`mpeg4`** | `aac` |

`mpeg4` (MPEG-4 Part 2 / DivX-era) is a significant quality and device-compatibility regression
versus the source. It happens because FFmpeg falls back to the MP4 muxer's default video codec
when `libx264` is absent.

**Binding:** precise cut MUST pin an encoder explicitly (§8.4) and the choice MUST be verified by
an integration test that probes the output codec. Shipping the default is not acceptable.

### V-06 — Packaging artifacts and what `--print` reports

Full-video job with `--write-subs --write-auto-subs --sub-langs en --sub-format srt --embed-subs
--embed-metadata --embed-thumbnail --write-info-json --write-description`:

- `after_move:filepath` printed **only the `.mp4`**. Sidecars are invisible to `--print`.
- On disk: `.mp4`, `.en.srt`, `.info.json`, `.description`. No stray thumbnail file.
- `--sub-format srt` works on YouTube (no `--convert-subs` needed for srt).
- `--write-subs` + `--write-auto-subs` + one language produced **one** file (manual wins), not two.
- The MP4's streams: `av1` video, `opus` audio, **`mov_text` subtitle (eng)**, `bin_data`
  (chapters), **`png` attached_pic** (thumbnail). Embedding works; note the cover art appears as a
  *second video stream* in MP4, which some players list as a track.

### V-07 — `.info.json` is large and carries the user's IP

For a **19-second** video: `979,752 bytes`, containing `googlevideo.com` × 52,
`api/timedtext` × 2198, and the machine's public IP address × 36.

**Binding:** disk reserve ≈2 MB per entry for `writeInfoJson`; the UI must state plainly that
`info.json` contains expiring, IP-bearing URLs before the user enables it.

### V-08 — Sidecars are emitted per section, and subtitles are NOT retimed

Two sections + `--write-subs --write-info-json --write-description` produced **8** files: two
`.mp4`, two `.description`, two `.info.json`, two `.en.srt`. Both `.en.srt` files were **416 bytes
— identical to the full-video subtitle**, i.e. cues timed against the original, not the clip.

**Binding:** see §4.6. Subtitle packaging is disabled for ranged/split jobs in this delivery.

### V-09 — Unsupported-partial-download failure is unclassified

Sections against a format that cannot be range-fetched exit non-zero with
`ERROR: This format cannot be partially downloaded. Aborting`. `classifyStderr` has no rule for
it, so it surfaces as `MF_UNKNOWN` → *"Something went wrong. Open the logs folder for details."*

**Binding:** add a rule and a dedicated code (§10.2).

### V-10 — Chapter extraction works, but is a per-video runtime fact

`%(chapters)j` returned full arrays with `start_time`/`title`/`end_time` for 4 of 6 sampled videos
and `NA` for the rest (those genuinely have no chapters). A `WARNING: … No supported JavaScript
runtime could be found … YouTube extraction without a JS runtime has been deprecated` is emitted on
every YouTube call by this binary. Chapter availability must always be treated as per-video, never
inferred from the platform.

---

## 4. Product decisions

### 4.1 Defaults (unchanged from v1)

Full media; preserve chapters; every subtitle/metadata/JSON/description option off; fast cut.
Defaults produce byte-identical argv to today — enforced by a snapshot test (§15.3 case 1).

### 4.2 Playlist behavior (unchanged from v1)

Packaging applies per entry, deep-cloned per entry (§12). Clip/chapter controls are single-video
only; the playlist message is v1's, verbatim.

### 4.3 Live behavior

Clip/chapter selection disabled for live. **This must be enforced in the main process, which
currently cannot see `isLive` at all** — see L-03. Packaging stays available. The existing
stop/finalize path must keep working (and, per L-03, must start working).

### 4.4 Output semantics

v1 §4.4 stands (`outputPath` = first primary, `outputPaths`, `sidecarPaths`, completion requires
every primary present and non-zero). Two additions:

- **The original file from a native chapter split is an auxiliary output, not a primary one.**
  Default: **deleted** after every selected chapter file is verified. A future "keep full video
  too" option may promote it; this delivery does not expose one. Disk preflight still reserves it.
- **A job may legitimately produce fewer artifacts than requested.** If the source advertises no
  subtitle/description/thumbnail, the job completes with a warning. It must never fabricate an
  artifact, and it must never report `completed` with zero primaries.

### 4.5 Cut semantics (rewritten — V-05)

- **Fast cut** — `--download-sections` alone. Stream-copied; verified to preserve source codecs.
  Cut lands on a nearby keyframe. Default. Never call it "frame-accurate".
- **Precise cut** — adds `--force-keyframes-at-cuts`. **Re-encodes the whole selected range.**
  The UI copy must say so: *"Precise cut re-encodes the clip. It is much slower and the result is
  re-compressed, not a copy of the original."*
- The encoder is pinned (§8.4). The UI shows the resolved encoder name in the job detail line.
- Mixed fast/precise across ranges in one job is rejected at validation (v1's call, kept).

### 4.6 Subtitles are mutually exclusive with clip/chapter selection (new)

Because subtitle tracks are not retimed (V-08), a clip's sidecar and embedded subtitles are wrong
by construction. This delivery:

- Disables the subtitle section of the Packaging panel whenever `clipSelection.kind !== 'full'`,
  with: *"Subtitles can't be trimmed to a clip yet — their timings would refer to the full video.
  Download the full video to include subtitles."*
- Rejects the combination server-side with `MF_PACKAGING_INCOMPATIBLE`.
- `embedMetadata`, `embedThumbnail`, `writeInfoJson`, `writeDescription` remain available for
  ranged jobs (they are not time-dependent).

Subtitle retiming (offsetting cues by `section_start` and clipping to the range) is a well-defined
follow-up; it is out of scope here rather than silently broken.

---

## 5. Target user flows

v1 §5.1–5.4 are accepted as written, with two amendments:

- §5.2 step 4 ("one yt-dlp job with multiple section arguments") is confirmed correct and is now
  load-bearing: one spawn, N sections, N distinct outputs (V-01/V-02).
- §5.4 step 3 is gated by §4.6 when a clip/chapter selection is active.

---

## 6. Data model

### 6.1 Chapter model — repaired first (new, blocking)

Today's `ChapterMarker` cannot express a download range:

```ts
// current — src/shared/models.ts
export interface ChapterMarker { time: string; title: string; seconds: number; duration?: string }
```

`parseChaptersOutput` reads yt-dlp's `end_time` and **throws it away** after formatting a display
string, and floors `start_time` to whole seconds. `parseChaptersFromDescription` has no end time at
all for the last chapter, and derives the others by subtraction.

Extend, keeping every existing field for back-compat:

```ts
export type ChapterSource = 'extractor' | 'description'

export interface ChapterMarker {
  time: string
  title: string
  seconds: number
  duration?: string
  /** Exact start, unfloored. */
  startSec?: number
  /** Exact end when the extractor supplied one, or the next chapter's start. */
  endSec?: number | null
  /** Where this list came from. Gates the split strategy (§8.5). */
  source?: ChapterSource
}
```

`parseChaptersOutput` must populate `startSec`/`endSec`/`source: 'extractor'`.
`parseChaptersFromDescription` must populate `startSec`, `endSec` (next start, `null` for the
last), and `source: 'description'`.

**Also tighten `parseChaptersFromDescription`.** It currently promotes *any* line containing a
`m:ss` to a chapter — fine for a preview list, unacceptable as a download plan. Require: ≥2
entries, strictly increasing starts, first start ≤ 5 s, and cap at `MAX_CLIP_RANGES`. Below that
bar, return `[]` so the UI honestly says "no chapters" instead of offering a bad split.

### 6.2 Subtitle availability model (v1 §6.1, accepted)

```ts
export type SubtitleSource = 'manual' | 'automatic'
export interface SubtitleTrack {
  language: string
  label: string | null
  source: SubtitleSource
  formats: string[]
}
```

Added to `MediaMetadata` as `subtitles: SubtitleTrack[]`. Missing/malformed → `[]`. **No URLs,
ever** (V-07 shows what those URLs contain). Bounds:

```ts
export const MAX_SUBTITLE_TRACKS = 200
export const MAX_SUBTITLE_LANGUAGES_PER_JOB = 20
export const MAX_SUBTITLE_FORMATS_PER_TRACK = 20
export const MAX_CLIP_RANGES = 50
export const MAX_CLIP_DURATION_SEC = 24 * 60 * 60
/** New: hard ceiling on artifacts one job may finalize (primaries + sidecars). */
export const MAX_JOB_ARTIFACTS = 256
```

`MAX_JOB_ARTIFACTS` closes a gap in v1: 20 languages × `both` × 50 ranges is an unbounded
finalization set. Exceeding it is a validation error, not a runtime surprise.

### 6.3 Clip and chapter model (v1 §6.2, accepted with `ClipSelection` mandatory)

```ts
export type CutMode = 'fast' | 'precise'
export interface ClipRange { startSec: number; endSec: number; label?: string; cutMode: CutMode }
export type ChapterMode = 'preserve' | 'split' | 'selected'
export interface ChapterOptions { mode: ChapterMode; selectedIndexes?: number[] }

export type ClipSelection =
  | { kind: 'full' }
  | { kind: 'ranges'; ranges: ClipRange[] }
  | { kind: 'chapters'; chapterOptions: ChapterOptions }
```

Use the discriminated union — v1 offered it as optional; it is required, because it makes
"arbitrary ranges *and* chapter options in one request" unrepresentable rather than merely
discouraged.

Invariants (v1's, kept, plus three):

- finite numbers; `0 <= startSec < endSec`; `endSec - startSec >= 0.1`;
  `<= MAX_CLIP_DURATION_SEC`; `<= durationSec + 0.5` when duration is known.
- `selectedIndexes`: unique non-negative integers, sorted ascending by main, required only for
  `mode: 'selected'`, each `< chapters.length`.
- `ranges`: no duplicates, **no overlaps** — now load-bearing, because V-02 makes `start-end` the
  filename key.
- **New:** all ranges share one `cutMode`, or validation fails.
- **New:** `kind: 'chapters'` with `mode: 'split' | 'selected'` requires a main-process-held chapter
  list for this exact URL generation (§7.2). The renderer's chapter data is advisory.
- **New:** total projected artifacts ≤ `MAX_JOB_ARTIFACTS`.

### 6.4 Packaging model (v1 §6.3, accepted)

```ts
export type SubtitleSelectionMode = 'manual' | 'automatic' | 'both'
export type SubtitleFormat = 'best' | 'vtt' | 'srt' | 'ass'
export interface SubtitleOptions {
  enabled: boolean; selection: SubtitleSelectionMode; languages: string[]
  format: SubtitleFormat; embed: boolean; sidecar: boolean
}
export interface PackagingOptions {
  subtitles?: SubtitleOptions
  embedMetadata: boolean; embedThumbnail: boolean
  writeInfoJson: boolean; writeDescription: boolean
}
```

Invariants per v1 (disabled ⇒ no flags; enabled ⇒ ≥1 normalized language; enabled ⇒ `embed` or
`sidecar`; allowlisted `format` only), plus: `subtitles.enabled` requires
`clipSelection.kind === 'full'` (§4.6).

`JobConfig` gains `clipSelection?: ClipSelection` and `packaging?: PackagingOptions`.

### 6.5 Completion artifact model (v1 §6.4, accepted)

`JobDonePayload` gains `outputPaths?`, `sidecarPaths?`, `warningMessages?`. One primary → set both
`outputPath` and `outputPaths: [outputPath]`. Zero primaries → never `completed`. Paths are emitted
only after validation as descendants of the destination or the job temp dir.

---

## 7. Metadata & chapter plumbing

### 7.1 Subtitles come free from the existing `-J` call

`buildAnalyzeArgs` already runs `-J`; `--flat-playlist` only suppresses *playlist entry* expansion,
so a single-video analyze already carries `subtitles` and `automatic_captions`. Map them in
`mapRawInfo`:

- `subtitles` → `source: 'manual'`; `automatic_captions` → `source: 'automatic'`.
- Language keys only. Dedupe by `(language, source)`. Sort by language, then label.
- Bounded `formats: string[]` from each descriptor's `ext`, capped at
  `MAX_SUBTITLE_FORMATS_PER_TRACK`.
- Malformed entries are skipped, never fatal.
- **No `url` field is copied anywhere.** A test asserts no `http` substring survives into
  `MediaMetadata`.

This costs zero extra spawns.

### 7.2 Chapters must be brought to the Downloader path (new)

Chapters today exist only on the search/preview surface: `MF_FETCH_CHAPTERS` →
`SearchService.fetchChapters` (a second yt-dlp spawn using `--print %(chapters)j`), cached in the
renderer's `chaptersCache` LRU keyed by URL. The Downloader/`UrlBar` analyze path has no chapters,
and `MediaMetadata` has no chapter field.

Chosen approach — **reuse the existing IPC, add main-process authority**:

- The renderer's Clip & Chapter panel calls the existing `fetchChaptersDeduped(url, requestId)`.
- `SearchService` retains the last resolved `(url, generation, chapters)` for the Downloader.
- `parseJobConfig` resolves `kind: 'chapters'` against **that** list, not the renderer's payload.
  A mismatch is `MF_INVALID_CLIP` ("Re-analyze this video before splitting chapters").

Rationale: no third spawn, no change to the analyze contract, and the renderer's chapter data stops
being trusted for filesystem-affecting decisions.

### 7.3 Analysis cancellation and stale results (v1 §7.3, accepted)

The renderer generation-token pattern already exists (`tests/renderer/analyzeGeneration.test.ts`).
Extend it to chapters and subtitles: late results for a superseded generation are dropped, never
merged. No timing delays. Main-process request identity is the authority.

### 7.4 Capability helpers (v1 §7.2, accepted, with additions)

Pure, Electron-free, Vitest-testable:

```
normalizeSubtitleLanguage(value)             normalizeSubtitleLanguages(values)
subtitleTracksForLanguage(metadata, lang)    supportsEmbeddedSubtitles(container, fmt)
resolvePackagingWarnings(metadata, config)
validateClipSelection(selection, durationSec, chapters)
chaptersToRanges(chapters, indexes, durationSec)      // new — the only chapter→range converter
chooseChapterStrategy(chapters, selection, estimate)  // new — §8.5
```

`chaptersToRanges` owns the last-chapter-has-no-end problem: it closes the final range at
`durationSec` when known, and refuses the chapter (with a warning) when it is not.

---

## 8. Argument builders

### 8.1 Base args unchanged

`buildBaseDownloadArgs` keeps `--newline`, `--progress`, `--progress-delta 0.25`, `--no-colors`,
`--windows-filenames`, `--trim-filenames 200`, `--ffmpeg-location`, both progress templates,
`--print after_move:filepath`, and cookie handling — all in their current order. New flags are
appended by dedicated pure builders so the existing M3 snapshots stay readable and stable.

```ts
buildClipArgs(selection): string[]
buildChapterArgs(strategy, ranges?): string[]
buildSubtitleArgs(options): string[]
buildPackagingArgs(options): string[]
outputTemplatesFor(tempJobDir, selection): string[]   // returns -o pairs, possibly two
```

`outputTemplatesFor` is new and replaces `outputTemplateFor` at the composition site. It returns
`['-o', <main>]`, plus `['-o', 'chapter:<chapterTemplate>']` for a native split. This is the only
place the V-02/V-03 template asymmetry lives.

### 8.2 Full media

No section flags. `preserve` adds nothing (yt-dlp already carries chapters into the container when
`--embed-metadata` is on; `--embed-chapters` is added only when the user enables metadata embedding
and chapters exist). Never emit an empty `--download-sections`.

### 8.3 Custom ranges

One `--download-sections *<start>-<end>` argv element per validated range, in ascending start
order. Main template:

```
%(title).150B [%(id)s] [%(section_start)s-%(section_end)s].%(ext)s
```

`--force-keyframes-at-cuts` is appended once when `cutMode === 'precise'` (all ranges share it,
§6.3). `section_number`/`section_title` are never referenced (V-02).

### 8.4 Precise-cut encoder pinning (new — closes V-05)

Precise cut must not inherit FFmpeg's MP4 default. Resolve an encoder at build time and pass it
through yt-dlp's downloader/postprocessor arg channel (both are argv elements; no shell):

1. Probe once per app run: `ffmpeg -hide_banner -encoders`, cached.
2. Preference order: `libx264` (absent in the bundled LGPL build, but present if a user override
   supplies a GPL FFmpeg — AM-03's userData override) → `libopenh264` → `h264_nvenc` →
   `h264_qsv` → `h264_amf` → `h264_mf`.
3. If none resolve, **precise cut is unavailable**: the UI disables it with the reason, and the
   main process rejects it with `MF_PRECISE_CUT_UNAVAILABLE`. It does not silently fall back to
   `mpeg4`, and it does not silently fall back to fast cut.
4. The resolved name is logged once per job and shown in the job detail line.

Hardware encoders are offered only after a successful one-frame smoke encode, cached per run — an
`h264_nvenc` entry in `-encoders` does not mean a usable GPU is present.

Acceptance: an integration test runs a precise cut and `ffprobe`s the output; `codec_name` must be
`h264`. A `mpeg4` result fails the build.

### 8.5 Chapter split — provenance-gated strategy (rewritten — closes V-04 and the description-chapter hole)

`chooseChapterStrategy` returns one of:

| Strategy | Chosen when | Flags | Outputs |
|---|---|---|---|
| `native-split` | `source === 'extractor'` **and** (all chapters selected **or** selected > 5) | `--split-chapters` + `chapter:` template (V-03) | full source + one file per chapter; non-selected chapter files and the source are discarded at finalization |
| `explicit-sections` | `source === 'description'`, **or** selected ≤ 5 | one `--download-sections *start-end` per selected chapter, main template (V-02) | exactly the selected chapters |

Rationale:

- `--split-chapters` reads yt-dlp's own `chapters`; description-derived chapters are invisible to it
  and would produce **zero** chapter files while the UI promised N. `explicit-sections` works from
  the app's own numbers and therefore works for both provenances.
- `explicit-sections` costs one partial fetch per chapter, so it is the wrong tool for 22 chapters
  and the right tool for 2.
- `native-split` downloads the source once and splits with a stream copy — far faster for a full
  split, at ~2× peak disk (V-04).

Both strategies pass chapter titles to the filesystem **only** through the yt-dlp template, then
through `sanitizeFileName` at finalization.

### 8.6 Subtitle args (verified mapping)

| Selection | Flags |
|---|---|
| Manual | `--write-subs` |
| Automatic | `--write-auto-subs` |
| Both | both (verified: one language yields one file, manual preferred — no duplication) |
| Languages | `--sub-langs <comma-joined normalized codes>` — one argv element |
| Format | `--sub-format <best\|vtt\|srt\|ass>` (verified: `srt` works on YouTube without `--convert-subs`) |
| Embed | `--embed-subs` |
| Sidecar | `--write-subs`/`--write-auto-subs` retained; embed-only still needs a write flag, and the sidecar is then deleted at finalization |

Emitted only when `subtitles.enabled` **and** `clipSelection.kind === 'full'` (§4.6).

### 8.7 Metadata args (verified mapping)

| Selection | Flags |
|---|---|
| Embed metadata | `--embed-metadata` (`--embed-chapters` alongside when chapters exist) |
| Embed thumbnail | `--embed-thumbnail` |
| Write info JSON | `--write-info-json` |
| Write description | `--write-description` |

UI note required for `embedThumbnail` on MP4: verified to land as a `png` attached-picture stream,
which some players list as a second video track.

### 8.8 Argument-safety tests (v1 §8.7, accepted, plus)

- A malicious URL stays one argv element.
- `en,fr` is one argv value; no shell syntax anywhere.
- A chapter title containing `&`, `|`, `"`, `<`, `>`, `/`, `\` never appears in an app-built path.
- No empty language, range, or format argument is ever emitted.
- Disabled options emit no related flags.
- **New:** existing M3 mode snapshots are byte-identical with new options at defaults.
- **New:** two ranges never produce the same rendered template output.
- **New:** a precise-cut job always carries an explicit encoder argument.

---

## 9. Orchestrator and finalization

The highest-risk area. No UI lands before this is proven.

### 9.0 Four repository loopholes that must be closed first (new)

**L-01 — The temp directory is not job-unique.**

```ts
// src/main/jobs/orchestrator.ts
function tempDirForUrl(tempRoot, url) {
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 16)
  return join(tempRoot, `job-${hash}`)
}
```

Every job for a given URL shares one directory. Today that is survivable because discovery uses a
single printed path. The moment discovery becomes a directory scan (§9.3), a clip job and a
full-media job of the same URL — or two clip jobs with different ranges — cross-contaminate each
other's artifact sets.

Fix: hash `url` **plus a canonical job-shape key** (mode + quality + a stable serialization of
`clipSelection` and `packaging`). It must stay stable across retries and resume of the same
configuration (AM-05 depends on `.part` reuse), and differ whenever the artifact set differs.

**L-02 — The duplicate-download manifest ignores the new options.**

`qualityKeyFor` switches on mode/tier/container/audioFormat only. A user who downloads a full video
and then asks for a 10-second clip at the same quality gets `skipped: true` and the **full video**
handed back as the clip. Fix: fold the same canonical job-shape key from L-01 into `qualityKeyFor`.
Old manifest records lacking it simply stop matching — the correct, safe outcome.

**L-03 — `parseJobConfig` silently drops fields, today.**

`JobConfig` declares `audioBoost` and `isLive`; `parseJobConfig` reads neither, and none of its
three `return` branches forwards them. Consequences already shipped: the Audio Boost selector does
nothing, and `orchestrator.finalizeLiveRecording` (the live "Stop & Save" path) is unreachable.

Adding `clipSelection`/`packaging` to the type reproduces this exactly. Fix:

1. Restructure `parseJobConfig` to build one validated `base` object that every branch spreads.
2. Parse and forward `audioBoost` (allowlist `AUDIO_BOOST_OPTIONS`) and `isLive` (boolean).
3. Add a test that, for each mode, round-trips a config with **every** `JobConfig` field set and
   asserts no field is lost. This test is the guard that keeps L-03 closed.

This is in scope: §4.3 ("clip/chapter disabled for live") cannot be enforced in main while `isLive`
never arrives there.

**L-04 — Batch target computation collides with itself.**

`collisionFreeTarget(destDir, name)` re-reads the destination directory per call. v1 §9.4 step 2
says "compute collision-free targets for every artifact" *before* moving — with two chapters whose
sanitized names are equal (easy: `sanitizeFileName` maps every non-BMP code point to `-`, so `🎵`
and `🎶` both become `-`), both resolve to the same target and one file is destroyed.

Fix: `collisionFreeTargets(destDir, names[])`, reading the directory **once** and reserving each
chosen name in an in-memory set as it goes. Single-name `collisionFreeTarget` delegates to it.

### 9.1 Per-job artifact state (v1 §9.1, accepted)

```ts
interface JobArtifacts {
  printedPrimaryPaths: string[]
  discoveredPrimaryPaths: string[]
  sidecarPaths: string[]
  warnings: string[]                    // capped
  expectedPrimaryCount: number | null   // new — from the section/chapter plan
  preSpawnEntries: Set<string>          // new — see §9.6
}
```

Per job, cleared on every terminal path. Never module-level.

### 9.2 Process output handling (v1 §9.2, accepted)

`capture: { stdout: 'none', stderr: 'tail', tailLines: 100 }` stays. Retain only: validated printed
primary paths (now an array, still bounded by `MAX_JOB_ARTIFACTS`), the latest progress event, and
the stderr tail. P-01's bounded retention is not relaxed for multi-output.

`after_move:filepath` is authoritative **for section-based jobs only**. For `native-split` it
reports the original source, not the chapter files (V-04).

### 9.3 Artifact discovery (rewritten)

After a zero-exit yt-dlp:

1. Normalize each printed path; require it to resolve inside the job temp dir (or the controlled
   staging root); reject anything else.
2. Stat it: must be a regular file, size > 0.
3. **Dedupe, then assert.** For `ranges`/`explicit-sections`:
   `distinct printed paths === expectedPrimaryCount`. A shortfall is a **failure**
   (`MF_OUTPUT_FINALIZATION`), never a silent success — V-01 is exactly this failure mode.
4. For `native-split`: the printed path is the original source. Enumerate the job directory
   asynchronously and classify chapter files by the `chapter:` template's shape and extension.
   Assert `found === expected selected count`.
5. Classify every remaining file:
   - subtitle sidecars by requested language + known extension (`.srt`/`.vtt`/`.ass`),
   - `.info.json` / `.description` when requested,
   - thumbnail files when requested and not embedded,
   - `.part` / `.ytdl` / temp → excluded from the artifact set entirely.
6. The `native-split` original is classified as `discarded-source` (§4.4).
7. Anything unclassified → **fail safe**: retain the temp directory, report
   `MF_OUTPUT_FINALIZATION` with the count, never guess.

**`findLargestCompletedFile` is used only when** the job is single-output **and** packaging wrote no
sidecars. With `--write-info-json` on, "largest file wins" can return a 980 KB `.info.json` instead
of a short clip (V-07). Guard it on both conditions, not just output count.

### 9.4 Finalization transaction (v1 §9.4, accepted, with L-04)

1. `mkdir` destination (async).
2. `collisionFreeTargets(destDir, allNames)` — one directory read, reserved set (L-04).
3. Rename within volume; `copyFile` only on `EXDEV` (the existing `moveIntoPlace` semantics,
   including the heartbeat, are reused unchanged).
4. Verify each destination exists and is non-zero **before** unlinking its source (AM-06).
5. Any required **primary** move failure → retain every recoverable source, report failure.
6. An optional **sidecar** failure → warning; the source stays in the partial directory.
7. `rm` the temp tree only after all primaries verify and all sidecar decisions resolve.
8. Exactly one terminal completion event carrying every finalized path.

Primaries are moved before sidecars, so a mid-batch failure never leaves a job claiming success with
the media missing.

### 9.5 Progress phases (v1 §9.5, accepted)

Enum unchanged (`queued`/`downloading-video`/`downloading-audio`/`merging`/`finalizing`/`done`) —
detail rides in `message`: `Downloading clip 2 of 4`, `Splitting chapters: 3 of 12`,
`Downloading subtitles`, `Embedding metadata and thumbnail`, `Finalizing 5 output files`,
`Re-encoding (precise cut) — this is slower than a fast cut`.

Coalescing stays at the existing cadence (P-04, ≤ ~4/s/job). No per-sidecar IPC event.

### 9.6 Retry, cancel, resume (v1 §9.6, accepted, plus a new hazard)

**New — stale artifacts across attempts.** Retry re-spawns into the *same* temp directory, which now
holds attempt 1's completed outputs. A directory scan after attempt 2 would report attempt 1's files
as current outputs.

Fix: snapshot `preSpawnEntries` (name + mtimeMs + size) before each spawn; discovery counts only
entries that are new or changed. `printedPrimaryPaths` is reset before each attempt and the final
list is deduped.

Everything else per v1: cancel kills the tree and retains partials; cancel during finalization stops
further moves where safe and retains unmoved sources; resume reuses the identical
clip/chapter/packaging config and templates (guaranteed by the L-01 key); a successful retry never
carries stale artifacts; a partial cancel reports precisely which outputs were finalized and which
remain in the partial directory.

### 9.7 Completion race — already solved

`queueState.ts` buffers terminal events in `earlyResults` (bounded at 32) when `job:done` beats
`waitForJob`. v1 listed this as work; it is done. Remaining scope: **regression tests only**, for
immediate success, immediate failure, skipped download, and immediate cancellation — all of which
get much more likely with three-second clips.

---

## 10. IPC contract and validation

### 10.1 Request validation

Extend `parseJobConfig` (after the L-03 restructure). It must:

- Reject unknown modes; validate the `clipSelection` discriminant.
- Validate every range and selected chapter index against §6.3.
- Resolve `kind: 'chapters'` against the **main-process** chapter list for this URL (§7.2).
- Cap range count, language count, string lengths, and total artifacts (`MAX_JOB_ARTIFACTS`).
- Normalize and dedupe language codes; allow only `best`/`vtt`/`srt`/`ass`.
- Reject subtitles combined with a non-`full` selection (§4.6).
- Reject `precise` when no encoder resolves (§8.4).
- Reject clip/chapter selection when `isLive` (now possible — L-03).
- Validate packaging booleans; ignore unknown keys rather than spreading them into config.
- Never trust renderer-supplied duration, chapter labels, output paths, or size estimates.

### 10.2 Error codes

Add, and update `MfErrorCode`, `ERROR_MESSAGES`, `classifyStderr` rules, the classification tests,
and the renderer's error display together:

| Code | Message |
|---|---|
| `MF_INVALID_CLIP` | "That clip selection isn't valid. Check the start and end times." |
| `MF_PACKAGING_INCOMPATIBLE` | "Those packaging options can't be combined with this download." |
| `MF_SUBTITLES_UNAVAILABLE` | "This source has no subtitles in the languages you selected." |
| `MF_OUTPUT_FINALIZATION` | "Some output files couldn't be verified. Your partial files were kept." |
| `MF_SECTION_UNSUPPORTED` | "This source can't be downloaded in sections. Download the full media instead." |
| `MF_PRECISE_CUT_UNAVAILABLE` | "Precise cut needs a video encoder this build doesn't have. Use fast cut." |

`classifyStderr` gains `[MF_SECTION_UNSUPPORTED, /cannot be partially downloaded/i]`, placed before
the `MF_EXTRACTOR_STALE` rule (V-09). Raw stderr is never the primary user-facing message.

### 10.3 Metadata flow

The renderer receives typed availability only. The preload surface stays a narrow typed API — no
`ipcRenderer`, no paths, no arbitrary channels.

---

## 11. Renderer

### 11.1 Components (v1 §11.1, accepted)

`ClipChapterPanel.tsx`, `TimeRangeEditor.tsx`, `ChapterPicker.tsx`, `SubtitlePackagingPanel.tsx`,
`MetadataPackagingPanel.tsx`, `OutputArtifactSummary.tsx`. Shared primitives go to
`components/ui.tsx` only when genuinely reused. `ModeSelector` does not grow.

### 11.2 State (v1 §11.2, accepted)

One typed `JobSelection` is the source of truth. Reset clip/chapter state on a new analysis and on
URL change; preserve generic packaging across compatible mode tabs; clear incompatible options
immediately on container/mode change; never push an invalid value up on keystroke — keep the last
valid selection and show inline validation.

### 11.3 Clip editor (v1 §11.3, accepted)

Numeric `HH:MM:SS.mmm` inputs are sufficient here. Required: parsing, clear invalid-time messages,
bounds, duration display, add/remove/reorder, chapter→range action, preview/jump through the
existing player, cut-mode explanation, output count, and disk estimate. No canvas or chart
dependency (AM-12).

### 11.4 Chapter picker (v1 §11.4, accepted, plus provenance)

Rows: checkbox, number, timestamp, safe title, duration, preview/jump. Actions: select all, clear
all, split all, download selected.

**New:** when `source === 'description'`, label the list *"Chapters read from the video
description"* and explain that timings are approximate. This is the user-visible face of §8.5's
strategy split.

Large lists use the existing `VirtualList`/`content-visibility` approach. Playback ticks must not
rerender the panel.

### 11.5 Subtitle UI (v1 §11.5, accepted, plus §4.6)

Three states: none found; found but selected language unavailable; available and selectable.
Manual/automatic badges per language. Never render a subtitle URL. Controls:
manual/automatic/both, language multi-select, format, embed, sidecar.

When embedding is incompatible with the container, explain and offer sidecar — do **not** silently
switch. When a clip/chapter selection is active, the whole section is disabled with §4.6's copy.

### 11.6 Metadata UI (v1 §11.6, accepted, plus V-07)

Explicit checkboxes with one-line explanations. `Save info.json` carries:
*"Includes technical details and temporary media links tied to your connection. Roughly 1 MB per
video."*

Pre-download "Additional files" summary, per v1.

### 11.7 Completion UI (v1 §11.7, accepted)

Supports one file, many files, sidecars, warnings, reveal folder, open primary. Long artifact lists
are capped with a summary row — a 200-chapter split must not render 200 rows synchronously.

---

## 12. Queue and persistence

v1 §12 is accepted in full:

- Display-only `outputCount`, `sidecarCount`, `warningCount`, `operationLabel` ("3 clips",
  "split chapters").
- No subtitle URLs or temp paths in the persisted snapshot.
- Old snapshots load with defaults; new fields validated and bounded
  (`tests/unit/queueSerialization.test.ts` is the existing home for this).
- Saved numeric ranges stay authoritative only while the URL identity matches; otherwise the row is
  marked **"Needs re-analysis"**. No chapter reconstruction after restart.
- Playlist entries get a **deep-cloned, immutable** packaging config each; language arrays are never
  shared; each entry's sidecars stay with its own primary; a failed sidecar cannot contaminate the
  next entry's discovery (L-01's per-job temp key is what makes this true).

---

## 13. Filesystem and naming

### 13.1 Templates

Two, per V-02/V-03 (§8.1). App-side finalization remains defense-in-depth: illegal Windows
characters, control characters, reserved device names, trailing dots/spaces, the 200-character cap,
extension preservation, and case-insensitive `_1`/`_2` collision resolution — all already in
`sanitizeFileName`/`collisionFreeTarget`, now batch-safe via L-04.

**Test the non-BMP path explicitly.** Verified: yt-dlp's own output kept `👩‍💻` in a filename;
`sanitizeFileName` replaces each non-BMP code point with `-`, so a ZWJ emoji sequence collapses to
several dashes and two emoji-only chapter titles collide. L-04 must resolve that to `_1`.

### 13.2 Sidecar association

By sanitized basename within the job-local directory. Never by parsing log lines. Ambiguous
association → keep the files in the partial directory and surface a warning or failure requiring
review.

### 13.3 Disk estimates (rewritten — V-04/V-07)

| Selection | Reserve |
|---|---|
| Full media | existing selected-format estimate |
| N ranges | `sum(range duration / total duration) × estimate`, floored at 10% of the estimate per range; when duration is unknown, reserve the full estimate per range |
| `explicit-sections` chapters | as above, per selected chapter |
| `native-split` chapters | **2 × estimate** (source + splits coexist — V-04) |
| `writeInfoJson` | **2 MB per entry** (V-07) |
| `writeDescription` | 64 KB per entry |
| subtitles | 512 KB per language per entry |
| thumbnail (non-embedded) | 2 MB per entry |

Parallel playlist runs keep reserving the **sum** of in-flight estimates (AM-07). The main process
computes these from analyzed metadata — it does not trust the renderer's `estimatedBytes`. When the
estimate is genuinely unknown, show "size estimate unavailable" and keep today's behavior rather
than inventing precision.

---

## 14. Performance and memory guardrails

v1 §14 stands. Restated where this feature could regress it:

**Main:** no full-stdout retention for multi-output; bounded stderr tails; async `readdir`/`stat` and
async moves; never read an artifact into memory to move it; coalesced progress; capped warning and
artifact lists (`MAX_JOB_ARTIFACTS`).

**Renderer:** chapter selection must not rerender the preview card on a playback tick; stable
callbacks; windowed chapter lists; bounded selected-index set (never clone `MediaMetadata` per
checkbox); no subtitle content preloading; never render full subtitle text in the config screen.

**Targets (AM-16 budgets remain the frame — private bytes is the primary figure):**

- 1,000-chapter list stays responsive on add/remove.
- 5,000-cue payload: no monotonic renderer growth across 20 open/close cycles.
- Two-hour recording, packaging on and off: stable Electron memory.
- 50-output chapter split: no full CLI transcript retained.
- Routine progress IPC ≤ 5 updates/sec/job.
- Idle ≤ 200 MB summed private / ≤ 380 MB summed working set; marginal cost over a bare-window
  baseline ≤ 60 MB private; peak ≤ 450 MB.

Measured with `npm run perf` (`scripts/perf-bench.mjs`), recorded in `specs/perf-report.md`.

---

## 15. Tests and fixtures

### 15.1 Shared-model tests

v1 §15.1's table (time parsing, zero-length, NaN/Infinity/negative/huge, end-before-start, overlap,
duplicate and out-of-range chapter indexes, range cap, language normalization/dedup, unsupported
formats, packaging with no output enabled, embed/sidecar compatibility, missing availability),
**plus**:

- mixed `cutMode` across ranges → rejected.
- subtitles + non-`full` selection → rejected (§4.6).
- artifact count over `MAX_JOB_ARTIFACTS` → rejected.
- `chaptersToRanges`: last chapter with no `endSec` and no known duration → refused with a warning.
- `parseChaptersFromDescription` tightening: a description with one stray timestamp yields `[]`.
- `chooseChapterStrategy` truth table across provenance × selection size.

### 15.2 Metadata fixtures

Redacted `-J` fixtures in the existing `tests/unit/metadata.test.ts` style, covering: manual
subtitles in several languages; automatic captions with differing formats; no subtitles; chapters
with unsafe titles; chapters with duplicate timestamps or a missing end; a live stream with no
chapters; two playlist entries with different subtitle availability.

**Assert that no mapped `MediaMetadata` contains `http`** — the direct test of V-07's privacy rule.

### 15.3 Argument snapshots

v1's fourteen cases, plus five:

15. Precise cut carries an explicit encoder argument.
16. `native-split` emits **two** `-o` arguments (main + `chapter:`).
17. `explicit-sections` for selected chapters emits no `--split-chapters`.
18. Description-provenance chapters never emit `--split-chapters`.
19. Two ranges never render to the same template output.

Case 1 ("existing full video defaults") is the regression guard: **byte-identical** to today's argv.

### 15.4 Orchestrator tests

v1's fake-runner matrix (one output; three outputs; outputs + sidecars; multiple
`after_move:filepath` lines; missing printed path with a valid single-output fallback; zero-byte
output; one missing output of many; collision on one chapter target; failure moving output 3 of 5;
cancel during download; cancel during finalization; retry without duplicate paths; immediate
completion before a waiter), **plus**:

- **V-01 regression:** two sections, two *identical* printed paths, one file on disk → job **fails**
  with `MF_OUTPUT_FINALIZATION`. Never "completed, 1 output".
- **V-04 regression:** split job with one printed path and 22 unprinted chapter files → all 22
  discovered, the source discarded, `outputPaths.length === 22`.
- **L-01:** a clip job and a full job for the same URL get different temp directories and do not see
  each other's files.
- **L-02:** a clip job is not `skipped` by a manifest record for a full download of the same URL.
- **L-03:** every `JobConfig` field survives `parseJobConfig` for every mode (including `audioBoost`
  and `isLive`).
- **L-04:** two chapters whose sanitized names are identical both land, as `name` and `name_1`.
- **§9.6:** attempt 1 leaves outputs in the temp dir; attempt 2 succeeds; attempt 1's files are not
  in `outputPaths`.
- **§9.3 guard:** a single-output job with a 980 KB `.info.json` and a 174 KB clip, with no printed
  path, does not return the JSON as the media file.

Assertions throughout: every primary exists and is non-zero; temp removal strictly after
verification; failed jobs retain recoverable partials; `outputPath`/`outputPaths`/`sidecarPaths`
correct; warnings bounded and specific; no unrelated temp file reported as an output.

### 15.5 Integration (extends `tests/e2e/real-download.e2e.test.ts`, `MF_E2E_REAL=1`)

- **Precise-cut codec assertion** — `ffprobe` the output; `codec_name === 'h264'`. This is the V-05
  guard and it must be an integration test, not a snapshot.
- Fast cut preserves source codecs.
- A real chaptered source produces the expected file count under both strategies.

### 15.6 Renderer checks

Per v1 §15.5: analysis exposes subtitle availability; playlist analysis disables clip controls; live
analysis disables clip/chapter; URL change clears chapter and subtitle state; selecting a chapter
creates the correct range; invalid times block start; fast vs. precise labels are honest; badges
correct; unsupported embed combinations explained; single- and multi-output completion both render;
**search quick-download is unchanged and uses defaults**.

---

## 16. Milestones

Numbered to continue the repository's own sequence (`AGENTS.md` §9 runs M0–M8), with amendment IDs
for the binding corrections. These belong in `AGENTS.md` §2 before implementation starts.

**Proposed amendments:**

- **AM-17** — Precise cut (`--force-keyframes-at-cuts`) re-encodes; the bundled LGPL FFmpeg has no
  `libx264`, so the MP4 default is `mpeg4`. Encoders are resolved and pinned at runtime
  (`libx264` → `libopenh264` → hardware), verified by probe; with no encoder, precise cut is refused
  rather than downgraded.
- **AM-18** — `%(section_number)s`/`%(section_title)s` are unavailable for `*start-end` sections but
  available under the `chapter:` output prefix. Two distinct templates; range uniqueness is the
  filename-uniqueness guarantee; a section-count assertion is mandatory before reporting success.
- **AM-19** — `--split-chapters` splits on yt-dlp's own `chapters` field, keeps the original file,
  and is invisible to `--print after_move:filepath`. Chapter-split strategy is gated on chapter
  provenance; discovery is a directory scan; disk preflight reserves 2× for a native split.
- **AM-20** — Subtitle tracks are not retimed to a downloaded section. Subtitle packaging is
  mutually exclusive with clip/chapter selection until retiming ships.

| Milestone | Deliverable | Gate |
|---|---|---|
| **M9.0 — Evidence & amendments** (0.5 d) | §3's verified behavior recorded; AM-17…AM-20 added to `AGENTS.md` §2; `specs/Implementation_Plan.md` gains the M9 row | Amendments merged before any code |
| **M9.1 — Repository repairs** (1 d) | L-01 job-shape temp key; L-02 `qualityKeyFor`; L-03 `parseJobConfig` restructure + `audioBoost`/`isLive` restored; L-04 `collisionFreeTargets` | `npm run typecheck && npm run lint && npm run test`; the L-03 round-trip test exists and passes; **no user-visible change except Audio Boost and live Stop & Save starting to work** |
| **M9.2 — Contracts & pure logic** (1–2 d) | Shared models and bounds; `ChapterMarker` extension + provenance; tightened description parser; `-J` subtitle mapping; capability helpers; `chaptersToRanges`; `chooseChapterStrategy`; new error codes + `classifyStderr` rule; IPC validation | Full gate; §15.1 + §15.2 green; **no renderer controls yet**; existing behavior unchanged |
| **M9.3 — Argument builders & encoder resolution** (1–2 d) | Clip/chapter/subtitle/packaging builders; `outputTemplatesFor`; encoder probe + pinning + smoke test | §15.3 all pass; M3 snapshots byte-identical at defaults; security tests prove argv isolation |
| **M9.4 — Multi-output orchestrator** (2–4 d) | Per-job artifact state; multi-path capture + count assertion; strategy-aware discovery; batch finalization; payload extension; cancel/retry/resume; pre-spawn snapshot | §15.4 all pass; no "largest file wins" for multi-output or packaged jobs; partial-failure rollback proven |
| **M9.5 — Downloader UI** (2–4 d) | Clip/chapter panel; subtitle panel; metadata panel; typed wiring; preflight warnings; artifact summary; provenance labelling | Single clip works; selected chapters work; sidecar + metadata packaging work; full-media default unchanged |
| **M9.6 — Queue, playlist, polish** (1–2 d) | Multi-output rows; per-entry packaging clones; completion summary; reveal/open; snapshot back-compat; a11y and keyboard | Entries package independently; a failed entry doesn't contaminate the next; old snapshots load; no stale cross-analysis state |
| **M9.7 — Integration & performance** (1–3 d) | Real-source integration incl. the precise-cut codec assertion; smoke matrix; memory/IPC/list measurements; docs; `specs/demo-log.md` checkpoint | `npm run typecheck && lint && test && build`, then §17 |

M9.0 and M9.1 are new and are the reason this plan is executable: v1 would have discovered L-01
through L-04 during M9.4, with the UI already built on top of them.

---

## 17. Smoke matrix

v1 §17's rows, with the changed and added ones marked in bold:

| Scenario | Expected |
|---|---|
| Full MP4, all new options off | argv and output byte-identical to today |
| One fast clip | One playable output; **source codecs preserved**; clear fast-cut label |
| One precise clip | FFmpeg processing visible; **`ffprobe` reports `h264`, never `mpeg4`**; boundaries precise within tolerance |
| Three non-overlapping clips | **Three** distinct primaries; one completion event; a shortfall fails loudly |
| **Two ranges, section template removed (fault injection)** | Job **fails** `MF_OUTPUT_FINALIZATION` — never reports one output as success |
| **Split all chapters (extractor provenance)** | One file per chapter; source discarded; unsafe titles sanitized; no collisions |
| **Split all chapters (description provenance)** | `explicit-sections` used; correct file count; **never zero files** |
| Select two chapters | Exactly two primaries; `explicit-sections` path |
| Manual English subtitles sidecar (full media) | Media + sidecar finalized together |
| Auto subtitles embedded (full media) | `mov_text` track present; container compatibility validated |
| **Subtitles requested with a clip** | Rejected up front with §4.6's message; no half-configured job |
| Metadata + thumbnail embedded | Both packaged (cover art as `attached_pic`) or a clear error |
| Info JSON + description | Sidecars beside the primary; size warning shown beforehand |
| No subtitles available | Completes with a warning; no fabricated artifact |
| Playlist with packaging | Independent packaging and artifact lists per entry |
| Live stream | Clip/chapter disabled **and refused by main**; Stop & Save produces a file |
| Cancel during clip download | Tree dies; partials retained; UI recoverable |
| Cancel during multi-output finalization | Moved and unmoved outputs reported accurately |
| Network retry | Same config resumes; no duplicate or stale paths |
| **Clip after a full download of the same URL** | **Not skipped**; produces the clip, not the full file |
| Restart with old queue snapshot | Loads without new-field errors |
| Chapter title with reserved characters / **emoji-only titles** | Safe filenames; `_1` collision resolution; no traversal |
| Subtitle language with shell metacharacters | Rejected; no shell; no malformed argv |
| **Source that can't be range-fetched** | `MF_SECTION_UNSUPPORTED`, not `MF_UNKNOWN` |

---

## 18. Documentation

Update together, in the same change as the code:

- `AGENTS.md` §2 — AM-17…AM-20 (M9.0).
- `specs/Implementation_Plan.md` — the M9 row and its phase breakdown.
- `README.md` — capabilities and their honest limits.
- `specs/ec-verifications.md` — clip, chapter, subtitle, packaging repros.
- `specs/demo-log.md` — one visible checkpoint per milestone.
- `specs/perf-report.md` — multi-output and packaging measurements.
- Licensing notes — the LGPL-FFmpeg encoder constraint (AM-13 / AM-17) is a distribution fact, not
  just an implementation one.

State plainly for users:

- Subtitle and chapter availability depends on the source and is decided per video.
- Some chapter lists are read from the video description and are approximate.
- Automatic subtitles may be absent or lower quality.
- Precise cuts re-encode: slower, and re-compressed rather than copied.
- Embedded subtitle playback depends on container and player.
- Sidecars are preserved when embedding is unavailable or disabled.
- `info.json` contains technical data and temporary, connection-specific media links.

---

## 19. Definition of done

All of v1 §19, plus:

- Precise cut is proven by `ffprobe` to produce H.264, or is refused with a clear reason.
- A multi-section job that yields fewer files than sections **fails**; there is a test for it.
- A native chapter split discovers every chapter file without relying on `--print`.
- Description-provenance chapters never reach `--split-chapters`.
- Subtitles are never packaged into a ranged job.
- L-01 through L-04 are fixed and each has a regression test.
- `audioBoost` and `isLive` survive the IPC boundary.
- `classifyStderr` maps the partial-download failure to a real message.
- No `MediaMetadata`, log line, IPC payload, or queue snapshot contains a media or subtitle URL.
- Disk preflight accounts for the 2× native-split cost and the ~2 MB `info.json`.
- Bounded stdout retention, async moves, verify-before-delete, and AM-16 budgets all hold.
- No new runtime dependency; no new renderer privilege.

---

## 20. Handoff prompt

> Implement `specs/clip-chapter-subtitle-metadata-implementation-plan-v2.md` in the MediaForge
> Desktop repository. Read `AGENTS.md` (especially §2 and §§6–11), the PRD sections it cites, and
> `specs/performance-remediation-plan.md` first. §3 of the plan records behavior already measured
> against `binaries/win32/` — treat it as fact and do not re-derive it, but do re-verify §3 if the
> bundled yt-dlp or FFmpeg version changes.
>
> Work M9.0 → M9.7 in order. **Do not start M9.2 until M9.1's four repository repairs (L-01…L-04)
> are merged with their regression tests** — the multi-output design is unsafe on top of a temp
> directory keyed only by URL. Do not build UI before M9.4's orchestrator gate is green.
>
> Keep all CLI construction in `src/main/jobs/argBuilders.ts`, argv arrays with `shell:false`, the
> renderer sandboxed, and existing behavior byte-identical when new options are at defaults. Run the
> repository quality gate after every milestone. Before declaring completion, run §17's smoke matrix
> and update the §18 documents. Report any source, container, or encoder limitation explicitly
> rather than falling back silently.

---

## 21. References

- yt-dlp README — https://github.com/yt-dlp/yt-dlp/blob/master/README.md
- yt-dlp options — https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/options.py
- yt-dlp output template / `--split-chapters` — README "OUTPUT TEMPLATE"
- FFmpeg CLI — https://ffmpeg.org/ffmpeg.html · ffprobe — https://ffmpeg.org/ffprobe.html
- BtbN FFmpeg-Builds (LGPL, the bundled source per AM-13) — https://github.com/BtbN/FFmpeg-Builds
- v1 plan (scope record) — `specs/clip-chapter-subtitle-metadata-implementation-plan.md`
