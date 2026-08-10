import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import {
  getStats,
  getStoredUser,
  getToken,
  listSubmissions,
  listSurveys,
  logout,
  me,
} from './api'
import AdminLogin from './AdminLogin'
import VerifiedBadge from './VerifiedBadge'
import { PortalEmpty, PortalSkeleton } from './PortalUI'
import { versionLabel } from './version'
import './App.css'
import './portal.css'

// Lazy-load heavy admin screens — only fetch/parse when that tab is opened
const AdminUsersScreen = lazy(() => import('./AdminUsers'))
const AdminSurveysScreen = lazy(() => import('./AdminSurveys'))
const AdminQuestionsScreen = lazy(() => import('./AdminQuestions'))
const AdminAnalyzeScreen = lazy(() => import('./AdminAnalyze'))
const ReviewQAScreen = lazy(() => import('./ReviewQA'))
const DashboardScreen = lazy(() => import('./Dashboard'))
const AdminDataScreen = lazy(() => import('./AdminData'))
const AdminAuditScreen = lazy(() => import('./AdminAudit'))
const AdminQuestionBankScreen = lazy(() => import('./AdminQuestionBank'))
const AdminSeatsScreen = lazy(() => import('./AdminSeats'))

// Client Admin nav — Question Bank (FR-QB-02) sits under Data collection
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '◈', pages: ['overview', 'report', 'analyze'] },
  { id: 'surveyors', label: 'Surveyors', icon: '👤', pages: ['users'] },
  { id: 'surveys', label: 'Surveys', icon: '▤', pages: ['surveys'] },
  { id: 'data', label: 'Data collection', icon: '☰', pages: ['questions', 'bank', 'review', 'upload', 'data'] },
]

// Super Admin console only (01-PRD.md): platform governance group
const PLATFORM_NAV = {
  id: 'platform',
  label: 'Platform',
  icon: '✦',
  pages: ['audit', 'bank', 'seats'],
}

const PAGE_LABELS = {
  overview: 'Overview',
  report: 'Report',
  analyze: 'Analyze',
  users: 'Users & targets',
  surveys: 'Surveys',
  questions: 'Questions',
  review: 'Review',
  upload: 'Upload',
  data: 'Data',
  audit: 'Audit Log',
  bank: 'Question Bank',
  seats: 'Seat Requests',
}

function formatDate(v) {
  if (!v) return '—'
  try {
    return new Date(v).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return String(v)
  }
}

function Overview({ user, stats, onNav, superAdminOnly = false }) {
  return (
    <div className="portal-page">
      <header className="portal-page-head">
        <div>
          <p className="eyebrow">{superAdminOnly ? 'Super Admin Console' : 'Client Admin'}</p>
          <h1>Overview</h1>
          <p className="portal-lead">
            Welcome, {user?.name || user?.username}. Pipeline: Surveyors → Surveys → Data
            collection → Dashboard.
          </p>
        </div>
      </header>

      <div className="portal-kpi-grid">
        <div className="portal-kpi">
          <strong>{stats?.pending?.toLocaleString?.() ?? '—'}</strong>
          <span>Pending review</span>
        </div>
        <div className="portal-kpi">
          <strong>{stats?.confirmed?.toLocaleString?.() ?? '—'}</strong>
          <span>Confirmed</span>
        </div>
        <div className="portal-kpi">
          <strong>{stats?.submissions?.toLocaleString?.() ?? '—'}</strong>
          <span>All submissions</span>
        </div>
        <div className="portal-kpi">
          <strong>{stats?.districts ?? '—'}</strong>
          <span>Districts in data</span>
        </div>
      </div>

      <div className="portal-action-grid">
        <button type="button" className="portal-action" onClick={() => onNav('users')}>
          <span className="portal-action-n">1</span>
          <strong>Users &amp; targets</strong>
          <span>Create surveyors, set record quotas</span>
        </button>
        <button type="button" className="portal-action" onClick={() => onNav('questions')}>
          <span className="portal-action-n">2</span>
          <strong>Questions bank</strong>
          <span>Field app loads these automatically</span>
        </button>
        <button type="button" className="portal-action" onClick={() => onNav('analyze')}>
          <span className="portal-action-n">3</span>
          <strong>Analyze</strong>
          <span>Charts, maps &amp; filters (confirmed data)</span>
        </button>
        <button type="button" className="portal-action" onClick={() => onNav('review')}>
          <span className="portal-action-n">4</span>
          <strong>Review · edit · confirm</strong>
          <span>Correct answers, delete bad rows, then confirm</span>
        </button>
        <button type="button" className="portal-action primary" onClick={() => onNav('report')}>
          <span className="portal-action-n">5</span>
          <strong>Report</strong>
          <span>Daily / monthly / surveyor tables · geo + voice boards</span>
        </button>
        <button type="button" className="portal-action" onClick={() => onNav('upload')}>
          <span className="portal-action-n">↑</span>
          <strong>Upload / geo</strong>
          <span>CSV &amp; geography inventory</span>
        </button>
      </div>

      <div className="portal-note card">
        <strong>Surveyors = app access only</strong>
        <p>
          Users you create here are for the <strong>mobile/field app only</strong> — they do not
          use this web portal. Give them username/password for the APK (or field app URL). They
          collect offline; you verify and confirm here in
          {superAdminOnly ? ' Super Admin.' : ' Client Admin.'}
        </p>
      </div>
    </div>
  )
}

