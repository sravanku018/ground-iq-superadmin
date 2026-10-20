import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Single source: package.json version + versionCode (synced to Android via scripts/sync-version.mjs)
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const appVersion = pkg.version || '0.0.0'
const appVersionCode = Number(pkg.versionCode) || 0
// Build stamp for login footer (e.g. 2026-08-02 12:30)
const buildStamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
const projectRoot = fileURLToPath(new URL('.', import.meta.url))

/**
 * Vercel only: serve the landing directly at `/`.
 *
 * Vite writes dist/index.html (SPA) and dist/landing.html (public). On Vercel
 * we keep the SPA as app.html and make index.html the landing, so `/` is the
 * landing without a redirect. APK builds have no VERCEL env, so their
 * index.html remains the field-app entry.
 */
function vercelLandingRoot() {
  return {
    name: 'vercel-landing-root',
    apply: 'build',
    closeBundle() {
      if (process.env.VERCEL !== '1') return
      const dist = join(projectRoot, 'dist')
      const index = join(dist, 'index.html')
      const landing = join(dist, 'landing.html')
      const app = join(dist, 'app.html')
      if (!existsSync(index) || !existsSync(landing)) return
      copyFileSync(index, app)
      copyFileSync(landing, index)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages needs /<repo>/ base; local dev / APK builds default to '/'
  base: process.env.VITE_BASE || '/',
  plugins: [react(), vercelLandingRoot()],
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
