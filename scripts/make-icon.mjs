import { spawnSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'

// The header, Store tiles, and executable share build/store-logo.png.
const result = spawnSync(
  'pwsh',
  [
    '-NoProfile',
    '-File',
    fileURLToPath(new URL('./make-icon.ps1', import.meta.url)),
    ...(process.argv.includes('--check') ? ['-Check'] : []),
  ],
  { stdio: 'inherit', shell: false, windowsHide: true },
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
