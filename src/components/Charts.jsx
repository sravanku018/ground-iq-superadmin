/**
 * Excel-style SVG charts — no chart library, ~zero bundle cost.
 * Classic Office look: white plot area, light gridlines, tick labels,
 * legend, and the standard Office color palette.
 */

const OFFICE = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47', '#264478', '#9E480E']

const pad = (n) => (n < 10 ? `0${n}` : String(n))

function niceMax(max) {
  if (max <= 5) return Math.max(1, max)
  const pow = 10 ** Math.floor(Math.log10(max))
  const base = Math.ceil(max / pow)
  const step = base <= 1 ? 0.2 : base <= 2 ? 0.5 : base <= 5 ? 1 : 2
  return Math.ceil(max / (step * pow) * step * pow * pow / pow) || 1
}

function topRows(data, xKey, maxBars) {
  if (data.length <= maxBars) return data
  const sorted = [...data].sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0))
  const head = sorted.slice(0, maxBars - 1)
  const tail = sorted.slice(maxBars - 1)
  const rest = { ...tail[0] }
  for (const t of tail.slice(1)) {
    for (const k of Object.keys(t)) {
      if (typeof t[k] === 'number') rest[k] = (Number(rest[k]) || 0) + t[k]
    }
  }
  rest[xKey] = 'Other'
  return [...head, rest]
}

export const CHART_COLORS = OFFICE

/** Grouped/stacked vertical bars. data: [{[xKey], total, series1, series2...}] */
export function BarChart({ data, xKey = 'label', series = [{ key: 'total', label: 'Records' }], stacked = false, maxBars = 12, height = 260 }) {
  const rows = topRows(data, xKey, maxBars)
  if (!rows.length) return <NoData />
  const W = 720
  const H = height
  const m = { top: 14, right: 12, bottom: 54, left: 44 }
  const pw = W - m.left - m.right
  const ph = H - m.top - m.bottom
  const maxV = stacked
    ? Math.max(...rows.map((r) => series.reduce((n, s) => n + (Number(r[s.key]) || 0), 0)))
    : Math.max(...rows.map((r) => series.reduce((n, s) => Math.max(n, Number(r[s.key]) || 0), 0)))
  const yMax = niceMax(maxV)
  const yTicks = 5
  const bw = pw / rows.length
  const groupW = stacked ? bw * 0.55 : (bw * 0.72) / series.length

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', background: '#fff' }}>
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const v = (yMax / yTicks) * i
        const y = m.top + ph - (ph * i) / yTicks
        return (
          <g key={i}>
            <line x1={m.left} x2={W - m.right} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="1" />
            <text x={m.left - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#6b7280">{Number.isInteger(v) ? v : v.toFixed(1)}</text>
          </g>
        )
      })}
      {rows.map((r, i) => {
        const cx = m.left + bw * i + bw / 2
        let acc = 0
        return (
          <g key={i}>
            {series.map((s, si) => {
              const v = Number(r[s.key]) || 0
              const h = yMax ? (ph * v) / yMax : 0
              const x = stacked ? cx - groupW / 2 : cx - groupW * series.length / 2 + si * groupW
              const y = stacked ? m.top + ph - acc - h : m.top + ph - h
              acc += h
              const label = `${r[xKey]} · ${s.label}: ${v}`
              return (
                <rect key={si} x={x} y={y} width={Math.max(2, groupW - 2)} height={h} fill={OFFICE[si % OFFICE.length]} rx="2">
                  <title>{label}</title>
                </rect>
              )
            })}
            <text
              x={cx} y={H - m.bottom + 14} textAnchor="end" fontSize="10" fill="#374151"
              transform={`rotate(-32 ${cx} ${H - m.bottom + 14})`}
            >
              {String(r[xKey] ?? '').length > 14 ? `${String(r[xKey]).slice(0, 13)}…` : String(r[xKey] ?? '')}
            </text>
          </g>
        )
      })}
      <line x1={m.left} x2={W - m.right} y1={m.top + ph} y2={m.top + ph} stroke="#9ca3af" />
      <Legend series={series} />
    </svg>
  )
}

