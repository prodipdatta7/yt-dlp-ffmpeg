# MediaForge Desktop — Clip, Chapter, Subtitle, and Metadata Packaging Plan

Implementation handoff for the next MediaForge feature set. This plan is intentionally
implementation-ready: an agent should be able to execute it without inventing contracts,
failure semantics, or scope decisions.

## 1. Mission and scope

Implement two related capabilities on top of the existing yt-dlp + FFmpeg pipeline:

1. **Clip & Chapter Studio**
   - Download one custom time range.
   - Download multiple custom ranges from one source.
   - Preserve chapter markers in the output when supported.
   - Split a source into one output file per chapter.
   - Select specific chapters and download only those chapters.
   - Provide a fast-cut versus precise-cut choice with an honest transcode warning.

2. **Subtitle & Metadata Packaging**
   - Discover manual and automatic subtitle tracks from the existing metadata extraction.
   - Download selected subtitle languages.
   - Embed subtitles where the target container supports it.
   - Save subtitles as sidecar files.
   - Embed thumbnail and media metadata.
   - Optionally write `info.json` and description sidecars.

The first delivery is for remote media downloads and the existing Downloader/Queue flows.
Local-file inspection and local-file editing are deliberately deferred to a later milestone.

The implementation must preserve the current behavior when all new options are disabled.

## 2. Non-negotiable repository rules

Before editing, read:

- `AGENTS.md`, especially §§2, 4, 6, 7, 8, 9, 10, and 11.
- `specs/MediaForge_Desktop_PRD.md`, especially §§3.1–3.6, 4, 5.1–5.3, and 7.
- `specs/performance-memory-deep-research.md`.
- `specs/performance-remediation-plan.md`.

If this plan conflicts with `AGENTS.md`, `AGENTS.md` wins.

The agent must not:

- Construct shell command strings.
- Pass user input through a shell.
- Add a renderer filesystem, network, or child-process dependency.
- Add React, a UI kit, an icon library, Redux, Zustand, or another runtime dependency.
- Regex-scrape human-readable CLI output for application state.
- Download subtitle URLs directly from the renderer.
- Delete temporary files before verifying every required primary output.
- Store raw subtitle URLs, cookies, or query-bearing URLs in logs.
- Break existing single-output downloads, playlists, live recording, resume, or cancellation.

All child-process execution remains `spawn(binaryPath, argsArray, { shell: false,
windowsHide: true })`, through the existing runner and argument-builder choke points.

## 3. Current codebase starting point

The implementation should extend, not replace, these existing areas:

| Area | Existing location | Reuse/extension |
|---|---|---|
| Shared models | `src/shared/models.ts` | Add subtitle tracks, packaging options, clip/chapter options, and bounded constants. |
| IPC contract | `src/shared/ipcContract.ts` | Keep `JobConfig` as the single download request; extend typed payloads and completion artifacts. |
| Argument construction | `src/main/jobs/argBuilders.ts` | Add all yt-dlp options here; no other module composes argv. |
| Input validation | `src/main/ipc/handlers.ts` | Extend `parseJobConfig` with strict validation and safe defaults. |
| Metadata extraction | `src/main/media/metadata.ts` | Map subtitle and automatic-caption availability from `-J`; do not send raw track URLs to renderer. |
| Chapter extraction | `MF_FETCH_CHAPTERS` and current chapter service | Reuse existing chapter retrieval and add generation/cancellation protection if needed. |
| Download lifecycle | `src/main/jobs/orchestrator.ts` | Add multiple primary outputs and auxiliary sidecars without regressing cleanup, retries, resume, or finalization. |
| Filename safety | `src/main/fsops/sanitizer.ts` | Sanitize clip/chapter-derived names and use existing collision policy. |
| Renderer configuration | `src/renderer/src/components/ModeSelector.tsx` | Add focused child panels instead of growing one monolithic component. |
| Preview | `src/renderer/src/components/PreviewPanel.tsx` and `SearchResultCard.tsx` | Reuse chapter data, but keep studio controls in the Downloader path for v1. |
| Queue | `src/renderer/src/components/QueueList.tsx`, `queueState.ts` | Show multi-output completion and warnings; preserve queue snapshot compatibility. |
| Tests | `tests/unit/jobArgs.test.ts`, `orchestrator.test.ts`, `metadata.test.ts`, `robustness.test.ts` | Add table-driven contract tests and fake multi-output fixtures. |

The repository already has chapter and transcript preview concepts. This feature is not a new
preview-only experience: it turns the selected chapter/range and available extras into a real
download job.

## 4. Product decisions fixed before coding

### 4.1 Defaults

When a user opens a new download:

- Clip mode: **Full media**.
- Chapter mode: **Preserve chapters when the source provides them**; no splitting.
- Subtitles: disabled.
- Automatic subtitles: disabled.
- Subtitle embedding: disabled.
- Subtitle sidecar: disabled.
- Thumbnail embedding: disabled.
- Metadata embedding: disabled, preserving current behavior.
- `info.json`: disabled.
- Description sidecar: disabled.
- Exact/precise cuts: disabled; fast cuts are the default.

These defaults avoid surprising CPU, disk, and output-format changes. The user’s explicit options
are persisted for the current configuration session only in the first delivery; persistent presets
are a separate feature.

### 4.2 Playlist behavior

