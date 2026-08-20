/**
 * App version — single source at build time from package.json via Vite.
 * Stored in localStorage so UI always shows the running build.
 */

export const APP_NAME = 'smartsuveyx'
export const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev'
export const APP_BUILD =
  typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 'dev'
export const APP_VERSION_CODE =
  typeof __APP_VERSION_CODE__ !== 'undefined' ? Number(__APP_VERSION_CODE__) : 0

const STORE_KEY = 'esurvey_app_version'
const STORE_META_KEY = 'esurvey_app_version_meta'

/** Short label for footers: v1.6.2 · 2026-08-02 12:00 */
export function versionLabel() {
  return `v${APP_VERSION} · ${APP_BUILD}`
}

/** Full label with versionCode (Android) */
export function versionFullLabel() {
  const code = APP_VERSION_CODE ? ` (#${APP_VERSION_CODE})` : ''
  return `v${APP_VERSION}${code} · build ${APP_BUILD}`
}

const RELOAD_KEY = 'esurvey_reloaded_after_upgrade'

/**
 * Persist running version so we can detect upgrades.
 * upgraded=true when the stored bundle differs from the one running now —
 * i.e. a new build was deployed. The SPA shell calls reloadOnceIfUpgraded() on
 * mount so a stale cached index.html (which references now-removed hashed
 * chunks) self-heals instead of failing to lazy-load screens.
 */
export function storeAppVersion() {
  const meta = {
    version: APP_VERSION,
    build: APP_BUILD,
    versionCode: APP_VERSION_CODE,
    storedAt: new Date().toISOString(),
  }
  try {
    const prev = localStorage.getItem(STORE_KEY)
    const prevMetaRaw = localStorage.getItem(STORE_META_KEY)
    let prevBuild = null
    try {
      prevBuild = prevMetaRaw ? JSON.parse(prevMetaRaw).build : null
    } catch {
      /* ignore corrupt meta */
    }
    localStorage.setItem(STORE_KEY, APP_VERSION)
    localStorage.setItem(STORE_META_KEY, JSON.stringify(meta))
    const upgraded =
      prev != null && (prev !== APP_VERSION || (prevBuild != null && prevBuild !== APP_BUILD))
    return { prev, current: APP_VERSION, build: APP_BUILD, upgraded }
  } catch {
    return { prev: null, current: APP_VERSION, build: APP_BUILD, upgraded: false }
  }
}

/**
 * Detect upgrade and persist the running build in one step.
 * When a newer build was deployed, hard-reloads once (stale-bundle self-heal)
 * so the fresh index.html → new hashed chunks are served.
 * Cooldown: skips the auto-reload if one already happened in the last 30s,
 * which is exactly the window before the fresh bundle takes over (upgraded=false).
 * Returns the upgrade info so callers can log/title without re-detecting.
 */
export function reloadOnceIfUpgraded() {
  const info = storeAppVersion()
  if (info.upgraded) {
    try {
      const last = Number(localStorage.getItem(RELOAD_KEY) || 0)
      if (Date.now() - last >= 30_000) {
        localStorage.setItem(RELOAD_KEY, Date.now().toString())
        window.location.reload()
      }
    } catch {
      /* ignore */
    }
  }
  return info
}

export function getStoredAppVersion() {
  try {
    const raw = localStorage.getItem(STORE_META_KEY)
    if (raw) return JSON.parse(raw)
    return { version: localStorage.getItem(STORE_KEY) || APP_VERSION }
  } catch {
    return { version: APP_VERSION }
  }
}

/** Payload fragment to send with API calls / debug */
export function versionPayload() {
  return {
    app_version: APP_VERSION,
    app_build: APP_BUILD,
    app_version_code: APP_VERSION_CODE,
  }
}
