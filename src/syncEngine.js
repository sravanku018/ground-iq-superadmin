/**
 * Systematic sync engine:
 *  Local package → 1) POST Q/A  → 2) POST photo  → 3) POST audio  → done
 * Never uploads from the form UI; only drains the device queue.
 *
 * Failure kinds (see classifyError):
 *  - 'transient'  network/timeout/5xx/429: retry with backoff, counts toward MAX_ATTEMPTS
 *  - 'auth'       401: stop the drain, do not count an attempt, wait for re-login
 *  - 'client'     other 4xx: the server rejected the data; retrying won't help → needs_attention
 *  - 'local'      data missing on this device (photo, voice, answers): needs recapture → needs_attention
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
const LOCK_NAME = 'esurvey-sync-drain'
const PHASE_ATTENTION = 'needs_attention'

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

/** Errors that come from this device's data, not from the network or server. */
function localError(message) {
  const err = new Error(message)
  err.kind = 'local'
  return err
}

function classifyError(e) {
  if (e?.kind) return e.kind
  if (e?.name === 'AbortError') return 'transient'
  const status = e?.status
  if (status === 401) return 'auth'
  if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) return 'client'
  return 'transient'
}

function friendlyMessage(e) {
  if (e?.name === 'AbortError') return 'Upload timed out. It will retry automatically.'
  return e?.message || 'sync failed'
}