- Subtitle and metadata packaging applies to each playlist entry.
- Clip and chapter controls are enabled only for a single-video analysis in v1.
- For playlist analysis, the studio is disabled with the message: “Clip and chapter selection is
  available for individual videos. Packaging options apply to every queued entry.”
- Do not silently apply the first video’s chapter ranges to every playlist entry.

### 4.3 Live behavior

- Disable clip and chapter selection for active live streams.
- Subtitle and metadata packaging remains available where yt-dlp reports it.
- The existing live recording stop/finalization path must continue to work.

### 4.4 Output semantics

- A **primary output** is a playable media file produced by the requested download.
- An **auxiliary output** is a subtitle, JSON, description, thumbnail, URL, or other requested
  sidecar file.
- A job may complete with one or many primary outputs and zero or many auxiliary outputs.
- `outputPath` remains for backward compatibility and points to the first primary output.
- `outputPaths` is the complete ordered primary-output list.
- `sidecarPaths` is the complete auxiliary-output list.
- Completion is successful only when every primary output exists and is greater than zero bytes.
- A requested auxiliary output is required when the source advertised the required data and the
  selected target supports the operation. If the source has no matching subtitle/description/
  thumbnail, the job completes with a warning rather than pretending the artifact exists.

### 4.5 Cut semantics

- **Fast cut:** use yt-dlp section download without forced keyframes. It is faster and usually
  avoids full re-encoding, but the cut may begin at a nearby keyframe.
- **Precise cut:** add `--force-keyframes-at-cuts`. It may require FFmpeg to decode/re-encode the
  selected section and can be substantially slower.
- The UI must show the selected mode before starting and must report “FFmpeg processing” during
  the transcode phase.
- Never call a fast cut “frame-accurate.”

## 5. Target user flows

### 5.1 Single custom clip

1. User pastes a direct video URL and analyzes it.
2. User opens **Clips & Chapters**.
3. User chooses **Custom clip**.
4. User enters start and end times or drags the range handles.
5. User chooses Fast cut or Precise cut.
6. UI validates the range and previews the expected filename/output count.
7. User chooses optional subtitles/metadata in **Packaging**.
8. User starts the download.
9. Queue shows downloading, cutting/processing, packaging, finalizing, and completed states.
10. Completion shows the output file and any sidecar files.

### 5.2 Multiple clips

1. User chooses **Multiple clips**.
2. User adds, edits, removes, and reorders ranges.
3. The UI rejects invalid, zero-length, overlapping, or duplicate ranges unless overlap is
   explicitly allowed by a future option. In v1, overlapping ranges are rejected.
4. The app launches one yt-dlp job with multiple section arguments when possible.
5. The orchestrator collects and finalizes every primary output.
6. The completion view lists all files and provides “Reveal folder.”

### 5.3 Split chapters

1. User analyzes a single video.
2. User opens **Clips & Chapters** and selects **Split into chapter files**.
3. The existing chapter data is displayed with checkboxes and timestamps.
4. User chooses all chapters or a subset.
5. The app builds a safe multi-output job with chapter-aware filenames.
6. Each output is verified and moved independently, while cleanup waits for the complete set.

### 5.4 Subtitle and metadata packaging

1. Metadata analysis reports manual and automatic subtitle languages.
2. User opens **Packaging**.
3. User selects one or more languages and whether they want manual, automatic, or both.
4. User chooses embedded subtitles, sidecar subtitles, or both.
5. User optionally enables thumbnail, metadata, info JSON, and description.
6. The UI reports unavailable or incompatible selections before spawn.
7. The job downloads and packages the extras through yt-dlp/FFmpeg.
8. Completion shows the playable file plus the generated sidecars.

## 6. Data model and invariants

### 6.1 Subtitle availability model

Add a compact, renderer-safe model. The renderer needs availability, not direct subtitle URLs.

```ts
export type SubtitleSource = 'manual' | 'automatic'

export interface SubtitleTrack {
  language: string
  label: string | null
  source: SubtitleSource
  formats: string[]
}
```

Add to `MediaMetadata`:

```ts
subtitles: SubtitleTrack[]
```

Backward-compatible parser behavior: missing `subtitles`, malformed subtitle maps, or unknown
format entries become an empty list. Language keys must be capped and normalized. Do not retain
track URLs in `MediaMetadata`, logs, IPC events, or renderer state.

Recommended limits:

```ts
export const MAX_SUBTITLE_TRACKS = 200
export const MAX_SUBTITLE_LANGUAGES_PER_JOB = 20
export const MAX_SUBTITLE_FORMATS_PER_TRACK = 20
export const MAX_CLIP_RANGES = 50
export const MAX_CLIP_DURATION_SEC = 24 * 60 * 60
```

The exact limits may be reduced if the existing validation conventions require it, but they must
be explicit, shared, and tested.

### 6.2 Clip and chapter model

```ts
export type CutMode = 'fast' | 'precise'

export interface ClipRange {
  startSec: number
  endSec: number
  label?: string
  cutMode: CutMode
}

export type ChapterMode = 'preserve' | 'split' | 'selected'

export interface ChapterOptions {
  mode: ChapterMode
  selectedIndexes?: number[]
}
```

Invariants:

