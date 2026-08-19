import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icons'
import {
  clearSession,
  getStats,
  getStoredUser,
  getToken,
  listSubmissions,
  listSurveys,
  listUsers,
  logout,
  me,
} from './api'
import AdminLogin from './AdminLogin'
import VerifiedBadge from './VerifiedBadge'
import { PortalEmpty, PortalSkeleton } from './PortalUI'
import AdminBell from './AdminBell'
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
const AdminClientAdminsScreen = lazy(() => import('./AdminClientAdmins'))
const AdminCompaniesScreen = lazy(() => import('./AdminCompanies'))

// Client Admin nav — they create Surveys (Super Admin creates Projects separately)
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid', pages: ['overview', 'report', 'analyze'] },
  { id: 'surveyors', label: 'Surveyors', icon: 'user', pages: ['users'] },
  { id: 'surveys', label: 'Surveys', icon: 'clipboard', pages: ['surveys'] },
  { id: 'data', label: 'Data collection', icon: 'menu', pages: ['questions', 'bank', 'review', 'upload', 'data'] },
]

// Super Admin console only (01-PRD.md): platform governance group
const PLATFORM_NAV = {
  id: 'platform',
  label: 'Platform',
  icon: 'star',
  pages: ['audit', 'bank', 'seats'],
}

// Super Admin console only: dedicated Client Admin account management
const CLIENT_ADMINS_NAV = {
  id: 'admins',
  label: 'Client Admins',
  icon: 'shield',
  pages: ['admins'],
}

// Super Admin console only: companies registry (create companies, add Client Admins)
const COMPANIES_NAV = {
  id: 'companies',
  label: 'Companies',
  icon: 'building',
  pages: ['companies'],
}

// Super Admin creates Projects (shared with Client Admins by company).
const PROJECTS_NAV = {
  id: 'projects',
  label: 'Projects',
  icon: 'clipboard',
  pages: ['surveys'],
}

const PAGE_LABELS = {
  overview: 'Overview',
  report: 'Report',
  analyze: 'Analyze',
  users: 'Users & targets',
  // Client Admin label; Super Admin sidebar uses PROJECTS_NAV ("Projects")
  surveys: 'Surveys',
  questions: 'Questions',
  review: 'Review',
  upload: 'Upload',
  data: 'Data',
  audit: 'Audit Log',
  bank: 'Question Bank',
  seats: 'Seat Requests',
  admins: 'Client Admins',
  companies: 'Companies',
}

// Which Super-Admin-granted power unlocks each management page for a Client Admin.
// Surveys = Client Admin creates field surveys (can_crud_questionnaire).
// Super Admin uses the same screen for Projects (always allowed).
// Surveyors is always available to Client Admin (BR-004).
const PAGE_POWER = {
  surveys: ['can_crud_questionnaire', 'can_edit_surveys'],
  questions: 'can_edit_surveys',
  bank: 'can_manage_questions',
  review: 'can_review_data',
  upload: 'can_validate_proof',
  data: 'can_validate_proof',
}

/**
 * Catches lazy chunk load failures (stale cached bundle → removed hashed chunk
 * returns 404). Auto-recovers by reloading once so the fresh index.html is
 * served; a cooldown prevents reload loops if the chunk keeps failing.
 */
class ChunkErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false, reloading: false }
  }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error) {
    const isChunk =
      String(error?.message || '').includes('dynamically imported module') ||
      String(error?.message || '').includes('Loading chunk') ||
      String(error?.name || '').includes('ChunkLoadError')
    if (!isChunk || this.state.reloading) return
    let last = 0
    try {
      last = Number(localStorage.getItem('esurvey_chunk_reload') || 0)
    } catch {
      /* ignore */
    }
    if (Date.now() - last < 30_000) return // recently tried — show the manual card instead
    this.setState({ reloading: true })
    try {
      localStorage.setItem('esurvey_chunk_reload', Date.now().toString())
    } catch {
      /* ignore */
    }
    setTimeout(() => window.location.reload(), 350)
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="portal-page">
          <div className="card" style={{ padding: 24, textAlign: 'center' }}>
            <h3>{this.state.reloading ? 'Reloading…' : 'This screen could not be loaded'}</h3>
            {!this.state.reloading && (
              <p className="muted">A new version may have been deployed. Reload to continue.</p>
            )}
            {!this.state.reloading && (
              <button
                type="button"
                className="btn primary"
                onClick={() => window.location.reload()}
              >
                Reload now
              </button>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
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

/**
 * Client Admin allocation card — shows the logged-in admin's own usage vs the
 * caps Super Admin set on their profile (surveys / surveyors / questions per survey).
 * Loads from /api/auth/me (preferred) then GET /api/users as fallback.
 */
function AllocationCard({ user }) {
  const [self, setSelf] = useState(null)
  const [err, setErr] = useState('')
  const [resolved, setResolved] = useState(false)

  useEffect(() => {
    let cancelled = false
    setResolved(false)
    setErr('')

    async function load() {
      // 1) /api/auth/me includes live counts for Client Admin
      try {
        const d = await me()
        if (cancelled) return
        if (d?.user && Number(d.user.id) === Number(user?.id)) {
          setSelf(d.user)
          setResolved(true)
          return
        }
      } catch {
        /* fall through */
      }
      // 2) GET /api/users — self row is included for Client Admin (id = me)
      try {
        const d = await listUsers()
        if (cancelled) return
        const row = (d.users || []).find((u) => Number(u.id) === Number(user?.id))
        if (row) {
          setSelf(row)
          setResolved(true)
          return
        }
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Failed to load allocation')
      }
      // 3) Session user at least shows Super-Admin-set caps (counts may be 0)
      if (!cancelled) {
        setSelf(
          user
            ? {
                ...user,
                survey_count: user.survey_count ?? 0,
                surveyor_count: user.surveyor_count ?? 0,
                question_count: user.question_count ?? 0,
                survey_team: user.survey_team || [],
                granted_surveys: user.granted_surveys || [],
              }
            : null,
        )
        setResolved(true)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [user?.id, user?.max_surveys, user?.max_surveyors, user?.max_questions_per_survey, user?.max_records])

  if (err && !self) {
    return (
      <div className="card" style={{ marginTop: 14 }}>
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="chart" size={16} /> My allocation</h3>
        <p className="muted" style={{ margin: 0 }}>{err}</p>
      </div>
    )
  }
  if (!self) {
    return (
      <div className="card" style={{ marginTop: 14 }}>
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="chart" size={16} /> My allocation</h3>
        <p className="muted" style={{ margin: 0 }}>
          {resolved ? 'Allocation data not available yet — refresh the page.' : 'Loading…'}
        </p>
      </div>
    )
  }

  const maxSurveys = Number(self.max_surveys ?? user?.max_surveys) || 0
  const maxSurveyors = Number(self.max_surveyors ?? user?.max_surveyors) || 0
  const maxQ = Number(self.max_questions_per_survey ?? user?.max_questions_per_survey) || 0
  const maxRecords = Number(self.max_records ?? user?.max_records) || 0
  const recordUsed = Number(
    self.record_count ?? self.surveyor_record_count ?? user?.record_count ?? 0,
  )
  const fmt = (used, cap) => `${used ?? 0} / ${cap > 0 ? cap : '∞'}`
  const team = Array.isArray(self.survey_team) ? self.survey_team : []
  const features = [
    self.can_crud_questionnaire && 'Create surveys',
    self.can_edit_surveys && 'Survey questions',
    self.can_manage_questions && 'Question bank',
    self.can_assign_surveyors && 'Assign surveyors',
    self.can_review_data && 'Review data',
    self.can_verify_surveyors && 'Verify surveyors',
    self.can_validate_proof && 'Validate proof',
  ].filter(Boolean)

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="chart" size={16} /> My allocation (created / Super Admin limit)</h3>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
        Limits come from your Client Admin profile (set by Super Admin). 0 = unlimited.
      </p>
      <div className="stat-row" style={{ marginBottom: 10 }}>
        <div className="stat">
          <strong>{fmt(self.survey_count, maxSurveys)}</strong>
          <span>Surveys</span>
        </div>
        <div className="stat">
          <strong>{fmt(self.surveyor_count, maxSurveyors)}</strong>
          <span>Surveyors</span>
        </div>
        <div className="stat">
          <strong>{fmt(self.question_count, maxQ)}</strong>
          <span>Questions in largest survey</span>
        </div>
        <div className="stat">
          <strong>{fmt(recordUsed, maxRecords)}</strong>
          <span>
            Records allotted
            {maxRecords > 0 ? ` · ${Math.max(0, maxRecords - recordUsed)} left` : ''}
          </span>
        </div>
      </div>
      {maxRecords > 0 && recordUsed >= maxRecords && (
        <p style={{ fontSize: 12, margin: '0 0 10px', color: '#b45309' }}>
          Record limit reached ({recordUsed} / {maxRecords}). Surveyors cannot submit more until Super
          Admin raises the cap.
        </p>
      )}
      {maxQ > 0 && Number(self.question_count || 0) === 0 && (
        <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
          No questions detected yet — open <strong>Surveys</strong> or <strong>Questions</strong> and
          save questions on a survey. Cap is {maxQ} questions per survey (Super Admin).
        </p>
      )}
      {maxQ > 0 && Number(self.question_count || 0) > maxQ && (
        <p style={{ fontSize: 12, margin: '0 0 10px', color: '#b45309' }}>
          Peak {self.question_count} exceeds your limit of {maxQ}. Remove questions or ask Super Admin
          to raise the cap.
        </p>
      )}
      {features.length > 0 && (
        <p style={{ fontSize: 12, margin: '0 0 10px' }}>
          <strong>Features on:</strong>{' '}
          <span className="muted">{features.join(' · ')}</span>
        </p>
      )}
      <h4 style={{ fontSize: 13, margin: '8px 0 8px' }}>🗺 Survey → Surveyor mapping</h4>
      {team.length > 0 ? (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {team.map((s) => (
            <li key={s.id} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                📋 {s.title}
                {s.question_count != null ? (
                  <span className="muted" style={{ fontWeight: 500, marginLeft: 8 }}>
                    · {s.question_count} Q
                  </span>
                ) : null}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                {Array.isArray(s.surveyors) && s.surveyors.length > 0
                  ? `👥 ${s.surveyors.map((x) => x.name || x.username).join(', ')}`
                  : '👥 No surveyors mapped yet'}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          No surveys yet — create surveys first, then map surveyors to them.
        </p>
      )}
      {Array.isArray(self.granted_surveys) && self.granted_surveys.length > 0 && (
        <>
          <h4 style={{ fontSize: 13, margin: '14px 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="link" size={13} /> Connected projects (shared by Super Admin)</h4>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {self.granted_surveys.map((s) => (
              <li key={s.id} style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: '8px 10px' }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: '#5b21b6', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="link" size={13} /> {s.title}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted" style={{ fontSize: 11, margin: '8px 0 0' }}>
        Caps are set by Super Admin on your profile. Creating past a limit is blocked until Super Admin
        raises it. Only your own surveys and surveyors are shown.
      </p>
    </div>
  )
}

function Overview({ user, stats, onNav, superAdminOnly = false, canPage = () => true }) {
  const gated = (p) => {
    // Super Admin (or console mode) always sees every feature
    if (superAdminOnly || user?.role === 'super_admin') return true
    return canPage(p)
  }
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
        {!superAdminOnly && user?.role !== 'super_admin' && (
          <div className="portal-kpi">
            <strong>
              {Number(user?.record_count ?? user?.surveyor_record_count) || 0}
              {' / '}
              {Number(user?.max_records) > 0 ? Number(user.max_records) : '∞'}
            </strong>
            <span>Records allotted</span>
          </div>
        )}
      </div>

      <div className="portal-action-grid">
        {gated('users') && (
          <button type="button" className="portal-action" onClick={() => onNav('users')}>
            <span className="portal-action-n">1</span>
            <strong>Users &amp; targets</strong>
            <span>Create surveyors, set record quotas</span>
          </button>
        )}
        {gated('questions') && (
          <button type="button" className="portal-action" onClick={() => onNav('questions')}>
            <span className="portal-action-n">2</span>
            <strong>Questions bank</strong>
            <span>Field app loads these automatically</span>
          </button>
        )}
        {gated('analyze') && (
          <button type="button" className="portal-action" onClick={() => onNav('analyze')}>
            <span className="portal-action-n">3</span>
            <strong>Analyze</strong>
            <span>Charts, maps &amp; filters (confirmed data)</span>
          </button>
        )}
        {gated('review') && (
          <button type="button" className="portal-action" onClick={() => onNav('review')}>
            <span className="portal-action-n">4</span>
            <strong>Review · edit · confirm</strong>
            <span>Correct answers, delete bad rows, then confirm</span>
          </button>
        )}
        {gated('report') && (
          <button type="button" className="portal-action primary" onClick={() => onNav('report')}>
            <span className="portal-action-n">5</span>
            <strong>Report</strong>
            <span>Daily / monthly / surveyor tables · geo + voice boards</span>
          </button>
        )}
        {gated('upload') && (
          <button type="button" className="portal-action" onClick={() => onNav('upload')}>
            <span className="portal-action-n">↑</span>
            <strong>Upload / geo</strong>
            <span>CSV &amp; geography inventory</span>
          </button>
        )}
      </div>

      {!superAdminOnly && user?.role !== 'super_admin' && <AllocationCard user={user} />}

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
  const [deepLink, setDeepLink] = useState(null)

  // Super Admin always has every power; Client Admins only see pages their granted powers unlock.
  const canPage = useCallback(
    (p) => {
      if (user?.role === 'super_admin') return true
      const need = PAGE_POWER[p]
      if (!need) return true
      const needs = Array.isArray(need) ? need : [need]
      return needs.some((k) => !!user?.[k])
    },
    [user]
  )

  const baseNav = superAdminOnly
    ? [
        CLIENT_ADMINS_NAV,
        COMPANIES_NAV,
        PROJECTS_NAV,
        PLATFORM_NAV,
        // console keeps Question Bank under Platform only — avoid duplicate subtabs
        ...NAV
          .filter((n) => n.id !== 'surveys')
          .map((n) => (n.id === 'data' ? { ...n, pages: n.pages.filter((p) => p !== 'bank') } : n)),
      ]
    : NAV
  const nav = baseNav
    .map((n) => ({ ...n, pages: n.pages.filter(canPage) }))
    .filter((n) => n.pages.length > 0)

  const toastTimer = useRef(0)
  const notify = useCallback((message, type = 'ok') => {
    setToast({ message, type })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3200)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const goPage = useCallback((p, extra = null) => {
    const src = typeof p === 'string' ? { page: p } : p && typeof p === 'object' ? p : null
    const raw = src?.page
    const pageId = raw && PAGE_LABELS[raw] ? raw : null
    if (!pageId) {
      notify('Could not open that notification', 'error')
      return
    }
    if (!canPage(pageId)) {
      notify('You do not have access to that page', 'error')
      setPage('overview')
      setDeepLink(null)
      setNavOpen(false)
      return
    }
    setPage(pageId)
    setNavOpen(false)
    const userId = src.userId ?? extra?.userId ?? null
    const submissionId = src.submissionId ?? extra?.submissionId ?? null
    if (userId != null || submissionId != null) {
      setDeepLink({ page: pageId, userId, submissionId })
    } else if (extra) {
      setDeepLink({ page: pageId, ...extra })
    } else {
      setDeepLink(null)
    }
  }, [canPage, notify])

  const handleLogout = useCallback(async () => {
    await logout()
    setUser(null)
    setStats(null)
    setItems([])
    setSurveys([])
    setPage('overview')
    notify('Logged out', 'ok')
  }, [notify])

  useEffect(() => {
    const onUnauthorized = (e) => {
      clearSession()
      setUser(null)
      setStats(null)
      setItems([])
      setSurveys([])
      setPage('overview')
      const msg = e?.detail?.error || 'Account updated or session expired — please sign in again'
      notify(msg, 'error')
    }
    window.addEventListener('esurvey-unauthorized', onUnauthorized)
    return () => window.removeEventListener('esurvey-unauthorized', onUnauthorized)
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
      const meRes = await me().catch(() => null)
      if (meRes?.user) setUser(meRes.user)
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

  // Overview: stats only (cheap) — auto-refresh so field completions show up
  useEffect(() => {
    if (user && authReady && (page === 'overview' || !stats)) {
      void loadStats()
    }
  }, [user, authReady, page, loadStats]) // eslint-disable-line react-hooks/exhaustive-deps -- load stats on login + overview

  useEffect(() => {
    if (!user || !authReady || page !== 'overview') return undefined
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      void loadStats()
    }
    const id = setInterval(tick, 25_000)
    const onVis = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [user, authReady, page, loadStats])

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

      <div className="admin-bell-dock">
        <AdminBell user={user} onGoPage={goPage} />
      </div>

      <header className="portal-topbar">
        <button
          type="button"
          className="portal-menu-btn"
          aria-label={navOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((o) => !o)}
        >
          {navOpen ? <Icon name="cross" size={18} /> : <Icon name="menu" size={18} />}
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
              <span aria-hidden><Icon name={n.icon} size={17} /></span>
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
              {user.role === 'super_admin' ? <Icon name="star" size={13} /> : ''}
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
          <ChunkErrorBoundary>
          {(page === 'overview' || !canPage(page) || !PAGE_LABELS[page]) && (
            <Overview
              user={user}
              stats={stats}
              onNav={goPage}
              superAdminOnly={superAdminOnly}
              canPage={canPage}
            />
          )}
          {page === 'users' && canPage('users') && (
            <AdminUsersScreen
              onToast={notify}
              user={user}
              focusUserId={deepLink?.page === 'users' ? deepLink.userId : null}
              onFocusConsumed={() => setDeepLink(null)}
            />
          )}
          {page === 'surveys' && canPage('surveys') && (
            <AdminSurveysScreen onToast={notify} user={user} />
          )}
          {page === 'questions' && canPage('questions') && (
            <AdminQuestionsScreen onToast={notify} user={user} />
          )}
          {/* Report = tables/boards (AdminAnalyze); Analyze = charts/maps (Dashboard) */}
          {page === 'report' && canPage('report') && <AdminAnalyzeScreen onToast={notify} />}
          {page === 'analyze' && canPage('analyze') && <DashboardScreen onToast={notify} />}
          {page === 'review' && canPage('review') && (
            <ReviewQAScreen
              onToast={notify}
              user={user}
              focusSubmissionId={deepLink?.page === 'review' ? deepLink.submissionId : null}
              onFocusConsumed={() => setDeepLink(null)}
            />
          )}
          {page === 'upload' && canPage('upload') && <AdminDataScreen onToast={notify} />}
          {page === 'audit' && canPage('audit') && <AdminAuditScreen onToast={notify} />}
          {page === 'bank' && canPage('bank') && (
            <AdminQuestionBankScreen onToast={notify} user={user} />
          )}
          {page === 'seats' && canPage('seats') && <AdminSeatsScreen onToast={notify} />}
          {page === 'admins' && canPage('admins') && (
            <AdminClientAdminsScreen onToast={notify} />
          )}
          {page === 'companies' && canPage('companies') && (
            <AdminCompaniesScreen onToast={notify} onNav={goPage} />
          )}
          {page === 'data' && canPage('data') && (
            <DataList
              items={items}
              loading={loadingData}
              onRefresh={refreshData}
              surveys={surveys}
              surveyFilter={surveyFilter}
              onSurveyChange={(v) => setSurveyFilter(v)}
            />
          )}
          </ChunkErrorBoundary>
        </Suspense>
      </main>
    </div>
  )
}
