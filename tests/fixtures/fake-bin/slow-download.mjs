import { writeFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const oIdx = process.argv.indexOf('-o')
const outTpl = oIdx >= 0 ? process.argv[oIdx + 1] : join(process.cwd(), 'out.%(ext)s')
const finalPath = outTpl
  .replace('%(title).200B', 'Slow Video')
  .replace('[%(id)s]', '[slow01]')
  .replace('.%(ext)s', '.mp4')

process.stdout.write('MF|downloading|10|100||1024|30\n')
setTimeout(() => {
  mkdirSync(dirname(finalPath), { recursive: true })
  writeFileSync(finalPath, 'SLOW-CONTENT', 'utf8')
  process.stdout.write(`${finalPath}\n`)
}, 4000)
