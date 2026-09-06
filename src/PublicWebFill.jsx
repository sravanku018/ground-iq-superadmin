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
      const val = String(answers[qid(q)] || '').trim()
      if (!val) {
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
        <p className="eyebrow">Smart Survey X · Web survey</p>
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
          <div className="card success-card">
            <h3 className="success-title">Submitted</h3>
            <p className="success-sub">
              {closed
                ? 'Thank you. Your answers were saved. This link has now expired.'
                : 'Thank you. Your answers were saved.'}
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
              return (
                <div key={id || i} id={`web-q-${id}`} className="card" style={{ marginBottom: 12 }}>
                  <p style={{ margin: '0 0 10px', fontWeight: 700 }}>
                    Q{i + 1}. {label}
                    {q.required ? ' *' : ''}
                  </p>
                  {type === 'meter' ? (
                    <label className="field">
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={meterNum(val)}
                        onChange={(ev) => setAns(id, meterStored(ev.target.value))}
                      />
                      <span className="muted">{meterStored(val)}</span>
                    </label>
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
