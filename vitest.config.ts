import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Memory guards (T1 soak, T6 updater ceilings) measure retention, not GC timing.
    // Without --expose-gc they would be reading uncollected garbage.
    execArgv: ['--expose-gc'],
  },
})
