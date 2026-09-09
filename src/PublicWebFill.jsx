import { useEffect, useState } from 'react'
import { getPublicWebSurvey, submitPublicWebSurvey } from './api'
import { slugQuestionKey } from './questionKey'
import './App.css'
import './portal.css'

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

function emptyAnswers(qs) {
  const init = {}
  for (const q of qs) {
    const id = qid(q)
    if (!id) continue
    init[id] = isMeter(q) ? '50%' : ''
  }
  return init
}

export default function PublicWebFill({ formKey, fillToken }) {
  const [title, setTitle] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [displayLang, setDisplayLang] = useState('en')
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [expired, setExpired] = useState(false)
  const [closed, setClosed] = useState(false)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => {
    let dead = false
    setLoading(true)
    setErr('')
    setExpired(false)
    setClosed(false)
    getPublicWebSurvey(formKey, fillToken)
      .then((d) => {
        if (dead) return
        setTitle(d.title || 'Survey')
        setCompanyName(d.company_name || '')
        setDisplayLang(d.display_lang === 'te' ? 'te' : 'en')
        const qs = Array.isArray(d.questions) ? d.questions : []
        setQuestions(qs)
        setAnswers(emptyAnswers(qs))
      })
      .catch((e) => {
        if (dead) return
        if (e.status === 410 || e.data?.expired) {
          setExpired(true)
          setErr('')
          if (e.data?.title) setTitle(e.data.title)
        } else {
          setErr(e.message || 'Survey not found')
        }
      })
      .finally(() => {
        if (!dead) setLoading(false)
      })
    return () => {
      dead = true
    }
  }, [formKey, fillToken])

  function setAns(id, val) {
    setAnswers((a) => ({ ...a, [id]: val }))
  }

  async function submit(e) {
    e.preventDefault()
    for (const q of questions) {
      const val = answers[qid(q)]
      const hasVal = Array.isArray(val) ? val.length > 0 : String(val ?? '').trim() !== ''
      if (!hasVal) {
        const qTitle = te && q.label_te ? q.label_te : q.label || `Question ${questions.indexOf(q) + 1}`
        setToast(`Question missed: ${qTitle} — please answer before submitting.`)
        if (typeof document !== 'undefined') {
          try {
            document
              .getElementById(`web-q-${qid(q)}`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          } catch {
            /* ignore */
          }
        }
        return
      }
    }
    setSaving(true)
    setToast('')
    try {
      const res = await submitPublicWebSurvey({
        form_key: formKey,
        token: fillToken,
        submitted_by: name.trim() || 'Web',
        answers,
      })
      setDone(true)
      setExpired(false)
      setClosed(!!res.expired)
    } catch (e2) {
      if (e2.status === 410 || e2.data?.expired) {
        setExpired(true)
        setDone(false)
      } else {
        setToast(e2.message || 'Submit failed')
      }
    } finally {
      setSaving(false)
    }
  }

  const te = displayLang === 'te'
  const heading = title || 'Web survey'

  useEffect(() => {
    const prev = document.title
    document.title = heading
    return () => {
      document.title = prev
    }
  }, [heading])

  return (
    <div className="portal-shell" style={{ minHeight: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <p className="eyebrow">{companyName ? `${companyName} · Web Survey` : 'Public Web Survey'}</p>
        <h1 style={{ fontSize: 26, margin: '0 0 8px', lineHeight: 1.25, color: '#0f172a' }}>
          {heading}
        </h1>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          {expired
            ? 'This survey is closed.'
            : done
              ? 'Your response was saved.'
              : 'Fill and submit. No login required.'}
        </p>

        {toast ? (
          <div className="toast error" role="status" style={{ position: 'static', marginBottom: 12 }}>
            {toast}
          </div>
        ) : null}

        {loading ? <p className="muted">Loading…</p> : null}
        {err ? <p style={{ color: '#b91c1c' }}>{err}</p> : null}

        {done ? (
          <div className="card success-card" style={{ textAlign: 'center', padding: '36px 20px', background: 'rgba(5, 150, 105, 0.08)', border: '1.5px solid #059669', borderRadius: 12 }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>🎉</div>
            <h3 style={{ margin: '0 0 8px', color: '#059669', fontSize: 22 }}>
              {te ? `${heading} సర్వేలో పాల్గొన్నందుకు ధన్యవాదాలు!` : `Thank you for participating in ${heading}!`}
            </h3>
            <p className="success-sub" style={{ margin: 0, fontSize: 14 }}>
              {closed
                ? (te ? 'మీ సమాధానాలు భద్రపరచబడ్డాయి. ఈ లింక్ గడువు ముగిసింది.' : 'Thank you. Your answers were saved. This link has now reached its response quota.')
                : (te ? 'మీ సమాధానాలు విజయవంతంగా భద్రపరచబడ్డాయి.' : 'Thank you. Your answers were saved successfully.')}
            </p>
          </div>
        ) : null}

        {!done && expired ? (
          <div className="card">
            <h3 style={{ margin: '0 0 6px' }}>{heading}</h3>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              This survey has reached its target. Sharing is disabled and this link can no longer
              accept responses.
            </p>
          </div>
        ) : null}

        {!loading && !err && !done && !expired ? (
          <form onSubmit={submit}>
            <label className="field" style={{ marginBottom: 14 }}>
              <span>Your name (optional)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
            </label>
            {questions.map((q, i) => {
              const id = qid(q)
              const type = q.type || 'text'
              const opts = Array.isArray(q.options) ? q.options : []
              const teOpts = Array.isArray(q.options_te) ? q.options_te : []
              const val = answers[id] ?? ''
              const label = te && q.label_te ? q.label_te : q.label || 'Question'
              const max = Math.max(1, Number(q.max_choices) || 2)

              return (
                <div key={id || i} id={`web-q-${id}`} className="card" style={{ marginBottom: 12 }}>
                  <p style={{ margin: '0 0 10px', fontWeight: 700 }}>
                    Q{i + 1}. {label}
                    {q.required ? ' *' : ''}
                  </p>

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
                                {te ? `☑️ గరిష్టంగా ${max} ఎంపికలను ఎంచుకోండి:` : `☑️ Select up to ${max} answers:`}
                              </span>
                              <span className="pill ok" style={{ fontSize: 11, padding: '2px 8px' }}>
                                {currentList.length} / {max} {te ? 'ఎంపికయ్యాయి' : 'selected'}
                              </span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              {multiOpts.map((opt, oi) => {
                                const show = te && teOpts[oi] ? teOpts[oi] : opt
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
                                    <span>{show}</span>
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
                          onChange={(ev) => setAns(id, meterStored(ev.target.value))}
                          aria-label={label}
                        />
                      </div>
                      <div className="qa-meter-scale">
                        <span>{opts[0] || (te ? 'ప్రతికూల' : 'Negative')}</span>
                        <span>{opts[1] || (te ? 'తటస్థ' : 'Neutral')}</span>
                        <span>{opts[2] || (te ? 'సానుకూల' : 'Positive')}</span>
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
                            ? opts[0] || (te ? 'ప్రతికూల' : 'Negative')
                            : meterNum(val) <= 66
                            ? opts[1] || (te ? 'తటస్థ' : 'Neutral')
                            : opts[2] || (te ? 'సానుకూల' : 'Positive')}
                        </span>
                      </div>
                    </div>
                  ) : opts.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {opts.map((opt, oi) => {
                        const show = te && teOpts[oi] ? teOpts[oi] : opt
                        return (
                          <button
                            key={`${opt}-${oi}`}
                            type="button"
                            className={`chip ${val === opt ? 'selected' : ''}`}
                            onClick={() => setAns(id, val === opt ? '' : opt)}
                          >
                            {show}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <input
                      value={val}
                      onChange={(ev) => setAns(id, ev.target.value)}
                      placeholder="Answer"
                    />
                  )}
                </div>
              )
            })}
            <button type="submit" className="btn primary" disabled={saving || !questions.length}>
              {saving ? 'Submitting…' : 'Submit'}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  )
}
