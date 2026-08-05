/**
 * Systematic sync engine:
 *  Local package → 1) POST Q/A  → 2) POST photo  → 3) POST audio  → done
 * Never uploads from the form UI; only drains the device queue.
 */

import { getApiBase, getToken } from './api'
import {
  getPackage,
  listPendingPackages,
  queueStats,
  removePackage,
  updatePackage,
} from './localStore'
import { checkNetwork, isStrongEnoughToSync, watchNetwork } from './network'

const TICK_MS = 60_000
const POST_TIMEOUT = 45_000

let running = false
let started = false
let tickTimer = null
let stopWatch = null
const listeners = new Set()

function emit(ev) {
  for (const fn of listeners) {
    try {
      fn(ev)
    } catch {
      /* ignore */
    }
  }
}

export function onSyncEngine(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

async function fetchJson(url, { method = 'GET', token, body } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT)
  try {
    const hasBody = body != null && method !== 'GET' && method !== 'HEAD'
    const res = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
      cache: 'no-store',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(data.error || data.message || `HTTP ${res.status}`)
      err.status = res.status
      throw err
    }
    return data
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Process one package in order: QA → photo → audio
 */
export async function syncOnePackage(id) {
  const token = getToken()
  if (!token) throw new Error('Not logged in')
  const base = getApiBase()
  let pkg = await getPackage(id)
  if (!pkg || pkg.phase === 'done') return { skipped: true }

  await updatePackage(id, { phase: 'syncing' })
  emit({ type: 'package-start', id })

  try {
    // 1) Q/A
    if (!pkg.flags?.qa || !pkg.serverSubmissionId) {
      // Client hard-lock: never sync package missing geo/photo/audio
      if (!pkg.qa?.geo?.lat || !pkg.photoDataUrl || !pkg.audioDataUrl) {
        throw new Error('Package incomplete — GPS, photo and voice are locked requirements')
      }
      const qaBody = {
        form_key: pkg.qa.form_key,
        form_id: pkg.qa.form_id,
        source: pkg.qa.source,
        submitted_by: pkg.qa.submitted_by,
        geo: pkg.qa.geo,
        location_details: pkg.qa.location_details || null,
        locks: pkg.locks || pkg.qa.locks || { geo: true, photo: true, voice: true },
        answers: {
          ...pkg.qa.answers,
          client_package_id: pkg.id,
        },
        // Push app version with every sync so admin knows which build collected data
        app_version:
          typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : pkg.app_version,
        app_build: typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : pkg.app_build,
        app_version_code:
          typeof __APP_VERSION_CODE__ !== 'undefined'
            ? Number(__APP_VERSION_CODE__)
            : pkg.app_version_code,
      }
      const res = await fetchJson(`${base}/api/submissions`, {
        method: 'POST',
        token,
        body: qaBody,
      })
      pkg = await updatePackage(id, {
        serverSubmissionId: res.id,
        phase: 'qa_done',
        flags: { ...pkg.flags, qa: true },
        attempts: (pkg.attempts || 0) + 1,
        lastError: null,
      })
      emit({ type: 'phase', id, phase: 'qa_done', serverId: res.id })
    }

    const serverId = pkg.serverSubmissionId
    if (!serverId) throw new Error('No server submission id after Q/A')

    // 2) Photo
    if (pkg.photoDataUrl && !pkg.flags?.photo) {
      await fetchJson(`${base}/api/submissions/${serverId}/media`, {
        method: 'POST',
        token,
        body: {
          kind: 'photo',
          data: pkg.photoDataUrl,
          mime: 'image/jpeg',
          meta: { client_package_id: pkg.id, source: 'local_queue' },
        },
      })
      pkg = await updatePackage(id, {
        phase: 'photo_done',
        flags: { ...pkg.flags, photo: true },
        // free memory after successful photo sync
        photoDataUrl: null,
      })
      emit({ type: 'phase', id, phase: 'photo_done' })
    } else if (!pkg.photoDataUrl) {
      pkg = await updatePackage(id, {
        flags: { ...pkg.flags, photo: true },
      })
    }

    // 3) Audio
    if (pkg.audioDataUrl && !pkg.flags?.audio) {
      await fetchJson(`${base}/api/submissions/${serverId}/media`, {
        method: 'POST',
        token,
        body: {
          kind: 'audio',
          data: pkg.audioDataUrl,
          mime: pkg.audioMime || 'audio/webm',
          meta: { client_package_id: pkg.id, source: 'local_queue' },
        },
      })
      pkg = await updatePackage(id, {
        flags: { ...pkg.flags, audio: true },
        audioDataUrl: null,
      })
      emit({ type: 'phase', id, phase: 'audio_done' })
    } else {
      pkg = await updatePackage(id, {
        flags: { ...pkg.flags, audio: true },
      })
    }

    // 4) Complete — remove heavy package or mark done
    await updatePackage(id, { phase: 'done', lastError: null })
    // keep lightweight trail then remove media shell
    await removePackage(id)
    emit({ type: 'package-done', id, serverId })
    return { ok: true, id, serverId }
  } catch (e) {
    await updatePackage(id, {
      phase: 'failed',
      attempts: (pkg.attempts || 0) + 1,
      lastError: e.message || 'sync failed',
    })
    emit({ type: 'package-fail', id, error: e.message })
    throw e
  }
}

/** Drain queue FIFO, one package fully before next */
export async function drainQueue(reason = 'tick') {
  if (running) return { skipped: true, reason: 'busy' }
  if (!getToken()) return { skipped: true, reason: 'no-auth' }

  const net = await checkNetwork()
  if (!isStrongEnoughToSync(net)) {
    emit({ type: 'wait-network', quality: net.quality, reason })
    return { skipped: true, reason: 'weak-network', net }
  }

  const pending = await listPendingPackages()
  if (!pending.length) {
    emit({ type: 'empty', reason })
    return { skipped: true, reason: 'empty' }
  }

  running = true
  emit({
    type: 'drain-start',
    count: pending.length,
    reason,
    quality: net.quality,
  })

  let ok = 0
  let fail = 0
  // Systematic: one full package at a time
  for (const p of pending) {
    // re-check network between packages
    const n2 = await checkNetwork()
    if (!isStrongEnoughToSync(n2)) {
      emit({ type: 'wait-network', quality: n2.quality, reason: 'mid-drain' })
      break
    }
    try {
      await syncOnePackage(p.id)
      ok += 1
    } catch {
      fail += 1
      // continue next package (don't block whole queue on one fail)
    }
  }

  running = false
  const stats = await queueStats()
  emit({ type: 'drain-done', ok, fail, pending: stats.pending, reason })
  return { ok, fail, pending: stats.pending }
}

export function startSyncEngine() {
  if (started) {
    void drainQueue('restart')
    return
  }
  started = true

  stopWatch = watchNetwork((status) => {
    emit({ type: 'network', status })
    if (isStrongEnoughToSync(status)) void drainQueue('network-strong')
  }, { intervalMs: 45_000 })

  tickTimer = setInterval(async () => {
    // Skip DB hit entirely when nothing is queued
    const { queueStats } = await import('./localStore')
    const stats = await queueStats()
    if (stats.pending > 0) void drainQueue('interval')
  }, TICK_MS)

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
    window.addEventListener('esurvey-queue-change', onQueueChange)
  }

  void drainQueue('start')
}

function onVisible() {
  if (document.visibilityState === 'visible') void drainQueue('foreground')
}
function onOnline() {
  void drainQueue('browser-online')
}
function onQueueChange() {
  // short debounce via microtask
  setTimeout(() => void drainQueue('enqueue'), 300)
}

export function stopSyncEngine() {
  started = false
  running = false
  if (stopWatch) {
    stopWatch()
    stopWatch = null
  }
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisible)
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('esurvey-queue-change', onQueueChange)
  }
}

export async function getQueueSnapshot() {
  return queueStats()
}

/** Force sync now (button) */
export function forceSyncNow() {
  return drainQueue('manual')
}
