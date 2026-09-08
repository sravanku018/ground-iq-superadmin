/**
 * useAsyncData — Cache-first stale-refresh hook.
 *
 * Pattern (from mock3/use-async-data.html):
 *   1. Serve from cache immediately (instant UI)
 *   2. If stale (>staleMs), fire background refresh
 *   3. On network failure, keep stale data visible
 *   4. Cache persists across tab switches
 *
 * Google principle: built for the low end — cheap phone, bad network.
 * Twitter principle: refresh on open — data never more than one tab-open stale.
 */
import { useState, useEffect, useCallback, useRef } from 'react'

const CACHE_PREFIX = '__asyncData__'

function readCache(key) {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeCache(key, data) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, ts: Date.now() }))
  } catch {
    /* storage full — ignore */
  }
}

/**
 * @param {string} cacheKey — unique key for this data source
 * @param {() => Promise<any>} fetcher — async function that returns data
 * @param {object} opts
 * @param {number} opts.staleMs — how old before background refresh (default 30s)
 * @param {boolean} opts.enabled — false to skip fetching (default true)
 */
export function useAsyncData(cacheKey, fetcher, { staleMs = 30_000, enabled = true } = {}) {
  const [data, setData] = useState(() => {
    const cached = readCache(cacheKey)
    return cached?.data ?? null
  })
  const [loading, setLoading] = useState(() => {
    if (!enabled) return false
    const cached = readCache(cacheKey)
    return !cached // loading only if no cache
  })
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!enabled) return

    // 1. Serve from cache immediately
    const cached = readCache(cacheKey)
    if (cached) {
      setData(cached.data)
      // 2. If fresh, skip network
      if (Date.now() - cached.ts < staleMs) {
        setLoading(false)
        return
      }
      // 3. Show stale data while refreshing
      setLoading(false)
    }

    // 4. Fire background refresh
    setLoading(true)
    setError(null)
    fetcher()
      .then(d => {
        if (!mountedRef.current) return
        writeCache(cacheKey, d)
        setData(d)
        setError(null)
      })
      .catch(err => {
        if (!mountedRef.current) return
        // Keep stale data visible on failure
        setError(err)
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })
  }, [cacheKey, staleMs, enabled])

  const refetch = useCallback(() => {
    if (!enabled) return Promise.resolve()
    setLoading(true)
    setError(null)
    return fetcher()
      .then(d => {
        writeCache(cacheKey, d)
        setData(d)
        return d
      })
      .catch(err => {
        setError(err)
        throw err
      })
      .finally(() => setLoading(false))
  }, [cacheKey, fetcher, enabled])

  const invalidate = useCallback(() => {
    try { sessionStorage.removeItem(CACHE_PREFIX + cacheKey) } catch { /* ignore */ }
    setData(null)
  }, [cacheKey])

  return { data, loading, error, refetch, invalidate }
}
