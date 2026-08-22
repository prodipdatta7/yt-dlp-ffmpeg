import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const oIdx = process.argv.indexOf('-o')
const outTpl = oIdx >= 0 ? process.argv[oIdx + 1] : join(process.cwd(), 'out.%(ext)s')
const partialPath = outTpl
  .replace('%(title).200B', 'Broken')
  .replace('[%(id)s]', '[x]')
  .replace('.%(ext)s', '.mp4.part')

process.stdout.write('MF|downloading|10|100||1024|9\n')
mkdirSync(dirname(partialPath), { recursive: true })
writeFileSync(partialPath, 'PARTIAL'.repeat(16), 'utf8')
process.stderr.write('ERROR: unable to download video data: HTTP Error 429: Too Many Requests\n')
process.exit(1)
