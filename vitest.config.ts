import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const runtimeGuard = fileURLToPath(
  new URL('./tests/guards/forbidden-runtime.ts', import.meta.url)
)

export default defineConfig({
  resolve: {
    alias: [
      { find: /^electron$/, replacement: runtimeGuard },
      { find: /^better-sqlite3$/, replacement: runtimeGuard }
    ]
  },
  test: {
    environment: 'node',
    include: [
      'tests/safety/**/*.test.ts',
      'tests/unit/**/*.test.ts'
    ],
    setupFiles: ['./tests/setup/unit.setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true
  }
})
