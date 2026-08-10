import { useCallback, useEffect, useState } from 'react'
import {
  createUser,
  deleteUser,
  disableUser,
  enableUser,
  getSeatRequests,
  getStoredUser,
  listUsers,
  updateUser,
} from './api'
import VerifiedBadge from './VerifiedBadge'

/** Grant-based powers (least privilege): Super Admin grants/revokes each per Client Admin. */
const POWER_DEFS = [
  { key: 'can_manage_questions', label: 'Q-Bank', icon: '📚' },
  { key: 'can_edit_surveys', label: 'Survey questions', icon: '▤' },
  { key: 'can_review_data', label: 'Data review', icon: '✓' },
  { key: 'can_verify_surveyors', label: 'Verify surveyors', icon: '🛡' },
  { key: 'can_crud_questionnaire', label: 'CRUD questionnaire', icon: '🗂' },
  { key: 'can_validate_proof', label: 'Proof validation', icon: '📞' },
]

const EMPTY_FORM = { username: '', name: '', password: '' }

export default function AdminClientAdminsScreen({ onToast }) {
  const me = getStoredUser()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [seatData, setSeatData] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [edit, setEdit] = useState(EMPTY_FORM)
  const [form, setForm] = useState(EMPTY_FORM)
  const [created, setCreated] = useState(null)
  const [maxQInputs, setMaxQInputs] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [data, seats] = await Promise.all([
        listUsers(),
        getSeatRequests().catch(() => null),
      ])
      setUsers(data.users || [])
      if (seats) setSeatData(seats)
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [onToast])

  useEffect(() => {
    load()
  }, [load])

  const admins = users.filter((u) => u.role === 'admin')
  const powersOf = (u) => POWER_DEFS.filter((p) => u[p.key])
  const canVerify = me?.role === 'super_admin' || !!me?.can_verify_surveyors

  const approvedLimit = seatData?.limits?.approved_limit != null
    ? Number(seatData.limits.approved_limit)
    : 5
  const currentAdmins = seatData?.current_admins ?? admins.length
  const seatPending = (seatData?.requests || []).filter((r) => r.status === 'pending')

  const togglePower = async (u, key, label) => {
    setSaving(true)
    try {
      const next = !u[key]
      await updateUser(u.id, { [key]: next })
      onToast?.(`${label} ${next ? 'granted' : 'revoked'} for ${u.name || u.username}`, 'ok')
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const saveMaxQuestions = async (u) => {
    const next = maxQInputs[u.id] != null ? Number(maxQInputs[u.id]) : (u.max_questions_per_survey ?? 0)
    setSaving(true)
    try {
      await updateUser(u.id, { max_questions_per_survey: Math.max(0, next) })
      onToast?.(
        next > 0
          ? `Cap set · @${u.username} max ${next} questions per survey`
          : `Cap cleared · @${u.username} unlimited questions per survey`,
        'ok',
      )
      setMaxQInputs((m) => ({ ...m, [u.id]: undefined }))
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    const typedUser = form.username.trim()
    if (!typedUser) {
      onToast?.('Enter a username', 'error')
      return
    }
    if (!form.password || form.password.length < 8) {
      onToast?.('Password must be at least 8 characters', 'error')
      return
    }
    setSaving(true)
    try {
      const res = await createUser({
        username: typedUser,
        password: form.password,
        name: (form.name || typedUser).trim(),
        role: 'admin',
        target_quota: 0,
      })
      const createdUser = res?.user || {}
      const loginName = String(createdUser.username || typedUser).trim().toLowerCase()
      onToast?.(`Client Admin created · username: ${loginName}`, 'ok')
      setCreated({
        username: loginName,
        password: form.password,
        name: createdUser.name || form.name || loginName,
      })
      setForm(EMPTY_FORM)
      await load()
    } catch (err) {
      onToast?.(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  function openEdit(u) {
    setEditingId(u.id)
    setEdit({ username: u.username || '', name: u.name || u.display_name || '', password: '' })
  }

  function closeEdit() {
    setEditingId(null)
    setEdit(EMPTY_FORM)
  }

  async function saveEdit(u) {
    setSaving(true)
    try {
      const body = {
        username: edit.username.trim().toLowerCase(),
        name: edit.name.trim(),
      }
      if (edit.password.trim()) body.password = edit.password.trim()
      const res = await updateUser(u.id, body)
      const parts = ['Saved']
      if (res.username_changed) parts.push('username updated')
      if (res.password_changed) parts.push('password updated · sessions revoked')
      onToast?.(parts.join(' · '), 'ok')
      if (res.password_changed && res.plain_password) {
        setCreated({
          username: res.user?.username || body.username,
          password: res.plain_password,
          name: res.user?.name || body.name,
        })
      }
      closeEdit()
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleVerify(u) {
    if (!canVerify) {
      onToast?.('Only Super Admin can verify client admin accounts', 'error')
      return
    }
    try {
      const next = !u.verified
      await updateUser(u.id, { verified: next })
      onToast?.(`Client Admin @${u.username} ${next ? 'Verified ✓' : 'Unverified'}`, 'ok')
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    }
  }

  async function handleDisable(u) {
    if (!confirm(`Disable @${u.username}? They cannot log into the portal. Active sessions will be revoked.`)) return
    try {
      await disableUser(u.id)
      onToast?.(`Disabled @${u.username} · access revoked`, 'ok')
      if (editingId === u.id) closeEdit()
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    }
  }

  async function handleEnable(u) {
    try {
      await enableUser(u.id)
      onToast?.(`Enabled @${u.username} · portal login OK`, 'ok')
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    }
  }

  async function handleDelete(u) {
    if (!confirm(`DELETE @${u.username} permanently? Prefer Disable. This cannot be undone.`)) return
    try {
      await deleteUser(u.id)
      onToast?.(`Deleted @${u.username}`, 'ok')
      if (editingId === u.id) closeEdit()
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    }
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h2>✦ Client Admins</h2>
        <p>
          Client Admin accounts for the main portal — grant powers, verify identity, manage
          access (BR-006 / FR-USR-10).
        </p>
      </header>

      {/* Compact seat + pending summary */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="stat-row" style={{ marginBottom: 10 }}>
          <div className="stat">
            <strong>{admins.length}</strong>
            <span>Client Admins</span>
          </div>
          <div className="stat">
            <strong>{admins.filter((a) => a.verified).length}</strong>
            <span>Verified</span>
          </div>
          <div className="stat">
            <strong>{currentAdmins} / {approvedLimit}</strong>
            <span>Admin seats used</span>
          </div>
          <div className="stat">
            <strong>{seatPending.length}</strong>
            <span>Seat requests pending</span>
          </div>
        </div>
        {seatPending.length > 0 && (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            {seatPending.length} seat-upgrade request(s) waiting — approve/deny under{' '}
            <strong>Platform → Seat Requests</strong>.
          </p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Create Client Admin</h3>
        <form onSubmit={handleCreate} className="field-row" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field compact">
            <span>Username</span>
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="e.g. clientadmin"
              autoComplete="off"
            />
          </label>
          <label className="field compact">
            <span>Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Display name (optional)"
              autoComplete="off"
            />
          </label>
          <label className="field compact">
            <span>Password</span>
            <input
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="min 8 characters"
              autoComplete="off"
            />
          </label>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? '…' : '＋ Create'}
          </button>
        </form>
        <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
          New admins start with <strong>no powers</strong> (least privilege) and unverified —
          grant powers below; only Super Admin can verify a Client Admin.
        </p>
        {created && (
          <div className="card" id="created-credentials" style={{ marginTop: 12, borderColor: '#10b981' }}>
            <h4 style={{ margin: '0 0 6px' }}>✅ {created.name} created</h4>
            <p style={{ margin: 0, fontSize: 13 }}>
              Portal login → username: <strong>{created.username}</strong> · password:{' '}
              <strong>{created.password}</strong>
            </p>
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>
          Client Admin accounts ({admins.length})
        </h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : admins.length === 0 ? (
          <p className="muted">No Client Admin accounts yet — create one above.</p>
        ) : (
          <ul className="user-list">
            {admins.map((u) => (
              <li key={u.id}>
                <div>
                  <strong>
                    {u.name || u.username}{' '}
                    {u.verified ? <VerifiedBadge size={16} title="Verified client admin" /> : null}
                  </strong>
                  <span className="meta">
                    @{u.username}
                    {u.active === false ? ' · disabled' : ''}
                    {u.active !== false && (
                      <>
                        {' · '}
                        {powersOf(u).length > 0
                          ? `powers: ${powersOf(u).map((p) => `${p.icon} ${p.label}`).join(', ')}`
                          : '🔒 no powers granted'}
                      </>
                    )}
                  </span>
                </div>
                <div className="user-actions">
                  <button
                    type="button"
                    className={`btn small ${u.verified ? 'ok' : 'primary'}`}
                    onClick={() => handleToggleVerify(u)}
                  >
                    {u.verified ? 'Verified ✓' : 'Verify admin'}
                  </button>
                  <button type="button" className="btn small" onClick={() => openEdit(u)}>
                    Edit
                  </button>
                  {u.active !== false ? (
                    <button type="button" className="btn small danger" onClick={() => handleDisable(u)}>
                      Disable
                    </button>
                  ) : (
                    <button type="button" className="btn small" onClick={() => handleEnable(u)}>
                      Enable
                    </button>
                  )}
                  <button type="button" className="btn small danger" onClick={() => handleDelete(u)}>
                    Delete
                  </button>
                </div>
                {me?.role === 'super_admin' && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, maxWidth: 560 }}>
                    {POWER_DEFS.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        className={`btn small ${u[p.key] ? 'primary' : ''}`}
                        disabled={saving}
                        onClick={() => void togglePower(u, p.key, p.label)}
                        title={`Grant or revoke ${p.label} (Super Admin only)`}
                        style={{ fontSize: 11, padding: '3px 9px' }}
                      >
                        {p.icon} {p.label}
                      </button>
                    ))}
                    <span className="meta" style={{ fontSize: 11, alignSelf: 'center' }}>
                      click to toggle
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        marginLeft: 6,
                      }}
                    >
                      <label
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 11,
                        }}
                      >
                        <span className="muted">Max Q/survey:</span>
                        <input
                          type="number"
                          min="0"
                          max="100000"
                          value={
                            maxQInputs[u.id] != null
                              ? maxQInputs[u.id]
                              : (u.max_questions_per_survey ?? 0)
                          }
                          onChange={(e) =>
                            setMaxQInputs((m) => ({
                              ...m,
                              [u.id]: Math.max(0, Number(e.target.value) || 0),
                            }))
                          }
                          style={{ width: 64, padding: '3px 6px', fontSize: 11 }}
                          title="Cap on questions per survey for this Client Admin (0 = unlimited)"
                        />
                      </label>
                      <button
                        type="button"
                        className="btn small primary"
                        disabled={saving}
                        onClick={() => void saveMaxQuestions(u)}
                        style={{ fontSize: 11, padding: '3px 9px' }}
                        title="Save question cap (Super Admin only)"
                      >
                        Save
                      </button>
                      {u.max_questions_per_survey > 0 && (
                        <span className="pill" style={{ fontSize: 10 }}>
                          cap {u.max_questions_per_survey}
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {editingId === u.id && (
                  <div className="user-edit-panel" style={{ marginTop: 10, width: '100%' }}>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <label className="field compact">
                        <span>Username</span>
                        <input
                          value={edit.username}
                          onChange={(e) => setEdit({ ...edit, username: e.target.value })}
                        />
                      </label>
                      <label className="field compact">
                        <span>Name</span>
                        <input
                          value={edit.name}
                          onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                        />
                      </label>
                      <label className="field compact">
                        <span>New password</span>
                        <input
                          value={edit.password}
                          onChange={(e) => setEdit({ ...edit, password: e.target.value })}
                          placeholder="Leave blank to keep"
                        />
                      </label>
                    </div>
                    <div className="user-actions" style={{ marginTop: 8 }}>
                      <button type="button" className="btn small primary" disabled={saving} onClick={() => saveEdit(u)}>
                        Save
                      </button>
                      <button type="button" className="btn small" onClick={closeEdit}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
