/**
 * Systematic sync engine:
 *  Local package → 1) POST Q/A  → 2) POST photo  → 3) POST audio  → done
 * Never uploads from the form UI; only drains the device queue.
 */

import { getApiBase, getToken } from './api'
import { mediaTypeOnly, mimeFromDataUrl, normalizeMediaDataUrl } from './mediaOptimize'
import {
  getPackage,
  listPendingPackages,
  queueStats,
  removePackage,
  stripDraftAnswers,
  updatePackage,
} from './localStore'
import { checkNetwork, isStrongEnoughToSync, isUsableForSync, watchNetwork } from './network'

const TICK_MS = 60_000
const POST_TIMEOUT = 45_000
const MAX_ATTEMPTS = 8
// Oldest pending item older than this → drain even on a weak link, so data is
// never stranded forever when the connection is persistently poor.
const STALE_MS = 15 * 60_000

/** Exponential backoff for a failed package: 30s, 60s, 2m … capped at 30m. */
function backoffMs(attempts) {
  const n = Math.max(1, attempts || 1)
  return Math.min(30_000 * 2 ** (n - 1), 30 * 60_000)
}

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
      // A token that expires mid-drain must trigger the same re-login flow as
      // interactive calls (api.js dispatches this too) — otherwise packages
      // silently pile up as "failed" and the user is never prompted to sign in.
      if (res.status === 401 && typeof window !== 'undefined') {
        try {
          window.dispatchEvent(new CustomEvent('esurvey-unauthorized', { detail: data }))
        } catch {
          /* non-DOM context */
        }
      }
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
      const recIdx = Number(pkg.recordIndex)
      const answers = stripDraftAnswers({
        ...pkg.qa.answers,
        client_package_id: pkg.id,
        ...(Number.isFinite(recIdx) && recIdx > 0 ? { _recordIndex: recIdx } : {}),
      })
      const qaBody = {
        form_key: pkg.qa.form_key,
        form_id: pkg.qa.form_id,
        source: pkg.qa.source,
        submitted_by: pkg.qa.submitted_by,
        geo: pkg.qa.geo,
        location_details: pkg.qa.location_details || null,
        locks: pkg.locks || pkg.qa.locks || { geo: true, photo: true, voice: true },
        record_index: Number.isFinite(recIdx) && recIdx > 0 ? recIdx : null,
        answers,
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

    // 2) Photo — never mark uploaded if the blob is missing (that deleted it).
    if (!pkg.flags?.photo) {
      if (!pkg.photoDataUrl) {
        throw new Error('Photo missing from device — recapture this record')
      }
      const photoData = normalizeMediaDataUrl(pkg.photoDataUrl, 'image/jpeg')
      await fetchJson(`${base}/api/submissions/${serverId}/media`, {
        method: 'POST',
        token,
        body: {
          kind: 'photo',
          data: photoData,
          mime: mimeFromDataUrl(photoData, 'image/jpeg') || 'image/jpeg',
          meta: { client_package_id: pkg.id, source: 'local_queue' },
        },
      })
      pkg = await updatePackage(id, {
        phase: 'photo_done',
        flags: { ...pkg.flags, photo: true },
      })
      emit({ type: 'phase', id, phase: 'photo_done' })
    }

    // 3) Audio
    if (!pkg.flags?.audio) {
      if (!pkg.audioDataUrl) {
        throw new Error('Voice missing from device — recapture this record')
      }
      const audioData = normalizeMediaDataUrl(pkg.audioDataUrl, pkg.audioMime || 'audio/webm')
      await fetchJson(`${base}/api/submissions/${serverId}/media`, {
        method: 'POST',
        token,
        body: {
          kind: 'audio',
          data: audioData,
          mime: mediaTypeOnly(pkg.audioMime) || mimeFromDataUrl(audioData, 'audio/webm') || 'audio/webm',
          meta: { client_package_id: pkg.id, source: 'local_queue' },
        },
      })
      pkg = await updatePackage(id, {
        flags: { ...pkg.flags, audio: true },
      })
      emit({ type: 'phase', id, phase: 'audio_done' })
    }

    // 4) Complete — remove heavy package or mark done
    await updatePackage(id, { phase: 'done', lastError: null })
    // keep lightweight trail then remove media shell
    await removePackage(id)
    emit({ type: 'package-done', id, serverId })
    return { ok: true, id, serverId }
  } catch (e) {
    const attempts = (pkg.attempts || 0) + 1
    await updatePackage(id, {
      phase: 'failed',
      attempts,
      lastError: e.message || 'sync failed',
      // Back off before this package is eligible for auto-retry again (B3).
      nextAttemptAt: Date.now() + backoffMs(attempts),
    })
    emit({ type: 'package-fail', id, error: e.message })
    throw e
  }
}