- `startSec` and `endSec` are finite numbers.
- `0 <= startSec < endSec`.
- `endSec - startSec` is at least 0.1 seconds.
- Both values are no greater than the configured maximum duration; if duration is known, they
  must not exceed duration plus a small 0.5-second tolerance.
- `selectedIndexes` contains unique non-negative integers, sorted ascending by the main process.
- `selectedIndexes` is required only for `mode: 'selected'`.
- `clipRanges` is required for custom clip modes and absent for full media/chapter preserve.
- v1 rejects overlapping ranges to avoid ambiguous output naming and duplicated bytes.

Use a discriminated union if it simplifies validation:

```ts
export type ClipSelection =
  | { kind: 'full' }
  | { kind: 'ranges'; ranges: ClipRange[] }
  | { kind: 'chapters'; chapterOptions: ChapterOptions }
```

Do not accept both arbitrary ranges and chapter options in the same request. If a future UI needs
“chapters plus a custom range,” add a new explicit mode and tests rather than combining flags.

### 6.3 Packaging model

```ts
export type SubtitleSelectionMode = 'manual' | 'automatic' | 'both'
export type SubtitleFormat = 'best' | 'vtt' | 'srt' | 'ass'

export interface SubtitleOptions {
  enabled: boolean
  selection: SubtitleSelectionMode
  languages: string[]
  format: SubtitleFormat
  embed: boolean
  sidecar: boolean
}

export interface PackagingOptions {
  subtitles?: SubtitleOptions
  embedMetadata: boolean
  embedThumbnail: boolean
  writeInfoJson: boolean
  writeDescription: boolean
}
```

Invariants:

- Disabled subtitles must have no active subtitle argv flags.
- Enabled subtitles require at least one normalized language or an explicitly supported `all`
  option; v1 should prefer explicit languages to avoid unexpectedly huge jobs.
- Enabled subtitles require `embed` or `sidecar` to be true.
- `format` is passed only after allowlist validation.
- `writeInfoJson` and `writeDescription` are independent of subtitle settings.
- Metadata and thumbnail flags are booleans only.

Add new optional fields to `JobConfig` without changing the meaning of existing fields:

```ts
clipSelection?: ClipSelection
packaging?: PackagingOptions
```

The field names may be adjusted to match project conventions, but use one shape consistently in
shared types, renderer state, IPC validation, tests, and queue serialization.

### 6.4 Completion artifact model

Extend `JobDonePayload`:

```ts
interface JobDonePayload {
  jobId: string
  status: 'completed' | 'cancelled' | 'failed'
  errorCode?: MfErrorCode
  outputPath?: string
  outputPaths?: string[]
  sidecarPaths?: string[]
  warningMessages?: string[]
  partialDir?: string
  skipped?: boolean
}
```

Compatibility rules:

- Existing consumers using `outputPath` continue to work.
- For one primary output, set both `outputPath` and `outputPaths: [outputPath]`.
- For zero primary outputs, never report `completed`.
- Do not include arbitrary filesystem paths before the job has validated them as descendants of
  the requested destination or temporary job directory.

## 7. Metadata extraction changes

### 7.1 Parse subtitle availability from `-J`

Extend the typed mapping in `src/main/media/metadata.ts`:

- Read the extractor’s `subtitles` object for manual tracks.
- Read the extractor’s `automatic_captions` object for automatic tracks.
- Map language keys only.
- Deduplicate a language/source pair.
- Sort language codes naturally, then label.
- Extract a bounded list of available extension names from each track’s format descriptors.
- Ignore malformed entries instead of failing the entire media analysis.

Do not expose direct subtitle URLs to the renderer. yt-dlp remains responsible for selecting and
downloading the actual track.

### 7.2 Capability helpers

Create pure functions, preferably in a shared or main media module, for:

- `normalizeSubtitleLanguage(value)`
- `normalizeSubtitleLanguages(values)`
- `subtitleTracksForLanguage(metadata, language)`
- `supportsEmbeddedSubtitles(container, subtitleFormat)`
- `resolvePackagingWarnings(metadata, config)`
- `validateClipSelection(selection, durationSec, chapters)`

These functions must not import Electron or spawn processes. They should be unit-testable with
plain Vitest.

### 7.3 Analysis cancellation and stale results

When the user analyzes a new URL while subtitle/chapter metadata is loading:

- Cancel the previous analysis/request.
- Attach a generation/request token in renderer state.
- Ignore late chapter/subtitle results that do not belong to the current URL generation.
- Never merge subtitle tracks from URL A into URL B.

If the existing chapter IPC does not carry a request token, add one to the request/response or
maintain a main-process active-request identity. Do not solve this with timing delays.

## 8. Argument builder design

### 8.1 Preserve the existing argument order and base flags

Keep the existing base download flags, including:

- `--newline`
- `--no-colors`
- `--windows-filenames`
- `--trim-filenames 200`
- `--ffmpeg-location <resolved path>`
- progress templates
- `--print after_move:filepath`
- cookie handling

New flags should be appended through dedicated pure builder functions so snapshots remain easy to
read:

```ts
buildClipArgs(selection: ClipSelection): string[]
buildChapterArgs(selection: ClipSelection, chapters?: ChapterMarker[]): string[]
buildSubtitleArgs(options: SubtitleOptions): string[]
buildPackagingArgs(options: PackagingOptions): string[]
```

