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

const defaultOptionsForType = (t) => {
  if (t === 'yesno') return ['Yes', 'No']
  if (t === 'abc') return ['A', 'B', 'C', 'D']
  if (t === 'sentiment' || t === 'sentiment_text') return ['Positive', 'Neutral', 'Negative']
  if (t === 'range' || t === 'numeric_range' || t === 'age') return ['10-20', '21-30', '31-40', '41-50', '50+']
  if (t === 'choice') return ['Option 1', 'Option 2', 'Option 3']
  return []
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

  function handleTypeChange(i, newType) {
    const defaults = defaultOptionsForType(newType)
    updateQ(i, {
      type: newType,
      options: defaults,
      optionsText: defaults.join(', '),
    })
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
      const cleaned = questions.map((q) => {
        const optsFromText =
          q.optionsText != null
            ? String(q.optionsText)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : null
        const finalOptions =
          optsFromText && optsFromText.length > 0
            ? optsFromText
            : Array.isArray(q.options) && q.options.length > 0
              ? q.options
              : q.type === 'yesno'
                ? ['Yes', 'No']
                : q.type === 'abc'
                  ? ['A', 'B', 'C', 'D']
                  : q.type === 'sentiment' || q.type === 'sentiment_text'
                    ? ['Positive', 'Neutral', 'Negative']
                    : q.type === 'choice'
                      ? ['Option 1', 'Option 2']
                      : undefined

        return {
          id: String(q.id || '').trim() || `q_${Math.random().toString(36).slice(2, 8)}`,
          label: String(q.label || '').trim() || 'Question',
          type: String(q.type || 'text'),
          options: finalOptions,
          required: !!q.required,
          speak: String(q.speak || q.label || '').trim(),
        }
      })
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
        const hasOptions = ['choice', 'yesno', 'abc', 'sentiment', 'sentiment_text', 'range', 'numeric_range', 'age'].includes(type)
        const currentOpts = Array.isArray(q.options) && q.options.length > 0
          ? q.options
          : (q.optionsText || '').split(',').map((s) => s.trim()).filter(Boolean)

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
                placeholder="e.g. age_range"
              />
            </label>

            <label className="field">
              <span>Question Text / Label *</span>
              <input
                value={q.label}
                onChange={(e) => updateQ(i, { label: e.target.value })}
                placeholder="What is your age or income bracket?"
              />
            </label>

            <label className="field">
              <span>Voice Prompt (spoken by surveyor / speech fill)</span>
              <input
                value={q.speak || ''}
                onChange={(e) => updateQ(i, { speak: e.target.value })}
                placeholder="Ask respondent their age bracket"
              />
            </label>

            <label className="field">
              <span>Question Type</span>
              <select
                value={type}
                onChange={(e) => handleTypeChange(i, e.target.value)}
                style={{ fontWeight: 'bold' }}
              >
                <option value="range">🔢 Numeric Range Buttons (e.g. 10-20, 21-30, 31-40, 50+)</option>
                <option value="yesno">✓ Yes / ✕ No Buttons (Green & Red)</option>
                <option value="sentiment_text">📝 Text + Sentiment Fillers (Positive/Neutral/Negative)</option>
                <option value="choice">🔘 Choice / Custom Options (Multi-Pill)</option>
                <option value="abc">🔤 A · B · C · D Choice Buttons</option>
                <option value="sentiment">⭐ Sentiment Rating Scale (Positive/Neutral/Negative)</option>
                <option value="text">✏️ Open Text Input</option>
                <option value="age">🔢 Age / Numeric Field</option>
              </select>
            </label>

            {hasOptions && (
              <div style={{ marginTop: 10, background: 'rgba(15,23,42,0.05)', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                <label className="field" style={{ marginBottom: 8 }}>
                  <span>Answer Options (comma-separated or add chips below)</span>
                  <input
                    value={
                      q.optionsText != null
                        ? q.optionsText
                        : (Array.isArray(q.options) && q.options.length ? q.options.join(', ') : defaultOptionsForType(type).join(', '))
                    }
                    onChange={(e) => {
                      const val = e.target.value
                      const parsed = val.split(',').map((s) => s.trim()).filter(Boolean)
                      updateQ(i, { optionsText: val, options: parsed })
                    }}
                    placeholder="Satisfied, Neutral, Unsatisfied, Don't Know"
                  />
                </label>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 'bold', color: '#38bdf8' }}>Active Option Pills:</span>
                  {(currentOpts.length > 0 ? currentOpts : defaultOptionsForType(type)).map((opt, optIdx) => (
                    <span
                      key={optIdx}
                      style={{
                        background: '#eef2f7',
                        border: '1px solid #059669',
                        color: '#0f172a',
                        borderRadius: 16,
                        padding: '4px 10px',
                        fontSize: 12,
                        fontWeight: 'bold',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      {opt}
                      <button
                        type="button"
                        onClick={() => {
                          const list = currentOpts.filter((_, idx) => idx !== optIdx)
                          updateQ(i, { options: list, optionsText: list.join(', ') })
                        }}
                        style={{
                          background: 'none',
                          border: 0,
                          color: '#ff6b6b',
                          cursor: 'pointer',
                          fontWeight: 'bold',
                          fontSize: 13,
                          padding: 0,
                          lineHeight: 1,
                        }}
                        title="Remove option"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    className="btn small primary"
                    style={{ padding: '3px 10px', fontSize: 11 }}
                    onClick={() => {
                      const base = currentOpts.length > 0 ? currentOpts : defaultOptionsForType(type)
                      const next = [...base, `Option ${base.length + 1}`]
                      updateQ(i, { options: next, optionsText: next.join(', ') })
                    }}
                  >
                    + Add Option
                  </button>
                </div>
              </div>
            )}

            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                background: q.required ? 'rgba(5, 150, 105, 0.12)' : 'rgba(15, 23, 42, 0.05)',
                border: q.required ? '1px solid #059669' : '1px solid #e2e8f0',
                borderRadius: 8,
                padding: '10px 14px',
                cursor: 'pointer',
                margin: '10px 0 12px',
                width: 'fit-content',
              }}
            >
              <input
                type="checkbox"
                checked={!!q.required}
                onChange={(e) => updateQ(i, { required: e.target.checked })}
              />
              <span style={{ fontSize: 13, fontWeight: 'bold', color: q.required ? '#00e599' : '#e2e8f0' }}>
                {q.required ? '✓ Required Question (Surveyor must answer)' : 'Optional Question'}
              </span>
            </label>

            {/* Live App Preview */}
            <div style={{ background: 'rgba(15,23,42,0.05)', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, marginTop: 8 }}>
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
              ) : hasOptions ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(currentOpts.length > 0 ? currentOpts : ['Option 1', 'Option 2', 'Option 3']).map((opt, idx) => (
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
