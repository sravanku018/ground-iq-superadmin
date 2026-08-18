import { useCallback, useEffect, useState } from 'react'
import Icon from './Icons'
import CompanyClientDashboard from './CompanyClientDashboard'
import {
  createCompany,
  createSurvey,
  deleteCompany,
  listCompanies,
  listUsers,
  setCompanyAdmins,
  updateCompany,
} from './api'

/**
 * Super Admin console — Companies registry.
 * Create companies, add Client Admins, then create projects under that company.
 * Company membership stays in sync with each Client Admin's company_name.
 */
export default function AdminCompaniesScreen({ onToast, onNav }) {
  const [companies, setCompanies] = useState([])
  const [allAdmins, setAllAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newName, setNewName] = useState('')
  const [openId, setOpenId] = useState(null)
  const [dashboardCompanyId, setDashboardCompanyId] = useState(null)
  const [checked, setChecked] = useState({})
  const [editName, setEditName] = useState('')
  /** Project title draft while creating under the open company */
  const [projectTitle, setProjectTitle] = useState('')
  const [createdProject, setCreatedProject] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [data, users] = await Promise.all([listCompanies(), listUsers()])
      setCompanies(data.items || [])
      setAllAdmins(
        (users.users || users.surveyors || users || []).filter((u) => u.role === 'admin'),
      )
      return data.items || []
    } catch (e) {
      onToast?.(e.message, 'error')
      return []
    } finally {
      setLoading(false)
    }
  }, [onToast])

  useEffect(() => {
    load()
  }, [load])

  const openCompany = (c) => {
    setOpenId(c.id)
    setChecked(Object.fromEntries((c.admins || []).map((a) => [String(a.id), true])))
    setEditName(c.name || '')
    setProjectTitle('')
    setCreatedProject(null)
  }

  const toggleOpen = (c) => {
    if (openId === c.id) {
      setOpenId(null)
      return
    }
    openCompany(c)
  }

  async function handleCreate(e) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) {
      onToast?.('Enter a company name', 'error')
      return
    }
    setSaving(true)
    try {
      const res = await createCompany(name)
      onToast?.(`Company "${name}" created — add admins, then create a project below`, 'ok')
      setNewName('')
      const items = await load()
      // Open the new company so Super Admin can create a project immediately
      const created =
        res?.company ||
        res?.item ||
        items.find((x) => String(x.name || '').toLowerCase() === name.toLowerCase()) ||
        items[0]
      if (created) openCompany(created)
    } catch (err) {
      onToast?.(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateProject(c) {
    const title = projectTitle.trim()
    if (!title) {
      onToast?.('Enter a project name', 'error')
      return
    }
    const adminIds = Object.keys(checked)
      .filter((k) => checked[k])
      .map(Number)
    if (adminIds.length === 0) {
      onToast?.(
        'Select at least one Client Admin above (Save them first if you just checked them)',
        'error',
      )
      return
    }
    setSaving(true)
    try {
      // Ensure membership is saved so company + project stay aligned
      await setCompanyAdmins(c.id, adminIds).catch(() => null)
      const d = await createSurvey({
        title,
        questions: [],
        company_name: c.name,
        admin_ids: adminIds,
      })
      const proj = d?.survey || d
      setCreatedProject({
        id: proj?.id,
        title: proj?.title || title,
        company: c.name,
      })
      setProjectTitle('')
      onToast?.(`Project "${title}" created under ${c.name}`, 'ok')
      await load()
      // Keep panel open on this company
      setOpenId(c.id)
      setChecked(Object.fromEntries(adminIds.map((id) => [String(id), true])))
    } catch (e) {
      if (e.status === 409 && e.existing_id) {
        onToast?.(`Project "${title}" already exists — open it in Projects`, 'warn')
        setCreatedProject({ id: e.existing_id, title, company: c.name })
      } else {
        onToast?.(e.message, 'error')
      }
    } finally {
      setSaving(false)
    }
  }

  async function saveAdmins(c) {
    setSaving(true)
    try {
      const ids = Object.keys(checked).filter((k) => checked[k]).map(Number)
      await setCompanyAdmins(c.id, ids)
      onToast?.(`Saved ${ids.length} client admin(s) for ${c.name}`, 'ok')
      await load()
      setChecked(Object.fromEntries(ids.map((id) => [String(id), true])))
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleRename(c) {
    const name = editName.trim()
    if (!name) {
      onToast?.('Enter a company name', 'error')
      return
    }
    setSaving(true)
    try {
      await updateCompany(c.id, { name })
      onToast?.(`Renamed to "${name}"`, 'ok')
      setEditName(name)
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(c) {
    if (
      !confirm(
        `DELETE company "${c.name}"? ${c.admins?.length || 0} client admin(s) will be unlinked.`,
      )
    ) {
      return
    }
    setSaving(true)
    try {
      await deleteCompany(c.id)
      onToast?.(`Deleted "${c.name}"`, 'ok')
      if (openId === c.id) setOpenId(null)
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const totalMembers = companies.reduce((n, c) => n + (c.admin_count || 0), 0)
  const selectedCount = Object.keys(checked).filter((k) => checked[k]).length

  return (
    <div className="screen">
      <header className="screen-head">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="building" size={20} /> Companies</h2>
        <p>
          1) Create a company → 2) Add Client Admins → 3) Create a project under that company
          (shared with those admins).
        </p>
      </header>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="stat-row">
          <div className="stat">
            <strong>{companies.length}</strong>
            <span>Companies</span>
          </div>
          <div className="stat">
            <strong>{totalMembers}</strong>
            <span>Client Admins added</span>
          </div>
          <div className="stat">
            <strong>{allAdmins.length}</strong>
            <span>Client Admin accounts</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Create company</h3>
        <form
          onSubmit={handleCreate}
          className="field-row"
          style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <label className="field compact">
            <span>Company name</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Acme Research"
              autoComplete="organization"
            />
          </label>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? '…' : '＋ Create'}
          </button>
        </form>
        <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
          After create, the company opens automatically so you can add Client Admins and create a
          project.
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Registered companies ({companies.length})</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : companies.length === 0 ? (
          <p className="muted">No companies yet — create one above.</p>
        ) : (
          <ul className="user-list">
            {companies.map((c) => (
              <li
                key={c.id}
                style={{
                  border: openId === c.id ? '1px solid #059669' : undefined,
                  borderRadius: 10,
                }}
              >
                <div>
                  <strong style={{ fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="building" size={14} /> {c.name}</strong>
                  <span className="meta">
                    {c.created_at ? ` · created ${String(c.created_at).slice(0, 10)}` : ''}
                    {c.created_by_name ? ` · by ${c.created_by_name}` : ''}
                    {' · '}
                    <span className="pill" title="Projects mapped under this company">
                      <Icon name="clipboard" size={11} /> {c.project_count ?? 0} project(s)
                    </span>{' '}
                    <span className="pill" title="Client Admins part of this company">
                      <Icon name="users" size={11} /> {c.admin_count ?? 0} client admin(s)
                    </span>
                  </span>
                  <div className="meta" style={{ fontSize: 12, marginTop: 4 }}>
                    {Array.isArray(c.admins) && c.admins.length > 0
                      ? `Members: ${c.admins.map((a) => `${a.name || a.username} (@${a.username})`).join(', ')}`
                      : 'No Client Admins added yet.'}
                  </div>
                </div>
                <div className="user-actions">
                  <button
                    type="button"
                    className={`btn small ${dashboardCompanyId === c.id ? 'primary' : ''}`}
                    onClick={() => setDashboardCompanyId(dashboardCompanyId === c.id ? null : c.id)}
                  >
                    {dashboardCompanyId === c.id ? 'Hide Dashboard' : <><Icon name="chart" size={12} /> Dashboard</>}
                  </button>
                  <button
                    type="button"
                    className={`btn small ${openId === c.id ? 'primary' : ''}`}
                    onClick={() => toggleOpen(c)}
                  >
                    {openId === c.id ? 'Close' : 'Manage · project'}
                  </button>
                  <button type="button" className="btn small danger" onClick={() => handleDelete(c)}>
                    Delete
                  </button>
                </div>

                {dashboardCompanyId === c.id && (
                  <div style={{ marginTop: 14, width: '100%' }}>
                    <CompanyClientDashboard
                      companyIdOrName={c.id}
                      onClose={() => setDashboardCompanyId(null)}
                      onToast={onToast}
                    />
                  </div>
                )}

                {openId === c.id && (
                  <div
                    className="card"
                    style={{
                      marginTop: 12,
                      width: '100%',
                      borderLeft: '4px solid #059669',
                      background: '#fbfdfe',
                    }}
                  >
                    <h4 style={{ fontSize: 13, margin: '0 0 8px' }}>
                      <Icon name="users" size={13} /> Client Admins part of {c.name}
                    </h4>
                    {allAdmins.length === 0 ? (
                      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                        No Client Admin accounts yet — create them in the Client Admins tab first.
                      </p>
                    ) : (
                      <>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                            maxHeight: 260,
                            overflowY: 'auto',
                          }}
                        >
                          {allAdmins.map((u) => {
                            const on = !!checked[String(u.id)]
                            return (
                              <label
                                key={u.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 10,
                                  background: on ? '#c8f5df' : 'rgba(15,23,42,0.05)',
                                  border: on ? '1px solid #059669' : '1px solid #e2e8f0',
                                  borderRadius: 8,
                                  padding: '9px 12px',
                                  cursor: 'pointer',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={(e) =>
                                    setChecked((ch) => ({
                                      ...ch,
                                      [String(u.id)]: e.target.checked,
                                    }))
                                  }
                                />
                                <span style={{ fontSize: 13, fontWeight: 600 }}>
                                  {u.name || u.username}
                                  <span className="muted" style={{ fontWeight: 400 }}>
                                    {' '}@{u.username}
                                    {u.company_name && u.company_name !== c.name
                                      ? ` · ${u.company_name}`
                                      : ''}
                                  </span>
                                </span>
                              </label>
                            )
                          })}
                        </div>
                        <button
                          type="button"
                          className="btn primary"
                          style={{ width: '100%', marginTop: 10 }}
                          disabled={saving}
                          onClick={() => saveAdmins(c)}
                        >
                          {saving ? 'Saving…' : `💾 Save ${selectedCount} admin(s)`}
                        </button>
                      </>
                    )}

                    {/* Create project under this company */}
                    <h4 style={{ fontSize: 13, margin: '16px 0 8px' }}>
                      <Icon name="clipboard" size={13} /> Create project under {c.name}
                    </h4>
                    <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
                      Company is fixed to <strong>{c.name}</strong>. Selected Client Admins above
                      get access to the new project.
                    </p>
                    <div
                      style={{
                        display: 'flex',
                        gap: 10,
                        flexWrap: 'wrap',
                        alignItems: 'flex-end',
                      }}
                    >
                      <label className="field compact" style={{ margin: 0, flex: '1 1 200px' }}>
                        <span>Project name</span>
                        <input
                          value={projectTitle}
                          onChange={(e) => setProjectTitle(e.target.value)}
                          placeholder="e.g. Warangal Pre-poll 2026"
                          disabled={saving}
                        />
                      </label>
                      <button
                        type="button"
                        className="btn primary"
                        disabled={saving || !projectTitle.trim()}
                        onClick={() => void handleCreateProject(c)}
                      >
                        {saving ? '…' : '＋ Create project'}
                      </button>
                    </div>
                    {createdProject &&
                    String(createdProject.company || '').toLowerCase() ===
                      String(c.name || '').toLowerCase() ? (
                      <div
                        className="card"
                        style={{
                          marginTop: 10,
                          padding: 12,
                          background: 'rgba(5, 150, 105, 0.08)',
                          border: '1px solid rgba(5, 150, 105, 0.35)',
                        }}
                      >
                        <strong style={{ color: '#059669' }}>
                          <Icon name="check" size={13} /> Project “{createdProject.title}” created
                        </strong>
                        <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                          Mapped under company {c.name}. Open Projects to add questions and
                          surveyors.
                        </p>
                        {typeof onNav === 'function' ? (
                          <button
                            type="button"
                            className="btn small primary"
                            style={{ marginTop: 8 }}
                            onClick={() => onNav('surveys')}
                          >
                            Open Projects tab →
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    <p className="muted" style={{ fontSize: 11, margin: '8px 0 0' }}>
                      Tip: save Client Admins first if you changed the checkboxes, then create the
                      project (we also re-save membership on create).
                    </p>

                    <h4 style={{ fontSize: 13, margin: '16px 0 8px' }}>✏️ Rename company</h4>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      <label className="field compact" style={{ margin: 0 }}>
                        <span>Name</span>
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          style={{ minWidth: 160 }}
                        />
                      </label>
                      <button
                        type="button"
                        className="btn small"
                        disabled={saving}
                        onClick={() => handleRename(c)}
                      >
                        Rename
                      </button>
                    </div>
                    <p className="muted" style={{ fontSize: 11, margin: '8px 0 0' }}>
                      Renaming also updates this company's Client Admin profiles. Delete unlinks its
                      Client Admins and removes the company.
                    </p>
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
