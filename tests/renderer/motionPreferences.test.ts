import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('renderer motion preferences', () => {
  let classes: Set<string>

  beforeEach(() => {
    vi.resetModules()
    classes = new Set()
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
    })
    vi.stubGlobal('document', {
      documentElement: {
        dataset: {},
        classList: {
          toggle: (name: string, enabled: boolean) =>
            enabled ? classes.add(name) : classes.delete(name),
        },
      },
    })
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage unavailable')
      },
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('applies motion and grid switches even when storage is unavailable', async () => {
    const { setAmbientGrid, setAnimationsEnabled } =
      await import('../../src/renderer/src/signals/uiState')

    setAnimationsEnabled(false)
    setAmbientGrid(false)
    expect(classes.has('mf-reduced-motion')).toBe(true)
    expect(classes.has('mf-no-ambient-grid')).toBe(true)

    setAnimationsEnabled(true)
    setAmbientGrid(true)
    expect(classes.has('mf-reduced-motion')).toBe(false)
    expect(classes.has('mf-no-ambient-grid')).toBe(false)
  })
})
