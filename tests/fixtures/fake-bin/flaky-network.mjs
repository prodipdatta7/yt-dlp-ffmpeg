import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const oIdx = process.argv.indexOf('-o')
const outTpl = oIdx >= 0 ? process.argv[oIdx + 1] : join(process.cwd(), 'out.%(ext)s')

const candidateState = process.argv[2]
const statePath =
  candidateState && !candidateState.startsWith('-')
    ? candidateState
    : join(dirname(outTpl), 'attempts.json')

let attempts = 0
if (existsSync(statePath)) {
  attempts = JSON.parse(readFileSync(statePath, 'utf8')).attempts ?? 0
}
attempts += 1
writeFileSync(statePath, JSON.stringify({ attempts }), 'utf8')

if (attempts <= 2) {
  process.stderr.write('ERROR: Unable to download webpage: getaddrinfo ENOTFOUND x.test\n')
  process.exit(1)
}

const finalPath = outTpl
  .replace('%(title).200B', 'Flaky Video')
  .replace('[%(id)s]', '[flaky1]')
  .replace('.%(ext)s', '.mp4')

writeFileSync(finalPath, 'RETRY-SUCCESS'.repeat(32), 'utf8')
process.stdout.write(`${finalPath}\n`)