/** Drain queue FIFO, one package fully before next */
export async function drainQueue(reason = 'tick', opts = {}) {
  if (running) return { skipped: true, reason: 'busy' }
  if (!getToken()) return { skipped: true, reason: 'no-auth' }

  // Manual runs (the "Sync now" button) bypass the weak-network gate and the
  // per-package backoff/attempt cap — the user explicitly asked to push now.
  const manual = !!opts.manual || reason === 'manual'

  // Claim the lock synchronously — before any await — so overlapping triggers
  // (interval / network-strong / enqueue / foreground) can't both pass the
  // `if (running)` guard and start a second drain over the same pending list.
  running = true
  try {
    const net = await checkNetwork()

    const pending = await listPendingPackages()
    if (!pending.length) {
      emit({ type: 'empty', reason })
      return { skipped: true, reason: 'empty' }
    }

    // Network gate. Automatic drains prefer a strong/ok link; but a manual run,
    // or a queue whose oldest item has been stranded past STALE_MS, drains on
    // any reachable link (weak included) so data is never stuck forever.
    const oldest = pending[0] // sorted ascending by createdAt
    const oldestAgeMs = Date.now() - new Date(oldest?.createdAt || 0).getTime()
    const allowWeak = manual || oldestAgeMs >= STALE_MS
    const gate = allowWeak ? isUsableForSync : isStrongEnoughToSync
    if (!gate(net)) {
      emit({ type: 'wait-network', quality: net.quality, reason })
      return { skipped: true, reason: 'weak-network', net }
    }

    emit({
      type: 'drain-start',
      count: pending.length,
      reason,
      quality: net.quality,
    })

    let ok = 0
    let fail = 0
    let blocked = 0
    // Systematic: one full package at a time
    for (const p of pending) {
      // B3: don't hammer a failed package — honour its attempt cap + backoff
      // window, unless this is a manual run.
      if (!manual) {
        if ((p.attempts || 0) >= MAX_ATTEMPTS) {
          blocked += 1
          continue
        }
        if (p.nextAttemptAt && p.nextAttemptAt > Date.now()) continue
      }
      // re-check network between packages (same gate as above)
      const n2 = await checkNetwork()
      if (!gate(n2)) {
        emit({ type: 'wait-network', quality: n2.quality, reason: 'mid-drain' })
        break
      }
      try {
        await syncOnePackage(p.id)
        ok += 1
      } catch (e) {
        fail += 1
        // A 401 will hit every remaining package — stop the drain and let the
        // esurvey-unauthorized handler prompt re-login instead of hammering.
        if (e?.status === 401) break
        // otherwise continue next package (don't block the queue on one fail)
      }
    }

    const stats = await queueStats()
    emit({ type: 'drain-done', ok, fail, blocked, pending: stats.pending, reason })
    return { ok, fail, blocked, pending: stats.pending }
  } finally {
    // Always release the lock — including the weak-network / empty early
    // returns and any thrown error — so the engine can never deadlock.
    running = false
  }
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
  // Manual: bypass the weak-network gate and the per-package backoff/attempt cap.
  return drainQueue('manual', { manual: true })
}
