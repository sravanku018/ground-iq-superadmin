import { useEffect, useState } from 'react'

/**
 * useIsNarrow — tracks a `max-width` media query in JS.
 *
 * The portal renders some chrome twice (desktop dock vs mobile topbar) and
 * hides one copy with CSS. Rendering both would mount duplicate components
 * (e.g. two notification streams), so callers use this to mount only one.
 *
 * Matches the portal's mobile breakpoint in portal.css (`max-width: 960px`).
 */
export function useIsNarrow(px = 960) {
  const query = `(max-width: ${px}px)`
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia(query)
    const onChange = (e) => setNarrow(e.matches)
    setNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return narrow
}

export default useIsNarrow
