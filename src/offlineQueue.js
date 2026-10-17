/**
 * Pending-package count for the sync badge in SurveyorApp.
 *
 * Storage itself lives in localStore + syncEngine; this module only mirrors the
 * count into localStorage so the badge can paint synchronously on boot, before
 * the (async) queue stats resolve. It used to also re-export the whole localStore
 * queue API and stub out enqueueSubmission/listQueued/removeFromQueue/bumpAttempt/
 * peekBatch — none of which had a caller.
 */

import { queueStats } from './localStore'

/** Cached count — safe to call during render, never throws. */
export function queueCount() {
  try {
    const meta = JSON.parse(localStorage.getItem('esurvey_queue_meta_v2') || '{}')
    return meta.lastPendingCount ?? 0
  } catch {
    return 0
  }
}

/** Re-read the real queue and refresh the cached count. */
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
