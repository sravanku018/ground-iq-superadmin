import { useEffect, useState } from 'react'
import { getAppRelease } from './api'

/**
 * Live APK release info from /api/app-version — the same advert the field app
 * uses for updates. Refreshes every 60s while the tab is visible, so a new
 * release mirrored to Cloudflare shows up in the portals without a reload.
 */
export default function useAppRelease(pollMs = 60_000) {
  const [release, setRelease] = useState(null)
  useEffect(() => {
    let stopped = false
    const load = () => {
      getAppRelease()
        .then((r) => {
          if (!stopped && r?.version) setRelease(r)
        })
        .catch(() => {})
    }
    load()
    const t = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') load()
    }, pollMs)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [pollMs])
  return release
}
