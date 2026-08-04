import { useCallback, useEffect, useState } from 'react'
import {
  getStats,
  getStoredUser,
  getToken,
  listSubmissions,
  logout,
  me,
} from './api'
import AdminLogin from './AdminLogin'
import AdminUsersScreen from './AdminUsers'
import AdminSurveysScreen from './AdminSurveys'
import AdminQuestionsScreen from './AdminQuestions'
import AdminAnalyzeScreen from './AdminAnalyze'
import ReviewQAScreen from './ReviewQA'
import DashboardScreen from './Dashboard'
import AdminDataScreen from './AdminData'
import { versionLabel } from './version'
import './App.css'
import './portal.css'

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '◈', pages: ['overview', 'report', 'analyze'] },
  { id: 'surveyors', label: 'Surveyors', icon: '👤', pages: ['users'] },
  { id: 'surveys', label: 'Surveys', icon: '▤', pages: ['surveys'] },
  { id: 'data', label: 'Data collection', icon: '☰', pages: ['questions', 'review', 'upload', 'data'] },
]

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

function Overview({ user, stats, onNav }) {
  return (
    <div className="portal-page">
      <header className="portal-page-head">
        <div>
          <p className="eyebrow">Client Admin</p>
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
          <span>By user, day, month · geo + voice checks</span>
        </button>
        <button type="button" className="portal-action" onClick={() => onNav('review')}>
          <span className="portal-action-n">4</span>
          <strong>Review · edit · confirm</strong>
          <span>Correct answers, delete bad rows, then confirm</span>
        </button>
        <button type="button" className="portal-action primary" onClick={() => onNav('report')}>
          <span className="portal-action-n">5</span>
          <strong>Report dashboard</strong>
          <span>Charts form after confirm only</span>
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
          collect offline; you verify and confirm here in Client Admin.
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
        <p className="muted">Loading…</p>
      ) : !items.length ? (
        <div className="card">
          <p className="muted">No rows yet.</p>
        </div>
      ) : (
        <ul className="user-list">
          {items.map((it) => {
            const a = it.answers || {}
            const title = surveys.find((s) => s.form_key === it.form_key)?.title || it.form_key || 'Survey'
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

export default function AdminPortal() {
  const [user, setUser] = useState(() => {
    const u = getStoredUser()
    return u?.role === 'admin' ? u : null
  })
  const [authReady, setAuthReady] = useState(false)
  const [page, setPage] = useState('overview')
  const [stats, setStats] = useState(null)
  const [items, setItems] = useState([])
  const [surveys, setSurveys] = useState([])
  const [surveyFilter, setSurveyFilter] = useState('')
  const [loadingData, setLoadingData] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    import('./api').then(({ listSurveys }) =>
      listSurveys()
        .then((d) => setSurveys(d.items || []))
        .catch(() => {}),
    )
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
    setPage('overview')
    notify('Logged out', 'ok')
  }, [notify])

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

  const loadPortal = useCallback(async () => {
    if (!getToken()) return
    try {
      setStats(await getStats())
    } catch {
      /* ignore */
    }
    await refreshData()
  }, [refreshData])

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
        if (data.user?.role !== 'admin') {
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

  useEffect(() => {
    if (user && authReady) loadPortal()
  }, [user, authReady, loadPortal])

  if (!authReady) {
    return (
      <div className="portal-shell">
        <div className="portal-login">
          <div className="portal-login-card" style={{ textAlign: 'center' }}>
            <p className="eyebrow">Client Admin</p>
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
          onToast={notify}
          onSuccess={(u) => {
            setUser(u)
            setPage('overview')
          }}
        />
      </div>
    )
  }

  return (
    <div className="portal-shell">
      {toast && (
        <div className={`toast portal-toast ${toast.type}`} role="status">
          {toast.message}
        </div>
      )}

      <aside className="portal-sidebar">
        <div className="portal-sidebar-brand">
          <span className="portal-logo">◆</span>
          <div>
            <strong>Ground IQ</strong>
            <span>Client Admin</span>
          </div>
        </div>
        <nav className="portal-nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={
                n.pages.includes(page) ? 'portal-nav-item active' : 'portal-nav-item'
              }
              onClick={() => setPage(n.pages[0])}
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
              background: '#1e293b',
              border: '1px solid #334155',
              color: '#00e599',
              padding: '8px 12px',
              borderRadius: 8,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
            onClick={() => {
              loadPortal()
              notify('Portal data refreshed ✓', 'ok')
            }}
            disabled={loadingData}
          >
            {loadingData ? 'Refreshing…' : '🔄 Refresh Data'}
          </button>
          <div className="portal-user">
            <strong>{user.name || user.username}</strong>
            <span>@{user.username}</span>
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
        {NAV.filter((n) => n.pages.length > 1 && n.pages.includes(page)).map((n) => (
          <div className="admin-subtabs" key={n.id}>
            {n.pages.map((p) => (
              <button
                key={p}
                type="button"
                className={page === p ? 'map-tab active' : 'map-tab'}
                onClick={() => setPage(p)}
              >
                {PAGE_LABELS[p]}
              </button>
            ))}
          </div>
        ))}
        {page === 'overview' && <Overview user={user} stats={stats} onNav={setPage} />}
        {page === 'users' && <AdminUsersScreen onToast={notify} />}
        {page === 'surveys' && <AdminSurveysScreen onToast={notify} />}
        {page === 'questions' && <AdminQuestionsScreen onToast={notify} />}
        {page === 'analyze' && <AdminAnalyzeScreen onToast={notify} />}
        {page === 'review' && <ReviewQAScreen onToast={notify} />}
        {page === 'report' && <DashboardScreen onToast={notify} />}
        {page === 'upload' && <AdminDataScreen onToast={notify} />}
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
      </main>
    </div>
  )
}
