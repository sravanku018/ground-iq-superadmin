/**
 * Excel-style survey analytics sheet — modeled on the reference "Survey Sheet":
 * green header, formula bar, question chips (Q1..Qn), value-filter rows with
 * green chips, a chart grid, spreadsheet tabs (Totals / Data / Summary /
 * Questions / Filters) and a written analysis block.
 */
import { Fragment, useMemo, useState } from 'react'
import { QChart } from './QuestionAnalytics'
import { applyFilters, countBy, options, sortOpts, suggestCharts, summarize } from '../surveyEngine'

const GREEN = '#107c41'
const GRID = '#d1d5db'
const HD = '#f3f4f6'
const SEL = '#e8f0fe'
const TYPE_LABEL = {
  bar: 'Bar',
  column: 'Column',
  donut: 'Donut',
  stacked: 'Stacked Bar (100%)',
  grouped: 'Grouped Bar',
  line: 'Line',
  heatmap: 'Heatmap',
  diverging: 'Diverging',
}
const CROSS = [
  { key: '', label: 'none' },
  { key: 'district', label: 'District' },
  { key: 'user', label: 'Surveyor' },
  { key: 'status', label: 'Status' },
  { key: 'month', label: 'Month' },
  { key: 'date', label: 'Date' },
]
const META_FIELDS = { district: 'District', user: 'Surveyor', status: 'Status', month: 'Month', date: 'Date' }

const disp = (v) => (Array.isArray(v) ? v.join(', ') : v ?? '')
const cell = { border: `1px solid ${GRID}`, padding: '2px 6px', fontSize: 11, whiteSpace: 'nowrap' }
const hcell = { ...cell, background: HD, fontWeight: 'normal', textAlign: 'center' }
const rn = { ...hcell, width: 28, color: '#6b7280' }

function Table({ children, minWidth = 420, maxHeight = 240 }) {
  return (
    <div style={{ overflow: 'auto', maxHeight, borderTop: `1px solid ${GRID}` }}>
      <table style={{ borderCollapse: 'collapse', minWidth, width: '100%', background: '#fff' }}>{children}</table>
    </div>
  )
}

