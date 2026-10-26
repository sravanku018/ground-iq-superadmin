/**
 * Question analytics — the full engine UI:
 * per-question suggested charts (bar / column / donut / stacked / grouped /
 * line / heatmap / diverging), optional cross-tab field, value-filter chips,
 * and a significance summary (top answer, share ± MOE, small-sample note).
 */
import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { applyFilters, crossTab, countBy, options, sortOpts, suggestCharts, summarize } from '../surveyEngine'

const COLORS = ['#2563eb', '#dc2626', '#f59e0b', '#6b7280', '#10b981', '#8b5cf6', '#0ea5e9', '#ec4899', '#84cc16', '#f97316', '#14b8a6', '#a855f7']

// Options missing from the declared order (e.g. "Other") go last instead of first.
const rank = (order, v) => { const i = order.indexOf(v); return i < 0 ? 9999 : i }
const sortByOrder = (vals, order) => (order && order.length ? [...vals].sort((a, b) => rank(order, a) - rank(order, b)) : vals)
const pct = (v) => `${Math.round(v * 100)}%`
const tooltipStyle = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  boxShadow: '0 8px 24px rgba(15,23,42,.12)',
  fontSize: 12,
}

const CROSS_FIELDS = [
  { key: '', label: 'None' },
  { key: 'district', label: 'District' },
  { key: 'user', label: 'Surveyor' },
  { key: 'status', label: 'Status' },
  { key: 'month', label: 'Month' },
]