The final `buildDownloadArgs()` composes mode args, clip/chapter args, packaging args, base args,
cookies, and the URL. The URL remains one argv element and must be last or in the project’s
established safe position.

### 8.2 Full media

No section flags.

Chapter behavior:

- `preserve`: do not add a split/remove flag; allow normal metadata/chapter handling.
- `split`: add the supported split-chapter option and use a chapter-aware output template.
- `selected`: convert selected chapter markers into explicit section ranges and use section args.

Do not pass empty `--download-sections` arguments.

### 8.3 Custom ranges

For each validated range, append one section selector as one argv element. Use the project’s
documented format for a time-range selector, for example:

```text
--download-sections *<start>-<end>
```

If `cutMode` is `precise` for any range, add `--force-keyframes-at-cuts` once. If multiple ranges
mix fast and precise modes, either reject the configuration in validation or define the whole job
as precise; v1 should reject mixed modes to avoid misleading output labels.

Use a section-aware output template for multi-range jobs. Verify the exact supported output fields
against the current yt-dlp documentation and a fixture before implementation. The template must
include enough of section number/start/end/label to prevent collisions.

### 8.4 Split chapters

For “split all chapters,” prefer yt-dlp’s native chapter-splitting behavior. For “selected
chapters,” use explicit validated ranges derived from the chapter list. This keeps selection logic
in the app while leaving media extraction and output creation to yt-dlp/FFmpeg.

Chapter titles are untrusted content. They must be passed only through yt-dlp output-template
fields and then through the existing app-side filename sanitizer during finalization. Never build
a filesystem path by concatenating an unsanitized chapter title.

### 8.5 Subtitle args

Expected semantic mapping:

| UI selection | yt-dlp behavior |
|---|---|
| Manual | `--write-subs` |
| Automatic | `--write-auto-subs` |
| Both | both flags, if supported by the current binary |
| Languages | `--sub-langs <comma-separated normalized codes>` |
| Format | `--sub-format <allowlisted format>` |
| Embed | `--embed-subs` |
| Sidecar only | no embed flag; retain subtitle files |

The agent must verify the installed yt-dlp option spelling and supported values using the bundled
binary/docs before finalizing snapshots. Do not assume a CLI flag from memory if the binary version
differs.

### 8.6 Metadata args

Expected semantic mapping:

| UI selection | yt-dlp behavior |
|---|---|
| Embed media metadata | `--embed-metadata` |
| Embed thumbnail | `--embed-thumbnail` |
| Write info JSON | `--write-info-json` |
| Write description | `--write-description` |

The agent must verify which options are available for each mode/container and surface a warning or
validation error rather than silently dropping a requested option.

### 8.7 Argument safety tests

Snapshot tests must assert:

- A malicious URL stays one argv element.
- A language such as `en,fr` is one intended argv value, not shell syntax.
- A chapter title containing `&`, `|`, quotes, or path separators never appears as an argv-built
  filesystem path.
- No empty language, range, or format argument is emitted.
- Disabled options emit no related flags.
- Existing mode snapshots remain unchanged when new options are at defaults.

## 9. Orchestrator and finalization design

This is the highest-risk implementation area. Do not add UI before the backend can safely finalize
multiple primary outputs.

### 9.1 Per-job artifact state

Add internal state similar to:

```ts
interface JobArtifacts {
  printedPrimaryPaths: string[]
  discoveredPrimaryPaths: string[]
  sidecarPaths: string[]
  warnings: string[]
}
```

Keep this state per job and clear it in every terminal path. Never use a module-level array.

### 9.2 Process output handling

Continue streaming stdout lines to the parser. Retain only:

- Every validated `after_move:filepath` primary path needed for the current job.
- The latest progress event.
- A bounded stderr tail for error classification.

Do not restore full stdout retention for multi-output support.

`after_move:filepath` remains authoritative for primary media outputs. Auxiliary files should be
identified through a bounded, post-process directory scan and explicit expected-artifact rules,
not by scraping human-readable log lines.

### 9.3 Artifact discovery

After yt-dlp exits successfully:

1. Normalize and validate every printed primary path.
2. Require it to be inside the job temporary directory or the controlled staging root.
3. Verify it is a regular file and non-zero.
4. If no printed paths exist, use the existing fallback only for the single-output legacy path.
5. For multi-output jobs, enumerate the job directory using `readdir`/`stat` asynchronously.
6. Classify files by role:
   - Primary media extensions from the selected mode/container and validated printed paths.
   - Subtitle sidecars by requested language/format and known subtitle extensions.
   - JSON/description/thumbnail sidecars by requested packaging options.
7. Exclude `.part`, `.ytdl`, temporary, and unrelated files from completion artifacts.
8. If the classification is ambiguous, fail safely and retain the temp directory for recovery.

Do not use “largest file wins” for a multi-output job.

### 9.4 Finalization transaction

Implement a helper with a pure-testable boundary, such as:

```ts
finalizeArtifacts(job, artifacts): Promise<FinalizedArtifacts>
```

Behavior:

1. Ensure the destination directory exists asynchronously.
2. Compute collision-free targets for every artifact.
3. Move within the same volume with rename where possible.
4. Use asynchronous copy fallback only for `EXDEV`.
5. Verify each destination is present and non-zero before deleting its source.
6. If any required primary move fails, retain all recoverable sources and report failure.
7. If an optional sidecar fails but the source remains recoverable, report a warning and retain it
   in the partial directory unless the user explicitly selected strict packaging in a future UI.
