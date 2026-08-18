import { useCallback, useEffect, useState } from 'react'
import Icon from './Icons'
import { getAuditLog } from './api'

const ACTION_LABELS = {
  login: { icon: 'key', text: 'Login' },
  user_create: { icon: 'user', text: 'User created' },
  users_bulk_create: { icon: 'users', text: 'Surveyors bulk-created' },
  user_delete: { icon: 'trash', text: 'User deleted' },
  super_admin_create: { icon: 'star', text: 'Super Admin created' },
  super_admin_reset: { icon: 'star', text: 'Super Admin password reset' },
  survey_create: { icon: 'clipboard', text: 'Survey created' },
  survey_update: { icon: 'clipboard', text: 'Survey updated' },
  survey_delete: { icon: 'clipboard', text: 'Survey deleted' },
  submission_status: { icon: 'check', text: 'Review decision' },
  data_export: { icon: 'download', text: 'Data export' },
  question_bank_create: { icon: 'book', text: 'Template created' },
  question_bank_update: { icon: 'book', text: 'Template updated' },
  question_bank_delete: { icon: 'book', text: 'Template deleted' },
  question_bank_copy: { icon: 'book', text: 'Template → survey' },
  seat_request_submit: { icon: 'chair', text: 'Seat upgrade requested' },
  seat_request_approve: { icon: 'chair', text: 'Seat upgrade approved' },
  seat_request_deny: { icon: 'chair', text: 'Seat upgrade denied' },
}

const ENTITY_LABELS = {
  user: 'Accounts',
  survey: 'Surveys',
  submission: 'Submissions',
  export: 'Data export',
  question_bank: 'Question bank',
  seat_limit_requests: 'Seat requests',
}

function fmtTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function metaSummary(meta) {
  if (!meta || typeof meta !== 'object') return ''
  const parts = []
  if (meta.username) parts.push(`@${meta.username}`)
  if (meta.status) parts.push(`→ ${meta.status}`)
  if (meta.count != null) parts.push(`${meta.count} users`)
  if (meta.questions != null) parts.push(`${meta.questions} questions`)
  if (meta.requested_limit != null) parts.push(`limit → ${meta.requested_limit}`)
  if (meta.is_global) parts.push('global')
  if (meta.expected_role) parts.push(`as ${meta.expected_role}`)
  if (meta.rows != null) parts.push(`${meta.rows} rows`)
  return parts.join(' · ')
}

export default function AdminAuditScreen({ onToast }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [entity, setEntity] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getAuditLog({ action, actor, entity, limit: 200 })
      setEntries(data.entries || [])
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [action, actor, entity, onToast])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="screen">
      <header className="screen-head">
        <h2>Super Admin · Audit Log</h2>
        <p>
          Platform-wide trail of every administrative action, per actor account (FR-AUD-01/02) —
          logins, account changes, review decisions, exports, question-bank and seat-limit actions.
        </p>
      </header>

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field compact" style={{ flex: 1, minWidth: 180 }}>
            <span>Action</span>
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">All actions</option>
              {Object.entries(ACTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.text}
                </option>
              ))}
            </select>
          </label>
          <label className="field compact" style={{ flex: 1, minWidth: 150 }}>
            <span>Actor</span>
            <input
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              placeholder="username…"
            />
          </label>
          <label className="field compact" style={{ flex: 1, minWidth: 150 }}>
            <span>Entity</span>
            <select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">All entities</option>
              {Object.entries(ENTITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn small primary" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading audit trail…</p>
      ) : entries.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No audit entries match. The trail starts recording from this deploy onward.
          </p>
        </div>
      ) : (
        entries.map((e) => (
          <div
            key={e.id}
            className="card"
            style={{
              marginBottom: 8,
              padding: '10px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              borderLeft: '4px solid #38bdf8',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  {ACTION_LABELS[e.action] ? (
                    <>
                      <Icon name={ACTION_LABELS[e.action].icon} size={12} />
                      {ACTION_LABELS[e.action].text}
                    </>
                  ) : (
                    e.action
                  )}
                </strong>
                <span
                  className="pill ok"
                  style={{ fontSize: 11, fontWeight: 'bold' }}
                >
                  {e.entity_type ? ENTITY_LABELS[e.entity_type] || e.entity_type : 'platform'}
                </span>
                {e.entity_id && (
                  <span className="pill" style={{ fontSize: 11 }}>#{e.entity_id}</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
                {e.actor_name || e.actor_role || 'system'} · {e.actor_role}
                {metaSummary(e.meta) ? ` · ${metaSummary(e.meta)}` : ''}
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', textAlign: 'right' }}>
              {fmtTime(e.created_at)}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
