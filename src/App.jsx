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
import { reloadOnceIfUpgraded } from './version'

const SurveyorApp = lazy(() => import('./SurveyorApp'))

function isAdminPath() {
  if (typeof window === 'undefined') return false
  const p = window.location.pathname || ''
  return p === '/admin' || p.startsWith('/admin/') || /\/admin(\/|$)/.test(p)
}

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

import AppUpdateModal from './AppUpdateModal'

export default function App() {
  // Store running build version; self-heal stale cached bundles; set document title
  const portalOnly = SUPER_ADMIN_CONSOLE || !FIELD_APP_ENABLED || isAdminPath()

  useEffect(() => {
    const info = reloadOnceIfUpgraded()
    if (typeof document !== 'undefined') {
      document.title = SUPER_ADMIN_CONSOLE
        ? 'Smart Survey X — Super Admin'
        : portalOnly
          ? 'Smart Survey X — Client Admin'
          : 'Smart Survey X'
    }
    if (info.upgraded) {
      console.info(`[Smart Survey X] upgraded ${info.prev} → ${info.current}`)
    }
  }, [portalOnly])

  return (
    <>
      {SUPER_ADMIN_CONSOLE ? (
        <AdminPortal superAdminOnly />
      ) : !FIELD_APP_ENABLED || isAdminPath() ? (
        <AdminPortal />
      ) : (
        <Suspense fallback={<FieldBoot />}>
          <SurveyorApp />
        </Suspense>
      )}
      {portalOnly ? null : <AppUpdateModal />}
    </>
  )
}
