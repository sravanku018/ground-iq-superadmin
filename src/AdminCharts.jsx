/**
 * Excel-style Charts tab — stack filters, see the depth of the survey.
 * Data: /api/admin/analyze (totals, by_date/month/user/district/party).
 * Charts: hand-rolled SVG (Charts.jsx) — bar, line, pie, all filter-driven.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAdminAnalyze, listSurveys, listUsers } from './api'
import { BarChart, LineChart, PieChart, dayLabel, monthLabel } from './components/Charts'

const STATUS_SERIES = [
  { key: 'total', label: 'All records' },
  { key: 'completed', label: 'Confirmed' },
  { key: 'pending', label: 'Pending' },
  { key: 'rejected', label: 'Rejected' },
]

function FilterBar({ surveys, users, filters, setFilters, onApply, loading, onReset }) {
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))
  return (
    <div className="card" style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: 11 }}>Survey</span>
          <select value={filters.survey} onChange={set('survey')}>
            <option value="">All surveys</option>
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
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <div className="card" style={{ padding: 14, marginBottom: 14 }}>
      <h3 style={{ margin: '0 0 2px', fontSize: 15 }}>{title}</h3>
      {subtitle ? <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>{subtitle}</p> : null}
      {children}
    </div>
  )
}

export default function AdminCharts() {
  const [filters, setFilters] = useState({
    survey: '', user: '', district: '', date_from: '', date_to: '', grain: 'day',
  })
  const [applied, setApplied] = useState(filters)
  const [data, setData] = useState(null)
  const [surveys, setSurveys] = useState([])
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
    void load(filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totals = data?.totals || {}
  const timeKey = applied.grain === 'month' ? 'by_month' : 'by_day'
  const timeRows = useMemo(() => {
    const rows = Array.isArray(data?.[timeKey]) ? [...data[timeKey]] : []
    rows.reverse() // oldest → newest for time axis
    return rows.map((r) => ({
      label: applied.grain === 'month' ? monthLabel(r.month) : dayLabel(r.date),
      total: Number(r.total) || 0,
      completed: Number(r.completed) || 0,
      pending: Number(r.pending) || 0,
      rejected: Number(r.rejected) || 0,
    }))
  }, [data, timeKey, applied.grain])

  const userRows = useMemo(
    () => (Array.isArray(data?.by_user) ? data.by_user : []).map((r) => ({
      label: r.user || '—',
      total: Number(r.total) || 0,
      completed: Number(r.completed) || 0,
      pending: Number(r.pending) || 0,
      rejected: Number(r.rejected) || 0,
    })),
    [data],
  )

  const districtRows = useMemo(
    () => (Array.isArray(data?.by_district) ? data.by_district : []).map((r) => ({
      label: r.district || 'Unknown',
      total: Number(r.total) || 0,
      completed: Number(r.completed) || 0,
      pending: Number(r.pending) || 0,
    })),
    [data],
  )

  const partyRows = useMemo(
    () => (Array.isArray(data?.by_party) ? data.by_party : []).map((r) => ({
      label: r.party || 'Unknown',
      value: Number(r.total) || 0,
    })),
    [data],
  )

  const statusPie = [
    { label: 'Confirmed', value: totals.completed || 0 },
    { label: 'Pending', value: totals.pending || 0 },
    { label: 'Rejected', value: totals.rejected || 0 },
  ]
  const mediaPie = [
    { label: 'Complete (geo+voice+photo)', value: totals.complete || 0 },
    { label: 'Incomplete', value: totals.incomplete || 0 },
    { label: 'Geo fail', value: totals.geo_fail || 0 },
    { label: 'Voice fail', value: totals.voice_fail || 0 },
    { label: 'Photo fail', value: totals.photo_fail || 0 },
  ]

  const rate = (n) => (totals.records ? Math.round(((n || 0) / totals.records) * 100) : 0)

  return (
    <div>
      <FilterBar
        surveys={surveys}
        users={users}
        filters={filters}
        setFilters={setFilters}
        onApply={() => void load(filters)}
        onReset={() => {
          const reset = { survey: '', user: '', district: '', date_from: '', date_to: '', grain: 'day' }
          setFilters(reset)
          void load(reset)
        }}
        loading={loading}
      />

      {err ? (
        <div className="card" style={{ padding: 14, color: 'var(--danger)', marginBottom: 14 }}>{err}</div>
      ) : null}

      {/* Depth summary */}
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

      <Section title="Records over time" subtitle={`Depth of collection ${applied.grain === 'month' ? 'per month' : 'per day'} — all / confirmed / pending / rejected, with current filters applied.`}>
        {applied.grain === 'month'
          ? <BarChart data={timeRows} series={STATUS_SERIES} stacked />
          : <LineChart data={timeRows} series={STATUS_SERIES} />}
        <div style={{ textAlign: 'center', marginTop: 6 }}>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              const next = { ...filters, grain: filters.grain === 'day' ? 'month' : 'day' }
              setFilters(next)
              void load(next)
            }}
          >
            Switch to {filters.grain === 'day' ? 'monthly' : 'daily'} view
          </button>
        </div>
      </Section>

      <Section title="Surveyor performance" subtitle="Records per surveyor, stacked by status — who is covering what.">
        <BarChart data={userRows} xKey="label" series={STATUS_SERIES} stacked maxBars={14} />
      </Section>

      <Section title="District coverage" subtitle="Where the survey is reaching — records per district, split by status.">
        {districtRows.length
          ? <BarChart data={districtRows} xKey="label" series={[{ key: 'total', label: 'Records' }, { key: 'completed', label: 'Confirmed' }]} maxBars={14} />
          : <p className="muted" style={{ fontSize: 13 }}>No district data in this selection.</p>}
      </Section>

      <Section title="Status mix" subtitle="Share of confirmed / pending / rejected in the current selection.">
        <PieChart data={statusPie} />
      </Section>

      <Section title="Media quality (field depth)" subtitle="Geo-tag, voice and photo verification outcomes for these records.">
        <PieChart data={mediaPie} />
      </Section>

      {partyRows.length ? (
        <Section title="Winning party responses" subtitle="Answer distribution for the winning-party question, current filters applied.">
          <PieChart data={partyRows} />
        </Section>
      ) : null}
    </div>
  )
}