8. Remove the temp directory only after the primary-output verification and required sidecar
   decisions complete.
9. Emit one terminal completion event containing all finalized paths.

Avoid partial success that makes the UI claim a multi-file job completed when one chapter failed.

### 9.5 Progress phases

Keep existing phases and add detail through `message` rather than breaking the enum:

- `queued`
- `downloading-video`
- `downloading-audio`
- `merging`
- `finalizing`
- `done`

Recommended messages:

- `Downloading clip 2 of 4`
- `Splitting chapters: 3 of 12`
- `Downloading subtitles`
- `Embedding metadata and thumbnail`
- `Finalizing 5 output files`

Progress must remain coalesced at the existing bounded cadence. Do not emit one IPC event per
sidecar or progress line if the UI cannot display it.

### 9.6 Retry, cancel, and resume

- Retry the complete yt-dlp invocation using the same validated argv and temp directory.
- Do not append duplicate artifact paths across attempts; reset attempt-local printed paths before
  each spawn and deduplicate final paths.
- Cancel kills the child process tree and retains partials.
- Cancellation during finalization must stop future moves where safe and retain unmoved sources.
- Resume must reuse the same clip/chapter/packaging config and output template.
- A successful retry must not leave stale artifacts from a failed attempt in the final output list.
- If the user cancels after some outputs were moved, the job must report exactly which outputs were
  finalized and which remain in the partial directory.

### 9.7 Completion race protection

The renderer currently has fast-job completion risk if `job:done` arrives before a waiter is
registered. Before this feature is considered complete:

- Register the job completion waiter before or atomically with `downloadStart`, or buffer terminal
  events by job ID in main/preload until the start response is consumed.
- Add a regression test for immediate success, immediate failure, skipped download, and immediate
  cancellation.

This matters more for short clips, which can finish much faster than a full download.

## 10. IPC contract and validation

### 10.1 Request validation

Extend `parseJobConfig` in `src/main/ipc/handlers.ts`.

Validation must:

- Reject unknown mode values.
- Validate `clipSelection` discriminants.
- Validate all ranges and selected chapter indexes.
- Cap range count, language count, and string lengths.
- Normalize and deduplicate language codes.
- Allow only `best`, `vtt`, `srt`, and `ass` subtitle formats.
- Validate packaging booleans.
- Reject unsupported incompatible combinations with a user-facing error code/message.
- Ignore unknown object keys rather than spreading untrusted payloads into config.

Do not trust the renderer’s duration, chapter labels, output paths, or estimated sizes. The main
process should use the analyzed metadata/current job directory and re-check any security-sensitive
path.

### 10.2 Error codes

Reuse existing codes when possible. Add narrowly scoped codes only if the renderer needs distinct
recovery behavior, for example:

- `MF_INVALID_CLIP`
- `MF_INVALID_PACKAGING`
- `MF_SUBTITLES_UNAVAILABLE`
- `MF_OUTPUT_FINALIZATION`

If adding codes, update:

- `MfErrorCode`.
- `ERROR_MESSAGES`.
- Error classification tests.
- Renderer error display.
- Any serialized queue/error types.

Never display raw yt-dlp/FFmpeg stderr as the primary user message.

### 10.3 Metadata flow

The renderer should receive only typed metadata availability and chapter information. The main
process owns all actual subtitle fetching and packaging. The preload surface remains a narrow typed
API and must not expose `ipcRenderer`, paths, or arbitrary channels.

## 11. Renderer plan

### 11.1 Component decomposition

Create focused components rather than adding more state to `ModeSelector` or `SearchResultCard`:

- `ClipChapterPanel.tsx`
- `TimeRangeEditor.tsx`
- `ChapterPicker.tsx`
- `SubtitlePackagingPanel.tsx`
- `MetadataPackagingPanel.tsx`
- `OutputArtifactSummary.tsx`

Shared small helpers can live in `components/ui.tsx` only if they are genuinely reusable.

### 11.2 Configuration state

Keep one typed `JobSelection` object as the source of truth. Do not maintain duplicate clip,
chapter, subtitle, and packaging state in App, ModeSelector, and child components.

State rules:

- Reset clip/chapter selections when a new video analysis begins.
- Reset chapter-specific selection when the current URL changes.
- Preserve generic packaging options while switching between compatible mode tabs.
- Clear or disable incompatible options immediately when the user changes container or mode.
- Do not update the parent selection on every keystroke if the value is invalid; retain the last
  valid selection and show inline validation.

### 11.3 Clip editor details

The first implementation may use numeric time inputs instead of a complex timeline. It must still
provide:

- `HH:MM:SS.mmm` parsing for input.
- Clear invalid-time messages.
- Start/end bounds.
- Duration display.
- Add/remove/reorder ranges.
- Chapter-to-range action.
- Preview/jump action using the existing preview player where available.
- Cut mode explanation.
- Output count and estimated disk size.

If a visual timeline is implemented, keep it lightweight and accessible; do not introduce a canvas
or chart dependency solely for this feature.

### 11.4 Chapter picker details

Each row should show:

