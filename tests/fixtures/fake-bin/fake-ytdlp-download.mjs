import { writeFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const oIdx = process.argv.indexOf('-o')
const outTpl = oIdx >= 0 ? process.argv[oIdx + 1] : join(process.cwd(), 'out.%(ext)s')

const finalPath = outTpl
  .replace('%(title).200B', 'Fake Video')
  .replace('[%(id)s]', '[abc123]')
  .replace('.%(ext)s', '.mp4')

process.stdout.write('[download] Destination: C:/tmp/vid.f137.mp4\n')
process.stdout.write('MF|downloading|0|100||1048576|30\n')
process.stdout.write('MF|downloading|50|100||1048576|15\n')
process.stdout.write('MF|finished|100|100||||\n')
process.stdout.write('[download] Destination: C:/tmp/vid.f140.m4a\n')
process.stdout.write('MF|downloading|25|100||524288|10\n')
process.stdout.write('MF|finished|100|100||||\n')
process.stdout.write('MFPOST| 55.5%\n')
process.stdout.write('[Merger] Merging formats into "final.mp4"\n')

mkdirSync(dirname(finalPath), { recursive: true })
writeFileSync(finalPath, 'FAKE-MP4-CONTENT'.repeat(64), 'utf8')
process.stdout.write(`${finalPath}\n`)
