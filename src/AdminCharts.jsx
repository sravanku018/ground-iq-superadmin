/**
 * Excel Charts tab — the full EvilCharts catalog (area, bar, line, composed,
 * pie, radar, radial, sankey) rendered from survey analytics.
 * Data: /api/admin/analyze. Charts: recharts, styled with the EvilCharts look
 * (gradient fills, rounded bars, card tooltips, active-grid highlighting).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Sankey,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getAdminAnalyze, getAnswerRows, getSurvey, listSurveys, listUsers } from './api'
import QuestionAnalytics from './components/QuestionAnalytics'
import { buildMeta } from './surveyEngine'
import { dayLabel, monthLabel } from './components/Charts'

const C = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47', '#264478', '#9E480E']

const tooltipStyle = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  boxShadow: '0 8px 24px rgba(15,23,42,.12)',
  fontSize: 12,
  padding: '8px 12px',
}

const axisProps = { tick: { fontSize: 11, fill: '#64748b' }, stroke: '#cbd5e1' }

function Card({ title, subtitle, children, height = 300 }) {
  return (
    <div className="card" style={{ padding: 14, marginBottom: 14 }}>
      <h3 style={{ margin: '0 0 2px', fontSize: 15 }}>{title}</h3>
      {subtitle ? <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>{subtitle}</p> : null}
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function FilterBar({ surveys, users, questions, filters, setFilters, onApply, loading, onReset, selectedQids, setSelectedQids }) {
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))
  const chosenQ = questions.find((q) => String(q.id) === String(filters.qid))
  const withAnswers = questions.filter((q) => q.answered > 0)
  const tickList = (withAnswers.length ? withAnswers : questions).slice(0, 20)
  return (
    <div className="card" style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: 11 }}>Survey</span>
          <select value={filters.survey} onChange={set('survey')}>
            {(surveys || []).map((s) => (
              <option key={s.id} value={s.form_key}>{s.title || s.form_key}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: 11 }}>Surveyor</span>
          <select value={filters.user} onChange={set('user')}>
            <option value="">All surveyors</option>
            {(users || []).map((u) => (
              <option key={u.id} value={u.username}>{u.display_name || u.username}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: 11 }}>District</span>
          <input value={filters.district} onChange={set('district')} placeholder="e.g. SIDDIPET" />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: 11 }}>From</span>
          <input type="date" value={filters.date_from} onChange={set('date_from')} />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: 11 }}>To</span>
          <input type="date" value={filters.date_to} onChange={set('date_to')} />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: 11 }}>Question</span>
          <select
            value={filters.qid}
            onChange={(e) => setFilters((f) => ({ ...f, qid: e.target.value, qval: '' }))}
            disabled={!filters.survey}
            title={filters.survey ? '' : 'Pick a survey first'}
          >
            <option value="">All questions</option>
            {questions.map((q) => (
              <option key={q.id} value={q.id}>
                {String(q.label || q.id).slice(0, 46)}{q.answered ? ` (${q.answered})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: 11 }}>Answer</span>
          {chosenQ && Array.isArray(chosenQ.options) && chosenQ.options.length ? (
            <select value={filters.qval} onChange={set('qval')} disabled={!filters.qid}>
              <option value="">Any answer</option>
              {chosenQ.options.map((o) => {
                const val = String(typeof o === 'string' ? o : o?.label ?? o?.value ?? '')
                return <option key={val} value={val}>{val}</option>
              })}
            </select>
          ) : (
            <input value={filters.qval} onChange={set('qval')} placeholder="Any answer" disabled={!filters.qid} />
          )}
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: 11 }}>View by</span>
          <select value={filters.grain} onChange={set('grain')}>
            <option value="day">Day</option>
            <option value="month">Month</option>
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" className="btn primary" disabled={loading} onClick={onApply}>
          {loading ? 'Loading…' : 'Apply filters'}
        </button>
        <button type="button" className="btn" onClick={onReset}>Reset</button>
      </div>
      {tickList.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
            Questions to chart — tick the ones you want ({selectedQids.length} ticked):
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 4, maxHeight: 190, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, background: '#fff' }}>
            {tickList.map((q) => {
              const ticked = selectedQids.map(String).includes(String(q.id))
              return (
                <label
                  key={q.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 6px', borderRadius: 6, cursor: 'pointer', background: ticked ? '#eef3fb' : 'transparent' }}
                  title={q.answered ? `${q.answered} answered in this selection` : 'No answers yet in this selection'}
                >
                  <input
                    type="checkbox"
                    checked={ticked}
                    onChange={() =>
                      setSelectedQids((prev) => {
                        const id = String(q.id)
                        const has = prev.map(String).includes(id)
                        return has ? prev.filter((x) => String(x) !== id) : [...prev, id]
                      })
                    }
                    style={{ accentColor: '#4472C4' }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {String(q.label || q.id)}
                  </span>
                  {q.answered > 0 && (
                    <span className="muted" style={{ fontSize: 10, marginLeft: 'auto' }}>{q.answered}</span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Auto-generated reading of the current selection — the written counterpart
 * to the charts. Every line is guarded; only findings with real data appear.
 */
