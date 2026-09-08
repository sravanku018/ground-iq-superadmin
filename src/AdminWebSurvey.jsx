import { useCallback, useEffect, useState } from 'react'
import Icon from './Icons'
import { getSurvey, listSurveys, listWebSurveyStats } from './api'
import CopyWebFillLink from './components/CopyWebFillLink'
import { slugQuestionKey } from './questionKey'

function qid(q) {
  return String(q?.id || slugQuestionKey(q?.label) || '').trim()
}

function formatIstStamp(v) {
  if (!v) return '—'
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d)
}

export default function AdminWebSurveyScreen({ onToast, user }) {
  const [surveys, setSurveys] = useState([])
  const [surveyId, setSurveyId] = useState('')
  const [title, setTitle] = useState('')
  const [formKey, setFormKey] = useState('')
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [linkStatus, setLinkStatus] = useState({ hasLink: false, expired: false, loading: true })
  const [tab, setTab] = useState('link')
  const [stats, setStats] = useState([])
  const [statsLoading, setStatsLoading] = useState(false)

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const d = await listSurveys()
      const items = (d.items || []).filter(
        (s) => s.form_key !== 'default' && s.form_key !== 'legacy',
      )
      setSurveys(items)
      setSurveyId((cur) => cur || (items[0] ? String(items[0].id) : ''))
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [onToast])

  useEffect(() => {
    void loadList()
  }, [loadList])

  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const d = await listWebSurveyStats()
      setStats(d.items || [])
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setStatsLoading(false)
    }
  }, [onToast])

  useEffect(() => {
    if (tab === 'submitted') void loadStats()
  }, [tab, loadStats])

  useEffect(() => {
    if (!surveyId) {
      setQuestions([])
      setTitle('')
      setFormKey('')
      setLinkStatus({ hasLink: false, expired: false, loading: false })
      return undefined
    }
    const found = surveys.find((s) => String(s.id) === String(surveyId))
    if (found) {
      setTitle(found.title || found.form_key || '')
      setFormKey(found.form_key || '')
    } else {
      setFormKey('')
      setTitle('')
    }
    setLinkStatus({ hasLink: false, expired: false, loading: true })
    let dead = false
    getSurvey(surveyId)
      .then((d) => {
        if (dead) return
        setTitle(d.survey?.title || found?.title || '')
        setFormKey(d.survey?.form_key || found?.form_key || '')
        const qs = Array.isArray(d.survey?.questions) ? d.survey.questions : []
        setQuestions(qs)
      })
      .catch((e) => onToast?.(e.message, 'error'))
    return () => {
      dead = true
    }
  }, [surveyId, surveys, onToast])

  return (
    <div>
      <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="clipboard" size={18} /> Web survey
      </h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Copy a web link, or see how many web fills each survey has received.
      </p>

      <div className="chip-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {[
          { id: 'link', label: 'Link' },
          { id: 'submitted', label: 'Submitted' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            className={`chip ${tab === t.id ? 'selected' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'submitted' ? (
        <div>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            How many web surveys were submitted for each questionnaire.
          </p>
          {statsLoading ? (
            <p className="muted">Loading…</p>
          ) : stats.length === 0 ? (
            <p className="muted">No surveys yet.</p>
          ) : (
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="mini-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Survey</th>
                    <th>Submitted</th>
                    <th>This link</th>
                    <th>Created</th>
                    <th>Ended</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s) => {
                    const hasLink = Boolean(s.has_link || (s.cap != null && s.created_at))
                    const subCount = Number(s.submitted ?? s.used) || 0
                    const linkUsed = Number(s.link_used) || 0
                    const cap = Number(s.cap) || 0
                    const isExpired = Boolean(s.expired || (cap > 0 && linkUsed >= cap))
                    return (
                      <tr key={s.form_key}>
                        <td>
                          <strong>{s.title || s.form_key}</strong>
                        </td>
                        <td>
                          <strong style={{ color: subCount > 0 ? '#059669' : '#64748b' }}>
                            {subCount}
                          </strong>
                          <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                            web fills
                          </span>
                        </td>
                        <td>
                          {hasLink ? (
                            <strong style={{ color: isExpired ? '#dc2626' : '#0f172a' }}>
                              {linkUsed} / {cap}
                            </strong>
                          ) : (
                            <span className="muted" style={{ fontSize: 12 }}>
                              No link yet
                            </span>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                          {formatIstStamp(s.created_at)}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                          {!hasLink ? (
                            <span className="muted">—</span>
                          ) : s.ended_at ? (
                            formatIstStamp(s.ended_at)
                          ) : isExpired ? (
                            <span style={{ color: '#dc2626', fontWeight: 600 }}>Target reached</span>
                          ) : (
                            <span style={{ color: '#059669', fontWeight: 600 }}>Active</span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn small"
                            onClick={() => {
                              setSurveyId(String(s.id))
                              setTab('link')
                            }}
                          >
                            {hasLink ? 'View link' : 'Create link'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
      <>
      <label className="field" style={{ maxWidth: 420, marginBottom: 16 }}>
        <span>Survey</span>
        <select
          value={surveyId}
          onChange={(e) => setSurveyId(e.target.value)}
          disabled={loading}
        >
          {surveys.length === 0 ? <option value="">No surveys</option> : null}
          {surveys.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title || s.form_key}
            </option>
          ))}
        </select>
      </label>

      {formKey ? (
        <div className="card" style={{ marginBottom: 16, padding: 14 }}>
          <CopyWebFillLink
            key={formKey}
            formKey={formKey}
            title={title}
            onToast={onToast}
            onStatusChange={(st) => setLinkStatus({ ...st, loading: false })}
          />
        </div>
      ) : null}

      {title ? <h3 style={{ margin: '0 0 12px' }}>{title}</h3> : null}

      {linkStatus.loading ? (
        <p className="muted" style={{ fontSize: 13 }}>Checking survey link status…</p>
      ) : !linkStatus.hasLink ? (
        <div className="card" style={{ textAlign: 'center', padding: '32px 20px', background: '#f8fafc', border: '1.5px dashed #cbd5e1', borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🔗</div>
          <h3 style={{ margin: '0 0 6px', fontSize: 16, color: '#334155' }}>
            No Web Survey Link Created Yet
          </h3>
          <p className="muted" style={{ margin: '0 auto', maxWidth: 460, fontSize: 13 }}>
            This survey is not yet accepting web responses. To enable web surveys and activate the live preview, pick responses allowed above and click <strong>Create &amp; copy link</strong>.
          </p>
        </div>
      ) : linkStatus.expired ? (
        <div className="card" style={{ textAlign: 'center', padding: '32px 20px', background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🛑</div>
          <h3 style={{ margin: '0 0 6px', fontSize: 16, color: '#b91c1c' }}>
            Web Survey Target Reached ({linkStatus.totalUsed || 0} / {linkStatus.cap || 0})
          </h3>
          <p className="muted" style={{ margin: 0, fontSize: 13, color: '#991b1b' }}>
            This survey has reached its maximum allocated web responses limit. Sharing is disabled and this survey is no longer accepting web fills.
          </p>
        </div>
      ) : questions.length === 0 && !loading ? (
        <p className="muted">This survey has no questions yet.</p>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="smartphone" size={16} /> Questionnaire Preview (Read-Only)
              </h3>
              <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>
                This is a preview of what respondents see. Web surveys can only be submitted by respondents via the public survey link.
              </p>
            </div>
            <span className="pill" style={{ fontSize: 11, fontWeight: 'bold', background: '#f1f5f9', color: '#475569' }}>
              Read-Only
            </span>
          </div>

          <div>
            {questions.map((q, i) => {
              const id = qid(q)
              const type = q.type || 'text'
              const opts = Array.isArray(q.options) ? q.options : []
              const teOpts = Array.isArray(q.options_te) ? q.options_te : []
              const max = Math.max(1, Number(q.max_choices) || 2)

              return (
                <div key={id || i} id={`admin-web-q-${id}`} className="card" style={{ marginBottom: 12 }}>
                  <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 14 }}>
                    Q{i + 1}. {q.label || 'Question'}
                    {q.required ? ' *' : ''}
                  </p>
                  {q.label_te ? (
                    <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
                      {q.label_te}
                    </p>
                  ) : (
                    <div style={{ height: 6 }} />
                  )}

                  {(type === 'multi_select' || type === 'multi') ? (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#059669' }}>
                          ☑️ Multiple Select (Up to {max} answers allowed)
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {(opts.length > 0 ? opts : ['Option 1', 'Option 2', 'Option 3', 'Option 4']).map((opt, oi) => (
                          <div
                            key={`${opt}-${oi}`}
                            className="chip"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              fontWeight: 'bold',
                              padding: '6px 14px',
                              borderRadius: 16,
                              opacity: 0.85,
                              cursor: 'default',
                            }}
                          >
                            <span>☐</span>
                            <span>{opt}</span>
                            {teOpts[oi] ? (
                              <span className="muted" style={{ marginLeft: 4, fontWeight: 500 }}>
                                {teOpts[oi]}
                              </span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : type === 'meter' ? (
                    <div className="qa-meter" style={{ marginTop: 8 }}>
                      <div className="qa-meter-track">
                        <input
                          type="range"
                          min="1"
                          max="100"
                          value={50}
                          disabled
                          aria-label={q.label || 'Meter 1-100'}
                          style={{ cursor: 'default' }}
                        />
                      </div>
                      <div className="qa-meter-scale">
                        <span>{opts[0] || 'Negative'}</span>
                        <span>{opts[1] || 'Neutral'}</span>
                        <span>{opts[2] || 'Positive'}</span>
                      </div>
                    </div>
                  ) : opts.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {opts.map((opt, oi) => (
                        <div
                          key={`${opt}-${oi}`}
                          className="chip"
                          style={{ opacity: 0.85, cursor: 'default' }}
                        >
                          {opt}
                          {teOpts[oi] ? (
                            <span className="muted" style={{ marginLeft: 6, fontWeight: 500 }}>
                              {teOpts[oi]}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <input
                      disabled
                      placeholder="Respondent text answer…"
                      style={{ background: '#f8fafc', cursor: 'default' }}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  )
}
