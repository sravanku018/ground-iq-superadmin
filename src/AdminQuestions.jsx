import { useCallback, useEffect, useState } from 'react'
import Icon from './Icons'
import { getQuestions, getSurvey, listSurveys, saveQuestions, updateSurvey } from './api'
import OptionPills from './OptionPills'
import QuestionTelugu, { fillTeluguFromEnglish } from './QuestionTelugu'
import { canTeluguQuestions, isQuestionVisible, labelPatch, nextQuestionId, teluguFields } from './questionKey'

const EMPTY_Q = {
  id: '',
  label: '',
  type: 'text',
  options: [],
  required: false,
  visible: true,
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

export default function AdminQuestionsScreen({ onToast, user }) {
  const isSuperAdmin = user?.role === 'super_admin'
  // Survey-question editing power — Super Admin grants it (least privilege)
  const canEdit = isSuperAdmin || !!user?.can_edit_surveys
  const canTelugu = canTeluguQuestions(user)
  const [title, setTitle] = useState('')
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [surveys, setSurveys] = useState([])
  // '' = Super Admin platform default only. Client Admin always uses a real survey id.
  const [surveyId, setSurveyId] = useState('')
  const [surveysReady, setSurveysReady] = useState(false)
  const [displayLang, setDisplayLang] = useState('en')
  const [translatingAll, setTranslatingAll] = useState(false)

  const load = useCallback(async () => {
    if (!surveysReady) return
    // Client Admin must never load the platform Field Survey (form_key=default)
    if (!isSuperAdmin && !surveyId) {
      setTitle('')
      setQuestions([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      if (surveyId) {
        const d = await getSurvey(surveyId)
        setTitle(d.survey?.title || '')
        setQuestions(Array.isArray(d.survey?.questions) ? d.survey.questions : [])
        setDisplayLang(d.survey?.display_lang === 'te' ? 'te' : 'en')
      } else if (isSuperAdmin) {
        const data = await getQuestions()
        setTitle(data.title || 'Field Survey')
        setQuestions(Array.isArray(data.questions) ? data.questions : [])
      } else {
        setTitle('')
        setQuestions([])
      }
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [surveyId, onToast, surveysReady, isSuperAdmin])

  useEffect(() => {
    let cancelled = false
    listSurveys()
      .then((d) => {
        if (cancelled) return
        // Hide platform seed forms from Client Admin entirely
        const items = (d.items || []).filter((s) => {
          if (!isSuperAdmin && (s.form_key === 'default' || s.form_key === 'legacy')) return false
          return true
        })
        setSurveys(items)
        setSurveysReady(true)
        setSurveyId((cur) => {
          if (cur && items.some((s) => String(s.id) === String(cur))) return cur
          // Client Admin: auto-select first survey — never Field Survey default
          if (!isSuperAdmin) return items[0] ? String(items[0].id) : ''
          // Super Admin: prefer a real project if present; empty = platform default
          return cur || (items[0] ? String(items[0].id) : '')
        })
      })
      .catch(() => {
        if (!cancelled) {
          setSurveys([])
          setSurveysReady(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [isSuperAdmin])

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
        id: '',
        label: '',
        speak: '',
        _uid: `n-${Date.now()}`,
      },
    ])
  }

  function removeQ(i) {
    setQuestions((list) => list.filter((_, idx) => idx !== i))
  }

  async function translateAll() {
    setTranslatingAll(true)
    try {
      const next = []
      for (const q of questions) {
        try {
          next.push({ ...q, ...(await fillTeluguFromEnglish(q)) })
        } catch {
          next.push(q)
        }
      }
      setQuestions(next)
      onToast?.('Telugu filled for all questions and options', 'ok')
    } catch (e) {
      onToast?.(e.message || 'Translate failed', 'error')
    } finally {
      setTranslatingAll(false)
    }
  }

  async function save() {
    if (!canEdit) {
      onToast?.('Super Admin has not granted your account survey-editing rights', 'error')
      return
    }
    if (!isSuperAdmin && !surveyId) {
      onToast?.('Create a survey first (Surveys tab), then edit its questions here', 'error')
      return
    }
    setSaving(true)
    try {
      const used = new Set()
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
          id: nextQuestionId(q.label, q.id, used),
          label: String(q.label || '').trim() || 'Question',
          type: String(q.type || 'text'),
          options: finalOptions,
          required: !!q.required,
          visible: q.visible !== false,
          speak: String(q.speak || q.label || '').trim(),
          ...teluguFields(q),
        }
      })
      if (surveyId) {
        await updateSurvey(surveyId, { title, questions: cleaned, display_lang: displayLang })
      } else if (isSuperAdmin) {
        await saveQuestions({ title, questions: cleaned })
      } else {
        throw new Error('No survey selected')
      }
      onToast?.('Questions saved — field app loads them automatically', 'ok')
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!surveysReady || loading) {
    return (
      <div className="screen">
        <p className="muted">Loading questions…</p>
      </div>
    )
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h2>{isSuperAdmin ? 'Super Admin · Questions' : 'Client Admin · Questions'}</h2>
        <p>Pick a {isSuperAdmin ? 'project' : 'survey'} · edit here · surveyor app loads automatically after unlock</p>
      </header>

      {!canEdit && (
        <div
          className="card"
          style={{
            marginBottom: 12,
            border: '1px solid rgba(217,119,6,0.5)',
            background: 'rgba(217,119,6,0.08)',
            padding: '12px 14px',
            fontSize: 13,
          }}
        >
          <Icon name="lock" size={13} /> <strong>Survey questions are read-only for you.</strong> Editing is locked until the
          Super Admin grants your account <strong>Survey questions</strong> power (Surveyors → your
          profile).
        </div>
      )}

      {!isSuperAdmin && surveys.length === 0 && (
        <div className="card" style={{ marginBottom: 12, padding: '14px 16px' }}>
          <p style={{ margin: 0 }}>
            No surveys yet. Create one under <strong>Surveys</strong>, then edit its questions here.
          </p>
          <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
            The platform “Field Survey” form is not available in Client Admin.
          </p>
        </div>
      )}

      {(isSuperAdmin || surveys.length > 0) && (
      <div className="card" style={{ marginBottom: 12 }}>
        <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>
          Display language (phone, dashboard, export)
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {[
            { id: 'en', label: 'English' },
            { id: 'te', label: 'తెలుగు' },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip ${displayLang === p.id ? 'selected' : ''}`}
              onClick={() => {
                if (p.id === 'te' && !canTelugu) return
                setDisplayLang(p.id)
              }}
              disabled={!canEdit || (p.id === 'te' && !canTelugu)}
              title={p.id === 'te' && !canTelugu ? 'Telugu translation is locked — Super Admin must grant it' : undefined}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="field">
          <span>{isSuperAdmin ? 'Project / form' : 'Survey'}</span>
          <select value={surveyId} onChange={(e) => setSurveyId(e.target.value)}>
            {isSuperAdmin && <option value="">Platform default (Field Survey)</option>}
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
      )}

      {canTelugu && displayLang === 'te' && questions.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button type="button" className="btn small" disabled={translatingAll || !canEdit} onClick={() => void translateAll()}>
            {translatingAll ? 'Translating all…' : 'Auto-translate all questions + options'}
          </button>
        </div>
      )}
      {questions.map((q, i) => {
        const type = q.type || 'text'
        const hasOptions = ['choice', 'yesno', 'abc', 'sentiment', 'sentiment_text', 'range', 'numeric_range', 'age'].includes(type)
        const currentOpts = Array.isArray(q.options) && q.options.length > 0
          ? q.options
          : (q.optionsText || '').split(',').map((s) => s.trim()).filter(Boolean)

        return (
          <div key={q._uid || `qi-${i}`} className="card" style={{ marginBottom: 14, borderLeft: '4px solid #00e599' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span className="pill ok" style={{ fontSize: 11, fontWeight: 'bold' }}>
                Q{i + 1} · {type.toUpperCase().replace('_', ' ')}
              </span>
              <button type="button" className="btn small danger" onClick={() => removeQ(i)} disabled={!canEdit}>
                Delete Q{i + 1}
              </button>
            </div>

            <label className="field">
              <span>{displayLang === 'te' ? 'English question text' : 'Question'}</span>
              <input
                value={q.label}
                onChange={(e) => updateQ(i, labelPatch(q, e.target.value))}
                placeholder="Type the question"
              />
            </label>
            {canTelugu && displayLang === 'te' ? (
              <QuestionTelugu q={q} onChange={(patch) => updateQ(i, patch)} onToast={onToast} />
            ) : null}

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
                <option value="meter">🎚️ Sentiment Meter (tap-o-meter 1–100%)</option>
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
                  <OptionPills
                    options={currentOpts.length > 0 ? currentOpts : defaultOptionsForType(type)}
                    onChange={(list) => updateQ(i, { options: list, optionsText: list.join(', ') })}
                    addLabel="+ Add Option"
                    addValue={(n) => `Option ${n + 1}`}
                  />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '10px 0 12px' }}>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  background: isQuestionVisible(q) ? 'rgba(5, 150, 105, 0.12)' : 'rgba(15, 23, 42, 0.05)',
                  border: isQuestionVisible(q) ? '1px solid #059669' : '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '10px 14px',
                  cursor: 'pointer',
                  width: 'fit-content',
                }}
              >
                <input
                  type="checkbox"
                  checked={isQuestionVisible(q)}
                  onChange={(e) => updateQ(i, { visible: e.target.checked })}
                />
                <span style={{ fontSize: 13, fontWeight: 'bold', color: isQuestionVisible(q) ? '#059669' : '#64748b' }}>
                  {isQuestionVisible(q) ? '✓ Visible on dashboard' : 'Hidden on dashboard'}
                </span>
              </label>
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
                  width: 'fit-content',
                }}
              >
                <input
                  type="checkbox"
                  checked={!!q.required}
                  onChange={(e) => updateQ(i, { required: e.target.checked })}
                  disabled={!canEdit}
                />
                <span style={{ fontSize: 13, fontWeight: 'bold', color: q.required ? '#00e599' : '#e2e8f0' }}>
                  {q.required ? <><Icon name="check" size={12} /> Required (surveyor must answer)</> : 'Optional'}
                </span>
              </label>
            </div>

            {/* Live App Preview */}
            <div style={{ background: 'rgba(15,23,42,0.05)', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, marginTop: 8 }}>
              <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 'bold', color: '#38bdf8' }}>
                <Icon name="smartphone" size={12} /> Mobile App Preview for Surveyors:
              </p>
              {type === 'yesno' ? (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="button" className="btn" style={{ background: '#059669', color: '#fff', fontWeight: 'bold', padding: '8px 20px', border: 0 }}>
                    <Icon name="check" size={13} /> YES
                  </button>
                  <button type="button" className="btn" style={{ background: '#dc2626', color: '#fff', fontWeight: 'bold', padding: '8px 20px', border: 0 }}>
                    <Icon name="cross" size={13} /> NO
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
              ) : type === 'meter' ? (
                <div>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    readOnly
                    style={{ width: '100%', accentColor: '#059669' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span>1% · Negative</span>
                    <span>50% · Neutral</span>
                    <span>100% · Positive</span>
                  </div>
                </div>
              ) : hasOptions ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(currentOpts.length > 0 ? currentOpts : ['Option 1', 'Option 2', 'Option 3']).map((opt, idx, list) => (
                    <span key={`${String(opt)}:${list.slice(0, idx).filter((o) => o === opt).length}`} style={{ background: '#38bdf8', color: '#111', padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 'bold' }}>
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

      {(isSuperAdmin || surveyId) && (
        <>
          <button type="button" className="btn primary" onClick={addQ} disabled={!canEdit} style={{ marginBottom: 12 }}>
            + Add Question
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={saving || !canEdit} style={{ marginLeft: 8 }}>
            {saving ? 'Saving & Pushing…' : <><Icon name="check" size={12} /> Save & Push to Mobile App</>}
          </button>
        </>
      )}
    </div>
  )
}
