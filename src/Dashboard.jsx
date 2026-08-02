import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
  RadialBarChart,
  RadialBar,
} from 'recharts'
import { getAnalytics } from './api'
import SurveyMap from './SurveyMap'

const PARTY_COLORS = {
  Congress: '#16a34a',
  BJP: '#f97316',
  BRS: '#ec4899',
  Others: '#94a3b8',
  Undecided: '#64748b',
  Unknown: '#475569',
}

const PALETTE = [
  '#00e599',
  '#38bdf8',
  '#a78bfa',
  '#f472b6',
  '#fbbf24',
  '#34d399',
  '#fb7185',
  '#60a5fa',
  '#c084fc',
  '#2dd4bf',
  '#f59e0b',
  '#e879f9',
]

function colorFor(name, i = 0) {
  return PARTY_COLORS[name] || PALETTE[i % PALETTE.length]
}

function ChartCard({ title, subtitle, children, tall }) {
  return (
    <section className={`chart-card ${tall ? 'tall' : ''}`}>
      <header className="chart-head">
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>
      <div className="chart-body">{children}</div>
    </section>
  )
}

function EmptyChart({ label = 'No data for current filters' }) {
  return <div className="chart-empty">{label}</div>
}

/** Super-set / Sub-set dual bars */
function ContrastBars({ data }) {
  if (!data?.length) return <EmptyChart label="Apply a filter to see Subset vs Rest" />
  return (
    <div className="contrast-list">
      {data.slice(0, 10).map((d) => (
        <div key={d.name} className="contrast-row">
          <div className="contrast-head">
            <span className="contrast-name">{d.name}</span>
            <span
              className={`contrast-delta ${d.delta > 0 ? 'up' : d.delta < 0 ? 'down' : ''}`}
            >
              {d.delta > 0 ? '+' : ''}
              {d.delta}pp
              {d.index != null ? ` · idx ${d.index}` : ''}
            </span>
          </div>
          <div className="contrast-bars">
            <div className="contrast-bar-wrap">
              <div
                className="contrast-bar sel"
                style={{ width: `${Math.min(d.selected, 100)}%` }}
              />
              <span>{d.selected}%</span>
            </div>
            <div className="contrast-bar-wrap">
              <div
                className="contrast-bar rest"
                style={{ width: `${Math.min(d.rest, 100)}%` }}
              />
              <span>{d.rest}%</span>
            </div>
          </div>
          <div className="contrast-legend">
            <span className="sel">■ Subset</span>
            <span className="rest">■ Rest</span>
          </div>
        </div>
      ))}
    </div>
  )
}

const tipStyle = {
  background: '#0f1720',
  border: '1px solid #2a3648',
  borderRadius: 10,
  fontSize: 12,
}

function PctTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  return (
    <div className="recharts-custom-tip" style={{ ...tipStyle, padding: '8px 10px' }}>
      <div style={{ color: '#e2e8f0', fontWeight: 700 }}>{label || p?.name}</div>
      {payload.map((item) => (
        <div key={item.dataKey} style={{ color: item.color || '#94a3b8' }}>
          {item.name}: {item.value}
          {p?.pct != null && item.dataKey === 'value' ? ` (${p.pct}%)` : ''}
        </div>
      ))}
    </div>
  )
}

