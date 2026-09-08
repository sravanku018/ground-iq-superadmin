import { useEffect, useMemo, useState } from 'react'
import { deleteSubmission, getQuestions, getStoredUser, getSurvey, listSurveys, updateSubmission } from './api'
import SubmissionMedia from './SubmissionMedia'
import { getQuestionAliases, getQuestionDisplayLabel, resolveAnswerValue, slugQuestionKey } from './questionKey'

function issuesToText(v) {
  if (Array.isArray(v)) return v.join(', ')
  if (v == null) return ''
  return String(v)
}

// Fix 1: Convert string back to an array to match backend expectations
function textToIssues(s) {
  const t = String(s || '').trim()
  if (!t) return []
  return t.split(',').map(i => i.trim()).filter(Boolean)
}

// Fix 2: Humanize unmatched keys (e.g. "respondent_age" -> "Respondent Age")
function humanizeKey(key) {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Handle camelCase
    .replace(/\b\w/g, c => c.toUpperCase()) // Capitalize words
    .trim()
}

/**
 * Client Admin full edit form for one survey submission with full question titles and web survey support.
 */
export default function SubmissionEditor({ item, questions: propQuestions, onSaved, onDeleted, onCancel, onToast }) {
  const initialAnswers = item?.answers || {}
  const [answers, setAnswers] = useState(() => {
    const a = { ...initialAnswers }
    if (a.issues != null) a.issues = issuesToText(a.issues)
    return a
  })
  const [surveyQs, setSurveyQs] = useState(() => propQuestions || item?.questions || [])
  const [allKnownQs, setAllKnownQs] = useState([])
  const [submittedBy, setSubmittedBy] = useState(item?.submitted_by || '')
  const [status, setStatus] = useState(item?.status || 'pending')
  const [lat, setLat] = useState(
    item?.geo?.lat ?? item?.verification?.geo?.lat ?? '',
  )
  const [lng, setLng] = useState(
    item?.geo?.lng ?? item?.verification?.geo?.lng ?? '',
  )
  const [note, setNote] = useState('')
  const [force, setForce] = useState(false)
  const [hasAudio, setHasAudio] = useState(!!item?.has_voice || !!item?.has_audio)
  const [hasPhoto, setHasPhoto] = useState(!!item?.has_photo)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isWeb =
    item?.source === 'web-survey' ||
    item?.source === 'web' ||
    item?.payload?.source === 'web-survey' ||
    item?.payload?.source === 'web' ||
    item?.submitted_by === 'Web' ||
    item?.submitted_by === 'web'

  // Fix 3: Changed dependency to [item] so form updates when parent passes new object
  useEffect(() => {
    const a = { ...item?.answers }
    if (a.issues != null) a.issues = issuesToText(a.issues)
    setAnswers(a)
    setSubmittedBy(item?.submitted_by || '')
    setStatus(item?.status || 'pending')
    setLat(item?.geo?.lat ?? item?.verification?.geo?.lat ?? '')
    setLng(item?.geo?.lng ?? item?.verification?.geo?.lng ?? '')
    setHasAudio(!!item?.has_voice || !!item?.has_audio)
    setHasPhoto(!!item?.has_photo)
    setNote('')
    setForce(false)
  }, [item])

  useEffect(() => {
    let dead = false
    Promise.all([
      listSurveys().catch(() => ({ items: [] })),
      getQuestions().catch(() => ({ questions: [] })),
    ]).then(([d, gq]) => {
      if (dead) return
      const list = []
      if (Array.isArray(gq?.questions)) list.push(...gq.questions)
      for (const s of d?.items || []) {
        if (Array.isArray(s.questions)) list.push(...s.questions)
      }
      setAllKnownQs(list)
    })
    return () => {
      dead = true
    }
  }, [])

  useEffect(() => {
    if (propQuestions?.length) {
      setSurveyQs(propQuestions)
      return
    }
    const fk = item?.form_key || item?.payload?.form_key || item?.form_id
    let dead = false
    const fetcher =
      !fk || fk === 'default' || fk === 'legacy'
        ? getQuestions().then((d) => d?.questions || [])
        : getSurvey(fk).then((d) => (Array.isArray(d?.survey?.questions) ? d.survey.questions : []))
    fetcher
      .then((qs) => {
        if (dead) return
        if (qs && qs.length) setSurveyQs(qs)
      })
      .catch(() => {})
    return () => {
      dead = true
    }
  }, [item?.form_key, item?.payload?.form_key, item?.form_id, propQuestions])

  function setField(key, value) {
    setAnswers((prev) => ({ ...prev, [key]: value }))
  }

  // Build the list of fields to render with proper question labels
  const renderedFields = useMemo(() => {
    const fields = []
    const renderedKeys = new Set()

    const qLookup = new Map()
    const allQuestions = [...allKnownQs, ...(surveyQs || [])]
    allQuestions.forEach((q, idx) => {
      const qIndex = idx + 1
      if (q.id) {
        qLookup.set(String(q.id).toLowerCase(), q)
        const m = String(q.id).match(/^q_?(\d+)$/i)
        if (m) {
          qLookup.set(`q_${m[1]}`, q)
          qLookup.set(`q${m[1]}`, q)
        }
      }
      qLookup.set(`q_${qIndex}`, q)
      qLookup.set(`q${qIndex}`, q)
      if (q.label) {
        qLookup.set(slugQuestionKey(q.label), q)
        qLookup.set(String(q.label).toLowerCase(), q)
      }
    })

    // 1. Survey defined questions
    if (surveyQs && surveyQs.length > 0) {
      for (let idx = 0; idx < surveyQs.length; idx++) {
        const q = surveyQs[idx]
        const qIndex = idx + 1
        const id = String(q.id || `q_${qIndex}`).trim()
        if (!id) continue
        const aliases = getQuestionAliases(q, qIndex)
        for (const al of aliases) {
          renderedKeys.add(al)
          renderedKeys.add(String(al).toLowerCase())
          renderedKeys.add(slugQuestionKey(al))
        }
        renderedKeys.add(id)
        if (q.id) renderedKeys.add(q.id)
        if (q.label) renderedKeys.add(slugQuestionKey(q.label))

        const val = resolveAnswerValue(answers, q, qIndex)
        const displayLabel = getQuestionDisplayLabel(q, qIndex)

        fields.push({
          key: id,
          label: displayLabel,
          rawLabel: q.label || q.label_te || id,
          label_te: q.label_te && q.label_te !== q.label ? q.label_te : null,
          required: Boolean(q.required),
          type: q.type === 'textarea' || (typeof val === 'string' && val.length > 60) ? 'textarea' : 'text',
          value: Array.isArray(val) ? val.join(', ') : String(val ?? ''),
          isSurveyQ: true,
        })
      }
    }

    // 2. Any additional answered fields
    const extraEntries = Object.entries(answers || {})
      .filter(([k, v]) => !k.startsWith('_') && k !== 'data_collector' && v != null && v !== '')
      .sort(([k1], [k2]) => k1.localeCompare(k2, undefined, { numeric: true, sensitivity: 'base' }))

    for (const [k, v] of extraEntries) {
      if (renderedKeys.has(k) || renderedKeys.has(String(k).toLowerCase()) || renderedKeys.has(slugQuestionKey(k))) continue
      const matched = qLookup.get(String(k).toLowerCase()) || qLookup.get(slugQuestionKey(k))
      renderedKeys.add(k)
      fields.push({
        key: k,
        // Fix 2: Use humanizeKey as a fallback instead of ugly "[Unmatched Field: ...]"
        label: matched?.label || matched?.label_te || humanizeKey(k),
        label_te: matched?.label_te || null,
        required: false,
        type: typeof v === 'string' && v.length > 60 ? 'textarea' : 'text',
        value: Array.isArray(v) ? v.join(', ') : String(v ?? ''),
        isSurveyQ: Boolean(matched),
      })
    }

    return fields
  }, [surveyQs, allKnownQs, answers])

  async function save() {
    setSaving(true)
    try {
      const cleanAnswers = { ...answers }
      for (let idx = 0; idx < (surveyQs || []).length; idx++) {
        const q = surveyQs[idx]
        const qIndex = idx + 1
        const id = String(q.id || `q_${qIndex}`).trim()
        if (!id) continue
        if (cleanAnswers[id] === undefined || cleanAnswers[id] === '') {
          const v = resolveAnswerValue(cleanAnswers, q, qIndex)
          if (v !== '') cleanAnswers[id] = v
        }
        // Remove legacy aliases so they don't linger
        const aliases = getQuestionAliases(q, qIndex)
        for (const al of aliases) {
          if (al !== id && al !== q.id && al !== slugQuestionKey(q.label || '')) {
            delete cleanAnswers[al]
          }
        }
      }


      const body = {
        answers: cleanAnswers,
        submitted_by: submittedBy.trim() || undefined,
        status,
        note: note.trim() || undefined,
        force: force || undefined,
        has_audio: isWeb ? false : hasAudio,
        has_photo: isWeb ? false : hasPhoto,
      }

      if (body.answers.issues != null) {
        body.answers.issues = textToIssues(body.answers.issues)
      }
      const latN = Number(lat)
      const lngN = Number(lng)
      if (Number.isFinite(latN) && Number.isFinite(lngN) && !(latN === 0 && lngN === 0)) {
        body.geo = { lat: latN, lng: lngN, source: 'admin_edit' }
      }

      const res = await updateSubmission(item.id, body)
      onToast?.(
        `Saved #${item.id}${res.changed?.length ? ` · ${res.changed.length} fields` : ''}`,
        'ok',
      )
      onSaved?.(res)
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (
      !confirm(
        `Delete survey #${item.id}? This cannot be undone. Media linked to it will also be removed.`,
      )
    ) {
      return
    }
    setDeleting(true)
    try {
      await deleteSubmission(item.id)
      onToast?.(`Deleted #${item.id}`, 'ok')
      onDeleted?.(item.id)
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="submission-editor card" style={{ marginTop: 10 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <h4 style={{ margin: 0 }}>
          Edit {isWeb ? 'web survey' : 'survey'} #{item.id}
        </h4>
        {onCancel && (
          <button type="button" className="btn small" onClick={onCancel}>
            Close
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Client Admin can correct answers, surveyor, geo, and status. Changes are logged.
      </p>

      {!isWeb && item?.id ? <SubmissionMedia item={item} /> : null}

      <label className="field compact">
        <span>Surveyor (submitted_by)</span>
        <input
          value={submittedBy}
          onChange={(e) => setSubmittedBy(e.target.value)}
          placeholder="username"
        />
      </label>

      <label className="field compact">
        <span>Status</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">pending</option>
          <option value="confirmed">confirmed</option>
          <option value="rejected">rejected</option>
        </select>
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label className="field compact">
          <span>Geo lat</span>
          <input
            type="number"
            step="any"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="17.38"
          />
        </label>
        <label className="field compact">
          <span>Geo lng</span>
          <input
            type="number"
            step="any"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            placeholder="78.48"
          />
        </label>
      </div>

      {!isWeb && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '8px 0 12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={hasAudio}
              onChange={(e) => setHasAudio(e.target.checked)}
            />
            Has voice
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={hasPhoto}
              onChange={(e) => setHasPhoto(e.target.checked)}
            />
            Has photo
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
            Force confirm if incomplete
          </label>
        </div>
      )}

      <h4 style={{ margin: '12px 0 8px', fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
        Survey Questions &amp; Answers
      </h4>

      {renderedFields.map((f) => (
        <label key={f.key} className="field compact" style={{ marginBottom: 8 }}>
          <span style={{ fontWeight: 600, color: '#1e293b' }}>
            {f.label}
            {f.required ? <span style={{ color: '#ef4444' }}> *</span> : ''}
          </span>
          {f.label_te && (
            <span className="muted" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>
              {f.label_te}
            </span>
          )}
          {f.type === 'textarea' ? (
            <textarea
              rows={2}
              value={answers[f.key] ?? f.value ?? ''}
              onChange={(e) => setField(f.key, e.target.value)}
            />
          ) : (
            <input
              value={answers[f.key] ?? f.value ?? ''}
              onChange={(e) => setField(f.key, e.target.value)}
            />
          )}
        </label>
      ))}

      <label className="field compact" style={{ marginTop: 10 }}>
        <span>Edit note (optional)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why was this corrected?"
        />
      </label>

      <div className="user-actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn primary"
          disabled={saving || deleting}
          onClick={save}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {getStoredUser()?.role === 'super_admin' && (
          <button
            type="button"
            className="btn danger"
            disabled={saving || deleting}
            onClick={remove}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        )}
        {onCancel && (
          <button type="button" className="btn" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
