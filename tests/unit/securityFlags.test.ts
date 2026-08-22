import { describe, expect, it } from 'vitest'
import { createWindowOptions, getWindowSecurityFlags } from '../../src/main/windowOptions'

describe('window security posture (PRD §5.1 / AGENTS.md §6.1)', () => {
  const flags = getWindowSecurityFlags()

  it('enables context isolation', () => {
    expect(flags.contextIsolation).toBe(true)
  })

  it('disables node integration', () => {
    expect(flags.nodeIntegration).toBe(false)
  })

  it('sandboxes the renderer', () => {
    expect(flags.sandbox).toBe(true)
  })

  it('keeps web security on', () => {
    expect(flags.webSecurity).toBe(true)
  })

  it('factory embeds the same flags into BrowserWindow options', () => {
    const opts = createWindowOptions()
    expect(opts.webPreferences).toMatchObject(flags)
    expect(opts.show).toBe(false)
  })
})
