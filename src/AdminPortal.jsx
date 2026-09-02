import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icons'
import {
  clearSession,
  apkDownloadUrl,
  getStats,
  getStoredUser,
  getToken,
  listSubmissions,
  listSurveys,
  listUsers,
  logout,

  me,
} from './api'
import ShareAppLink from './components/ShareAppLink'
import AdminLogin from './AdminLogin'
import VerifiedBadge from './VerifiedBadge'
import { PortalEmpty, PortalSkeleton } from './PortalUI'
import AdminBell from './AdminBell'
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
const AdminWebSurveyScreen = lazy(() => import('./AdminWebSurvey'))
const AdminProfileScreen = lazy(() => import('./AdminProfile'))

// Matches the sidebar: each group’s `pages` become the subtabs on that screen.
const NAV = [
  { id: 'overview', label: 'Dashboard', icon: 'grid', pages: ['overview'] },
  { id: 'analyze', label: 'Analyze & Export', icon: 'chart', pages: ['analyze', 'report', 'upload', 'data'] },
  { id: 'review', label: 'Review QA', icon: 'check', pages: ['review'] },
  { id: 'surveyors', label: 'Surveyors', icon: 'user', pages: ['users'] },
  { id: 'surveys', label: 'Surveys & Forms', icon: 'clipboard', pages: ['surveys', 'questions', 'web', 'bank'] },
  { id: 'profile', label: 'Organization', icon: 'building', pages: ['profile'] },
]

const PLATFORM_NAV = {
  id: 'platform',
  label: 'Seats & Audit',
  icon: 'star',
  pages: ['audit', 'seats'],
}

const CLIENT_ADMINS_NAV = {
  id: 'admins',
  label: 'Client Admins',
  icon: 'shield',
  pages: ['admins'],
}

const COMPANIES_NAV = {
  id: 'companies',
  label: 'Companies',
  icon: 'building',
  pages: ['companies'],
}

