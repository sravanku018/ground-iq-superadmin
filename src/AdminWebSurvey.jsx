import { useCallback, useEffect, useState } from 'react'
import Icon from './Icons'
import { createWebSurvey, getSurvey, listSurveys, listWebSurveyStats } from './api'
import CopyWebFillLink from './components/CopyWebFillLink'
import { slugQuestionKey } from './questionKey'

function qid(q) {
  return String(q?.id || slugQuestionKey(q?.label) || '').trim()
}

function isMeter(q) {
  return (q?.type || '') === 'meter'
}

function meterNum(val) {
  const n = Number(String(val ?? '').replace(/%/g, ''))
  return n >= 1 && n <= 100 ? n : 50
}

function meterStored(val) {
  return `${meterNum(val)}%`
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

function emptyAnswers(qs) {
  const init = {}
  for (const q of qs) {
    const id = qid(q)
    if (!id) continue
    init[id] = isMeter(q) ? '50%' : ''
  }
  return init
}

export default function AdminWebSurveyScreen({ onToast, user }) {
  const canFillHere = user?.role === 'super_admin' || !!user?.can_web_survey
  const [surveys, setSurveys] = useState([])
  const [surveyId, setSurveyId] = useState('')
  const [title, setTitle] = useState('')
  const [formKey, setFormKey] = useState('')
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [loading, setLoading] = useState(true)
  const [mockDone, setMockDone] = useState(false)
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
    setMockDone(false)
    if (!surveyId) {
      setQuestions([])
      setTitle('')
      setFormKey('')
      return undefined
    }
    let dead = false
    getSurvey(surveyId)
      .then((d) => {
        if (dead) return
        setTitle(d.survey?.title || '')
        setFormKey(d.survey?.form_key || '')
        const qs = Array.isArray(d.survey?.questions) ? d.survey.questions : []
        setQuestions(qs)
        setAnswers(emptyAnswers(qs))
      })
      .catch((e) => onToast?.(e.message, 'error'))
    return () => {
      dead = true
    }
  }, [surveyId, onToast])

  function setAns(id, val) {
    setAnswers((a) => ({ ...a, [id]: val }))
  }

  function submit(e) {
    e.preventDefault()
    if (!formKey) {
      onToast?.('Pick a survey', 'error')
      return
    }
    for (const q of questions) {
      const val = answers[qid(q)]
      const hasVal = Array.isArray(val) ? val.length > 0 : String(val || '').trim() !== ''
      if (!hasVal) {
        const qTitle = q.label || q.label_te || `Question ${questions.indexOf(q) + 1}`
        onToast?.(`Question missed: ${qTitle} — please answer before submitting.`, 'error')
        if (typeof document !== 'undefined') {
          try {
            document
              .getElementById(`admin-web-q-${qid(q)}`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          } catch {
            /* ignore */
          }
        }
        return
      }
    }
    setMockDone(true)
    onToast?.(`Mock preview submitted successfully for "${title || 'Survey'}"`, 'ok')
  }

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
          <CopyWebFillLink formKey={formKey} title={title} onToast={onToast} />
        </div>
      ) : null}

      {title ? <h3 style={{ margin: '0 0 12px' }}>{title}</h3> : null}

      {mockDone ? (
        <div className="card" style={{ textAlign: 'center', padding: '36px 20px', background: 'rgba(5, 150, 105, 0.08)', border: '1.5px solid #059669', borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 44, marginBottom: 10 }}>🎉</div>
          <h3 style={{ margin: '0 0 8px', color: '#059669', fontSize: 22 }}>
            Thank you for participating in {title || 'the survey'}!
          </h3>
          <p className="muted" style={{ margin: '0 0 20px', fontSize: 14 }}>
            Your feedback was recorded in this interactive preview. Respondents who use your copied link will experience this exact confirmation.
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setMockDone(false)
              setAnswers(emptyAnswers(questions))
            }}
          >
            ↺ Test Again / Reset Preview
          </button>
        </div>
      ) : questions.length === 0 && !loading ? (
        <p className="muted">This survey has no questions yet.</p>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="smartphone" size={16} /> Live Questionnaire Preview (Mock Mode)
              </h3>
              <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>
                Preview how respondents experience your survey. Submitting here is in safe mock mode (does not save to database).
              </p>
            </div>
            <span className="pill ok" style={{ fontSize: 11, fontWeight: 'bold' }}>
              Preview Mode
            </span>
          </div>

          <form onSubmit={submit}>
            {questions.map((q, i) => {
              const id = qid(q)
              const type = q.type || 'text'
              const opts = Array.isArray(q.options) ? q.options : []
              const teOpts = Array.isArray(q.options_te) ? q.options_te : []
              const val = answers[id] ?? ''
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
                      {(() => {
                        const currentList = Array.isArray(val)
                          ? val
                          : typeof val === 'string' && val.trim() !== ''
                            ? val.split(',').map((s) => s.trim()).filter(Boolean)
                            : []
                        const multiOpts = opts.length > 0 ? opts : ['Option 1', 'Option 2', 'Option 3', 'Option 4']

                        const toggle = (opt) => {
                          let next
                          if (currentList.includes(opt)) {
                            next = currentList.filter((o) => o !== opt)
                          } else {
                            if (max > 0 && currentList.length >= max) {
                              next = [...currentList.slice(currentList.length - (max - 1)), opt]
                            } else {
                              next = [...currentList, opt]
                            }
                          }
                          setAns(id, next)
                        }

                        return (
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: '#059669' }}>
                                ☑️ Select up to {max} answers:
                              </span>
                              <span className="pill ok" style={{ fontSize: 11, padding: '2px 8px' }}>
                                {currentList.length} / {max} selected
                              </span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              {multiOpts.map((opt, oi) => {
                                const sel = currentList.includes(opt)
                                return (
                                  <button
                                    key={`${opt}-${oi}`}
                                    type="button"
                                    className={`chip ${sel ? 'selected' : ''}`}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      fontWeight: 'bold',
                                      padding: '6px 14px',
                                      borderRadius: 16,
                                    }}
                                    onClick={() => toggle(opt)}
                                  >
                                    <span>{sel ? '☑' : '☐'}</span>
                                    <span>{opt}</span>
                                    {teOpts[oi] ? (
                                      <span className="muted" style={{ marginLeft: 4, fontWeight: 500 }}>
                                        {teOpts[oi]}
                                      </span>
                                    ) : null}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  ) : type === 'meter' ? (
                    <div className="qa-meter" style={{ marginTop: 8 }}>
                      <div className="qa-meter-track">
                        <input
                          type="range"
                          min="1"
                          max="100"
                          value={meterNum(val)}
                          onChange={(e) => setAns(id, meterStored(e.target.value))}
                          aria-label={q.label || 'Meter 1-100'}
                        />
                      </div>
                      <div className="qa-meter-scale">
                        <span>{opts[0] || 'Negative'}</span>
                        <span>{opts[1] || 'Neutral'}</span>
                        <span>{opts[2] || 'Positive'}</span>
                      </div>
                      <div className="qa-meter-value">
                        <strong>{val || `${meterNum(val)}%`}</strong>
                        <span
                          className="pill"
                          style={{
                            background:
                              meterNum(val) <= 33
                                ? 'rgba(239, 68, 68, 0.12)'
                                : meterNum(val) <= 66
                                ? 'rgba(234, 179, 8, 0.12)'
                                : 'rgba(34, 197, 94, 0.12)',
                            color:
                              meterNum(val) <= 33
                                ? '#dc2626'
                                : meterNum(val) <= 66
                                ? '#ca8a04'
                                : '#16a34a',
                            fontWeight: 700,
                            fontSize: 12,
                            padding: '4px 10px',
                          }}
                        >
                          {meterNum(val) <= 33
                            ? opts[0] || 'Negative'
                            : meterNum(val) <= 66
                            ? opts[1] || 'Neutral'
                            : opts[2] || 'Positive'}
                        </span>
                      </div>
                    </div>
                  ) : opts.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {opts.map((opt, oi) => (
                        <button
                          key={`${opt}-${oi}`}
                          type="button"
                          className={`chip ${val === opt ? 'selected' : ''}`}
                          onClick={() => setAns(id, val === opt ? '' : opt)}
                        >
                          {opt}
                          {teOpts[oi] ? (
                            <span className="muted" style={{ marginLeft: 6, fontWeight: 500 }}>
                              {teOpts[oi]}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input
                      value={val}
                      onChange={(e) => setAns(id, e.target.value)}
                      placeholder="Type answer…"
                    />
                  )}
                </div>
              )
            })}
            <button type="submit" className="btn primary" disabled={!questions.length} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="check" size={13} /> Test Submit (Mock Preview)
            </button>
          </form>
        </div>
      )}
      </>
      )}
    </div>
  )
}
