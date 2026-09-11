import { useEffect, useRef, useCallback } from 'react'

export const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const THROTTLE_MS = 2000 // Record activity at most once per 2s
const CHECK_INTERVAL_MS = 5000 // Check every 5s
export const LAST_ACTIVE_KEY = 'esurvey_last_active'
export const IDLE_LOGOUT_EVENT_KEY = 'esurvey_idle_logged_out'

/**
 * useIdleTimeout — Logs out after a period of inactivity.
 *
 * Designed for Client Admin and Super Admin security compliance.
 *
 * @param {object} options
 * @param {() => void} options.onTimeout - Callback to invoke when idle timeout is reached
 * @param {number} [options.timeoutMs] - Duration of inactivity before timeout (default 5 min)
 * @param {boolean} [options.enabled] - Whether idle monitoring is active (e.g. user is logged in)
 */
export function useIdleTimeout({
  onTimeout,
  timeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  enabled = true,
}) {
  const timeoutCallbackRef = useRef(onTimeout)
  timeoutCallbackRef.current = onTimeout

  const lastActiveRef = useRef(Date.now())
  const lastRecordedRef = useRef(0)

  const recordActivity = useCallback(() => {
    const now = Date.now()
    if (now - lastRecordedRef.current < THROTTLE_MS) return
    lastRecordedRef.current = now
    lastActiveRef.current = now
    try {
      localStorage.setItem(LAST_ACTIVE_KEY, String(now))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!enabled) return undefined

    const now = Date.now()
    let prevActive = 0
    try {
      const stored = Number(localStorage.getItem(LAST_ACTIVE_KEY))
      if (stored && !Number.isNaN(stored)) {
        prevActive = stored
      }
    } catch {
      /* ignore */
    }

    // If an existing session was already idle for > timeoutMs, expire immediately
    if (prevActive && now - prevActive >= timeoutMs) {
      try {
        localStorage.setItem(IDLE_LOGOUT_EVENT_KEY, String(now))
      } catch {
        /* ignore */
      }
      if (timeoutCallbackRef.current) {
        timeoutCallbackRef.current()
      }
      return undefined
    }

    // Otherwise initialize or update the active timestamp
    lastActiveRef.current = prevActive && now - prevActive < timeoutMs ? prevActive : now
    try {
      localStorage.setItem(LAST_ACTIVE_KEY, String(lastActiveRef.current))
      localStorage.removeItem(IDLE_LOGOUT_EVENT_KEY)
    } catch {
      /* ignore */
    }

    const checkIdle = () => {
      let storedTime = lastActiveRef.current
      try {
        const stored = Number(localStorage.getItem(LAST_ACTIVE_KEY))
        if (stored && !Number.isNaN(stored)) {
          storedTime = Math.max(storedTime, stored)
        }
      } catch {
        /* ignore */
      }

      if (Date.now() - storedTime >= timeoutMs) {
        try {
          localStorage.setItem(IDLE_LOGOUT_EVENT_KEY, String(Date.now()))
        } catch {
          /* ignore */
        }
        if (timeoutCallbackRef.current) {
          timeoutCallbackRef.current()
        }
      }
    }

    // Regular interval check
    const timerId = setInterval(checkIdle, CHECK_INTERVAL_MS)

    // Activity event listeners
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel']
    const onUserActivity = () => recordActivity()

    events.forEach((evt) => {
      window.addEventListener(evt, onUserActivity, { passive: true })
    })

    // Immediate check when tab becomes visible or focused
    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        checkIdle()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityOrFocus)
    window.addEventListener('focus', onVisibilityOrFocus)

    // Sync across tabs
    const onStorage = (e) => {
      if (e.key === LAST_ACTIVE_KEY && e.newValue) {
        const val = Number(e.newValue)
        if (val && !Number.isNaN(val)) {
          lastActiveRef.current = Math.max(lastActiveRef.current, val)
        }
      } else if (e.key === IDLE_LOGOUT_EVENT_KEY && e.newValue) {
        if (timeoutCallbackRef.current) {
          timeoutCallbackRef.current()
        }
      }
    }
    window.addEventListener('storage', onStorage)

    return () => {
      clearInterval(timerId)
      events.forEach((evt) => {
        window.removeEventListener(evt, onUserActivity)
      })
      document.removeEventListener('visibilitychange', onVisibilityOrFocus)
      window.removeEventListener('focus', onVisibilityOrFocus)
      window.removeEventListener('storage', onStorage)
    }
  }, [enabled, timeoutMs, recordActivity])
}

export default useIdleTimeout
