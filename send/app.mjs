const { URL } = globalThis
import { destination, forgetPairing, readFragment, readPairing, savePairing } from './shortcut.mjs'

const { document, location, history, navigator } = globalThis
const element = (id) => document.getElementById(id)
let stored = null
try {
  stored = readPairing(globalThis.localStorage)
} catch {
  /* Storage may be blocked. */
}
let pendingPair = null
let pendingUrl = ''
const prefix = location.origin + location.pathname + '#'
element('prefix').textContent = prefix
element('example').textContent = prefix + 'https://youtu.be/VIDEO_ID'

function message(text) {
  element('status').textContent = text
}
function paint() {
  element('pair-panel').hidden = !pendingPair
  element('send-panel').hidden = !stored || Boolean(pendingPair)
  element('setup-panel').hidden = Boolean(stored) || Boolean(pendingPair)
  element('connection').textContent = stored
    ? 'Receiver saved for this session'
    : 'Pair your computer to begin'
  if (pendingPair) element('pair-host').textContent = new URL(pendingPair.url).hostname
  if (stored)
    element('expiry').textContent =
      'Session expires at ' + new Date(stored.expiresAt).toLocaleTimeString() + '.'
  element('video').value = pendingUrl
}

function send(raw) {
  const target = destination(stored, raw)
  if (!target) {
    message(
      'Check the video URL. If your session expired, start receiving again in MediaForge and scan the new pairing code.',
    )
    return
  }
  message('Opening your computer’s receiver… Keep both devices on the same Wi-Fi or LAN.')
  // A top-level navigation, not an HTTPS-to-HTTP fetch or embedded frame.
  location.assign(target)
}

element('pair').addEventListener('click', () => {
  try {
    stored = savePairing(globalThis.localStorage, pendingPair)
    pendingPair = null
    paint()
    message('Paired. Prepend the shortcut below to any video URL in this browser.')
  } catch (error) {
    message(error.message || 'Allow browser storage, then try pairing again.')
  }
})
element('cancel-pair').addEventListener('click', () => {
  pendingPair = null
  paint()
  message('Pairing cancelled.')
})
element('forget').addEventListener('click', () => {
  try {
    forgetPairing(globalThis.localStorage)
    stored = null
    paint()
    message('Receiver forgotten.')
  } catch {
    message('Could not clear browser storage. Clear this site’s data in browser settings.')
  }
})
element('send-form').addEventListener('submit', (event) => {
  event.preventDefault()
  send(element('video').value)
})
element('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(prefix)
    message('Shortcut prefix copied.')
  } catch {
    message('Select the shortcut prefix and copy it manually.')
  }
})
function consumeFragment() {
  const fragment = readFragment(location.hash)
  // Strip capabilities and video URLs from history before rendering or leaving the page.
  history.replaceState(null, '', location.pathname)
  pendingPair = fragment.kind === 'pair' ? fragment.value : null
  pendingUrl = fragment.kind === 'send' ? fragment.url : ''
  try {
    stored = readPairing(globalThis.localStorage)
  } catch {
    stored = null
  }
  paint()
  message('')
  if (fragment.kind === 'error')
    message('This shortcut is invalid or expired. Scan a fresh pairing code from MediaForge.')
  if (pendingUrl && !stored)
    message(
      'Pair this browser first, then open your video shortcut again. Links open in the browser you paired, not an in-app browser.',
    )
  if (pendingUrl && stored) send(pendingUrl)
}
globalThis.addEventListener('hashchange', consumeFragment)
consumeFragment()
