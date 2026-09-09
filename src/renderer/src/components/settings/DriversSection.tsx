import { DriverUpdateCard } from '../DriverUpdateCard'

export function DriversSection() {
  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-ink">Core drivers</h3>
        <span class="text-[11px] text-slate-600">
          checksum-verified · atomic swap · auto rollback
        </span>
      </div>

      <DriverUpdateCard
        kind="yt-dlp"
        title="yt-dlp"
        description="Extracts media info and downloads streams. Platforms change constantly, so this can go stale. Updates come from official yt-dlp releases and are SHA-256 verified before an atomic swap; failed swaps roll back automatically."
        sourceLabel="official yt-dlp GitHub releases"
      />

      <DriverUpdateCard
        kind="ffmpeg"
        title="FFmpeg"
        description="Muxes and transcodes the downloaded streams. Updates come from BtbN's LGPL Windows builds, verified the same way. The archive is tens of MB, so this can take a moment."
        sourceLabel="BtbN FFmpeg-Builds (LGPL)"
      />
    </div>
  )
}
