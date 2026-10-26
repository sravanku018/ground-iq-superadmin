/**
 * Survey analytics engine — ported from the reference implementation.
 * Rows are flat answer records: { [questionId]: "answer", district, user, ... }.
 */

export const applyFilters = (rows, filters) =>
  rows.filter((r) => Object.entries(filters).every(([k, s]) => !s.size || s.has(r[k])))

export const options = (rows, field) =>
  [...new Set(rows.map((r) => r[field]).filter(Boolean))]

export const countBy = (rows, field) => {
  const m = new Map()
  rows.forEach((r) => {
    const v = r[field]
    if (v) m.set(v, (m.get(v) ?? 0) + 1)
  })
  return m
}

export const crossTab = (rows, rf, cf) => {
  const cols = options(rows, cf)
  const data = options(rows, rf).map((o) => ({
    name: o,
    ...Object.fromEntries(cols.map((c) => [c, rows.filter((r) => r[rf] === o && r[cf] === c).length])),
  }))
  return { cols, data }
}

export function summarize(rows, field) {
  const m = [...countBy(rows, field)].sort((a, b) => b[1] - a[1])
  const n = m.reduce((s, [, c]) => s + c, 0)
  if (!n) return null
  const p1 = m[0][1] / n
  const p2 = (m[1]?.[1] ?? 0) / n
  const moe = 1.96 * Math.sqrt((p1 * (1 - p1)) / n)
  const se = Math.sqrt((p1 + p2 - (p1 - p2) ** 2) / n)
  return {
    n,
    top: m[0][0],
    share: p1,
    moe,
    gap: p1 - p2,
    significant: p1 - p2 > 1.96 * se,
  }
}

export const sortOpts = (vals, order) =>
  order ? [...vals].sort((a, b) => order.indexOf(a) - order.indexOf(b)) : vals

/** Suggested chart types for a question, based on its kind and option count. */
export function suggestCharts(rows, q, meta) {
  const kind = meta[q.field]?.kind ?? 'nominal'
  const nOpt = options(rows, q.field).length
  const out = []
  if (!q.x) {
    if (kind === 'time') out.push('line', 'column')
    else if (kind === 'ordinal') out.push('column', nOpt === 5 ? 'diverging' : 'bar')
    else if (nOpt <= 2) out.push('donut', 'bar')
    else if (nOpt <= 5) out.push('bar', 'donut', 'column')
    else out.push('bar')
  } else {
    const xKind = meta[q.x]?.kind ?? 'nominal'
    const nX = options(rows, q.x).length
    if (xKind === 'time') out.push('line', 'stacked')
    else out.push('stacked', 'grouped')
    if (nOpt >= 4 && nX >= 4) out.push('heatmap')
  }
  return out.slice(0, 3)
}

/** Infer chart metadata (kind + option order) from survey question definitions. */
export function buildMeta(questions) {
  const meta = {}
  for (const q of questions) {
    const type = String(q.type || '').toLowerCase()
    const opts = Array.isArray(q.options) ? q.options : []
    let kind = 'nominal'
    if (type === 'date' || type === 'time' || type === 'datetime') kind = 'time'
    else if (type === 'age' || opts.some((o) => /^\d+\s*[-–]\s*\d+|\+$/.test(String(o)))) kind = 'ordinal'
    meta[q.id] = { kind, order: opts.map(String) }
  }
  meta.district = { kind: 'nominal' }
  meta.user = { kind: 'nominal' }
  meta.status = { kind: 'nominal' }
  meta.date = { kind: 'time' }
  meta.month = { kind: 'time' }
  return meta
}