async function fetchJson(url, { method = 'GET', token, body, idempotencyKey } = {}) {
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
        // The server should treat a repeated key as the same operation, so a
        // retry after a lost response does not create a second record.
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
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
      // interactive calls (api.js dispatches this too).
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

/** Save a phase/field update without masking the error that caused it. */
async function safeUpdate(id, patch) {
  try {
    return await updatePackage(id, patch)
  } catch {
    return null
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
    const answers = pkg.qa?.answers || {}
    const voiceNeeded =
      answers._voice_required === true ||
      (answers._voice_required !== false && pkg.locks?.voice !== false)

    // 1) Q/A
    if (!pkg.flags?.qa || !pkg.serverSubmissionId) {
      // Client hard-lock: GPS + photo always; voice only when Client Admin required it
      if (!pkg.qa?.geo?.lat || !pkg.photoDataUrl || (voiceNeeded && !pkg.audioDataUrl)) {
        throw localError(
          voiceNeeded
            ? 'Package incomplete: GPS, photo and voice are locked requirements'
            : 'Package incomplete: GPS and photo are required',
        )
      }
      const recIdx = Number(pkg.recordIndex)
      const cleanAnswers = stripDraftAnswers({
        ...pkg.qa.answers,
        client_package_id: pkg.id,
        ...(Number.isFinite(recIdx) && recIdx > 0 ? { _recordIndex: recIdx } : {}),
      })
      const answeredKeys = Object.entries(cleanAnswers || {}).filter(([k, v]) => {
        if (!k || k.startsWith('_') || k.startsWith('geo_') || k.startsWith('location_') || k.startsWith('ts_') || k.startsWith('sec_')) return false
        if (
          [
            'draft', 'data_collector', 'client_package_id', 'submitted_by', 'has_photo', 'has_audio',
            'photo', 'audio', 'photo_url', 'audio_url', 'answer_pattern', 'survey_id', 'form_id', 'form_key',
          ].includes(k)
        )
          return false
        return String(v ?? '').trim() !== ''
      })
      if (answeredKeys.length === 0) {
        throw localError('Package has no answered questions. Cannot push an empty survey.')
      }
      const qaBody = {
        form_key: pkg.qa.form_key,
        form_id: pkg.qa.form_id,
        source: pkg.qa.source,
        submitted_by: pkg.qa.submitted_by,
        geo: pkg.qa.geo,
        location_details: pkg.qa.location_details || null,
        locks: pkg.locks || pkg.qa.locks || { geo: true, photo: true, voice: voiceNeeded },
        voice_required: voiceNeeded,
        record_index: Number.isFinite(recIdx) && recIdx > 0 ? recIdx : null,
        answers: cleanAnswers,
        app_version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : pkg.app_version,
        app_build: typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : pkg.app_build,
        app_version_code:
          typeof __APP_VERSION_CODE__ !== 'undefined' ? Number(__APP_VERSION_CODE__) : pkg.app_version_code,
      }
      const res = await fetchJson(`${base}/api/submissions`, {
        method: 'POST',
        token,
        body: qaBody,
        idempotencyKey: `${pkg.id}:qa`,
      })
      // A successful step is not an attempt. Attempts count failures only.
      pkg = await updatePackage(id, {
        serverSubmissionId: res.id,
        phase: 'qa_done',
        flags: { ...pkg.flags, qa: true },
        lastError: null,
      })
      emit({ type: 'phase', id, phase: 'qa_done', serverId: res.id })
    }

    const serverId = pkg.serverSubmissionId
    if (!serverId) throw localError('No server submission id after Q/A')

    // 2) Photo. Never mark uploaded if the blob is missing.
    if (!pkg.flags?.photo) {
      if (!pkg.photoDataUrl) {
        throw localError('Photo missing from device. Recapture this record.')
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
        idempotencyKey: `${pkg.id}:photo`,
      })
      pkg = await updatePackage(id, {
        phase: 'photo_done',
        flags: { ...pkg.flags, photo: true },
      })
      emit({ type: 'phase', id, phase: 'photo_done' })
    }

    // 3) Audio. Skip when voice is optional and none was recorded.
    if (!pkg.flags?.audio) {
      if (!pkg.audioDataUrl) {
        if (voiceNeeded) {
          throw localError('Voice missing from device. Recapture this record.')
        }
        pkg = await updatePackage(id, { flags: { ...pkg.flags, audio: true } })
        emit({ type: 'phase', id, phase: 'audio_skipped' })
      } else {
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
          idempotencyKey: `${pkg.id}:audio`,
        })
        pkg = await updatePackage(id, { flags: { ...pkg.flags, audio: true } })
        emit({ type: 'phase', id, phase: 'audio_done' })
      }
    }

    // 4) Complete: remove the heavy package
    await updatePackage(id, { phase: 'done', lastError: null })
    await removePackage(id)
    emit({ type: 'package-done', id, serverId })
    try {
      window.dispatchEvent(new CustomEvent('esurvey-activity-refresh', { detail: { serverId } }))
    } catch {
      /* ignore */
    }
    return { ok: true, id, serverId }
  } catch (e) {
    const kind = classifyError(e)
    const message = friendlyMessage(e)

    if (kind === 'auth') {
      // Not the package's fault and not a real attempt. Keep it queued, no backoff,
      // so it retries as soon as the user signs in again.
      await safeUpdate(id, {
        phase: 'failed',
        lastError: 'Session expired. Sign in to continue syncing.',
        nextAttemptAt: null,
      })
      emit({ type: 'package-auth', id })
      throw e
    }

    if (kind === 'client' || kind === 'local') {
      // Retrying cannot fix this without a change on the server or a recapture.
      await safeUpdate(id, { phase: PHASE_ATTENTION, lastError: message, nextAttemptAt: null })
      emit({ type: 'package-attention', id, kind, error: message })
      throw e
    }

    // transient: count the failure and back off
    const latest = (await getPackage(id).catch(() => null)) || pkg
    const attempts = (latest?.attempts || 0) + 1
    await safeUpdate(id, {
      phase: 'failed',
      attempts,
      lastError: message,
      nextAttemptAt: Date.now() + backoffMs(attempts),
    })
    emit({ type: 'package-fail', id, error: message, attempts })
    throw e
  }
}

/**
 * Run `fn` while holding the drain lock. The Web Locks API is shared across tabs,
 * so two open tabs can't drain the same queue. Falls back to the in-memory guard
 * where Web Locks is unavailable.
 */
async function withDrainLock(fn) {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) =>
      lock ? fn() : { skipped: true, reason: 'busy' },
    )
  }
  return fn()
}

/** Drain queue FIFO, one package fully before next */
export async function drainQueue(reason = 'tick', opts = {}) {
  if (running) return { skipped: true, reason: 'busy' }
  if (!getToken()) return { skipped: true, reason: 'no-auth' }

  // Manual runs (the "Sync now" button) bypass the weak-network gate and the
  // per-package backoff/attempt cap. The user explicitly asked to push now.
  const manual = !!opts.manual || reason === 'manual'

  // Claim the in-memory lock synchronously, before any await.
  running = true
  try {
    return await withDrainLock(() => runDrain(reason, manual))
  } finally {
    running = false
  }
}