function InteractivePie({ data, onSliceClick, activeName }) {
  if (!data?.length) return <EmptyChart />
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={52}
          outerRadius={86}
          paddingAngle={2}
          onClick={(entry) => onSliceClick?.(entry?.name)}
          style={{ cursor: onSliceClick ? 'pointer' : 'default' }}
        >
          {data.map((d, i) => (
            <Cell
              key={d.name}
              fill={colorFor(d.name, i)}
              stroke={activeName === d.name ? '#fff' : 'transparent'}
              strokeWidth={activeName === d.name ? 2 : 0}
              opacity={activeName && activeName !== d.name ? 0.35 : 1}
            />
          ))}
        </Pie>
        <Tooltip content={<PctTooltip />} />
        <Legend
          verticalAlign="bottom"
          height={36}
          formatter={(v) => <span style={{ color: '#94a3b8', fontSize: 11 }}>{v}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

function HBar({ data, onBarClick, activeName, colorKey }) {
  if (!data?.length) return <EmptyChart />
  const height = Math.max(200, data.length * 28 + 40)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#243041" horizontal={false} />
        <XAxis type="number" stroke="#64748b" fontSize={11} />
        <YAxis
          type="category"
          dataKey="name"
          width={92}
          stroke="#94a3b8"
          fontSize={11}
          tickLine={false}
        />
        <Tooltip content={<PctTooltip />} />
        <Bar
          dataKey="value"
          radius={[0, 6, 6, 0]}
          onClick={(entry) => onBarClick?.(entry?.name || entry?.payload?.name)}
          cursor={onBarClick ? 'pointer' : 'default'}
        >
          {data.map((d, i) => (
            <Cell
              key={d.name}
              fill={colorKey ? colorFor(d.name, i) : colorFor(d.name, i)}
              opacity={activeName && activeName !== d.name ? 0.3 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function StackedParty({ matrix, onRowClick, activeName }) {
  if (!matrix?.rows?.length) return <EmptyChart />
  const cols = (matrix.columns || []).filter((c) => c)
  const data = matrix.rows.slice(0, 10)
  const height = Math.max(220, data.length * 32 + 50)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12, top: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#243041" horizontal={false} />
        <XAxis type="number" stroke="#64748b" fontSize={11} />
        <YAxis
          type="category"
          dataKey="name"
          width={88}
          stroke="#94a3b8"
          fontSize={11}
          tickLine={false}
        />
        <Tooltip
          contentStyle={tipStyle}
          labelStyle={{ color: '#e2e8f0' }}
          itemStyle={{ fontSize: 12 }}
        />
        <Legend
          formatter={(v) => <span style={{ color: '#94a3b8', fontSize: 11 }}>{v}</span>}
        />
        {cols.map((col) => (
          <Bar
            key={col}
            dataKey={col}
            stackId="p"
            fill={colorFor(col)}
            onClick={(entry) => onRowClick?.(entry?.payload?.name)}
            cursor={onRowClick ? 'pointer' : 'default'}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function Timeline({ data }) {
  if (!data?.length) return <EmptyChart label="No timeline data yet" />
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00e599" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#00e599" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#243041" />
        <XAxis
          dataKey="date"
          stroke="#64748b"
          fontSize={10}
          tickFormatter={(v) => (v || '').slice(5)}
          minTickGap={24}
        />
        <YAxis stroke="#64748b" fontSize={11} width={32} />
        <Tooltip contentStyle={tipStyle} labelStyle={{ color: '#e2e8f0' }} />
        <Area
          type="monotone"
          dataKey="count"
          stroke="#00e599"
          fill="url(#volGrad)"
          strokeWidth={2}
          name="Responses"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function RadialIssues({ data, onClick, activeName }) {
  if (!data?.length) return <EmptyChart />
  const chartData = data.slice(0, 7).map((d, i) => ({
    ...d,
    fill: colorFor(d.name, i + 2),
  }))
  return (
    <ResponsiveContainer width="100%" height={240}>
      <RadialBarChart
        cx="50%"
        cy="50%"
        innerRadius="18%"
        outerRadius="100%"
        data={chartData}
        startAngle={90}
        endAngle={-270}
      >
        <RadialBar
          minAngle={8}
          background={{ fill: '#1a2330' }}
          clockWise
          dataKey="value"
          cornerRadius={6}
          onClick={(entry) => onClick?.(entry?.name || entry?.payload?.name)}
        />
        <Legend
          iconSize={8}
          layout="vertical"
          verticalAlign="middle"
          align="right"
          formatter={(v) => <span style={{ color: '#94a3b8', fontSize: 10 }}>{v}</span>}
        />
        <Tooltip content={<PctTooltip />} />
      </RadialBarChart>
    </ResponsiveContainer>
  )
}

export default function DashboardScreen({ onToast }) {
  // Report is LOCKED to Client Admin confirmed data only — never pending/raw
  const [filters, setFilters] = useState({
    district: '',
    party: '',
    gender: '',
    caste: '',
    constituency: '',
    user: '',
    survey: '',
    period: 'total', // total | today | day | month
    day: new Date().toISOString().slice(0, 10),
    month: new Date().toISOString().slice(0, 7),
  })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [surveys, setSurveys] = useState([])

  useEffect(() => {
    import('./api').then(({ listSurveys }) =>
      listSurveys()
        .then((d) => setSurveys(d.items || []))
        .catch(() => {}),
    )
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = {
        district: filters.district,
        party: filters.party,
        gender: filters.gender,
        caste: filters.caste,
        constituency: filters.constituency,
        user: filters.user,
        survey: filters.survey,
        period: filters.period || 'total',
      }
      // Dynamic per-question filters (q_<questionId>)
      Object.entries(filters)
        .filter(([k, v]) => k.startsWith('q_') && v)
        .forEach(([k, v]) => (params[k] = v))
      if (filters.period === 'day') params.day = filters.day
      if (filters.period === 'month') params.month = filters.month
      const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v))
      // Hard lock: only Client Admin confirmed + complete records form charts
      const res = await getAnalytics({
        ...clean,
        status: 'confirmed',
        completeness: 'complete',
        report: 'locked',
      })
      setData(res)
    } catch (e) {
      setError(e.message)
      onToast?.(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [filters, onToast])

  useEffect(() => {
    const t = setTimeout(load, 180)
    return () => clearTimeout(t)
  }, [load])

  const setFilter = (key, value) => {
    setFilters((f) => ({
      ...f,
      [key]: f[key] === value ? '' : value,
    }))
  }

  const clearFilters = () =>
    setFilters({
      district: '',
      party: '',
      gender: '',
      caste: '',
      constituency: '',
      user: '',
      survey: '',
      period: 'total',
      day: new Date().toISOString().slice(0, 10),
      month: new Date().toISOString().slice(0, 7),
    })

  const activeCount = useMemo(
    () =>
      Object.entries(filters).filter(
        ([k, v]) => v && k !== 'period' && k !== 'day' && k !== 'month' && !(k === 'period' && v === 'total'),
      ).length + (filters.period && filters.period !== 'total' ? 1 : 0),
    [filters],
  )

  const charts = data?.charts
  const opts = data?.filterOptions
  const confirmedCount = data?.statusCounts?.confirmed ?? data?.totalAll ?? 0
  const reportReady = !loading && data && (data.totalAll || 0) > 0
  const reportLocked = !loading && data && (data.totalAll || 0) === 0

  const filtersBroken =
    data &&
    activeCount > 0 &&
    data.filtered === data.totalAll &&
    !data.isFiltered &&
    !(opts?.districts?.length > 0)

  return (
    <div className="screen dashboard-screen">
      <header className="screen-head row">
        <div>
          <h2>Report analytics</h2>
          <p>
            {loading && !data
              ? 'Loading…'
              : reportLocked
                ? 'Locked until Client Admin confirms'
                : data
                  ? `${data.filtered.toLocaleString()} confirmed · daily / monthly / surveyor boards`
                  : 'Confirmed data only'}
          </p>
        </div>
        <button type="button" className="btn small" onClick={load} disabled={loading}>
          {loading ? '…' : 'Refresh'}
        </button>
      </header>

      <div className="card" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
          <strong>Dashboard does not form</strong> until Client Admin confirms records
          (strict complete: geo + voice + photo + Q/A). Pending data stays out of charts.
        </p>
        {data?.statusCounts && (
          <p style={{ margin: '0 0 8px', fontSize: 13 }}>
            Waiting confirm <strong>{data.statusCounts.pending}</strong>
            {' · '}
            Confirmed <strong>{data.statusCounts.confirmed}</strong>
            {' · '}
            In this report <strong>{data.totalAll ?? 0}</strong>
          </p>
        )}
      </div>

      {/* LOCK: no charts / maps until confirmed data exists */}
      {reportLocked && (
        <div className="card" style={{ marginBottom: 14, textAlign: 'center', padding: 24 }}>
          <div className="pill bad" style={{ marginBottom: 12 }}>
            <span className="dot" />
            Report locked
          </div>
          <h3 style={{ margin: '0 0 8px' }}>No confirmed data yet</h3>
          <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
            Charts, maps and KPIs stay empty until Client Admin opens{' '}
            <strong>Analyze / Review</strong>, verifies geo + voice, and taps{' '}
            <strong>Confirm complete</strong>.
          </p>
          <p style={{ fontSize: 13, margin: 0 }}>
            Pending in queue / review:{' '}
            <strong>{data?.statusCounts?.pending ?? '—'}</strong>
            {confirmedCount === 0 ? ' · confirmed: 0' : ''}
          </p>
        </div>
      )}

      {reportReady && (
        <div className="card" style={{ marginBottom: 12 }}>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
            Confirmed data only · filter by <strong>user</strong>, <strong>day</strong>,{' '}
            <strong>month</strong>, or <strong>total</strong>
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {[
              { id: 'total', label: 'Total data' },
              { id: 'today', label: 'Today' },
              { id: 'day', label: 'Day' },
              { id: 'month', label: 'Month' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                className={`chip ${filters.period === p.id ? 'selected' : ''}`}
                onClick={() => setFilters((f) => ({ ...f, period: p.id }))}
              >
                {p.label}
              </button>
            ))}
          </div>
          {filters.period === 'day' && (
            <label className="field compact">
              <span>Day</span>
              <input
                type="date"
                value={filters.day}
                onChange={(e) => setFilters((f) => ({ ...f, day: e.target.value }))}
              />
            </label>
          )}
          {filters.period === 'month' && (
            <label className="field compact">
              <span>Month</span>
              <input
                type="month"
                value={filters.month}
                onChange={(e) => setFilters((f) => ({ ...f, month: e.target.value }))}
              />
            </label>
          )}
          <label className="field compact">
            <span>By survey</span>
            <select
              value={filters.survey}
              onChange={(e) => {
                const survey = e.target.value
                // Changing survey clears old per-question filters
                const drop = Object.fromEntries(
                  Object.entries(filters).filter(([k]) => !k.startsWith('q_')),
                )
                setFilters((f) => ({ ...drop, ...f, survey }))
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
          {data?.dataFilters?.questions?.map((q) => (
            <label className="field compact" key={q.id}>
              <span>{q.label}</span>
              <select
                value={filters[`q_${q.id}`] || ''}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, [`q_${q.id}`]: e.target.value }))
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
          <label className="field compact">
            <span>By user</span>
            <select
              value={filters.user}
              onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value }))}
            >
              <option value="">All users</option>
              {(opts?.users || data?.dataFilters?.by_user?.map((u) => u.name) || []).map(
                (u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ),
              )}
            </select>
          </label>
          {activeCount > 0 && (
            <button type="button" className="btn small" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* After confirmed data: Daily · Monthly · Surveyor daily · Surveyor monthly */}
      {reportReady && data?.dataFilters && (
        <div className="data-boards" style={{ marginBottom: 14 }}>
          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>
              Confirmed data summary ·{' '}
              {(data.dataFilters.total ?? data.totalAll)?.toLocaleString?.() ?? data.totalAll}{' '}
              records
            </h3>
            <div className="stat-row">
              <div className="stat">
                <strong>{data.dataFilters.by_user?.length ?? 0}</strong>
                <span>Surveyors</span>
              </div>
              <div className="stat">
                <strong>{data.dataFilters.by_day?.length ?? 0}</strong>
                <span>Days</span>
              </div>
              <div className="stat">
                <strong>{data.dataFilters.by_month?.length ?? 0}</strong>
                <span>Months</span>
              </div>
              <div className="stat">
                <strong>{data.dataFilters.period || 'total'}</strong>
                <span>Period filter</span>
              </div>
            </div>
          </div>

          {/* 1. Daily data */}
          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Daily data</h3>
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              Confirmed surveys per calendar day
            </p>
            {!data.dataFilters.by_day?.length ? (
              <p className="muted">No daily rows yet.</p>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Records</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dataFilters.by_day.slice(0, 31).map((d) => (
                      <tr key={d.name}>
                        <td>
                          <strong>{d.name}</strong>
                        </td>
                        <td>{d.value}</td>
                        <td>
                          <button
                            type="button"
                            className="btn small"
                            onClick={() =>
                              setFilters((f) => ({ ...f, period: 'day', day: d.name }))
                            }
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 2. Monthly data */}
          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Monthly data</h3>
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              Confirmed surveys per month
            </p>
            {!data.dataFilters.by_month?.length ? (
              <p className="muted">No monthly rows yet.</p>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Records</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dataFilters.by_month.slice(0, 24).map((m) => (
                      <tr key={m.name}>
                        <td>
                          <strong>{m.name}</strong>
                        </td>
                        <td>{m.value}</td>
                        <td>
                          <button
                            type="button"
                            className="btn small"
                            onClick={() =>
                              setFilters((f) => ({
                                ...f,
                                period: 'month',
                                month: m.name,
                              }))
                            }
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 3. Surveyor daily data */}
          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Surveyor daily data</h3>
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              Each surveyor · each day
            </p>
            {!(data.dataFilters.by_surveyor_day?.length || data.dataFilters.by_user?.length) ? (
              <p className="muted">No surveyor daily rows yet.</p>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Surveyor</th>
                      <th>Day</th>
                      <th>Records</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.dataFilters.by_surveyor_day || []).slice(0, 60).map((r) => (
                      <tr key={`${r.surveyor}-${r.day}`}>
                        <td>
                          <strong>{r.surveyor}</strong>
                        </td>
                        <td>{r.day}</td>
                        <td>{r.value}</td>
                        <td>
                          <button
                            type="button"
                            className="btn small"
                            onClick={() =>
                              setFilters((f) => ({
                                ...f,
                                user: r.surveyor,
                                period: 'day',
                                day: r.day,
                              }))
                            }
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.dataFilters.by_surveyor_day?.length && (
                  <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                    Redeploy Deno API to load surveyor×day breakdown. Totals by user still
                    available below.
                  </p>
                )}
              </div>
            )}
            {data.dataFilters.by_user?.length > 0 && (
              <>
                <h4 style={{ margin: '12px 0 6px' }}>By surveyor (total)</h4>
                <ul className="user-list">
                  {data.dataFilters.by_user.slice(0, 20).map((u) => (
                    <li key={u.name}>
                      <strong>{u.name}</strong>
                      <span className="meta">
                        {' '}
                        {u.value} ({u.pct}%)
                      </span>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => setFilters((f) => ({ ...f, user: u.name }))}
                      >
                        Filter
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* 4. Surveyor monthly data */}
          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Surveyor monthly data</h3>
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              Each surveyor · each month
            </p>
            {!data.dataFilters.by_surveyor_month?.length ? (
              <p className="muted">
                No surveyor monthly rows yet
                {data.dataFilters.by_user?.length
                  ? ' — redeploy Deno API for this table.'
                  : '.'}
              </p>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Surveyor</th>
                      <th>Month</th>
                      <th>Records</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dataFilters.by_surveyor_month.slice(0, 60).map((r) => (
                      <tr key={`${r.surveyor}-${r.month}`}>
                        <td>
                          <strong>{r.surveyor}</strong>
                        </td>
                        <td>{r.month}</td>
                        <td>{r.value}</td>
                        <td>
                          <button
                            type="button"
                            className="btn small"
                            onClick={() =>
                              setFilters((f) => ({
                                ...f,
                                user: r.surveyor,
                                period: 'month',
                                month: r.month,
                              }))
                            }
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {error && <div className="banner error">{error}</div>}
      {filtersBroken && reportReady && (
        <div className="banner error" role="alert">
          Filters did not apply. Redeploy Deno API if this persists.
        </div>
      )}

      {/* KPI strip — only after confirm */}
      {reportReady && data && (
        <div className="kpi-strip">
          <div className="kpi">
            <strong>{data.filtered.toLocaleString()}</strong>
            <span>Filtered</span>
          </div>
          <div className="kpi">
            <strong>{data.totalAll.toLocaleString()}</strong>
            <span>Confirmed</span>
          </div>
          <div className="kpi">
            <strong>{charts?.byParty?.[0]?.name || '—'}</strong>
            <span>Lead party</span>
          </div>
          <div className="kpi">
            <strong>{charts?.issues?.[0]?.name || '—'}</strong>
            <span>Top issue</span>
          </div>
        </div>
      )}

      {/* Insight chips */}
      {reportReady && data?.insights && (
        <div className="insight-row">
          <div className="insight">{data.insights.topParty}</div>
          <div className="insight">{data.insights.topIssue}</div>
          <div className="insight">{data.insights.topDistrict}</div>
          {data.insights.contrast && (
            <div className="insight">{data.insights.contrast}</div>
          )}
        </div>
      )}

      {/* Super-set / Sub-set formula panel — confirmed only */}
      {reportReady && data?.formula && (
        <section className="card formula-card" style={{ marginBottom: 14 }}>
          <h3>Super-set / Sub-set</h3>
          <div className="stat-row" style={{ marginBottom: 10 }}>
            <div className="stat">
              <strong>{data.formula.superset_n?.toLocaleString?.()}</strong>
              <span>Superset (all)</span>
            </div>
            <div className="stat">
              <strong>{data.formula.subset_n?.toLocaleString?.()}</strong>
              <span>Subset (filter)</span>
            </div>
            <div className="stat">
              <strong>{data.formula.rest_n?.toLocaleString?.()}</strong>
              <span>Rest</span>
            </div>
          </div>
          {!data.isFiltered ? (
            <p className="muted" style={{ fontSize: 12 }}>
              Apply a filter (district, party, caste…) to compare <strong>Subset</strong> vs{' '}
              <strong>Rest</strong>. Δpp = Subset% − Rest%. Index = Subset% / Superset%.
            </p>
          ) : (
            <p className="muted" style={{ fontSize: 12 }}>
              Formula active: Δpp = Subset% − Rest% · Index = Subset% / Superset% (1.0 = same as
              full population).
            </p>
          )}
        </section>
      )}

      {/* Filters */}
      <section className="filter-panel">
        <div className="filter-head">
          <h3>Filters {activeCount ? `(${activeCount})` : ''}</h3>
          {activeCount > 0 && (
            <button type="button" className="link-btn" onClick={clearFilters}>
              Clear all
            </button>
          )}
        </div>

        <label className="field compact">
          <span>District</span>
          <select
            value={filters.district}
            onChange={(e) => setFilters((f) => ({ ...f, district: e.target.value, constituency: '' }))}
          >
            <option value="">All districts</option>
            {(opts?.districts || []).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>

        <div className="filter-chips">
          <span className="filter-label">Party</span>
          {(opts?.parties || ['Congress', 'BJP', 'BRS', 'Others', 'Undecided']).map((p) => (
            <button
              key={p}
              type="button"
              className={`chip ${filters.party === p ? 'selected' : ''}`}
              style={
                filters.party === p
                  ? { borderColor: colorFor(p), color: colorFor(p) }
                  : undefined
              }
              onClick={() => setFilter('party', p)}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="filter-chips">
          <span className="filter-label">Gender</span>
          {(opts?.genders || ['Male', 'Female']).map((g) => (
            <button
              key={g}
              type="button"
              className={`chip ${filters.gender === g ? 'selected' : ''}`}
              onClick={() => setFilter('gender', g)}
            >
              {g}
            </button>
          ))}
        </div>

        <div className="filter-chips">
          <span className="filter-label">Caste</span>
          {(opts?.castes || []).slice(0, 8).map((c) => (
            <button
              key={c}
              type="button"
              className={`chip ${filters.caste === c ? 'selected' : ''}`}
              onClick={() => setFilter('caste', c)}
            >
              {c}
            </button>
          ))}
        </div>
      </section>

      {loading && !data ? (
        <p className="muted center">Checking confirmed data…</p>
      ) : reportLocked ? null : !reportReady ? null : (
        <div className="chart-grid">
          {data && (
            <div className="map-span">
              <SurveyMap
                analytics={data}
                filters={filters}
                onSelectDistrict={(name) =>
                  setFilters((f) => ({
                    ...f,
                    district: f.district === name ? '' : name,
                    constituency: '',
                  }))
                }
                onSelectConstituency={(name) =>
                  setFilters((f) => ({
                    ...f,
                    constituency: f.constituency === name ? '' : name,
                  }))
                }
              />
            </div>
          )}

          {data?.isFiltered && charts?.contrastParty?.length > 0 && (
            <ChartCard
              title="Subset vs Rest — Party"
              subtitle="Δpp = Subset% − Rest% (super-set formula)"
              tall
            >
              <ContrastBars data={charts.contrastParty} />
            </ChartCard>
          )}

          {data?.isFiltered && charts?.contrastGender?.length > 0 && (
            <ChartCard title="Subset vs Rest — Gender" subtitle="Selected filter vs rest of data">
              <ContrastBars data={charts.contrastGender} />
            </ChartCard>
          )}

          {data?.isFiltered && charts?.contrastCaste?.length > 0 && (
            <ChartCard title="Subset vs Rest — Caste" subtitle="Selected filter vs rest of data">
              <ContrastBars data={charts.contrastCaste} />
            </ChartCard>
          )}

          <ChartCard
            title="Party preference"
            subtitle="Tap a slice to filter"
          >
            <InteractivePie
              data={charts?.byParty}
              activeName={filters.party}
              onSliceClick={(name) => setFilter('party', name)}
            />
          </ChartCard>

          <ChartCard title="PM preference" subtitle="Share of responses">
            <InteractivePie
              data={charts?.byPm}
              onSliceClick={undefined}
            />
          </ChartCard>

          <ChartCard title="Responses over time" subtitle="Daily volume" tall>
            <Timeline data={charts?.timeline} />
          </ChartCard>

          <ChartCard
            title="Top districts"
            subtitle="Tap a bar to filter by district"
            tall
          >
            <HBar
              data={charts?.byDistrict}
              activeName={filters.district}
              onBarClick={(name) =>
                setFilters((f) => ({
                  ...f,
                  district: f.district === name ? '' : name,
                  constituency: '',
                }))
              }
            />
          </ChartCard>

          <ChartCard title="Party × District" subtitle="Stacked share" tall>
            <StackedParty
              matrix={charts?.partyByDistrict}
              activeName={filters.district}
              onRowClick={(name) =>
                setFilters((f) => ({
                  ...f,
                  district: f.district === name ? '' : name,
                  constituency: '',
                }))
              }
            />
          </ChartCard>

          <ChartCard title="Party × Caste" subtitle="Cross-tab" tall>
            <StackedParty matrix={charts?.partyByCaste} />
          </ChartCard>

          <ChartCard title="Party × Gender" subtitle="Cross-tab">
            <StackedParty matrix={charts?.partyByGender} />
          </ChartCard>

          <ChartCard title="Local issues" subtitle="Most mentioned">
            <RadialIssues data={charts?.issues} />
          </ChartCard>

          <ChartCard title="Caste distribution">
            <HBar
              data={charts?.byCaste}
              activeName={filters.caste}
              onBarClick={(name) => setFilter('caste', name)}
            />
          </ChartCard>

          <ChartCard title="Gender split">
            <InteractivePie
              data={charts?.byGender}
              activeName={filters.gender}
              onSliceClick={(name) => setFilter('gender', name)}
            />
          </ChartCard>

          <ChartCard title="Govt performance">
            <HBar data={charts?.byPerformance} />
          </ChartCard>

          <ChartCard title="Education" tall>
            <HBar data={charts?.byEducation} />
          </ChartCard>

          <ChartCard title="Occupation" tall>
            <HBar data={charts?.byEmployment} />
          </ChartCard>

          <ChartCard title="Top constituencies" subtitle="By response count" tall>
            <HBar data={charts?.byConstituency} />
          </ChartCard>

          <ChartCard title="Age groups">
            <HBar data={charts?.byAge} />
          </ChartCard>
        </div>
      )}

      <p className="dash-foot muted">
        Charts update live from Neon submissions. Click bars/slices to drill down.
      </p>
    </div>
  )
}
