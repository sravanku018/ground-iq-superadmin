import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icons'
import { getQuestions, getSurvey, listSurveys, saveQuestions, updateSurvey } from './api'
import OptionPills from './OptionPills'
import { CategoryField, CategoryPanel } from './QuestionCategory'
import QuestionTelugu, { fillTeluguFromEnglish } from './QuestionTelugu'
import {
  canTeluguQuestions,
  isQuestionVisible,
  labelPatch,
  multiMaxChoices,
  nextQuestionId,
  teluguFields,
} from './questionKey'

const EMPTY_Q = {
  id: '',
  label: '',
  type: 'text',
  options: [],
  required: false,
  visible: true,
  speak: '',
  category: '',
}

const defaultOptionsForType = (t) => {
  if (t === 'yesno') return ['Yes', 'No']
  if (t === 'abc') return ['A', 'B', 'C', 'D']
  if (t === 'sentiment' || t === 'sentiment_text') return ['Positive', 'Neutral', 'Negative']
  if (t === 'range' || t === 'numeric_range' || t === 'age') return ['10-20', '21-30', '31-40', '41-50', '50+']
  if (t === 'choice') return ['Option 1', 'Option 2', 'Option 3']
  if (t === 'multi_select' || t === 'multi') return ['Option 1', 'Option 2', 'Option 3', 'Option 4']
  return []
}

/**
 * A survey's questions are frozen once it is live or has responses.
 * Mirrors `isFrozenSurvey` in AdminSurveys.jsx so both question editors agree.
 */