async function runDrain(reason, manual) {
  const net = await checkNetwork()

  const all = await listPendingPackages()
  // Sort explicitly so the oldest package is first, whatever the store returns.
  const pending = [...all].sort(
    (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
  )

  // A 'syncing' package with no live drain (we hold the lock) was interrupted
  // by a crash or close. Put it back in the queue.
  for (const p of pending) {
    if (p.phase === 'syncing') await safeUpdate(p.id, { phase: 'pending' })
  }

  if (!pending.length) {
    emit({ type: 'empty', reason })
    return { skipped: true, reason: 'empty' }
  }

  // Network gate. Automatic drains prefer a strong/ok link. A manual run, or a
  // queue whose oldest item is stranded past STALE_MS, drains on any reachable link.
  const oldest = pending[0]
  const oldestAgeMs = Date.now() - new Date(oldest?.createdAt || 0).getTime()
  const allowWeak = manual || oldestAgeMs >= STALE_MS
  const gate = allowWeak ? isUsableForSync : isStrongEnoughToSync
  if (!gate(net)) {
    emit({ type: 'wait-network', quality: net.quality, reason })
    return { skipped: true, reason: 'weak-network', net }
  }

  emit({ type: 'drain-start', count: pending.length, reason, quality: net.quality })

  let ok = 0
  let fail = 0
  let blocked = 0
  let attention = 0
  // Systematic: one full package at a time
  for (const p of pending) {
    // Packages that need a recapture or a server-side fix are not retried here.
    if (p.phase === PHASE_ATTENTION) {
      attention += 1
      continue
    }
    if (!manual) {
      // Failed packages wait out their backoff window and attempt cap.
      if ((p.attempts || 0) >= MAX_ATTEMPTS) {
        blocked += 1
        continue
      }
      if (p.nextAttemptAt && p.nextAttemptAt > Date.now()) continue
    }
    // Re-check the network between packages (same gate as above)
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
      // A 401 applies to every remaining package. Stop and wait for re-login.
      if (classifyError(e) === 'auth') break
    }
  }

  const stats = await queueStats()
  if (blocked > 0) emit({ type: 'blocked', count: blocked })
  emit({ type: 'drain-done', ok, fail, blocked, attention, pending: stats.pending, reason })
  return { ok, fail, blocked, attention, pending: stats.pending }
}

/** Put a package back into the queue after a recapture or manual fix, and sync it now. */
export async function retryPackage(id) {
  await updatePackage(id, { phase: 'pending', attempts: 0, nextAttemptAt: null, lastError: null })
  emit({ type: 'queue-changed', id })
  return drainQueue('retry', { manual: true })
}

/** Counts for the UI: what is waiting, what is blocked, what needs attention. */
export async function getSyncSummary() {
  const all = await listPendingPackages()
  const summary = { pending: 0, blocked: [], attention: [], auth: false }
  for (const p of all) {
    if (p.phase === PHASE_ATTENTION) summary.attention.push({ id: p.id, error: p.lastError })
    else if ((p.attempts || 0) >= MAX_ATTEMPTS) summary.blocked.push({ id: p.id, error: p.lastError })
    else summary.pending += 1
    if (p.phase === 'failed' && p.lastError?.startsWith('Session expired')) summary.auth = true
  }
  return summary
}

export function startSyncEngine() {
  if (started) {
    void drainQueue('restart')
    return
  }
  started = true

  stopWatch = watchNetwork(
    (status) => {
      emit({ type: 'network', status })
      if (isStrongEnoughToSync(status)) void drainQueue('network-strong')
    },
    { intervalMs: 45_000 },
  )

  tickTimer = setInterval(async () => {
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
  // short debounce
  setTimeout(() => void drainQueue('enqueue'), 300)
}

export function stopSyncEngine() {
  // Do not reset `running`: an in-flight drain still holds the lock until it finishes.
  started = false
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
