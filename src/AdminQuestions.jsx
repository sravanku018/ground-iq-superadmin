import { useCallback, useEffect, useState } from 'react'
import { getQuestions, getSurvey, listSurveys, saveQuestions, updateSurvey } from './api'

const EMPTY_Q = {
  id: '',
  label: '',
  type: 'text',
  options: [],
  required: false,
  speak: '',
}

export default function AdminQuestionsScreen({ onToast }) {
  const [title, setTitle] = useState('Field Survey')
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [surveys, setSurveys] = useState([])
  const [surveyId, setSurveyId] = useState('') // '' = default form, else survey id

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (surveyId) {
        const d = await getSurvey(surveyId)
        setTitle(d.survey?.title || 'Field Survey')
        setQuestions(Array.isArray(d.survey?.questions) ? d.survey.questions : [])
      } else {
        const data = await getQuestions()
        setTitle(data.title || 'Field Survey')
        setQuestions(Array.isArray(data.questions) ? data.questions : [])
      }
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [surveyId, onToast])

  useEffect(() => {
    listSurveys()
      .then((d) => setSurveys(d.items || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function updateQ(i, patch) {
    setQuestions((list) => list.map((q, idx) => (idx === i ? { ...q, ...patch } : q)))
  }

  function addQ() {
    setQuestions((list) => [
      ...list,
      {
        ...EMPTY_Q,
        id: `q_${Date.now()}`,
        label: 'New question',
        speak: 'New question',
      },
    ])
  }

  function removeQ(i) {
    setQuestions((list) => list.filter((_, idx) => idx !== i))
  }

  async function save() {
    setSaving(true)
    try {
      const cleaned = questions.map((q) => ({
        id: String(q.id || '').trim() || `q_${Math.random().toString(36).slice(2, 8)}`,
        label: String(q.label || '').trim() || 'Question',
        type: q.type === 'choice' ? 'choice' : q.type === 'yesno' ? 'yesno' : 'text',
        options:
          q.type === 'yesno'
            ? ['Yes', 'No']
            : q.type === 'choice'
              ? String(q.optionsText || (q.options || []).join(', '))
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
              : undefined,
        required: !!q.required,
        speak: String(q.speak || q.label || '').trim(),
      }))
      await (surveyId
        ? updateSurvey(surveyId, { title, questions: cleaned })
        : saveQuestions({ title, questions: cleaned }))
      onToast?.('Questions saved — field app loads them automatically', 'ok')
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="screen">
        <p className="muted">Loading questions…</p>
      </div>
    )
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h2>Client Admin · Questions</h2>
        <p>Pick a survey · edit here · surveyor app loads automatically after unlock</p>
      </header>

      <div className="card" style={{ marginBottom: 12 }}>
        <label className="field">
          <span>Survey</span>
          <select value={surveyId} onChange={(e) => setSurveyId(e.target.value)}>
            <option value="">Field Survey (default)</option>
            {surveys.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
                {s.question_count ? ` (${s.question_count} Q)` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Form title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <p className="muted" style={{ fontSize: 12 }}>
          Surveyor flow: <strong>GPS → Photo → Q/A + audio</strong>. Audio and answers upload
          separately.
        </p>
      </div>

      {questions.map((q, i) => (
        <div key={q.id || i} className="card" style={{ marginBottom: 10 }}>
          <label className="field">
            <span>Field id (key)</span>
            <input
              value={q.id}
              onChange={(e) => updateQ(i, { id: e.target.value })}
              placeholder="respondent_name"
            />
          </label>
          <label className="field">
            <span>Question label</span>
            <input
              value={q.label}
              onChange={(e) => updateQ(i, { label: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Voice prompt (spoken / speech fill)</span>
            <input
              value={q.speak || ''}
              onChange={(e) => updateQ(i, { speak: e.target.value })}
              placeholder="What is the district?"
            />
          </label>
          <label className="field">
            <span>Type</span>
            <select
              value={q.type || 'text'}
              onChange={(e) => updateQ(i, { type: e.target.value })}
            >
              <option value="text">Text</option>
              <option value="choice">Choice</option>
              <option value="yesno">Yes / No buttons</option>
            </select>
          </label>
          {q.type === 'choice' && (
            <label className="field">
              <span>Options (comma separated)</span>
              <input
                value={
                  q.optionsText != null
                    ? q.optionsText
                    : (q.options || []).join(', ')
                }
                onChange={(e) => updateQ(i, { optionsText: e.target.value })}
              />
            </label>
          )}
          {q.type === 'yesno' && (
            <p className="muted" style={{ fontSize: 12 }}>
              Field app shows two push buttons: <strong>Yes</strong> · <strong>No</strong>
            </p>
          )}
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={!!q.required}
              onChange={(e) => updateQ(i, { required: e.target.checked })}
            />
            <span>Required</span>
          </label>
          <button type="button" className="btn small danger" onClick={() => removeQ(i)}>
            Remove
          </button>
        </div>
      ))}

      <button type="button" className="btn secondary" onClick={addQ} style={{ marginBottom: 10 }}>
        + Add question
      </button>
      <button type="button" className="btn primary" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save questions to Neon'}
      </button>
    </div>
  )
}