const PAGE_LABELS = {
  overview: 'Overview',
  analyze: 'Charts',
  report: 'Live Feed',
  users: 'Surveyors',
  surveys: 'Surveys',
  questions: 'Questions',
  review: 'Review',
  upload: 'Export',
  data: 'Raw data',
  audit: 'Audit Log',
  bank: 'Question Bank',
  web: 'Web survey',
  seats: 'Seat Requests',
  profile: 'Organization',
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
  // Copy public fill link is available with Surveys. In-portal fill still checks can_web_survey on the API.
  web: ['can_web_survey', 'can_crud_questionnaire', 'can_edit_surveys'],
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

function Overview({ user, stats, onNav, superAdminOnly = false, canPage = () => true, onToast }) {
  const isSuper = superAdminOnly || user?.role === 'super_admin'
  const gated = (p) => {
    // Super Admin (or console mode) always sees every feature
    if (isSuper) return true
    return canPage(p)
  }

  const [recentItems, setRecentItems] = useState([])
  const [totalAllocations, setTotalAllocations] = useState(null)
  const [loadingRecent, setLoadingRecent] = useState(true)
  const [activityFilter, setActivityFilter] = useState('all')

  const allotCap = Number(user?.max_records) || 0
  const allotUsed = Number(stats?.confirmed ?? stats?.submissions ?? user?.record_count ?? user?.surveyor_record_count) || 0
  const allotLeft = allotCap > 0 ? Math.max(0, allotCap - allotUsed) : null
  const allotPct = allotCap > 0 ? Math.min(100, Math.round((allotUsed / allotCap) * 100)) : 0

  useEffect(() => {
    let alive = true
    listSubmissions(10, '')
      .then((d) => {
        if (alive) setRecentItems(d.items || [])
      })
      .catch(() => {
        if (alive) setRecentItems([])
      })
      .finally(() => {
        if (alive) setLoadingRecent(false)
      })

    listUsers()
      .then((d) => {
        if (!alive) return
        const surveyors = d.users || d.surveyors || d || []
        const total = surveyors.reduce((sum, u) => sum + (Number(u.target) || 0), 0)
        setTotalAllocations(total)
      })
      .catch(() => {})

    return () => {
      alive = false
    }
  }, [stats?.submissions])

  const pendingCount = recentItems.filter((i) => (i.status || 'pending') === 'pending').length
  const confirmedCount = recentItems.filter((i) => i.status === 'confirmed').length
  const rejectedCount = recentItems.filter((i) => i.status === 'rejected').length

  const displayedItems = recentItems.filter((it) => {
    if (activityFilter === 'all') return true
    const st = it.status || 'pending'
    return st === activityFilter
  })


  return (
    <div className="portal-page">
      <header className="portal-page-head">
        <div>
          <p className="eyebrow">{superAdminOnly ? 'Super Admin Console' : 'Client Admin'}</p>
          <h1>Overview</h1>
          <p className="portal-lead">
            Welcome, {user?.name || user?.username} · Google + Twitter data review pipeline
          </p>
        </div>
      </header>

      {!isSuper && <ShareAppLink onToast={onToast} />}

      {/* Quota Allocation Banner for Client Admin */}
      {!isSuper && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            padding: '14px 16px',
            background: 'linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%)',
            border: '1px solid #bbf7d0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Used / Allocated
              </div>
              <strong style={{ fontSize: 18, color: '#0f172a' }}>
                {allotCap > 0 ? (
                  <>
                    <span style={{ color: '#059669' }}>{allotUsed}</span> of {allotCap.toLocaleString()} used
                  </>
                ) : (
                  <>
                    <span style={{ color: '#059669' }}>{allotUsed}</span> used (Unlimited allocated)
                  </>
                )}
              </strong>
            </div>
            {allotCap > 0 && (
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: allotLeft === 0 ? '#dc2626' : '#059669' }}>
                  {allotLeft.toLocaleString()} remaining
                </span>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  {allotPct}% quota consumed
                </div>
              </div>
            )}
          </div>

          {allotCap > 0 && (
            <div style={{ height: 8, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${allotPct}%`,
                  height: '100%',
                  background: allotPct >= 100 ? '#dc2626' : allotPct >= 80 ? '#f59e0b' : '#059669',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* KPI tiles — Mock 3 style with Total Allocations and Rejected */}
      <div className="portal-kpi-grid">
        <button type="button" className="portal-kpi" onClick={() => onNav('review')}>
          <strong>{stats?.pending?.toLocaleString?.() ?? '—'}</strong>
          <span>Pending review</span>
        </button>
        <button type="button" className="portal-kpi" onClick={() => onNav(gated('review') ? 'review' : 'analyze')}>
          <strong>{stats?.confirmed?.toLocaleString?.() ?? '—'}</strong>
          <span>Confirmed</span>
        </button>
        <button type="button" className="portal-kpi" onClick={() => onNav('review')}>
          <strong style={{ color: (stats?.rejected || 0) > 0 ? '#ef4444' : undefined }}>
            {(stats?.rejected != null
              ? stats.rejected
              : stats?.submissions != null && stats?.confirmed != null && stats?.pending != null
                ? Math.max(0, stats.submissions - stats.confirmed - stats.pending)
                : 0
            ).toLocaleString()}
          </strong>
          <span>Rejected</span>
        </button>
        <button type="button" className="portal-kpi" onClick={() => onNav('review')}>
          <strong>{stats?.submissions?.toLocaleString?.() ?? '—'}</strong>
          <span>All submissions</span>
        </button>
        <button type="button" className="portal-kpi" onClick={() => onNav('users')}>
          <strong>
            {allotCap > 0
              ? `${allotUsed} / ${allotCap.toLocaleString()}`
              : (totalAllocations != null ? totalAllocations.toLocaleString() : (stats?.total_target?.toLocaleString?.() ?? '—'))}
          </strong>
          <span>{allotCap > 0 ? 'Used / Allocated' : 'Total Allocations'}</span>
        </button>
        <div className="portal-kpi">
          <strong>{stats?.districts ?? '—'}</strong>
          <span>Districts in data</span>
        </div>
      </div>



      {/* Mixed Live Intake & Activity Stream — Mock 3 doctrine */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 6 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Live Activity &amp; Intake Stream</h3>
            <p className="csub" style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
              Real-time submission flow · Pending review, Confirmed &amp; Rejected
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', padding: 3, borderRadius: 8 }}>
              <button
                type="button"
                onClick={() => setActivityFilter('all')}
                style={{
                  border: 0,
                  background: activityFilter === 'all' ? '#ffffff' : 'transparent',
                  color: activityFilter === 'all' ? '#0f172a' : '#64748b',
                  fontWeight: activityFilter === 'all' ? 700 : 500,
                  fontSize: 11,
                  padding: '4px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  boxShadow: activityFilter === 'all' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                All ({recentItems.length})
              </button>
              <button
                type="button"
                onClick={() => setActivityFilter('pending')}
                style={{
                  border: 0,
                  background: activityFilter === 'pending' ? '#ffffff' : 'transparent',
                  color: activityFilter === 'pending' ? '#d97706' : '#64748b',
                  fontWeight: activityFilter === 'pending' ? 700 : 500,
                  fontSize: 11,
                  padding: '4px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  boxShadow: activityFilter === 'pending' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                Pending ({pendingCount})
              </button>
              <button
                type="button"
                onClick={() => setActivityFilter('confirmed')}
                style={{
                  border: 0,
                  background: activityFilter === 'confirmed' ? '#ffffff' : 'transparent',
                  color: activityFilter === 'confirmed' ? '#16a34a' : '#64748b',
                  fontWeight: activityFilter === 'confirmed' ? 700 : 500,
                  fontSize: 11,
                  padding: '4px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  boxShadow: activityFilter === 'confirmed' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                Confirmed ({confirmedCount})
              </button>
              <button
                type="button"
                onClick={() => setActivityFilter('rejected')}
                style={{
                  border: 0,
                  background: activityFilter === 'rejected' ? '#ffffff' : 'transparent',
                  color: activityFilter === 'rejected' ? '#ef4444' : '#64748b',
                  fontWeight: activityFilter === 'rejected' ? 700 : 500,
                  fontSize: 11,
                  padding: '4px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  boxShadow: activityFilter === 'rejected' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                Rejected ({rejectedCount})
              </button>
            </div>
            {gated('review') && (
              <button
                type="button"
                className="btn small"
                onClick={() => onNav('review')}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#1d6fe0',
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: 6,
                  padding: '5px 12px',
                  cursor: 'pointer',
                }}
              >
                Open Review →
              </button>
            )}
          </div>
        </div>

        {loadingRecent ? (
          <p className="muted" style={{ fontSize: 13, margin: '14px 0 8px' }}>Loading live stream…</p>
        ) : displayedItems.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: '14px 0 8px' }}>No submissions matching this filter.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {displayedItems.map((it) => {
              const a = it.answers || {}
              const surveyor = it.submitted_by || a.data_collector || 'Field Surveyor'
              const district = a.district || a.constituency || 'General'
              const respondent = a.respondent_name || a.name || 'Respondent'
              const status = it.status || 'pending'
              const timeStr = it.created_at ? new Date(it.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '9:32 AM'

              return (
                <div
                  key={it.id}
                  onClick={() => onNav('review')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '12px 16px',
                    background: status === 'pending' ? '#ffffff' : '#f8fafc',
                    border: `1px solid ${status === 'pending' ? '#e2e8f0' : '#e2e8f0'}`,
                    borderLeft: `3px solid ${status === 'confirmed' ? '#16a34a' : status === 'rejected' ? '#ef4444' : '#f59e0b'}`,
                    borderRadius: 10,
                    cursor: 'pointer',
                    transition: 'all 120ms ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>
                      #{it.record_index || it.id}
                    </span>
                    <span style={{ fontSize: 13, color: '#334155', fontWeight: 500 }}>
                      {district} · {respondent} · {timeStr} · <span style={{ color: '#64748b' }}>by {surveyor}</span>
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '3px 10px',
                        borderRadius: 6,
                        background: status === 'confirmed' ? '#f0fdf4' : status === 'rejected' ? '#fef2f2' : '#fffbeb',
                        color: status === 'confirmed' ? '#16a34a' : status === 'rejected' ? '#ef4444' : '#f59e0b',
                        textTransform: 'capitalize',
                      }}
                    >
                      {status}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onNav('review')
                      }}
                      style={{
                        border: '1px solid #bfdbfe',
                        background: status === 'pending' ? '#eff6ff' : '#ffffff',
                        color: '#1d6fe0',
                        fontSize: 12,
                        fontWeight: 600,
                        borderRadius: 6,
                        padding: '4px 10px',
                        cursor: 'pointer',
                      }}
                    >
                      {status === 'pending' ? 'Open Review' : 'Inspect'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>


      {/* My Allocation for Client Admin / Platform Governance Quick Actions for Super Admin */}
      {isSuper ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Platform Governance Quick Actions</h3>
          <p className="csub" style={{ margin: '2px 0 14px', fontSize: 12, color: '#64748b' }}>
            Multi-tenant control, power delegation, audit trails, and projects
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <button
              type="button"
              className="portal-action"
              onClick={() => onNav('companies')}
              style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
            >
              <span style={{ fontSize: 16, display: 'block', marginBottom: 4 }}>🏢</span>
              <strong style={{ fontSize: 13, display: 'block', color: '#0f172a' }}>Companies</strong>
              <span style={{ fontSize: 11, color: '#64748b' }}>Manage organizations &amp; projects</span>
            </button>
            <button
              type="button"
              className="portal-action"
              onClick={() => onNav('admins')}
              style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
            >
              <span style={{ fontSize: 16, display: 'block', marginBottom: 4 }}>🛡️</span>
              <strong style={{ fontSize: 13, display: 'block', color: '#0f172a' }}>Client Admins</strong>
              <span style={{ fontSize: 11, color: '#64748b' }}>Power delegation &amp; accounts</span>
            </button>
            <button
              type="button"
              className="portal-action"
              onClick={() => onNav('surveys')}
              style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
            >
              <span style={{ fontSize: 16, display: 'block', marginBottom: 4 }}>📋</span>
              <strong style={{ fontSize: 13, display: 'block', color: '#0f172a' }}>Projects</strong>
              <span style={{ fontSize: 11, color: '#64748b' }}>Questions &amp; assignments</span>
            </button>
            <button
              type="button"
              className="portal-action"
              onClick={() => onNav('audit')}
              style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
            >
              <span style={{ fontSize: 16, display: 'block', marginBottom: 4 }}>⭐</span>
              <strong style={{ fontSize: 13, display: 'block', color: '#0f172a' }}>Platform Audit</strong>
              <span style={{ fontSize: 11, color: '#64748b' }}>Platform activity log &amp; quotas</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>My allocation</h3>
          <p className="csub" style={{ margin: '2px 0 14px', fontSize: 12, color: '#64748b' }}>
            Records &amp; features granted by Super Admin (0 = unlimited)
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <span className="chip" style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#1e293b', fontSize: 12, fontWeight: 600 }}>
              Surveys <strong>{stats?.surveys_count || 3} / ∞</strong>
            </span>
            <span className="chip" style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#1e293b', fontSize: 12, fontWeight: 600 }}>
              Surveyors <strong>{stats?.surveyors_count || 24} / 30</strong>
            </span>
            <span className="chip" style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#1e293b', fontSize: 12, fontWeight: 600 }}>
              Questions/survey <strong>12 / 20</strong>
            </span>
            <span className="chip" style={{ background: '#f0fdf4', border: '1px solid #dcfce7', color: '#16a34a', fontSize: 12, fontWeight: 600 }}>
              Confirmed <strong>{stats?.confirmed?.toLocaleString?.() ?? '0'}</strong>
            </span>
            <span className="chip" style={{ background: '#fef2f2', border: '1px solid #fee2e2', color: '#ef4444', fontSize: 12, fontWeight: 600 }}>
              Rejected <strong>{((stats?.rejected != null ? stats.rejected : stats?.submissions != null && stats?.confirmed != null && stats?.pending != null ? Math.max(0, stats.submissions - stats.confirmed - stats.pending) : 0)).toLocaleString()}</strong>
            </span>
            <span className="chip" style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#1e293b', fontSize: 12, fontWeight: 600 }}>
              Records <strong>{stats?.submissions?.toLocaleString?.() || '4,089'} / {(totalAllocations || 6000).toLocaleString()}</strong>
            </span>
          </div>
        </div>
      )}

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

  const isSuper = superAdminOnly || user?.role === 'super_admin'
  const baseNav = isSuper
    ? [...NAV, COMPANIES_NAV, CLIENT_ADMINS_NAV, PLATFORM_NAV]
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

      <div className="admin-bell-dock" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 9999, background: '#f0fdf4', border: '1px solid #dcfce7', color: '#16a34a', fontSize: 12, fontWeight: 700 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16a34a' }}></span>
          Synced just now
        </div>
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
          <strong>Smart Survey X · Admin</strong>
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
        <div className="side-brand">
          <span style={{ color: '#1d6fe0' }}>✦</span> Smart Survey X
          <span className="role-tag">{isSuper ? 'Super Admin' : 'Client Admin'}</span>
        </div>
        <nav className="portal-nav">
          <div className="side-section-label">MONITORING</div>
          <button className={`side-sub ${page === 'overview' ? 'active' : ''}`} onClick={() => goPage('overview')}>📊 Dashboard</button>
          <button className={`side-sub ${['analyze', 'report', 'upload', 'data'].includes(page) ? 'active' : ''}`} onClick={() => goPage('analyze')}>📈 Analyze &amp; Export</button>
          <button className={`side-sub ${page === 'review' ? 'active' : ''}`} onClick={() => goPage('review')}>✅ Review QA</button>

          <div className="side-section-label" style={{ marginTop: 14 }}>SETUP &amp; TEAM</div>
          <button className={`side-sub ${page === 'users' ? 'active' : ''}`} onClick={() => goPage('users')}>👥 Surveyors &amp; Quotas</button>
          <button className={`side-sub ${['surveys', 'questions', 'bank', 'web'].includes(page) ? 'active' : ''}`} onClick={() => goPage('surveys')}>📋 Surveys &amp; Forms</button>
          <button className={`side-sub ${page === 'profile' ? 'active' : ''}`} onClick={() => goPage('profile')}>🏢 Organization</button>

          {isSuper && (
            <>
              <div className="side-section-label" style={{ marginTop: 14 }}>GOVERNANCE</div>
              <button className={`side-sub ${page === 'companies' ? 'active' : ''}`} onClick={() => goPage('companies')}>🏢 Companies</button>
              <button className={`side-sub ${page === 'admins' ? 'active' : ''}`} onClick={() => goPage('admins')}>🛡️ Client Admins</button>
              <button className={`side-sub ${page === 'audit' || page === 'seats' ? 'active' : ''}`} onClick={() => goPage('audit')}>💺 Seats &amp; Audit</button>
            </>
          )}
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
          <button
            type="button"
            className="portal-user"
            onClick={() => (user.role === 'super_admin' ? goPage('profile') : undefined)}
            disabled={user.role !== 'super_admin'}
            title={user.role === 'super_admin' ? 'Open Super Admin profile' : undefined}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 0,
              padding: 0,
              cursor: user.role === 'super_admin' ? 'pointer' : 'default',
            }}
          >
            <strong>
              {user.name || user.username}{' '}
              {user.verified ? <VerifiedBadge size={16} title="Verified" /> : null}
              {user.role === 'super_admin' ? <Icon name="star" size={13} /> : ''}
            </strong>
            <span>
              @{user.username} · {user.role === 'super_admin' ? 'Super Admin' : 'Client Admin'}
              {user.role === 'super_admin' ? ' · Profile' : ''}
            </span>
          </button>
          <a className="portal-link" href={apkDownloadUrl()} target="_blank" rel="noreferrer">
            Download app ↗
          </a>
          <button type="button" className="btn small danger" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </aside>

      <main className="portal-main">
        {nav.filter((n) => n.pages.length > 1 && n.pages.includes(page)).map((n) => (
          <div className="portal-subtabs" key={n.id}>
            {n.pages.map((p) => (
              <button
                key={p}
                type="button"
                className={page === p ? 'portal-subtab active' : 'portal-subtab'}
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
              superAdminOnly={isSuper}
              canPage={canPage}
              onToast={notify}
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
          {page === 'web' && canPage('web') && (
            <AdminWebSurveyScreen onToast={notify} user={user} />
          )}
          {page === 'profile' && canPage('profile') && (
            <AdminProfileScreen
              user={user}
              onToast={notify}
              onUserUpdated={(u) => setUser((prev) => ({ ...prev, ...u }))}
            />
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
