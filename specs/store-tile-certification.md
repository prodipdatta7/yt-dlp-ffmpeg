# Store tile certification fix (10.1.1.11)

The 0.4.0 submission contained default package tile artwork. `win.icon` and
`build/store-logo.png` do not populate MSIX tiles. electron-builder expects PNGs
with specific names in `build/appx/`, and silently substitutes defaults if absent.

The committed tiles now use the existing MediaForge Store artwork. To regenerate:

```powershell
pwsh -NoProfile -File scripts/make-store-assets.ps1
npm run dist:store
```

The Store build checks that all six logos/tiles exist with the expected dimensions.
The wide tile centers the square artwork without stretching it. No new runtime
dependency is needed.

## Submission and manual verification

1. Build the current version (0.4.3, newer than the rejected 0.4.0 package).
2. Inspect the resulting MSIX as a ZIP: every `assets/*.png` must be MediaForge
   artwork and the logo paths in `AppxManifest.xml` must reference those assets.
3. Use `scripts/smoke-msix.ps1` to sign a copy and sideload for testing. Check the
   installed app in Start, its pinned tile, and Windows Settings. This modifies
   certificate trust and installs the app; it is separate from building it.
4. In Partner Center, edit the failed submission, replace the rejected 0.4.0
   package with `dist/MediaForge-Desktop-0.4.3-store.msixupload`, and resubmit.
   Keep the existing package identity and publisher. Check Store listing icons
   also use MediaForge artwork.
5. Suggested certification note: “Replaced default package tile assets with
   MediaForge artwork for the Store logo, app list icon, and small, medium, wide,
   and large tiles. Added a packaging check for missing or incorrectly sized assets.”

Reference: https://www.electron.build/docs/msix/#msix-assets
