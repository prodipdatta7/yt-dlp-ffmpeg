// Emits N lines on stdout as fast as the pipe allows. Used by the runner capture tests
// and by the T1 soak test (P-01) that proves 'none' capture leaves the main heap flat.
// Usage: node line-emitter.mjs <count> [prefix]
const count = Number(process.argv[2] ?? 1000)
const prefix = process.argv[3] ?? 'line'

const CHUNK = 1000
let i = 0

function writeChunk() {
  while (i < count) {
    let buf = ''
    const end = Math.min(count, i + CHUNK)
    for (; i < end; i++) buf += `${prefix} ${i}\n`
    if (!process.stdout.write(buf)) {
      process.stdout.once('drain', writeChunk)
      return
    }
  }
}

writeChunk()
