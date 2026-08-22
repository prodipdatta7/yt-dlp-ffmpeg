import { resolve } from 'node:path'
import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

const STRICT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'none'"
const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' http://localhost:*; style-src 'self' 'unsafe-inline' http://localhost:*; img-src 'self' https: data:; connect-src 'self' ws://localhost:* http://localhost:*"

function cspPlugin(): Plugin {
  return {
    name: 'mf:csp',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        return html.replace('%MF_CSP%', ctx.server ? DEV_CSP : STRICT_CSP)
      },
    },
  }
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    plugins: [preact(), tailwindcss(), cspPlugin()],
  },
})
