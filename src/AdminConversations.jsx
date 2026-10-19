import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import {
  conversationAudioPath,
  downloadMediaFile,
  fetchMediaBlobUrl,
  listConversations,
} from './api'
import { saveBlob } from './zipStore'

const FIELD_TZ = 'Asia/Kolkata'

function istDayKey(value) {
  const d = value instanceof Date ? value : new Date(value || '')
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: FIELD_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

function todayKey() {
  return istDayKey(new Date())
}

function thisMonthKey() {
  return todayKey().slice(0, 7)
}

function formatWhen(value) {
  const d = new Date(value || '')
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: FIELD_TZ,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d)
  } catch {
    return d.toLocaleString()
  }
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms || 0) / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function statusOf(c) {
  const s = String(c.transcript_status || '')
  if (s === 'completed') {
    return c.transcript
      ? { label: 'English ready', tone: 'ok', group: 'ready' }
      : { label: 'No speech', tone: 'warn', group: 'ready' }
  }
  if (s === 'error') return { label: 'Failed', tone: 'bad', group: 'error' }
  if (s === 'stored') return { label: 'Waiting', tone: 'warn', group: 'processing' }
  return { label: 'Translating', tone: 'warn', group: 'processing' }
}

function transcriptHint(c) {
  const s = String(c.transcript_status || '')
  if (s === 'completed') return 'No English speech was detected in this recording.'
  if (s === 'error') return c.transcript_error || 'Translation failed.'
  if (s === 'stored') return 'Audio is on the server; translation has not started yet.'
  return 'Translation in progress…'
}

function csvRows(items) {
  return items.map((c) => ({
    id: c.id,
    recorded_at: formatWhen(c.recorded_at || c.created_at),
    surveyor: c.submitted_by || c.username || '',
    username: c.username || '',
    title: c.title || 'Voice conversation',
    duration_seconds: Math.round(Number(c.duration_ms || 0) / 1000),
    status: statusOf(c).label,
    english_transcript: c.transcript || '',
    original_transcript: c.transcript_original || '',
    audio_url: conversationAudioPath(c.id),
  }))
}

/**
 * Admin → Analyze & Export → Conversations.
 * Every field conversation recorded on the phone, its English transcript, and
 * the original speech text, with filters and a CSV export.
 */