function buildInsights({ totals, timeRows, userRows, districtRows, partyRows, quotaRows, applied, fc, users, byQuestion }) {
  const out = []
  if (!totals.records) {
    out.push({ tone: 'muted', icon: '🫙', text: 'No records match the current filters. Widen the date range or clear a filter to see analysis.' })
    return out
  }
  const pct = (n, d) => (d ? Math.round(((n || 0) / d) * 100) : 0)
  const T = totals

  // 1. headline
  out.push({
    tone: 'info', icon: '📌',
    text: `${T.records} record${T.records > 1 ? 's' : ''} in this selection — ${pct(T.completed, T.records)}% confirmed, ${pct(T.pending, T.records)}% pending, ${pct(T.rejected, T.records)}% rejected.`,
  })

  // 2. momentum: last 3 buckets vs the 3 before them
  if (timeRows.length >= 4) {
    const recent = timeRows.slice(-3).reduce((n, r) => n + r.total, 0)
    const prev = timeRows.slice(-6, -3).reduce((n, r) => n + r.total, 0)
    if (prev > 0 || recent > 0) {
      const delta = prev === 0 ? 100 : Math.round(((recent - prev) / prev) * 100)
      if (delta >= 20) out.push({ tone: 'good', icon: '📈', text: `Momentum is building: the last 3 ${applied.grain === 'month' ? 'months' : 'days'} collected ${recent} records, up ${delta}% on the previous 3.` })
      else if (delta <= -20) out.push({ tone: 'warn', icon: '📉', text: `Collection is slowing: the last 3 ${applied.grain === 'month' ? 'months' : 'days'} produced ${recent} records, down ${Math.abs(delta)}% from the 3 before.` })
      else out.push({ tone: 'info', icon: '➖', text: `Collection is steady: ${recent} records in the last 3 ${applied.grain === 'month' ? 'months' : 'days'} vs ${prev} before.` })
    }
  }

  // 3. leader
  if (userRows.length > 1) {
    const top = userRows[0]
    out.push({ tone: 'info', icon: '🏆', text: `${top.name} leads with ${top.total} records (${pct(top.total, T.records)}% of this selection), ${top.confirmed} already confirmed.` })
  }

  // 4. backlog
  if (T.pending > 0) {
    const share = pct(T.pending, T.records)
    out.push(share > 30
      ? { tone: 'warn', icon: '⏳', text: `Backlog attention: ${T.pending} records (${share}%) are still pending review — confirming them moves the surveyor progress rings.` }
      : { tone: 'info', icon: '⏳', text: `${T.pending} record${T.pending > 1 ? 's' : ''} awaiting review (${share}% of the selection).` })
  }

  // 5. rejections
  if (T.rejected > 0 && pct(T.rejected, T.records) >= 10) {
    out.push({ tone: 'warn', icon: '⚠️', text: `Rejection rate is high: ${T.rejected} records (${pct(T.rejected, T.records)}%) were rejected — worth reviewing why with the surveyors involved.` })
  }

  // 6. media quality
  if (fc >= 1 && T.records > 0) {
    const fails = [
      ['geo-tag', T.geo_fail], ['voice', T.voice_fail], ['photo', T.photo_fail],
    ].sort((a, b) => b[1] - a[1])
    const worst = fails[0]
    const good = pct(T.complete, T.records)
    if (good >= 80) {
      out.push({ tone: 'good', icon: '✅', text: `Field discipline is strong: ${good}% of records have complete media (geo + voice + photo).` })
    } else {
      out.push({ tone: 'info', icon: '🧪', text: `Media completeness is ${good}%.${worst && worst[1] > 0 ? ` Biggest gap: ${worst[0]} failures (${worst[1]} record${worst[1] > 1 ? 's' : ''}).` : ''}` })
    }
  }

  // 7. quota rings
  if (quotaRows.length) {
    const done = quotaRows.filter((q) => q.pct >= 100)
    const lead = quotaRows[0]
    if (done.length) {
      out.push({ tone: 'good', icon: '🎯', text: `${done.length} surveyor${done.length > 1 ? 's have' : ' has'} reached 100% of quota${lead && lead.pct >= 100 ? ` — ${lead.name} at the front` : ''}.` })
    } else if (lead) {
      out.push({ tone: 'info', icon: '🎯', text: `Quota progress: ${lead.name} is closest at ${lead.pct}%. No one has closed their target yet.` })
    }
  }

  // 8. geography
  if (districtRows.length && !applied.district) {
    const d0 = districtRows[0]
    out.push({ tone: 'info', icon: '🗺️', text: `${districtRows.length} district${districtRows.length > 1 ? 's' : ''} covered — ${d0.name} carries the most records (${d0.total}).${districtRows.length === 1 ? ' Reach is narrow so far.' : ''}` })
  }

  // 9. focused-surveyor read
  if (fc >= 1 && applied.user && userRows.length === 1) {
    const u = userRows[0]
    const target = users.find((x) => (x.display_name || x.username) === u.name)
    const t = Number(target?.target_quota) || 0
    if (t > 0) out.push({ tone: 'info', icon: '🎯', text: `${u.name} is at ${Math.min(100, Math.round((u.total / t) * 100))}% of the assigned target (${u.total} of ${t}).` })
    if (u.total > 0) {
      const dayRows = (applied.grain === 'month' ? [] : timeRows.filter((r) => r.total > 0))
      if (dayRows.length >= 2) out.push({ tone: 'info', icon: '📆', text: `Averaging ${Math.round(u.total / Math.max(1, dayRows.length))} records per active ${applied.grain === 'month' ? 'month' : 'day'} in this window.` })
    }
  }

  // 10. strongest question signal in the filtered rows
  if (Array.isArray(byQuestion) && byQuestion.length) {
    const q0 = byQuestion[0]
    const top = Array.isArray(q0.options) && q0.options[0]
    if (top) {
      out.push({
        tone: 'info', icon: '📋',
        text: `Deepest question signal: “${String(q0.label || q0.question_id)}” — ${top.value} leads ${top.count} of ${q0.answered} answers${pct(top.count, q0.answered) >= 50 ? ` (${pct(top.count, q0.answered)}% majority)` : ''}.`,
      })
    }
  }

  // 11. party answers
  if (partyRows.length > 1) {
    const p0 = partyRows[0]
    out.push({ tone: 'info', icon: '🗳️', text: `“${p0.name}” is the most common winning-party answer (${p0.value} responses, ${pct(p0.value, T.records)}%).` })
  }

  return out
}