function DataList({ items, loading, onRefresh, surveys, surveyFilter, onSurveyChange }) {
  return (
    <div className="portal-page">
      <header className="portal-page-head row">
        <div>
          <h1>Raw data</h1>
          <p className="portal-lead">Latest submissions (use Analyze for filters)</p>
        </div>
        <label className="field compact">
          <span>By survey</span>
          <select value={surveyFilter} onChange={(e) => onSurveyChange(e.target.value)}>
            <option value="">All surveys</option>
            {surveys.map((s) => (
              <option key={s.id} value={s.form_key}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn small" onClick={onRefresh} disabled={loading}>
          {loading ? '…' : 'Refresh'}
        </button>
      </header>
      {loading ? (
        <PortalSkeleton rows={5} label="Loading submissions…" />
      ) : !items.length ? (
        <PortalEmpty title="No rows yet">
          Collect from the field app or widen the survey filter.
        </PortalEmpty>
      ) : (
        <ul className="user-list">
          {items.map((it) => {
            const a = it.answers || {}
            const title =
              surveys.find((s) => s.form_key === it.form_key)?.title || it.form_key || 'Survey'
            return (
              <li key={it.id}>
                <div>
                  <strong>
                    #{it.id} · {title}
                  </strong>
                  <span className="meta">
                    {' '}
                    {it.submitted_by || a.data_collector || '—'} · {formatDate(it.created_at)} ·{' '}
                    {it.status || 'pending'}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default function AdminPortal({ superAdminOnly = false }) {
  const [user, setUser] = useState(() => {
    const u = getStoredUser()
    return u &&
      (superAdminOnly
        ? u.role === 'super_admin'
        : u.role === 'admin' || u.role === 'super_admin')
      ? u
      : null
  })
  const [authReady, setAuthReady] = useState(false)
  const [page, setPage] = useState('overview')
  const [stats, setStats] = useState(null)
  const [items, setItems] = useState([])
  const [surveys, setSurveys] = useState([])
  const [surveyFilter, setSurveyFilter] = useState('')
  const [loadingData, setLoadingData] = useState(false)
  const [toast, setToast] = useState(null)
  const [navOpen, setNavOpen] = useState(false)

  const nav = superAdminOnly
    ? [
        PLATFORM_NAV,
        // console keeps Question Bank under Platform only — avoid duplicate subtabs
        ...NAV.map((n) =>
          n.id === 'data' ? { ...n, pages: n.pages.filter((p) => p !== 'bank') } : n
        ),
      ]
    : NAV

  const goPage = useCallback((p) => {
    setPage(p)
    setNavOpen(false)
  }, [])

  const notify = useCallback((message, type = 'ok') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3200)
  }, [])

  const handleLogout = useCallback(async () => {
    await logout()
    setUser(null)
    setStats(null)
    setItems([])
    setSurveys([])
    setPage('overview')
    notify('Logged out', 'ok')
  }, [notify])

  /** Lightweight overview KPIs only — not full submissions */
  const loadStats = useCallback(async () => {
    if (!getToken()) return
    try {
      setStats(await getStats())
    } catch {
      /* ignore */
    }
  }, [])

  /** Raw data tab only */
  const refreshData = useCallback(async () => {
    if (!getToken()) return
    setLoadingData(true)
    try {
      const data = await listSubmissions(150, '', { survey: surveyFilter })
      setItems(data.items || [])
    } catch (e) {
      if (e.status === 401) {
        await handleLogout()
        return
      }
      notify(e.message, 'error')
    } finally {
      setLoadingData(false)
    }
  }, [notify, handleLogout, surveyFilter])

  /** Manual refresh: stats always; raw rows only if on Data tab */
  const loadPortal = useCallback(async () => {
    if (!getToken()) return
    setLoadingData(true)
    try {
      await loadStats()
      if (page === 'data') {
        const data = await listSubmissions(150, '', { survey: surveyFilter })
        setItems(data.items || [])
      }
      notify('Portal data refreshed ✓', 'ok')
    } catch (e) {
      if (e.status === 401) {
        await handleLogout()
        return
      }
      notify(e.message || 'Refresh failed', 'error')
    } finally {
      setLoadingData(false)
    }
  }, [loadStats, page, surveyFilter, notify, handleLogout])

  useEffect(() => {
    let cancelled = false
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setUser(null)
        setAuthReady(true)
      }
    }, 4000)

    ;(async () => {
      if (!getToken()) {
        clearTimeout(timeout)
        if (!cancelled) {
          setUser(null)
          setAuthReady(true)
        }
        return
      }
      try {
        const data = await me()
        const okRole = superAdminOnly
          ? data.user?.role === 'super_admin'
          : data.user?.role === 'admin' || data.user?.role === 'super_admin'
        if (!okRole) {
          await logout()
          if (!cancelled) {
            setUser(null)
            setAuthReady(true)
          }
          return
        }
        if (!cancelled) {
          setUser(data.user)
          setAuthReady(true)
        }
      } catch {
        if (!cancelled) {
          await logout()
          setUser(null)
          setAuthReady(true)
        }
      } finally {
        clearTimeout(timeout)
      }
    })()
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [])

  // Overview: stats only (cheap)
  useEffect(() => {
    if (user && authReady && (page === 'overview' || !stats)) {
      void loadStats()
    }
  }, [user, authReady, page, loadStats]) // eslint-disable-line react-hooks/exhaustive-deps -- load stats on login + overview

  // Data tab: submissions only when open
  useEffect(() => {
    if (user && authReady && page === 'data') {
      void refreshData()
    }
  }, [user, authReady, page, surveyFilter, refreshData])

  // Surveys list only when a page needs the dropdown
  useEffect(() => {
    if (!user || !authReady) return
    if (!['data', 'upload', 'review'].includes(page)) return
    if (surveys.length) return
    listSurveys()
      .then((d) => setSurveys(d.items || []))
      .catch(() => {})
  }, [user, authReady, page, surveys.length])

  if (!authReady) {
    return (
      <div className="portal-shell">
        <div className="portal-login">
          <div className="portal-login-card" style={{ textAlign: 'center' }}>
            <p className="eyebrow">{superAdminOnly ? 'Super Admin Console' : 'Client Admin'}</p>
            <h1 style={{ fontSize: 22 }}>Starting…</h1>
          </div>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="portal-shell">
        {toast && (
          <div className={`toast ${toast.type}`} role="status">
            {toast.message}
          </div>
        )}
        <AdminLogin
          superAdminOnly={superAdminOnly}
          onToast={notify}
          onSuccess={(u) => {
            setUser(u)
            setPage('overview')
          }}
        />
      </div>
    )
  }

  const activeNavLabel =
    nav.find((n) => n.pages.includes(page))?.label || PAGE_LABELS[page] || 'Admin'

  return (
    <div className={`portal-shell${navOpen ? ' nav-open' : ''}`}>
      {toast && (
        <div className={`toast portal-toast ${toast.type}`} role="status">
          {toast.message}
        </div>
      )}

      <header className="portal-topbar">
        <button
          type="button"
          className="portal-menu-btn"
          aria-label={navOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((o) => !o)}
        >
          {navOpen ? '✕' : '☰'}
        </button>
        <div className="portal-topbar-brand">
          <strong>Ground IQ · Admin</strong>
          <span>{activeNavLabel}</span>
        </div>
        <button
          type="button"
          className="btn small"
          disabled={loadingData}
          onClick={() => void loadPortal()}
        >
          {loadingData ? '…' : '↻'}
        </button>
      </header>

      {navOpen ? (
        <button
          type="button"
          className="portal-drawer-backdrop"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <aside className="portal-sidebar" aria-label="Main navigation">
        <div className="portal-sidebar-brand">
          <span className="portal-logo">◆</span>
          <div>
            <strong>Ground IQ</strong>
            <span>{superAdminOnly ? 'Super Admin' : 'Client Admin'}</span>
          </div>
        </div>
        <nav className="portal-nav">
          {nav.map((n) => (
            <button
              key={n.id}
              type="button"
              className={
                n.pages.includes(page) ? 'portal-nav-item active' : 'portal-nav-item'
              }
              onClick={() => goPage(n.pages[0])}
            >
              <span aria-hidden>{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="portal-sidebar-foot">
          <button
            type="button"
            className="btn small"
            style={{
              width: '100%',
              marginBottom: 10,
              fontWeight: 'bold',
              background: '#e2e8f0',
              border: '1px solid #cbd5e1',
              color: '#059669',
              padding: '8px 12px',
              borderRadius: 8,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
            onClick={() => void loadPortal()}
            disabled={loadingData}
          >
            {loadingData ? 'Refreshing…' : '🔄 Refresh Data'}
          </button>
          <div className="portal-user">
            <strong>
              {user.name || user.username}{' '}
              {user.verified ? <VerifiedBadge size={16} title="Verified" /> : null}
              {user.role === 'super_admin' ? ' ★' : ''}
            </strong>
            <span>
              @{user.username} · {user.role === 'super_admin' ? 'Super Admin' : 'Client Admin'}
            </span>
          </div>
          <p className="app-version-foot portal-version" aria-label="App version">
            {versionLabel()}
          </p>
          <a className="portal-link" href="/" target="_blank" rel="noreferrer">
            Field app ↗
          </a>
          <button type="button" className="btn small danger" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </aside>

      <main className="portal-main">
        {nav.filter((n) => n.pages.length > 1 && n.pages.includes(page)).map((n) => (
          <div className="admin-subtabs" key={n.id}>
            {n.pages.map((p) => (
              <button
                key={p}
                type="button"
                className={page === p ? 'map-tab active' : 'map-tab'}
                onClick={() => goPage(p)}
              >
                {PAGE_LABELS[p]}
              </button>
            ))}
          </div>
        ))}
        <Suspense fallback={<PortalSkeleton rows={6} label="Loading screen…" />}>
          {page === 'overview' && (
            <Overview
              user={user}
              stats={stats}
              onNav={goPage}
              superAdminOnly={superAdminOnly}
            />
          )}
          {page === 'users' && <AdminUsersScreen onToast={notify} />}
          {page === 'surveys' && <AdminSurveysScreen onToast={notify} user={user} />}
          {page === 'questions' && <AdminQuestionsScreen onToast={notify} user={user} />}
          {/* Report = tables/boards (AdminAnalyze); Analyze = charts/maps (Dashboard) */}
          {page === 'report' && <AdminAnalyzeScreen onToast={notify} />}
          {page === 'analyze' && <DashboardScreen onToast={notify} />}
          {page === 'review' && <ReviewQAScreen onToast={notify} user={user} />}
          {page === 'upload' && <AdminDataScreen onToast={notify} />}
          {page === 'audit' && <AdminAuditScreen onToast={notify} />}
          {page === 'bank' && <AdminQuestionBankScreen onToast={notify} user={user} />}
          {page === 'seats' && <AdminSeatsScreen onToast={notify} />}
          {page === 'data' && (
            <DataList
              items={items}
              loading={loadingData}
              onRefresh={refreshData}
              surveys={surveys}
              surveyFilter={surveyFilter}
              onSurveyChange={(v) => setSurveyFilter(v)}
            />
          )}
        </Suspense>
      </main>
    </div>
  )
}
