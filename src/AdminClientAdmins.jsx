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

const EMPTY_FORM = { username: '', name: '', company_name: '', password: '' }

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
  const [maxSrInputs, setMaxSrInputs] = useState({})

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
  const canAccessCount = admins.filter((a) => a.active !== false).length

  const toggleProfile = (u) => {
    setProfileId(profileId === u.id ? null : u.id)
    setEdit({ username: u.username || '', name: u.name || u.display_name || '', company_name: u.company_name || '', password: '' })
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

  /** Single save: caps + account fields in one PATCH (one Save button in profile). */
  const saveAllChanges = async (u) => {
    setSaving(true)
    try {
      const qVal = maxQInputs[u.id] != null ? Number(maxQInputs[u.id]) : (u.max_questions_per_survey ?? 0)
      const svVal = maxSvInputs[u.id] != null ? Number(maxSvInputs[u.id]) : (u.max_surveys ?? 0)
      const srVal = maxSrInputs[u.id] != null ? Number(maxSrInputs[u.id]) : (u.max_surveyors ?? 0)
      const parts = []
      const body = {
        max_questions_per_survey: Math.max(0, qVal),
        max_surveys: Math.max(0, svVal),
        max_surveyors: Math.max(0, srVal),
      }
      // Account fields (only include when the user actually typed something new)
      const typedUsername = edit.username.trim()
      const typedName = edit.name.trim()
      const typedPassword = edit.password.trim()
      if (typedUsername && typedUsername.toLowerCase() !== String(u.username || '').toLowerCase()) {
        body.username = typedUsername.toLowerCase()
      }
      if (typedName && typedName !== String(u.name || u.display_name || '')) {
        body.name = typedName
      }
      if (edit.company_name.trim() !== String(u.company_name || '')) body.company_name = edit.company_name.trim()
      if (typedPassword) body.password = typedPassword

      const res = await updateUser(u.id, body)
      parts.push('caps saved')
      if (res.username_changed) parts.push('username updated')
      if (res.password_changed) parts.push('password updated · sessions revoked')
      onToast?.(`Saved @${u.username} · ${parts.join(' · ')}`, 'ok')
      if (res.password_changed && res.plain_password) {
        setCreated({
          username: res.user?.username || body.username || u.username,
          password: res.plain_password,
          name: res.user?.name || body.name || u.name || u.username,
        })
      }
      setMaxQInputs((m) => ({ ...m, [u.id]: undefined }))
      setMaxSvInputs((m) => ({ ...m, [u.id]: undefined }))
      setMaxSrInputs((m) => ({ ...m, [u.id]: undefined }))
      setEdit(EMPTY_FORM)
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
        company_name: form.company_name.trim(),
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
            <strong>{canAccessCount} / {admins.length}</strong>
            <span>Client Admins can access</span>
          </div>
          <div className="stat">
            <strong>{currentAdmins} / {approvedLimit}</strong>
            <span>Clients granted access</span>
          </div>
          <div className="stat">
            <strong>{admins.filter((a) => a.verified).length}</strong>
            <span>Verified</span>
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
            <span>Company name</span>
            <input
              value={form.company_name}
              onChange={(e) => setForm({ ...form, company_name: e.target.value })}
              placeholder="e.g. Acme Research"
              autoComplete="organization"
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
                      </>
                    )}
                    {u.active !== false && (
                      <span className="meta" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                        <span className="pill" title="Surveys created / allocated">📋 surveys {u.survey_count ?? 0} / {u.max_surveys > 0 ? u.max_surveys : '∞'} allocated</span>
                        <span className="pill" title="Total questions created / max per survey">📝 questions {u.question_count ?? 0} / {u.max_questions_per_survey > 0 ? u.max_questions_per_survey : '∞'} allocated</span>
                        <span className="pill" title="Surveyors created / allocated">👥 surveyors {u.surveyor_count ?? 0} / {u.max_surveyors > 0 ? u.max_surveyors : '∞'} allocated</span>
                        <span className="pill" title="Records submitted by this Client Admin's surveyors">🗃 records {u.surveyor_record_count ?? 0}</span>
                      </span>
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
                          {u.company_name ? ` · 🏢 ${u.company_name}` : ''}
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
                        <span>
                          Max questions per survey (0 = unlimited) ·{' '}
                          <strong style={{ color: '#059669' }}>{u.question_count ?? 0}</strong> created /{' '}
                          {u.max_questions_per_survey > 0 ? u.max_questions_per_survey : '∞'} allocated
                        </span>
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
                        </div>
                      </label>
                      <label className="field compact" style={{ margin: 0 }}>
                        <span>
                          Max surveys (0 = unlimited) ·{' '}
                          <strong style={{ color: '#059669' }}>{u.survey_count ?? 0}</strong> created /{' '}
                          {u.max_surveys > 0 ? u.max_surveys : '∞'} allocated
                        </span>
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
                        </div>
                      </label>
                      <label className="field compact" style={{ margin: 0 }}>
                        <span>
                          Max surveyors (0 = unlimited) ·{' '}
                          <strong style={{ color: '#059669' }}>{u.surveyor_count ?? 0}</strong> created /{' '}
                          {u.max_surveyors > 0 ? u.max_surveyors : '∞'} allocated
                        </span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="number"
                            min="0"
                            max="100000"
                            value={
                              maxSrInputs[u.id] != null
                                ? maxSrInputs[u.id]
                                : (u.max_surveyors ?? 0)
                            }
                            onChange={(e) =>
                              setMaxSrInputs((m) => ({
                                ...m,
                                [u.id]: Math.max(0, Number(e.target.value) || 0),
                              }))
                            }
                            style={{ width: 90, padding: '6px 8px' }}
                          />
                        </div>
                      </label>
                    </div>
                    <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
                      Caps are enforced server-side when this admin creates surveyors, surveys,
                      or edits surveys.
                    </p>

                    {/* Separate tenant bucket: this profile's projects, surveyors and records only. */}
                    <h4 style={{ fontSize: 13, margin: '16px 0 8px' }}>🗺 This Client Admin’s projects & surveyors</h4>
                    {Array.isArray(u.survey_team) && u.survey_team.length > 0 ? (
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {u.survey_team.map((s) => (
                          <li key={s.id} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px' }}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>📋 {s.title}</div>
                            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                              {Array.isArray(s.surveyors) && s.surveyors.length > 0
                                ? `👥 ${s.surveyors.map((x) => x.name || x.username).join(', ')}`
                                : '👥 No surveyors mapped yet'}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                        No projects created by this Client Admin yet.
                      </p>
                    )}
                    <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
                      Separate bucket: {u.surveyor_count ?? 0} surveyors and {u.surveyor_record_count ?? 0} records
                      belong to this Client Admin only. Nothing is shared with another Client Admin.
                    </p>

                    {/* Connected projects shared by Super Admin */}
                    <h4 style={{ fontSize: 13, margin: '16px 0 8px' }}>🔗 Connected projects (shared)</h4>
                    {Array.isArray(u.granted_surveys) && u.granted_surveys.length > 0 ? (
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {u.granted_surveys.map((s) => (
                          <li key={s.id} style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: '8px 10px' }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: '#5b21b6' }}>🔗 {s.title}</div>
                            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                              {u.company_name ? `${u.company_name} · ` : ''}Connected by Super Admin — this Client Admin can open this project.
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                        No projects connected yet — connect from the Projects tab (Super Admin → Projects → open a
                        survey → "Share with client admins…").
                      </p>
                    )}

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
                        <span>Company name</span>
                        <input
                          value={edit.company_name}
                          onChange={(e) => setEdit({ ...edit, company_name: e.target.value })}
                          placeholder="Company / organisation"
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
                    </div>
                    <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
                      Leave password blank to keep it. Changing username/password revokes all active
                      sessions (forces re-login).
                    </p>

                    {/* One save for everything in this profile */}
                    <div style={{ marginTop: 14 }}>
                      <button
                        type="button"
                        className="btn primary"
                        style={{ width: '100%' }}
                        disabled={saving}
                        onClick={() => void saveAllChanges(u)}
                      >
                        {saving ? 'Saving…' : '💾 Save all changes'}
                      </button>
                      <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
                        Saves the caps above plus any account changes (username / name / password)
                        in one go.
                      </p>
                    </div>

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
