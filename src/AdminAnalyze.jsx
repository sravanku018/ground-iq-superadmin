import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getAdminAnalyze,
  getAnalytics,
  listSubmissions,
  listUsers,
  setSubmissionStatus,
} from './api'
import SubmissionEditor from './SubmissionEditor'

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
  const [qFilters, setQFilters] = useState({}) // q_<questionId> → value
  const [surveys, setSurveys] = useState([])
  const [completeness, setCompleteness] = useState('all')
  const [users, setUsers] = useState([])
  const [board, setBoard] = useState(null)
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [editingId, setEditingId] = useState(null)

  useEffect(() => {
    listUsers()
      .then((d) =>
        setUsers((d.users || []).filter((u) => u.role === 'surveyor' || u.role === 'field')),
      )
      .catch(() => {})
    import('./api')
      .then(({ listSurveys }) => listSurveys())
      .then((d) => setSurveys(d.items || []))
      .catch(() => {})
  }, [])

  const scopeParams = useMemo(() => {
    const p = { period, user: user || undefined }
    if (period === 'day') p.day = day
    if (period === 'month') p.month = month
    if (period === 'today') {
      /* server expands */
    }
    return p
  }, [period, day, month, user])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const base = {
        ...scopeParams,
        completeness: completeness === 'all' ? undefined : completeness,
      }
      const [analyze, list, charts] = await Promise.all([
        getAdminAnalyze(scopeParams),
        listSubmissions(300, 'all', {
          period: scopeParams.period,
          day: scopeParams.day,
          month: scopeParams.month,
          user: user,
          completeness: completeness === 'all' ? '' : completeness,
          // expand day/month for submissions list if needed
          date_from:
            period === 'day'
              ? day
              : period === 'today'
                ? todayStr()
                : period === 'month'
                  ? `${month}-01`
                  : '',
          date_to:
            period === 'day'
              ? day
              : period === 'today'
                ? todayStr()
                : period === 'month'
                  ? `${month}-31`
                  : '',
        }),
        getAnalytics({
          status: 'all',
          period: scopeParams.period,
          day: scopeParams.day,
          month: scopeParams.month,
          user,
          survey,
          completeness: completeness === 'all' ? 'all' : completeness,
          ...Object.fromEntries(
            Object.entries(qFilters).filter(([, v]) => v),
          ),
        }).catch(() => null),
      ])
      setBoard(analyze)
      setItems(list.items || [])
      setSummary(list.summary || analyze.totals)
      setAnalytics(charts)
      onToast?.(
        `Loaded ${list.total ?? analyze.totals?.records ?? 0} · ${period}${user ? ` · ${user}` : ''}`,
        'ok',
      )
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [scopeParams, completeness, user, survey, qFilters, period, day, month, onToast])

  useEffect(() => {
    load()
  }, []) // initial

  async function confirmOne(id, force = false) {
    setBusyId(id)
    try {
      await setSubmissionStatus(id, 'confirmed', force ? 'force override' : '', force)
      onToast?.(force ? 'Force confirmed' : 'Confirmed (strict complete)', 'ok')
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function rejectOne(id) {
    setBusyId(id)
    try {
      await setSubmissionStatus(id, 'rejected')
      onToast?.('Marked rejected', 'ok')
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
        <h2>Client Admin · Analyze</h2>
        <p>Daily · monthly · surveyor daily · surveyor monthly · then confirm</p>
      </header>

      <div className="card" style={{ marginBottom: 12 }}>
        <h3>Data filters</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Scope
        </p>
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
        <label className="field">
          <span>By user (surveyor)</span>
          <select value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.username}>
                {u.name || u.username} (@{u.username})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>By survey (auto question filters below)</span>
          <select
            value={survey}
            onChange={(e) => {
              setSurvey(e.target.value)
              setQFilters({})
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
        {analytics?.dataFilters?.questions?.map((q) => (
          <label className="field" key={q.id}>
            <span>{q.label}</span>
            <select
              value={qFilters[`q_${q.id}`] || ''}
              onChange={(e) =>
                setQFilters((f) => ({ ...f, [`q_${q.id}`]: e.target.value }))
              }
            >
              <option value="">All {q.label}</option>
              {(q.counts || []).map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.value})
                </option>
              ))}
            </select>
          </label>
        ))}
        {survey && (analytics?.dataFilters?.questions || []).length === 0 && (
          <p className="muted" style={{ fontSize: 12 }}>
            This survey has no questions yet — add them in the Surveys tab.
          </p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {[
            { id: 'all', label: 'All status' },
            { id: 'complete', label: 'Complete' },
            { id: 'incomplete', label: 'Incomplete' },
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
          Strict: geo + voice + photo + Q/A = complete. Report charts use confirmed only.
        </p>
      </div>

      <div className="stat-row">
        <div className="stat">
          <strong>{totals.records ?? totals.total ?? '—'}</strong>
          <span>Records</span>
        </div>
        <div className="stat">
          <strong>{totals.complete ?? '—'}</strong>
          <span>Complete</span>
        </div>
        <div className="stat">
          <strong>{totals.incomplete ?? '—'}</strong>
          <span>Incomplete</span>
        </div>
        <div className="stat">
          <strong>{totals.voice_fail ?? summary?.voice_fail ?? '—'}</strong>
          <span>Voice fail</span>
        </div>
        <div className="stat">
          <strong>{totals.geo_fail ?? summary?.geo_fail ?? '—'}</strong>
          <span>Geo fail</span>
        </div>
        <div className="stat">
          <strong>{totals.confirmed ?? summary?.confirmed ?? '—'}</strong>
          <span>Confirmed</span>
        </div>
      </div>

      {/* Daily data */}
      {(board?.by_day || board?.by_date)?.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>Daily data</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Totals per calendar day
          </p>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Total</th>
                  <th>Complete</th>
                  <th>Incomplete</th>
                  <th>Confirmed</th>
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
                    <td>{d.complete}</td>
                    <td>{d.incomplete}</td>
                    <td>{d.confirmed}</td>
                    <td>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => {
                          setPeriod('day')
                          setDay(d.date)
                          setTimeout(load, 50)
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
            Totals per month
          </p>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Total</th>
                  <th>Complete</th>
                  <th>Incomplete</th>
                  <th>Confirmed</th>
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
                    <td>{m.complete}</td>
                    <td>{m.incomplete}</td>
                    <td>{m.confirmed}</td>
                    <td>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => {
                          setPeriod('month')
                          setMonth(m.month)
                          setTimeout(load, 50)
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
            Each surveyor · each day
          </p>
          {board?.by_surveyor_day?.length > 0 ? (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Surveyor</th>
                    <th>Day</th>
                    <th>Total</th>
                    <th>Complete</th>
                    <th>Confirmed</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {board.by_surveyor_day.slice(0, 80).map((r) => (
                    <tr key={`${r.surveyor}-${r.day}`}>
                      <td>
                        <strong>{r.surveyor}</strong>
                      </td>
                      <td>{r.day}</td>
                      <td>{r.total}</td>
                      <td>{r.complete}</td>
                      <td>{r.confirmed}</td>
                      <td>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => {
                            setUser(r.surveyor)
                            setPeriod('day')
                            setDay(r.day)
                            setTimeout(load, 50)
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
              <ul className="user-list">
                {board.by_user.map((u) => (
                  <li key={u.user}>
                    <div>
                      <strong>{u.user}</strong>
                      <span className="meta">
                        {' '}
                        {u.complete}/{u.total} complete · confirmed {u.confirmed}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => {
                        setUser(u.user)
                        setTimeout(load, 50)
                      }}
                    >
                      Filter
                    </button>
                  </li>
                ))}
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
            Each surveyor · each month
          </p>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Surveyor</th>
                  <th>Month</th>
                  <th>Total</th>
                  <th>Complete</th>
                  <th>Confirmed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {board.by_surveyor_month.slice(0, 80).map((r) => (
                  <tr key={`${r.surveyor}-${r.month}`}>
                    <td>
                      <strong>{r.surveyor}</strong>
                    </td>
                    <td>{r.month}</td>
                    <td>{r.total}</td>
                    <td>{r.complete}</td>
                    <td>{r.confirmed}</td>
                    <td>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => {
                          setUser(r.surveyor)
                          setPeriod('month')
                          setMonth(r.month)
                          setTimeout(load, 50)
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
                <strong>{p.name}</strong>
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
                    <strong>{p.name}</strong>
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
                    <strong>{p.name}</strong>
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
        {!items.length ? (
          <p className="muted">No rows for this filter. Adjust date/user or collect more.</p>
        ) : (
          <ul className="user-list review-list">
            {items.map((it) => {
              const open = expanded === it.id
              const v = it.verification || {}
              return (
                <li key={it.id} className="card" style={{ marginBottom: 10 }}>
                  <button
                    type="button"
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: 'none',
                      border: 0,
                      color: 'inherit',
                      padding: 0,
                      cursor: 'pointer',
                    }}
                    onClick={() => setExpanded(open ? null : it.id)}
                  >
                    <strong>
                      #{it.id} · {it.submitted_by || '—'} · {it.date}
                    </strong>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      <span className={`pill ${it.completeness === 'complete' ? 'ok' : 'bad'}`}>
                        <span className="dot" />
                        {it.completeness}
                      </span>
                      <span className={`pill ${it.has_geo ? 'ok' : 'bad'}`}>
                        <span className="dot" />
                        geo {it.has_geo ? 'OK' : 'FAIL'}
                      </span>
                      <span className={`pill ${it.has_voice ? 'ok' : 'bad'}`}>
                        <span className="dot" />
                        voice {it.has_voice ? 'OK' : 'FAIL'}
                      </span>
                      <span className={`pill ${it.has_photo ? 'ok' : 'warn'}`}>
                        <span className="dot" />
                        photo {it.has_photo ? 'OK' : '—'}
                      </span>
                      <span className="pill">{it.status}</span>
                    </div>
                  </button>
                  {open && (
                    <div style={{ marginTop: 10 }}>
                      {editingId === it.id ? (
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
                      ) : (
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
                          <div className="user-actions" style={{ marginTop: 10 }}>
                            <button
                              type="button"
                              className="btn small primary"
                              disabled={busyId === it.id}
                              onClick={() => setEditingId(it.id)}
                            >
                              Edit data
                            </button>
                            {it.status !== 'confirmed' && it.completeness === 'complete' && (
                              <button
                                type="button"
                                className="btn small primary"
                                disabled={busyId === it.id}
                                onClick={() => confirmOne(it.id, false)}
                              >
                                Confirm complete
                              </button>
                            )}
                            {it.status !== 'confirmed' && it.completeness === 'incomplete' && (
                              <button
                                type="button"
                                className="btn small danger"
                                disabled={busyId === it.id}
                                onClick={() => {
                                  if (
                                    confirm(
                                      'STRICT FAIL: missing geo/voice/photo. Force confirm anyway?',
                                    )
                                  ) {
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
                                onClick={() => rejectOne(it.id)}
                              >
                                Reject
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
