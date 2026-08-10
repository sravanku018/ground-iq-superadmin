import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createSurvey,
  deleteSurvey,
  getSurvey,
  listSurveys,
  listUsers,
  setSurveySurveyors,
  updateSurvey,
} from './api'

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

/** Shared question editor with rich question types, interactive options & live app preview */
function QuestionEditor({ questions, onChange }) {
  function updateQ(i, patch) {
    onChange(questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)))
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
    onChange([
      ...questions,
      { ...EMPTY_Q, id: `q_${Date.now()}`, label: 'New question', speak: 'New question' },
    ])
  }

  function removeQ(i) {
    onChange(questions.filter((_, idx) => idx !== i))
  }

  return (
    <>
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
                  <span>Answer Options / Range Pills (comma-separated list, e.g. 10-20, 21-30, 31-40, 50+)</span>
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
                    placeholder="10-20, 21-30, 31-40, 41-50, 50+"
                  />
                </label>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 'bold', color: '#38bdf8' }}>Active Range/Option Pills:</span>
                  {(currentOpts.length > 0 ? currentOpts : defaultOptionsForType(type)).map((opt, optIdx) => (
                    <span
                      key={optIdx}
                      style={{
                        background: '#eef2f7',
                        border: '1px solid #059669',
                        color: '#0f172a',
                        borderRadius: 16,
                        padding: '4px 12px',
                        fontSize: 13,
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
                      const next = [...base, '51-60']
                      updateQ(i, { options: next, optionsText: next.join(', ') })
                    }}
                  >
                    + Add Range
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
                  {(currentOpts.length > 0 ? currentOpts : ['10-20', '21-30', '31-40', '41-50', '50+']).map((opt, idx) => (
                    <span key={idx} style={{ background: '#38bdf8', color: '#111', padding: '6px 14px', borderRadius: 16, fontSize: 13, fontWeight: 'bold' }}>
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
      <button
        type="button"
        className="btn primary"
        onClick={addQ}
        style={{ marginBottom: 12 }}
      >
        + Add Survey Question
      </button>
    </>
  )
}

function cleanQuestions(questions) {
  return (questions || []).map((q) => {
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
                : q.type === 'range' || q.type === 'numeric_range' || q.type === 'age'
                  ? ['10-20', '21-30', '31-40', '41-50', '50+']
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
}

export default function AdminSurveysScreen({ onToast, user }) {
  // Survey-editing power — Super Admin grants it (least privilege)
  const canEdit = user?.role === 'super_admin' || !!user?.can_edit_surveys || !!user?.can_crud_questionnaire
  const [mode, setMode] = useState('list') // list | create | detail
  const [surveys, setSurveys] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  // create mode
  const [newTitle, setNewTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [exists, setExists] = useState(null) // existing survey with same name

  // detail mode
  const [detail, setDetail] = useState(null)
  const [allSurveyors, setAllSurveyors] = useState([])
  const [checked, setChecked] = useState({})
  const [busy, setBusy] = useState(false)
  const [teamOpen, setTeamOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await listSurveys(search.trim())
      setSurveys(d.items || [])
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [search, onToast])

  useEffect(() => {
    if (mode === 'list') load()
  }, [load, mode])

  // Manual refresh only — auto-refresh disabled to prevent unwanted background database wake-ups

  // Live name filter while creating: find existing surveys matching the typed name
  const nameMatches = useMemo(() => {
    const t = newTitle.trim().toLowerCase()
    if (!t || !surveys.length) return []
    return surveys.filter((s) => String(s.title || '').toLowerCase().includes(t)).slice(0, 8)
  }, [newTitle, surveys])

  useEffect(() => {
    const t = newTitle.trim().toLowerCase()
    const hit = surveys.find((s) => String(s.title || '').toLowerCase() === t)
    setExists(hit || null)
  }, [newTitle, surveys])

  function openDetail(id) {
    setBusy(true)
    Promise.all([getSurvey(id), listUsers()])
      .then(([d, users]) => {
        setDetail(d.survey)
        const team = new Set((d.survey.surveyors || []).map((s) => Number(s.id)))
        const collect = (users.surveyors || users.users || users || [])
          .filter((u) => u.role === 'surveyor' || u.role === 'field')
        setAllSurveyors(collect)
        setChecked(Object.fromEntries(collect.map((u) => [String(u.id), team.has(Number(u.id))])))
        setMode('detail')
      })
      .catch((e) => onToast?.(e.message, 'error'))
      .finally(() => setBusy(false))
  }

  async function saveNew() {
    if (!canEdit) {
      onToast?.('Super Admin has not granted your account survey-editing rights', 'error')
      return
    }
    const title = newTitle.trim()
    if (!title) {
      onToast?.('Survey name required', 'error')
      return
    }
    setSaving(true)
    try {
      const d = await createSurvey({ title, questions: [] })
      onToast?.(`Survey "${title}" created`, 'ok')
      setMode('list')
      setNewTitle('')
      setExists(null)
      await load()
      if (d?.survey?.id) openDetail(d.survey.id)
    } catch (e) {
      if (e.status === 409 && e.existing_id) {
        onToast?.(`Survey "${title}" already exists — opening it`, 'warn')
        openDetail(e.existing_id)
      } else {
        onToast?.(e.message, 'error')
      }
    } finally {
      setSaving(false)
    }
  }

  async function saveDetailChanges() {
    if (!detail) return
    setSaving(true)
    try {
      await updateSurvey(detail.id, {
        title: detail.title,
        questions: cleanQuestions(detail.questions),
      })
      onToast?.('Survey name + questions saved', 'ok')
      await openDetail(detail.id)
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function toggleTeamMember(u) {
    if (!detail) return
    setBusy(true)
    try {
      const nextIds = Object.keys(checked).filter((k) => checked[k]).map(Number)
      const idx = nextIds.indexOf(Number(u.id))
      if (idx >= 0) nextIds.splice(idx, 1)
      else nextIds.push(Number(u.id))
      await setSurveySurveyors(detail.id, nextIds)
      onToast?.(idx >= 0 ? `Removed ${u.username} from team` : `Added ${u.username} to team`, 'ok')
      setTeamOpen(false)
      await openDetail(detail.id)
    } catch (e) {
      onToast?.(e.message, 'error')
      setBusy(false)
    }
  }

  async function removeSurvey() {
    if (!canEdit) {
      onToast?.('Super Admin has not granted your account survey-editing rights', 'error')
      return
    }
    if (!detail || !window.confirm(`Delete survey "${detail.title}"? Team assignments are removed too.`)) return
    setBusy(true)
    try {
      await deleteSurvey(detail.id)
      onToast?.('Survey deleted', 'ok')
      setDetail(null)
      setMode('list')
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'create') {
    return (
      <div className="screen">
        <header className="screen-head">
          <h2>New survey</h2>
          <button type="button" className="btn small" onClick={() => setMode('list')}>
            ← Back
          </button>
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
            🔒 <strong>Surveys are read-only for you.</strong> Creating or editing surveys is locked
            until the Super Admin grants your account <strong>CRUD questionnaire</strong> or
            <strong>Survey questions</strong> power (Super Admin → Client Admins tab).
            You can still open surveys and view their teams.
          </div>
        )}
        <div className="card" style={{ marginBottom: 12 }}>
          <label className="field">
            <span>Survey name</span>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Assembly Survey 2026"
              autoFocus
              disabled={!canEdit}
            />
          </label>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Filter existing surveys by name to avoid duplicates or reuse.
          </p>
          {exists && (
            <p className="toast warn" style={{ marginTop: 8 }}>
              "{exists.title}" already exists — saving opens it instead.
            </p>
          )}
          {!exists && nameMatches.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Existing surveys matching "{newTitle}":
              </span>
              {nameMatches.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => openDetail(s.id)}
                  >
                    Open
                  </button>
                  <span style={{ fontSize: 13 }}>
                    {s.title}{' '}
                    <span className="muted">
                      · {s.question_count} Q · {s.surveyors} surveyor(s)
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
          Questions are added after creating — open the survey to edit them (name, questions, team).
        </p>

        <button
          type="button"
          className="btn primary"
          onClick={saveNew}
          disabled={saving || !newTitle.trim() || !canEdit}
        >
          {saving ? 'Creating…' : 'Create survey'}
        </button>
      </div>
    )
  }

  if (mode === 'detail' && detail) {
    return (
      <div className="screen">
        <header className="screen-head">
          <h2>Survey · {detail.title}</h2>
          <button type="button" className="btn small" onClick={() => setMode('list')}>
            ← Back
          </button>
        </header>

        <div className="card" style={{ marginBottom: 12, borderLeft: '4px solid #00e599' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: '#059669', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              🔒 Survey Title (Locked / Non-Editable)
            </span>
            <span style={{ fontSize: 11, color: '#64748b' }}>form_key: {detail.form_key}</span>
          </div>
          <h3 style={{ margin: '4px 0 8px', fontSize: 20, color: '#0f172a', fontWeight: 'bold' }}>
            {detail.title}
          </h3>
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
            👥 <strong>Field Team (People who take survey):</strong>{' '}
            {(detail.surveyors || []).length > 0
              ? (detail.surveyors || []).map((s) => s.username || s.name).join(', ')
              : 'No surveyors assigned yet'}
          </p>
        </div>

        <h3 style={{ fontSize: 14, margin: '10px 0 6px' }}>Survey people — field team</h3>
        <div className="card" style={{ marginBottom: 12, padding: 12 }}>
          {allSurveyors.length === 0 ? (
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              No surveyor accounts yet — create them in the Users tab first.
            </p>
          ) : (
            <>
              <button
                type="button"
                className="btn small primary"
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => setTeamOpen((o) => !o)}
              >
                {Object.keys(checked).filter((k) => checked[k]).length > 0
                  ? `${Object.keys(checked).filter((k) => checked[k]).length} surveyor(s) in team — tap to edit`
                  : 'Add surveyors…'}
              </button>
              {teamOpen && (
                <div
                  style={{
                    background: '#fff',
                    color: '#111',
                    border: '1px solid rgba(0,0,0,0.2)',
                    borderRadius: 12,
                    padding: 6,
                    maxHeight: 220,
                    overflowY: 'auto',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                  }}
                >
                  {allSurveyors.map((u) => {
                    const on = checked[String(u.id)]
                    return (
                      <button
                        key={u.id}
                        type="button"
                        disabled={busy}
                        onClick={() => toggleTeamMember(u)}
                        style={{
                          display: 'flex',
                          width: '100%',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          padding: '10px 12px',
                          border: 'none',
                          borderRadius: 8,
                          background: on ? '#c8f5df' : 'transparent',
                          color: '#111',
                          fontSize: 14,
                          fontWeight: 600,
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {u.username}
                        </span>
                        {on ? (
                          <span style={{ color: '#00a86b', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
                            ✓
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    onClick={() => setTeamOpen(false)}
                    style={{
                      width: '100%',
                      marginTop: 4,
                      padding: '8px',
                      border: 'none',
                      borderRadius: 8,
                      background: 'rgba(0,0,0,0.06)',
                      color: '#111',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Done
                  </button>
                </div>
              )}
              {Object.keys(checked).filter((k) => checked[k]).length === 0 && (
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                  No surveyors assigned yet — open the dropdown above.
                </p>
              )}
              {Object.keys(checked)
                .filter((k) => checked[k])
                .map((k) => {
                  const u = allSurveyors.find((x) => String(x.id) === k)
                  if (!u) return null
                  return (
                    <div
                      key={k}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '5px 0',
                        borderTop: '1px solid rgba(128,128,128,0.15)',
                        fontSize: 13,
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        {u.username}
                        {u.display_name ? ` (${u.display_name})` : ''}
                      </span>
                      <button
                        type="button"
                        className="btn small danger"
                        onClick={() => toggleTeamMember(u)}
                        disabled={busy}
                        style={{
                          color: '#ff6b6b',
                          borderColor: 'rgba(255,107,107,0.4)',
                          background: 'transparent',
                          minHeight: 0,
                          padding: '6px 10px',
                          fontSize: 13,
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  )
                })}
            </>
          )}
        </div>

        <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
          Survey questions — add/edit here. Options support text, choice, Yes/No, A·B·C·D,
          sentiment (Positive/Neutral/Negative) and age (auto ranges in report).
        </p>

        <h3 style={{ fontSize: 14, margin: '14px 0 6px' }}>Survey questions</h3>
        <QuestionEditor
          questions={detail.questions || []}
          onChange={(qs) => setDetail({ ...detail, questions: qs })}
          onToast={onToast}
        />

        <button
          type="button"
          className="btn primary"
          onClick={saveDetailChanges}
          disabled={saving || busy}
        >
          {saving ? 'Saving…' : 'Save survey (name + questions)'}
        </button>
        <button
          type="button"
          className="btn danger"
          onClick={removeSurvey}
          disabled={busy}
          style={{ marginLeft: 8 }}
        >
          Delete survey
        </button>
      </div>
    )
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h2>Surveys</h2>
        <button
          type="button"
          className="btn"
          onClick={() => load()}
          disabled={loading}
          style={{ marginRight: 8 }}
        >
          ⟳ Refresh
        </button>
        <button type="button" className="btn primary" onClick={() => setMode('create')}>
          + New survey
        </button>
      </header>

      <div className="card" style={{ marginBottom: 12 }}>
        <label className="field">
          <span>Filter by survey name</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type a survey name…"
          />
        </label>
      </div>

      {loading && <p className="muted">Loading surveys…</p>}

      {!loading && surveys.length === 0 && (
        <p className="muted">
          {search ? 'No surveys match that name.' : 'No surveys yet — click "+ New survey".'}
        </p>
      )}

      {surveys.map((s) => (
        <div key={s.id} className="card" style={{ marginBottom: 10, padding: 14, borderLeft: '4px solid #00e599' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="btn small primary"
              onClick={() => openDetail(s.id)}
              disabled={busy}
              style={{ fontWeight: 'bold', padding: '8px 16px' }}
            >
              Open
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: 16, color: '#0f172a' }}>{s.title}</strong>
              <div style={{ fontSize: 13, color: '#38bdf8', fontWeight: 'bold', marginTop: 3 }}>
                👥 Field Team (People who took survey): {s.surveyor_names || `${s.surveyors || 0} assigned surveyor(s)`}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                📊 {s.submissions || 0} Submissions · 📋 {s.question_count || 0} Questions · Updated{' '}
                {String(s.updated_at || '').slice(0, 16).replace('T', ' ')}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
