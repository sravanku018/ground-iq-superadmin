/**
 * Background sync orchestrator (main thread).
 * - Watches network quality
 * - Hands batches to a Web Worker (background thread) for HTTP POSTs
 * - UI stays responsive; queue updates via events
 *
 * Note: When the Android OS suspends the WebView, workers pause too.
 * Sync resumes when the app is opened again with a strong network.
 */

import { getApiBase, getToken } from './api'
import {
  bumpAttempt,
  listQueued,
  peekBatch,
  queueCount,
  removeFromQueue,
} from './offlineQueue'
import {
  checkNetwork,
  isStrongEnoughToSync,
  watchNetwork,
} from './network'

const BATCH_SIZE = 5
const TICK_MS = 12_000

let worker = null
let workerBusy = false
let stopWatch = null
let tickTimer = null
let started = false
let listeners = new Set()

function emit(event) {
  for (const fn of listeners) {
    try {
      fn(event)
    } catch {
      /* ignore */
    }
  }
}

export function onSyncEvent(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function ensureWorker() {
  if (worker) return worker
  try {
    worker = new Worker(new URL('./sync.worker.js', import.meta.url), {
      type: 'module',
    })
  } catch (e) {
    console.warn('[sync] Worker unavailable, using main-thread fallback', e)
    worker = null
    return null
  }

  worker.onmessage = (ev) => {
    const msg = ev.data || {}
    if (msg.type === 'item-ok') {
      removeFromQueue(msg.id)
      emit({
        type: 'item-ok',
        id: msg.id,
        ms: msg.ms,
        pending: queueCount(),
      })
    } else if (msg.type === 'item-fail') {
      bumpAttempt(msg.id, msg.error)
      emit({
        type: 'item-fail',
        id: msg.id,
        error: msg.error,
        ms: msg.ms,
        pending: queueCount(),
      })
    } else if (msg.type === 'batch-done') {
      workerBusy = false
      emit({
        type: 'batch-done',
        ok: msg.ok,
        fail: msg.fail,
        totalMs: msg.totalMs,
        pending: queueCount(),
      })
      // Continue if more left
      if (queueCount() > 0) {
        setTimeout(() => void runSyncTick('continue'), 400)
      }
    }
  }

  worker.onerror = (err) => {
    console.error('[sync] worker error', err)
    workerBusy = false
    emit({ type: 'worker-error', error: String(err?.message || err) })
  }

  return worker
}

/** Fallback if Worker cannot start (rare) */
async function syncBatchOnMain(items, baseUrl, token) {
  const t0 = Date.now()
  let ok = 0
  let fail = 0
  for (const item of items) {
    const itemT0 = Date.now()
    try {
      const res = await fetch(`${baseUrl}/api/submissions`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(item.payload),
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      removeFromQueue(item.id)
      ok += 1
      emit({
        type: 'item-ok',
        id: item.id,
        ms: Date.now() - itemT0,
        pending: queueCount(),
      })
    } catch (e) {
      bumpAttempt(item.id, e.message)
      fail += 1
      emit({
        type: 'item-fail',
        id: item.id,
        error: e.message,
        ms: Date.now() - itemT0,
        pending: queueCount(),
      })
    }
  }
  workerBusy = false
  emit({
    type: 'batch-done',
    ok,
    fail,
    totalMs: Date.now() - t0,
    pending: queueCount(),
  })
}

/**
 * One background tick: if network strong/ok, push a batch to the worker thread.
 */
export async function runSyncTick(reason = 'tick') {
  if (workerBusy) return { skipped: true, reason: 'busy' }
  if (!getToken()) return { skipped: true, reason: 'no-auth' }

  const pending = queueCount()
  if (!pending) return { skipped: true, reason: 'empty' }

  const net = await checkNetwork()
  if (!isStrongEnoughToSync(net)) {
    emit({
      type: 'wait-network',
      quality: net.quality,
      latencyMs: net.latencyMs,
      pending,
      reason,
    })
    return { skipped: true, reason: 'weak-network', net }
  }

  const items = peekBatch(BATCH_SIZE)
  if (!items.length) return { skipped: true, reason: 'empty' }

  const baseUrl = getApiBase()
  const token = getToken()
  workerBusy = true

  emit({
    type: 'batch-start',
    count: items.length,
    pending,
    quality: net.quality,
    latencyMs: net.latencyMs,
    reason,
    thread: 'worker',
  })

  const w = ensureWorker()
  if (w) {
    w.postMessage({
      type: 'sync-batch',
      baseUrl,
      token,
      items: items.map((x) => ({ id: x.id, payload: x.payload })),
    })
  } else {
    await syncBatchOnMain(items, baseUrl, token)
  }

  return { started: true, count: items.length, net }
}

/** Start background loop (call after login). Idempotent. */
export function startBackgroundSync() {
  if (started) {
    void runSyncTick('restart')
    return
  }
  started = true
  ensureWorker()

  stopWatch = watchNetwork((status) => {
    emit({ type: 'network', status, pending: queueCount() })
    if (isStrongEnoughToSync(status) && queueCount() > 0) {
      void runSyncTick('network-strong')
    }
  }, { intervalMs: 20_000 })

  tickTimer = setInterval(() => {
    if (queueCount() > 0) void runSyncTick('interval')
  }, TICK_MS)

  // App foreground
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
  }

  void runSyncTick('start')
}

function onVisible() {
  if (document.visibilityState === 'visible' && queueCount() > 0) {
    void runSyncTick('foreground')
  }
}

function onOnline() {
  if (queueCount() > 0) void runSyncTick('browser-online')
}

export function stopBackgroundSync() {
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
  }
  if (worker) {
    worker.terminate()
    worker = null
  }
  workerBusy = false
}

export function getSyncSnapshot() {
  return {
    pending: queueCount(),
    busy: workerBusy,
    items: listQueued().map((x) => ({
      id: x.id,
      createdAt: x.createdAt,
      attempts: x.attempts,
      lastError: x.lastError,
      district: x.payload?.answers?.district,
    })),
  }
}
