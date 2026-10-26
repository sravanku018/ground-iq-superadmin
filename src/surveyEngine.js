/**
 * Survey analytics engine — ported from the reference implementation.
 * Rows are flat answer records: { [questionId]: "answer", district, user, ... }.
 */

/** Multi-select answers arrive as arrays; treat them as the set of chosen values. */
export const valuesOf = (v) => (Array.isArray(v) ? v.filter((x) => x != null && x !== '') : v == null || v === '' ? [] : [v])

export const applyFilters = (rows, filters) =>
  rows.filter((r) =>
    Object.entries(filters).every(([k, s]) => !s.size || valuesOf(r[k]).some((v) => s.has(String(v)))),
  )

export const options = (rows, field) => [
  ...new Set(rows.flatMap((r) => valuesOf(r[field]).map(String))),
]

export const countBy = (rows, field) => {
  const m = new Map()
  rows.forEach((r) => {
    for (const raw of valuesOf(r[field])) {
      const v = String(raw)
      if (v) m.set(v, (m.get(v) ?? 0) + 1)
    }
  })
  return m
}

export const crossTab = (rows, rf, cf) => {
  const cols = options(rows, cf)
  const data = options(rows, rf).map((o) => ({
    name: o,
    ...Object.fromEntries(
      cols.map((c) => [
        c,
        rows.filter((r) => valuesOf(r[rf]).map(String).includes(o) && valuesOf(r[cf]).map(String).includes(c)).length,
      ]),
    ),
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
  order && order.length
    ? [...vals].sort((a, b) => {
      const ia = order.indexOf(a)
      const ib = order.indexOf(b)
      if (ia === -1 && ib === -1) return numOf(a) - numOf(b)
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })
    : [...vals].sort((a, b) => numOf(a) - numOf(b))

const numOf = (v) => {
  const n = parseFloat(String(v).replace(/[^0-9.+-]/g, ''))
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER
}

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
    else if (
      type === 'meter' || type === 'number' || type === 'rating' || type === 'slider' ||
      type === 'age' || opts.some((o) => /^\d+\s*[-–]\s*\d+|\+$/.test(String(o)))
    ) kind = 'ordinal'
    else if (type === 'abc' || type === 'select' || type === 'radio' || type === 'checkbox' || type === 'choice') kind = 'nominal'
    meta[q.id] = { kind, order: opts.map(String) }
  }
  meta.district = { kind: 'nominal' }
  meta.user = { kind: 'nominal' }
  meta.status = { kind: 'nominal' }
  meta.date = { kind: 'time' }
  meta.month = { kind: 'time' }
  return meta
}
