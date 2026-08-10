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
  { key: 'can_manage_questions', label: 'Q-Bank', icon: '📚', hint: 'Question Bank template CRUD' },
  { key: 'can_edit_surveys', label: 'Survey questions', icon: '▤', hint: 'Edit question content' },
  { key: 'can_review_data', label: 'Data review', icon: '✓', hint: 'Confirm/reject records' },
  { key: 'can_verify_surveyors', label: 'Verify surveyors', icon: '🛡', hint: 'Verify surveyor identity' },
  { key: 'can_crud_questionnaire', label: 'CRUD questionnaire', icon: '🗂', hint: 'Create surveys + pick question count' },
  { key: 'can_validate_proof', label: 'Proof validation', icon: '📞', hint: 'Phone + Aadhaar format checks' },
]

const EMPTY_FORM = { username: '', name: '', password: '' }

function initialsOf(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}

export default function AdminClientAdminsScreen({ onToast }) {
  const me = getStoredUser()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [seatData, setSeatData] = useState(null)
  const [profileId, setProfileId] = useState(null) // which admin's profile panel is open
  const [edit, setEdit] = useState(EMPTY_FORM)
  const [form, setForm] = useState(EMPTY_FORM)
  const [created, setCreated] = useState(null)
  const [maxQInputs, setMaxQInputs] = useState({})
  const [maxSvInputs, setMaxSvInputs] = useState({})

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

  const toggleProfile = (u) => {
    setProfileId(profileId === u.id ? null : u.id)
    setEdit({ username: u.username || '', name: u.name || u.display_name || '', password: '' })
  }

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

  const saveMaxSurveys = async (u) => {
    const next = maxSvInputs[u.id] != null ? Number(maxSvInputs[u.id]) : (u.max_surveys ?? 0)
    setSaving(true)
    try {
      await updateUser(u.id, { max_surveys: Math.max(0, next) })
      onToast?.(
        next > 0
          ? `Cap set · @${u.username} max ${next} surveys`
          : `Cap cleared · @${u.username} unlimited surveys`,
        'ok',
      )
      setMaxSvInputs((m) => ({ ...m, [u.id]: undefined }))
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
      setEdit({ username: '', name: '', password: '' })
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
      if (profileId === u.id) setProfileId(null)
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
          Client Admin accounts for the main portal — open a profile to grant powers, set limits,
          verify identity and manage access (BR-006 / FR-USR-10).
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
          grant powers in the profile below; only Super Admin can verify a Client Admin.
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
              <li key={u.id} style={{ border: profileId === u.id ? '1px solid #059669' : undefined, borderRadius: 10 }}>
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
                        {u.max_surveys > 0 ? ` · surveys ≤ ${u.max_surveys}` : ''}
                        {u.max_questions_per_survey > 0 ? ` · Q/survey ≤ ${u.max_questions_per_survey}` : ''}
                      </>
                    )}
                  </span>
                </div>
                <div className="user-actions">
                  <button
                    type="button"
                    className={`btn small ${profileId === u.id ? 'primary' : ''}`}
                    onClick={() => toggleProfile(u)}
                  >
                    {profileId === u.id ? 'Close profile' : '👤 Profile'}
                  </button>
                  <button
                    type="button"
                    className={`btn small ${u.verified ? 'ok' : ''}`}
                    onClick={() => handleToggleVerify(u)}
                  >
                    {u.verified ? 'Verified ✓' : 'Verify'}
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

                {profileId === u.id && (
                  <div
                    className="card"
                    style={{
                      marginTop: 12,
                      width: '100%',
                      borderLeft: '4px solid #059669',
                      background: '#fbfdfe',
                    }}
                  >
                    {/* Profile header */}
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg,#059669,#0d9488)',
                          color: '#fff',
                          fontWeight: 800,
                          fontSize: 17,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {initialsOf(u.name || u.username)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 15 }}>{u.name || u.username}</strong>
                          {u.verified ? <VerifiedBadge size={16} title="Verified client admin" /> : null}
                          {u.active === false ? (
                            <span className="pill" style={{ background: 'rgba(220,38,38,0.12)', color: '#b91c1c', fontWeight: 'bold' }}>
                              DISABLED
                            </span>
                          ) : (
                            <span className="pill ok" style={{ fontWeight: 'bold' }}>ACTIVE</span>
                          )}
                        </div>
                        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                          @{u.username}
                          {u.created_at ? ` · created ${String(u.created_at).slice(0, 10)}` : ''}
                          {' · '}
                          {powersOf(u).length > 0
                            ? `${powersOf(u).length} of ${POWER_DEFS.length} powers`
                            : '🔒 no powers'}
                        </div>
                      </div>
                    </div>

                    {/* Features (powers) */}
                    <h4 style={{ fontSize: 13, margin: '16px 0 8px' }}>🧩 Features (granted powers)</h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {POWER_DEFS.map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          className={`btn small ${u[p.key] ? 'primary' : ''}`}
                          disabled={saving}
                          onClick={() => void togglePower(u, p.key, p.label)}
                          title={p.hint}
                          style={{ fontSize: 12, padding: '5px 12px' }}
                        >
                          {p.icon} {p.label} {u[p.key] ? '✓' : '＋'}
                        </button>
                      ))}
                    </div>
                    <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
                      Click a feature to grant (✓) or revoke (＋). Super Admin only — every change is audit-logged.
                    </p>

                    {/* Limits */}
                    <h4 style={{ fontSize: 13, margin: '16px 0 8px' }}>📏 Limits</h4>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <label className="field compact" style={{ margin: 0 }}>
                        <span>Max questions per survey (0 = unlimited)</span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
                            style={{ width: 90, padding: '6px 8px' }}
                          />
                          <button
                            type="button"
                            className="btn small primary"
                            disabled={saving}
                            onClick={() => void saveMaxQuestions(u)}
                          >
                            Save
                          </button>
                        </div>
                      </label>
                      <label className="field compact" style={{ margin: 0 }}>
                        <span>Max surveys (0 = unlimited)</span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="number"
                            min="0"
                            max="100000"
                            value={
                              maxSvInputs[u.id] != null
                                ? maxSvInputs[u.id]
                                : (u.max_surveys ?? 0)
                            }
                            onChange={(e) =>
                              setMaxSvInputs((m) => ({
                                ...m,
                                [u.id]: Math.max(0, Number(e.target.value) || 0),
                              }))
                            }
                            style={{ width: 90, padding: '6px 8px' }}
                          />
                          <button
                            type="button"
                            className="btn small primary"
                            disabled={saving}
                            onClick={() => void saveMaxSurveys(u)}
                          >
                            Save
                          </button>
                        </div>
                      </label>
                    </div>
                    <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
                      Caps are enforced server-side when this admin creates or edits surveys.
                    </p>

                    {/* Verification */}
                    <h4 style={{ fontSize: 13, margin: '16px 0 8px' }}>🛡 Verification</h4>
                    <button
                      type="button"
                      className={`btn small ${u.verified ? 'ok' : 'primary'}`}
                      onClick={() => void handleToggleVerify(u)}
                    >
                      {u.verified ? 'Verified ✓ — click to unverify' : 'Verify this Client Admin'}
                    </button>
                    <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
                      Only Super Admin can verify a Client Admin. Verified admins show the ✓ badge in the portal sidebar.
                    </p>

                    {/* Account */}
                    <h4 style={{ fontSize: 13, margin: '16px 0 8px' }}>👤 Account</h4>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <label className="field compact" style={{ margin: 0 }}>
                        <span>Username</span>
                        <input
                          value={edit.username}
                          onChange={(e) => setEdit({ ...edit, username: e.target.value })}
                          style={{ minWidth: 140 }}
                        />
                      </label>
                      <label className="field compact" style={{ margin: 0 }}>
                        <span>Name</span>
                        <input
                          value={edit.name}
                          onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                          style={{ minWidth: 140 }}
                        />
                      </label>
                      <label className="field compact" style={{ margin: 0 }}>
                        <span>New password</span>
                        <input
                          value={edit.password}
                          onChange={(e) => setEdit({ ...edit, password: e.target.value })}
                          placeholder="Leave blank to keep"
                          style={{ minWidth: 140 }}
                        />
                      </label>
                      <button type="button" className="btn small primary" disabled={saving} onClick={() => saveEdit(u)}>
                        Save account
                      </button>
                    </div>
                    <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
                      Changing username/password revokes all active sessions (forces re-login).
                    </p>

                    {/* Danger zone */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                      {u.active !== false ? (
                        <button type="button" className="btn small danger" onClick={() => handleDisable(u)}>
                          Disable access
                        </button>
                      ) : (
                        <button type="button" className="btn small" onClick={() => handleEnable(u)}>
                          Enable access
                        </button>
                      )}
                      <button type="button" className="btn small danger" onClick={() => handleDelete(u)}>
                        Delete permanently
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
