import { useCallback, useEffect, useState } from 'react'
import {
  createCompany,
  deleteCompany,
  listCompanies,
  listUsers,
  setCompanyAdmins,
  updateCompany,
} from './api'

/**
 * Super Admin console — Companies registry.
 * Create companies, add Client Admins to them ("part of it"), rename and delete.
 * Company membership stays in sync with each Client Admin's company_name.
 */
export default function AdminCompaniesScreen({ onToast }) {
  const [companies, setCompanies] = useState([])
  const [allAdmins, setAllAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newName, setNewName] = useState('')
  const [openId, setOpenId] = useState(null)
  const [checked, setChecked] = useState({})
  const [editName, setEditName] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [data, users] = await Promise.all([listCompanies(), listUsers()])
      setCompanies(data.items || [])
      setAllAdmins(
        (users.users || users.surveyors || users || []).filter((u) => u.role === 'admin'),
      )
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [onToast])

  useEffect(() => {
    load()
  }, [load])

  const toggleOpen = (c) => {
    const isOpen = openId === c.id
    setOpenId(isOpen ? null : c.id)
    if (!isOpen) {
      setChecked(Object.fromEntries((c.admins || []).map((a) => [String(a.id), true])))
      setEditName(c.name || '')
    }
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
      await createCompany(name)
      onToast?.(`Company "${name}" created`, 'ok')
      setNewName('')
      await load()
    } catch (err) {
      onToast?.(err.message, 'error')
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
        <h2>🏢 Companies</h2>
        <p>
          Register companies and add Client Admins to them. Projects are then created under a
          company and shared with its Client Admins.
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
          After creating, open the company to add the Client Admins who are part of it.
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
                  <strong style={{ fontSize: 15 }}>🏢 {c.name}</strong>
                  <span className="meta">
                    {c.created_at ? ` · created ${String(c.created_at).slice(0, 10)}` : ''}
                    {c.created_by_name ? ` · by ${c.created_by_name}` : ''}
                    {' · '}
                    <span className="pill" title="Projects mapped under this company">
                      📋 {c.project_count ?? 0} project(s)
                    </span>{' '}
                    <span className="pill" title="Client Admins part of this company">
                      👥 {c.admin_count ?? 0} client admin(s)
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
                    className={`btn small ${openId === c.id ? 'primary' : ''}`}
                    onClick={() => toggleOpen(c)}
                  >
                    {openId === c.id ? 'Close' : '👥 Admins'}
                  </button>
                  <button type="button" className="btn small danger" onClick={() => handleDelete(c)}>
                    Delete
                  </button>
                </div>

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
                      👥 Client Admins part of {c.name}
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
