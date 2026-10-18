/**
 * Local conversation store — recordings live on the phone first.
 *
 * A conversation is saved here as soon as the user stops recording, so the
 * interview is never lost when the phone is offline. The sync engine uploads
 * the audio, asks the server for the English transcript, then marks it sent.
 */

const DB_NAME = 'esurvey_conversations'
const STORE = 'conversations'
const DB_VERSION = 1
const FALLBACK_KEY = 'esurvey_conversations_fallback'
const AUDIO_PREFIX = 'esurvey_conv_audio_'

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
  })
}

function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'))
  })
}

function readFallbackList() {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeFallbackList(list) {
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(list))
}

function withoutAudio(conv) {
  const { audioDataUrl, ...rest } = conv
  return { ...rest, hasAudio: !!audioDataUrl || !!rest.hasAudio }
}

function fallbackGet(id) {
  const meta = readFallbackList().find((c) => c.id === id)
  if (!meta) return null
  let audioDataUrl = null
  try {
    audioDataUrl = localStorage.getItem(`${AUDIO_PREFIX}${id}`) || null
  } catch {
    /* ignore */
  }
  return { ...meta, audioDataUrl }
}

function attachFallbackAudio(list) {
  return list.map((c) => {
    let audioDataUrl = null
    try {
      audioDataUrl = localStorage.getItem(`${AUDIO_PREFIX}${c.id}`) || null
    } catch {
      /* ignore */
    }
    return { ...c, audioDataUrl }
  })
}

/**
 * Save (or update) a conversation locally.
 * @param {object} input
 * @returns {Promise<object>} the saved record
 */
export async function saveConversationLocal(input = {}) {
  const now = new Date().toISOString()
  const id = input.id || newId()
  const existing = await getConversationLocal(id).catch(() => null)
  const conv = {
    id,
    createdAt: input.createdAt || existing?.createdAt || now,
    updatedAt: now,
    recordedAt: input.recordedAt || existing?.recordedAt || now,
    userId: input.userId ?? existing?.userId ?? null,
    userName: input.userName || existing?.userName || '',
    title: input.title ?? existing?.title ?? '',
    formKey: input.formKey ?? existing?.formKey ?? '',
    durationMs: input.durationMs ?? existing?.durationMs ?? 0,
    audioDataUrl: input.audioDataUrl || existing?.audioDataUrl || '',
    audioMime: input.audioMime || existing?.audioMime || 'audio/webm',
    transcript: input.transcript ?? existing?.transcript ?? '',
    transcriptOriginal: input.transcriptOriginal ?? existing?.transcriptOriginal ?? '',
    transcriptStatus: input.transcriptStatus || existing?.transcriptStatus || 'queued',
    serverId: input.serverId ?? existing?.serverId ?? null,
    status: input.status || existing?.status || 'local',
    attempts: input.attempts ?? existing?.attempts ?? 0,
    lastError: input.lastError ?? existing?.lastError ?? '',
    nextAttemptAt: input.nextAttemptAt ?? existing?.nextAttemptAt ?? 0,
  }

  try {
    const db = await openDb()
    await idbReq(db.transaction(STORE, 'readwrite').objectStore(STORE).put(conv))
    db.close()
  } catch {
    // LocalStorage fallback. Keep audio in a separate key so the metadata list
    // stays small and one failed audio write cannot corrupt the list.
    const list = readFallbackList().filter((c) => c.id !== id)
    list.push(withoutAudio(conv))
    writeFallbackList(list)
    if (conv.audioDataUrl) {
      try {
        localStorage.setItem(`${AUDIO_PREFIX}${id}`, conv.audioDataUrl)
      } catch {
        throw new Error('Device storage is full. Delete old voice notes and try again.')
      }
    }
  }
  return conv
}

export async function getConversationLocal(id) {
  if (!id) return null
  try {
    const db = await openDb()
    const row = await idbReq(db.transaction(STORE, 'readonly').objectStore(STORE).get(id))
    db.close()
    if (row) return row
  } catch {
    /* fall through */
  }
  return fallbackGet(id)
}

export async function updateConversationLocal(id, patch = {}) {
  const existing = await getConversationLocal(id)
  if (!existing) return null
  return saveConversationLocal({ ...existing, ...patch, id })
}

export async function deleteConversationLocal(id) {
  if (!id) return
  try {
    const db = await openDb()
    await idbReq(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id))
    db.close()
  } catch {
    /* fall through */
  }
  try {
    const list = readFallbackList().filter((c) => c.id !== id)
    writeFallbackList(list)
    localStorage.removeItem(`${AUDIO_PREFIX}${id}`)
  } catch {
    /* ignore */
  }
}

/** Newest first. */
export async function listConversationsLocal() {
  let rows = []
  try {
    const db = await openDb()
    rows = await idbReq(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())
    db.close()
  } catch {
    rows = attachFallbackAudio(readFallbackList())
  }
  return rows.sort((a, b) => {
    const at = new Date(a.recordedAt || a.createdAt || 0).getTime()
    const bt = new Date(b.recordedAt || b.createdAt || 0).getTime()
    return bt - at
  })
}

export function conversationNeedsWork(c) {
  if (!c) return false
  if (!c.serverId) return true
  if (c.transcriptStatus === 'completed') return false
  return true
}

export async function conversationSummary() {
  const rows = await listConversationsLocal()
  let pending = 0
  let translating = 0
  let ready = 0
  for (const c of rows) {
    if (!c.serverId) pending += 1
    else if (c.transcriptStatus === 'completed') ready += 1
    else if (c.transcriptStatus === 'error') pending += 1
    else translating += 1
  }
  return { total: rows.length, pending, translating, ready }
}
