/**
 * Background thread (Web Worker) — POSTs queued surveys without blocking UI.
 *
 * Main thread sends:
 *   { type: 'sync-batch', baseUrl, token, items: [{ id, payload }] }
 * Worker replies:
 *   { type: 'item-ok', id, ms }
 *   { type: 'item-fail', id, error, ms }
 *   { type: 'batch-done', ok, fail, totalMs }
 */

const POST_TIMEOUT_MS = 20_000

async function postOne(baseUrl, token, payload, signal) {
  const res = await fetch(`${baseUrl}/api/submissions`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    signal,
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || data.message || `HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return data
}

self.onmessage = async (ev) => {
  const msg = ev.data || {}
  if (msg.type !== 'sync-batch') return

  const { baseUrl, token, items } = msg
  if (!baseUrl || !Array.isArray(items) || !items.length) {
    self.postMessage({ type: 'batch-done', ok: 0, fail: 0, totalMs: 0 })
    return
  }

  const t0 = Date.now()
  let ok = 0
  let fail = 0

  for (const item of items) {
    const id = item.id
    const payload = item.payload
    const itemT0 = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS)
    try {
      await postOne(baseUrl, token, payload, controller.signal)
      clearTimeout(timer)
      ok += 1
      self.postMessage({
        type: 'item-ok',
        id,
        ms: Date.now() - itemT0,
      })
    } catch (e) {
      clearTimeout(timer)
      fail += 1
      const error =
        e?.name === 'AbortError' ? 'timeout 20s' : e?.message || 'sync failed'
      self.postMessage({
        type: 'item-fail',
        id,
        error,
        status: e?.status,
        ms: Date.now() - itemT0,
      })
      // Stop batch on auth failure — main thread should re-login
      if (e?.status === 401) break
    }
  }

  self.postMessage({
    type: 'batch-done',
    ok,
    fail,
    totalMs: Date.now() - t0,
  })
}
