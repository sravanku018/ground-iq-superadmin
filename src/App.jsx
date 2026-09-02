/**
 * Entry router:
 *   /admin  → Client Admin web portal (desktop)
 *   /       → Surveyor field app (phone / APK) when field build
 *   /?app=1 → Field app even on portal-only Client Admin builds (share link)
 *   Super Admin console when VITE_SUPER_ADMIN=1
 *
 * SurveyorApp is lazy-loaded so GitHub Pages admin builds never download
 * the field-collect bundle on first paint (major Pages speed win).
 */
import { lazy, Suspense, useEffect } from 'react'
import AdminPortal from './AdminPortal'
import { reloadOnceIfUpgraded } from './version'

const SurveyorApp = lazy(() => import('./SurveyorApp'))
const PublicWebFill = lazy(() => import('./PublicWebFill'))

function isAdminPath() {
  if (typeof window === 'undefined') return false
  const p = window.location.pathname || ''
  return p === '/admin' || p.startsWith('/admin/') || /\/admin(\/|$)/.test(p)
}

function publicFillKey() {
  if (typeof window === 'undefined') return ''
  const q = new URLSearchParams(window.location.search).get('fill')
  return String(q || '').trim()
}

function publicFillToken() {
  if (typeof window === 'undefined') return ''
  const q = new URLSearchParams(window.location.search)
  return String(q.get('k') || q.get('token') || '').trim()
}

/** Client Admin “Copy link” uses ?app=1 so portal-only Vercel/Pages builds still open the collector. */
function wantFieldApp() {
  if (typeof window === 'undefined') return false
  const q = new URLSearchParams(window.location.search).get('app')
  return q === '1' || q === 'true'
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
  const fillKey = publicFillKey()
  const openFieldApp =
    !SUPER_ADMIN_CONSOLE &&
    !isAdminPath() &&
    (FIELD_APP_ENABLED || wantFieldApp())
  const portalOnly = !fillKey && !openFieldApp

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
      {fillKey ? (
        <Suspense fallback={<FieldBoot />}>
          <PublicWebFill formKey={fillKey} fillToken={publicFillToken()} />
        </Suspense>
      ) : SUPER_ADMIN_CONSOLE ? (
        <AdminPortal superAdminOnly />
      ) : openFieldApp ? (
        <Suspense fallback={<FieldBoot />}>
          <SurveyorApp />
        </Suspense>
      ) : (
        <AdminPortal />
      )}
      {fillKey || portalOnly ? null : <AppUpdateModal />}
    </>
  )
}