- Checkbox.
- Chapter number.
- Timestamp.
- Safe display title.
- Duration when known.
- Preview/jump action.

Actions:

- Select all.
- Clear all.
- Split all.
- Download selected.

For large chapter counts, window the list or use `content-visibility`; do not render thousands of
rows unnecessarily. Keep active playback updates isolated from the entire panel.

### 11.5 Subtitle UI details

Show three states:

- No subtitle tracks found.
- Tracks found, but selected language unavailable.
- Tracks available and selectable.

Each language should show manual/automatic badges. Avoid displaying raw subtitle URLs.

Controls:

- Manual/automatic/both.
- Language multi-select.
- Format selector.
- Embed checkbox.
- Sidecar checkbox.

If embedding is incompatible with the selected container, explain the reason and offer sidecar
output. Do not silently change embed to sidecar.

### 11.6 Metadata UI details

Use explicit checkboxes with concise explanations:

- Embed metadata.
- Embed thumbnail.
- Save `info.json`.
- Save description.

Display an “Additional files” summary before download, for example:

```text
Main file: 1
Subtitles: English + Bengali (sidecar)
Metadata: embedded
Thumbnail: embedded
Info JSON: saved separately
```

### 11.7 Completion UI

The completion state must support:

- One output file.
- Multiple clip/chapter files.
- Sidecar files.
- Warnings.
- Reveal folder.
- Open primary output.

Do not force the UI to render a huge artifact list synchronously. Cap visible rows and provide a
summary for unusually large chapter splits.

## 12. Queue and persistence behavior

### 12.1 Queue row model

Add optional display-only fields to queue state:

- `outputCount`.
- `sidecarCount`.
- `warningCount`.
- `operationLabel` such as “3 clips” or “split chapters”.

Do not store raw subtitle URLs or temporary paths in the persisted queue snapshot.

### 12.2 Serialization compatibility

Old queue snapshots without new fields must load successfully with defaults. New fields must be
validated and bounded. If a queued job uses a source-specific chapter selection and the source is
reanalyzed later, the saved numeric ranges remain authoritative only if the URL identity matches.

For v1, do not attempt to reconstruct chapters from a changed source after restart. Mark the item
“Needs re-analysis” if required metadata is unavailable.

### 12.3 Playlist queue

For packaging options applied to playlist entries:

- Clone immutable packaging config per entry.
- Never share mutable arrays of selected subtitle languages between jobs.
- Each entry’s sidecars must remain next to that entry’s primary output.
- A failed sidecar must not corrupt the next entry’s artifact discovery.
- Queue completion summary must distinguish completed media from optional-artifact warnings.

## 13. Filesystem and naming rules

### 13.1 Output template

Use yt-dlp’s supported section/chapter output fields for initial filenames. The agent must verify
field availability with the bundled yt-dlp binary and a fixture before committing the template.

The app-side finalization layer remains the defense-in-depth boundary:

- Sanitize illegal Windows characters.
- Remove control characters.
- Handle reserved device names.
- Trim trailing dots/spaces.
- Cap names according to the existing 200-character rule.
- Preserve file extensions.
- Resolve case-insensitive collisions with `_1`, `_2`, etc.

### 13.2 Sidecar association

Associate sidecars with a primary artifact by the sanitized basename and job-local path, not by
parsing arbitrary log lines. If association is ambiguous, preserve the files in the partial
directory and show a warning/failure requiring user review.

### 13.3 Disk estimates

Extend the existing preflight estimate:

- Primary media estimate remains the existing selected-format estimate.
- Each clip range reserves a conservative fraction or full source estimate when no reliable
  section estimate exists.
- Chapter splitting reserves the sum of selected chapter estimates when available; otherwise use a
  conservative source estimate plus sidecar allowance.
- Subtitle/JSON/description/thumbnail overhead gets a bounded fixed reserve, not an unbounded
  assumption.
- Parallel playlist reservation must include the sum of in-flight job estimates as it does today.

If the estimate is uncertain, show “size estimate unavailable” and retain the existing behavior
for unknown estimates rather than inventing false precision.

## 14. Performance and memory guardrails

These features must not reintroduce the issues identified in the performance audit.

### 14.1 Main process

- Do not retain all stdout lines for multi-output jobs.
- Keep stderr classification tails bounded.
- Use asynchronous directory scans and moves.
- Do not read complete subtitle or JSON artifacts into memory just to move them.
- Do not buffer a complete media file or subtitle archive in JS.
- Coalesce routine progress events.
- Cap warnings and artifact lists.

### 14.2 Renderer

- Chapter selection updates must not rerender the entire preview card on every playback tick.
- Use stable callbacks for preview controls.
- Window long chapter lists.
- Keep selected indexes as a bounded set/array; avoid copying the entire metadata object for every
  checkbox event.
- Do not preload subtitle contents until the user explicitly requests a preview.
- Do not show complete subtitle text in the download configuration screen.

### 14.3 Measurable acceptance targets

For this feature milestone, verify:

- Adding/removing a chapter remains responsive with 1,000 chapters.
- A 5,000-cue transcript/metadata payload does not cause monotonic renderer memory growth across
  20 open/close cycles.
- A two-hour recording with packaging disabled or enabled has stable Electron memory after the
  bounded-output fix.
- A 50-output chapter split does not retain the full CLI transcript.
- Routine progress IPC remains within the existing target of at most five updates per second per
  job.
