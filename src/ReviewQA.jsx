import { useCallback, useEffect, useState } from 'react'
import {
  confirmAllPending,
  fetchMediaBlobUrl,
  listSubmissionMedia,
  listSubmissions,
  listSurveys,
  setSubmissionStatus,
} from './api'
import SubmissionEditor from './SubmissionEditor'

/**
 * Q/A review → confirm done or not.
 * Only confirmed surveys feed the analytics report.
 * Client Admin can edit / delete any record.
 */
export default function ReviewQAScreen({ onToast }) {
  const [status, setStatus] = useState('pending')
  const [survey, setSurvey] = useState('')
  const [surveys, setSurveys] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [mediaById, setMediaById] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listSubmissions(200, status === 'all' ? '' : status, { survey })
      setItems(data.items || [])
    } catch (e) {
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

  // Load free Neon/external media when a row is opened (no card services)
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
            if (playUrl && (playUrl.startsWith('/api/media/') || playUrl.includes('/api/media/'))) {
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

  async function setStatusFor(id, next) {
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
  }

  async function bulkConfirm() {
    if (!confirm('Confirm ALL pending surveys in the last batch? They will enter the analytics report.')) {
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

  return (
    <div className="screen">
      <header className="screen-head">
        <h2>Client Admin · Review</h2>
        <p>Review · edit answers · confirm → report analytics</p>
      </header>

      <div className="card" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
          Pipeline: <strong>Users</strong> → collect survey → <strong>Review</strong> →{' '}
          <strong>Confirm</strong> → <strong>Dashboard analytics</strong>
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
        <p className="muted">Loading…</p>
      ) : !items.length ? (
        <div className="card">
          <p className="muted">
            No {status === 'all' ? '' : status} surveys.
            {status === 'pending' && ' New submits appear here until confirmed.'}
          </p>
        </div>
      ) : (
        <ul className="user-list review-list">
          {items.map((item) => {
            const a = item.answers || {}
            const open = expanded === item.id
            const qa = item.qa?.length
              ? item.qa
              : Object.entries(a)
                  .filter(([, v]) => v != null && v !== '')
                  .slice(0, 12)
                  .map(([k, v]) => ({
                    q: k,
                    a: Array.isArray(v) ? v.join(', ') : String(v),
                  }))
            return (
              <li key={item.id} className="review-item card" style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  className="review-head"
                  onClick={() => setExpanded(open ? null : item.id)}
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
                    {item.submitted_by ? ` · ${item.submitted_by}` : ''}
                    {a.district ? ` · ${a.district}` : ''}
                  </span>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {open ? 'Hide Q/A ▲' : 'Show Q/A ▼'}
                  </div>
                </button>

                {open && editingId !== item.id && (
                  <div className="qa-block" style={{ marginTop: 10 }}>
                    {(item.photo_url ||
                      item.audio_url ||
                      (mediaById[item.id] || []).length > 0) && (
                      <div className="card" style={{ marginBottom: 10, padding: 10 }}>
                        <strong style={{ fontSize: 13 }}>
                          Media (free · Neon · no card)
                        </strong>
                        <div
                          style={{
                            marginTop: 8,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                          }}
                        >
                          {(() => {
                            const photo =
                              (mediaById[item.id] || []).find((m) => m.kind === 'photo') ||
                              null
                            const src = photo?.playUrl || photo?.url || item.photo_url
                            if (!src) return null
                            const isHttp = /^https?:\/\//i.test(src)
                            return (
                              <div>
                                <span className="muted" style={{ fontSize: 12 }}>
                                  Photo
                                  {photo?.storage ? ` · ${photo.storage}` : ''}
                                </span>
                                {isHttp && !src.includes('/api/media/') ? (
                                  <a href={src} target="_blank" rel="noreferrer">
                                    {' '}
                                    Open
                                  </a>
                                ) : null}
                                <img
                                  src={src}
                                  alt="survey photo"
                                  style={{
                                    display: 'block',
                                    maxWidth: '100%',
                                    marginTop: 6,
                                    borderRadius: 8,
                                  }}
                                />
                              </div>
                            )
                          })()}
                          {(() => {
                            const audio =
                              (mediaById[item.id] || []).find((m) => m.kind === 'audio') ||
                              null
                            const src = audio?.playUrl || audio?.url || item.audio_url
                            if (!src) return null
                            return (
                              <div>
                                <span className="muted" style={{ fontSize: 12 }}>
                                  Audio
                                  {audio?.storage ? ` · ${audio.storage}` : ''}
                                </span>
                                <audio
                                  controls
                                  src={src}
                                  style={{ width: '100%', marginTop: 6 }}
                                />
                              </div>
                            )
                          })()}
                          {!item.photo_url &&
                            !item.audio_url &&
                            !(mediaById[item.id] || []).length && (
                              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                                Loading media or none synced yet…
                              </p>
                            )}
                        </div>
                      </div>
                    )}
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

                <div className="user-actions" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={busyId === item.id}
                    onClick={() => {
                      setExpanded(item.id)
                      setEditingId(editingId === item.id ? null : item.id)
                    }}
                  >
                    {editingId === item.id ? 'Close edit' : 'Edit data'}
                  </button>
                  {item.status !== 'confirmed' && (
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={busyId === item.id}
                      onClick={() => setStatusFor(item.id, 'confirmed')}
                    >
                      Confirm done
                    </button>
                  )}
                  {item.status !== 'rejected' && (
                    <button
                      type="button"
                      className="btn small danger"
                      disabled={busyId === item.id}
                      onClick={() => setStatusFor(item.id, 'rejected')}
                    >
                      Reject
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
