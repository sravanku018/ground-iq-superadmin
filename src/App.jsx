/**
 * Entry router:
 *   /admin  → Client Admin web portal (desktop)
 *   /       → Surveyor field app (phone / APK) when field build
 *   Super Admin console when VITE_SUPER_ADMIN=1
 *
 * SurveyorApp is lazy-loaded so GitHub Pages admin builds never download
 * the field-collect bundle on first paint (major Pages speed win).
 */
import { lazy, Suspense, useEffect } from 'react'
import AdminPortal from './AdminPortal'
import { reloadOnceIfUpgraded, versionLabel } from './version'

const SurveyorApp = lazy(() => import('./SurveyorApp'))

function isAdminPath() {
  if (typeof window === 'undefined') return false
  const p = window.location.pathname || ''
  // Works at /admin and under any base path (e.g. /ground-iq-web/admin on Pages)
  return p === '/admin' || p.startsWith('/admin/') || /\/admin(\/|$)/.test(p)
}

/**
 * Website = Client Admin portal only. The Android APK keeps the surveyor
 * field app (built with VITE_FIELD_APP=1).
 * VITE_SUPER_ADMIN=1 → separate Super Admin console (GitHub Pages / Vercel).
 * Vercel builds set these in vite.config.js from the GitHub repo name so
 * ground-iq-web is Client Admin and ground-iq-superadmin is Super Admin.
 */
const FIELD_APP_ENABLED = (import.meta.env.VITE_FIELD_APP ?? '1') !== '0'
const SUPER_ADMIN_CONSOLE = (import.meta.env.VITE_SUPER_ADMIN ?? '0') === '1'

function FieldBoot() {
  return (
    <div
      className="screen"
      style={{
        minHeight: '40vh',
        display: 'grid',
        placeItems: 'center',
        color: '#94a3b8',
        fontSize: 14,
        fontWeight: 600,
      }}
    >
      Loading field app…
    </div>
  )
}

export default function App() {
  // Store running build version; self-heal stale cached bundles; set document title
  useEffect(() => {
    const info = reloadOnceIfUpgraded()
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
  return (
    <Suspense fallback={<FieldBoot />}>
      <SurveyorApp />
    </Suspense>
  )
}