- Existing idle/peak budgets remain tracked using private memory, not only working set.

## 15. Test and fixture plan

### 15.1 Shared model tests

Add table-driven tests for:

- Valid and invalid time strings.
- Zero-length ranges.
- Negative, NaN, Infinity, and excessively large times.
- End before start.
- Overlap rejection.
- Duplicate selected chapter indexes.
- Out-of-range chapter indexes.
- Range-count cap.
- Normalization/deduplication of subtitle language codes.
- Unsupported subtitle formats.
- Packaging with no enabled output.
- Embed/sidecar compatibility.
- Missing subtitle availability.

### 15.2 Metadata fixtures

Add or extend redacted `-J` fixtures containing:

- Manual subtitles in multiple languages.
- Automatic captions with different formats.
- A video with no subtitles.
- Chapters with unsafe titles.
- Chapters with duplicate timestamps or missing duration.
- A live stream with no chapters.
- A playlist entry that has different subtitle availability from another entry.

Tests must assert that raw subtitle URLs are not present in mapped renderer metadata.

### 15.3 Argument snapshots

Add snapshots for:

1. Existing full video defaults.
2. One fast custom clip.
3. One precise custom clip.
4. Multiple fast clips.
5. Selected chapters.
6. Split all chapters.
7. Manual subtitles as sidecars.
8. Automatic subtitles embedded.
9. Manual + automatic subtitles, both embedded and sidecar.
10. Metadata and thumbnail embedding.
11. Info JSON and description.
12. Audio-only packaging.
13. Invalid/disabled combinations produce no spawn argv.
14. Cookies plus all new options.

### 15.4 Orchestrator tests

Add fake runner fixtures for:

- One primary output.
- Three primary outputs.
- Primary outputs plus subtitle sidecars.
- Multiple `after_move:filepath` lines.
- Missing printed path with a valid single-output fallback.
- A zero-byte output.
- One missing output in a multi-output job.
- Collision on one chapter target.
- Failure while moving output three of five.
- Cancellation during download.
- Cancellation during finalization.
- Retry after network failure without duplicate artifact paths.
- Immediate completion before the renderer waiter is registered.

Assertions:

- Every successful primary file exists and is non-zero.
- Temp files are removed only after verification.
- Failed jobs retain recoverable partials.
- `outputPath`, `outputPaths`, and `sidecarPaths` are correct.
- Warnings are bounded and specific.
- No unrelated file in the temp directory is reported as an output.

### 15.5 Renderer tests/manual checks

Script or manually verify:

- New video analysis exposes subtitle availability.
- New playlist analysis disables clip controls.
- Live analysis disables clip/chapter controls.
- Changing the URL clears old chapter and subtitle state.
- Selecting a chapter creates the correct range.
- Invalid times cannot start a job.
- Fast versus precise labels are clear.
- Subtitle language and source badges are correct.
- Unsupported embed combinations are explained.
- Single-output and multi-output completion states both work.
- Search quick-download remains unchanged and uses defaults.

## 16. Implementation sequence

### Milestone C1 — Contracts and pure logic

Estimated effort: 1–2 days.

Deliver:

- Shared models and bounded constants.
- Subtitle mapping from metadata.
- Pure validation/capability helpers.
- IPC parser validation.
- Error messages if new error codes are required.
- Unit tests for all pure functions.

Gate:

```text
npm run typecheck
npm run lint
npm run test
```

No renderer controls yet. Existing behavior must remain unchanged.

### Milestone C2 — Argument builders

Estimated effort: 1–2 days.

Deliver:

- Clip/chapter arg builders.
- Subtitle/packaging arg builders.
- Verified current-binary option names.
- Output-template strategy for sections/chapters.
- Full snapshot suite.

Gate:

- All argument snapshots pass.
- Security tests prove user input remains isolated argv values.
- Existing M3 mode snapshots remain stable at defaults.

### Milestone C3 — Multi-output orchestrator

Estimated effort: 2–4 days.

Deliver:

- Per-job artifact state.
- Multiple primary path capture.
- Sidecar discovery/classification.
- Async multi-artifact finalization.
- Completion payload extension.
- Cancellation/retry/resume handling.
- Fake multi-output fixtures and tests.

Gate:

- All orchestrator tests pass.
- No “largest file wins” fallback for multi-output jobs.
- Cleanup and rollback behavior is proven for partial failure.

### Milestone C4 — Downloader UI

Estimated effort: 2–4 days.

Deliver:

- Clip/chapter panel.
- Subtitle packaging panel.
- Metadata packaging panel.
- Typed selection wiring.
- Preflight warnings and output summary.

Gate:

- Single-video custom clip works.
- Selected chapter download works.
- Subtitle sidecar and metadata packaging work.
- Full-media default behavior is unchanged.

### Milestone C5 — Queue and polish

Estimated effort: 1–2 days.

Deliver:

- Multi-output queue rows.
- Playlist packaging behavior.
- Completion artifact summary.
- Reveal/open actions.
- Persisted queue backward compatibility.
- Accessibility and keyboard behavior.

Gate:

- Playlist entries package independently.
- A failed entry does not contaminate the next entry.
- Old queue snapshots load.
- UI has no stale cross-analysis chapter/subtitle state.

