import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Single source: package.json version + versionCode (synced to Android via scripts/sync-version.mjs)
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const appVersion = pkg.version || '0.0.0'
const appVersionCode = Number(pkg.versionCode) || 0
// Build stamp for login footer (e.g. 2026-08-02 12:30)
const buildStamp = new Date().toISOString().slice(0, 16).replace('T', ' ')

// Vercel imports of the two GitHub repos do not get the Pages workflow env
// (VITE_FIELD_APP=0, VITE_SUPER_ADMIN=1). Without those, App.jsx defaults to
// the surveyor field app. Detect the Vercel project and bake the portal flags.
{
  const onVercel = process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV)
  if (onVercel) {
    const repo = (
      process.env.VERCEL_GIT_REPO_SLUG ||
      process.env.VERCEL_PROJECT_NAME ||
      ''
    ).toLowerCase()
    if (process.env.VITE_FIELD_APP == null) process.env.VITE_FIELD_APP = '0'
    if (process.env.VITE_SUPER_ADMIN == null) {
      process.env.VITE_SUPER_ADMIN = repo.includes('superadmin') ? '1' : '0'
    }
    if (process.env.VITE_BASE == null) process.env.VITE_BASE = '/'
    console.log(
      `[vite] Vercel portal: repo=${repo || '(unknown)'} ` +
        `VITE_FIELD_APP=${process.env.VITE_FIELD_APP} ` +
        `VITE_SUPER_ADMIN=${process.env.VITE_SUPER_ADMIN}`,
    )
  }
}

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
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    // Smaller first paint on GitHub Pages — only preload direct entry deps
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // Keep React separate so admin shell caches across deploys of feature chunks
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('\\react\\')) {
            return 'react-vendor'
          }
          // Heavy chart lib — only pulled when Analyze/Dashboard opens
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) {
            return 'charts'
          }
          // Map stack — only when SurveyMap opens
          if (id.includes('leaflet')) {
            return 'leaflet'
          }
        },
      },
    },
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