function Heatmap({ rows, rf, cf, height }) {
  const { cols, data } = crossTab(rows, rf, cf)
  const max = Math.max(1, ...data.flatMap((d) => cols.map((c) => d[c])))
  return (
    <div style={{ overflow: 'auto', maxHeight: height }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th />
            {cols.map((c) => <th key={c} style={{ padding: 4, fontSize: 10, color: '#475569' }}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.name}>
              <th style={{ textAlign: 'left', padding: 4, fontWeight: 600, fontSize: 11 }}>{d.name}</th>
              {cols.map((c) => {
                const v = d[c]
                return (
                  <td
                    key={c}
                    style={{ background: `rgba(16,124,65,${v / max})`, textAlign: 'center', padding: 4, minWidth: 34 }}
                    title={`${d.name} × ${c}: ${v}`}
                  >
                    {v}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function QChart({ type, q, rows, meta, height = 240 }) {
  const order = meta[q.field]?.order
  const counts = countBy(rows, q.field)
  const single = sortByOrder([...counts.keys()], order).map((name) => ({ name, value: counts.get(name) ?? 0 }))
  const ct = q.x ? crossTab(rows, q.x, q.field) : null
  const h = height
  // Diverging splits the *full* scale (declared order) at its middle, so filters that
  // remove some options never turn a "high" answer into a "low" one.
  const scale = order && order.length ? order : single.map((d) => d.name)
  const half = Math.floor(scale.length / 2)
  const side = (name) => { const i = scale.indexOf(name); return i < 0 ? 1 : i < half ? -1 : i > half ? 1 : 0 }

  if (type === 'heatmap' && q.x) return <Heatmap rows={rows} rf={q.field} cf={q.x} height={h} />

  return (
    <ResponsiveContainer width="100%" height={h}>
      {type === 'donut' ? (
        <PieChart>
          <Pie data={single} dataKey="value" nameKey="name" innerRadius={50} outerRadius={92} strokeWidth={2}>
            {single.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      ) : type === 'line' && ct ? (
        <LineChart data={ct.data}>
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {ct.cols.map((c, i) => <Line key={c} dataKey={c} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />)}
        </LineChart>
      ) : type === 'line' ? (
        <LineChart data={single}>
          <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={48} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Line dataKey="value" stroke={COLORS[0]} strokeWidth={2.5} dot={{ r: 4 }} />
        </LineChart>
      ) : (type === 'stacked' || type === 'grouped') && ct ? (
        <BarChart data={ct.data} stackOffset={type === 'stacked' ? 'expand' : 'none'}>
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} tickFormatter={type === 'stacked' ? pct : undefined} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {ct.cols.map((c, i) => (
            <Bar key={c} dataKey={c} stackId={type === 'stacked' ? 'a' : undefined} fill={COLORS[i % COLORS.length]} radius={type === 'grouped' ? [4, 4, 0, 0] : undefined} />
          ))}
        </BarChart>
      ) : type === 'diverging' ? (
        <BarChart
          data={single.map((d) => ({ ...d, value: side(d.name) * d.value }))}
          layout="vertical"
        >
          <XAxis type="number" tick={{ fontSize: 10 }} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={86} />
          <Tooltip contentStyle={tooltipStyle} />
          <ReferenceLine x={0} stroke="#999" />
          <Bar dataKey="value">
            {single.map((d) => <Cell key={d.name} fill={side(d.name) < 0 ? COLORS[1] : COLORS[4]} />)}
          </Bar>
        </BarChart>
      ) : (
        <BarChart
          data={type === 'bar' ? [...single].sort((a, b) => b.value - a.value) : single}
          layout={type === 'bar' ? 'vertical' : 'horizontal'}
        >
          {type === 'bar' ? (
            <>
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10 }} />
            </>
          ) : (
            <>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={48} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            </>
          )}
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="value" fill={COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={44} />
        </BarChart>
      )}
    </ResponsiveContainer>
  )
}

function QuestionCard({ q, rows, meta }) {
  const [pick, setPick] = useState('all')
  const [crossBy, setCrossBy] = useState('')
  const qq = useMemo(() => ({ ...q, x: crossBy || undefined }), [q, crossBy])
  const types = suggestCharts(rows, qq, meta)
  const shown = pick === 'all' || !types.includes(pick) ? types : [pick]
  const s = summarize(rows, q.field)

  return (
    <div className="card" style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h4 style={{ margin: 0, fontSize: 14 }}>{q.id}. {q.text}</h4>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="muted" style={{ fontSize: 11 }}>Cross by</span>
          <select
            value={crossBy}
            onChange={(e) => { setCrossBy(e.target.value); setPick('all') }}
            style={{ fontSize: 11, padding: '3px 6px' }}
          >
            {CROSS_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        <button
          type="button"
          className="btn small"
          style={{ fontWeight: pick === 'all' ? 700 : 400, background: pick === 'all' ? '#eef3fb' : undefined }}
          onClick={() => setPick('all')}
        >
          All
        </button>
        {types.map((t) => (
          <button
            key={t}
            type="button"
            className="btn small"
            style={{ fontWeight: pick === t ? 700 : 400, background: pick === t ? '#eef3fb' : undefined }}
            onClick={() => setPick(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
        {shown.map((t) => <QChart key={t} type={t} q={qq} rows={rows} meta={meta} />)}
      </div>
      {s && (
        <p className="muted" style={{ fontSize: 11, margin: '8px 0 0' }}>
          <strong>{s.top}</strong> leads with {(s.share * 100).toFixed(1)}% (±{(s.moe * 100).toFixed(1)}%, n={s.n})
          {s.significant ? '' : ' · lead not statistically significant'}
          {s.n < 30 ? ' · small sample, indicative only' : ''}
        </p>
      )}
    </div>
  )
}

export default function QuestionAnalytics({ rows, questions, meta }) {
  const [filters, setFilters] = useState({})
  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters])

  const toggleV = (f, v) =>
    setFilters((p) => {
      const s = new Set(p[f] ?? [])
      if (s.has(v)) s.delete(v)
      else s.add(v)
      return { ...p, [f]: s }
    })

  const fields = [...new Set(questions.map((q) => q.field))]

  return (
    <div>
      {fields.length > 0 && (
        <div className="card" style={{ padding: 12, marginBottom: 14 }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
            Answer filters — tap values to narrow every chart ({filtered.length} of {rows.length} records):
          </div>
          {fields.map((f) => (
            <div key={f} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', minWidth: 120 }}>
                {questions.find((q) => q.field === f)?.text || f}:
              </span>
              {sortOpts(options(rows, f), meta[f]?.order).map((v) => {
                const on = !!filters[f]?.has(v)
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => toggleV(f, v)}
                    style={{
                      fontSize: 11,
                      padding: '3px 9px',
                      borderRadius: 999,
                      border: on ? '1px solid #3f6cbe' : '1px solid #dbe3ef',
                      background: on ? '#eef3fb' : '#fff',
                      color: on ? '#223f75' : '#475569',
                      cursor: 'pointer',
                    }}
                  >
                    {v}
                  </button>
                )
              })}
              {filters[f]?.size ? (
                <button
                  type="button"
                  style={{ fontSize: 10, background: 'none', border: 0, color: '#9a3412', cursor: 'pointer' }}
                  onClick={() => setFilters((p) => ({ ...p, [f]: new Set() }))}
                >
                  clear
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {questions.map((q) => <QuestionCard key={q.id} q={q} rows={filtered} meta={meta} />)}
    </div>
  )
}
