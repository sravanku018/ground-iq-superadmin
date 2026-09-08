import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from './Icons'
import OptionPills from './OptionPills'
import {
  createSurvey,
  deleteSurvey,
  getSurvey,
  listCompanies,
  listSurveys,
  listUsers,
  setSurveyAdmins,
  updateSurvey,
} from './api'
import CopyWebFillLink from './components/CopyWebFillLink'
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

/** Shared question editor with rich question types, interactive options & live app preview */
function QuestionEditor({
  questions = [],
  onChange,
  onToast,
  canTelugu = false,
  displayLang = 'en',
  maxQs = 0,
  otherQuestionsCount = 0,
}) {
  const [translatingAll, setTranslatingAll] = useState(false)
  const totalQuestionsUsed = otherQuestionsCount + questions.length

  function updateQ(i, patch) {
    onChange(questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)))
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
      onChange(next)
      onToast?.('Telugu filled for all questions and options', 'ok')
    } catch (e) {
      onToast?.(e.message || 'Translate failed', 'error')
    } finally {
      setTranslatingAll(false)
    }
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
    if (maxQs > 0 && totalQuestionsUsed >= maxQs) {
      onToast?.(`Total question quota reached: ${totalQuestionsUsed} of ${maxQs} questions allotted across surveys are used`, 'error')
      return
    }
    onChange([
      ...questions,
      { ...EMPTY_Q, id: '', label: '', speak: '', _uid: `n-${Date.now()}` },
    ])
  }

  function removeQ(i) {
    onChange(questions.filter((_, idx) => idx !== i))
  }

  return (
    <>
      {canTelugu && questions.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button type="button" className="btn small" disabled={translatingAll} onClick={() => void translateAll()}>
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
              <button type="button" className="btn small danger" onClick={() => removeQ(i)}>
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
            {canTelugu ? (
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
                  <OptionPills
                    options={currentOpts.length > 0 ? currentOpts : defaultOptionsForType(type)}
                    onChange={(list) => updateQ(i, { options: list, optionsText: list.join(', ') })}
                    addLabel="+ Add Range"
                    addValue="51-60"
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
                />
                <span style={{ fontSize: 13, fontWeight: 'bold', color: q.required ? '#00e599' : '#e2e8f0' }}>
                  {q.required ? '✓ Required (surveyor must answer)' : 'Optional'}
                </span>
              </label>
            </div>

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
                  {(currentOpts.length > 0 ? currentOpts : ['10-20', '21-30', '31-40', '41-50', '50+']).map((opt, idx, list) => (
                    <span key={`${String(opt)}:${list.slice(0, idx).filter((o) => o === opt).length}`} style={{ background: '#38bdf8', color: '#111', padding: '6px 14px', borderRadius: 16, fontSize: 13, fontWeight: 'bold' }}>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <button
          type="button"
          className="btn primary"
          onClick={addQ}
          disabled={maxQs > 0 && totalQuestionsUsed >= maxQs}
        >
          + Add Survey Question
        </button>
        {maxQs > 0 && (
          <span
            className="pill"
            title="No. of questions used by Client Admin / Total questions allotted"
            style={{
              background: totalQuestionsUsed >= maxQs ? '#fef2f2' : 'rgba(0, 229, 153, 0.12)',
              color: totalQuestionsUsed >= maxQs ? '#dc2626' : '#047857',
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            📝 Total survey questions created: {totalQuestionsUsed} / Allotted by Super Admin: {maxQs}
          </span>
        )}
      </div>
    </>
  )
}

function cleanQuestions(questions) {
  const used = new Set()
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
      id: nextQuestionId(q.label, q.id, used, idx + 1),
      label: String(q.label || '').trim() || `Question ${idx + 1}`,
      type: String(q.type || 'text'),
      options: finalOptions,
      required: !!q.required,
      visible: q.visible !== false,
      speak: String(q.speak || q.label || '').trim(),
      ...teluguFields(q),
    }
  })
}


export default function AdminSurveysScreen({ onToast, user }) {
  // Super Admin creates Projects; Client Admin creates Surveys (needs Create surveys power)
  const isSuper = user?.role === 'super_admin'
  const canCreate = isSuper || !!user?.can_crud_questionnaire
  const canEditQs = isSuper || !!user?.can_edit_surveys || !!user?.can_crud_questionnaire
  const canEdit = canCreate || canEditQs
  const canVoice = isSuper || !!user?.can_record_voice
  // UI noun by role
  const unit = isSuper ? 'project' : 'survey'
  const Unit = isSuper ? 'Project' : 'Survey'
  const Units = isSuper ? 'Projects' : 'Surveys'

  const [mode, setMode] = useState('list') // list | create | detail
  const [surveys, setSurveys] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  // create mode
  const [newTitle, setNewTitle] = useState('')
  const [newVoiceLimit, setNewVoiceLimit] = useState(0)
  const [newVoiceRequired, setNewVoiceRequired] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exists, setExists] = useState(null) // existing survey with same name
  // Super Admin only: company + Client Admins when creating a Project
  const [newCompany, setNewCompany] = useState('')
  const [checkedAdmins, setCheckedAdmins] = useState({})
  const [companyNames, setCompanyNames] = useState([])



  // detail mode
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(false)
  // shared access: client admins granted access to this survey (super admin only)
  const [allAdmins, setAllAdmins] = useState([])
  const [adminsOpen, setAdminsOpen] = useState(false)

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

  // Super Admin "New project": load Client Admin accounts for the registration form
  useEffect(() => {
    if (mode === 'create' && user?.role === 'super_admin' && allAdmins.length === 0) {
      listUsers()
        .then((d) => {
          const admins = (d.users || d.surveyors || d || [])
            .filter((u) => u.role === 'admin' && u.active !== false)
          setAllAdmins(admins)
        })
        .catch(() => {})
    }
  }, [mode, user?.role, allAdmins.length])

  // Super Admin "New project": load registered companies for the company datalist
  useEffect(() => {
    if (mode === 'create' && user?.role === 'super_admin' && companyNames.length === 0) {
      listCompanies()
        .then((d) => setCompanyNames((d.items || []).map((c) => c.name)))
        .catch(() => {})
    }
  }, [mode, user?.role, companyNames.length])

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

  async function openDetail(id) {
    setBusy(true)
    try {
      const d = await getSurvey(id)
      setDetail(d.survey)
      if (user?.role === 'super_admin') {
        try {
          const users = await listUsers()
          const admins = (users.users || users.surveyors || users || []).filter((u) => u.role === 'admin')
          setAllAdmins(admins)
        } catch {
          /* ignore */
        }
      }
      setAdminsOpen(false)
      setMode('detail')
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function saveNew() {
    if (!canCreate) {
      onToast?.(
        isSuper
          ? 'Cannot create project'
          : 'Super Admin has not granted Create surveys on your profile',
        'error',
      )
      return
    }
    const title = newTitle.trim()
    if (!title) {
      onToast?.(`${Unit} name required`, 'error')
      return
    }
    if (isSuper) {
      const adminIds = Object.keys(checkedAdmins).filter((k) => checkedAdmins[k]).map(Number)
      if (adminIds.length === 0) {
        onToast?.('Select at least one Client Admin who is part of this project', 'error')
        return
      }
      if (!newCompany.trim()) {
        onToast?.('Enter the company name this project is mapped under', 'error')
        return
      }
    }
    setSaving(true)
    try {
      // Super Admin: project under company + share with Client Admins
      // Client Admin: survey under their own company (no company picker)
      const d = await createSurvey({
        title,
        questions: [],
        ...(canVoice ? { voice_required: Boolean(newVoiceRequired) } : {}),
        ...(isSuper ? { voice_time_limit: Number(newVoiceLimit) || 0 } : {}),
        ...(isSuper
          ? {
              company_name: newCompany.trim(),
              admin_ids: Object.keys(checkedAdmins).filter((k) => checkedAdmins[k]).map(Number),
            }
          : user?.company_name
            ? { company_name: String(user.company_name).trim() }
            : {}),
      })
      onToast?.(`${Unit} "${title}" created`, 'ok')
      setMode('list')
      setNewTitle('')
      setNewVoiceLimit(0)
      setNewVoiceRequired(false)
      setNewCompany('')
      setCheckedAdmins({})
      setExists(null)

      await load()
      if (d?.survey?.id) openDetail(d.survey.id)
    } catch (e) {
      if (e.status === 409 && e.existing_id) {
        onToast?.(`${Unit} "${title}" already exists — opening it`, 'warn')
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
    const maxQs = !isSuper ? Number(user?.max_questions_per_survey) || 0 : 0
    const otherSurveysQuestionsCount = surveys
      .filter((s) => Number(s.id) !== Number(detail.id))
      .reduce((sum, s) => sum + (Number(s.question_count) || 0), 0)
    const totalQuestionsUsed = otherSurveysQuestionsCount + (detail.questions || []).length
    if (maxQs > 0 && totalQuestionsUsed > maxQs) {
      onToast?.(`Total question quota exceeded: ${totalQuestionsUsed} questions used of ${maxQs} allotted across all surveys`, 'error')
      return
    }
    setSaving(true)
    try {
      await updateSurvey(detail.id, {
        title: detail.title,
        questions: cleanQuestions(detail.questions),
        display_lang: detail.display_lang === 'te' ? 'te' : 'en',
        ...(canVoice ? { voice_required: Boolean(detail.voice_required) } : {}),
        ...(isSuper ? { voice_time_limit: Number(detail.voice_time_limit) || 0 } : {}),
        ...(user?.role === 'super_admin' ? { company_name: detail.company_name || '' } : {}),
      })

      const hasAppTeam = (detail?.surveyors || []).length > 0
      onToast?.(
        hasAppTeam
          ? `${Unit} saved · pushed to mobile app`
          : `${Unit} questions saved`,
        'ok',
      )
      await openDetail(detail.id)
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function toggleAdmin(u) {
    if (!detail || user?.role !== 'super_admin') return
    setBusy(true)
    try {
      const ownerId = detail.owner_id != null ? Number(detail.owner_id) : null
      const on = (detail.admins || []).some((a) => Number(a.id) === Number(u.id))
      const next = on
        ? (detail.admins || []).filter((a) => Number(a.id) !== Number(u.id))
        : [...(detail.admins || []), { id: u.id, username: u.username, name: u.name || u.username }]
      // owner keeps access regardless — only shared (granted) admins go in the PUT
      const putIds = next.filter((a) => Number(a.id) !== ownerId).map((a) => Number(a.id))
      await setSurveyAdmins(detail.id, putIds)
      setDetail({ ...detail, admins: next, admin_count: next.length })
      onToast?.(`${u.username} ${on ? 'removed from' : 'granted'} access to this project`, 'ok')
      setAdminsOpen(false)
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function removeSurvey() {
    if (!canEdit) {
      onToast?.('Super Admin has not granted your account survey-editing rights', 'error')
      return
    }
    if (!detail || !window.confirm(`Delete project "${detail.title}"? Team assignments are removed too.`)) return
    setBusy(true)
    try {
      await deleteSurvey(detail.id)
      onToast?.(`${Unit} deleted`, 'ok')
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
          <h2>{isSuper ? 'New project' : 'New survey'}</h2>
          <button type="button" className="btn small" onClick={() => setMode('list')}>
            ← Back
          </button>
        </header>

        {!canCreate && (
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
            <Icon name="lock" size={13} /> <strong>{Units} are read-only for you.</strong>{' '}
            {isSuper
              ? 'You cannot create projects right now.'
              : (
                <>
                  Super Admin must grant <strong>Create surveys</strong> on your Client Admin
                  profile (Super Admin → Client Admins → Profile). Super Admin creates{' '}
                  <strong>Projects</strong>; you create <strong>Surveys</strong>.
                </>
              )}
          </div>
        )}
        <div className="card" style={{ marginBottom: 12 }}>
          <label className="field">
            <span>{Unit} name</span>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={
                isSuper ? 'e.g. Warangal Pre-poll 2026' : 'e.g. Assembly field survey — Ward 12'
              }
              autoFocus
              disabled={!canCreate}
            />
          </label>
          {!isSuper && user?.company_name ? (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              <Icon name="building" size={12} /> Your company: <strong>{user.company_name}</strong> (set by Super Admin — surveys
              are filed under this company).
            </p>
          ) : null}
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Filter existing {unit}s by name to avoid duplicates.
          </p>
          {exists && (
            <p className="toast warn" style={{ marginTop: 8 }}>
              "{exists.title}" already exists — saving opens it instead.
            </p>
          )}
          {!exists && nameMatches.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Existing {unit}s matching "{newTitle}":
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

        {user?.role === 'super_admin' && (
          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="building" size={15} /> Register company & Client Admins</h3>
            <label className="field">
              <span>Company name (project is mapped under this company)</span>
              <input
                value={newCompany}
                onChange={(e) => setNewCompany(e.target.value)}
                placeholder="e.g. Acme Research"
                list="registered-companies"
              />
            </label>
            <datalist id="registered-companies">
              {companyNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <p className="muted" style={{ fontSize: 12, margin: '12px 0 6px' }}>
              Client Admins who are <strong>part of this project</strong> (at least one)
              {Object.keys(checkedAdmins).filter((k) => checkedAdmins[k]).length > 0
                ? ` · ${Object.keys(checkedAdmins).filter((k) => checkedAdmins[k]).length} selected`
                : ''}:
            </p>
            {allAdmins.length === 0 ? (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                No Client Admin accounts yet — create them in the Client Admins tab first.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {allAdmins.map((u) => (
                  <label
                    key={u.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      background: checkedAdmins[String(u.id)] ? '#c8f5df' : 'rgba(15,23,42,0.05)',
                      border: checkedAdmins[String(u.id)] ? '1px solid #059669' : '1px solid #e2e8f0',
                      borderRadius: 8,
                      padding: '9px 12px',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!!checkedAdmins[String(u.id)]}
                      onChange={(e) =>
                        setCheckedAdmins((c) => ({ ...c, [String(u.id)]: e.target.checked }))
                      }
                    />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {u.name || u.username}
                      <span className="muted" style={{ fontWeight: 400 }}>
                        {' '}@{u.username}
                        {u.company_name ? ` · ${u.company_name}` : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            <p className="muted" style={{ fontSize: 11, margin: '8px 0 0' }}>
              Selected Client Admins get shared access and see this project under Surveys —
              the Super Admin remains the owner.
            </p>
          </div>
        )}

        {canVoice && (
        <div className="card" style={{ marginBottom: 12, padding: 14 }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>🎙 Voice recording</p>
          <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>
            {isSuper
              ? 'Off = no voice step on the phone. Required = GPS → photo → voice → questions.'
              : 'Required = mic lock in the field app. Off = surveyors never see voice.'}
          </p>

          <div style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4, color: '#475569' }}>
              Requirement:
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[
                { id: false, label: 'Off (not in field app)' },
                { id: true, label: 'Required (in field app)' },
              ].map((m) => (
                <button
                  key={String(m.id)}
                  type="button"
                  className={`chip ${Boolean(newVoiceRequired) === m.id ? 'selected' : ''}`}
                  onClick={() => setNewVoiceRequired(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {isSuper && (
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4, color: '#475569' }}>
              Minute limit (auto-stop):
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[
                { id: 0, label: 'No limit' },
                { id: 2, label: '2 min' },
                { id: 5, label: '5 min' },
                { id: 10, label: '10 min' },
                { id: 15, label: '15 min' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`chip ${Number(newVoiceLimit || 0) === t.id ? 'selected' : ''}`}
                  onClick={() => setNewVoiceLimit(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          )}
        </div>
        )}


        <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
          Questions are added after creating — open the project to edit them (name, questions). Assign surveyors from Surveyors → profile.
        </p>


        <button
          type="button"
          className="btn primary"
          onClick={saveNew}
          disabled={
            saving ||
            !newTitle.trim() ||
            !canEdit ||
            (user?.role === 'super_admin' &&
              (!newCompany.trim() ||
                Object.keys(checkedAdmins).filter((k) => checkedAdmins[k]).length === 0))
          }
        >
          {saving ? 'Creating…' : 'Create project'}
        </button>
      </div>
    )
  }

  if (mode === 'detail' && detail) {
    // Projects are mapped under a company: the owning Client Admin's company.
    const ownerCompany =
      (detail.admins || []).find((a) => Number(a.id) === Number(detail.owner_id))?.company_name ||
      null
    return (
      <div className="screen">
        <header className="screen-head">
          <h2>{Unit} · {detail.title}</h2>
          <button type="button" className="btn small" onClick={() => setMode('list')}>
            ← Back
          </button>
        </header>

        <div className="card" style={{ marginBottom: 12, borderLeft: '4px solid #00e599' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: '#059669', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <Icon name="lock" size={11} /> Project Name (Locked / Non-Editable)
            </span>
            <span style={{ fontSize: 11, color: '#64748b' }}>form_key: {detail.form_key}</span>
          </div>
          <h3 style={{ margin: '4px 0 8px', fontSize: 20, color: '#0f172a', fontWeight: 'bold' }}>
            {detail.title}
          </h3>
          {(isSuper || !!user?.can_web_survey) && detail.form_key && detail.form_key !== 'default' && detail.form_key !== 'legacy' ? (
            <CopyWebFillLink formKey={detail.form_key} title={detail.title} onToast={onToast} />
          ) : null}
          {user?.role === 'super_admin' && (
            <label className="field" style={{ marginTop: 8, maxWidth: 420 }}>
              <span>Company (project mapped under)</span>
              <input
                value={detail.company_name || ownerCompany || ''}
                onChange={(e) => setDetail({ ...detail, company_name: e.target.value })}
                placeholder="e.g. Acme Research"
                list="registered-companies"
              />
            </label>
          )}
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
            {user?.role === 'super_admin'
              ? `🏢 Home company: ${detail.company_name || ownerCompany || 'No company'} · ${(detail.admins || []).length} client admin(s) — ${(detail.admins || []).map((a) => `${a.company_name || 'No company'} · ${a.name || a.username}`).join(', ') || 'none connected yet'}`
              : <><Icon name="users" size={13} /> <strong>Field team:</strong>{' '}{(detail.surveyors || []).length > 0
                ? (detail.surveyors || []).map((s) => s.username || s.name).join(', ')
                : 'None yet — assign from Surveyors → open their profile'}</>}
          </p>
        </div>

        <h3 style={{ fontSize: 14, margin: '14px 0 6px', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="building" size={14} /> Client Admins connected to this project</h3>
        <div className="card" style={{ marginBottom: 12, padding: 12 }}>
          {user?.role === 'super_admin' ? (
            <>
              <button
                type="button"
                className="btn small primary"
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => setAdminsOpen((o) => !o)}
              >
                {(detail.admins || []).length > 0
                  ? `${detail.admins.length} client admin(s) have access — tap to edit`
                  : 'Share with client admins…'}
              </button>
              {adminsOpen && (
                <div
                  style={{
                    background: '#fff',
                    color: '#111',
                    border: '1px solid rgba(0,0,0,0.2)',
                    borderRadius: 12,
                    padding: 6,
                    maxHeight: 240,
                    overflowY: 'auto',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                  }}
                >
                  {allAdmins.length === 0 ? (
                    <p className="muted" style={{ fontSize: 12, margin: 6 }}>
                      No client admin accounts yet — create them in the Client Admins tab.
                    </p>
                  ) : (
                    allAdmins.map((u) => {
                      const isOwner = detail.owner_id != null && Number(u.id) === Number(detail.owner_id)
                      const on = (detail.admins || []).some((a) => Number(a.id) === Number(u.id))
                      return (
                        <button
                          key={u.id}
                          type="button"
                          disabled={busy || isOwner}
                          onClick={() => toggleAdmin(u)}
                          style={{
                            display: 'flex',
                            width: '100%',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            padding: '10px 12px',
                            border: 'none',
                            borderRadius: 8,
                            background: on ? '#ede9fe' : 'transparent',
                            color: '#111',
                            fontSize: 14,
                            fontWeight: 600,
                            cursor: isOwner ? 'default' : 'pointer',
                            opacity: isOwner ? 0.65 : 1,
                            textAlign: 'left',
                          }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {u.username}
                            {u.name && u.name !== u.username ? ` (${u.name})` : ''}
                            {u.company_name ? ` · ${u.company_name}` : ''}
                            {isOwner ? ' · owner' : ''}
                          </span>
                          {on ? (
                            <span style={{ color: '#7c3aed', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
                              <Icon name="check" size={14} />
                            </span>
                          ) : null}
                        </button>
                      )
                    })
                  )}
                  <button
                    type="button"
                    onClick={() => setAdminsOpen(false)}
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
              <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
                Projects are mapped under a company — this project's home company is{' '}
                <strong>{detail.company_name || ownerCompany || 'No company'}</strong>. Connect
                Client Admins by company to share it; surveyors are never connected or managed by
                Super Admin. Connected Client Admins see the project in their Projects tab.
              </p>
            </>
          ) : (
            <p style={{ fontSize: 13, margin: 0 }}>
              {(detail.admins || []).length > 0
                ? `👥 ${detail.admins.length} client admin(s) can access this project — ${detail.admins.map((a) => a.name || a.username).join(', ')}`
                : '👥 No other client admins have access to this project.'}
              {detail.owner && (
                <span className="muted"> · owner: {detail.owner}</span>
              )}
            </p>
          )}
        </div>

        <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
          Survey questions — add/edit here. Options support text, choice, Yes/No, A·B·C·D,
          sentiment (Positive/Neutral/Negative) and age (auto ranges in report).
        </p>

        <h3 style={{ fontSize: 14, margin: '14px 0 6px' }}>Survey questions</h3>
        <div className="card" style={{ marginBottom: 12, padding: 14 }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>
            Display language (phone, dashboard, export)
          </p>
          <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>
            Type questions in English. Add Telugu under each question. This switch is what the
            field app, dashboard, and CSV use.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {[
              { id: 'en', label: 'English' },
              { id: 'te', label: 'తెలుగు' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                className={`chip ${(detail.display_lang || 'en') === p.id ? 'selected' : ''}`}
                disabled={p.id === 'te' && !canTeluguQuestions(user)}
                title={p.id === 'te' && !canTeluguQuestions(user) ? 'Telugu translation is locked — Super Admin must grant it' : undefined}
                onClick={() => {
                  if (p.id === 'te' && !canTeluguQuestions(user)) return
                  setDetail({ ...detail, display_lang: p.id })
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="card" style={{ marginBottom: 12, padding: 14 }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>🎙 Voice recording configuration</p>
          <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>
            {isSuper
              ? 'Off = no voice step on the phone. Required = GPS → photo → voice → questions. Minute limit is Super Admin only.'
              : canVoice
                ? 'Required = mic lock in the field app. Off = surveyors never see voice. Minute limits are set by Super Admin.'
                : 'Voice is set by Super Admin. Off means the field app has no voice step.'}
          </p>

          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6, color: '#475569' }}>
              Requirement:
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[
                { id: false, label: 'Off (not in field app)' },
                { id: true, label: 'Required (in field app)' },
              ].map((m) => (
                <button
                  key={String(m.id)}
                  type="button"
                  className={`chip ${Boolean(detail.voice_required) === m.id ? 'selected' : ''}`}
                  disabled={!canVoice}
                  onClick={() => canVoice && setDetail({ ...detail, voice_required: m.id })}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {isSuper && (
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6, color: '#475569' }}>
              Minute limit (auto-stop):
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[
                { id: 0, label: 'No limit' },
                { id: 2, label: '2 min' },
                { id: 5, label: '5 min' },
                { id: 10, label: '10 min' },
                { id: 15, label: '15 min' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`chip ${Number(detail.voice_time_limit || 0) === t.id ? 'selected' : ''}`}
                  onClick={() => setDetail({ ...detail, voice_time_limit: t.id })}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          )}
        </div>

        <QuestionEditor
          questions={detail.questions || []}
          onChange={(qs) => setDetail({ ...detail, questions: qs })}
          onToast={onToast}
          canTelugu={canTeluguQuestions(user)}
          displayLang={detail.display_lang === 'te' ? 'te' : 'en'}
          maxQs={!isSuper ? Number(user?.max_questions_per_survey) || 0 : 0}
          otherQuestionsCount={surveys
            .filter((s) => Number(s.id) !== Number(detail.id))
            .reduce((sum, s) => sum + (Number(s.question_count) || 0), 0)}
        />

        <button
          type="button"
          className="btn primary"
          onClick={saveDetailChanges}
          disabled={saving || busy}
        >
          {saving
            ? ((detail.surveyors || []).length > 0 ? 'Saving & Pushing…' : 'Saving…')
            : (detail.surveyors || []).length > 0
              ? (isSuper ? 'Save project & push to app' : 'Save & push to app')
              : 'Save questions'}
        </button>
        <button
          type="button"
          className="btn danger"
          onClick={removeSurvey}
          disabled={busy}
          style={{ marginLeft: 8 }}
        >
          Delete project
        </button>
      </div>
    )
  }

  const renderCard = (s) => {
    const mine = Number(s.created_by) === Number(user?.id)
    const sharedProject =
      !isSuper && !mine && (s.company_name || s.owner_company || s.admin_count > 0)
    return (
    <div
      key={s.id}
      className="card"
      style={{
        marginBottom: 10,
        padding: 14,
        borderLeft: `4px solid ${sharedProject ? '#7c3aed' : '#00e599'}`,
      }}
    >
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
        {(isSuper || !!user?.can_web_survey) && (
          <CopyWebFillLink compact formKey={s.form_key} title={s.title} onToast={onToast} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 16, color: '#0f172a' }}>{s.title}</strong>
            {sharedProject ? (
              <span
                className="pill"
                style={{
                  background: 'rgba(124, 58, 237, 0.12)',
                  color: '#5b21b6',
                  fontWeight: 700,
                  fontSize: 11,
                }}
              >
                Super Admin project · {s.company_name || user?.company_name || 'company'}
              </span>
            ) : !isSuper ? (
              <span
                className="pill"
                style={{
                  background: 'rgba(0, 229, 153, 0.12)',
                  color: '#047857',
                  fontWeight: 700,
                  fontSize: 11,
                }}
              >
                Your survey
              </span>
            ) : null}
          </div>
          {user?.role === 'super_admin' && (
            <div style={{ fontSize: 13, color: '#334155', fontWeight: 600, marginTop: 3 }}>
              <Icon name="building" size={13} /> {s.company_name || s.owner_company || 'No company'}
              {s.owner_name ? ` · owned by ${s.owner_name}` : ''}
            </div>
          )}
          {user?.role !== 'super_admin' && (
            <div style={{ fontSize: 13, color: '#38bdf8', fontWeight: 'bold', marginTop: 3 }}>
              <Icon name="users" size={13} /> Field team: {s.surveyor_names || 'none'} ·
              assign from Surveyors → profile
            </div>
          )}
          <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
            {Number(s.submissions) > 0 ? (
              <>
                <Icon name="chart" size={12} /> {s.submissions} Submissions
                {Number(s.web_submissions) > 0 ? ` · ${s.web_submissions} web` : ''}
                {' · '}
              </>
            ) : null}
            <Icon name="clipboard" size={12} /> {s.question_count || 0} Questions
            {s.voice_required ? ' · Voice required' : ' · Voice off'}
            {' · Updated '}
            {String(s.updated_at || '').slice(0, 16).replace('T', ' ')}
          </div>
          {isSuper && s.admin_count > 0 && (
            <div className="muted" style={{ fontSize: 12, marginTop: 3, color: '#7c3aed' }}>
              <Icon name="building" size={12} /> {s.admin_count} client admin(s) connected
              {s.admin_names ? ` — ${s.admin_names}` : ''}
            </div>
          )}
          {sharedProject && (
            <div className="muted" style={{ fontSize: 12, marginTop: 3, color: '#5b21b6' }}>
              Created by Super Admin for company {s.company_name || user?.company_name || '—'}. You can
              open and run field work; you did not create this as your own survey.
            </div>
          )}
        </div>
      </div>
    </div>
    )
  }

  const visibleSurveys = surveys.filter((s) => {
    if (isSuper) return true
    const questions = Number(s.question_count) || 0
    const subs = Number(s.submissions) || 0
    const team = Number(s.surveyors) || 0
    const names = String(s.surveyor_names || '').trim()
    if (!questions && !subs && !team && !names) return false
    return true
  })

  return (
    <div className="screen">
      <header className="screen-head">
        <h2>{Units}</h2>
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
          {isSuper
            ? 'Super Admin creates Projects and maps them to companies & Client Admins.'
            : 'Client Admin creates Surveys under your company. Copy web link: pick how many responses, then the URL expires.'}
        </p>
        <button
          type="button"
          className="btn"
          onClick={() => load()}
          disabled={loading}
          style={{ marginRight: 8 }}
        >
          ⟳ Refresh
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!canCreate}
          title={
            canCreate
              ? undefined
              : 'Ask Super Admin to grant Create surveys on your profile'
          }
          onClick={() => {
            setNewTitle('')
            setNewCompany('')
            setCheckedAdmins({})
            setExists(null)
            setMode('create')
          }}
        >
          + New {unit}
        </button>
      </header>

      <div className="card" style={{ marginBottom: 12 }}>
        <label className="field">
          <span>Filter by {unit} name</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Type a ${unit} name…`}
          />
        </label>
      </div>

      {loading && <p className="muted">Loading projects…</p>}

      {!loading && visibleSurveys.length === 0 && (
        <p className="muted">
          {search
            ? `No ${unit}s match that name.`
            : `No ${unit}s yet — click "+ New ${unit}".`}
        </p>
      )}

      {user?.role === 'super_admin' && visibleSurveys.length > 0 ? (
        <>
          {Object.entries(
            visibleSurveys.reduce((acc, s) => {
              const c = s.company_name || s.owner_company || 'No company'
              ;(acc[c] = acc[c] || []).push(s)
              return acc
            }, {})
          ).map(([company, items]) => (
            <div key={company}>
              <h3 style={{ fontSize: 14, margin: '16px 0 8px', color: '#334155' }}>
                <Icon name="building" size={14} /> {company}
                <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                  {' '}· {items.length} project{items.length === 1 ? '' : 's'}
                </span>
              </h3>
              {items.map(renderCard)}
            </div>
          ))}
        </>
      ) : (
        visibleSurveys.map(renderCard)
      )}
    </div>
  )
}
