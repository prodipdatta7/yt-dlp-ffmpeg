import { spawn } from 'node:child_process'

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
process.stdout.write(`${JSON.stringify({ child: child.pid })}\n`)
setTimeout(() => process.exit(0), 30_000)