/** Multi-series line chart. */
export function LineChart({ data, xKey = 'label', series = [{ key: 'total', label: 'Records' }], height = 260 }) {
  const rows = [...data]
  if (!rows.length) return <NoData />
  const W = 720
  const H = height
  const m = { top: 14, right: 12, bottom: 46, left: 44 }
  const pw = W - m.left - m.right
  const ph = H - m.top - m.bottom
  const maxV = Math.max(...rows.flatMap((r) => series.map((s) => Number(r[s.key]) || 0)))
  const yMax = niceMax(maxV)
  const yTicks = 5
  const px = (i) => (rows.length === 1 ? m.left + pw / 2 : m.left + (pw * i) / (rows.length - 1))
  const py = (v) => m.top + ph - (ph * (yMax ? v / yMax : 0))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', background: '#fff' }}>
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const v = (yMax / yTicks) * i
        const y = py(v)
        return (
          <g key={i}>
            <line x1={m.left} x2={W - m.right} y1={y} y2={y} stroke="#e5e7eb" />
            <text x={m.left - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#6b7280">{Number.isInteger(v) ? v : v.toFixed(1)}</text>
          </g>
        )
      })}
      {series.map((s, si) => {
        const pts = rows.map((r, i) => `${px(i)},${py(Number(r[s.key]) || 0)}`).join(' ')
        return (
          <g key={si}>
            <polyline points={pts} fill="none" stroke={OFFICE[si % OFFICE.length]} strokeWidth="2.2" />
            {rows.map((r, i) => (
              <circle key={i} cx={px(i)} cy={py(Number(r[s.key]) || 0)} r="3" fill={OFFICE[si % OFFICE.length]}>
                <title>{`${r[xKey]} · ${s.label}: ${Number(r[s.key]) || 0}`}</title>
              </circle>
            ))}
          </g>
        )
      })}
      {rows.map((r, i) => {
        const skip = rows.length > 12 ? Math.ceil(rows.length / 12) : 1
        if (i % skip !== 0 && i !== rows.length - 1) return null
        return (
          <text key={i} x={px(i)} y={H - m.bottom + 14} textAnchor="middle" fontSize="10" fill="#374151">
            {String(r[xKey] ?? '').length > 10 ? `${String(r[xKey]).slice(0, 9)}…` : String(r[xKey] ?? '')}
          </text>
        )
      })}
      <line x1={m.left} x2={W - m.right} y1={m.top + ph} y2={m.top + ph} stroke="#9ca3af" />
      <Legend series={series} />
    </svg>
  )
}

/** Pie with percentage legend. */
export function PieChart({ data, labelKey = 'label', valueKey = 'value', height = 240 }) {
  const rows = data.filter((d) => (Number(d[valueKey]) || 0) > 0)
  if (!rows.length) return <NoData />
  const total = rows.reduce((n, d) => n + (Number(d[valueKey]) || 0), 0)
  const W = 720
  const H = height
  const cx = 150
  const cy = H / 2
  const R = Math.min(cx - 30, H / 2 - 24)
  let angle = -Math.PI / 2
  const slices = rows.map((d, i) => {
    const frac = (Number(d[valueKey]) || 0) / total
    const a0 = angle
    const a1 = angle + frac * Math.PI * 2
    angle = a1
    const large = a1 - a0 > Math.PI ? 1 : 0
    const x0 = cx + R * Math.cos(a0)
    const y0 = cy + R * Math.sin(a0)
    const x1 = cx + R * Math.cos(a1)
    const y1 = cy + R * Math.sin(a1)
    return {
      d: `M ${cx} ${cy} L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} Z`,
      color: OFFICE[i % OFFICE.length],
      label: String(d[labelKey]),
      value: Number(d[valueKey]) || 0,
    }
  })
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', background: '#fff' }}>
      {slices.map((s, i) => (
        <path key={i} d={s.d} fill={s.color} stroke="#fff" strokeWidth="1.5">
          <title>{`${s.label}: ${s.value} (${Math.round((s.value / total) * 100)}%)`}</title>
        </path>
      ))}
      <g transform={`translate(${cx * 2 + 20}, 20)`}>
        {slices.map((s, i) => (
          <g key={i} transform={`translate(0, ${i * 22})`}>
            <rect width="12" height="12" y="-10" fill={s.color} rx="2" />
            <text x="18" y="1" fontSize="12" fill="#374151">
              {s.label} — {s.value} ({Math.round((s.value / total) * 100)}%)
            </text>
          </g>
        ))}
      </g>
    </svg>
  )
}

function Legend({ series }) {
  return (
    <g transform={`translate(44, 10)`}>
      {series.map((s, i) => (
        <g key={s.key} transform={`translate(${i * 110}, 0)`}>
          <rect width="11" height="11" y="-9" fill={OFFICE[i % OFFICE.length]} rx="2" />
          <text x="16" y="1" fontSize="11" fill="#374151">{s.label}</text>
        </g>
      ))}
    </g>
  )
}

function NoData() {
  return (
    <div className="muted" style={{ padding: 28, textAlign: 'center', fontSize: 13 }}>
      No records match these filters.
    </div>
  )
}

/** Day label helper for by_date rows ("2026-10-25" → "25 Oct"). */
export function dayLabel(iso) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(iso))) return String(iso || '')
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${MONTHS[(m || 1) - 1] || m}${y ? ` ${String(y).slice(2)}` : ''}`
}

export function monthLabel(iso) {
  if (!/^\d{4}-\d{2}/.test(String(iso))) return String(iso || '')
  const [y, m] = String(iso).slice(0, 7).split('-').map(Number)
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${MONTHS[(m || 1) - 1] || m} ${y}`
}

export { pad }
