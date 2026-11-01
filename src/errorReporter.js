/**
 * Local error reporter — election data is sensitive, so nothing leaves the
 * VPS: errors are POSTed to /api/client-errors and stored in the
 * client_errors table for the Super Admin console.
 *
 * Captures window.onerror, unhandled promise rejections and errors reported
 * manually from React error boundaries. Deduped per message (5 min) and
 * capped, so a render loop can't flood the API.
 */
import { Capacitor } from '@capacitor/core'
import { getStoredUser } from './api'

const SEEN = new Map()
const MAX_SEEN = 50
const DEDUPE_MS = 5 * 60_000
const API_BASE = 'https://162.35.96.65.sslip.io'

function shouldSend(key) {
  const now = Date.now()
  const last = SEEN.get(key)
  if (last && now - last < DEDUPE_MS) return false
  if (SEEN.size > MAX_SEEN) {
    for (const [k, v] of SEEN) if (now - v > DEDUPE_MS) SEEN.delete(k)
  }
  SEEN.set(key, now)
  return true
}

function appName() {
  if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform?.()) return 'apk'
  const path = typeof window !== 'undefined' ? window.location.pathname : ''
  return path.startsWith('/admin') || path.startsWith('/super') ? 'portal' : 'web'
}

/** Report one error. Safe to call from anywhere; never throws. */
export function reportError(error, context = {}) {
  try {
    const message = String(error?.message || error || 'Unknown error').slice(0, 500)
    const stack = String(error?.stack || '').slice(0, 4000)
    const key = `${message}|${stack.slice(0, 120)}`
    if (!shouldSend(key)) return
    const user = getStoredUser()
    const payload = {
      app: appName(),
      version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '',
      url: typeof window !== 'undefined' ? String(window.location.href).slice(0, 300) : '',
      message,
      stack,
      user_id: user?.id ?? null,
      username: user?.username || '',
      ua: typeof navigator !== 'undefined' ? String(navigator.userAgent || '').slice(0, 300) : '',
      context: context && typeof context === 'object'
        ? JSON.parse(JSON.stringify(context, (k, v) => (typeof v === 'string' ? v.slice(0, 300) : v)))
        : null,
    }
    fetch(`${API_BASE}/api/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* the reporter must never break anything */
  }
}

let installed = false

/** Install the global hooks once at the entry point. */
export function installErrorReporter() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => {
    if (e?.target && e.target !== window) return // ignore failed asset loads
    reportError(e?.error || new Error(e?.message || 'Script error'), { kind: 'window.onerror' })
  })
  window.addEventListener('unhandledrejection', (e) => {
    reportError(e?.reason || new Error('Unhandled promise rejection'), { kind: 'unhandledrejection' })
  })
}
