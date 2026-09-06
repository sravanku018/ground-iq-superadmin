import { useCallback, useEffect, useState } from 'react'
import Icon from './Icons'
import CompanyClientDashboard from './CompanyClientDashboard'
import {
  createUser,
  deleteUser,
  disableUser,
  enableUser,
  getSeatRequests,
  getStoredUser,
  listCompanies,
  listUsers,
  updateUser,
} from './api'
import VerifiedBadge from './VerifiedBadge'

/**
 * Grant-based powers (least privilege).
 * Roles: Super Admin creates Projects; Client Admin creates Surveys.
 */
const POWER_DEFS = [
  { key: 'can_crud_questionnaire', label: 'Create surveys', icon: '🗂', hint: 'Client Admin: create/delete surveys (not Super Admin projects)' },
  { key: 'can_edit_surveys', label: 'Edit survey questions', icon: '▤', hint: 'Edit questions on their surveys' },
  { key: 'can_manage_questions', label: 'Q-Bank', icon: '📚', hint: 'Question Bank template CRUD' },
  { key: 'can_review_data', label: 'Data review', icon: '✓', hint: 'Confirm/reject field records' },
  { key: 'can_verify_surveyors', label: 'Verify surveyors', icon: '🛡', hint: 'Verify surveyor identity' },
  { key: 'can_assign_surveyors', label: 'Assign surveyors', icon: '👥', hint: 'Map surveyors onto surveys' },
  { key: 'can_validate_proof', label: 'Proof validation', icon: '📞', hint: 'Phone + Aadhaar format checks' },
  { key: 'can_web_survey', label: 'Web survey', icon: '✎', hint: 'Fill surveys in the portal (desk / web)' },
  { key: 'can_record_voice', label: 'Voice recording', icon: '🎙', hint: 'Turn field-app voice Off vs Required. Minute limits stay Super Admin only.' },
  { key: 'can_translate_telugu', label: 'Telugu translation', icon: 'తె', hint: 'Auto-translate and edit Telugu question text' },
]

