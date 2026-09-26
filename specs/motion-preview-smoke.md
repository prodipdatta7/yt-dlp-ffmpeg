# Preview modal motion regression check

Verified in a local browser harness using the real InlineVideoPreviewModal component:
opening → open → closing → unmounted; focus returned to the opener; early Escape
prevented reopening; duplicate Quick Download clicks produced one action; reduced
motion opened and dismissed immediately. The harness used no media URL, so it checks
modal lifecycle rather than provider playback. Build, TypeScript, and changed-file
ESLint checks also passed.

Run for both a search result's Focused Preview and the expanded downloader preview.

1. Open the preview. The backdrop fades in while the panel gently rises and scales
   into place over 280 ms. Playback starts after the panel has settled.
2. Close with the close button, Escape, and a click on the backdrop. Media stops
   immediately; the shell fades out over 180 ms before focus returns to the opener.
3. Close immediately after opening and press Escape repeatedly. Playback must never
   start afterward, and the preview must dismiss only once.
4. Reopen, seek, then close the expanded downloader preview. Reopening must retain
   the existing playback-position behavior.
5. Choose Open in Downloader or Quick Download where offered. The exit completes
   before the action runs, and the action runs only once even with repeated clicks.
6. Tab through the dialog during opening and closing. Focus stays inside until it
   unmounts. Verify the overlay still covers the viewport when its result is scrolled.
7. Repeat with Motion graphics disabled and with OS reduced motion enabled. Opening
   and closing must be immediate, with the same controls and playback behavior.
