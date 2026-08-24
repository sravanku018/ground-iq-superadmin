import { useEffect, useMemo, useState } from 'react'
import { deleteSubmission, updateSubmission } from './api'
import SubmissionMedia from './SubmissionMedia'

/** Core fields Client Admin can always edit */
const CORE_FIELDS = [
  { key: 'respondent_name', label: 'Respondent name' },
  { key: 'district', label: 'District' },
  { key: 'constituency', label: 'Assembly constituency' },
  { key: 'mp_constituency', label: 'MP constituency' },
  { key: 'mandal', label: 'Mandal' },
  { key: 'ward', label: 'Ward / booth' },
  { key: 'gender', label: 'Gender' },
  { key: 'caste', label: 'Caste' },
  { key: 'age', label: 'Age group' },
  { key: 'employment', label: 'Occupation' },
  { key: 'education', label: 'Education' },
  { key: 'winning_party', label: 'Winning party' },
  { key: 'pm_preference', label: 'PM preference' },
  { key: 'performance', label: 'Govt performance' },
  { key: 'issues', label: 'Issues' },
  { key: 'notes', label: 'Notes' },
]

function issuesToText(v) {
  if (Array.isArray(v)) return v.join(', ')
  if (v == null) return ''
  return String(v)
}

function textToIssues(s) {
  const t = String(s || '').trim()
  if (!t) return ''
  return t
}

/**
 * Client Admin full edit form for one survey submission.
 */
export default function SubmissionEditor({ item, onSaved, onDeleted, onCancel, onToast }) {
  const initialAnswers = item?.answers || {}
  const [answers, setAnswers] = useState(() => {
    const a = { ...initialAnswers }
    if (a.issues != null) a.issues = issuesToText(a.issues)
    return a
  })
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
  }, [item?.id])

  const extraKeys = useMemo(() => {
    const core = new Set(CORE_FIELDS.map((f) => f.key))
    return Object.keys(answers || {}).filter((k) => !core.has(k) && k !== 'data_collector')
  }, [answers])

  function setField(key, value) {
    setAnswers((prev) => ({ ...prev, [key]: value }))
  }

  async function save() {
    setSaving(true)
    try {
      const body = {
        answers: { ...answers },
        submitted_by: submittedBy.trim() || undefined,
        status,
        note: note.trim() || undefined,
        force: force || undefined,
        has_audio: hasAudio,
        has_photo: hasPhoto,
      }
      // Normalize issues to string (server accepts string)
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
        <h4 style={{ margin: 0 }}>Edit survey #{item.id}</h4>
        {onCancel && (
          <button type="button" className="btn small" onClick={onCancel}>
            Close
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Client Admin can correct answers, surveyor, geo, and status. Changes are logged.
      </p>

      {item?.id ? <SubmissionMedia item={item} /> : null}

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

      <h4 style={{ margin: '8px 0 6px', fontSize: 13 }}>Answers</h4>
      {CORE_FIELDS.map((f) => (
        <label key={f.key} className="field compact">
          <span>{f.label}</span>
          {f.key === 'notes' || f.key === 'issues' ? (
            <textarea
              rows={2}
              value={answers[f.key] ?? ''}
              onChange={(e) => setField(f.key, e.target.value)}
            />
          ) : (
            <input
              value={answers[f.key] ?? ''}
              onChange={(e) => setField(f.key, e.target.value)}
            />
          )}
        </label>
      ))}

      {extraKeys.map((k) => (
        <label key={k} className="field compact">
          <span>{k}</span>
          <input
            value={
              Array.isArray(answers[k])
                ? answers[k].join(', ')
                : (answers[k] ?? '')
            }
            onChange={(e) => setField(k, e.target.value)}
          />
        </label>
      ))}

      <label className="field compact">
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
        <button
          type="button"
          className="btn danger"
          disabled={saving || deleting}
          onClick={remove}
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
        {onCancel && (
          <button type="button" className="btn" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
