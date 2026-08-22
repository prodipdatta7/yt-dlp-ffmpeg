import { writeFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const oIdx = process.argv.indexOf('-o')
const outTpl = oIdx >= 0 ? process.argv[oIdx + 1] : join(process.cwd(), 'out.%(ext)s')
const partPath = outTpl
  .replace('%(title).200B', 'Live Recording')
  .replace('[%(id)s]', '[live01]')
  .replace('.%(ext)s', '.mp4.part')

process.stdout.write('MF|downloading|100|1000||2048|60\n')
mkdirSync(dirname(partPath), { recursive: true })
writeFileSync(partPath, 'LIVE-RECORDING-DATA'.repeat(64), 'utf8')
setInterval(() => process.stdout.write('MF|downloading|500|1000||2048|59\n'), 500)
