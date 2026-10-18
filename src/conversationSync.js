/**
 * Background batch pipeline for voice conversations.
 *
 * Offline-first: a recording is already on the phone before this runs. When a
 * connection exists it uploads the audio once, asks the server to translate it
 * with Soniox, polls until the English text is ready, and stores the result.
 * Failed work is retried with backoff; audio is never re-recorded.
 */
import {
  createConversation,
  getConversationRecord,
  getStoredUser,
  getToken,
  transcribeConversation,
} from './api'
import {
  conversationNeedsWork,
  getConversationLocal,
  listConversationsLocal,
  updateConversationLocal,
} from './conversationStore'
import { checkNetwork, isUsableForSync, watchNetwork } from './network'

const TICK_MS = 45_000
const MAX_ATTEMPTS = 8
const LOCK_NAME = 'esurvey-conversation-sync'
const POLL_WINDOW_MS = 60_000

let running = false
let started = false
let tickTimer = null
let stopWatch = null
const listeners = new Set()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function emit(ev) {
  for (const fn of listeners) {
    try {
      fn(ev)
    } catch {
      /* ignore */
    }
  }
}

export function onConversationSync(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function classifyError(e) {
  if (e?.name === 'AbortError') return 'transient'
  const status = e?.status
  if (status === 401) return 'auth'
  if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    // "Soniox not configured" becomes usable once the server env is set, so
    // treat it as retryable rather than terminal.
    if (e?.data?.code === 'soniox_not_configured') return 'transient'
    return 'client'
  }
  return 'transient'
}

function backoffMs(attempts) {
  const n = Math.max(1, attempts || 1)
  return Math.min(30_000 * 2 ** (n - 1), 30 * 60_000)
}

function conversationLabel(c) {
  return c?.title || 'Voice conversation'
}

async function saveServerConversation(id, conv, patch = {}) {
  const existing = await getConversationLocal(id)
  const serverId = conv?.id ?? existing?.serverId ?? null
  const transcriptStatus = conv?.transcript_status || 'processing'
  if (transcriptStatus === 'completed') {
    return updateConversationLocal(id, {
      serverId,
      status: 'sent',
      transcript: conv?.transcript || '',
      transcriptOriginal: conv?.transcript_original || '',
      transcriptStatus: 'completed',
      lastError: '',
      attempts: 0,
      nextAttemptAt: 0,
      ...patch,
    })
  }
  return updateConversationLocal(id, {
    serverId,
    status: 'sent',
    transcriptStatus,
    transcript: conv?.transcript || '',
    transcriptOriginal: conv?.transcript_original || '',
    lastError: conv?.transcript_error || '',
    ...patch,
  })
}

/** Upload → translate → poll for one conversation. */
export async function syncOneConversation(id) {
  let c = await getConversationLocal(id)
  if (!c) return { skipped: true }

  // 1) Upload the audio once (idempotent by local_id on the server).
  if (!c.serverId) {
    if (!c.audioDataUrl) {
      throw new Error('Recording audio is missing on this phone')
    }
    await updateConversationLocal(id, { status: 'uploading', lastError: '' })
    emit({ type: 'conversation-uploading', id })
    const res = await createConversation({
      local_id: c.id,
      title: conversationLabel(c),
      form_key: c.formKey || null,
      recorded_at: c.recordedAt,
      duration_ms: c.durationMs,
      mime: c.audioMime || 'audio/webm',
      audio: c.audioDataUrl,
    })
    const conv = res?.conversation || {}
    if (!conv.id) throw new Error('Server did not return a conversation id')
    c = await updateConversationLocal(id, {
      serverId: conv.id,
      status: 'sent',
      transcriptStatus: conv.transcript_status || 'stored',
      transcript: conv.transcript || '',
      transcriptOriginal: conv.transcript_original || '',
      lastError: '',
    })
    emit({ type: 'conversation-uploaded', id, serverId: conv.id })
  }

  // 2) Ask the server to translate (safe to repeat; it reuses the stored audio).
  if (c.transcriptStatus !== 'completed') {
    const started = await transcribeConversation(c.serverId)
    let conv = started?.conversation || {}

    // 3) Poll while the Soniox job runs. Long interviews may outlive this
    // window; the background tick picks them up again later.
    const began = Date.now()
    let delay = 2000
    while (
      conv &&
      conv.transcript_status !== 'completed' &&
      conv.transcript_status !== 'error' &&
      Date.now() - began < POLL_WINDOW_MS
    ) {
      await sleep(delay)
      const res = await getConversationRecord(c.serverId)
      conv = res?.conversation || conv
      delay = Math.min(delay + 500, 5000)
    }

    if (conv?.transcript_status === 'error') {
      const err = new Error(conv.transcript_error || 'Translation failed')
      err.status = 422
      err.transcriptError = true
      const attempts = (c.attempts || 0) + 1
      await updateConversationLocal(id, {
        serverId: conv.id || c.serverId,
        status: 'sent',
        transcriptStatus: 'error',
        lastError: err.message,
        attempts,
        nextAttemptAt: Date.now() + backoffMs(attempts),
      })
      emit({ type: 'conversation-error', id, error: err.message })
      throw err
    }

    c = await saveServerConversation(id, conv)
    emit({ type: 'conversation-updated', id, status: c?.transcriptStatus })
    return { ok: true, id, transcriptStatus: c?.transcriptStatus }
  }

  emit({ type: 'conversation-updated', id, status: 'completed' })
  return { ok: true, id, transcriptStatus: 'completed' }
}

