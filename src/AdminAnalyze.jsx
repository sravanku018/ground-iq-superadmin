import { useCallback, useEffect, useState } from 'react'
import {
  deleteSubmission,
  getAdminAnalyze,
  getAnalytics,
  getStoredUser,
  listSubmissions,
  setSubmissionStatus,
} from './api'

import SubmissionEditor from './SubmissionEditor'
import { getDisplayLang, setDisplayLang } from './prefs'
import FeedCard from './components/FeedCard'

/**
 * Client Admin: filter by date + user, strict geo/voice, complete/incomplete, analyze.
 * Can edit / delete survey answers before or after confirm.
 */
function todayStr() {
  return new Date().toISOString().slice(0, 10)
}
function thisMonthStr() {
  return new Date().toISOString().slice(0, 7)
}

export default function AdminAnalyzeScreen({ onToast }) {
  const [period, setPeriod] = useState('total') // total | today | day | month
  const [day, setDay] = useState(todayStr())
  const [month, setMonth] = useState(thisMonthStr())
  const [user, setUser] = useState('')
  const [survey, setSurvey] = useState('')
  const [district, setDistrict] = useState('')
  const [constituency, setConstituency] = useState('')
  const [qFilters, setQFilters] = useState({}) // q_<questionId> → value
  const [surveys, setSurveys] = useState([])
  const [completeness, setCompleteness] = useState('all')
  const [board, setBoard] = useState(null)
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [filterLang, setFilterLang] = useState(getDisplayLang)
  const setFilterLangPersist = (lang) => {
    setFilterLang(setDisplayLang(lang))
  }

  useEffect(() => {
    import('./api')
      .then(({ listSurveys }) => listSurveys())
      .then((d) => setSurveys(d.items || []))
      .catch(() => {})
  }, [])

  const load = useCallback(
    async (overrides = {}) => {
      setLoading(true)
      try {
        const p = {
          period,
          day,
          month,
          user,
          survey,
          district,
          constituency,
          completeness,
          ...overrides,
        }
        const periodVal = p.period || 'total'
        const dayVal = p.day || day
        const monthVal = p.month || month
        const userVal = p.user ?? user
        const surveyVal = p.survey ?? survey
        const districtVal = p.district ?? district
        const constituencyVal = p.constituency ?? constituency
        const completenessVal = p.completeness ?? completeness

        const baseScope = {
          period: periodVal,
          user: userVal || undefined,
          district: districtVal || undefined,
          constituency: constituencyVal || undefined,
        }
        if (periodVal === 'day') baseScope.day = dayVal
        if (periodVal === 'month') baseScope.month = monthVal

        const qParams = Object.fromEntries(Object.entries(qFilters).filter(([, v]) => v))

        const [analyze, list, charts] = await Promise.all([
          getAdminAnalyze({
            ...baseScope,
            survey: surveyVal,
            completeness: completenessVal === 'all' ? undefined : completenessVal,
            ...qParams,
          }),
          listSubmissions(300, 'all', {
            period: periodVal,
            day: periodVal === 'day' ? dayVal : undefined,
            month: periodVal === 'month' ? monthVal : undefined,
            user: userVal,
            survey: surveyVal,
            district: districtVal || undefined,
            constituency: constituencyVal || undefined,
            completeness: completenessVal === 'all' ? '' : completenessVal,
            ...qParams,
            date_from:
              periodVal === 'day'
                ? dayVal
                : periodVal === 'today'
                  ? todayStr()
                  : periodVal === 'month'
                    ? `${monthVal}-01`
                    : '',
            date_to:
              periodVal === 'day'
                ? dayVal
                : periodVal === 'today'
                  ? todayStr()
                  : periodVal === 'month'
                    ? `${monthVal}-31`
                    : '',
          }),
          getAnalytics({
            status: 'all',
            period: periodVal,
            day: periodVal === 'day' ? dayVal : undefined,
            month: periodVal === 'month' ? monthVal : undefined,
            user: userVal,
            survey: surveyVal,
            district: districtVal || undefined,
            constituency: constituencyVal || undefined,
            completeness: completenessVal === 'all' ? 'all' : completenessVal,
            ...qParams,
          }).catch(() => null),
        ])
        setBoard(analyze)
        setItems(list.items || [])
        setSummary(list.summary || analyze.totals)
        setAnalytics(charts)
        onToast?.(
          `Loaded ${list.total ?? analyze.totals?.records ?? 0} · ${periodVal}${userVal ? ` · ${userVal}` : ''}${districtVal ? ` · ${districtVal}` : ''}`,
          'ok',
        )
      } catch (e) {
        onToast?.(e.message, 'error')
      } finally {
        setLoading(false)
      }
    },
    [
      period,
      day,
      month,
      user,
      survey,
      district,
      constituency,
      completeness,
      qFilters,
      onToast,
    ],
  )

  // Auto-load report boards on first open
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, [])

  // Optimistic UI (Twitter principle: tap → instant, sync later)
  async function confirmOne(id, force = false) {
    // 1. Optimistic flip
    setItems(rs => rs.map(r => r.id === id ? { ...r, status: 'confirmed' } : r))
    onToast?.('Confirming…', 'ok')
    try {
      await setSubmissionStatus(id, 'confirmed', force ? 'force override' : '', force)
      onToast?.(force ? 'Force confirmed' : 'Confirmed', 'ok')
      await load()
    } catch (e) {
      // 2. Rollback on failure
      onToast?.(e.message, 'error')
      await load()
    }
  }

  async function rejectOne(id) {
    setItems(rs => rs.map(r => r.id === id ? { ...r, status: 'rejected' } : r))
    onToast?.('Rejecting…', 'ok')
    try {
      await setSubmissionStatus(id, 'rejected')
      onToast?.('Rejected', 'ok')
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
      await load()
    }
  }

  async function deleteRejectedOne(id) {
    if (!confirm('Delete this rejected record permanently? Photo and voice for it are removed too.')) {
      return
    }
    setBusyId(id)
    try {
      await deleteSubmission(id)
      onToast?.('Rejected record deleted', 'ok')
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setBusyId(null)
    }
  }

  const totals = board?.totals || summary || {}

  return (
    <div className="screen">
      <header className="screen-head">
        <h2>Client Admin · Report</h2>
        <p>Survey → surveyor → geolocation → day / month · tables &amp; confirm</p>
      </header>

      <div className="card" style={{ marginBottom: 12 }}>
        <h3>Data filters</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {[
            { id: 'en', label: 'English' },
            { id: 'te', label: 'తెలుగు' },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip ${filterLang === p.id ? 'selected' : ''}`}
              onClick={() => setFilterLangPersist(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          English and Telugu stay separate. Picking a survey applies the language set when
          its questions were prepared.
          Step by step: <strong>1. Survey name</strong> → <strong>2. Surveyor name</strong> →{' '}
          <strong>3. Geolocation</strong> → <strong>4. Day / Month</strong> → <strong>5. Rest</strong> (questions & status).
        </p>

        {/* Step 1 · Survey name */}
        <div className="filter-step">
          <p className="filter-step-title">1 · Survey name</p>
          <label className="field">
            <span>By survey</span>
            <select
              value={survey}
              onChange={(e) => {
                const v = e.target.value
                setSurvey(v)
                setUser('')
                setQFilters({})
                const s = surveys.find((x) => x.form_key === v)
                if (s?.display_lang === 'te' || s?.display_lang === 'en') {
                  setFilterLangPersist(s.display_lang)
                }
              }}
            >
              <option value="">All surveys</option>
              {surveys.map((s) => (
                <option key={s.id} value={s.form_key}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Step 2 · Surveyor name */}
        <div className="filter-step">
          <p className="filter-step-title">2 · Surveyor name</p>
          <label className="field">
            <span>By surveyor</span>
            <select value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">
                {board?.by_user?.length ? 'All surveyors' : 'No surveyors yet'}
              </option>
              {(board?.by_user || []).map((u) => (
                <option key={u.user} value={u.user}>
                  {u.user} ({u.completed ?? u.confirmed ?? 0} completed ·{' '}
                  {u.pending ?? 0} pending)
                </option>
              ))}
            </select>
          </label>
          {!survey && (
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
              Pick a survey first to load its surveyors.
            </p>
          )}
        </div>

        {/* Step 3 · Geolocation */}
        <div className="filter-step">
          <p className="filter-step-title">3 · Geolocation</p>
          <div className="filter-step-grid">
            <label className="field">
              <span>{filterLang === 'te' ? 'జిల్లా' : 'District'}</span>
              <select value={district} onChange={(e) => setDistrict(e.target.value)}>
                <option value="">{filterLang === 'te' ? 'అన్ని జిల్లాలు' : 'All districts'}</option>
                {(analytics?.filterOptions?.districts || []).map((d) => (
                  <option key={d} value={d}>
                    {filterLang === 'te'
                      ? analytics?.filterLabels?.districts?.[d] || d
                      : d}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Assembly constituency</span>
              <input
                type="text"
                placeholder="Filter by AC name…"
                value={constituency}
                onChange={(e) => setConstituency(e.target.value)}
              />
            </label>
          </div>
        </div>

        {/* Step 4 · Day / Month */}
        <div className="filter-step">
          <p className="filter-step-title">4 · Day / Month</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {[
              { id: 'total', label: 'Total data' },
              { id: 'today', label: 'Today' },
              { id: 'day', label: 'Day data' },
              { id: 'month', label: 'Month data' },
            ].map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip ${period === c.id ? 'selected' : ''}`}
                onClick={() => setPeriod(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          {period === 'day' && (
            <label className="field">
              <span>Day</span>
              <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
          )}
          {period === 'month' && (
            <label className="field">
              <span>Month</span>
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
          )}
        </div>

        {/* Step 5 · Rest (Question filters & status) */}
        <div className="filter-step">
          <p className="filter-step-title">5 · Rest (Question filters & status)</p>
          {analytics?.dataFilters?.questions?.map((q) => {
            const countMap = new Map((q.counts || []).map((c) => [c.name, c]))
            const optionNames = [...new Set([...(q.options || []), ...countMap.keys()])]
            const titleShown =
              filterLang === 'te'
                ? String(q.label_te || q.label || q.label_en || 'Question').trim()
                : String(q.label_en || q.label || 'Question').trim()
            return (
            <label className="field" key={q.id}>
              <span>{titleShown}</span>
              <select
                value={qFilters[`q_${q.id}`] || ''}
                onChange={(e) =>
                  setQFilters((f) => ({ ...f, [`q_${q.id}`]: e.target.value }))
                }
              >
                <option value="">{filterLang === 'te' ? 'అన్నీ' : 'All'} {titleShown}</option>
                {optionNames.map((name) => {
                  const c = countMap.get(name)
                  let shownName = name
                  if (filterLang === 'te') {
                    if (c?.label && c.label !== name) shownName = c.label
                    else {
                      const i = (q.options || []).findIndex((o) => o === name)
                      if (i >= 0 && q.options_te?.[i]) shownName = q.options_te[i]
                    }
                  }
                  const n = c?.value
                  return (
                    <option key={name} value={name}>
                      {n != null ? `${shownName} (${n})` : shownName}
                    </option>
                  )
                })}
              </select>
            </label>
            )
          })}
          {survey && (analytics?.dataFilters?.questions || []).length === 0 && (
            <p className="muted" style={{ fontSize: 12 }}>
              This survey has no question filters yet.
            </p>
          )}
          {!survey && (
            <p className="muted" style={{ fontSize: 12 }}>
              Pick a survey to load its question filters.
            </p>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {[
            { id: 'all', label: 'All media' },
            { id: 'complete', label: 'Media complete' },
            { id: 'incomplete', label: 'Media incomplete' },
          ].map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chip ${completeness === c.id ? 'selected' : ''}`}
              onClick={() => setCompleteness(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn primary" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Load data & analyze'}
        </button>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Media complete = geo + voice + photo + Q/A. Pending ≠ media incomplete (pending still
          needs Client Admin confirm).
        </p>
      </div>

      <div className={`stat-row stat-row-6 ${loading ? 'is-loading' : ''}`}>
        <div className="stat">
          <strong>{loading && totals.records == null ? '…' : (totals.records ?? totals.total ?? '—')}</strong>
          <span>Records</span>
        </div>
        <div className="stat">
          <strong>
            {loading && totals.completed == null && totals.confirmed == null
              ? '…'
              : (totals.completed ?? totals.confirmed ?? summary?.completed ?? summary?.confirmed ?? '—')}
          </strong>
          <span>Completed</span>
        </div>
        <div className="stat">
          <strong>
            {loading && totals.pending == null && summary?.pending == null
              ? '…'
              : (totals.pending ?? summary?.pending ?? '—')}
          </strong>
          <span>Pending</span>
        </div>
        <div className="stat">
          <strong>{loading && totals.complete == null ? '…' : (totals.complete ?? '—')}</strong>
          <span>Media OK</span>
        </div>
        <div className="stat">
          <strong>{loading && totals.incomplete == null ? '…' : (totals.incomplete ?? '—')}</strong>
          <span>Media fail</span>
        </div>
        <div className="stat">
          <strong>
            {loading && totals.draft == null ? '…' : (totals.draft ?? summary?.draft ?? 0)}
          </strong>
          <span>Drafts (in pending)</span>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '-6px 0 12px' }}>
        <strong>Completed</strong> = confirmed final surveys (not drafts) ·{' '}
        <strong>Pending</strong> = waiting confirm <em>or</em> still draft ·{' '}
        <strong>Media OK/fail</strong> = geo + voice + photo + Q/A.
      </p>

      {/* Daily data */}
      {(board?.by_day || board?.by_date)?.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>Daily data</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Totals per calendar day · media complete/incomplete + confirmed/pending
          </p>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Total</th>
                  <th>Completed</th>
                  <th>Pending</th>
                  <th>Media OK</th>
                  <th>Media fail</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(board.by_day || board.by_date).slice(0, 62).map((d) => (
                  <tr key={d.date}>
                    <td>
                      <strong>{d.date}</strong>
                    </td>
                    <td>{d.total}</td>
                    <td>{d.completed ?? d.confirmed ?? 0}</td>
                    <td>{d.pending ?? 0}</td>
                    <td>{d.complete ?? 0}</td>
                    <td>{d.incomplete ?? Math.max(0, (d.total || 0) - (d.complete || 0))}</td>
                    <td>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => {
                          setPeriod('day')
                          setDay(d.date)
                          load({ period: 'day', day: d.date })
                        }}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Monthly data */}
      {board?.by_month?.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>Monthly data</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Totals per month · media complete/incomplete + confirmed/pending
          </p>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Total</th>
                  <th>Completed</th>
                  <th>Pending</th>
                  <th>Media OK</th>
                  <th>Media fail</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {board.by_month.map((m) => (
                  <tr key={m.month}>
                    <td>
                      <strong>{m.month}</strong>
                    </td>
                    <td>{m.total}</td>
                    <td>{m.completed ?? m.confirmed ?? 0}</td>
                    <td>{m.pending ?? 0}</td>
                    <td>{m.complete ?? 0}</td>
                    <td>{m.incomplete ?? Math.max(0, (m.total || 0) - (m.complete || 0))}</td>
                    <td>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => {
                          setPeriod('month')
                          setMonth(m.month)
                          load({ period: 'month', month: m.month })
                        }}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Surveyor daily data */}
      {(board?.by_surveyor_day?.length > 0 || board?.by_user?.length > 0) && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>Surveyor daily data</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Each surveyor · each day · media OK/fail + confirmed/pending
          </p>
          {board?.by_surveyor_day?.length > 0 ? (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Surveyor</th>
                    <th>Day</th>
                    <th>Total</th>
                    <th>Completed</th>
                    <th>Pending</th>
                    <th>Media OK</th>
                    <th>Media fail</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {board.by_surveyor_day.slice(0, 80).map((r) => (
                    <tr key={`${r.surveyor}-${r.day}`}>
                      <td className="cell-clip" title={r.surveyor}>
                        <strong>{r.surveyor}</strong>
                      </td>
                      <td>{r.day}</td>
                      <td>{r.total}</td>
                      <td>{r.completed ?? r.confirmed ?? 0}</td>
                      <td>{r.pending ?? 0}</td>
                      <td>{r.complete ?? 0}</td>
                      <td>
                        {r.incomplete ??
                          Math.max(0, (r.total || 0) - (r.complete || 0))}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => {
                            setUser(r.surveyor)
                            setPeriod('day')
                            setDay(r.day)
                            load({
                              user: r.surveyor,
                              period: 'day',
                              day: r.day,
                            })
                          }}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 12 }}>
              Redeploy Deno API for surveyor×day rows. By-surveyor totals below.
            </p>
          )}
          {board?.by_user?.length > 0 && (
            <>
              <h4 style={{ margin: '12px 0 6px' }}>By surveyor (total)</h4>
              <ul className="user-list user-list-actions">
                {board.by_user.map((u) => {
                  const mediaFail =
                    u.incomplete ?? Math.max(0, (u.total || 0) - (u.complete || 0))
                  const done = u.completed ?? u.confirmed ?? 0
                  return (
                    <li key={u.user}>
                      <div className="user-list-main">
                        <strong>{u.user}</strong>
                        <span className="meta">
                          {u.total} total · completed {done} · pending {u.pending ?? 0}
                          {u.draft ? ` · drafts ${u.draft}` : ''}
                          {' · '}
                          media OK {u.complete ?? 0} / fail {mediaFail}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => {
                          setUser(u.user)
                          load({ user: u.user })
                        }}
                      >
                        Filter
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {/* Surveyor monthly data */}
      {board?.by_surveyor_month?.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>Surveyor monthly data</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Each surveyor · each month · media OK/fail + confirmed/pending
          </p>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Surveyor</th>
                  <th>Month</th>
                  <th>Total</th>
                  <th>Completed</th>
                  <th>Pending</th>
                  <th>Media OK</th>
                  <th>Media fail</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {board.by_surveyor_month.slice(0, 80).map((r) => (
                  <tr key={`${r.surveyor}-${r.month}`}>
                    <td className="cell-clip" title={r.surveyor}>
                      <strong>{r.surveyor}</strong>
                    </td>
                    <td>{r.month}</td>
                    <td>{r.total}</td>
                    <td>{r.completed ?? r.confirmed ?? 0}</td>
                    <td>{r.pending ?? 0}</td>
                    <td>{r.complete ?? 0}</td>
                    <td>
                      {r.incomplete ??
                        Math.max(0, (r.total || 0) - (r.complete || 0))}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => {
                          setUser(r.surveyor)
                          setPeriod('month')
                          setMonth(r.month)
                          load({
                            user: r.surveyor,
                            period: 'month',
                            month: r.month,
                          })
                        }}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {analytics?.charts?.byParty?.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>Analyze (scoped charts)</h3>
          <p className="muted" style={{ fontSize: 12 }}>
            {analytics.filtered} records · completeness {completeness || 'all'} · user{' '}
            {user || 'all'}
          </p>
          <ul className="user-list">
            {analytics.charts.byParty.slice(0, 8).map((p) => (
              <li key={p.name}>
                <strong>{p.label || p.name}</strong>
                <span className="meta">
                  {' '}
                  {p.value} ({p.pct}%)
                </span>
              </li>
            ))}
          </ul>
          {analytics.charts.byDistrict?.length > 0 && (
            <>
              <h4 style={{ marginTop: 12 }}>Districts</h4>
              <ul className="user-list">
                {analytics.charts.byDistrict.slice(0, 8).map((p) => (
                  <li key={p.name}>
                    <strong>{p.label || p.name}</strong>
                    <span className="meta">
                      {' '}
                      {p.value} ({p.pct}%)
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {analytics.charts.byConstituency?.length > 0 && (
            <>
              <h4 style={{ marginTop: 12 }}>Assemblies</h4>
              <ul className="user-list">
                {analytics.charts.byConstituency.slice(0, 8).map((p) => (
                  <li key={p.name}>
                    <strong>{p.label || p.name}</strong>
                    <span className="meta">
                      {' '}
                      {p.value} ({p.pct}%)
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="card">
        <h3>Records ({items.length})</h3>
        {loading && !items.length ? (
          <div className="portal-skeleton-rows" style={{ marginTop: 8 }}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="portal-skeleton-row" style={{ width: `${92 - i * 8}%` }} />
            ))}
          </div>
        ) : !items.length ? (
          <p className="muted">No rows for this filter. Adjust date/user or collect more.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {items.map((it) => {
              const open = expanded === it.id
              const v = it.verification || {}
              const statusLabel = it.draft
                ? 'draft'
                : it.work === 'completed' || it.status === 'confirmed'
                  ? 'confirmed'
                  : it.status === 'rejected'
                    ? 'rejected'
                    : 'pending'
              const pills = [
                { label: `media ${it.completeness}`, color: it.completeness === 'complete' ? 'var(--ok)' : 'var(--bad)' },
                { label: `geo ${it.has_geo ? 'OK' : 'FAIL'}`, color: it.has_geo ? 'var(--ok)' : 'var(--bad)' },
                { label: `voice ${it.has_voice ? 'OK' : 'FAIL'}`, color: it.has_voice ? 'var(--ok)' : 'var(--bad)' },
                { label: `photo ${it.has_photo ? 'OK' : '—'}`, color: it.has_photo ? 'var(--ok)' : 'var(--warn)' },
              ]
              const signals = []
              if (it.has_geo) signals.push({ label: 'geo', type: 'ok' })
              else signals.push({ label: 'no geo', type: 'bad' })
              if (it.has_voice) signals.push({ label: 'voice', type: 'ok' })
              else signals.push({ label: 'no voice', type: 'bad' })

              const actionsEl = (
                <>
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={busyId === it.id}
                    onClick={(e) => { e.stopPropagation(); setEditingId(it.id) }}
                  >
                    Edit
                  </button>
                  {it.status !== 'confirmed' && it.completeness === 'complete' && (
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={busyId === it.id}
                      onClick={(e) => { e.stopPropagation(); confirmOne(it.id, false) }}
                      style={{ background: 'var(--ok)', borderColor: 'var(--ok)', color: '#fff' }}
                    >
                      Confirm
                    </button>
                  )}
                  {it.status !== 'confirmed' && it.completeness === 'incomplete' && (
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={busyId === it.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm('STRICT FAIL: missing geo/voice/photo. Force confirm anyway?')) {
                          confirmOne(it.id, true)
                        }
                      }}
                    >
                      Force confirm
                    </button>
                  )}
                  {it.status !== 'rejected' && (
                    <button
                      type="button"
                      className="btn small"
                      disabled={busyId === it.id}
                      onClick={(e) => { e.stopPropagation(); rejectOne(it.id) }}
                      style={{ color: 'var(--bad)', borderColor: 'var(--bad)' }}
                    >
                      Reject
                    </button>
                  )}
                  {getStoredUser()?.role === 'super_admin' && it.status === 'rejected' && (
                    <button
                      type="button"
                      className="btn small danger"
                      disabled={busyId === it.id}
                      onClick={(e) => { e.stopPropagation(); deleteRejectedOne(it.id) }}
                    >
                      Delete
                    </button>
                  )}

                </>
              )

              const detail = (
                <>
                  {v.failures?.length > 0 && (
                    <p className="muted" style={{ fontSize: 12 }}>
                      Failures: {v.failures.join(', ')}
                    </p>
                  )}
                  {(it.qa || []).slice(0, 8).map((row) => (
                    <div key={row.q} className="kv" style={{ marginBottom: 4 }}>
                      <span className="muted">{row.q}</span>
                      <strong style={{ display: 'block' }}>{row.a}</strong>
                    </div>
                  ))}
                </>
              )

              if (editingId === it.id) {
                return (
                  <div key={it.id} className="feed-card" style={{ animation: 'fcIn var(--dur-normal) var(--ease-out) both' }}>
                    <SubmissionEditor
                      item={it}
                      onToast={onToast}
                      onCancel={() => setEditingId(null)}
                      onSaved={async () => {
                        setEditingId(null)
                        await load()
                      }}
                      onDeleted={async () => {
                        setEditingId(null)
                        await load()
                      }}
                    />
                  </div>
                )
              }

              return (
                <FeedCard
                  key={it.id}
                  id={it.id}
                  avatar={(it.submitted_by || '—')[0]?.toUpperCase()}
                  name={`#${it.id} · ${it.submitted_by || '—'}`}
                  location={it.district ? `${it.district}${it.constituency ? ', ' + it.constituency : ''}` : ''}
                  time={it.date}
                  pills={pills}
                  status={statusLabel}
                  signals={signals}
                  actions={actionsEl}
                  detail={detail}
                  syncing={busyId === it.id}
                  onClick={() => setExpanded(open ? null : it.id)}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
