/**
 * Network / signal detection for field surveys.
 *
 * Truth levels:
 *  1) Browser says online (navigator.onLine) — weak signal alone
 *  2) Deno API health reachable — real connectivity
 *  3) Latency → quality: offline | weak | ok | strong
 *
 * Use `isStrongEnoughToSync()` before draining offline queue.
 */

import { getApiBase, getToken } from './api'

/** Latency thresholds (ms) to Deno health */
export const LATENCY = {
  /** ≤ this → strong (good for bulk sync) */
  STRONG_MS: 1500,
  /** ≤ this → ok (single submit OK) */
  OK_MS: 4000,
  /** ≤ this → weak (prefer offline store, retry later) */
  WEAK_MS: 8000,
  /** Health request hard timeout */
  TIMEOUT_MS: 9000,
}

export const QUALITY = {
  OFFLINE: 'offline',
  WEAK: 'weak',
  OK: 'ok',
  STRONG: 'strong',
}

/**
 * @typedef {object} NetworkStatus
 * @property {boolean} deviceOnline  navigator.onLine
 * @property {boolean} apiReachable   Deno health succeeded
 * @property {boolean} online         deviceOnline && apiReachable
 * @property {'offline'|'weak'|'ok'|'strong'} quality
 * @property {number|null} latencyMs
 * @property {string} label          UI text
 * @property {number} checkedAt      Date.now()
 * @property {string|null} error
 */

export function qualityFromLatency(latencyMs, apiReachable) {
  if (!apiReachable || latencyMs == null) return QUALITY.OFFLINE
  if (latencyMs <= LATENCY.STRONG_MS) return QUALITY.STRONG
  if (latencyMs <= LATENCY.OK_MS) return QUALITY.OK
  if (latencyMs <= LATENCY.WEAK_MS) return QUALITY.WEAK
  return QUALITY.WEAK
}

export function labelForQuality(quality, _latencyMs) {
  switch (quality) {
    case QUALITY.STRONG:
      return 'Strong'
    case QUALITY.OK:
      return 'Online'
    case QUALITY.WEAK:
      return 'Weak network'
    default:
      return 'Offline'
  }
}

/**
 * Probe Deno /api/health with timeout + latency.
 * Does not require login (health is public).
 * @returns {Promise<NetworkStatus>}
 */
export async function checkNetwork() {
  const deviceOnline =
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  const checkedAt = Date.now()

  if (!deviceOnline) {
    return {
      deviceOnline: false,
      apiReachable: false,
      online: false,
      quality: QUALITY.OFFLINE,
      latencyMs: null,
      label: 'Offline',
      checkedAt,
      error: 'device offline',
    }
  }

  const base = getApiBase()
  const url = `${base}/api/health`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LATENCY.TIMEOUT_MS)
  const t0 = performance.now?.() ?? Date.now()

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      signal: controller.signal,
      cache: 'no-store',
    })
    const latencyMs = Math.round((performance.now?.() ?? Date.now()) - t0)
    clearTimeout(timer)

    if (!res.ok) {
      return {
        deviceOnline: true,
        apiReachable: false,
        online: false,
        quality: QUALITY.OFFLINE,
        latencyMs,
        label: 'Offline',
        checkedAt,
        error: `HTTP ${res.status}`,
      }
    }

    // body optional — some health returns { ok: true }
    let ok = res.ok
    try {
      const data = await res.json()
      if (data && typeof data.ok === 'boolean') ok = data.ok
    } catch {
      /* non-json still counts if HTTP 200 */
    }

    const apiReachable = !!ok
    const quality = qualityFromLatency(latencyMs, apiReachable)
    return {
      deviceOnline: true,
      apiReachable,
      online: apiReachable,
      quality,
      latencyMs: apiReachable ? latencyMs : null,
      label: labelForQuality(quality, apiReachable ? latencyMs : null),
      checkedAt,
      error: apiReachable ? null : 'health not ok',
    }
  } catch (err) {
    clearTimeout(timer)
    const latencyMs = Math.round((performance.now?.() ?? Date.now()) - t0)
    const aborted = err?.name === 'AbortError'
    return {
      deviceOnline: true,
      apiReachable: false,
      online: false,
      quality: QUALITY.OFFLINE,
      latencyMs: aborted ? LATENCY.TIMEOUT_MS : latencyMs,
      label: 'Offline',
      checkedAt,
      error: aborted ? 'timeout' : err?.message || 'fetch failed',
    }
  }
}

/** Single submit / open light API */
export function isOnlineEnough(status) {
  return (
    status?.apiReachable &&
    (status.quality === QUALITY.OK || status.quality === QUALITY.STRONG)
  )
}

/**
 * Drain offline queue only when link is strong enough.
 * weak → keep storing locally; strong/ok → sync.
 */
export function isStrongEnoughToSync(status) {
  return (
    status?.apiReachable &&
    (status.quality === QUALITY.STRONG || status.quality === QUALITY.OK)
  )
}

/**
 * Reachable at all — weak included. Used by manual "Sync now" and the
 * stale-queue fallback so packages aren't stranded forever on a persistently
 * weak link. Automatic drains still prefer isStrongEnoughToSync.
 */
export function isUsableForSync(status) {
  return !!status?.apiReachable && status.quality !== QUALITY.OFFLINE
}

/**
 * Continuous watcher: device online/offline events + periodic health probe.
 * @param {(status: NetworkStatus) => void} onChange
 * @param {{ intervalMs?: number }} [opts]
 * @returns {() => void} stop
 */
export function watchNetwork(onChange, opts = {}) {
  const intervalMs = opts.intervalMs ?? 20_000
  let stopped = false
  let timer = null
  let inFlight = false

  let lastKey = ''
  const run = async () => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      const status = await checkNetwork()
      if (stopped) return
      const key = `${status.quality}|${status.online ? 1 : 0}`
      if (key === lastKey) return
      lastKey = key
      onChange(status)
    } finally {
      inFlight = false
    }
  }

  const onOnline = () => {
    run()
  }
  const onOffline = () => {
    onChange({
      deviceOnline: false,
      apiReachable: false,
      online: false,
      quality: QUALITY.OFFLINE,
      latencyMs: null,
      label: 'Offline',
      checkedAt: Date.now(),
      error: 'device offline',
    })
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
  }

  // Immediate + periodic probe
  run()
  timer = setInterval(run, intervalMs)

  // Resume when app comes to foreground (Capacitor / mobile browser)
  const onVisible = () => {
    if (document.visibilityState === 'visible') run()
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible)
  }

  return () => {
    stopped = true
    if (timer) clearInterval(timer)
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisible)
    }
  }
}