async function withLock(fn) {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) =>
      lock ? fn() : { skipped: true, reason: 'busy' },
    )
  }
  return fn()
}

/** Process pending conversations FIFO. Manual runs bypass backoff/network gates. */
export async function drainConversations(opts = {}) {
  if (running) return { skipped: true, reason: 'busy' }
  if (!getToken()) return { skipped: true, reason: 'no-auth' }
  const manual = !!opts.manual

  running = true
  try {
    return await withLock(() => runDrain(manual))
  } finally {
    running = false
  }
}

async function runDrain(manual) {
  const net = await checkNetwork()
  if (!manual && !isUsableForSync(net)) {
    emit({ type: 'conversation-wait-network', quality: net.quality })
    return { skipped: true, reason: 'offline' }
  }

  const all = await listConversationsLocal()
  const uid = getStoredUser()?.id
  const mine =
    uid != null
      ? all.filter(
          (c) => c.userId == null || String(c.userId) === String(uid),
        )
      : all
  const pending = mine
    .filter(conversationNeedsWork)
    .sort(
      (a, b) =>
        new Date(a.recordedAt || a.createdAt || 0).getTime() -
        new Date(b.recordedAt || b.createdAt || 0).getTime(),
    )
  if (!pending.length) {
    emit({ type: 'conversation-empty' })
    return { skipped: true, reason: 'empty' }
  }

  emit({ type: 'conversation-drain-start', count: pending.length })
  let ok = 0
  let fail = 0
  for (const c of pending) {
    if (!manual) {
      if ((c.attempts || 0) >= MAX_ATTEMPTS) continue
      if (c.nextAttemptAt && c.nextAttemptAt > Date.now()) continue
    }
    try {
      await syncOneConversation(c.id)
      ok += 1
    } catch (e) {
      fail += 1
      const kind = classifyError(e)
      const attempts = (c.attempts || 0) + 1
      await updateConversationLocal(c.id, {
        status: c.serverId ? 'sent' : 'local',
        lastError: e?.message || 'Sync failed',
        attempts,
        nextAttemptAt: Date.now() + backoffMs(attempts),
      }).catch(() => null)
      emit({ type: 'conversation-error', id: c.id, error: e?.message || 'Sync failed' })
      if (kind === 'auth') break
    }
  }
  emit({ type: 'conversation-drain-done', ok, fail })
  return { ok, fail }
}

export function triggerConversationSync() {
  return drainConversations({ manual: true })
}

export function startConversationSync() {
  if (started) {
    void drainConversations()
    return
  }
  started = true

  stopWatch = watchNetwork(
    (status) => {
      if (isUsableForSync(status)) void drainConversations()
    },
    { intervalMs: 45_000 },
  )

  tickTimer = setInterval(async () => {
    const all = await listConversationsLocal()
    const uid = getStoredUser()?.id
    const mine =
      uid != null
        ? all.filter(
            (c) => c.userId == null || String(c.userId) === String(uid),
          )
        : all
    if (mine.some(conversationNeedsWork)) void drainConversations()
  }, TICK_MS)

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
  }
  void drainConversations()
}

function onVisible() {
  if (document.visibilityState === 'visible') void drainConversations()
}

function onOnline() {
  void drainConversations()
}

export function stopConversationSync() {
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
}
