/**
 * App version — single source at build time from package.json via Vite.
 * Stored in localStorage so UI always shows the running build.
 */

export const APP_NAME = 'Ground IQ'
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

/** Persist running version so we can detect upgrades */
export function storeAppVersion() {
  const meta = {
    version: APP_VERSION,
    build: APP_BUILD,
    versionCode: APP_VERSION_CODE,
    storedAt: new Date().toISOString(),
  }
  try {
    const prev = localStorage.getItem(STORE_KEY)
    localStorage.setItem(STORE_KEY, APP_VERSION)
    localStorage.setItem(STORE_META_KEY, JSON.stringify(meta))
    return { prev, current: APP_VERSION, upgraded: prev != null && prev !== APP_VERSION }
  } catch {
    return { prev: null, current: APP_VERSION, upgraded: false }
  }
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
