/**
 * Built-in device storage for field surveys.
 * - Packages saved fully offline first
 * - Queue phases: queued → qa → photo → audio → done
 * - IndexedDB for media (large); meta index in localStorage
 */

const DB_NAME = 'esurvey_local_v2'
const DB_VERSION = 1
const STORE = 'packages'
const META_KEY = 'esurvey_queue_meta_v2'

/** @typedef {'draft'|'queued'|'syncing'|'qa_done'|'photo_done'|'done'|'failed'} PackagePhase */

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' })
        os.createIndex('phase', 'phase', { unique: false })
        os.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IDB open failed'))
  })
}

function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `pkg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function emitChange(extra = {}) {
  try {
    window.dispatchEvent(
      new CustomEvent('esurvey-queue-change', {
        detail: { ...extra, at: Date.now() },
      }),
    )
  } catch {
    /* ignore */
  }
}

function readMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeMeta(partial) {
  const next = { ...readMeta(), ...partial, updatedAt: new Date().toISOString() }
  localStorage.setItem(META_KEY, JSON.stringify(next))
  return next
}

/**
 * Save a full field package locally (never uploads).
 * @returns {Promise<string>} package id
 */
export async function savePackageLocal({
  form_key,
  form_id,
  source,
  submitted_by,
  user_id,
  geo,
  location_details,
  answers,
  photoDataUrl,
  audioDataUrl,
  audioMime,
  recordIndex,
  locks,
  step,
  answered,
  total,
  id: existingId,
  activeQ,
  createdAt: existingCreatedAt,
}, opts = {}) {
  // Hard reject incomplete packages (client-side lock) — drafts may skip locks
  const draft = !!opts.draft
  if (!draft && (!geo || !Number.isFinite(Number(geo.lat)) || !Number.isFinite(Number(geo.lng)))) {
    throw new Error('Package rejected: GPS lock missing')
  }
  if (!draft && (!photoDataUrl || String(photoDataUrl).length < 100)) {
    throw new Error('Package rejected: photo lock missing')
  }
  if (!draft && (!audioDataUrl || String(audioDataUrl).length < 100)) {
    throw new Error('Package rejected: voice lock missing')
  }

  const id = existingId || newId()
  const pkg = {
    id,
    phase: /** @type {PackagePhase} */ (draft ? 'draft' : 'queued'),
    createdAt: existingCreatedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
    serverSubmissionId: null,
    recordIndex: recordIndex ?? null,
    // Collection status saved with the draft (step + answered-question progress)
    step: Number.isInteger(step) ? step : null,
    answered: Number.isInteger(answered) ? answered : null,
    total: Number.isInteger(total) ? total : null,
    activeQ: Number.isInteger(activeQ) ? activeQ : null,
    locks: locks || {
      geo: true,
      photo: true,
      voice: true,
      location: !!location_details,
    },
    // QA payload (small)
    qa: {
      form_key: form_key || 'default',
      form_id: form_id || `field-${Date.now()}`,
      source: source || 'mobile-field-survey',
      submitted_by: submitted_by || null,
      user_id: user_id || null,
      geo: geo || null,
      location_details: location_details || null,
      answers: answers || {},
      client_package_id: id,
      locks: locks || { geo: true, photo: true, voice: true, location: true },
    },
    // Media kept on device until sync
    photoDataUrl: photoDataUrl || null,
    audioDataUrl: audioDataUrl || null,
    audioMime: audioMime || 'audio/webm',
    // phase flags for systematic upload
    flags: { qa: false, photo: false, audio: false },
  }

  try {
    const db = await openDb()
    await idbReq(db.transaction(STORE, 'readwrite').objectStore(STORE).put(pkg))
    db.close()
  } catch {
    // Fallback: localStorage (IndexedDB unavailable — private mode / restricted
    // WebView). This store is small, so media may not fit. Track whether each
    // required blob actually persisted — if not, fail loudly instead of saving
    // an unsyncable shell that silently drops the photo/voice.
    let photoStored = !photoDataUrl
    let audioStored = !audioDataUrl
    const list = listPackagesMetaFallback().filter((x) => x.id !== id)
    list.push(stripHeavy(pkg))
    try {
      localStorage.setItem('esurvey_packages_fallback', JSON.stringify(list))
      if (photoDataUrl) {
        localStorage.setItem(`esurvey_photo_${id}`, photoDataUrl)
        photoStored = true
      }
      if (audioDataUrl) {
        localStorage.setItem(`esurvey_audio_${id}`, audioDataUrl)
        audioStored = true
      }
    } catch {
      /* quota exceeded — handled just below */
    }
    if (!draft && (!photoStored || !audioStored)) {
      // Roll back the meta shell + any partial media so nothing dangling is left,
      // then surface the failure (FieldCollect shows e.message as an error toast).
      try {
        const cleaned = listPackagesMetaFallback().filter((x) => x.id !== id)
        localStorage.setItem('esurvey_packages_fallback', JSON.stringify(cleaned))
        localStorage.removeItem(`esurvey_photo_${id}`)
        localStorage.removeItem(`esurvey_audio_${id}`)
      } catch {
        /* ignore */
      }
      throw new Error(
        'Device storage is full or unavailable — could not save photo/voice locally. Free up space and recapture this record.',
      )
    }
  }

  writeMeta({ lastSavedId: id })
  emitChange({ type: 'saved', id })
  return id
}

function stripHeavy(pkg) {
  const { photoDataUrl, audioDataUrl, ...rest } = pkg
  return {
    ...rest,
    hasPhoto: !!photoDataUrl,
    hasAudio: !!audioDataUrl,
  }
}

function listPackagesMetaFallback() {
  try {
    return JSON.parse(localStorage.getItem('esurvey_packages_fallback') || '[]')
  } catch {
    return []
  }
}

export async function getPackage(id) {
  try {
    const db = await openDb()
    const pkg = await idbReq(db.transaction(STORE, 'readonly').objectStore(STORE).get(id))
    db.close()
    if (pkg) return pkg
  } catch {
    /* fall through */
  }
  const list = listPackagesMetaFallback()
  const meta = list.find((x) => x.id === id)
  if (!meta) return null
  return {
    ...meta,
    photoDataUrl: localStorage.getItem(`esurvey_photo_${id}`) || null,
    audioDataUrl: localStorage.getItem(`esurvey_audio_${id}`) || null,
  }
}

export async function updatePackage(id, patch) {
  const pkg = await getPackage(id)
  if (!pkg) return null
  const next = {
    ...pkg,
    ...patch,
    flags: { ...pkg.flags, ...patch.flags },
    updatedAt: new Date().toISOString(),
  }
  try {
    const db = await openDb()
    await idbReq(db.transaction(STORE, 'readwrite').objectStore(STORE).put(next))
    db.close()
  } catch {
    const list = listPackagesMetaFallback().map((x) =>
      x.id === id ? stripHeavy(next) : x,
    )
    localStorage.setItem('esurvey_packages_fallback', JSON.stringify(list))
  }
  emitChange({ type: 'updated', id, phase: next.phase })
  return next
}

export async function removePackage(id) {
  try {
    const db = await openDb()
    await idbReq(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id))
    db.close()
  } catch {
    const list = listPackagesMetaFallback().filter((x) => x.id !== id)
    localStorage.setItem('esurvey_packages_fallback', JSON.stringify(list))
  }
  try {
    localStorage.removeItem(`esurvey_photo_${id}`)
    localStorage.removeItem(`esurvey_audio_${id}`)
  } catch {
    /* ignore */
  }
  emitChange({ type: 'removed', id })
}

/** Packages waiting for systematic sync (not done) */
export async function listPendingPackages() {
  try {
    const db = await openDb()
    const all = await idbReq(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())
    db.close()
    return (all || [])
      .filter((p) => p.phase !== 'done' && p.phase !== 'draft')
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  } catch {
    return listPackagesMetaFallback()
      .filter((p) => p.phase !== 'done' && p.phase !== 'draft')
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  }
}

/** Drafts stay on this phone until the surveyor verifies and pushes them */
export async function listDrafts() {
  const all = await listAllPackages()
  return (all || []).filter((p) => p.phase === 'draft')
}

function draftOwnerKey(pkg) {
  const qa = pkg?.qa || {}
  return String(qa.user_id || qa.submitted_by || pkg.submitted_by || '')
}

function draftRecordKey(pkg) {
  const qa = pkg?.qa || {}
  const form = String(qa.form_key || pkg.form_key || 'default')
  const rec = pkg.recordIndex != null ? String(pkg.recordIndex) : pkg.id
  return `${draftOwnerKey(pkg)}|${form}|${rec}`
}

/** Keep the newest draft per surveyor + survey + record number; delete extras. */
export async function collapseDuplicateDrafts() {
  const drafts = await listDrafts()
  const best = new Map()
  const extras = []
  for (const d of drafts) {
    const key = draftRecordKey(d)
    const prev = best.get(key)
    if (!prev) {
      best.set(key, d)
      continue
    }
    const newer = String(d.updatedAt || d.createdAt || '') > String(prev.updatedAt || prev.createdAt || '')
    if (newer) {
      extras.push(prev)
      best.set(key, d)
    } else {
      extras.push(d)
    }
  }
  for (const d of extras) {
    await removePackage(d.id).catch(() => {})
  }
  return extras.length
}

/** In-progress draft for this surveyor + survey + record (so Next/Finish reuse it). */
export async function findOpenDraft({ userId, submittedBy, formKey, recordIndex } = {}) {
  const drafts = await listDrafts()
  const uid = userId != null ? String(userId) : ''
  const who = String(submittedBy || '')
  const form = String(formKey || 'default')
  const rec = recordIndex != null ? Number(recordIndex) : null
  const matches = drafts.filter((d) => {
    const qa = d.qa || {}
    const sameUser =
      (uid && String(qa.user_id || '') === uid) ||
      (who && String(qa.submitted_by || d.submitted_by || '') === who) ||
      (!uid && !who)
    const sameForm = String(qa.form_key || 'default') === form
    const sameRec = rec == null || Number(d.recordIndex) === rec
    return sameUser && sameForm && sameRec
  })
  matches.sort((a, b) =>
    String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')),
  )
  return matches[0] || null
}

export async function draftCount() {
  try {
    const db = await openDb()
    const all = await idbReq(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())
    db.close()
    return (all || []).filter((p) => p.phase === 'draft').length
  } catch {
    return listPackagesMetaFallback().filter((p) => p.phase === 'draft').length
  }
}

/** Push a draft into the sync queue → client admin sees it as pending */
export async function pushDraft(id) {
  const pkg = await getPackage(id)
  if (!pkg) return null
  await updatePackage(id, { phase: 'queued', attempts: 0, lastError: null })
  emitChange({ type: 'saved', id, pushed: true })
  return id
}

export async function deleteDraft(id) {
  await removePackage(id)
  emitChange({ type: 'deleted', id })
}

export async function listAllPackages() {
  try {
    const db = await openDb()
    const all = await idbReq(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())
    db.close()
    return (all || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  } catch {
    return listPackagesMetaFallback().sort((a, b) =>
      String(b.createdAt).localeCompare(String(a.createdAt)),
    )
  }
}

export async function queueStats() {
  const all = await listAllPackages()
  const pending = all.filter((p) => p.phase !== 'done' && p.phase !== 'draft')
  const failed = all.filter((p) => p.phase === 'failed')
  const syncing = all.filter((p) => p.phase === 'syncing')
  const done = all.filter((p) => p.phase === 'done')
  const drafts = all.filter((p) => p.phase === 'draft')
  return {
    total: all.length,
    pending: pending.length,
    failed: failed.length,
    syncing: syncing.length,
    doneLocal: done.length,
    drafts: drafts.length,
    items: pending.map((p) => ({
      id: p.id,
      phase: p.phase,
      createdAt: p.createdAt,
      attempts: p.attempts,
      lastError: p.lastError,
      recordIndex: p.recordIndex,
      hasPhoto: !!p.photoDataUrl || p.hasPhoto,
      hasAudio: !!p.audioDataUrl || p.hasAudio,
    })),
  }
}

// ── Legacy bridge for older queue key ──────────────────────
export function migrateLegacyQueue() {
  try {
    const raw = localStorage.getItem('esurvey_offline_queue_v1')
    if (!raw) return
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr) || !arr.length) return
    // leave old key; new packages use IDB. optional one-time note
    writeMeta({ legacyQueueCount: arr.length })
  } catch {
    /* ignore */
  }
}

export { emitChange, readMeta }