export default function AdminConversationsScreen({ onToast }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('total')
  const [day, setDay] = useState(todayKey)
  const [month, setMonth] = useState(thisMonthKey)
  const [surveyor, setSurveyor] = useState('')
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [audioUrls, setAudioUrls] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [lastSynced, setLastSynced] = useState(null)
  const mountedRef = useRef(true)
  const audioUrlsRef = useRef({})
  const loadingRef = useRef(false)

  const load = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    try {
      const d = await listConversations({ all: true, limit: 1000 })
      if (mountedRef.current) {
        setItems(Array.isArray(d.items) ? d.items : [])
        setLastSynced(new Date())
      }
    } catch (e) {
      onToast?.(e.message || 'Could not load conversations', 'error')
    } finally {
      loadingRef.current = false
      if (mountedRef.current) setLoading(false)
    }
  }, [onToast])

  useEffect(() => {
    mountedRef.current = true
    void load()
    // New field recordings appear here automatically, like the field queue.
    const timer = setInterval(() => {
      if (!loadingRef.current) void load()
    }, 60_000)
    return () => {
      mountedRef.current = false
      clearInterval(timer)
      Object.values(audioUrlsRef.current).forEach((url) => {
        try {
          if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
        } catch {
          /* ignore */
        }
      })
    }
  }, [load])

  useEffect(() => {
    audioUrlsRef.current = audioUrls
  }, [audioUrls])

  const surveyors = useMemo(() => {
    const set = new Set()
    for (const c of items) {
      const name = c.submitted_by || c.username
      if (name) set.add(name)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [items])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return items.filter((c) => {
      const key = istDayKey(c.recorded_at || c.created_at)
      if (period === 'today' && key !== todayKey()) return false
      if (period === 'day' && key !== day) return false
      if (period === 'month' && !key.startsWith(month)) return false
      const who = c.submitted_by || c.username || ''
      if (surveyor && who !== surveyor) return false
      if (status !== 'all' && statusOf(c).group !== status) return false
      if (term) {
        const hay = [
          c.title,
          c.transcript,
          c.transcript_original,
          who,
          c.username,
          c.form_key,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
  }, [items, period, day, month, surveyor, status, search])

  const counts = useMemo(() => {
    const out = { total: items.length, ready: 0, processing: 0, error: 0 }
    for (const c of items) {
      const g = statusOf(c).group
      if (g === 'ready') out.ready += 1
      else if (g === 'error') out.error += 1
      else out.processing += 1
    }
    return out
  }, [items])

  async function toggle(item) {
    const open = expanded === item.id
    setExpanded(open ? null : item.id)
    if (open || audioUrls[item.id]) return
    setBusyId(item.id)
    try {
      const url = await fetchMediaBlobUrl(conversationAudioPath(item.id))
      if (url && mountedRef.current) {
        setAudioUrls((prev) => ({ ...prev, [item.id]: url }))
      }
    } catch {
      onToast?.('Could not load the conversation audio', 'error')
    } finally {
      if (mountedRef.current) setBusyId(null)
    }
  }

  async function downloadAudio(item) {
    setBusyId(item.id)
    try {
      await downloadMediaFile(
        conversationAudioPath(item.id),
        `conversation-${item.id}.webm`,
      )
    } catch (e) {
      onToast?.(e.message || 'Audio download failed', 'error')
    } finally {
      if (mountedRef.current) setBusyId(null)
    }
  }

  function exportCsv() {
    if (!filtered.length) {
      onToast?.('Nothing to export for these filters', 'error')
      return
    }
    setExporting(true)
    try {
      const csv = Papa.unparse(csvRows(filtered))
      const stamp = new Date().toISOString().slice(0, 10)
      // BOM keeps Telugu/English readable when opened in Excel.
      saveBlob(
        new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
        `voice-conversations-${stamp}.csv`,
      )
      onToast?.(`Exported ${filtered.length} conversation(s) to CSV`, 'ok')
    } catch (e) {
      onToast?.(e.message || 'Export failed', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h2>Client Admin · Voice conversations</h2>
        <p>
          Field-recorded conversations translated to English in batch (Soniox). New
          recordings sync automatically from phones; this list also refreshes every minute.
          Browse, listen, filter, and export transcripts.
        </p>
      </header>

      <div className="portal-kpi-grid" style={{ marginBottom: 12 }}>
        {[
          { label: 'Conversations', value: counts.total },
          { label: 'English ready', value: counts.ready },
          { label: 'Translating', value: counts.processing },
          { label: 'Failed', value: counts.error },
        ].map((k) => (
          <div className="portal-kpi" key={k.label}>
            <strong>{loading && !items.length ? '—' : k.value}</strong>
            <span>{k.label}</span>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h3>Filters &amp; export</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {[
            { id: 'total', label: 'All time' },
            { id: 'today', label: 'Today' },
            { id: 'day', label: 'Day' },
            { id: 'month', label: 'Month' },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip ${period === p.id ? 'selected' : ''}`}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
          {period === 'day' && (
            <input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              aria-label="Conversation day"
            />
          )}
          {period === 'month' && (
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              aria-label="Conversation month"
            />
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 8,
            marginBottom: 10,
          }}
        >
          <label className="field">
            <span>Surveyor</span>
            <select value={surveyor} onChange={(e) => setSurveyor(e.target.value)}>
              <option value="">All surveyors</option>
              {surveyors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Translation status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="ready">English ready</option>
              <option value="processing">Translating / waiting</option>
              <option value="error">Failed</option>
            </select>
          </label>
          <label className="field">
            <span>Search</span>
            <input
              type="search"
              placeholder="Title or transcript…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            className="btn small"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? 'Syncing…' : 'Sync now'}
          </button>
          <button
            type="button"
            className="btn small primary"
            disabled={exporting || !filtered.length}
            onClick={exportCsv}
          >
            {exporting ? 'Exporting…' : `Export CSV (${filtered.length})`}
          </button>
          {lastSynced ? (
            <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
              Last synced {formatWhen(lastSynced)}
            </span>
          ) : null}
          <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
            CSV includes English, original speech text, surveyor, duration, and audio link.
          </span>
        </div>
      </div>

      <div className="card">
        <h3>Conversations ({filtered.length})</h3>
        {loading && !items.length ? (
          <div className="portal-skeleton-rows" style={{ marginTop: 8 }}>
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="portal-skeleton-row"
                style={{ width: `${92 - i * 8}%` }}
              />
            ))}
          </div>
        ) : !filtered.length ? (
          <p className="muted">
            {items.length
              ? 'No conversations match these filters.'
              : 'No voice conversations have been uploaded yet.'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {filtered.map((c) => {
              const st = statusOf(c)
              const open = expanded === c.id
              const audioSrc = audioUrls[c.id] || ''
              return (
                <div
                  key={c.id}
                  style={{
                    padding: '10px 0',
                    borderBottom: '1px solid var(--border, #e2e8f0)',
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: 14 }}>
                        {c.title || 'Voice conversation'}
                      </strong>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {formatWhen(c.recorded_at || c.created_at)} ·{' '}
                        {c.submitted_by || c.username || 'Unknown surveyor'} ·{' '}
                        {formatDuration(c.duration_ms)}
                      </span>
                    </div>
                    <span className={`pill ${st.tone}`} style={{ margin: 0 }}>
                      {st.label}
                    </span>
                  </div>

                  <p
                    style={{
                      margin: '6px 0',
                      fontSize: 13,
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {c.transcript || transcriptHint(c)}
                  </p>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn small"
                      disabled={busyId === c.id}
                      onClick={() => void toggle(c)}
                    >
                      {open ? 'Hide' : busyId === c.id ? 'Loading…' : 'Open'}
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      disabled={busyId === c.id}
                      onClick={() => void downloadAudio(c)}
                    >
                      Download audio
                    </button>
                    {c.form_key ? (
                      <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
                        survey: {c.form_key}
                      </span>
                    ) : null}
                  </div>

                  {open && (
                    <div style={{ marginTop: 10 }}>
                      {audioSrc ? (
                        <audio
                          controls
                          preload="metadata"
                          src={audioSrc}
                          style={{ width: '100%' }}
                        />
                      ) : (
                        <p className="muted" style={{ fontSize: 12 }}>
                          {busyId === c.id ? 'Loading audio…' : 'Audio not available.'}
                        </p>
                      )}

                      <div
                        style={{
                          marginTop: 8,
                          padding: 10,
                          borderRadius: 8,
                          border: '1px solid #e2e8f0',
                          background: '#f8fafc',
                        }}
                      >
                        <span className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
                          ENGLISH TRANSLATION
                        </span>
                        <p
                          style={{
                            margin: '4px 0 0',
                            fontSize: 13,
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {c.transcript || transcriptHint(c)}
                        </p>
                      </div>

                      {c.transcript_original ? (
                        <details style={{ marginTop: 8 }}>
                          <summary
                            className="muted"
                            style={{ fontSize: 12, cursor: 'pointer' }}
                          >
                            Original speech text (Telugu)
                          </summary>
                          <p
                            style={{
                              margin: '6px 0 0',
                              fontSize: 13,
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {c.transcript_original}
                          </p>
                        </details>
                      ) : null}

                      {c.transcript_status === 'error' && c.transcript_error ? (
                        <p className="pill bad" style={{ marginTop: 8 }}>
                          <span className="dot" />
                          {c.transcript_error}
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
