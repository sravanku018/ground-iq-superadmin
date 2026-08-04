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
        type: String(q.type || 'text'),
        options:
          q.type === 'yesno'
            ? ['Yes', 'No']
            : q.type === 'abc'
              ? ['A', 'B', 'C', 'D']
              : q.type === 'sentiment'
                ? ['Positive', 'Neutral', 'Negative']
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

      {questions.map((q, i) => {
        const type = q.type || 'text'
        return (
          <div key={q.id || i} className="card" style={{ marginBottom: 14, borderLeft: '4px solid #00e599' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span className="pill ok" style={{ fontSize: 11, fontWeight: 'bold' }}>
                Q{i + 1} · {type.toUpperCase().replace('_', ' ')}
              </span>
              <button type="button" className="btn small danger" onClick={() => removeQ(i)}>
                Delete Q{i + 1}
              </button>
            </div>

            <label className="field">
              <span>Field ID (Unique Key)</span>
              <input
                value={q.id}
                onChange={(e) => updateQ(i, { id: e.target.value })}
                placeholder="e.g. voter_opinion"
              />
            </label>

            <label className="field">
              <span>Question Text / Label *</span>
              <input
                value={q.label}
                onChange={(e) => updateQ(i, { label: e.target.value })}
                placeholder="What is your opinion on local development?"
              />
            </label>

            <label className="field">
              <span>Voice Prompt (spoken by surveyor / speech fill)</span>
              <input
                value={q.speak || ''}
                onChange={(e) => updateQ(i, { speak: e.target.value })}
                placeholder="Ask respondent their opinion on local development"
              />
            </label>

            <label className="field">
              <span>Question Type</span>
              <select
                value={type}
                onChange={(e) => updateQ(i, { type: e.target.value })}
                style={{ fontWeight: 'bold' }}
              >
                <option value="yesno">✓ Yes / ✕ No Buttons (Green & Red)</option>
                <option value="sentiment_text">📝 Text + Sentiment Fillers (Positive/Neutral/Negative)</option>
                <option value="choice">🔘 Choice / Custom Options (Multi-Pill)</option>
                <option value="abc">🔤 A · B · C · D Choice Buttons</option>
                <option value="sentiment">⭐ Sentiment Rating Scale (Positive/Neutral/Negative)</option>
                <option value="text">✏️ Open Text Input</option>
                <option value="age">🔢 Age / Numeric Field</option>
              </select>
            </label>

            {type === 'choice' && (
              <label className="field">
                <span>Options (comma separated list)</span>
                <input
                  value={q.optionsText != null ? q.optionsText : (q.options || []).join(', ')}
                  onChange={(e) => updateQ(i, { optionsText: e.target.value })}
                  placeholder="Satisfied, Neutral, Unsatisfied, Don't Know"
                />
              </label>
            )}

            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, margin: '6px 0 10px' }}>
              <input
                type="checkbox"
                checked={!!q.required}
                onChange={(e) => updateQ(i, { required: e.target.checked })}
              />
              <span style={{ fontWeight: 'bold' }}>Required for surveyor submit</span>
            </label>

            {/* Live App Preview */}
            <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid #334155', borderRadius: 8, padding: 10, marginTop: 8 }}>
              <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 'bold', color: '#38bdf8' }}>
                📱 Mobile App Preview for Surveyors:
              </p>
              {type === 'yesno' ? (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="button" className="btn" style={{ background: '#059669', color: '#fff', fontWeight: 'bold', padding: '8px 20px', border: 0 }}>
                    ✓ YES
                  </button>
                  <button type="button" className="btn" style={{ background: '#dc2626', color: '#fff', fontWeight: 'bold', padding: '8px 20px', border: 0 }}>
                    ✕ NO
                  </button>
                </div>
              ) : type === 'sentiment_text' || type === 'sentiment' ? (
                <div>
                  {type === 'sentiment_text' && (
                    <input readOnly placeholder="Open text response…" style={{ marginBottom: 8, width: '100%' }} />
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ background: '#059669', color: '#fff', padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 'bold' }}>
                      😀 Positive
                    </span>
                    <span style={{ background: '#d97706', color: '#fff', padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 'bold' }}>
                      😐 Neutral
                    </span>
                    <span style={{ background: '#dc2626', color: '#fff', padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 'bold' }}>
                      🙁 Negative
                    </span>
                  </div>
                </div>
              ) : type === 'abc' ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  {['A', 'B', 'C', 'D'].map((letter, idx) => (
                    <span key={letter} style={{ background: ['#00e599', '#38bdf8', '#a78bfa', '#f472b6'][idx], color: '#111', padding: '6px 16px', borderRadius: 16, fontWeight: 'bold' }}>
                      {letter}
                    </span>
                  ))}
                </div>
              ) : type === 'choice' ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {((q.optionsText != null ? q.optionsText : (q.options || []).join(', '))
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean).length
                      ? (q.optionsText != null ? q.optionsText : (q.options || []).join(', '))
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean)
                      : ['Option 1', 'Option 2', 'Option 3']
                  ).map((opt, idx) => (
                    <span key={idx} style={{ background: '#38bdf8', color: '#111', padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 'bold' }}>
                      {opt}
                    </span>
                  ))}
                </div>
              ) : (
                <input readOnly placeholder="Surveyor types answer here…" style={{ width: '100%' }} />
              )}
            </div>
          </div>
        )
      })}

      <button type="button" className="btn primary" onClick={addQ} style={{ marginBottom: 12 }}>
        + Add Question
      </button>
      <button type="button" className="btn primary" onClick={save} disabled={saving} style={{ marginLeft: 8 }}>
        {saving ? 'Saving & Pushing…' : 'Save & Push to Mobile App ✓'}
      </button>
    </div>
  )
}
