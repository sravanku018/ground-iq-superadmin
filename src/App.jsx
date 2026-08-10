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

/**
 * Website = Client Admin portal only. The Android APK keeps the surveyor
 * field app (built with VITE_FIELD_APP=1).
 * VITE_SUPER_ADMIN=1 → separate Super Admin console on its own GitHub page
 * (login server-gated to role super_admin).
 */
const FIELD_APP_ENABLED = (import.meta.env.VITE_FIELD_APP ?? '1') !== '0'
const SUPER_ADMIN_CONSOLE = (import.meta.env.VITE_SUPER_ADMIN ?? '0') === '1'

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

  if (SUPER_ADMIN_CONSOLE) {
    return <AdminPortal superAdminOnly />
  }
  if (!FIELD_APP_ENABLED || isAdminPath()) {
    return <AdminPortal />
  }
  return <SurveyorApp />
}