export default function AdminCharts() {
  const [filters, setFilters] = useState({
    survey: '', user: '', district: '', date_from: '', date_to: '', grain: 'day', qid: '', qval: '',
  })
  const [applied, setApplied] = useState(filters)
  const [data, setData] = useState(null)
  const [surveys, setSurveys] = useState([])
  const [questions, setQuestions] = useState([])
  // The Client Admin ticks the questions to analyse with the engine.
  const [selectedQids, setSelectedQids] = useState([])

  // Raw answer rows for the full question engine (fetched per survey).
  const [answerRows, setAnswerRows] = useState([])
  const [answerLoading, setAnswerLoading] = useState(false)
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async (f) => {
    setLoading(true)
    setErr('')
    try {
      const [res, sv, us] = await Promise.all([
        getAdminAnalyze({
          survey: f.survey || undefined,
          user: f.user || undefined,
          district: f.district || undefined,
          date_from: f.date_from || undefined,
          date_to: f.date_to || undefined,
          ...(f.qid && f.qval ? { [`q_${f.qid}`]: f.qval } : {}),
        }),
        listSurveys().catch(() => []),
        listUsers().catch(() => []),
      ])
      setData(res)
      setSurveys(Array.isArray(sv) ? sv : sv?.items || [])
      setUsers((Array.isArray(us) ? us : us?.items || []).filter((u) => u.role === 'surveyor' || u.role === 'field'))
      setApplied(f)
    } catch (e) {
      setErr(e?.message || 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // A survey is always selected now (no "All surveys"): preselect the first
    // one so question filters are immediately available.
    ;(async () => {
      const sv = await listSurveys().catch(() => [])
      const list = Array.isArray(sv) ? sv : sv?.items || []
      const first = list[0]?.form_key || ''
      const f = { ...filters, survey: filters.survey || first }
      setFilters(f)
      void load(f)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Raw answer rows for the question engine, refetched per survey.
  useEffect(() => {
    let stop = false
    if (!applied.survey) {
      setAnswerRows([])
      return undefined
    }
    setAnswerLoading(true)
    getAnswerRows({
      survey: applied.survey,
      user: applied.user,
      district: applied.district,
      date_from: applied.date_from,
      date_to: applied.date_to,
    }, 3000)
      .then((res) => {
        if (stop) return
        const flat = (Array.isArray(res?.rows) ? res.rows : []).map((r) => ({
          ...(r.answers || {}),
          date: r.date,
          month: r.month,
          user: r.user,
          district: r.district,
          status: r.status,
        }))
        setAnswerRows(flat)
      })
      .catch(() => {
        if (!stop) setAnswerRows([])
      })
      .finally(() => {
        if (!stop) setAnswerLoading(false)
      })
    return () => {
      stop = true
    }
  }, [applied.survey, applied.user, applied.district, applied.date_from, applied.date_to])

  // Questions of the chosen survey drive the question/answer filter and the
  // per-question charts.
  useEffect(() => {
    let stop = false
    const chosen = surveys.find((x) => x.form_key === filters.survey)
    if (!chosen) {
      setQuestions([])
      return undefined
    }
    getSurvey(chosen.id)
      .then((res) => {
        if (stop) return
        const qs = res?.survey?.questions
        setQuestions(Array.isArray(qs) ? qs : [])
      })
      .catch(() => {
        if (!stop) setQuestions([])
      })
    return () => {
      stop = true
    }
  }, [filters.survey, surveys])

  const totals = data?.totals || {}

  // ── shape the API buckets into chart rows ────────────────────────────────
  const timeRows = useMemo(() => {
    const key = applied.grain === 'month' ? 'by_month' : 'by_day'
    const rows = Array.isArray(data?.[key]) ? [...data[key]] : []
    rows.reverse()
    return rows.map((r, i) => ({
      label: applied.grain === 'month' ? monthLabel(r.month) : dayLabel(r.date),
      total: Number(r.total) || 0,
      confirmed: Number(r.completed) || 0,
      pending: Number(r.pending) || 0,
      rejected: Number(r.rejected) || 0,
      // cumulative depth + per-point confirmed rate for the composed chart
      cum: rows.slice(0, i + 1).reduce((n, x) => n + (Number(x.total) || 0), 0),
      rate: Number(r.total) ? Math.round(((Number(r.completed) || 0) / Number(r.total)) * 100) : 0,
    }))
  }, [data, applied.grain])

  const userRows = useMemo(
    () => (Array.isArray(data?.by_user) ? data.by_user : []).map((r) => ({
      name: r.user || '—',
      total: Number(r.total) || 0,
      confirmed: Number(r.completed) || 0,
      pending: Number(r.pending) || 0,
      rejected: Number(r.rejected) || 0,
      media: Number(r.complete) || 0,
    })),
    [data],
  )

  const districtRows = useMemo(
    () => (Array.isArray(data?.by_district) ? data.by_district : []).map((r) => ({
      name: r.district || 'Unknown',
      total: Number(r.total) || 0,
      confirmed: Number(r.completed) || 0,
    })),
    [data],
  )

  // Radar: per-surveyor shape of work (top 6 by volume, normalized to max)
  const radarRows = useMemo(() => {
    const top = userRows.slice(0, 6)
    if (!top.length) return []
    const max = {
      total: Math.max(...top.map((u) => u.total), 1),
      confirmed: Math.max(...top.map((u) => u.confirmed), 1),
      media: Math.max(...top.map((u) => u.media), 1),
    }
    return top.map((u) => ({
      surveyor: u.name,
      Records: Math.round((u.total / max.total) * 100),
      Confirmed: Math.round((u.confirmed / max.confirmed) * 100),
      'Media OK': Math.round((u.media / max.media) * 100),
    }))
  }, [userRows])

  // Radial: quota completion per surveyor (needs targets from the users list)
  const quotaRows = useMemo(() => {
    const byName = new Map(users.map((u) => [u.display_name || u.username, Number(u.target_quota) || 0]))
    return userRows
      .map((u) => {
        const target = byName.get(u.name) || 0
        return {
          name: u.name,
          pct: target > 0 ? Math.min(100, Math.round((u.total / target) * 100)) : 0,
        }
      })
      .filter((u) => u.pct > 0)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 8)
      .map((u, i) => ({ ...u, fill: C[i % C.length] }))
  }, [userRows, users])

  // Sankey: Survey → Surveyor → Status record flow
  const sankeyData = useMemo(() => {
    const surveyName = surveys.find((s) => s.form_key === applied.survey)?.title || applied.survey || 'Survey'
    const nodes = [{ name: surveyName }]
    const links = []
    const statusAgg = { Confirmed: 0, Pending: 0, Rejected: 0 }
    userRows.slice(0, 6).forEach((u, i) => {
      nodes.push({ name: u.name })
      links.push({ source: 0, target: i + 1, value: u.total })
      statusAgg.Confirmed += u.confirmed
      statusAgg.Pending += u.pending
      statusAgg.Rejected += u.rejected
    })
    ;['Confirmed', 'Pending', 'Rejected'].forEach((st) => {
      nodes.push({ name: st })
    })
    userRows.slice(0, 6).forEach((u, i) => {
      if (u.confirmed) links.push({ source: i + 1, target: nodes.length - 3, value: u.confirmed })
      if (u.pending) links.push({ source: i + 1, target: nodes.length - 2, value: u.pending })
      if (u.rejected) links.push({ source: i + 1, target: nodes.length - 1, value: u.rejected })
    })
    return { nodes, links }
  }, [userRows, surveys, applied.survey])

  const statusPie = [
    { name: 'Confirmed', value: totals.completed || 0 },
    { name: 'Pending', value: totals.pending || 0 },
    { name: 'Rejected', value: totals.rejected || 0 },
  ]
  const mediaPie = [
    { name: 'Complete', value: totals.complete || 0 },
    { name: 'Incomplete', value: totals.incomplete || 0 },
    { name: 'Geo fail', value: totals.geo_fail || 0 },
    { name: 'Voice fail', value: totals.voice_fail || 0 },
    { name: 'Photo fail', value: totals.photo_fail || 0 },
  ]
  // Question answer charts — the heart of "survey depth": each question's
  // answer distribution in the current selection.
  // Question mode is on when any question is ticked (or a Question filter is
  // set) — the engine below then owns the chart area.
  const qPool = (Array.isArray(data?.by_question) ? data.by_question : [])
    .filter((q) => Array.isArray(q.options) && q.options.length > 0)
  const qChosen = applied.qid
    ? qPool.filter((q) => String(q.question_id) === String(applied.qid))
    : qPool.filter((q) => selectedQids.map(String).includes(String(q.question_id)))
  // Question mode: ticked questions (or a selected Question filter) own the
  // chart area; the generic overview charts step aside.
  const questionMode = qChosen.length > 0

  const partyRows = (Array.isArray(data?.by_party) ? data.by_party : []).map((r) => ({
    name: r.party || 'Unknown',
    value: Number(r.total) || 0,
  }))

  // ── Filter-adaptive chart selection ──────────────────────────────────────
  // 0 filters → whole-survey overview (cumulative area, sankey flow)
  // 1 filter → focused on that dimension (composed rate, comparisons)
  // 2+ filters → deep dive (radar, sankey, media quality join in)
  const activeFilters = [
    applied.survey && { k: 'Survey', v: surveys.find((x) => x.form_key === applied.survey)?.title || applied.survey },
    applied.user && { k: 'Surveyor', v: applied.user },
    applied.district && { k: 'District', v: applied.district },
    (applied.date_from || applied.date_to) && {
      k: 'Dates',
      v: `${applied.date_from || 'start'} → ${applied.date_to || 'today'}`,
    },
    applied.qid && applied.qval && {
      k: 'Answer',
      v: `${(questions.find((q) => String(q.id) === String(applied.qid))?.label || applied.qid).slice(0, 30)} = ${applied.qval}`,
    },
  ].filter(Boolean)
  const fc = activeFilters.length
  const showArea = fc === 0
  const showLine = true
  const showComposed = fc >= 1
  const showSurveyorBar = !applied.user && userRows.length > 1
  const showRadar = !applied.user && radarRows.length > 1 && fc >= 1
  const showQuota = quotaRows.length > 0
  const showSankey = !applied.user && sankeyData.links.length > 0 && (fc === 0 || fc >= 2)
  const showDistrictBar = !applied.district && districtRows.length > 0
  const showMediaPie = fc >= 1
  const recommendedCount = [showArea, showLine, showComposed, showSurveyorBar, showRadar, showQuota, showSankey, showDistrictBar, showMediaPie, partyRows.length > 0].filter(Boolean).length
  const modeNote = fc === 0
    ? 'No filters — whole-survey overview'
    : fc === 1
      ? `Focused view — 1 filter (${activeFilters[0].k}: ${activeFilters[0].v})`
      : `Deep dive — ${fc} filters applied`

  // Questions to filter = survey definition merged with live answered counts
  // (labels shown, data-backed options where the definition has none).
  const availableQuestions = useMemo(() => {
    const byId = new Map()
    for (const q of questions) {
      const id = String(q.id ?? q.label ?? '')
      if (!id) continue
      byId.set(id, {
        id,
        label: String(q.label || q.text || id),
        type: String(q.type || 'text'),
        options: Array.isArray(q.options)
          ? q.options
            .map((o) => String(typeof o === 'string' ? o : o?.label ?? o?.value ?? ''))
            .filter(Boolean)
          : [],
        answered: 0,
      })
    }
    const bq = Array.isArray(data?.by_question) ? data.by_question : []
    for (const item of bq) {
      const id = String(item.question_id)
      const prev = byId.get(id) || {
        id,
        label: String(item.label || id),
        type: String(item.type || 'text'),
        options: [],
        answered: 0,
      }
      prev.answered = Number(item.answered) || 0
      if (!prev.options.length) {
        prev.options = (Array.isArray(item.options) ? item.options : []).map((o) => String(o.value)).filter(Boolean)
      }
      if (!prev.label || prev.label === id) prev.label = String(item.label || id)
      byId.set(id, prev)
    }
    return [...byId.values()].sort((a, b) => b.answered - a.answered)
  }, [questions, data])

  // Engine questions for the ticked ids (id + text + field), with chart meta.
  const engineQuestions = useMemo(
    () => availableQuestions
      .filter((q) => selectedQids.map(String).includes(String(q.id)))
      .map((q) => ({ id: String(q.id), text: String(q.label || q.id), field: String(q.id) })),
    [availableQuestions, selectedQids],
  )
  const engineMeta = useMemo(() => buildMeta(availableQuestions), [availableQuestions])

  const insights = useMemo(
    () => buildInsights({ totals, timeRows, userRows, districtRows, partyRows, quotaRows, applied, fc, users, byQuestion: data?.by_question }),
    [totals, timeRows, userRows, districtRows, partyRows, quotaRows, applied, fc, users, data],
  )

  const rate = (n) => (totals.records ? Math.round(((n || 0) / totals.records) * 100) : 0)

  return (
    <div>
      <FilterBar
        surveys={surveys}
        users={users}
        questions={availableQuestions}
        selectedQids={selectedQids}
        setSelectedQids={setSelectedQids}

        filters={filters}
        setFilters={setFilters}
        onApply={() => void load(filters)}
        onReset={() => {
          const reset = { survey: surveys[0]?.form_key || '', user: '', district: '', date_from: '', date_to: '', grain: 'day', qid: '', qval: '' }
          setFilters(reset)
          void load(reset)
        }}
        loading={loading}
      />

      {err ? <div className="card" style={{ padding: 14, color: 'var(--danger)', marginBottom: 14 }}>{err}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
        {[
          { k: 'Records', v: totals.records || 0 },
          { k: 'Confirmed', v: `${totals.completed || 0} · ${rate(totals.completed)}%` },
          { k: 'Pending', v: `${totals.pending || 0} · ${rate(totals.pending)}%` },
          { k: 'Rejected', v: `${totals.rejected || 0} · ${rate(totals.rejected)}%` },
          { k: 'Media complete', v: `${totals.complete || 0} · ${rate(totals.complete)}%` },
          { k: 'Surveyors active', v: (data?.by_user || []).length },
          { k: 'Districts covered', v: (data?.by_district || []).length },
        ].map((c) => (
          <div className="card" key={c.k} style={{ padding: '10px 12px', textAlign: 'center' }}>
            <div className="muted" style={{ fontSize: 11 }}>{c.k}</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{c.v}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: '10px 14px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <strong style={{ fontSize: 13 }}>{modeNote}</strong>
        <span className="muted" style={{ fontSize: 12 }}>· {recommendedCount} recommended charts</span>
        {fc > 0 && activeFilters.map((f) => (
          <span key={f.k} style={{ fontSize: 11, background: '#eef3fb', color: '#3f6cbe', fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>
            {f.k}: {f.v}
          </span>
        ))}
      </div>

      {/* QUESTION ANSWER CHARTS — one per ticked question (up to No. of charts) */}
      {engineQuestions.length === 0 && !applied.qid && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span aria-hidden="true">📋</span>
          <span className="muted" style={{ fontSize: 12 }}>
            Tick one or more <strong>Questions to chart</strong> above — each ticked question gets its answer-distribution graph.
          </span>
        </div>
      )}
      {engineQuestions.length > 0 && (
        <>
          <div className="card" style={{ padding: '10px 14px', marginBottom: 14 }}>
            <h3 style={{ margin: '0 0 2px', fontSize: 15 }}>📋 Question analytics — {engineQuestions.length} question{engineQuestions.length > 1 ? 's' : ''}</h3>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Suggested charts per question (tap a type, or cross by District / Surveyor / Status / Month) · {answerLoading ? 'loading answers…' : `${answerRows.length} answer records`}
              {activeFilters.length
                ? ` · survey filters: ${activeFilters.map((f) => `${f.k}: ${f.v}`).join(', ')}`
                : ' · whole survey'}
            </p>
          </div>
          {answerLoading ? (
            <div className="card" style={{ padding: 16 }}>Loading answers…</div>
          ) : (
            <QuestionAnalytics rows={answerRows} questions={engineQuestions} meta={engineMeta} />
          )}
        </>
      )}

      {!questionMode && (<>
      {showArea && (<>
      {/* AREA — cumulative collection depth */}
      <Card title="Area — cumulative depth" subtitle="Total records piled up over the selected period (gradient area, EvilCharts style).">
        <AreaChart data={timeRows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="gCum2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4472C4" stopOpacity={0.55} />
              <stop offset="95%" stopColor="#4472C4" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} />
          <Area type="monotone" dataKey="cum" name="Cumulative records" stroke="#4472C4" strokeWidth={2.5} fill="url(#gCum2)" />
        </AreaChart>
      </Card>
      </>)}

      {/* LINE — daily trend by status */}
      <Card title="Line — records over time" subtitle="All / confirmed / pending / rejected per period.">
        <LineChart data={timeRows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="total" name="All" stroke={C[0]} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
          <Line type="monotone" dataKey="confirmed" name="Confirmed" stroke={C[5]} strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="pending" name="Pending" stroke={C[3]} strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="rejected" name="Rejected" stroke={C[2]} strokeWidth={2} dot={false} />
        </LineChart>
      </Card>

      {showComposed && (<>
            {/* COMPOSED — volume bars + confirmation-rate line on second axis */}
      <Card title="Composed — volume vs confirmation rate" subtitle="Bars: records per period · Line: % confirmed (right axis).">
        <ComposedChart data={timeRows} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis yAxisId="vol" {...axisProps} />
          <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} unit="%" {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="vol" dataKey="total" name="Records" fill="#4472C4" radius={[5, 5, 0, 0]} maxBarSize={34} />
          <Line yAxisId="pct" type="monotone" dataKey="rate" name="Confirmed %" stroke="#ED7D31" strokeWidth={2.5} dot={{ r: 3 }} />
        </ComposedChart>
      </Card>
      </>)}

      {showSurveyorBar && (<>
            {/* BAR — surveyor performance stacked */}
      <Card title="Bar — surveyor performance" subtitle="Records per surveyor, stacked by status (rounded, Excel palette).">
        <BarChart data={userRows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="name" {...axisProps} interval={0} angle={-24} textAnchor="end" height={62} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="confirmed" name="Confirmed" stackId="s" fill={C[5]} radius={[0, 0, 0, 0]} maxBarSize={38} />
          <Bar dataKey="pending" name="Pending" stackId="s" fill={C[3]} maxBarSize={38} />
          <Bar dataKey="rejected" name="Rejected" stackId="s" fill={C[2]} radius={[5, 5, 0, 0]} maxBarSize={38} />
        </BarChart>
      </Card>
      </>)}

      {/* PIE — status mix */}
      <Card title="Pie — status mix" subtitle="Share of confirmed / pending / rejected in the current selection." height={280}>
        <PieChart>
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Pie data={statusPie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={3} strokeWidth={2} label={(e) => `${e.value}`}>
            {statusPie.map((_, i) => <Cell key={i} fill={[C[5], C[3], C[2]][i]} />)}
          </Pie>
        </PieChart>
      </Card>

      {showRadar && (<>
            {/* RADAR — surveyor work shape */}
      <Card title="Radar — surveyor coverage shape" subtitle="Top surveyors, each axis normalized to 100%: records, confirmed, media-OK.">
        <RadarChart data={radarRows} outerRadius="72%">
          <PolarGrid stroke="#e2e8f0" />
          <PolarAngleAxis dataKey="surveyor" tick={{ fontSize: 11, fill: '#475569' }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Radar name="Records" dataKey="Records" stroke={C[0]} fill={C[0]} fillOpacity={0.28} />
          <Radar name="Confirmed" dataKey="Confirmed" stroke={C[5]} fill={C[5]} fillOpacity={0.22} />
          <Radar name="Media OK" dataKey="Media OK" stroke={C[1]} fill={C[1]} fillOpacity={0.18} />
        </RadarChart>
      </Card>
      </>)}

      {showQuota && (<>
            {/* RADIAL — quota completion */}
      <Card title="Radial — quota completion" subtitle="Surveyor progress toward assigned target (100% = quota reached)." height={280}>
        {quotaRows.length ? (
          <RadialBarChart data={quotaRows} innerRadius="22%" outerRadius="98%" startAngle={90} endAngle={-270}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar dataKey="pct" background={{ fill: '#eef2f7' }} cornerRadius={8} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v, _n, p) => [`${v}% of quota`, p?.payload?.name]} />
          </RadialBarChart>
        ) : (
          <div className="muted" style={{ textAlign: 'center', paddingTop: 90 }}>No quotas set — set targets per surveyor to see completion rings.</div>
        )}
      </Card>
      </>)}

      {showSankey && (<>
            {/* SANKEY — survey → surveyor → status flow */}
      <Card title="Sankey — record flow" subtitle={`How records flow: ${applied.survey || 'survey'} → surveyor → outcome (top 6 surveyors).`} height={340}>
        {sankeyData.links.length ? (
          <Sankey data={sankeyData} nodePadding={18} nodeWidth={12} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
            <Tooltip contentStyle={tooltipStyle} />
          </Sankey>
        ) : (
          <div className="muted" style={{ textAlign: 'center', paddingTop: 110 }}>No records in this selection.</div>
        )}
      </Card>
      </>)}

      {showDistrictBar && (<>
            {/* BAR — district coverage */}
      <Card title="Bar — district coverage" subtitle="Where the survey is reaching, confirmed overlay.">
        <BarChart data={districtRows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="name" {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="total" name="Records" fill={C[0]} radius={[5, 5, 0, 0]} maxBarSize={44} />
          <Bar dataKey="confirmed" name="Confirmed" fill={C[5]} radius={[5, 5, 0, 0]} maxBarSize={44} />
        </BarChart>
      </Card>
      </>)}

      {showMediaPie && (<>
            {/* PIE — media quality */}
      <Card title="Pie — media quality" subtitle="Geo-tag / voice / photo verification outcomes for these records." height={280}>
        <PieChart>
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Pie data={mediaPie} dataKey="value" nameKey="name" outerRadius={95} strokeWidth={2} label={(e) => `${e.value}`}>
            {mediaPie.map((_, i) => <Cell key={i} fill={C[i % C.length]} />)}
          </Pie>
        </PieChart>
      </Card>
      </>)}

      {partyRows.length ? (
        <Card title="Pie — winning party responses" subtitle="Answer distribution for the winning-party question." height={280}>
          <PieChart>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Pie data={partyRows} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={3} strokeWidth={2} label={(e) => `${e.value}`}>
              {partyRows.map((_, i) => <Cell key={i} fill={C[i % C.length]} />)}
            </Pie>
          </PieChart>
        </Card>
      ) : null}

      </>)}
      {/* DEPTH ANALYSIS — auto-generated reading of the selection */}
      <div className="card" style={{ padding: 14, borderLeft: '4px solid #4472C4' }}>
        <h3 style={{ margin: '0 0 2px', fontSize: 15 }}>🔍 Depth analysis</h3>
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>
          Auto-generated from the {fc === 0 ? 'whole survey' : `${fc} active filter${fc > 1 ? 's' : ''}`} — updates with Apply.
        </p>
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {insights.map((ins, i) => (
            <li
              key={i}
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                color: ins.tone === 'warn' ? '#92400e' : ins.tone === 'good' ? '#166534' : ins.tone === 'muted' ? '#64748b' : '#1e293b',
              }}
            >
              <span aria-hidden="true">{ins.icon}</span>
              <span>{ins.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
