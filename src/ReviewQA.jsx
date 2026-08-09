import { useCallback, useEffect, useRef, useState } from 'react'
import {
  confirmAllPending,
  downloadMediaFile,
  fetchMediaBlobUrl,
  listSubmissionMedia,
  listSubmissions,
  listSurveys,
  retryFact,
  setSubmissionStatus,
} from './api'
import { PortalEmpty, PortalError, PortalSkeleton } from './PortalUI'
import SubmissionEditor from './SubmissionEditor'

/**
 * Q/A review → confirm / reject.
 * Keyboard: j/k move · Enter expand · c confirm · r reject · e edit
 */
export default function ReviewQAScreen({ onToast }) {
  const [status, setStatus] = useState('pending')
  const [survey, setSurvey] = useState('')
  const [surveys, setSurveys] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [mediaById, setMediaById] = useState({})
  const [focusIdx, setFocusIdx] = useState(0)
  const listRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listSubmissions(200, status === 'all' ? '' : status, { survey })
      const next = data.items || []
      setItems(next)
      setFocusIdx((i) => (next.length ? Math.min(i, next.length - 1) : 0))
    } catch (e) {
      setError(e.message || 'Failed to load')
      onToast?.(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [status, survey, onToast])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    listSurveys()
      .then((d) => setSurveys(d.items || []))
      .catch(() => {})
  }, [])

  // Prefetch media when expanded
  useEffect(() => {
    if (!expanded) return
    let cancelled = false
    const blobUrls = []
    ;(async () => {
      try {
        const d = await listSubmissionMedia(expanded)
        const list = d.media || []
        const resolved = []
        for (const m of list) {
          let playUrl = m.url || ''
          try {
            if (
              playUrl &&
              (playUrl.startsWith('/api/media/') || playUrl.includes('/api/media/'))
            ) {
              playUrl = await fetchMediaBlobUrl(playUrl)
              blobUrls.push(playUrl)
            }
          } catch {
            /* keep original */
          }
          resolved.push({ ...m, playUrl: playUrl || m.url })
        }
        if (!cancelled) setMediaById((prev) => ({ ...prev, [expanded]: resolved }))
      } catch {
        if (!cancelled) setMediaById((prev) => ({ ...prev, [expanded]: [] }))
      }
    })()
    return () => {
      cancelled = true
      blobUrls.forEach((u) => {
        try {
          URL.revokeObjectURL(u)
        } catch {
          /* ignore */
        }
      })
    }
  }, [expanded])

  const setStatusFor = useCallback(
    async (id, next) => {
      setBusyId(id)
      try {
        await setSubmissionStatus(id, next)
        onToast?.(
          next === 'confirmed' ? 'Confirmed ✓ — included in analytics' : `Marked ${next}`,
          'ok',
        )
        await load()
      } catch (e) {
        onToast?.(e.message, 'error')
      } finally {
        setBusyId(null)
      }
    },
    [load, onToast],
  )

  const retryFactFor = useCallback(
    async (id) => {
      setBusyId(id)
      try {
        const res = await retryFact(id)
        onToast?.(
          res?.already_existed
            ? 'Fact already materialized ✓'
            : 'Fact re-materialized ✓ — now eligible for dashboards',
          'ok',
        )
        await load()
      } catch (e) {
        onToast?.(e.message || 'Fact retry failed', 'error')
      } finally {
        setBusyId(null)
      }
    },
    [load, onToast],
  )

  async function bulkConfirm() {
    if (
      !confirm(
        'Confirm ALL pending surveys in the last batch? They will enter the analytics report.',
      )
    ) {
      return
    }
    setLoading(true)
    try {
      const res = await confirmAllPending(500, 'bulk from Review')
      onToast?.(`Confirmed ${res.confirmed || 0} surveys`, 'ok')
      setStatus('confirmed')
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Keyboard shortcuts when not typing in inputs
  useEffect(() => {
    function onKey(e) {
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) {
        return
      }
      if (!items.length) return
      const item = items[focusIdx]
      if (!item) return

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusIdx((i) => Math.min(items.length - 1, i + 1))
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusIdx((i) => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        setExpanded((ex) => (ex === item.id ? null : item.id))
        setEditingId(null)
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        if (item.status !== 'confirmed' && busyId !== item.id) {
          void setStatusFor(item.id, 'confirmed')
        }
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        if (item.status !== 'rejected' && busyId !== item.id) {
          void setStatusFor(item.id, 'rejected')
        }
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault()
        setExpanded(item.id)
        setEditingId((id) => (id === item.id ? null : item.id))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, focusIdx, busyId, setStatusFor])

  // Scroll focused row into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-review-idx="${focusIdx}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusIdx])

  return (
    <div className="screen">
      <header className="screen-head">
        <h2>Client Admin · Review</h2>
        <p>Review · media · confirm → report analytics</p>
      </header>

      <p className="review-kb-hint">
        Keys: <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>Enter</kbd> expand · <kbd>c</kbd> confirm ·{' '}
        <kbd>r</kbd> reject · <kbd>e</kbd> edit
      </p>

      <div className="card" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
          Pipeline: <strong>Users</strong> → collect → <strong>Review</strong> →{' '}
          <strong>Confirm</strong> → <strong>Report</strong>
        </p>
        <div className="chip-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {['pending', 'confirmed', 'rejected', 'all'].map((s) => (
            <button
              key={s}
              type="button"
              className={`chip ${status === s ? 'selected' : ''}`}
              onClick={() => setStatus(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <label className="field compact" style={{ marginTop: 10 }}>
          <span>By survey</span>
          <select value={survey} onChange={(e) => setSurvey(e.target.value)}>
            <option value="">All surveys</option>
            {surveys.map((s) => (
              <option key={s.id} value={s.form_key}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        {status === 'pending' && (
          <button
            type="button"
            className="btn primary"
            style={{ marginTop: 12, width: '100%' }}
            onClick={bulkConfirm}
            disabled={loading}
          >
            Confirm all pending (batch)
          </button>
        )}
      </div>

      {loading ? (
        <PortalSkeleton rows={6} label="Loading review queue…" />
      ) : error ? (
        <PortalError title="Could not load reviews" message={error} onRetry={load} />
      ) : !items.length ? (
        <PortalEmpty title={`No ${status === 'all' ? '' : status + ' '}surveys`}>
          {status === 'pending'
            ? 'New submits appear here until confirmed. Pull data from the field app first.'
            : 'Try another status filter or survey.'}
        </PortalEmpty>
      ) : (
        <ul className="user-list review-list" ref={listRef}>
          {items.map((item, idx) => {
            const a = item.answers || {}
            const open = expanded === item.id
            const focused = focusIdx === idx
            const qa = item.qa?.length
              ? item.qa
              : Object.entries(a)
                  .filter(([, v]) => v != null && v !== '')
                  .slice(0, 12)
                  .map(([k, v]) => ({
                    q: k,
                    a: Array.isArray(v) ? v.join(', ') : String(v),
                  }))
            const photo =
              (mediaById[item.id] || []).find((m) => m.kind === 'photo') || null
            const audio =
              (mediaById[item.id] || []).find((m) => m.kind === 'audio') || null
            const photoSrc = photo?.playUrl || photo?.url || item.photo_url
            const audioSrc = audio?.playUrl || audio?.url || item.audio_url

            return (
              <li
                key={item.id}
                data-review-idx={idx}
                className={`review-item card${focused ? ' is-focus' : ''}`}
                style={{ marginBottom: 10 }}
                onClick={() => setFocusIdx(idx)}
              >
                <button
                  type="button"
                  className="review-head"
                  onClick={() => {
                    setFocusIdx(idx)
                    setExpanded(open ? null : item.id)
                    setEditingId(null)
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: 'none',
                    border: 0,
                    color: 'inherit',
                    padding: 0,
                    cursor: 'pointer',
                  }}
                >
                  <strong>
                    #{item.id} · {a.respondent_name || a.district || 'Survey'}
                  </strong>
                  <span className="meta">
                    {' '}
                    · {item.status || 'pending'}
                    {item.legacy ? ' · legacy (no GPS/camera)' : ''}
                    {item.submitted_by ? ` · ${item.submitted_by}` : ''}
                    {a.district ? ` · ${a.district}` : ''}
                    {item.has_photo || photoSrc ? ' · 📷' : ''}
                    {item.has_voice || audioSrc ? ' · 🎤' : ''}
                    {item.status === 'confirmed' && item.fact_status === 'failed'
                      ? ' · ⚠ fact failed'
                      : ''}
                  </span>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {open ? 'Hide Q/A ▲' : 'Show Q/A + media ▼'}
                  </div>
                </button>

                {/* Always-visible mini media strip when open */}
                {open && editingId !== item.id && (
                  <div className="qa-block" style={{ marginTop: 10 }}>
                    <div className="card" style={{ marginBottom: 10, padding: 10 }}>
                      <strong style={{ fontSize: 13 }}>Media</strong>
                      <div
                        style={{
                          marginTop: 8,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        {photoSrc ? (
                          <div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                              }}
                            >
                              <span className="muted" style={{ fontSize: 12 }}>
                                Photo
                                {photo?.storage ? ` · ${photo.storage}` : ''}
                              </span>
                              <button
                                type="button"
                                className="btn small"
                                style={{ fontSize: 11, padding: '2px 8px' }}
                                onClick={() =>
                                  downloadMediaFile(
                                    photo?.url || item.photo_url || photoSrc,
                                    `photo-${item.id}.jpg`,
                                  )
                                }
                              >
                                ⬇ Download
                              </button>
                            </div>
                            <img
                              src={photoSrc}
                              alt="survey photo"
                              style={{
                                display: 'block',
                                maxWidth: '100%',
                                maxHeight: 280,
                                objectFit: 'contain',
                                marginTop: 6,
                                borderRadius: 8,
                                background: '#0a0f14',
                              }}
                            />
                          </div>
                        ) : null}
                        {audioSrc ? (
                          <div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: 4,
                              }}
                            >
                              <span className="muted" style={{ fontSize: 12 }}>
                                Audio
                                {audio?.storage ? ` · ${audio.storage}` : ''}
                              </span>
                              <button
                                type="button"
                                className="btn small primary"
                                style={{ fontSize: 11, padding: '2px 8px' }}
                                onClick={() =>
                                  downloadMediaFile(
                                    audio?.url || item.audio_url || audioSrc,
                                    `audio-${item.id}.webm`,
                                  )
                                }
                              >
                                ⬇ Download
                              </button>
                            </div>
                            <audio controls src={audioSrc} style={{ width: '100%' }} />
                          </div>
                        ) : null}
                        {!photoSrc && !audioSrc && (
                          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                            {mediaById[item.id]
                              ? 'No photo/audio on this record.'
                              : 'Loading media…'}
                          </p>
                        )}
                      </div>
                    </div>
                    {qa.map((row) => (
                      <div key={row.q} className="kv" style={{ marginBottom: 6 }}>
                        <span className="muted">{row.q}</span>
                        <strong style={{ display: 'block' }}>{row.a}</strong>
                      </div>
                    ))}
                  </div>
                )}

                {editingId === item.id && (
                  <SubmissionEditor
                    item={item}
                    onToast={onToast}
                    onCancel={() => setEditingId(null)}
                    onSaved={async () => {
                      setEditingId(null)
                      await load()
                    }}
                    onDeleted={async () => {
                      setEditingId(null)
                      await load()
                    }}
                  />
                )}

                <div className="review-actions-bar user-actions">
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={busyId === item.id}
                    onClick={() => {
                      setFocusIdx(idx)
                      setExpanded(item.id)
                      setEditingId(editingId === item.id ? null : item.id)
                    }}
                  >
                    {editingId === item.id ? 'Close edit' : 'Edit (e)'}
                  </button>
                  {item.status !== 'confirmed' && (
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={busyId === item.id}
                      onClick={() => setStatusFor(item.id, 'confirmed')}
                    >
                      Confirm (c)
                    </button>
                  )}
                  {item.status === 'confirmed' && item.fact_status === 'failed' && (
                    <button
                      type="button"
                      className="btn small"
                      disabled={busyId === item.id}
                      title={item.fact_error || 'Fact materialization failed — retry to include on dashboards'}
                      onClick={() => retryFactFor(item.id)}
                    >
                      Retry fact (processing)
                    </button>
                  )}
                  {item.status !== 'rejected' && (
                    <button
                      type="button"
                      className="btn small danger"
                      disabled={busyId === item.id}
                      onClick={() => setStatusFor(item.id, 'rejected')}
                    >
                      Reject (r)
                    </button>
                  )}
                  {item.status !== 'pending' && (
                    <button
                      type="button"
                      className="btn small"
                      disabled={busyId === item.id}
                      onClick={() => setStatusFor(item.id, 'pending')}
                    >
                      Back to pending
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
