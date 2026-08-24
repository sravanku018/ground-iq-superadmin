import { lazy, Suspense, useEffect, useState } from 'react'
import AdminPortal from './AdminPortal'
import { reloadOnceIfUpgraded, versionLabel } from './version'

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

export default function App() {
  const [activeRole, setActiveRole] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = window.location.pathname || ''
      const params = new URLSearchParams(window.location.search)
      if (params.get('role')) return params.get('role')
      if (SUPER_ADMIN_CONSOLE || p.includes('/superadmin')) return 'superadmin'
      if (isAdminPath()) return 'clientadmin'
    }
    return FIELD_APP_ENABLED ? 'surveyor' : 'clientadmin'
  })

  // Store running build version; self-heal stale cached bundles; set document title
  useEffect(() => {
    const info = reloadOnceIfUpgraded()
    if (typeof document !== 'undefined') {
      document.title = `Smart Survey X ${versionLabel()}`
    }
    if (info.upgraded) {
      console.info(`[Smart Survey X] upgraded ${info.prev} → ${info.current}`)
    }
  }, [])

  return (
    <div className="whole-app-root" style={{ minHeight: '100vh', background: 'var(--bg, #f8fafc)' }}>
      {/* Mock 3 Top Appbar with Role Switcher */}
      <div
        className="appbar"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '10px 18px',
          background: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15 }}>
          <span
            className="glyph"
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: 'var(--accent, #059669)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
            }}
          >
            ◆
          </span>
          <span>
            Smart Survey X<br />
            <span className="sub" style={{ color: '#64748b', fontWeight: 400, fontSize: 11 }}>
              Ground IQ Platform
            </span>
          </span>
        </div>
        <div
          className="role-tabs"
          role="tablist"
          style={{
            display: 'flex',
            gap: 4,
            background: '#f1f5f9',
            padding: 3,
            borderRadius: 999,
          }}
        >
          <button
            type="button"
            className={`role-tab ${activeRole === 'surveyor' ? 'active' : ''}`}
            onClick={() => setActiveRole('surveyor')}
            style={{
              border: 'none',
              background: activeRole === 'surveyor' ? '#ffffff' : 'none',
              cursor: 'pointer',
              padding: '6px 14px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: activeRole === 'surveyor' ? 700 : 500,
              color: activeRole === 'surveyor' ? 'var(--accent, #059669)' : '#64748b',
              boxShadow: activeRole === 'surveyor' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            📱 Surveyor
          </button>
          <button
            type="button"
            className={`role-tab ${activeRole === 'clientadmin' ? 'active' : ''}`}
            onClick={() => setActiveRole('clientadmin')}
            style={{
              border: 'none',
              background: activeRole === 'clientadmin' ? '#ffffff' : 'none',
              cursor: 'pointer',
              padding: '6px 14px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: activeRole === 'clientadmin' ? 700 : 500,
              color: activeRole === 'clientadmin' ? 'var(--accent, #059669)' : '#64748b',
              boxShadow: activeRole === 'clientadmin' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            📊 Client Admin
          </button>
          <button
            type="button"
            className={`role-tab ${activeRole === 'superadmin' ? 'active' : ''}`}
            onClick={() => setActiveRole('superadmin')}
            style={{
              border: 'none',
              background: activeRole === 'superadmin' ? '#ffffff' : 'none',
              cursor: 'pointer',
              padding: '6px 14px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: activeRole === 'superadmin' ? 700 : 500,
              color: activeRole === 'superadmin' ? 'var(--accent, #059669)' : '#64748b',
              boxShadow: activeRole === 'superadmin' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            🛡 Super Admin
          </button>
        </div>
        <div style={{ flex: 1 }} />
        <span className="sync-chip synced">
          <span className="sdot" /> Synced
        </span>
      </div>

      {/* Screen Content based on Active Role */}
      {activeRole === 'superadmin' ? (
        <AdminPortal superAdminOnly />
      ) : activeRole === 'clientadmin' ? (
        <AdminPortal />
      ) : (
        <Suspense fallback={<FieldBoot />}>
          <SurveyorApp />
        </Suspense>
      )}
    </div>
  )
}
