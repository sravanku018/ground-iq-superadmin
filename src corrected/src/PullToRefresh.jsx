import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Reliable pull-to-refresh for the surveyor React app (touch + mouse).
 * This element IS the scroll container so scrollTop is correct.
 */
export default function PullToRefresh({
  onRefresh,
  children,
  disabled = false,
  label = 'Pull to refresh',
  refreshingLabel = 'Refreshing…',
}) {
  const startY = useRef(0)
  const pulling = useRef(false)
  const dyRef = useRef(0)
  const [dy, setDy] = useState(0)
  const [busy, setBusy] = useState(false)
  const elRef = useRef(null)

  const THRESHOLD = 68
  const MAX = 110

  const setPull = useCallback((v) => {
    dyRef.current = v
    setDy(v)
  }, [])

  const runRefresh = useCallback(async () => {
    if (disabled || busy) {
      setPull(0)
      return
    }
    if (dyRef.current < THRESHOLD) {
      setPull(0)
      return
    }
    setBusy(true)
    setPull(52)
    try {
      await onRefresh?.()
    } catch {
      /* parent toasts errors */
    } finally {
      setBusy(false)
      setPull(0)
    }
  }, [disabled, busy, onRefresh, setPull])

  // Non-passive listeners so preventDefault works on iOS/Android WebView
  useEffect(() => {
    const el = elRef.current
    if (!el) return undefined

    const atTop = () => (el.scrollTop || 0) <= 2

    const onStart = (clientY) => {
      if (disabled || busy) return
      if (!atTop()) {
        pulling.current = false
        return
      }
      startY.current = clientY
      pulling.current = true
    }

    const onMove = (clientY, e) => {
      if (!pulling.current || disabled || busy) return
      if (!atTop() && dyRef.current <= 0) {
        pulling.current = false
        setPull(0)
        return
      }
      const delta = clientY - startY.current
      if (delta <= 0) {
        setPull(0)
        return
      }
      const d = Math.min(MAX, delta * 0.5)
      setPull(d)
      if (d > 6 && e?.cancelable) {
        e.preventDefault()
      }
    }

    const onEnd = () => {
      if (!pulling.current) return
      pulling.current = false
      void runRefresh()
    }

    const touchStart = (e) => onStart(e.touches[0].clientY)
    const touchMove = (e) => onMove(e.touches[0].clientY, e)
    const touchEnd = () => onEnd()

    // Desktop / Capacitor mouse testing
    let mouseDown = false
    const mouseStart = (e) => {
      mouseDown = true
      onStart(e.clientY)
    }
    const mouseMove = (e) => {
      if (!mouseDown) return
      onMove(e.clientY, e)
    }
    const mouseEnd = () => {
      if (!mouseDown) return
      mouseDown = false
      onEnd()
    }

    el.addEventListener('touchstart', touchStart, { passive: true })
    el.addEventListener('touchmove', touchMove, { passive: false })
    el.addEventListener('touchend', touchEnd, { passive: true })
    el.addEventListener('touchcancel', touchEnd, { passive: true })
    el.addEventListener('mousedown', mouseStart)
    window.addEventListener('mousemove', mouseMove)
    window.addEventListener('mouseup', mouseEnd)

    return () => {
      el.removeEventListener('touchstart', touchStart)
      el.removeEventListener('touchmove', touchMove)
      el.removeEventListener('touchend', touchEnd)
      el.removeEventListener('touchcancel', touchEnd)
      el.removeEventListener('mousedown', mouseStart)
      window.removeEventListener('mousemove', mouseMove)
      window.removeEventListener('mouseup', mouseEnd)
    }
  }, [disabled, busy, runRefresh, setPull])

  const ready = dy >= THRESHOLD

  return (
    <div
      ref={elRef}
      className={`ptr-root ${busy ? 'ptr-busy' : ''}`}
      data-ptr="true"
    >
      <div
        className={`ptr-indicator ${busy ? 'busy' : ''} ${ready ? 'ready' : ''}`}
        style={{ height: Math.max(dy, busy ? 52 : 0), opacity: dy > 6 || busy ? 1 : 0 }}
        aria-live="polite"
      >
        <span className="ptr-spinner" aria-hidden={busy ? 'false' : 'true'} />
        <span>
          {busy ? refreshingLabel : ready ? 'Release to refresh' : label}
        </span>
      </div>
      <div
        className="ptr-content"
        style={{
          transform: dy || busy ? `translateY(${busy ? 52 : dy}px)` : undefined,
          transition: pulling.current ? 'none' : 'transform 0.18s ease-out',
        }}
      >
        {children}
      </div>
    </div>
  )
}
