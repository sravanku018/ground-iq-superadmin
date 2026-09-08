import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Single source: package.json version + versionCode (synced to Android via scripts/sync-version.mjs)
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const appVersion = pkg.version || '0.0.0'
const appVersionCode = Number(pkg.versionCode) || 0
// Build stamp for login footer (e.g. 2026-08-02 12:30)
const buildStamp = new Date().toISOString().slice(0, 16).replace('T', ' ')

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages needs /<repo>/ base; local dev / APK builds default to '/'
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  appType: 'spa',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_VERSION_CODE__: JSON.stringify(appVersionCode),
    __APP_BUILD__: JSON.stringify(buildStamp),
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
