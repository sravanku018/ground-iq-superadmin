/**
 * Compatibility layer — storage is localStore + syncEngine.
 */

export {
  savePackageLocal as enqueueSubmissionPackage,
  listPendingPackages,
  queueStats,
  getPackage,
} from './localStore'

import { savePackageLocal, queueStats } from './localStore'

/** @deprecated use savePackageLocal via FieldCollect */
export function enqueueSubmission(payload) {
  const id = `legacy_${Date.now()}`
  void savePackageLocal({
    form_id: payload.form_id,
    source: payload.source,
    submitted_by: payload.submitted_by,
    answers: payload.answers,
    geo: payload.geo,
    photoDataUrl: null,
    audioDataUrl: null,
  })
  return id
}

export function listQueued() {
  return []
}

export async function queueCountAsync() {
  const s = await queueStats()
  return s.pending
}

export function queueCount() {
  try {
    const meta = JSON.parse(localStorage.getItem('esurvey_queue_meta_v2') || '{}')
    return meta.lastPendingCount ?? 0
  } catch {
    return 0
  }
}

export async function refreshQueueCountCache() {
  const s = await queueStats()
  try {
    const meta = JSON.parse(localStorage.getItem('esurvey_queue_meta_v2') || '{}')
    localStorage.setItem(
      'esurvey_queue_meta_v2',
      JSON.stringify({ ...meta, lastPendingCount: s.pending }),
    )
  } catch {
    /* ignore */
  }
  return s.pending
}

export function removeFromQueue() {}
export function bumpAttempt() {}
export function peekBatch() {
  return []
}