### Milestone C6 — Integration and performance verification

Estimated effort: 1–3 days.

Deliver:

- Real public CC test clip integration path where available.
- Manual test checklist completion.
- Memory/IPC/list-rendering measurements.
- Documentation update.
- Demo note in `specs/demo-log.md`.

Gate:

```text
npm run typecheck
npm run lint
npm run test
npm run build
```

Then execute the feature-specific smoke matrix below.

## 17. Feature smoke matrix

| Scenario | Expected result |
|---|---|
| Existing full MP4 download with all new options off | Same argv/output behavior as before. |
| One fast clip | One playable output, no full-source output, clear fast-cut label. |
| One precise clip | FFmpeg processing is visible; output boundaries are precise within test tolerance. |
| Three non-overlapping clips | Three verified primary outputs; one completion event lists all three. |
| Split all chapters | One file per chapter; unsafe titles sanitized; no collisions. |
| Select two chapters | Exactly two primary outputs; unselected chapters absent. |
| Manual English subtitles sidecar | Media plus subtitle sidecar finalized together. |
| Auto subtitles embedded | Embed flag used; output/container compatibility validated. |
| Manual + auto subtitles | Correct source selection; no accidental language explosion. |
| Metadata + thumbnail embedded | Both are packaged or a clear catalog error is returned. |
| Info JSON + description | Auxiliary files appear beside the primary output. |
| No subtitles available | Download can complete with a warning; no fake subtitle artifact. |
| Playlist with packaging options | Each entry gets independent packaging and artifact lists. |
| Live stream | Clip/chapter controls disabled; existing recording flow remains intact. |
| Cancel during clip download | Child tree dies; partials retained; UI returns to idle/recoverable state. |
| Cancel during multi-output finalization | Moved outputs and remaining partials are reported accurately. |
| Network retry | Same config resumes without duplicate output paths. |
| Restart with old queue snapshot | Snapshot loads without new-field errors. |
| Chapter title with Windows-reserved characters | Safe filename; no path traversal. |
| Subtitle language containing shell metacharacters | Rejected; no shell execution; no malformed argv. |

## 18. Documentation updates

Update:

- `README.md` with the user-facing capabilities and limitations.
- `specs/ec-verifications.md` with clip, chapter, subtitle, and packaging repros.
- `specs/demo-log.md` with one visible checkpoint per milestone.
- `specs/Implementation_Plan.md` with the new milestone mapping.
- `specs/perf-report.md` or the current performance artifact with multi-output and subtitle tests.
- Any license/attribution notes required by the chosen yt-dlp/FFmpeg capabilities.

Document clearly:

- Subtitle and chapter availability depends on the source.
- Automatic subtitles may be absent or lower quality.
- Precise cuts can be slower because they may re-encode.
- Embedded subtitle support depends on container/player compatibility.
- Sidecar files are preserved when embedding is unavailable or disabled.

## 19. Definition of done

The feature is complete only when all of the following are true:

- Single clips work in fast and precise modes.
- Multiple clips produce and finalize multiple outputs correctly.
- Chapter splitting and selected chapters work without unsafe filenames.
- Subtitle availability is shown from typed metadata without exposing URLs.
- Manual and automatic subtitle downloads work with validated language selection.
- Subtitles can be embedded or saved as sidecars according to the selected options.
- Thumbnail and metadata packaging work through the approved yt-dlp/FFmpeg path.
- Info JSON and description sidecars work when requested.
- Existing full downloads, audio downloads, playlists, live recording, retry, resume, and cancel
  behavior continue to pass.
- Main-process output capture remains bounded.
- Large artifact moves remain asynchronous.
- Multi-output cleanup obeys the verify-before-delete rule.
- IPC payloads are fully validated server-side.
- Unit, integration, smoke, and performance checks pass.
- The agent has not added an unapproved dependency or privileged renderer capability.
- Documentation and demo evidence are updated.

## 20. Recommended agent handoff prompt

Use the following prompt when delegating implementation:

> Implement `specs/clip-chapter-subtitle-metadata-implementation-plan.md` in the MediaForge
> Desktop repository. Read `AGENTS.md`, the relevant PRD sections, and the performance reports
> first. Work milestone by milestone from C1 through C6. Do not skip the shared contracts,
> server-side validation, argument snapshots, multi-output orchestration tests, or cancellation/
> cleanup tests. Keep all CLI construction in `src/main/jobs/argBuilders.ts`, use argv arrays with
> `shell:false`, keep the renderer sandboxed, and preserve existing behavior when new options are
> disabled. Do not implement deferred local-file editing unless separately requested. After each
> milestone run the repository quality gate. Before declaring completion, run the full feature smoke
> matrix, update the documented demo/checklist files, and report any source/container limitation
> explicitly rather than silently falling back.

## 21. Primary references

- yt-dlp README: https://github.com/yt-dlp/yt-dlp/blob/master/README.md
- yt-dlp current option definitions: https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/options.py
- yt-dlp FAQ on download archives and section behavior: https://github.com/yt-dlp/yt-dlp/wiki/FAQ
- FFmpeg command-line documentation: https://ffmpeg.org/ffmpeg.html
- FFmpeg filters documentation: https://ffmpeg.org/ffmpeg-filters.html
- FFprobe documentation: https://ffmpeg.org/ffprobe.html
