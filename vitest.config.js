import { defineConfig } from 'vitest/config'

// Pure-logic tests only: no DOM, no component rendering, so the default node
// environment is enough and these run in well under a second.
export default defineConfig({
  // Mirror the globals vite.config.js injects at build time, so version.js is
  // exercised with a real release's values instead of its '0.0.0-dev' fallback.
  define: {
    __APP_VERSION__: JSON.stringify('2.0.88'),
    __APP_BUILD__: JSON.stringify('2026-10-17'),
    __APP_VERSION_CODE__: '20088',
  },
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
  },
})
