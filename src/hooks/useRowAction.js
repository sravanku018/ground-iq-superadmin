/**
 * useRowAction — Optimistic flip + rollback hook.
 *
 * Pattern (from mock3/row-action.html):
 *   1. Snapshot current state for rollback
 *   2. Optimistic flip — UI updates instantly
 *   3. Background sync (PATCH /api/review/:id)
 *   4. On failure → rollback to snapshot + toast
 *
 * Twitter principle: tap → instant, network catches up.
 * Google principle: built for the low end — rollback more likely on bad network.
 */
import { useCallback, useRef } from 'react'

export function useRowAction(items, setItems, { onError, onSuccess } = {}) {
  const snapshotsRef = useRef(new Map())

  const act = useCallback(
    async (id, action, { endpoint, payload } = {}) => {
      const itemsArr = typeof items === 'function' ? [] : items
      const prev = itemsArr.find?.(r => r.id === id) ?? null
      const snapshot = prev ? { ...prev } : null

      // 1. Optimistic flip — UI updates instantly
      setItems(rs =>
        rs.map(r => (r.id === id ? { ...r, status: action, ...payload } : r))
      )

      snapshotsRef.current.set(id, snapshot)

      // 2. Background sync
      try {
        const url = endpoint || `/api/review/${id}`
        const res = await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: action, ...payload }),
        })
        if (!res.ok) throw new Error(`Server ${res.status}`)
        const result = await res.json().catch(() => ({}))
        onSuccess?.(id, action, result)
      } catch (err) {
        // 3. Rollback on failure
        if (snapshot) {
          setItems(rs => rs.map(r => (r.id === id ? { ...snapshot } : r)))
        }
        onError?.(id, action, err)
      } finally {
        snapshotsRef.current.delete(id)
      }
    },
    [items, setItems, onError, onSuccess]
  )

  const rollback = useCallback(
    id => {
      const snapshot = snapshotsRef.current.get(id)
      if (snapshot) {
        setItems(rs => rs.map(r => (r.id === id ? { ...snapshot } : r)))
        snapshotsRef.current.delete(id)
      }
    },
    [setItems]
  )

  return { act, rollback }
}
