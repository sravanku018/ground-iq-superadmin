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

/** Shared question editor (same fields as the Questions tab) */
function QuestionEditor({ questions, onChange, onToast }) {
  function updateQ(i, patch) {
    onChange(questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)))
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
            <input value={q.label} onChange={(e) => updateQ(i, { label: e.target.value })} />
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
            </select>
          </label>
          {q.type === 'choice' && (
            <label className="field">
              <span>Options (comma separated)</span>
              <input
                value={
                  q.optionsText != null ? q.optionsText : (q.options || []).join(', ')
                }
                onChange={(e) => updateQ(i, { optionsText: e.target.value })}
              />
            </label>
          )}
          <label
            className="field"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
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
      <button
        type="button"
        className="btn secondary"
        onClick={addQ}
        style={{ marginBottom: 10 }}
      >
        + Add question
      </button>
    </>
  )
}

function cleanQuestions(questions) {
  return (questions || []).map((q) => ({
    id: String(q.id || '').trim() || `q_${Math.random().toString(36).slice(2, 8)}`,
    label: String(q.label || '').trim() || 'Question',
    type: q.type === 'choice' ? 'choice' : 'text',
    options:
      q.type === 'choice'
        ? String(q.optionsText || (q.options || []).join(', '))
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    required: !!q.required,
    speak: String(q.speak || q.label || '').trim(),
  }))
}

export default function AdminSurveysScreen({ onToast }) {
  const [mode, setMode] = useState('list') // list | create | detail
  const [surveys, setSurveys] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  // create mode
  const [newTitle, setNewTitle] = useState('')
  const [questions, setQuestions] = useState([])
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

  // Auto-refresh while the Surveys screen is open — keeps team counts /
  // submissions current without manual reload
  useEffect(() => {
    if (mode !== 'list') return
    const iv = setInterval(() => load(), 30000)
    const onVis = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [load, mode])

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
      await updateSurvey(detail.id, { title: detail.title })
      onToast?.('Survey saved', 'ok')
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

        <div className="card" style={{ marginBottom: 12 }}>
          <label className="field">
            <span>Survey name</span>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Assembly Survey 2026"
              autoFocus
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
          Questions are added later in the <strong>Questions</strong> tab.
        </p>

        <button
          type="button"
          className="btn primary"
          onClick={saveNew}
          disabled={saving || !newTitle.trim()}
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

        <div className="card" style={{ marginBottom: 12 }}>
          <label className="field">
            <span>Survey name</span>
            <input
              value={detail.title}
              onChange={(e) => setDetail({ ...detail, title: e.target.value })}
            />
          </label>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            form_key: <strong>{detail.form_key}</strong> ·{' '}
            {(detail.questions || []).length} question(s) · updated{' '}
            {String(detail.updated_at || '').slice(0, 16).replace('T', ' ')}
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
          Questions for this survey are edited in the <strong>Questions</strong> tab.
        </p>

        <button
          type="button"
          className="btn primary"
          onClick={saveDetailChanges}
          disabled={saving || busy}
        >
          {saving ? 'Saving…' : 'Save survey (title)'}
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
        <div key={s.id} className="card" style={{ marginBottom: 10, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="btn small"
              onClick={() => openDetail(s.id)}
              disabled={busy}
            >
              Open
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: 14 }}>{s.title}</strong>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                {s.question_count} question(s) · {s.surveyors} surveyor(s) · {s.submissions}{' '}
                submission(s) · updated{' '}
                {String(s.updated_at || '').slice(0, 16).replace('T', ' ')}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
