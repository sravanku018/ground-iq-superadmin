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
import { getStoredUser } from './api'
import AppUpdateModal from './AppUpdateModal'

const SurveyorApp = lazy(() => import('./SurveyorApp'))
const PublicWebFill = lazy(() => import('./PublicWebFill'))

function isSuperAdminPath() {
  if (typeof window === 'undefined') return false
  if (publicFillKey()) return false
  const p = window.location.pathname || ''
  const q = new URLSearchParams(window.location.search)
  return (
    p === '/super' ||
    p.startsWith('/super/') ||
    p === '/superadmin' ||
    p.startsWith('/superadmin/') ||
    q.get('super') === '1' ||
    q.get('superadmin') === '1'
  )
}

function isAdminPath() {
  if (typeof window === 'undefined') return false
  if (publicFillKey()) return false
  const p = window.location.pathname || ''
  const q = new URLSearchParams(window.location.search)
  return (
    isSuperAdminPath() ||
    p === '/admin' ||
    p.startsWith('/admin/') ||
    /\/admin(\/|$)/.test(p) ||
    q.get('admin') === '1' ||
    q.get('portal') === '1'
  )
}

function publicFillKey() {
  if (typeof window === 'undefined') return ''
  const q = new URLSearchParams(window.location.search).get('fill')
  if (q) return String(q).trim()
  const p = String(window.location.pathname || '')
  const m = p.match(/^\/(?:fill|s)\/([^/]+)\/?$/i)
  if (!m) return ''
  try {
    return decodeURIComponent(m[1]).trim()
  } catch {
    return String(m[1] || '').trim()
  }
}

function publicFillToken() {
  if (typeof window === 'undefined') return ''
  const q = new URLSearchParams(window.location.search)
  return String(q.get('k') || q.get('token') || '').trim()
}

/** Client Admin “Copy link” uses ?app=1 so portal-only Vercel/Pages builds still open the collector. */
function wantFieldApp() {
  if (typeof window === 'undefined') return false
  const q = new URLSearchParams(window.location.search).get('app') || new URLSearchParams(window.location.search).get('field')
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

export default function App() {
  // Web fill is activated whenever ?fill=<formKey> is present in the URL
  const fillKey = publicFillKey()
  const storedUser = typeof window !== 'undefined' ? getStoredUser() : null
  const isAdminUser = storedUser?.role === 'admin' || storedUser?.role === 'super_admin'

  const openFieldApp =
    !fillKey &&
    !SUPER_ADMIN_CONSOLE &&
    !isAdminPath() &&
    (wantFieldApp() || (FIELD_APP_ENABLED && !isAdminUser))

  const portalOnly = !fillKey && !openFieldApp

  useEffect(() => {
    const info = reloadOnceIfUpgraded()
    if (typeof document !== 'undefined') {
      document.title = fillKey
        ? 'Ground IQ — Web Survey'
        : SUPER_ADMIN_CONSOLE
          ? 'Smart Survey X — Super Admin'
          : portalOnly
            ? 'Smart Survey X — Client Admin'
            : 'Smart Survey X'
    }
    if (info.upgraded) {
      console.info(`[Smart Survey X] upgraded ${info.prev} → ${info.current}`)
    }
  }, [portalOnly, fillKey])

  const isSuper = SUPER_ADMIN_CONSOLE || isSuperAdminPath()

  return (
    <>
      {fillKey ? (
        <Suspense fallback={<FieldBoot />}>
          <PublicWebFill formKey={fillKey} fillToken={publicFillToken()} />
        </Suspense>
      ) : isSuper ? (
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
