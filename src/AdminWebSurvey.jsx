import { useCallback, useEffect, useState } from 'react'
import Icon from './Icons'
import { createWebSurvey, getSurvey, listSurveys, webFillUrl } from './api'
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
  const [saving, setSaving] = useState(false)

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

  useEffect(() => {
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

  async function submit(e) {
    e.preventDefault()
    if (!formKey) {
      onToast?.('Pick a survey', 'error')
      return
    }
    for (const q of questions) {
      if (q.required && !String(answers[qid(q)] || '').trim()) {
        onToast?.(`Required: ${q.label || q.label_te || qid(q)}`, 'error')
        return
      }
    }
    setSaving(true)
    try {
      const res = await createWebSurvey({
        form_key: formKey,
        form_id: formKey,
        submitted_by: user?.name || user?.username,
        answers,
      })
      onToast?.(`Web survey saved · #${res.id} · ${res.status || 'pending'}`, 'ok')
      setAnswers(emptyAnswers(questions))
    } catch (err) {
      onToast?.(err.message || 'Submit failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="clipboard" size={18} /> Web survey
      </h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Copy the link for this survey and share it. Anyone with the link can fill it (no login).
        Records land as pending (no GPS/photo/voice). Filling the form here in the portal needs Super
        Admin to grant <strong>Web survey</strong>.
      </p>

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
          <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700 }}>Web survey link</p>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
            Share this URL. Opens a public form for <strong>{title || formKey}</strong>.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              readOnly
              value={webFillUrl(formKey)}
              style={{ flex: 1, minWidth: 220, fontSize: 13 }}
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              className="btn primary"
              onClick={async () => {
                const link = webFillUrl(formKey)
                try {
                  await navigator.clipboard.writeText(link)
                  onToast?.('Link copied', 'ok')
                } catch {
                  onToast?.(link, 'ok')
                }
              }}
            >
              Copy link
            </button>
          </div>
        </div>
      ) : null}

      {title ? <h3 style={{ margin: '0 0 12px' }}>{title}</h3> : null}

      {!canFillHere ? (
        <p className="muted" style={{ fontSize: 13 }}>
          Copy the link above to share. Filling from this page needs Super Admin to grant Web
          survey.
        </p>
      ) : questions.length === 0 && !loading ? (
        <p className="muted">This survey has no questions yet.</p>
      ) : canFillHere ? (
        <form onSubmit={submit}>
          {questions.map((q, i) => {
            const id = qid(q)
            const type = q.type || 'text'
            const opts = Array.isArray(q.options) ? q.options : []
            const teOpts = Array.isArray(q.options_te) ? q.options_te : []
            const val = answers[id] ?? ''
            return (
              <div key={id || i} className="card" style={{ marginBottom: 12 }}>
                <p style={{ margin: '0 0 4px', fontWeight: 700 }}>
                  Q{i + 1}. {q.label || 'Question'}
                  {q.required ? ' *' : ''}
                </p>
                {q.label_te ? (
                  <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
                    {q.label_te}
                  </p>
                ) : (
                  <div style={{ height: 8 }} />
                )}
                {type === 'meter' ? (
                  <label className="field">
                    <input
                      type="range"
                      min="1"
                      max="100"
                      value={meterNum(val)}
                      onChange={(e) => setAns(id, meterStored(e.target.value))}
                    />
                    <span className="muted">{meterStored(val)}</span>
                  </label>
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
                    placeholder="Answer"
                  />
                )}
              </div>
            )
          })}
          <button type="submit" className="btn primary" disabled={saving || !questions.length}>
            {saving ? 'Saving…' : 'Submit web survey'}
          </button>
        </form>
      ) : null}
    </div>
  )
}
