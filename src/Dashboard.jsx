import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { getAnalytics, listSurveys } from './api'
import SurveyMap from './SurveyMap'
import { getDisplayLang, setDisplayLang } from './prefs'
import PeriodTable from './components/PeriodTable'

const PARTY_COLORS = {
  Congress: '#16a34a',
  BJP: '#f97316',
  BRS: '#ec4899',
  Others: '#94a3b8',
  Undecided: '#64748b',
  Unknown: '#475569',
  Positive: '#16a34a',
  Neutral: '#fbbf24',
  Negative: '#ef4444',
}

const PALETTE = [
  '#059669',
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

const SOURCE_LABELS = { web: 'Web (incl. pending)', field: 'Field (confirmed)' }

/** Local calendar day (YYYY-MM-DD). toISOString() is UTC, so it shows the wrong day before 05:30 IST. */
function localDay() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

function pickFirstSurveyKey(items) {
  return items[0]?.form_key || ''
}

function colorFor(name, i = 0) {
  return PARTY_COLORS[name] || PALETTE[i % PALETTE.length]
}

/** `name` is English (filters/maps). `label` is Telugu. Never mix in one list. */
function shown(d, fallback = '', lang = 'en') {
  if (d && typeof d === 'object') {
    if (lang === 'te') return d.label || d.name || fallback
    return d.name || fallback
  }
  return fallback
}



function questionFilterTitle(q, lang) {
  const typed = String(q.label_en || q.label || '').trim()
  const te = String(q.label_te || '').trim()
  if (lang === 'te') return te || typed || 'Question'
  return typed || 'Question'
}

function optionFilterText(name, q, countRow, lang) {
  if (lang !== 'te') return name
  if (countRow?.label && countRow.label !== name) return countRow.label
  const i = (q.options || []).findIndex((o) => o === name)
  if (i >= 0 && q.options_te?.[i]) return q.options_te[i]
  return name
}

function FilterLangToggle({ value, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
      {[
        { id: 'en', label: 'English' },
        { id: 'te', label: 'తెలుగు' },
      ].map((p) => (
        <button
          key={p.id}
          type="button"
          className={`chip ${value === p.id ? 'selected' : ''}`}
          onClick={() => onChange(p.id)}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

function tickShown(data, lang = 'en') {
  return (v) => {
    const row = (data || []).find((d) => d.name === v)
    if (!row) return v
    return lang === 'te' ? row.label || v : row.name || v
  }
}

/** Options as created on the survey, in that order — never drop a choice because it has 0 answers. */
function createdOptions(q) {
  if (q?.authored?.length) return q.authored.map(String)
  if (q?.options?.length) return q.options.map(String)
  const t = String(q?.type || '')
  if (t === 'yesno') return ['Yes', 'No']
  if (t === 'abc') return ['A', 'B', 'C', 'D']
  if (t === 'sentiment' || t === 'sentiment_text' || t === 'meter' || t === 'tapometer') {
    return ['Negative', 'Neutral', 'Positive']
  }
  if (t === 'range' || t === 'numeric_range' || t === 'age') {
    return ['10-20', '21-30', '31-40', '41-50', '50+']
  }
  return []
}

function rowsFromSurveyQuestion(q) {
  const countMap = new Map((q?.counts || []).map((c) => [String(c.name), c]))
  const seen = new Set()
  const rows = []
  for (const name of createdOptions(q)) {
    const key = String(name)
    const low = key.toLowerCase()
    if (!key || seen.has(low)) continue
    seen.add(low)
    const c =
      countMap.get(key) ||
      [...countMap.values()].find((x) => String(x.name).toLowerCase() === low)
    rows.push({
      name: key,
      value: Number(c?.value || 0),
      pct: Number(c?.pct || 0),
      label: c?.label || key,
    })
  }
  for (const c of q?.counts || []) {
    const low = String(c.name).toLowerCase()
    if (seen.has(low) || Number(c.value) <= 0) continue
    seen.add(low)
    rows.push({ ...c, value: Number(c.value || 0) })
  }
  return rows
}

/**
 * Pie only when every option stays readable. Otherwise bars.
 * Not tied to question type — a 4-way crop list or a 99%/1% Yes-No both use bars.
 */
function chartShouldUsePie(rows) {
  if (!rows?.length) return false
  const total = rows.reduce((s, c) => s + Number(c.value || 0), 0)
  if (total <= 0) return false
  if (rows.some((c) => Number(c.value) <= 0)) return false
  if (rows.length < 2 || rows.length > 3) return false
  const minShare = Math.min(...rows.map((c) => Number(c.value) / total))
  return minShare >= 0.08
}

/** Relative freshness — 09-ANALYTICS-SPEC §7: "Data as of {relative time}" */
function timeAgo(iso) {
  const t = new Date(iso).getTime()
  if (!(t > 0)) return ''
  const diff = Date.now() - t
  if (diff < 60 * 1000) return 'just now'
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hr${h > 1 ? 's' : ''} ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yesterday'
  return `${d} days ago`
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

const EmptyChart = memo(function EmptyChart({ label = 'No data for current filters' }) {
  return <div className="chart-empty">{label}</div>
})

/**
 * One chart card per question. When the survey tags questions with categories the cards
 * are grouped under collapsible headers; untagged surveys render the flat list unchanged.
 */
const QuestionChartsBlock = memo(function QuestionChartsBlock({ questions = [], order = [], lang, onPick }) {
  const [closed, setClosed] = useState(() => ({}))

  const card = (q) => {
    const counts = rowsFromSurveyQuestion(q)
    const pick = (_, name) => onPick?.(q.id, name)
    const isMeter = q.type === 'meter' || q.type === 'tapometer'
    const pieOk = !isMeter && chartShouldUsePie(counts)
    return (
      <ChartCard key={q.id} title={questionFilterTitle(q, lang)} subtitle="Every option for this question">
        {isMeter ? (
          <MeterChart q={q} rows={counts} lang={lang} onSelect={pick} />
        ) : pieOk ? (
          <InteractivePie data={counts} lang={lang} onSelect={pick} />
        ) : (
          <HBar data={counts} lang={lang} onSelect={pick} />
        )}
      </ChartCard>
    )
  }

  if (!questions.some((q) => q.category)) return questions.map(card)

  const buckets = new Map()
  for (const q of questions) {
    const name = String(q.category || '')
    if (!buckets.has(name)) buckets.set(name, [])
    buckets.get(name).push(q)
  }
  const names = [...order.filter((n) => buckets.has(n))]
  for (const n of buckets.keys()) if (!names.includes(n) && n) names.push(n)
  if (buckets.has('')) names.push('')

  const out = []
  for (const name of names) {
    const items = buckets.get(name) || []
    if (!items.length) continue
    const isOpen = !closed[name]
    out.push(
      <div
        key={`group-${name}`}
        className="chart-card"
        style={{ gridColumn: '1 / -1', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}
      >
        <button
          type="button"
          className="btn small"
          onClick={() => setClosed((prev) => ({ ...prev, [name]: isOpen }))}
          aria-expanded={isOpen}
        >
          {isOpen ? '▾' : '▸'}
        </button>
        <strong style={{ fontSize: 15 }}>{name || 'Uncategorized'}</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          {items.length} question{items.length === 1 ? '' : 's'}
        </span>
      </div>,
    )
    if (isOpen) out.push(...items.map(card))
  }
  return out
})

/** Super-set / Sub-set dual bars */
const ContrastBars = memo(function ContrastBars({ data, lang = 'en' }) {
  if (!data?.length) return <EmptyChart label="Apply a filter to see Subset vs Rest" />
  return (
    <div className="contrast-list">
      {data.slice(0, 10).map((d) => (
        <div key={d.name} className="contrast-row">
          <div className="contrast-head">
            <span className="contrast-name">{shown(d, '', lang)}</span>
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
})

const tipStyle = {
  background: '#0f1720',
  border: '1px solid #2a3648',
  borderRadius: 10,
  fontSize: 12,
}

function PctTooltip({ active, payload, label, lang = 'en' }) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  const title = lang === 'te' ? p?.label || label || p?.name : p?.name || label
  return (
    <div className="recharts-custom-tip" style={{ ...tipStyle, padding: '8px 10px' }}>
      <div style={{ color: '#e2e8f0', fontWeight: 700 }}>{title}</div>
      {payload.map((item) => (
        <div key={item.dataKey} style={{ color: item.color || '#94a3b8' }}>
          {lang === 'te' && item.payload?.label ? item.payload.label : item.name}: {item.value}
          {p?.pct != null && item.dataKey === 'value' ? ` (${p.pct}%)` : ''}
        </div>
      ))}
    </div>
  )
}

const InteractivePie = memo(function InteractivePie({ data, onSelect, selectKey, extra, activeName, lang = 'en' }) {
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
          onClick={(entry) => onSelect?.(selectKey, entry?.name, extra)}
          style={{ cursor: onSelect ? 'pointer' : 'default' }}
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
        <Tooltip content={(props) => <PctTooltip {...props} lang={lang} />} />
        <Legend
          verticalAlign="bottom"
          height={48}
          formatter={(v, entry) => {
            const row = entry?.payload
            const text = lang === 'te' ? row?.label || v : row?.name || v
            const n = row?.value
            return (
              <span style={{ color: '#94a3b8', fontSize: 11 }}>
                {n != null ? `${text} (${n})` : text}
              </span>
            )
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
})

const HBar = memo(function HBar({ data, onSelect, selectKey, extra, activeName, lang = 'en' }) {
  if (!data?.length) return <EmptyChart />
  const height = Math.max(200, data.length * 28 + 40)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
        <XAxis
          type="number"
          stroke="#64748b"
          fontSize={11}
          allowDecimals={false}
          domain={[0, (max) => (Number(max) > 0 ? max : 1)]}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={lang === 'te' ? 120 : 108}
          stroke="#94a3b8"
          fontSize={11}
          tickLine={false}
          tickFormatter={tickShown(data, lang)}
        />
        <Tooltip content={(props) => <PctTooltip {...props} lang={lang} />} />
        <Bar
          dataKey="value"
          radius={[0, 6, 6, 0]}
          onClick={(entry) => onSelect?.(selectKey, entry?.name || entry?.payload?.name, extra)}
          cursor={onSelect ? 'pointer' : 'default'}
        >
          {data.map((d, i) => (
            <Cell
              key={d.name}
              fill={colorFor(d.name, i)}
              opacity={activeName && activeName !== d.name ? 0.3 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
})

const StackedParty = memo(function StackedParty({ matrix, onSelect, selectKey, extra, lang = 'en' }) {
  if (!matrix?.rows?.length) return <EmptyChart />
  const data = matrix.rows.slice(0, 10)
  const cols = (matrix.columns || []).filter(
    (c) => c && data.some((row) => Number(row[c]) > 0),
  )
  if (!cols.length) return <EmptyChart label="No party breakdown in this survey" />
  const height = Math.max(220, data.length * 32 + 50)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12, top: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
        <XAxis type="number" stroke="#64748b" fontSize={11} />
        <YAxis
          type="category"
          dataKey="name"
          width={88}
          stroke="#94a3b8"
          fontSize={11}
          tickLine={false}
          tickFormatter={tickShown(data, lang)}
        />
        <Tooltip
          contentStyle={tipStyle}
          labelStyle={{ color: '#e2e8f0' }}
          itemStyle={{ fontSize: 12 }}
          formatter={(value, name) => [value, matrix.column_labels?.[name] || name]}
          labelFormatter={(v) => {
            const row = data.find((d) => d.name === v)
            return lang === 'te' ? row?.label || v : v
          }}
        />
        <Legend
          formatter={(v) => (
            <span style={{ color: '#94a3b8', fontSize: 11 }}>
              {matrix.column_labels?.[v] || v}
            </span>
          )}
        />
        {cols.map((col) => (
          <Bar
            key={col}
            dataKey={col}
            stackId="p"
            fill={colorFor(col)}
            onClick={(entry) => onSelect?.(selectKey, entry?.payload?.name, extra)}
            cursor={onSelect ? 'pointer' : 'default'}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
})

const Timeline = memo(function Timeline({ data }) {
  if (!data?.length) return <EmptyChart label="No timeline data yet" />
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#059669" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#059669" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
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
          stroke="#059669"
          fill="url(#volGrad)"
          strokeWidth={2}
          name="Responses"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
})

const MeterChart = memo(function MeterChart({ q, rows, lang = 'en', onSelect, selectKey, activeName }) {
  const bandRows = rowsFromSurveyQuestion({
    ...q,
    type: 'meter',
    authored: ['Negative', 'Neutral', 'Positive'],
    options: ['Negative', 'Neutral', 'Positive'],
    counts: rows,
  })
  const answered = bandRows.reduce((s, r) => s + Number(r.value || 0), 0)
  const avgDirect = Number(q?.meter?.avg)
  const weighted =
    answered > 0
      ? bandRows.reduce((s, r) => {
          const mid = r.name === 'Negative' ? 17 : r.name === 'Positive' ? 83 : 50
          return s + mid * Number(r.value || 0)
        }, 0) / answered
      : 50
  const val = Number.isFinite(avgDirect) && avgDirect > 0 ? avgDirect : weighted
  const shownVal = Math.round(val)
  const mood = shownVal <= 33 ? 'Negative' : shownVal <= 66 ? 'Neutral' : 'Positive'
  const moodClass = shownVal <= 33 ? 'neg' : shownVal <= 66 ? 'neu' : 'pos'
  return (
    <div>
      <div className="qa-meter" style={{ marginBottom: 12 }}>
        <div className="qa-meter-track">
          <input type="range" min="1" max="100" step="1" value={shownVal} readOnly aria-label="Tapometer average" />
        </div>
        <div className="qa-meter-scale">
          <span>Negative</span>
          <span>Neutral</span>
          <span>Positive</span>
        </div>
        <div className="qa-meter-value">
          <strong>{answered ? `${shownVal}%` : '—'}</strong>
          {answered ? (
            <span className={`qa-opt selected ${moodClass}`} style={{ minHeight: 32, padding: '4px 12px' }}>
              {mood} · {answered} answer{answered === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="muted">No tapometer answers yet</span>
          )}
        </div>
      </div>
      <HBar
        data={bandRows}
        lang={lang}
        onSelect={onSelect}
        selectKey={selectKey}
        activeName={activeName}
      />
    </div>
  )
})

const RadialIssues = memo(function RadialIssues({ data, onClick, lang = 'en' }) {
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
          formatter={(v, entry) => (
            <span style={{ color: '#94a3b8', fontSize: 10 }}>
              {lang === 'te' ? entry?.payload?.label || v : entry?.payload?.name || v}
            </span>
          )}
        />
        <Tooltip content={(props) => <PctTooltip {...props} lang={lang} />} />
      </RadialBarChart>
    </ResponsiveContainer>
  )
})

export default function DashboardScreen({ onToast }) {
  const [filters, setFilters] = useState({
    district: '',
    party: '',
    gender: '',
    caste: '',
    constituency: '',
    user: '',
    survey: '',
    source: '',
    period: 'total',
    day: localDay(),
    month: localDay().slice(0, 7),
  })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [surveys, setSurveys] = useState([])
  const [tableTab, setTableTab] = useState('day')
  const [filterLang, setFilterLang] = useState(getDisplayLang)
  const [moreOpen, setMoreOpen] = useState(false)

  const setFilterLangPersist = useCallback((lang) => {
    setFilterLang(setDisplayLang(lang))
  }, [])

  useEffect(() => {
    const onLang = () => setFilterLang(getDisplayLang())
    window.addEventListener('esurvey-display-lang', onLang)
    return () => window.removeEventListener('esurvey-display-lang', onLang)
  }, [])

  useEffect(() => {
    const s = surveys.find((x) => x.form_key === filters.survey)
    if (s?.display_lang === 'te' || s?.display_lang === 'en') setFilterLangPersist(s.display_lang)
  }, [filters.survey, surveys, setFilterLangPersist])

  useEffect(() => {
    listSurveys()
      .then((d) => {
        const items = d.items || []
        setSurveys(items)
        const first = pickFirstSurveyKey(items)
        if (first) setFilters((f) => (f.survey ? f : { ...f, survey: first }))
      })
      .catch(() => {})
  }, [])

  // Latest-request-wins: a slow older response can never overwrite newer data.
  const reqSeq = useRef(0)
  const hasChartData = useRef(false)
  const toastRef = useRef(onToast)
  toastRef.current = onToast

  const load = useCallback(async () => {
    const seq = ++reqSeq.current
    if (!hasChartData.current) setLoading(true)
    setError(null)
    try {
      const params = {
        district: filters.district,
        party: filters.party,
        gender: filters.gender,
        caste: filters.caste,
        constituency: filters.constituency,
        user: filters.user,
        survey: filters.survey,
        source: filters.source || '',
        period: filters.period || 'total',
      }
      Object.entries(filters)
        .filter(([k, v]) => k.startsWith('q_') && v)
        .forEach(([k, v]) => {
          params[k] = v
        })
      if (filters.period === 'day') params.day = filters.day
      if (filters.period === 'month') params.month = filters.month
      const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v))
      const res = await getAnalytics({ ...clean, completeness: 'complete', report: 'locked' })
      if (seq !== reqSeq.current) return
      setData(res)
      hasChartData.current = true
    } catch (e) {
      if (seq !== reqSeq.current) return
      setError(e.message)
      toastRef.current?.(e.message, 'error')
    } finally {
      if (seq === reqSeq.current) setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    const t = setTimeout(load, 180)
    return () => clearTimeout(t)
  }, [load])

  /** Clear every optional filter. Keep the survey, and drop per-question filters too. */
  const clearFilters = useCallback(() => {
    setFilters((f) => {
      const next = {
        district: '',
        party: '',
        gender: '',
        caste: '',
        constituency: '',
        user: '',
        survey: f.survey || pickFirstSurveyKey(surveys),
        source: '',
        period: 'total',
        day: localDay(),
        month: localDay().slice(0, 7),
      }
      Object.keys(f).forEach((k) => {
        if (k.startsWith('q_')) next[k] = ''
      })
      return next
    })
  }, [surveys])

  const removeFilter = useCallback((key) => {
    setFilters((f) => {
      const next = { ...f, [key]: '' }
      if (key === 'district') next.constituency = ''
      if (key === 'period') next.period = 'total'
      return next
    })
  }, [])

  /** Chart clicks set the matching filter. Clicking the same value again clears it. */
  const drillFilter = useCallback((key, value) => {
    setFilters((f) => {
      const next = { ...f, [key]: f[key] === value ? '' : value }
      if (key === 'district') next.constituency = ''
      return next
    })
  }, [])
  const drillQuestion = useCallback((qid, value) => drillFilter(`q_${qid}`, value), [drillFilter])

  const filterChipLabels = {
    district: 'District',
    party: 'Party',
    gender: 'Gender',
    caste: 'Caste',
    constituency: 'Assembly',
    user: 'Surveyor',
  }
  const teChipLabels = {
    district: 'జిల్లా',
    party: 'పార్టీ',
    gender: 'లింగం',
    caste: 'కులం',
    constituency: 'నియోజకవర్గం',
    user: 'సర్వేయర్',
  }
  const labelTableKey = {
    district: 'districts',
    party: 'parties',
    gender: 'genders',
    caste: 'castes',
    constituency: 'constituencies',
  }

  const activeFilterChips = useMemo(() => {
    const chips = []
    for (const [k, v] of Object.entries(filters)) {
      if (!v || k === 'day' || k === 'month' || k === 'survey') continue
      if (k === 'period') {
        if (v !== 'total') {
          chips.push({ key: 'period', label: 'Period', value: { today: 'Today', day: 'Day', month: 'Month' }[v] || v })
        }
        continue
      }
      if (k === 'source') {
        chips.push({ key: k, label: 'Source', value: SOURCE_LABELS[v] || v })
        continue
      }
      if (k.startsWith('q_')) {
        const q = data?.dataFilters?.questions?.find((x) => `q_${x.id}` === k)
        const countRow = (q?.counts || []).find((c) => c.name === v)
        chips.push({
          key: k,
          label: q ? questionFilterTitle(q, filterLang) : 'Question',
          value: q ? optionFilterText(v, q, countRow, filterLang) : v,
        })
        continue
      }
      const teVal =
        filterLang === 'te' && labelTableKey[k] ? data?.filterLabels?.[labelTableKey[k]]?.[v] : null
      chips.push({
        key: k,
        label: filterLang === 'te' ? teChipLabels[k] || filterChipLabels[k] || k : filterChipLabels[k] || k,
        value: teVal || v,
      })
    }
    return chips
  }, [filters, data, filterLang])
  const activeCount = activeFilterChips.length

  const charts = data?.charts
  const opts = data?.filterOptions
  const confirmedCount = data?.statusCounts?.confirmed ?? 0
  const pendingCount = data?.statusCounts?.pending ?? 0
  const reportCount = data?.totalAll || data?.filtered || 0
  const reportReady = !!data && reportCount > 0

  const filtersBroken =
    data && activeCount > 0 && data.filtered === data.totalAll && !data.isFiltered && !(opts?.districts?.length > 0)

  // Freshness: stale when no new confirmation in 2+ days
  const stale = !!data?.data_as_of && Date.now() - new Date(data.data_as_of).getTime() > 2 * 24 * 60 * 60 * 1000

  const questionsMerged = useMemo(() => {
    const fromCharts = charts?.questionCharts || []
    const fromFilters = data?.dataFilters?.questions || []
    const byId = new Map(fromCharts.map((q) => [q.id, q]))
    const merged = []
    const seen = new Set()
    for (const fq of fromFilters) {
      const cq = byId.get(fq.id) || {}
      merged.push({
        ...fq,
        ...cq,
        id: fq.id,
        type: cq.type || fq.type,
        category: cq.category || fq.category,
        authored: cq.authored || fq.authored || fq.options || cq.options,
        options: fq.options?.length ? fq.options : cq.options,
        options_te: fq.options_te || cq.options_te,
        counts: cq.counts || fq.counts,
        meter: cq.meter || fq.meter,
        label_en: cq.label_en || fq.label_en,
        label_te: cq.label_te || fq.label_te,
        label: cq.label || fq.label,
      })
      seen.add(fq.id)
    }
    for (const cq of fromCharts) if (!seen.has(cq.id)) merged.push(cq)
    return merged.filter((q) => q.visible !== false)
  }, [charts, data])

  const sourceOptions = [
    { id: '', label: 'All' },
    { id: 'web', label: 'Web (incl. pending)' },
    { id: 'field', label: 'Field (confirmed)' },
  ]

  return (
    <div className="screen dashboard-screen">
      <header className="screen-head row">
        <div>
          <h2>Analyze</h2>
          <p>
            {loading && !data
              ? 'Loading…'
              : reportCount > 0
                ? `${Number(data.filtered || reportCount).toLocaleString()} records · field confirmed + pending web`
                : pendingCount > 0
                  ? `${pendingCount.toLocaleString()} pending web. Pick that survey and the Web source.`
                  : 'No chart data for this survey yet'}
          </p>
        </div>
        <div className="row">
          {data?.data_as_of && (
            <span className={stale ? 'pill bad' : 'pill ok'} title={new Date(data.data_as_of).toLocaleString()}>
              <span className="dot" />
              Data as of {timeAgo(data.data_as_of)}
              {stale ? ' · stale' : ''}
            </span>
          )}
          {data?.degraded && (
            <span className="pill bad" title={data.degraded_reason || ''}>
              <span className="dot" />
              Degraded
            </span>
          )}
          <button type="button" className="btn small" onClick={load} disabled={loading}>
            {loading ? '…' : 'Refresh'}
          </button>
        </div>
      </header>

      {/* Filter bar: always visible, so survey and source are reachable even with no data */}
      <section
        className="card"
        aria-label="Dashboard filters"
        style={{ position: 'sticky', top: 0, zIndex: 5, display: 'grid', gap: 10 }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <label className="field compact" style={{ minWidth: 180 }}>
            <span>Survey</span>
            <select
              value={filters.survey}
              onChange={(e) => {
                const survey = e.target.value
                // A new survey clears per-question and surveyor filters
                setFilters((f) => ({
                  ...Object.fromEntries(
                    Object.entries(f).filter(([k]) => !k.startsWith('q_') && k !== 'user'),
                  ),
                  survey,
                }))
              }}
            >
              {surveys.length === 0 && <option value="">No surveys yet</option>}
              {surveys.map((s) => (
                <option key={s.id} value={s.form_key}>
                  {s.title}
                  {s.form_key === 'legacy' ? ' · Excel import' : ''}
                  {Number(s.web_submissions) > 0 ? ` · ${Number(s.web_submissions)} web` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="field compact" style={{ minWidth: 160 }}>
            <span>Surveyor</span>
            <select
              value={filters.user}
              onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value }))}
            >
              <option value="">
                {data?.dataFilters?.by_user?.length ? 'All surveyors' : 'No surveyors yet'}
              </option>
              {(data?.dataFilters?.by_user || []).map((u) => (
                <option key={u.name} value={u.name}>
                  {u.name} ({u.value})
                </option>
              ))}
            </select>
          </label>

          <label className="field compact" style={{ minWidth: 130 }}>
            <span>Period</span>
            <select
              value={filters.period}
              onChange={(e) => setFilters((f) => ({ ...f, period: e.target.value }))}
            >
              <option value="total">Total data</option>
              <option value="today">Today</option>
              <option value="day">Day</option>
              <option value="month">Month</option>
            </select>
          </label>

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

          <label className="field compact" style={{ minWidth: 150 }}>
            <span>{filterLang === 'te' ? 'జిల్లా' : 'District'}</span>
            <select
              value={filters.district}
              onChange={(e) =>
                setFilters((f) => ({ ...f, district: e.target.value, constituency: '' }))
              }
            >
              <option value="">{filterLang === 'te' ? 'అన్ని జిల్లాలు' : 'All districts'}</option>
              {(opts?.districts || []).map((d) => (
                <option key={d} value={d}>
                  {filterLang === 'te' ? data?.filterLabels?.districts?.[d] || d : d}
                </option>
              ))}
            </select>
          </label>

          <div className="field compact">
            <span>Source</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {sourceOptions.map((p) => (
                <button
                  key={p.id || 'all'}
                  type="button"
                  className={`chip ${filters.source === p.id ? 'selected' : ''}`}
                  onClick={() => setFilters((f) => ({ ...f, source: p.id }))}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginLeft: 'auto' }}>
            <FilterLangToggle value={filterLang} onChange={setFilterLangPersist} />
          </div>
        </div>

        <details open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
            {filterLang === 'te' ? 'ప్రశ్న ఫిల్టర్లు' : 'Question filters'}
          </summary>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
            {(data?.dataFilters?.questions || [])
              .filter((q) => q.visible !== false)
              .map((q) => {
                const countMap = new Map((q.counts || []).map((c) => [c.name, c]))
                const optionNames = [...new Set([...createdOptions(q), ...countMap.keys()])]
                const title = questionFilterTitle(q, filterLang)
                return (
                  <label className="field compact" key={q.id} style={{ minWidth: 200 }}>
                    <span>{title}</span>
                    <select
                      value={filters[`q_${q.id}`] || ''}
                      onChange={(e) => setFilters((f) => ({ ...f, [`q_${q.id}`]: e.target.value }))}
                    >
                      <option value="">
                        {filterLang === 'te' ? 'అన్నీ' : 'All'} {title}
                      </option>
                      {optionNames.map((name) => {
                        const n = countMap.get(name)?.value
                        return (
                          <option key={name} value={name}>
                            {`${optionFilterText(name, q, countMap.get(name), filterLang)} (${n ?? 0})`}
                          </option>
                        )
                      })}
                    </select>
                  </label>
                )
              })}
            {!data?.dataFilters?.questions?.length && (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                No question filters for this survey yet.
              </p>
            )}
          </div>
        </details>

        {activeFilterChips.length > 0 && (
          <div className="pill-row">
            {activeFilterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="chip selected"
                onClick={() => removeFilter(chip.key)}
                title={`Remove ${chip.label} filter`}
              >
                {chip.label}: {chip.value} ✕
              </button>
            ))}
            <button type="button" className="link-btn" onClick={clearFilters}>
              Clear all
            </button>
          </div>
        )}
        {filtersBroken && (
          <div className="banner error" role="alert">
            Filters did not apply. Redeploy Deno API if this persists.
          </div>
        )}
      </section>

      {/* Status */}
      {data?.statusCounts && (
        <div className="card" style={{ fontSize: 13 }}>
          Waiting confirm <strong>{pendingCount}</strong>
          {' · '}Confirmed <strong>{confirmedCount}</strong>
          {' · '}In this report <strong>{data.totalAll ?? 0}</strong>
          <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
            Field charts use confirmed records. Pending web fills show when the Web source is picked.
          </span>
        </div>
      )}

      {error && data && (
        <div className="banner error" role="alert">
          Refresh failed: {error}. Showing last loaded data.{' '}
          <button type="button" className="link-btn" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {error && !data && (
        <div className="card" style={{ padding: 16, textAlign: 'center' }} role="alert">
          <h3 style={{ margin: '0 0 8px' }}>Couldn't load the dashboard</h3>
          <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
            {error}
          </p>
          <button type="button" className="btn small primary" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!error && loading && !data && (
        <div className="card" style={{ padding: 16 }}>
          <p className="muted center" style={{ margin: 0 }}>
            Checking confirmed data…
          </p>
        </div>
      )}

      {!loading && data && !reportReady && (
        <div className="card" style={{ textAlign: 'center', padding: 24 }}>
          <h3 style={{ margin: '0 0 8px' }}>No chart rows for this filter</h3>
          <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
            {pendingCount > 0
              ? 'Pending web fills exist for this survey. Pick the Web source above to chart them.'
              : 'Clear a filter, or pick a different survey.'}
          </p>
          <p style={{ fontSize: 13, margin: 0 }}>
            Waiting confirm: <strong>{pendingCount}</strong> · confirmed: <strong>{confirmedCount}</strong>
          </p>
        </div>
      )}

      {reportReady && (
        <>
          {/* KPI strip */}
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
              <strong>{charts?.byParty?.[0]?.name ? shown(charts.byParty[0], '', filterLang) : '—'}</strong>
              <span>Lead party</span>
            </div>
            <div className="kpi">
              <strong>{charts?.issues?.[0]?.name ? shown(charts.issues[0], '', filterLang) : '—'}</strong>
              <span>Top issue</span>
            </div>
            <div className="kpi">
              <strong>{data.collectTime?.median_label || '—'}</strong>
              <span>Median collect time</span>
            </div>
          </div>

          {data.insights && (
            <div className="insight-row">
              <div className="insight">{data.insights.topParty}</div>
              <div className="insight">{data.insights.topIssue}</div>
              <div className="insight">{data.insights.topDistrict}</div>
              {data.insights.contrast && <div className="insight">{data.insights.contrast}</div>}
            </div>
          )}

          {data.formula && (
            <section className="card formula-card">
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
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                {data.isFiltered
                  ? 'Δpp = Subset% − Rest%. Index = Subset% / Superset% (1.0 = same as full population).'
                  : 'Pick a filter to compare Subset vs Rest. Δpp = Subset% − Rest%.'}
              </p>
            </section>
          )}

          <div className="chart-grid">
            {charts?.byParty?.length > 0 && (
              <PeriodTable
                title="Party preference"
                subtitle="Validated palette · measured distribution"
                columns={[
                  { key: 'name', label: 'Party', partyDot: true },
                  { key: 'value', label: 'Count', align: 'right' },
                  { key: 'pct', label: 'Share %', align: 'right', format: (v) => `${v}%`, bar: true },
                ]}
                data={{
                  total: (() => {
                    const byP = charts.byParty || []
                    const totalN = byP.reduce((s, p) => s + (p.value || 0), 0)
                    return byP.map((p) => ({
                      name: p.name,
                      value: p.value,
                      pct: totalN > 0 ? Number(((p.value / totalN) * 100).toFixed(1)) : 0,
                      color: PARTY_COLORS[p.name] || 'var(--party-others)',
                    }))
                  })(),
                }}
                periods={['total']}
              />
            )}

            <div className="map-span">
              <SurveyMap analytics={data} filters={filters} lang={filterLang} />
            </div>

            {data.isFiltered &&
              [
                ['Subset vs Rest — Party', charts?.contrastParty],
                ['Subset vs Rest — Gender', charts?.contrastGender],
                ['Subset vs Rest — Caste', charts?.contrastCaste],
                ['Subset vs Rest — Assembly', charts?.contrastConstituency],
                ['Subset vs Rest — District', charts?.contrastDistrict],
                ['Subset vs Rest — Parliament (MP)', charts?.contrastMp],
              ]
                .filter(([, rows]) => rows?.length > 0)
                .map(([title, rows]) => (
                  <ChartCard key={title} title={title} subtitle="Δpp = Subset% − Rest%" tall>
                    <ContrastBars lang={filterLang} data={rows} />
                  </ChartCard>
                ))}

            <ChartCard title="Responses over time" subtitle="Daily volume" tall>
              <Timeline data={charts?.timeline} />
            </ChartCard>

            <ChartCard title="Top districts" subtitle="Click a bar to filter" tall>
              <HBar
                data={charts?.byDistrict}
                lang={filterLang}
                onSelect={(_, name) => drillFilter('district', name)}
              />
            </ChartCard>

            {charts?.partyByDistrict?.rows?.length > 0 && (
              <ChartCard title="Party × District" subtitle="Stacked share" tall>
                <StackedParty
                  lang={filterLang}
                  matrix={charts.partyByDistrict}
                  onSelect={(_, name) => drillFilter('district', name)}
                />
              </ChartCard>
            )}

            {charts?.issues?.length > 0 && (
              <ChartCard title="Local issues" subtitle="Most mentioned">
                <RadialIssues data={charts.issues} lang={filterLang} />
              </ChartCard>
            )}

            <QuestionChartsBlock
              questions={questionsMerged}
              order={(charts?.questionCategories || []).map((c) => c.name)}
              lang={filterLang}
              onPick={drillQuestion}
            />

            <ChartCard title="Top constituencies" subtitle="Click a bar to filter" tall>
              <HBar
                data={charts?.byConstituency}
                lang={filterLang}
                onSelect={(_, name) => drillFilter('constituency', name)}
              />
            </ChartCard>

            {data.collectTime?.count > 0 && (
              <ChartCard title="Collect time" subtitle="GPS → finish. Voice on or off does not change this clock.">
                <div className="stat-row" style={{ marginBottom: 10 }}>
                  <div className="stat">
                    <strong>{data.collectTime.avg_label}</strong>
                    <span>Average</span>
                  </div>
                  <div className="stat">
                    <strong>{data.collectTime.median_label}</strong>
                    <span>Median</span>
                  </div>
                  <div className="stat">
                    <strong>{data.collectTime.min_sec != null ? `${Math.round(data.collectTime.min_sec)}s` : '—'}</strong>
                    <span>Fastest</span>
                  </div>
                  <div className="stat">
                    <strong>{data.collectTime.max_sec != null ? `${Math.round(data.collectTime.max_sec)}s` : '—'}</strong>
                    <span>Slowest</span>
                  </div>
                </div>
                <SimpleTable
                  head={['Surveyor', 'Records', 'Avg time']}
                  rows={(data.collectTime.by_surveyor || []).map((u) => ({
                    cells: [u.name, u.n, u.avg_label],
                  }))}
                  empty="No timing rows."
                />
              </ChartCard>
            )}
          </div>

          <section className="card" style={{ display: 'grid', gap: 10 }}>
            <div className="admin-subtabs">
              {[
                ['day', 'By day'],
                ['month', 'By month'],
                ['surveyor', 'By surveyor'],
                ['survey', 'By survey'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={tableTab === id ? 'map-tab active' : 'map-tab'}
                  onClick={() => setTableTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {tableTab === 'day' && (
              <SimpleTable
                head={['Date', 'Records', '']}
                empty="No daily rows yet."
                rows={(data.dataFilters.by_day || []).slice(0, 31).map((d) => ({
                  cells: [<strong key="d">{d.name}</strong>, d.value],
                  action: (
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => setFilters((f) => ({ ...f, period: 'day', day: d.name }))}
                    >
                      Open
                    </button>
                  ),
                }))}
              />
            )}

            {tableTab === 'month' && (
              <SimpleTable
                head={['Month', 'Records', '']}
                empty="No monthly rows yet."
                rows={(data.dataFilters.by_month || []).slice(0, 24).map((m) => ({
                  cells: [<strong key="m">{m.name}</strong>, m.value],
                  action: (
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => setFilters((f) => ({ ...f, period: 'month', month: m.name }))}
                    >
                      Open
                    </button>
                  ),
                }))}
              />
            )}

            {tableTab === 'surveyor' && (
              <>
                <SimpleTable
                  head={['Surveyor', 'Day', 'Records', '']}
                  empty="No surveyor daily rows yet."
                  rows={(data.dataFilters.by_surveyor_day || []).slice(0, 60).map((r) => ({
                    cells: [<strong key="s">{r.surveyor}</strong>, r.day, r.value],
                    action: (
                      <button
                        type="button"
                        className="btn small"
                        onClick={() =>
                          setFilters((f) => ({ ...f, user: r.surveyor, period: 'day', day: r.day }))
                        }
                      >
                        Open
                      </button>
                    ),
                  }))}
                />
                <SimpleTable
                  head={['Surveyor', 'Month', 'Records', '']}
                  empty="No surveyor monthly rows yet."
                  rows={(data.dataFilters.by_surveyor_month || []).slice(0, 60).map((r) => ({
                    cells: [<strong key="s">{r.surveyor}</strong>, r.month, r.value],
                    action: (
                      <button
                        type="button"
                        className="btn small"
                        onClick={() =>
                          setFilters((f) => ({ ...f, user: r.surveyor, period: 'month', month: r.month }))
                        }
                      >
                        Open
                      </button>
                    ),
                  }))}
                />
              </>
            )}

            {tableTab === 'survey' && (
              <SimpleTable
                head={['Survey', 'Records', 'Surveyors', 'Locations', '']}
                empty="No survey rows yet."
                rows={(data.dataFilters.by_survey || []).slice(0, 25).map((s) => ({
                  cells: [
                    <strong key="t">{s.title}</strong>,
                    s.value,
                    (s.surveyors || []).length ? s.surveyors.join(', ') : '—',
                    `${(s.districts || []).length} district(s)${s.constituencies?.length ? ` · ${s.constituencies.length} AC(s)` : ''}`,
                  ],
                  action: (
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => setFilters((f) => ({ ...f, survey: s.name }))}
                    >
                      Filter
                    </button>
                  ),
                }))}
              />
            )}
          </section>
        </>
      )}

      <p className="dash-foot muted">
        Charts update live from Neon submissions. Click a bar or slice to filter the page. Click it again to clear.
      </p>
    </div>
  )
}

/** Plain table. Each row: `cells` plus an optional `action` cell. */
function SimpleTable({ head, rows, empty }) {
  if (!rows?.length) return <p className="muted">{empty}</p>
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={`${h}-${i}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.cells.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
              <td>{r.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