function downloadCsv(rows, questions) {
  const cols = ['id', ...questions.map((q) => q.id), 'district', 'user', 'status', 'date']
  const head = ['ID', ...questions.map((q, i) => `Q${i + 1}. ${q.label}`), 'District', 'Surveyor', 'Status', 'Date']
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [head.map(esc).join(',')]
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','))
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'survey_sheet.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function SurveySheet({ rows, questions, selectedQids, setSelectedQids, meta, filterNote, truncated = false }) {
  const [values, setValues] = useState({}) // field → Set(values)
  const [tab, setTab] = useState('totals')
  const [chartPick, setChartPick] = useState({}) // qid → type
  const [crossPick, setCrossPick] = useState({}) // qid → field

  // Only questions with a small closed set of answers are chartable (hides free text / ids).
  const qlist = useMemo(
    () => questions.filter((q) => {
      const n = options(rows, String(q.id)).length
      return n >= 1 && n <= 30
    }),
    [questions, rows],
  )
  const qNum = (id) => qlist.findIndex((q) => String(q.id) === String(id)) + 1
  const selected = useMemo(
    () => qlist.filter((q) => selectedQids.map(String).includes(String(q.id))),
    [qlist, selectedQids],
  )
  const fieldsKey = selected.map((q) => String(q.id)).join('|')

  // Value filters only count for questions that are currently picked, so a
  // de-selected question can never leave a hidden filter behind.
  const activeValues = useMemo(
    () => Object.fromEntries(Object.entries(values).filter(([f, s]) => s?.size && fieldsKey.split('|').includes(f))),
    [values, fieldsKey],
  )
  const filtered = useMemo(() => applyFilters(rows, activeValues), [rows, activeValues])
  const toggleV = (f, v) =>
    setValues((p) => {
      const s = new Set(p[f] ?? [])
      if (s.has(v)) s.delete(v)
      else s.add(v)
      return { ...p, [f]: s }
    })
  const clearAll = () => setValues({})
  const toggleQ = (id) =>
    setSelectedQids((prev) => {
      const key = String(id)
      const has = prev.map(String).includes(key)
      return has ? prev.filter((x) => String(x) !== key) : [...prev, key]
    })

  const activeNotes = Object.keys(activeValues)
    .map((f) => `Q${qNum(f)}=${[...activeValues[f]].join('|')}`)

  const fx = selected.length
    ? `=Q${selected.map((q) => qNum(q.id)).join(',Q')}  n=${filtered.length}${truncated ? ` (first ${rows.length} loaded — narrow filters for full accuracy)` : ''}  ${activeNotes.length ? activeNotes.join(' · ') : 'no filters'}${filterNote ? `  ${filterNote}` : ''}`
    : 'Select a question number (Q1–Qn) to load its filters, charts and analysis'

  // ── chart configs ────────────────────────────────────────────────────────
  const charts = selected.map((q) => {
    const qq = { id: String(q.id), text: q.label, field: String(q.id), x: crossPick[q.id] || undefined }
    const types = suggestCharts(rows, qq, meta)
    const type = chartPick[q.id] && types.includes(chartPick[q.id]) ? chartPick[q.id] : types[0] || 'column'
    return { q, qq, types, type }
  })

  // ── totals rows (Q by Q, option cells with green bars) ───────────────────
  const totalsRows = charts.map(({ q }) => {
    const counts = countBy(filtered, String(q.id))
    const answered = [...counts.values()].reduce((a, b) => a + b, 0)
    const ord = meta[q.id]?.order
    const opts = sortOpts([...counts.keys()], ord)
    return { q, counts, answered, opts }
  })
  const maxOpts = Math.max(1, ...totalsRows.map((r) => r.opts.length))

  // ── analysis bullets ─────────────────────────────────────────────────────
  const analysis = charts.map(({ q, qq }) => {
    const field = String(q.id)
    const counts = [...countBy(filtered, field)].sort((a, b) => b[1] - a[1])
    const answered = counts.reduce((s, [, c]) => s + c, 0)
    if (!answered) return { num: qNum(q.id), text: q.label, empty: true }
    const p = (n) => `${((n * 100) / answered).toFixed(1)}%`
    const top = counts[0]
    const second = counts[1]
    const last = counts[counts.length - 1]
    const sm = summarize(filtered, field)
    let text = `${top[0]} leads with ${top[1]} (${p(top[1])}, ±${((sm?.moe ?? 0) * 100).toFixed(1)}%, n=${answered})`
    if (second) text += `, ${(((top[1] - second[1]) * 100) / answered).toFixed(1)} pts ahead of ${second[0]} (${p(second[1])})${sm && !sm.significant ? ' — lead is within the margin of error' : ''}`
    text += `; lowest is ${last[0]} (${p(last[1])}).`
    if (activeNotes.length) {
      const full = countBy(rows, field)
      const fullTotal = [...full.values()].reduce((a, b) => a + b, 0) || 1
      let biggest = null
      for (const [k, n] of counts) {
        const fv = full.get(k) || 0
        const diff = (n * 100) / answered - (fv * 100) / fullTotal
        if (!biggest || Math.abs(diff) > Math.abs(biggest[1])) biggest = [k, diff]
      }
      if (biggest) text += ` Vs full sample, biggest shift: ${biggest[0]} ${biggest[1] >= 0 ? '+' : ''}${biggest[1].toFixed(1)} pts.`
    }
    if (qq.x) {
      const xs = options(filtered, qq.x)
      const tops = xs.map((x) => {
        const z = filtered.filter((r) => r[qq.x] === x)
        if (!z.length) return null
        const m = [...countBy(z, field)].sort((a, b) => b[1] - a[1])[0]
        return `${x}: ${m[0]} ${((m[1] * 100) / z.length).toFixed(0)}%`
      }).filter(Boolean)
      if (tops.length) text += ` By ${META_FIELDS[qq.x] || qq.x}, top answer → ${tops.join(' · ')}.`
    }
    return { num: qNum(q.id), text: q.label, body: text, answered }
  })

  const dataCols = ['district', 'user', 'status', 'date']
  const tapChip = (on) => ({
    border: `1px solid ${on ? GREEN : GRID}`,
    background: on ? GREEN : '#fff',
    color: on ? '#fff' : '#1f2937',
    padding: '1px 8px',
    borderRadius: 11,
    fontSize: 11,
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif',
  })

  return (
    <div style={{ border: `1px solid ${GRID}`, background: '#fff', fontFamily: 'Arial, Helvetica, sans-serif', color: '#1f2937' }}>
      {/* green header */}
      <div style={{ background: GREEN, color: '#fff', padding: '6px 12px', fontWeight: 700, fontSize: 13 }}>
        Survey Analytics Sheet — pick question no. → its filters → chart
      </div>

      {/* formula bar */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${GRID}`, gap: 8, paddingRight: 8 }}>
        <b style={{ padding: '4px 10px', borderRight: `1px solid ${GRID}`, fontStyle: 'italic', color: GREEN }}>fx</b>
        <span style={{ flex: 1, padding: '4px 8px', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fx}>{fx}</span>
        <button type="button" style={{ ...tapChip(false), borderRadius: 4 }} onClick={clearAll}>Clear all</button>
        <button type="button" style={{ ...tapChip(false), borderRadius: 4 }} onClick={() => downloadCsv(filtered, selected)}>⬇ Download</button>
      </div>

      {/* question picker */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${GRID}`, alignItems: 'stretch' }}>
        <div style={{ ...rn, padding: '5px 0', borderTop: 0, borderBottom: 0 }}>0</div>
        <div style={{ width: 190, padding: '5px 8px', fontWeight: 700, borderRight: `1px solid ${GRID}`, background: HD, fontSize: 11 }}>
          Select question no.
        </div>
        <div style={{ flex: 1, padding: '3px 6px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {qlist.map((q, i) => {
            const on = selectedQids.map(String).includes(String(q.id))
            return (
              <button key={q.id} type="button" style={tapChip(on)} title={q.label} onClick={() => toggleQ(q.id)}>
                Q{i + 1}<span style={{ opacity: on ? 0.9 : 0.6 }}> · {String(q.label).slice(0, 22)}</span>
              </button>
            )
          })}
        </div>
      </div>

      {selected.length === 0 ? (
        <div className="muted" style={{ padding: 14, fontSize: 12 }}>Pick one or more question numbers above. Hover a chip to read the question.</div>
      ) : (<>
      {/* value-filter rows */}
      {selected.map((q) => {
        const field = String(q.id)
        const ord = meta[field]?.order
        return (
          <div key={field} style={{ display: 'flex', borderBottom: `1px solid ${GRID}`, alignItems: 'stretch' }}>
            <div style={{ ...rn, padding: '5px 0', borderTop: 0, borderBottom: 0 }}>Q{qNum(field)}</div>
            <div style={{ width: 190, padding: '5px 8px', fontWeight: 700, borderRight: `1px solid ${GRID}`, background: HD, fontSize: 11 }}>
              {String(q.label).slice(0, 40)}
            </div>
            <div style={{ flex: 1, padding: '3px 6px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {sortOpts(options(rows, field), ord).map((v) => (
                <button key={v} type="button" style={tapChip(!!values[field]?.has(v))} onClick={() => toggleV(field, v)}>
                  {v}
                </button>
              ))}
              {values[field]?.size ? (
                <button
                  type="button"
                  style={{ border: 0, background: 'none', color: '#9a3412', fontSize: 10, cursor: 'pointer' }}
                  onClick={() => setValues((p) => ({ ...p, [field]: new Set() }))}
                >
                  clear
                </button>
              ) : null}
            </div>
          </div>
        )
      })}

      {/* chart grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 8, padding: 8 }}>
        {charts.map(({ q, qq, types, type }) => (
          <div key={q.id} style={{ border: `1px solid ${GRID}`, padding: 6, height: 260, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <b style={{ fontSize: 12 }}>Q{qNum(q.id)}. {String(q.label).slice(0, 46)}</b>
              <span style={{ fontWeight: 'normal', color: '#6b7280', fontSize: 11 }}>· {TYPE_LABEL[type]}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <select
                  value={type}
                  onChange={(e) => setChartPick((p) => ({ ...p, [q.id]: e.target.value }))}
                  style={{ fontSize: 10, border: `1px solid ${GRID}`, background: '#fff' }}
                  title="Chart type"
                >
                  {types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
                </select>
                <select
                  value={crossPick[q.id] || ''}
                  onChange={(e) => setCrossPick((p) => ({ ...p, [q.id]: e.target.value }))}
                  style={{ fontSize: 10, border: `1px solid ${GRID}`, background: '#fff' }}
                  title="Cross by"
                >
                  {CROSS.map((c) => <option key={c.key} value={c.key}>by {c.label}</option>)}
                </select>
              </span>
            </div>
            <div style={{ flex: 1, position: 'relative' }}>
              <QChart type={type} q={qq} rows={filtered} meta={meta} />
            </div>
          </div>
        ))}
      </div>

      {/* sheet tabs */}
      <div style={{ display: 'flex', borderTop: `1px solid ${GRID}`, background: HD, padding: '2px 10px', gap: 2 }}>
        {[
          ['totals', 'Totals (Q by Q)'],
          ['data', 'Data (individual)'],
          ['summary', 'Summary (all questions)'],
          ['questions', 'Questions'],
          ['filters', 'Filters'],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            style={{
              padding: '1px 10px',
              fontSize: 11,
              cursor: 'pointer',
              background: tab === k ? '#fff' : 'transparent',
              border: `1px solid ${tab === k ? GRID : 'transparent'}`,
              borderTop: `2px solid ${GREEN}`,
              opacity: tab === k ? 1 : 0.6,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding: '3px 10px', fontSize: 11, background: HD, borderTop: `1px solid ${GRID}` }}>
        {filtered.length} of {rows.length} responses match filters · Totals = question-by-question counts
      </div>

      {/* ── Totals ── */}
      {tab === 'totals' && (
        <Table maxHeight={260}>
          <thead>
            <tr>
              <th style={rn} />
              {Array.from({ length: 3 + maxOpts }, (_, k) => (
                <th key={k} style={hcell}>{String.fromCharCode(65 + k)}</th>
              ))}
            </tr>
            <tr style={{ background: SEL, fontWeight: 700 }}>
              <th style={rn}>1</th>
              <td style={cell}>Q</td>
              <td style={cell}>Question</td>
              <td style={cell}>Answered</td>
              {Array.from({ length: maxOpts }, (_, k) => <td key={k} style={cell}>Option {k + 1}</td>)}
            </tr>
          </thead>
          <tbody>
            {totalsRows.map(({ q, counts, answered, opts }, idx) => (
              <tr key={q.id}>
                <th style={rn}>{idx + 2}</th>
                <td style={cell}>Q{qNum(q.id)}</td>
                <td style={cell}>{String(q.label).slice(0, 60)}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{answered}</td>
                {opts.map((o) => {
                  const n = counts.get(o)
                  const pctv = answered ? (n * 100) / answered : 0
                  return (
                    <td
                      key={o}
                      style={{
                        ...cell,
                        background: `linear-gradient(90deg, rgba(16,124,65,.3) ${pctv}%, transparent ${pctv}%)`,
                      }}
                      title={`${o}: ${n} (${pctv.toFixed(1)}%)`}
                    >
                      {o}: <b>{n}</b> ({pctv.toFixed(0)}%)
                    </td>
                  )
                })}
                {Array.from({ length: Math.max(0, maxOpts - opts.length) }, (_, k) => <td key={`e${k}`} style={cell} />)}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* ── Data ── */}
      {tab === 'data' && (
        <Table minWidth={0} maxHeight={260}>
          <thead>
            <tr>
              <th style={rn} />
              {Array.from({ length: 1 + selected.length + dataCols.length }, (_, k) => (
                <th key={k} style={hcell}>{String.fromCharCode(65 + k)}</th>
              ))}
            </tr>
            <tr style={{ background: SEL, fontWeight: 700 }}>
              <th style={rn}>1</th>
              <td style={cell}>ID</td>
              {selected.map((q) => <td key={q.id} style={cell}>Q{qNum(q.id)}. {String(q.label).slice(0, 24)}</td>)}
              {dataCols.map((c) => <td key={c} style={cell}>{META_FIELDS[c]}</td>)}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((r, i) => (
              <tr key={r.id ?? i}>
                <th style={rn}>{i + 2}</th>
                <td style={cell}>{r.id ?? i + 1}</td>
                {selected.map((q) => <td key={q.id} style={cell}>{disp(r[q.id])}</td>)}
                {dataCols.map((c) => <td key={c} style={cell}>{disp(r[c])}</td>)}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* ── Summary ── */}
      {tab === 'summary' && (
        <Table minWidth={0} maxHeight={260}>
          <tbody>
            {charts.map(({ q, qq, type }) => {
              const field = String(q.id)
              const counts = countBy(filtered, field)
              const answered = [...counts.values()].reduce((a, b) => a + b, 0)
              const xs = qq.x ? options(filtered, qq.x) : null
              const ord = meta[field]?.order
              const opts = sortOpts([...counts.keys()], ord)
              return (
                <Fragment key={q.id}>
                  <tr style={{ background: SEL, fontWeight: 700 }}>
                    <td style={cell} colSpan={(xs ? xs.length : 2) + 2}>Q{qNum(q.id)}. {q.label} · {TYPE_LABEL[type] || ''}</td>
                  </tr>
                  {xs ? (
                    <>
                      <tr>
                        <th style={{ ...cell, textAlign: 'left' }}>Option</th>
                        {xs.map((x) => <th key={x} style={cell}>{x}</th>)}
                        <th style={cell}>Total</th>
                      </tr>
                      {opts.map((o) => {
                        const vals = xs.map((x) => filtered.filter((r) => r[field] === o && r[qq.x] === x).length)
                        return (
                          <tr key={o}>
                            <td style={cell}>{o}</td>
                            {vals.map((n, i) => <td key={i} style={{ ...cell, textAlign: 'right' }}>{n}</td>)}
                            <td style={{ ...cell, textAlign: 'right' }}><b>{vals.reduce((a, b) => a + b, 0)}</b></td>
                          </tr>
                        )
                      })}
                    </>
                  ) : (
                    <>
                      <tr>
                        <th style={{ ...cell, textAlign: 'left' }}>Option</th>
                        <th style={cell}>Count</th>
                        <th style={cell}>%</th>
                      </tr>
                      {opts.map((o) => {
                        const n = counts.get(o) || 0
                        return (
                          <tr key={o}>
                            <td style={cell}>{o}</td>
                            <td style={{ ...cell, textAlign: 'right' }}>{n}</td>
                            <td style={{ ...cell, textAlign: 'right' }}>{answered ? ((n * 100) / answered).toFixed(1) : '0.0'}%</td>
                          </tr>
                        )
                      })}
                    </>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </Table>
      )}

      {/* ── Questions ── */}
      {tab === 'questions' && (
        <Table minWidth={0} maxHeight={260}>
          <thead>
            <tr style={{ background: SEL, fontWeight: 700 }}>
              <th style={{ ...cell, textAlign: 'left' }}>Q No</th>
              <th style={{ ...cell, textAlign: 'left' }}>Question</th>
              <th style={cell}>Options</th>
              <th style={cell}>Answered</th>
              <th style={cell}>Chart</th>
            </tr>
          </thead>
          <tbody>
            {selected.map((q) => {
              const counts = countBy(filtered, String(q.id))
              const answered = [...counts.values()].reduce((a, b) => a + b, 0)
              const cfg = charts.find((c) => c.q.id === q.id)
              return (
                <tr key={q.id}>
                  <td style={cell}>Q{qNum(q.id)}</td>
                  <td style={cell}>{String(q.label).slice(0, 70)}</td>
                  <td style={cell}>{Array.isArray(q.options) && q.options.length ? q.options.slice(0, 6).join(', ') : '—'}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{answered}</td>
                  <td style={cell}>{TYPE_LABEL[cfg?.type] || cfg?.type}</td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      {/* ── Filters ── */}
      {tab === 'filters' && (
        <Table minWidth={0} maxHeight={260}>
          <thead>
            <tr style={{ background: SEL, fontWeight: 700 }}>
              <th style={{ ...cell, textAlign: 'left' }}>Filter (question)</th>
              <th style={{ ...cell, textAlign: 'left' }}>Selected</th>
              <th style={cell}>Rows with this value alone</th>
            </tr>
          </thead>
          <tbody>
            {selected.map((q) => {
              const field = String(q.id)
              const S = values[field]
              return (
                <tr key={field}>
                  <td style={cell}>Q{qNum(field)}. {String(q.label).slice(0, 44)}</td>
                  <td style={cell}>{S?.size ? [...S].join(' | ') : 'All'}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    {rows.filter((r) => !S?.size || S.has(r[field])).length}
                  </td>
                </tr>
              )
            })}
            <tr style={{ background: SEL, fontWeight: 700 }}>
              <td style={cell} colSpan={2}>Rows matching all active filters</td>
              <td style={{ ...cell, textAlign: 'right' }}>{filtered.length} of {rows.length}</td>
            </tr>
          </tbody>
        </Table>
      )}

      {/* ── Analysis ── */}
      <div style={{ padding: '6px 12px', fontSize: 12, lineHeight: 1.45, borderTop: `1px solid ${GRID}` }}>
        <h4 style={{ margin: '0 0 3px', color: GREEN, fontSize: 13 }}>
          Analysis of selected data · {filtered.length} of {rows.length} responses ({rows.length ? ((filtered.length * 100) / rows.length).toFixed(0) : 0}%)
        </h4>
        {truncated && (
          <div style={{ color: '#b45309' }}>
            ⚠ Only the first {rows.length.toLocaleString()} records were loaded for analysis — narrow the surveyor/district/date filters for exact figures.
          </div>
        )}
        <div style={{ color: '#4b5563', marginBottom: 4 }}>
          Filters: {activeNotes.length ? activeNotes.join(' · ') : 'none'}{filterNote ? ` · ${filterNote}` : ''}
        </div>
        {filtered.length < 30 && (
          <div style={{ color: '#b45309' }}>⚠ Small sample (under 30): treat as indicative only.</div>
        )}
        <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
          {analysis.map((a) => (
            <li key={a.num} style={{ marginBottom: 4 }}>
              <b>Q{a.num}. {a.text}</b>: {a.empty ? 'no responses match these filters.' : a.body}
            </li>
          ))}
        </ul>
      </div>
      </>)}
    </div>
  )
}