function isFrozenSurvey(s) {
  if (!s) return false
  if (s.frozen || s.ended || s.ended_at) return true
  if (s.web_link?.token) return true
  if (Number(s.web_submissions) > 0 || Number(s.field_submissions) > 0 || Number(s.submissions) > 0) return true
  if (Number(s.surveyors) > 0) return true
  if (Array.isArray(s.surveyors) && s.surveyors.length > 0) return true
  return false
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
  const [currentSurvey, setCurrentSurvey] = useState(null)
  // Which question is expanded (null = all collapsed). View-only, never saved.
  const [activeIndex, setActiveIndex] = useState(null)
  const originalLabelsRef = useRef(new Map())

  const load = useCallback(async () => {
    if (!surveysReady) return
    // Client Admin must never load the platform Field Survey (form_key=default)
    if (!isSuperAdmin && !surveyId) {
      setCurrentSurvey(null)
      setTitle('')
      setQuestions([])
      originalLabelsRef.current = new Map()
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      if (surveyId) {
        const d = await getSurvey(surveyId)
        setCurrentSurvey(d.survey || null)
        setTitle(d.survey?.title || '')
        const loaded = Array.isArray(d.survey?.questions) ? d.survey.questions : []
        setQuestions(loaded)
        const snapshot = new Map()
        loaded.forEach((q, idx) => snapshot.set(String(q.id || idx), q.label || ''))
        originalLabelsRef.current = snapshot
        setDisplayLang(d.survey?.display_lang === 'te' ? 'te' : 'en')
      } else if (isSuperAdmin) {
        const data = await getQuestions()
        setCurrentSurvey({ isApp: true, surveyors: ['default'] })
        setTitle(data.title || 'Field Survey')
        const loaded = Array.isArray(data.questions) ? data.questions : []
        setQuestions(loaded)
        const snapshot = new Map()
        loaded.forEach((q, idx) => snapshot.set(String(q.id || idx), q.label || ''))
        originalLabelsRef.current = snapshot
      } else {
        setCurrentSurvey(null)
        setTitle('')
        setQuestions([])
        originalLabelsRef.current = new Map()
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

  // Start collapsed on load / survey switch.
  useEffect(() => {
    setActiveIndex(null)
  }, [surveyId])

  // Collapse if the list shrank past the active row; otherwise leave it as-is.
  useEffect(() => {
    setActiveIndex((cur) => {
      if (questions.length === 0) return null
      if (cur != null && cur >= questions.length) return null
      return cur
    })
  }, [questions.length])

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

  const maxQs = !isSuperAdmin ? Number(user?.max_questions_per_survey) || 0 : 0
  const otherSurveysQuestionsCount = surveys
    .filter((s) => String(s.id) !== String(surveyId))
    .reduce((sum, s) => sum + (Number(s.question_count) || 0), 0)
  const totalQuestionsUsed = otherSurveysQuestionsCount + questions.length

  const selectedSurvey = surveys.find((s) => String(s.id) === String(surveyId)) || null
  const surveySubmissions = selectedSurvey?.submissions || 0
  // Freeze using the same rule as the Surveys tab — a live/assigned/ended survey
  // (or one with web/field/total responses) locks its questions.
  const isFrozen =
    isFrozenSurvey(selectedSurvey) || (surveyId ? isFrozenSurvey(currentSurvey) : false)

  function addQ() {
    if (isFrozen) {
      onToast?.('Cannot add questions: Questionnaire is locked after survey start.', 'error')
      return
    }
    if (maxQs > 0 && totalQuestionsUsed >= maxQs) {
      onToast?.(`Total question quota reached: ${totalQuestionsUsed} of ${maxQs} questions allotted across surveys are used`, 'error')
      return
    }
    setActiveIndex(questions.length) // new last index — view only
    setQuestions((list) => [
      ...list,
      {
        ...EMPTY_Q,
        id: `q_${list.length + 1}`,
        label: '',
        speak: '',
        _uid: `n-${Date.now()}`,
      },
    ])
  }

  function removeQ(i) {
    if (isFrozen) {
      onToast?.('Cannot delete questions: Questionnaire is locked after survey start.', 'error')
      return
    }
    setQuestions((list) => list.filter((_, idx) => idx !== i))
    setActiveIndex((cur) => {
      if (cur == null) return cur
      if (i < cur) return cur - 1 // a row above collapsed the active one up
      if (i === cur) return Math.max(0, i - 1) // deleted the active one → the one above
      return cur
    })
  }

  async function translateAll() {
    if (isFrozen) return
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
    if (isFrozen) {
      onToast?.(`Cannot save or push: This survey has ${surveySubmissions} active response${surveySubmissions === 1 ? '' : 's'}. Questions are frozen.`, 'error')
      return
    }
    if (!isSuperAdmin && !surveyId) {
      onToast?.('Create a survey first (Surveys tab), then edit its questions here', 'error')
      return
    }
    if (maxQs > 0 && totalQuestionsUsed > maxQs) {
      onToast?.(`Total question quota exceeded: ${totalQuestionsUsed} questions used of ${maxQs} allotted across all surveys`, 'error')
      return
    }
    setSaving(true)

    try {
      const used = new Set()
      const cleaned = questions.map((q, idx) => {
        const qIndex = idx + 1
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
                      ? ['Option 1', 'Option 2', 'Option 3']
                      : q.type === 'multi_select' || q.type === 'multi'
                        ? ['Option 1', 'Option 2', 'Option 3', 'Option 4']
                        : undefined

        return {
          id: nextQuestionId(q.label, q.id, used, qIndex),
          label: String(q.label || '').trim() || `Question ${qIndex}`,
          type: String(q.type || 'text'),
          options: finalOptions,
          max_choices: (q.type === 'multi_select' || q.type === 'multi') ? multiMaxChoices(q) : undefined,
          required: !!q.required,
          visible: q.visible !== false,
          speak: String(q.speak || q.label || '').trim(),
          category: String(q.category || '').trim(),
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
      const isAppSurvey = Boolean(
        (currentSurvey?.surveyors || []).length > 0 ||
        (isSuperAdmin && !surveyId) ||
        currentSurvey?.isApp
      )
      onToast?.(isAppSurvey ? 'Questions saved — field app loads them automatically' : 'Questions saved', 'ok')
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

  const isAppSurvey = Boolean(
    (currentSurvey?.surveyors || []).length > 0 ||
    (isSuperAdmin && !surveyId) ||
    currentSurvey?.isApp
  )

  const addBtn = (
    <button type="button" className="btn primary" onClick={addQ} disabled={isFrozen || !canEdit || (maxQs > 0 && totalQuestionsUsed >= maxQs)}>
      + Add Question
    </button>
  )

  const saveBtn = (
    <button type="button" className="btn primary" onClick={save} disabled={isFrozen || saving || !canEdit} title={isFrozen ? 'Questionnaire is locked because this survey has active submissions' : undefined}>
      {isFrozen ? (
        <><Icon name="lock" size={12} /> {isAppSurvey ? 'Save & push to app (Locked)' : 'Save questions (Locked)'}</>
      ) : saving ? (
        isAppSurvey ? 'Saving & Pushing…' : 'Saving…'
      ) : (
        <><Icon name="check" size={12} /> {isAppSurvey ? 'Save & push to app' : 'Save questions'}</>
      )}
    </button>
  )

  return (
    <div className="screen">
      {/* 1 · Header */}
      <header className="screen-head row">
        <div>
          <h2>{isSuperAdmin ? 'Super Admin · Questions' : 'Client Admin · Questions'}</h2>
          <p>Pick a {isSuperAdmin ? 'project' : 'survey'} · edit here · surveyor app loads automatically after unlock</p>
        </div>
        {(isSuperAdmin || surveyId) && (
          <div className="mix-head-actions">
            {maxQs > 0 && (
              <div
                className={`mix-quota${totalQuestionsUsed >= maxQs ? ' full' : ''}`}
                title="Questions used by Client Admin / Total questions allotted by Super Admin"
              >
                <span><strong>{totalQuestionsUsed}</strong> / {maxQs} questions</span>
                <div className="mix-bar">
                  <span style={{ width: `${Math.min(100, Math.round((totalQuestionsUsed / maxQs) * 100))}%` }} />
                </div>
              </div>
            )}
            {saveBtn}
          </div>
        )}
      </header>

      {/* 2 · Banners */}
      {isFrozen && (
        <div className="mix-banner danger">
          <Icon name="lock" size={15} />
          <div>
            <strong>
              {surveySubmissions > 0
                ? `Questionnaire is frozen (${surveySubmissions} submitted response${surveySubmissions === 1 ? '' : 's'}).`
                : 'Questionnaire is frozen.'}
            </strong>
            <div className="mix-banner-sub">
              Editing, adding, deleting, and saving questions is disabled to preserve the integrity of existing survey responses.
            </div>
          </div>
        </div>
      )}

      {!canEdit && (
        <div className="mix-banner warn">
          <Icon name="lock" size={13} />
          <div>
            <strong>Survey questions are read-only for you.</strong> Editing is locked until the Super Admin grants your
            account <strong>Survey questions</strong> power (Surveyors → your profile).
          </div>
        </div>
      )}

      {!isSuperAdmin && surveys.length === 0 && (
        <div className="mix-banner plain">
          <div>
            <p style={{ margin: 0 }}>
              No surveys yet. Create one under <strong>Surveys</strong>, then edit its questions here.
            </p>
            <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
              The platform “Field Survey” form is not available in Client Admin.
            </p>
          </div>
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
              disabled={isFrozen || !canEdit || (p.id === 'te' && !canTelugu)}
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
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={isFrozen || !canEdit} />
        </label>
        <p className="muted" style={{ fontSize: 12 }}>
          Surveyor flow: <strong>GPS → Photo → Q/A + audio</strong>. Audio and answers upload
          separately.
        </p>
      </div>
      )}

      {!isFrozen && canEdit && <CategoryPanel onToast={onToast} />}

      {/* 5 · Toolbar */}
      {(isSuperAdmin || surveyId) && (
        <div className="mix-toolbar">
          {addBtn}
          <span className="mix-count">{questions.length} question{questions.length === 1 ? '' : 's'}</span>
          {canTelugu && questions.length > 0 && (
            <button type="button" className="btn small" disabled={isFrozen || translatingAll || !canEdit} onClick={() => void translateAll()}>
              {translatingAll ? 'Translating all…' : 'Auto-translate all questions + options'}
            </button>
          )}
        </div>
      )}
      {/* 6 · Question list */}
      <div className="mix-list">
      {questions.length === 0 && (isSuperAdmin || surveyId) && (
        <p className="muted" style={{ margin: 0 }}>No questions yet. Add one to start.</p>
      )}
      {questions.map((q, i) => {
        const type = q.type || 'text'
        const hasOptions = ['choice', 'multi_select', 'multi', 'yesno', 'abc', 'sentiment', 'sentiment_text', 'range', 'numeric_range', 'age'].includes(type)
        const currentOpts = Array.isArray(q.options) && q.options.length > 0
          ? q.options
          : (q.optionsText || '').split(',').map((s) => s.trim()).filter(Boolean)
        const hidden = !isQuestionVisible(q)

        if (i !== activeIndex) {
          return (
            <button
              key={q._uid || `qi-${i}`}
              type="button"
              className={`mix-row${hidden ? ' is-off' : ''}`}
              onClick={() => setActiveIndex(i)}
            >
              <span className="mix-num">{i + 1}</span>
              <span className="mix-t">{q.label || 'Untitled question'}</span>
              <span className="mix-pill">{type.toUpperCase().replace('_', ' ')}</span>
              {q.category ? <span className="mix-pill cat">{q.category}</span> : null}
              {q.required ? <span className="mix-pill req">Req</span> : null}
              <span className="mix-chev">▾</span>
            </button>
          )
        }

        return (
          <article key={q._uid || `qi-${i}`} className="mix-card">
            <button
              type="button"
              className="mix-head"
              onClick={() => setActiveIndex(null)}
              title="Collapse"
            >
              <span className="mix-num">{i + 1}</span>
              <strong className="mix-t">{q.label || 'Untitled question'}</strong>
              <span className="mix-chev is-open">▴</span>
            </button>
            <div className="mix-body">

            <label className="field">
              <span>{displayLang === 'te' ? 'English question text' : 'Question'}</span>
              <input
                value={q.label}
                onChange={(e) => updateQ(i, labelPatch(q, e.target.value))}
                placeholder="Type the question"
                disabled={isFrozen || !canEdit}
              />
            </label>
            {canTelugu ? (
              <QuestionTelugu q={q} onChange={(patch) => updateQ(i, patch)} onToast={onToast} disabled={isFrozen || !canEdit} />
            ) : null}

            <label className="field">
              <span>Voice Prompt (spoken by surveyor / speech fill)</span>
              <input
                value={q.speak || ''}
                onChange={(e) => updateQ(i, { speak: e.target.value })}
                placeholder="Ask respondent their age bracket"
                disabled={isFrozen || !canEdit}
              />
            </label>

            <label className="field">
              <span>Question Type</span>
              <select
                value={type}
                onChange={(e) => handleTypeChange(i, e.target.value)}
                style={{ fontWeight: 'bold' }}
                disabled={isFrozen || !canEdit}
              >
                <option value="multi_select">☑️ Multiple Select (Choose up to 5 answers / Multi-Pick)</option>
                <option value="choice">🔘 Single Choice (One-Answer Pill)</option>
                <option value="range">🔢 Numeric Range Buttons (e.g. 10-20, 21-30, 31-40, 50+)</option>
                <option value="yesno">✓ Yes / ✕ No Buttons (Green & Red)</option>
                <option value="sentiment_text">📝 Text + Sentiment Fillers (Positive/Neutral/Negative)</option>
                <option value="abc">🔤 A · B · C · D Choice Buttons</option>
                <option value="sentiment">⭐ Sentiment Rating Scale (Positive/Neutral/Negative)</option>
                <option value="meter">🎚️ Sentiment Meter (tap-o-meter 1–100%)</option>
                <option value="text">✏️ Open Text Input</option>
                <option value="age">🔢 Age / Numeric Field</option>
              </select>
            </label>

            <CategoryField
              value={q.category || ''}
              onChange={(name) => updateQ(i, { category: name })}
              onToast={onToast}
              disabled={isFrozen || !canEdit}
            />

            {(type === 'multi_select' || type === 'multi') && (
              <label className="field" style={{ marginTop: 8 }}>
                <span>Max allowed selections (default 2 · up to 5)</span>
                <select
                  value={multiMaxChoices(q)}
                  onChange={(e) => updateQ(i, { max_choices: Number(e.target.value) || 2 })}
                  disabled={isFrozen || !canEdit}
                  style={{ fontWeight: 'bold' }}
                >
                  <option value={1}>Pick 1 answer</option>
                  <option value={2}>Pick up to 2 answers (Standard)</option>
                  <option value={3}>Pick up to 3 answers</option>
                  <option value={4}>Pick up to 4 answers</option>
                  <option value={5}>Pick up to 5 answers</option>
                </select>
              </label>
            )}

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
                    placeholder="Option 1, Option 2, Option 3, Option 4"
                    disabled={isFrozen || !canEdit}
                  />
                </label>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 'bold', color: '#38bdf8' }}>Active Option Pills:</span>
                  <OptionPills
                    options={currentOpts.length > 0 ? currentOpts : defaultOptionsForType(type)}
                    onChange={(list) => updateQ(i, { options: list, optionsText: list.join(', ') })}
                    addLabel="+ Add Option"
                    addValue={(n) => `Option ${n + 1}`}
                    disabled={isFrozen || !canEdit}
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
                  background: isQuestionVisible(q) ? 'rgba(79, 125, 198, 0.12)' : 'rgba(15, 23, 42, 0.05)',
                  border: isQuestionVisible(q) ? '1px solid #4f7dc6' : '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '10px 14px',
                  cursor: isFrozen || !canEdit ? 'not-allowed' : 'pointer',
                  width: 'fit-content',
                }}
              >
                <input
                  type="checkbox"
                  checked={isQuestionVisible(q)}
                  onChange={(e) => updateQ(i, { visible: e.target.checked })}
                  disabled={isFrozen || !canEdit}
                />
                <span style={{ fontSize: 13, fontWeight: 'bold', color: isQuestionVisible(q) ? '#4f7dc6' : '#64748b' }}>
                  {isQuestionVisible(q) ? '✓ Visible on dashboard' : 'Hidden on dashboard'}
                </span>
              </label>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  background: q.required ? 'rgba(79, 125, 198, 0.12)' : 'rgba(15, 23, 42, 0.05)',
                  border: q.required ? '1px solid #4f7dc6' : '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '10px 14px',
                  cursor: isFrozen || !canEdit ? 'not-allowed' : 'pointer',
                  width: 'fit-content',
                }}
              >
                <input
                  type="checkbox"
                  checked={!!q.required}
                  onChange={(e) => updateQ(i, { required: e.target.checked })}
                  disabled={isFrozen || !canEdit}
                />
                <span style={{ fontSize: 13, fontWeight: 'bold', color: q.required ? '#4f7dc6' : '#e2e8f0' }}>
                  {q.required ? <><Icon name="check" size={12} /> Required (surveyor must answer)</> : 'Optional'}
                </span>
              </label>
            </div>

            {/* Live App Preview */}
            <div style={{ background: 'rgba(15,23,42,0.05)', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, marginTop: 8 }}>
              <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 'bold', color: '#38bdf8' }}>
                <Icon name="smartphone" size={12} /> Mobile App Preview for Surveyors:
              </p>
              {type === 'multi_select' || type === 'multi' ? (
                <div>
                  <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 'bold', color: '#4f7dc6' }}>
                    ☑️ Select up to {multiMaxChoices(q)} answers (Multiple Choice):
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(currentOpts.length > 0 ? currentOpts : ['Option 1', 'Option 2', 'Option 3', 'Option 4']).map((opt, idx) => {
                      const sampleSelected = idx === 0 || idx === 1
                      return (
                        <span
                          key={opt}
                          style={{
                            background: sampleSelected ? '#4f7dc6' : 'rgba(15,23,42,0.08)',
                            color: sampleSelected ? '#ffffff' : '#0f172a',
                            border: sampleSelected ? '2px solid #4f7dc6' : '1px solid #cbd5e1',
                            padding: '6px 14px',
                            borderRadius: 16,
                            fontSize: 12,
                            fontWeight: 'bold',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span style={{ fontSize: 13 }}>{sampleSelected ? '☑' : '☐'}</span>
                          {opt}
                        </span>
                      )
                    })}
                  </div>
                </div>
              ) : type === 'yesno' ? (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="button" className="btn" style={{ background: '#4f7dc6', color: '#fff', fontWeight: 'bold', padding: '8px 20px', border: 0 }}>
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
                    <span style={{ background: '#4f7dc6', color: '#fff', padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 'bold' }}>
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
                    <span key={letter} style={{ background: ['#4f7dc6', '#38bdf8', '#a78bfa', '#f472b6'][idx], color: '#111', padding: '6px 16px', borderRadius: 16, fontWeight: 'bold' }}>
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
                    style={{ width: '100%', accentColor: '#4f7dc6' }}
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
            <footer className="mix-foot">
              <button type="button" className="btn small danger" onClick={() => removeQ(i)} disabled={isFrozen || !canEdit}>
                Delete Q{i + 1}
              </button>
            </footer>
          </article>
        )
      })}
      </div>

      {/* 7 · Footer */}
      {(isSuperAdmin || surveyId) && (
        <div className="mix-toolbar">
          {addBtn}
          {saveBtn}
        </div>
      )}
    </div>
  )
}
