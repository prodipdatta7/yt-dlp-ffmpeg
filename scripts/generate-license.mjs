#!/usr/bin/env node
// Dev-only tool — never shipped in the app. Run after each external sale to
// mint a license key for the buyer:
//
//   node scripts/generate-license.mjs buyer@example.com
//
// Reuses the same Ed25519 keypair across runs (keys/license-private.pem,
// gitignored) so every key it prints verifies against the single public key
// embedded in src/main/licensing/license.ts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateKeyPairSync, createPrivateKey, sign } from 'node:crypto'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const keysDir = join(repoRoot, 'keys')
const privateKeyPath = join(keysDir, 'license-private.pem')

function loadOrCreateKeyPair() {
  if (existsSync(privateKeyPath)) {
    const privateKey = createPrivateKey(readFileSync(privateKeyPath, 'utf8'))
    return { privateKey, isNew: false }
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  mkdirSync(keysDir, { recursive: true })
  writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }))
  const pubDer = publicKey.export({ type: 'spki', format: 'der' })
  console.info('Generated a new signing keypair.')
  console.info('Paste this into PUBLIC_KEY_B64 in src/main/licensing/license.ts:\n')
  console.info(pubDer.toString('base64'))
  console.info()
  return { privateKey, isNew: true }
}

function main() {
  const email = process.argv[2]
  if (!email || !email.includes('@')) {
    console.error('Usage: node scripts/generate-license.mjs <buyer-email>')
    process.exitCode = 1
    return
  }

  const { privateKey } = loadOrCreateKeyPair()

  const payload = { email, tier: 'pro', iat: Date.now() }
  const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8')
  const signature = sign(null, payloadBuf, privateKey)

  const key = `MFPRO.${payloadBuf.toString('base64url')}.${signature.toString('base64url')}`
  console.info(`License key for ${email}:\n`)
  console.info(key)
}

main()