function powersFromUser(u) {
  const o = {}
  for (const p of POWER_DEFS) o[p.key] = !!u?.[p.key]
  return o
}

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
  const [dashboardUserCompany, setDashboardUserCompany] = useState(null)
  const [seatData, setSeatData] = useState(null)
  const [profileId, setProfileId] = useState(null) // which admin's profile panel is open
  const [edit, setEdit] = useState(EMPTY_FORM)
  const [form, setForm] = useState(EMPTY_FORM)
  const [created, setCreated] = useState(null)
  const [maxQInputs, setMaxQInputs] = useState({})
  const [maxSvInputs, setMaxSvInputs] = useState({})
  const [maxSrInputs, setMaxSrInputs] = useState({})
  const [maxRecInputs, setMaxRecInputs] = useState({})
  /** Draft feature checkmarks per admin id — saved with Save all */
  const [powerDrafts, setPowerDrafts] = useState({})
  const [companyNames, setCompanyNames] = useState([])

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true)
      try {
        const [data, seats, companies] = await Promise.all([
          listUsers(),
          getSeatRequests().catch(() => null),
          listCompanies().catch(() => null),
        ])
        const list = data.users || []
        setUsers(list)
        if (seats) setSeatData(seats)
        if (companies) setCompanyNames((companies.items || []).map((c) => c.name))
        return list
      } catch (e) {
        onToast?.(e.message, 'error')
        return []
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [onToast],
  )

  useEffect(() => {
    load()
  }, [load])

  const admins = users.filter((u) => u.role === 'admin')
  /** Always full map: server base + any in-progress checkbox edits */
  const draftPowers = (u) => ({
    ...powersFromUser(u),
    ...(powerDrafts[u.id] ?? powerDrafts[String(u.id)]),
  })
  const powersOf = (u) => POWER_DEFS.filter((p) => draftPowers(u)[p.key])
  const canVerify = me?.role === 'super_admin' || !!me?.can_verify_surveyors

  const approvedLimit = seatData?.limits?.approved_limit != null
    ? Number(seatData.limits.approved_limit)
    : 5
  const currentAdmins = seatData?.current_admins ?? admins.length
  const seatPending = (seatData?.requests || []).filter((r) => r.status === 'pending')
  const canAccessCount = admins.filter((a) => a.active !== false).length

  const uid = (u) => Number(u?.id)

  const toggleProfile = (u) => {
    const id = uid(u)
    if (profileId === id) {
      setProfileId(null)
      return
    }
    setProfileId(id)
    setEdit({
      username: u.username || '',
      name: u.name || u.display_name || '',
      company_name: u.company_name || '',
      password: '',
    })
    setPowerDrafts((d) => ({ ...d, [id]: powersFromUser(u) }))
    setMaxQInputs((m) => ({ ...m, [id]: Number(u.max_questions_per_survey) || 0 }))
    setMaxSvInputs((m) => ({ ...m, [id]: Number(u.max_surveys) || 0 }))
    setMaxSrInputs((m) => ({ ...m, [id]: Number(u.max_surveyors) || 0 }))
    setMaxRecInputs((m) => ({ ...m, [id]: Number(u.max_records) || 0 }))
  }

  const setPowerCheck = (u, key, checked) => {
    const id = uid(u)
    setPowerDrafts((d) => ({
      ...d,
      [id]: {
        ...powersFromUser(u),
        ...d[id],
        [key]: !!checked,
      },
    }))
  }

  const setAllPowers = (u, on) => {
    const id = uid(u)
    const next = {}
    for (const p of POWER_DEFS) next[p.key] = !!on
    setPowerDrafts((d) => ({ ...d, [id]: next }))
  }

  /** Single save: features + caps + account fields in one PATCH. */
  const saveAllChanges = async (u) => {
    const id = uid(u)
    if (!id) {
      onToast?.('Invalid user id — cannot save', 'error')
      return
    }
    setSaving(true)
    try {
      const powers = draftPowers(u)
      const qRaw = maxQInputs[id] ?? maxQInputs[u.id] ?? u.max_questions_per_survey
      const svRaw = maxSvInputs[id] ?? maxSvInputs[u.id] ?? u.max_surveys
      const srRaw = maxSrInputs[id] ?? maxSrInputs[u.id] ?? u.max_surveyors
      const recRaw = maxRecInputs[id] ?? maxRecInputs[u.id] ?? u.max_records
      const qVal = Math.max(0, Math.min(100000, Number(qRaw) || 0))
      const svVal = Math.max(0, Math.min(100000, Number(svRaw) || 0))
      const srVal = Math.max(0, Math.min(100000, Number(srRaw) || 0))
      const recVal = Math.max(0, Math.min(10_000_000, Number(recRaw) || 0))

      const body = {
        max_questions_per_survey: qVal,
        max_surveys: svVal,
        max_surveyors: srVal,
        max_records: recVal,
        // Always send every power key so partial drafts cannot wipe others
        ...Object.fromEntries(POWER_DEFS.map((p) => [p.key, !!powers[p.key]])),
      }
      const typedUsername = String(edit.username || '').trim()
      const typedName = String(edit.name || '').trim()
      const typedPassword = String(edit.password || '').trim()
      const typedCompany = String(edit.company_name || '').trim()
      if (typedUsername && typedUsername.toLowerCase() !== String(u.username || '').toLowerCase()) {
        body.username = typedUsername.toLowerCase()
      }
      if (typedName && typedName !== String(u.name || u.display_name || '')) {
        body.name = typedName
      }
      if (typedCompany !== String(u.company_name || '')) {
        body.company_name = typedCompany
      }
      if (typedPassword) body.password = typedPassword

      const res = await updateUser(id, body)
      if (res?.error) throw new Error(res.error)
      if (res && res.ok === false) throw new Error(res.message || 'Save rejected')

      const savedUser = res?.user || {}
      // Prefer explicit body + powers we just sent (source of truth we wrote)
      const merged = {
        ...u,
        ...savedUser,
        ...powers,
        max_questions_per_survey:
          savedUser.max_questions_per_survey ?? body.max_questions_per_survey,
        max_surveys: savedUser.max_surveys ?? body.max_surveys,
        max_surveyors: savedUser.max_surveyors ?? body.max_surveyors,
        max_records: savedUser.max_records ?? body.max_records,
        username: savedUser.username || u.username,
        name: savedUser.name || u.name,
        company_name:
          savedUser.company_name !== undefined
            ? savedUser.company_name
            : u.company_name,
      }

      // Optimistic list update — do NOT blank the page with loading spinner
      setUsers((list) =>
        list.map((row) => (Number(row.id) === id ? { ...row, ...merged } : row)),
      )
      setPowerDrafts((d) => ({ ...d, [id]: powersFromUser(merged) }))
      setMaxQInputs((m) => ({ ...m, [id]: merged.max_questions_per_survey ?? 0 }))
      setMaxSvInputs((m) => ({ ...m, [id]: merged.max_surveys ?? 0 }))
      setMaxSrInputs((m) => ({ ...m, [id]: merged.max_surveyors ?? 0 }))
      setMaxRecInputs((m) => ({ ...m, [id]: merged.max_records ?? 0 }))
      setEdit({
        username: merged.username || '',
        name: merged.name || '',
        company_name: merged.company_name || '',
        password: '',
      })
      setProfileId(id)

      const granted = POWER_DEFS.filter((p) => powers[p.key]).length
      const parts = [
        `${granted}/${POWER_DEFS.length} features`,
        `limits Q${qVal} / surveys ${svVal} / surveyors ${srVal} / records ${recVal}`,
      ]
      if (res?.username_changed) parts.push('username updated')
      if (res?.password_changed) parts.push('password updated · sessions revoked')
      onToast?.(
        `Saved @${merged.username} · ${parts.join(' · ')}. Client Admin must re-login for new features.`,
        'ok',
      )
      if (res?.password_changed && res.plain_password) {
        setCreated({
          username: res.user?.username || body.username || u.username,
          password: res.plain_password,
          name: res.user?.name || body.name || u.name || u.username,
        })
      }
      // Background refresh — silent so the open profile is not unmounted
      load({ silent: true }).catch(() => {})
    } catch (e) {
      console.error('Client Admin profile save failed', e)
      onToast?.(e.message || 'Save failed', 'error')
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
      if (Number(profileId) === Number(u.id)) setProfileId(null)
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

      <datalist id="registered-company-names">
        {companyNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

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
              placeholder="e.g. Acme Research (auto-assigned if blank)"
              autoComplete="organization"
              list="registered-company-names"
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
            <h4 style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="checkCircle" size={14} /> {created.name} created</h4>
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
              <li key={u.id} style={{ border: Number(profileId) === Number(u.id) ? '1px solid #059669' : undefined, borderRadius: 10 }}>
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
                        <span className="pill" title="Surveys created / allocated" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="clipboard" size={11} /> surveys {u.survey_count ?? 0} / {u.max_surveys > 0 ? u.max_surveys : '∞'} allocated</span>
                        <span className="pill" title="Questions created by Client Admin / Limit given by Super Admin">📝 questions created {u.question_count ?? 0} / limit {u.max_questions_per_survey > 0 ? u.max_questions_per_survey : '∞'}</span>
                        <span className="pill" title="Surveyors created / allocated" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="users" size={11} /> surveyors {u.surveyor_count ?? 0} / {u.max_surveyors > 0 ? u.max_surveyors : '∞'} allocated</span>
                        <span className="pill" title="Field records submitted / Super Admin record limit">🗃 records {u.surveyor_record_count ?? u.record_count ?? 0} / {u.max_records > 0 ? u.max_records : '∞'} allocated</span>
                      </span>
                    )}
                  </span>
                </div>
                <div className="user-actions">
                  <button
                    type="button"
                    className={`btn small ${Number(profileId) === Number(u.id) ? 'primary' : ''}`}
                    onClick={() => toggleProfile(u)}
                  >
                    {Number(profileId) === Number(u.id) ? 'Close profile' : <><Icon name="user" size={12} /> Profile</>}
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

                {Number(profileId) === Number(u.id) && (
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
                          {u.company_name ? <> · <Icon name="building" size={11} /> {u.company_name}</> : ''}
                          {u.created_at ? ` · created ${String(u.created_at).slice(0, 10)}` : ''}
                          {' · '}
                          {powersOf(u).length > 0
                            ? `${powersOf(u).length} of ${POWER_DEFS.length} powers`
                            : '🔒 no powers'}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`btn small ${dashboardUserCompany === u.id ? 'primary' : ''}`}
                        onClick={() => setDashboardUserCompany(dashboardUserCompany === u.id ? null : u.id)}
                        style={{ marginLeft: 'auto' }}
                      >
                        {dashboardUserCompany === u.id ? 'Hide Dashboard' : <><Icon name="chart" size={12} /> Company Dashboard</>}
                      </button>
                    </div>

                    {dashboardUserCompany === u.id && (
                      <div style={{ marginTop: 14, width: '100%' }}>
                        <CompanyClientDashboard
                          companyIdOrName={u.company_id || u.company_name || u.username}
                          onClose={() => setDashboardUserCompany(null)}
                          onToast={onToast}
                        />
                      </div>
                    )}

                    {/* Features (powers) — checkmarks, save all at once */}
                    <h4 style={{ fontSize: 13, margin: '16px 0 8px' }}>
                      🧩 Features &amp; limits
                      <span className="muted" style={{ fontWeight: 500, marginLeft: 8 }}>
                        {powersOf(u).length}/{POWER_DEFS.length} features checked
                      </span>
                    </h4>
                    <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
                      Tick features and set limits, then press <strong>Save features &amp; limits</strong>{' '}
                      (does not close this profile).
                    </p>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        marginBottom: 8,
                      }}
                    >
                      <button
                        type="button"
                        className="btn small"
                        disabled={saving}
                        onClick={() => setAllPowers(u, true)}
                      >
                        Check all
                      </button>
                      <button
                        type="button"
                        className="btn small"
                        disabled={saving}
                        onClick={() => setAllPowers(u, false)}
                      >
                        Uncheck all
                      </button>
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                        gap: 8,
                      }}
                    >
                      {POWER_DEFS.map((p) => {
                        const checked = !!draftPowers(u)[p.key]
                        return (
                          <label
                            key={p.key}
                            title={p.hint}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '10px 12px',
                              borderRadius: 10,
                              border: checked
                                ? '1px solid rgba(5, 150, 105, 0.45)'
                                : '1px solid var(--border, #e2e8f0)',
                              background: checked
                                ? 'rgba(5, 150, 105, 0.08)'
                                : 'var(--bg, #fff)',
                              cursor: saving ? 'not-allowed' : 'pointer',
                              userSelect: 'none',
                              fontSize: 13,
                              fontWeight: 600,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={saving}
                              onChange={(e) => setPowerCheck(u, p.key, e.target.checked)}
                              style={{
                                width: 18,
                                height: 18,
                                accentColor: '#059669',
                                flexShrink: 0,
                                cursor: 'pointer',
                              }}
                            />
                            <span style={{ lineHeight: 1.3 }}>
                              {p.icon} {p.label}
                              {checked ? (
                                <span style={{ color: '#059669', marginLeft: 4 }}><Icon name="check" size={12} /></span>
                              ) : null}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                    {/* Limits */}
                    <h4 style={{ fontSize: 13, margin: '16px 0 8px' }}>📏 Limits</h4>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <label className="field compact" style={{ margin: 0 }}>
                        <span>
                          Question limit (0 = unlimited) ·{' '}
                          <strong style={{ color: '#059669' }}>{u.question_count ?? 0}</strong> created /{' '}
                          limit {u.max_questions_per_survey > 0 ? u.max_questions_per_survey : '∞'}
                        </span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="number"
                            min="0"
                            max="100000"
                            value={
                              maxQInputs[Number(u.id)] != null
                                ? maxQInputs[Number(u.id)]
                                : (u.max_questions_per_survey ?? 0)
                            }
                            onChange={(e) =>
                              setMaxQInputs((m) => ({
                                ...m,
                                [Number(u.id)]: Math.max(0, Number(e.target.value) || 0),
                              }))
                            }
                            style={{ width: 90, padding: '6px 8px' }}
                          />
                        </div>
                      </label>
                      <label className="field compact" style={{ margin: 0 }}>
                        <span>
                          Max surveys they can create (0 = unlimited) ·{' '}
                          <strong style={{ color: '#059669' }}>{u.survey_count ?? 0}</strong> created /{' '}
                          {u.max_surveys > 0 ? u.max_surveys : '∞'} allocated
                        </span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="number"
                            min="0"
                            max="100000"
                            value={
                              maxSvInputs[Number(u.id)] != null
                                ? maxSvInputs[Number(u.id)]
                                : (u.max_surveys ?? 0)
                            }
                            onChange={(e) =>
                              setMaxSvInputs((m) => ({
                                ...m,
                                [Number(u.id)]: Math.max(0, Number(e.target.value) || 0),
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
                              maxSrInputs[Number(u.id)] != null
                                ? maxSrInputs[Number(u.id)]
                                : (u.max_surveyors ?? 0)
                            }
                            onChange={(e) =>
                              setMaxSrInputs((m) => ({
                                ...m,
                                [Number(u.id)]: Math.max(0, Number(e.target.value) || 0),
                              }))
                            }
                            style={{ width: 90, padding: '6px 8px' }}
                          />
                        </div>
                      </label>
                      <label className="field compact" style={{ margin: 0 }}>
                        <span>
                          Max field records (0 = unlimited) ·{' '}
                          <strong style={{ color: '#059669' }}>
                            {u.surveyor_record_count ?? u.record_count ?? 0}
                          </strong>{' '}
                          of {u.max_records > 0 ? `${Number(u.max_records).toLocaleString()} used` : '∞ allocated'}
                        </span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="number"
                            min="0"
                            max="10000000"
                            value={
                              maxRecInputs[Number(u.id)] != null
                                ? maxRecInputs[Number(u.id)]
                                : (u.max_records ?? 0)
                            }
                            onChange={(e) =>
                              setMaxRecInputs((m) => ({
                                ...m,
                                [Number(u.id)]: Math.max(0, Number(e.target.value) || 0),
                              }))
                            }
                            style={{ width: 110, padding: '6px 8px' }}
                          />
                        </div>
                      </label>
                    </div>
                    <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
                      Caps are enforced server-side when this admin creates surveyors, surveys,
                      edits surveys, or when surveyors submit field records. 0 = unlimited.
                    </p>

                    {/* Save features + limits immediately under the controls */}
                    <div style={{ marginTop: 14 }}>
                      <button
                        type="button"
                        className="btn primary"
                        style={{ width: '100%' }}
                        disabled={saving}
                        onClick={() => void saveAllChanges(u)}
                      >
                        {saving
                          ? 'Saving…'
                          : `💾 Save features & limits (${powersOf(u).length}/${POWER_DEFS.length} on)`}
                      </button>
                    </div>

                    {/* Surveys created by this Client Admin (not Super Admin projects) */}
                    <h4 style={{ fontSize: 13, margin: '16px 0 8px' }}>
                      🗂 Surveys created by this Client Admin
                    </h4>
                    {Array.isArray(u.survey_team) && u.survey_team.length > 0 ? (
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {u.survey_team.map((s) => (
                          <li key={s.id} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px' }}>
                            <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="clipboard" size={12} /> {s.title}</div>
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
                        No surveys created by this Client Admin yet (they use{' '}
                        <strong>Create surveys</strong> power → Surveys → + New survey).
                      </p>
                    )}
                    <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
                      Separate bucket: {u.surveyor_count ?? 0} surveyors and {u.surveyor_record_count ?? 0}{' '}
                      records belong to this Client Admin only.
                    </p>

                    {/* Projects Super Admin shared with them */}
                    <h4 style={{ fontSize: 13, margin: '16px 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="link" size={13} /> Super Admin projects (shared with them)
                    </h4>
                    {Array.isArray(u.granted_surveys) && u.granted_surveys.length > 0 ? (
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {u.granted_surveys.map((s) => (
                          <li key={s.id} style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: '8px 10px' }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: '#5b21b6', display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="link" size={12} /> {s.title}</div>
                            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                              {u.company_name ? `${u.company_name} · ` : ''}
                              Project created by Super Admin — Client Admin can open it (not create it).
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                        No Super Admin projects connected yet — Super Admin → Projects → open a
                        project → share with this Client Admin.
                      </p>
                    )}

                    {/* Verification */}
                    <h4 style={{ fontSize: 13, margin: '16px 0 8px' }}>🛡 Verification</h4>
                    <button
                      type="button"
                      className={`btn small ${u.verified ? 'ok' : 'primary'}`}
                      onClick={() => void handleToggleVerify(u)}
                    >
                      {u.verified ? <><Icon name="check" size={12} /> Verified — click to unverify</> : 'Verify this Client Admin'}
                    </button>
                    <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
                      Only Super Admin can verify a Client Admin. Verified admins show the ✓ badge in the portal sidebar.
                    </p>

                    {/* Account */}
                    <h4 style={{ fontSize: 13, margin: '16px 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="user" size={13} /> Account</h4>
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
                          list="registered-company-names"
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

                    {/* Save account fields too (same handler includes features + limits) */}
                    <div style={{ marginTop: 14 }}>
                      <button
                        type="button"
                        className="btn primary"
                        style={{ width: '100%' }}
                        disabled={saving}
                        onClick={() => void saveAllChanges(u)}
                      >
                        {saving ? 'Saving…' : '💾 Save profile (features + limits + account)'}
                      </button>
                      <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
                        One request writes features, limits, and account fields. Client Admin must
                        re-login to see new menu powers.
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
