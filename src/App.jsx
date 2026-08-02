/**
 * Entry router:
 *   /admin  → Client Admin web portal (desktop)
 *   /       → Surveyor field app (phone / APK)
 */
import { useEffect } from 'react'
import AdminPortal from './AdminPortal'
import SurveyorApp from './SurveyorApp'
import { storeAppVersion, versionLabel } from './version'

function isAdminPath() {
  if (typeof window === 'undefined') return false
  const p = window.location.pathname || ''
  // Works at /admin and under any base path (e.g. /ground-iq-web/admin on Pages)
  return p === '/admin' || p.startsWith('/admin/') || /\/admin(\/|$)/.test(p)
}

export default function App() {
  // Store running build version in localStorage; show in document title
  useEffect(() => {
    const info = storeAppVersion()
    if (typeof document !== 'undefined') {
      document.title = `Ground IQ ${versionLabel()}`
    }
    if (info.upgraded) {
      console.info(`[Ground IQ] upgraded ${info.prev} → ${info.current}`)
    }
  }, [])

  if (isAdminPath()) {
    return <AdminPortal />
  }
  return <SurveyorApp />
}
