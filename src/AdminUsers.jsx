import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createUser,
  deleteUser,
  disableUser,
  enableUser,
  generateUsers,
  getProgressBoard,
  listSurveys,
  listUsers,
  revokeUserSessions,
  setProgressQuota,
  setSurveySurveyors,
  updateUser,
} from './api'

/** Compress profile/Aadhaar image file before upload (max 1200px, 0.75 quality) */
function compressImageFile(file, maxDimension = 1200, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file provided'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read image file'))
    reader.onload = (e) => {
      const img = new Image()
      img.onerror = () => reject(new Error('Failed to load image'))
      img.onload = () => {
        let { width, height } = img
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width)
            width = maxDimension
          } else {
            width = Math.round((width * maxDimension) / height)
            height = maxDimension
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality)
        resolve(compressedDataUrl)
      }
      img.src = e.target?.result
    }
    reader.readAsDataURL(file)
  })
}

function SurveySelect({ value, onChange, all }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!all.length) {
    return (
      <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
        No surveys yet — create them in the Surveys tab first.
      </p>
    )
  }

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        className="btn small"
        style={{ width: '100%', textAlign: 'left' }}
        onClick={() => setOpen((o) => !o)}
      >
        {value.length
          ? `${value.length} survey${value.length > 1 ? 's' : ''} selected`
          : 'Select surveys… (none = default form)'}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            zIndex: 20,
            top: '100%',
            left: 0,
            marginTop: 4,
            minWidth: '100%',
            background: '#fff',
            color: '#222',
            border: '1px solid rgba(0,0,0,0.25)',
            borderRadius: 8,
            padding: 8,
            maxHeight: 190,
            overflowY: 'auto',
            boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
          }}
        >
          {all.map((s) => (
            <button
              key={s.id}
              type="button"
              className="btn small"
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                margin: '2px 0',
                background: value.includes(String(s.id))
                  ? 'rgba(0,229,153,0.15)'
                  : undefined,
              }}
              onClick={() => {
                const id = String(s.id)
                onChange(
                  value.includes(id)
                    ? value.filter((x) => x !== id)
                    : [...value, id],
                )
              }}
            >
              {s.title}
              {value.includes(String(s.id)) ? ' ✓' : ''}
            </button>
          ))}
          <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn small"
              onClick={() => onChange(all.map((s) => String(s.id)))}
            >
              All
            </button>
            <button type="button" className="btn small" onClick={() => onChange([])}>
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AdminUsersScreen({ onToast }) {
  const [users, setUsers] = useState([])
  const [board, setBoard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [edit, setEdit] = useState({
    username: '',
    name: '',
    password: '',
    target_quota: 0,
  })
  const [gen, setGen] = useState({
    count: 10,
    prefix: 's',
    password: 'survey123',
    target_quota: 20,
    surveys: [],
    usernames_list: '',
  })
  const [bulkTarget, setBulkTarget] = useState(20)
  const [lastGenerated, setLastGenerated] = useState([])
  const [form, setForm] = useState({
    username: '',
    password: '',
    name: '',
    role: 'surveyor',
    target_quota: 20,
    surveys: [],
  })
  const [allSurveys, setAllSurveys] = useState([])
  const [tab, setTab] = useState('create') // create | bulk | profiles
  const [profileUser, setProfileUser] = useState(null)
  const [profileData, setProfileData] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileFilters, setProfileFilters] = useState({
    period: 'total',
    day: new Date().toISOString().slice(0, 10),
    month: new Date().toISOString().slice(0, 7),
    district: '',
    survey: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [data, prog, svs] = await Promise.all([
        listUsers(),
        getProgressBoard().catch(() => null),
        listSurveys('').catch(() => ({ items: [] })),
      ])
      setUsers(data.users || [])
      setBoard(prog)
      setAllSurveys(svs.items || [])
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [onToast])

  useEffect(() => {
    load()
  }, [load])

  async function loadProfile(u, filters = profileFilters) {
    if (!u) return
    setProfileUser(u)
    setProfileLoading(true)
    try {
      const { listSubmissions } = await import('./api')
      const period = filters.period === 'today' ? 'today' : filters.period === 'day' ? 'day' : filters.period === 'month' ? 'month' : 'total'
      const surveyParam = (filters.survey === 'active' || filters.survey === 'all_with_legacy') ? '' : filters.survey
      const res = await listSubmissions(500, 'all', {
        user: u.username,
        period,
        day: period === 'day' ? filters.day : '',
        month: period === 'month' ? filters.month : '',
        survey: surveyParam,
        district: filters.district,
      })
      let items = res.items || []

      // Exclude legacy records by default unless 'all_with_legacy' or 'legacy' is chosen
      if (!filters.survey || filters.survey === 'active') {
        items = items.filter((i) => i.form_key !== 'legacy' && !i.legacy)
      } else if (filters.survey === 'legacy') {
        items = items.filter((i) => i.form_key === 'legacy' || i.legacy)
      } else if (filters.survey && filters.survey !== 'all_with_legacy') {
        items = items.filter((i) => i.form_key === filters.survey)
      }

      const geoSummary = {
        records: items.length,
        districts: [...new Set(items.map((i) => i.answers?.district || i.district).filter(Boolean))],
        constituencies: [...new Set(items.map((i) => i.answers?.constituency || i.constituency).filter(Boolean))],
        complete: items.filter((i) => i.completeness === 'complete').length,
        confirmed: items.filter((i) => i.status === 'confirmed').length,
      }
      setProfileData({ items, geoSummary })
    } catch (e) {
      onToast?.(e.message, 'error')
      setProfileData(null)
    } finally {
      setProfileLoading(false)
    }
  }

  function openProfile(u) {
    if (!u) return
    setProfileUser(u)
    setProfileData(null)
    const initialFilters = { period: 'total', district: '', survey: 'active', day: '', month: '' }
    setProfileFilters(initialFilters)
    setTab('profiles')
    loadProfile(u, initialFilters)
  }

  function openEdit(u) {
    setEditingId(u.id)
    setEdit({
      username: u.username || '',
      name: u.name || u.display_name || '',
      phone: u.phone || '',
      password: '',
      target_quota: u.target ?? u.target_quota ?? 0,
      surveys: (u.surveys || []).map((s) => String(s.id)),
    })
  }

  function closeEdit() {
    setEditingId(null)
    setEdit({ username: '', name: '', phone: '', password: '', target_quota: 0, surveys: [] })
  }

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    // Capture before clearing form
    const typedUser = form.username.trim()
    const typedPass = form.password
    const typedName = (form.name || form.username).trim()
    const typedQuota = form.target_quota
    const typedRole = form.role === 'admin' ? 'admin' : 'surveyor'
    try {
      const body = {
        username: typedUser,
        password: typedPass,
        name: typedName || typedUser,
        role: typedRole,
        target_quota: typedRole === 'admin' ? 0 : typedQuota,
      }
      const res = await createUser(body)
      const created = res?.user || {}
      // Server lowercases username — always show the real login name from API
      const loginName = String(created.username || typedUser).trim().toLowerCase()
      const displayName = String(created.name || typedName || loginName)

      if (typedRole === 'surveyor') {
        const surveyIds = Array.isArray(form.surveys) ? form.surveys.map(Number) : []
        if (surveyIds.length && created.id) {
          try {
            await setSurveySurveyors(created.id, surveyIds)
          } catch (e) {
            onToast?.(`User created but survey assign failed: ${e.message}`, 'error')
          }
        }
        setLastGenerated([
          {
            username: loginName,
            password: typedPass,
            name: displayName,
            target_quota: created.target_quota ?? typedQuota,
            id: created.id,
          },
        ])
        // Optimistic insert so list updates even if reload is slow
        setUsers((prev) => {
          if (prev.some((u) => u.id === created.id || u.username === loginName)) return prev
          return [
            {
              id: created.id || Date.now(),
              username: loginName,
              name: displayName,
              role: 'surveyor',
              active: created.active !== false,
              target_quota: created.target_quota ?? typedQuota,
              done: 0,
              status: 'not_started',
              progress_label: `0/${(created.target_quota ?? typedQuota) || '—'}`,
            },
            ...prev,
          ]
        })
        onToast?.(`Created · app login username: ${loginName}`, 'ok')
      } else {
        onToast?.(`Admin created · username: ${loginName}`, 'ok')
      }
      setForm({
        username: '',
        password: '',
        name: '',
        role: 'surveyor',
        target_quota: 20,
        surveys: [],
      })
      // Scroll credentials into view
      setTimeout(() => {
        document.getElementById('created-credentials')?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        })
      }, 50)
      await load()
    } catch (err) {
      onToast?.(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleGenerate(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await generateUsers({
        ...gen,
        role: 'surveyor',
      })
      const createdUsers = Array.isArray(res.users) ? res.users : []
      const genSurveyIds = Array.isArray(gen.surveys) ? gen.surveys.map(Number) : []
      if (genSurveyIds.length && createdUsers.length) {
        try {
          const fresh = await listUsers()
          const byName = new Map(
            (fresh.users || []).map((u) => [String(u.username).toLowerCase(), u]),
          )
          let assigned = 0
          for (const cu of createdUsers) {
            const u = byName.get(String(cu.username).toLowerCase())
            if (u?.id) {
              try {
                await setSurveySurveyors(u.id, genSurveyIds)
                assigned += 1
              } catch {
                /* skip */
              }
            }
          }
          if (assigned) {
            onToast?.(`Assigned ${genSurveyIds.length} survey(s) to ${assigned} created surveyors`, 'ok')
          }
        } catch {
          /* ignore assign errors — users were created */
        }
      }
      setLastGenerated(
        createdUsers.map((u) => ({
          username: u.username,
          password: u.password || gen.password,
          name: u.name || u.username,
          target_quota: u.target_quota ?? gen.target_quota,
        })),
      )
      // Optimistic list update
      if (createdUsers.length) {
        setUsers((prev) => {
          const existing = new Set(prev.map((u) => String(u.username).toLowerCase()))
          const add = createdUsers
            .filter((u) => u.username && !existing.has(String(u.username).toLowerCase()))
            .map((u) => ({
              id: u.id || `tmp-${u.username}`,
              username: u.username,
              name: u.name || u.username,
              role: 'surveyor',
              active: true,
              target_quota: u.target_quota ?? gen.target_quota,
              done: 0,
              status: 'not_started',
              progress_label: `0/${(u.target_quota ?? gen.target_quota) || '—'}`,
            }))
          return [...add, ...prev]
        })
      }
      onToast?.(
        res.created > 0
          ? `${res.created} surveyors created: ${createdUsers.map((u) => u.username).join(', ')}`
          : 'No new users (usernames may already exist). Try another prefix.',
        res.created > 0 ? 'ok' : 'error',
      )
      setTimeout(() => {
        document.getElementById('created-credentials')?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        })
      }, 50)
      await load()
    } catch (err) {
      onToast?.(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function saveEdit(user) {
    setSaving(true)
    try {
      const body = {
        username: edit.username.trim().toLowerCase(),
        name: edit.name.trim(),
        phone: edit.phone ? edit.phone.trim() : null,
        target_quota: Number(edit.target_quota) || 0,
      }
      if (edit.password.trim()) {
        body.password = edit.password.trim()
      }
      const res = await updateUser(user.id, body)
      if (user.role === 'surveyor' || user.role === 'field') {
        const cur = (user.surveys || []).map((s) => Number(s.id))
        const next = Array.isArray(edit.surveys)
          ? edit.surveys.map(Number)
          : []
        const same =
          cur.length === next.length &&
          [...cur].sort().join() === [...next].sort().join()
        if (!same) {
          try {
            await setSurveySurveyors(user.id, next)
            onToast?.(`Assigned surveys updated for @${user.username}`, 'ok')
          } catch (e) {
            onToast?.(`Surveys assign failed: ${e.message}`, 'error')
          }
        }
      }
      const parts = ['Saved']
      if (res.username_changed) parts.push('username updated')
      if (res.password_changed) parts.push('password updated · sessions revoked')
      if (res.sessions_revoked && !res.password_changed) parts.push('sessions revoked')
      onToast?.(parts.join(' · '), 'ok')
      if (res.password_changed && res.plain_password) {
        setLastGenerated([
          {
            username: res.user?.username || body.username,
            password: res.plain_password,
            name: res.user?.name || body.name,
            target_quota: body.target_quota,
          },
        ])
      }
      closeEdit()
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDisable(user) {
    if (
      !confirm(
        `Disable @${user.username}? They cannot log into the field app. Active sessions will be revoked.`,
      )
    ) {
      return
    }
    try {
      await disableUser(user.id)
      onToast?.(`Disabled @${user.username} · access revoked`, 'ok')
      if (editingId === user.id) closeEdit()
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    }
  }

  async function handleEnable(user) {
    try {
      await enableUser(user.id)
      onToast?.(`Enabled @${user.username} · app login OK`, 'ok')
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    }
  }

  async function handleRevoke(user) {
    if (
      !confirm(
        `Revoke all sessions for @${user.username}? They must sign in again on the field app.`,
      )
    ) {
      return
    }
    try {
      await revokeUserSessions(user.id)
      onToast?.(`Sessions revoked for @${user.username}`, 'ok')
    } catch (e) {
      onToast?.(e.message, 'error')
    }
  }

  async function handleDelete(user) {
    if (
      !confirm(
        `DELETE @${user.username} permanently? Prefer Disable. This cannot be undone.`,
      )
    ) {
      return
    }
    try {
      await deleteUser(user.id)
      onToast?.(`Deleted @${user.username}`, 'ok')
      if (editingId === user.id) closeEdit()
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    }
  }

  async function handleToggleVerify(user) {
    try {
      const next = !user.verified
      await updateUser(user.id, { verified: next })
      onToast?.(`Surveyor @${user.username} ${next ? 'Verified ✓' : 'Unverified'}`, 'ok')
      if (profileUser && String(profileUser.id) === String(user.id)) {
        setProfileUser((prev) => (prev ? { ...prev, verified: next } : null))
      }
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    }
  }

  async function handleAdminUploadMedia(fieldKey, file) {
    if (!file || !profileUser) return
    try {
      const { uploadProfileMedia } = await import('./api')
      const compressedDataUrl = await compressImageFile(file, 1200, 0.75)
      const res = await uploadProfileMedia(fieldKey, compressedDataUrl, profileUser.id)
      const newUrl = res?.[fieldKey] || compressedDataUrl
      setProfileUser((prev) => (prev ? { ...prev, [fieldKey]: newUrl } : null))
      onToast?.(`Uploaded ${fieldKey.replace('_', ' ')} to DB ✓`, 'ok')
      load()
    } catch (err) {
      onToast?.(err.message || 'Upload failed', 'error')
    }
  }

  async function setUserQuota(user, target) {
    try {
      await updateUser(user.id, { target_quota: Number(target) || 0 })
      onToast?.(`${user.username} target → ${target}`, 'ok')
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    }
  }

  async function applyBulkQuota() {
    setSaving(true)
    try {
      await setProgressQuota({ all_surveyors: true, target: Number(bulkTarget) || 0 })
      onToast?.(`All surveyors target = ${bulkTarget}`, 'ok')
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // Always build list from /api/users so newly created usernames always appear
  const surveyorsFromUsers = users.filter(
    (u) => u.role === 'surveyor' || u.role === 'field',
  )
  const surveyorRows = surveyorsFromUsers
    .map((u) => {
      const fromBoard = (board?.surveyors || []).find(
        (b) => b.id === u.id || String(b.username).toLowerCase() === String(u.username).toLowerCase(),
      )
      const username = String(u.username || fromBoard?.username || '').trim()
      return {
        ...u,
        // progress only from board — never wipe username/name from users API
        done: fromBoard?.done ?? u.done ?? 0,
        target: fromBoard?.target ?? u.target_quota ?? 0,
        target_quota: u.target_quota ?? fromBoard?.target ?? 0,
        pct: fromBoard?.pct,
        status:
          u.active === false
            ? 'disabled'
            : fromBoard?.status || u.status || 'not_started',
        progress_label:
          fromBoard?.label ||
          fromBoard?.progress_label ||
          u.progress_label ||
          `${fromBoard?.done ?? u.done ?? 0}/${u.target_quota || fromBoard?.target || '—'}`,
        username,
        name: u.name || fromBoard?.name || username,
        id: u.id,
        active: u.active !== false,
        role: u.role || 'surveyor',
      }
    })
    // Newest first so create/generate shows at the top
    .sort((a, b) => Number(b.id) - Number(a.id))

  const admins = users.filter((u) => u.role === 'admin')
  const statusColor = (s) => {
    if (s === 'completed') return 'ok'
    if (s === 'in_progress') return 'warn'
    if (s === 'admin') return 'ok'
    if (s === 'disabled') return 'bad'
    return 'bad'
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h2>Client Admin · Surveyors</h2>
        <p>
          Create surveyor logins · bulk create with surveys · per-surveyor profile with
          day / month / geo filters
        </p>
      </header>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="stat-row" style={{ marginBottom: 10 }}>
          <div className="stat">
            <strong>{board?.totals?.surveyors ?? '—'}</strong>
            <span>Surveyors</span>
          </div>
          <div className="stat">
            <strong>{board?.totals?.done ?? '—'}</strong>
            <span>Records done</span>
          </div>
          <div className="stat">
            <strong>{board?.totals?.targets ?? '—'}</strong>
            <span>Total targets</span>
          </div>
          <div className="stat">
            <strong>{board?.totals?.completed_users ?? '—'}</strong>
            <span>Completed</span>
          </div>
          <div className="stat">
            <strong>{board?.totals?.in_progress ?? '—'}</strong>
            <span>In progress</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 12 }}>
            Set ALL surveyors target:
          </span>
          <input
            type="number"
            min={0}
            value={bulkTarget}
            onChange={(e) => setBulkTarget(Number(e.target.value) || 0)}
            style={{ width: 80 }}
            aria-label="All surveyors target"
          />
          <button
            type="button"
            className="btn small primary"
            disabled={saving}
            onClick={applyBulkQuota}
          >
            Apply to all
          </button>
          <button type="button" className="btn small" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      <div className="admin-subtabs">
        <button
          type="button"
          className={tab === 'create' ? 'map-tab active' : 'map-tab'}
          onClick={() => setTab('create')}
        >
          1 · Create surveyor
        </button>
        <button
          type="button"
          className={tab === 'bulk' ? 'map-tab active' : 'map-tab'}
          onClick={() => setTab('bulk')}
        >
          2 · Bulk create
        </button>
        <button
          type="button"
          className={tab === 'profiles' ? 'map-tab active' : 'map-tab'}
          onClick={() => setTab('profiles')}
        >
          3 · Surveyor profiles
        </button>
      </div>

      <div className="card" style={{ marginBottom: 14, padding: '12px 14px' }}>
        <p style={{ margin: 0, fontSize: 13 }}>
          <strong>Edit</strong> username or password anytime. <strong>Disable</strong> blocks
          app login. <strong>Revoke</strong> kills active sessions (force re-login). Prefer
          Disable over Delete.
        </p>
      </div>

      {tab === 'bulk' && (
        <form className="card" onSubmit={handleGenerate} style={{ marginBottom: 14 }}>
          <h3>Bulk create surveyors</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Option A: type one username per line (or comma separated) — exact usernames.
            Option B: leave blank and use count + prefix below.
          </p>
          <label className="field">
            <span>Usernames (one per line / comma separated)</span>
            <textarea
              rows={5}
              value={gen.usernames_list}
              onChange={(e) => setGen({ ...gen, usernames_list: e.target.value })}
              placeholder={'sravan\nravi\nanil\n'}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </label>
          <label className="field">
            <span>How many users (1–100) — only when usernames list is empty</span>
            <input
              type="number"
              min={1}
              max={100}
              value={gen.count}
              onChange={(e) => setGen({ ...gen, count: Number(e.target.value) || 1 })}
            />
          </label>
          <label className="field">
            <span>Username prefix — only when usernames list is empty</span>
            <input
              value={gen.prefix}
              onChange={(e) => setGen({ ...gen, prefix: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Records each must complete (target)</span>
            <input
              type="number"
              min={0}
              value={gen.target_quota}
              onChange={(e) =>
                setGen({ ...gen, target_quota: Number(e.target.value) || 0 })
              }
            />
          </label>
          <label className="field">
            <span>Password (batch — same for all)</span>
            <input
              value={gen.password}
              onChange={(e) => setGen({ ...gen, password: e.target.value })}
            />
          </label>
          <div className="field">
            <span>Assign surveys to all created users (multiple)</span>
            <p className="muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>
              Pick one or more surveys — every created surveyor gets all of them. None
              selected = default Field Survey form on the app.
            </p>
            <SurveySelect
              value={gen.surveys}
              onChange={(ids) => setGen((g) => ({ ...g, surveys: ids }))}
              all={allSurveys}
            />
          </div>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Generating…' : 'Create surveyors + assign surveys'}
          </button>
        </form>
      )}

      {tab === 'create' && (
        <form className="card" onSubmit={handleCreate} style={{ marginBottom: 14 }}>
          <h3>Add one surveyor</h3>
          <label className="field">
            <span>Role</span>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="surveyor">Surveyor (field app)</option>
              <option value="admin">Admin (portal)</option>
            </select>
          </label>
          {form.role === 'surveyor' && (
            <label className="field">
              <span>Target records</span>
              <input
                type="number"
                min={0}
                value={form.target_quota}
                onChange={(e) =>
                  setForm({ ...form, target_quota: Number(e.target.value) || 0 })
                }
              />
            </label>
          )}
          {form.role === 'surveyor' && (
            <div className="field">
              <span>Assign surveys (multiple, optional)</span>
              <p className="muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>
                None selected = surveyor uses the default Field Survey form on the app.
              </p>
              <SurveySelect
                value={form.surveys}
                onChange={(ids) => setForm((f) => ({ ...f, surveys: ids }))}
                all={allSurveys}
              />
            </div>
          )}
          <label className="field">
            <span>Username * (field app login — stored lowercase)</span>
            <input
              required
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="e.g. s010 or ravi01"
            />
          </label>
          <label className="field">
            <span>Display name</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Password *</span>
            <input
              required
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <button type="submit" className="btn primary" disabled={saving}>
            Create
          </button>
        </form>
      )}

      {lastGenerated.length > 0 && (
        <div
          id="created-credentials"
          className="card"
          style={{
            marginBottom: 14,
            borderColor: 'rgba(0, 229, 153, 0.45)',
            boxShadow: '0 0 0 1px rgba(0, 229, 153, 0.2)',
          }}
        >
          <h3>Just created — app logins</h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Username is the field-app login (usually lowercase). Copy password now — it is not
            shown again later.
          </p>
          <ul className="user-list">
            {lastGenerated.map((u) => (
              <li key={u.username || u.name}>
                <div style={{ width: '100%' }}>
                  <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 2 }}>
                    Username (login)
                  </div>
                  <strong style={{ fontSize: 18, fontFamily: 'ui-monospace, monospace' }}>
                    {u.username || '—'}
                  </strong>
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    Password:{' '}
                    <code style={{ fontSize: 15 }}>{u.password || '—'}</code>
                  </div>
                  <span className="meta">
                    {u.name && u.name !== u.username ? `Name: ${u.name} · ` : ''}
                    {u.target_quota != null ? `target ${u.target_quota}` : ''}
                  </span>
                </div>
                <span className="pill ok">
                  <span className="dot" />
                  ready for app
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'profiles' && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3>
            Surveyors ({surveyorRows.length}) · Admins ({admins.length})
          </h3>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : surveyorRows.length === 0 ? (
            <p className="muted">
              No surveyors yet. Use <strong>Bulk create</strong> or{' '}
              <strong>Create surveyor</strong>.
            </p>
          ) : (
          <ul className="user-list">
            {surveyorRows.map((u) => {
              const done = u.done ?? 0
              const target = u.target ?? u.target_quota ?? 0
              const status =
                u.active === false
                  ? 'disabled'
                  : u.status || 'not_started'
              const pct = u.pct ?? (target > 0 ? Math.round((done / target) * 100) : 0)
              const isEditing = editingId === u.id
              const loginUser = u.username || '—'
              const justCreated = lastGenerated.some(
                (g) => String(g.username).toLowerCase() === String(loginUser).toLowerCase(),
              )

              return (
                <li
                  key={u.id || loginUser}
                  style={{
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    borderColor: justCreated ? 'rgba(0, 229, 153, 0.5)' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text)', marginBottom: 2 }}>
                        Username (app login)
                      </div>
                      <strong
                        style={{
                          fontSize: 17,
                          fontFamily: 'ui-monospace, monospace',
                          letterSpacing: '0.02em',
                        }}
                      >
                        {loginUser}
                      </strong>
                      <span className="meta">
                        {u.name && u.name !== loginUser ? `${u.name} · ` : ''}
                        {u.role || 'surveyor'} ·{' '}
                        {u.progress_label || `${done}/${target || '—'}`}
                        {u.active === false ? ' · DISABLED' : ' · app login OK'}
                        {justCreated ? ' · NEW' : ''}
                      </span>
                      {(u.surveys || []).length > 0 && (
                        <span className="meta" style={{ display: 'block', marginTop: 2 }}>
                          Surveys: {(u.surveys || []).map((s) => s.title).join(' · ')}
                        </span>
                      )}
                      {u.phone && (
                        <span className="meta" style={{ display: 'block', marginTop: 3, fontSize: 13, color: '#38bdf8', fontWeight: 'bold' }}>
                          📞 Mobile: {u.phone}
                        </span>
                      )}
                    </div>
                    {u.verified && (
                      <span className="pill ok" style={{ background: '#059669', color: '#fff', marginLeft: 6, fontWeight: 'bold' }}>
                        Verified ✓
                      </span>
                    )}
                    <span className={`pill ${statusColor(status)}`}>
                      <span className="dot" />
                      {justCreated ? 'new' : status}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 8,
                      background: 'rgba(255,255,255,0.08)',
                      borderRadius: 99,
                      marginTop: 8,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min(100, pct || 0)}%`,
                        height: '100%',
                        background: status === 'completed' ? '#22c55e' : '#38bdf8',
                      }}
                    />
                  </div>

                  {isEditing ? (
                    <div className="user-edit-panel" style={{ marginTop: 12 }}>
                      <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>Edit login</h4>
                      <label className="field compact">
                        <span>Username</span>
                        <input
                          value={edit.username}
                          onChange={(e) => setEdit({ ...edit, username: e.target.value })}
                          autoCapitalize="none"
                          autoCorrect="off"
                        />
                      </label>
                      <label className="field compact">
                        <span>Display name</span>
                        <input
                          value={edit.name}
                          onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                        />
                      </label>
                      <label className="field compact">
                        <span>Mobile Phone Number</span>
                        <input
                          type="tel"
                          placeholder="+91 9876543210"
                          value={edit.phone || ''}
                          onChange={(e) => setEdit({ ...edit, phone: e.target.value })}
                        />
                      </label>
                      <label className="field compact">
                        <span>New password (leave blank to keep)</span>
                        <input
                          type="text"
                          value={edit.password}
                          onChange={(e) => setEdit({ ...edit, password: e.target.value })}
                          placeholder="•••• or type new password"
                          autoComplete="new-password"
                        />
                      </label>
                      <label className="field compact">
                        <span>Target records</span>
                        <input
                          type="number"
                          min={0}
                          value={edit.target_quota}
                          onChange={(e) =>
                            setEdit({
                              ...edit,
                              target_quota: Number(e.target.value) || 0,
                            })
                          }
                        />
                      </label>
                      <div className="user-actions" style={{ marginTop: 8 }}>
                        <button
                          type="button"
                          className="btn small primary"
                          disabled={saving}
                          onClick={() => saveEdit(u)}
                        >
                          {saving ? 'Saving…' : 'Save username / password'}
                        </button>
                        <button type="button" className="btn small" onClick={closeEdit}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="user-actions" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn small primary"
                      onClick={() => (isEditing ? closeEdit() : openEdit(u))}
                    >
                      {isEditing ? 'Close edit' : 'Edit login'}
                    </button>
                    <button
                      type="button"
                      className="btn small primary"
                      onClick={() => openProfile(u)}
                    >
                      Profile
                    </button>
                    <button
                      type="button"
                      className={`btn small ${u.verified ? 'ok' : 'primary'}`}
                      onClick={() => handleToggleVerify(u)}
                    >
                      {u.verified ? 'Verified ✓' : 'Verify Identity'}
                    </button>
                    <input
                      type="number"
                      min={0}
                      defaultValue={target}
                      style={{ width: 72 }}
                      id={`q-${u.id}`}
                      aria-label="Target"
                    />
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => {
                        const el = document.getElementById(`q-${u.id}`)
                        setUserQuota(u, el?.value)
                      }}
                    >
                      Set target
                    </button>
                    {u.active === false ? (
                      <button
                        type="button"
                        className="btn small primary"
                        onClick={() => handleEnable(u)}
                      >
                        Enable
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn small danger"
                        onClick={() => handleDisable(u)}
                      >
                        Disable
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => handleRevoke(u)}
                    >
                      Revoke sessions
                    </button>
                    <button
                      type="button"
                      className="btn small danger"
                      onClick={() => handleDelete(u)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {admins.length > 0 && (
          <>
            <h4 style={{ marginTop: 18 }}>Admins</h4>
            <ul className="user-list">
              {admins.map((u) => (
                <li key={u.id}>
                  <div>
                    <strong>{u.name || u.username}</strong>
                    <span className="meta">
                      @{u.username} · admin
                      {u.active === false ? ' · disabled' : ''}
                    </span>
                  </div>
                  <div className="user-actions">
                    <button type="button" className="btn small" onClick={() => openEdit(u)}>
                      Edit
                    </button>
                    {u.active !== false ? (
                      <button
                        type="button"
                        className="btn small danger"
                        onClick={() => handleDisable(u)}
                      >
                        Disable
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => handleEnable(u)}
                      >
                        Enable
                      </button>
                    )}
                  </div>
                  {editingId === u.id && (
                    <div className="user-edit-panel" style={{ marginTop: 10, width: '100%' }}>
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
                      {(user.role === 'surveyor' || user.role === 'field') && (
                        <div className="field compact">
                          <span>Assign surveys (optional)</span>
                          <p className="muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>
                            None = uses the default Field Survey form on the app.
                          </p>
                          <SurveySelect
                            value={edit.surveys}
                            onChange={(ids) => setEdit((ed) => ({ ...ed, surveys: ids }))}
                            all={allSurveys}
                          />
                        </div>
                      )}
                      <div className="user-actions">
                        <button
                          type="button"
                          className="btn small primary"
                          disabled={saving}
                          onClick={() => saveEdit(u)}
                        >
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
          </>
        )}
        </div>
      )}

      {tab === 'profiles' && (
        <div className="card">
          <div style={{ marginBottom: 14 }}>
            <label className="field">
              <span>Select Surveyor Profile</span>
              <select
                value={profileUser?.id || ''}
                onChange={(e) => {
                  const val = e.target.value
                  const found = surveyorRows.find((s) => String(s.id) === String(val))
                  if (found) openProfile(found)
                  else setProfileUser(null)
                }}
              >
                <option value="">-- Choose a surveyor --</option>
                {surveyorRows.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.username} (@{s.username}) {s.key_id ? `[${s.key_id}]` : ''} · {s.progress_label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {profileUser ? (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                background: 'rgba(0, 0, 0, 0.75)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
              onClick={() => setProfileUser(null)}
            >
              <div
                style={{
                  width: '100%',
                  maxWidth: 580,
                  height: '100%',
                  background: '#0f172a',
                  borderLeft: '1px solid #334155',
                  padding: 20,
                  overflowY: 'auto',
                  boxShadow: '-10px 0 30px rgba(0,0,0,0.5)',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 18, color: '#f8fafc' }}>👤 Surveyor Profile & Identity</h3>
                  <button
                    type="button"
                    className="btn small danger"
                    onClick={() => setProfileUser(null)}
                    style={{ fontSize: 14, padding: '4px 14px', fontWeight: 'bold' }}
                  >
                    Close ✕
                  </button>
                </div>

                {/* Profile Avatar, Key ID, Verified Badge & Action Button */}
                <div style={{ display: 'flex', gap: 14, alignItems: 'center', background: '#1e293b', padding: 14, borderRadius: 12, border: '1px solid #334155', marginBottom: 14 }}>
                  {profileUser.photo ? (
                    <img
                      src={profileUser.photo}
                      alt="Profile Photo"
                      style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '3px solid #00e599' }}
                    />
                  ) : (
                    <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>
                      👤
                    </div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <h4 style={{ margin: 0, fontSize: 18, color: '#ffffff' }}>
                        {profileUser.display_name || profileUser.name || profileUser.username}
                      </h4>
                      {profileUser.verified ? (
                        <span style={{ background: '#059669', color: '#fff', fontSize: 11, fontWeight: 'bold', padding: '2px 8px', borderRadius: 12 }}>
                          Verified ✓
                        </span>
                      ) : (
                        <span style={{ background: '#d97706', color: '#fff', fontSize: 11, fontWeight: 'bold', padding: '2px 8px', borderRadius: 12 }}>
                          Verification Pending ⏳
                        </span>
                      )}
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: '#94a3b8' }}>
                      @{profileUser.username} · Key ID: <strong style={{ color: '#00e599' }}>{profileUser.key_id || '—'}</strong>
                    </p>
                    <div style={{ margin: '5px 0 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, color: profileUser.phone ? '#38bdf8' : '#f59e0b', fontWeight: 'bold' }}>
                        📞 Mobile: {profileUser.phone || 'Not Provided'}
                      </span>
                      <button
                        type="button"
                        className="btn small"
                        style={{ fontSize: 11, padding: '2px 8px', background: '#334155', border: '1px solid #475569', color: '#ffffff', borderRadius: 6 }}
                        onClick={() => {
                          const next = prompt('Edit Mobile Phone Number for @' + profileUser.username + ':', profileUser.phone || '')
                          if (next !== null) {
                            updateUser(profileUser.id, { phone: next.trim() })
                              .then(() => {
                                setProfileUser((prev) => (prev ? { ...prev, phone: next.trim() } : null))
                                onToast?.(`Updated phone for @${profileUser.username} ✓`, 'ok')
                                load()
                              })
                              .catch((err) => onToast?.(err.message || 'Failed to update phone', 'error'))
                          }
                        }}
                      >
                        ✏️ Edit Phone
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn small"
                    style={{
                      background: profileUser.verified ? '#dc2626' : '#059669',
                      color: '#ffffff',
                      fontWeight: 'bold',
                      padding: '8px 16px',
                      fontSize: 12,
                      border: 0,
                    }}
                    onClick={() => handleToggleVerify(profileUser)}
                  >
                    {profileUser.verified ? 'Unverify' : 'Verify Identity ✓'}
                  </button>
                </div>

                {/* Metrics: Surveys Done / Approved / Pending */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                  <div style={{ background: '#1e293b', padding: '12px 10px', borderRadius: 10, textAlign: 'center', border: '1px solid #334155' }}>
                    <span style={{ display: 'block', fontSize: 22, fontWeight: '800', color: '#00e599' }}>
                      {profileData?.geoSummary?.records ?? (profileUser.done_count || 0)}
                    </span>
                    <span style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700' }}>
                      Surveys Done
                    </span>
                  </div>
                  <div style={{ background: '#1e293b', padding: '12px 10px', borderRadius: 10, textAlign: 'center', border: '1px solid #059669' }}>
                    <span style={{ display: 'block', fontSize: 22, fontWeight: '800', color: '#10b981' }}>
                      {profileData?.geoSummary?.confirmed ?? (profileUser.confirmed_count || 0)}
                    </span>
                    <span style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700' }}>
                      Approved ✓
                    </span>
                  </div>
                  <div style={{ background: '#1e293b', padding: '12px 10px', borderRadius: 10, textAlign: 'center', border: '1px solid #d97706' }}>
                    <span style={{ display: 'block', fontSize: 22, fontWeight: '800', color: '#f59e0b' }}>
                      {profileData?.items ? profileData.items.filter((it) => it.status === 'pending').length : (profileUser.pending_count || 0)}
                    </span>
                    <span style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700' }}>
                      Pending ⏳
                    </span>
                  </div>
                </div>

                {/* Aadhaar Cards */}
                <div style={{ background: '#1e293b', padding: 14, borderRadius: 10, border: '1px solid #334155', marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <h5 style={{ margin: 0, fontSize: 14, color: '#38bdf8', fontWeight: 'bold' }}>🪪 Aadhaar Identity Verification</h5>
                    <span style={{ fontSize: 11, color: profileUser.verified ? '#00e599' : '#f59e0b', fontWeight: 'bold' }}>
                      {profileUser.verified ? '✓ Identity Verified' : '⏳ Verification Pending'}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <span style={{ display: 'block', fontSize: 11, color: '#aaa', marginBottom: 6, fontWeight: 'bold' }}>Front Side</span>
                      {profileUser.aadhaar_front ? (
                        <a href={profileUser.aadhaar_front} target="_blank" rel="noreferrer">
                          <img src={profileUser.aadhaar_front} alt="Aadhaar Front" style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8, border: '2px solid #00e599', marginBottom: 6 }} />
                        </a>
                      ) : (
                        <div style={{ height: 100, background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px dashed #475569', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 12, marginBottom: 6 }}>
                          <span style={{ fontSize: 22, marginBottom: 2 }}>🪪</span>
                          <span>No Front Card Uploaded</span>
                        </div>
                      )}
                      <label className="btn small primary" style={{ display: 'block', width: '100%', boxSizing: 'border-box', cursor: 'pointer', textAlign: 'center', fontSize: 11, padding: '4px 8px' }}>
                        {profileUser.aadhaar_front ? 'Change Front' : 'Upload Front'}
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => handleAdminUploadMedia('aadhaar_front', e.target.files?.[0])}
                        />
                      </label>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: 11, color: '#aaa', marginBottom: 6, fontWeight: 'bold' }}>Back Side</span>
                      {profileUser.aadhaar_back ? (
                        <a href={profileUser.aadhaar_back} target="_blank" rel="noreferrer">
                          <img src={profileUser.aadhaar_back} alt="Aadhaar Back" style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8, border: '2px solid #00e599', marginBottom: 6 }} />
                        </a>
                      ) : (
                        <div style={{ height: 100, background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px dashed #475569', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 12, marginBottom: 6 }}>
                          <span style={{ fontSize: 22, marginBottom: 2 }}>🪪</span>
                          <span>No Back Card Uploaded</span>
                        </div>
                      )}
                      <label className="btn small primary" style={{ display: 'block', width: '100%', boxSizing: 'border-box', cursor: 'pointer', textAlign: 'center', fontSize: 11, padding: '4px 8px' }}>
                        {profileUser.aadhaar_back ? 'Change Back' : 'Upload Back'}
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => handleAdminUploadMedia('aadhaar_back', e.target.files?.[0])}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                {/* Filters */}
                <div
                  className="admin-subtabs"
                  style={{ justifyContent: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}
                >
                  {['total', 'today', 'day', 'month'].map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={profileFilters.period === p ? 'map-tab active' : 'map-tab'}
                      onClick={() =>
                        setProfileFilters((f) => ({ ...f, period: p }))
                      }
                    >
                      {p === 'total' ? 'Total' : p === 'today' ? 'Today' : p === 'day' ? 'Day' : 'Month'}
                    </button>
                  ))}
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-end',
                    flexWrap: 'wrap',
                    marginBottom: 12,
                  }}
                >
                  {profileFilters.period === 'day' && (
                    <label className="field compact">
                      <span>Day</span>
                      <input
                        type="date"
                        value={profileFilters.day}
                        onChange={(e) =>
                          setProfileFilters((f) => ({ ...f, day: e.target.value }))
                        }
                      />
                    </label>
                  )}
                  {profileFilters.period === 'month' && (
                    <label className="field compact">
                      <span>Month</span>
                      <input
                        type="month"
                        value={profileFilters.month}
                        onChange={(e) =>
                          setProfileFilters((f) => ({ ...f, month: e.target.value }))
                        }
                      />
                    </label>
                  )}
                  <label className="field compact" style={{ minWidth: 220 }}>
                    <span>Survey</span>
                    <select
                      value={profileFilters.survey}
                      onChange={(e) =>
                        setProfileFilters((f) => ({ ...f, survey: e.target.value }))
                      }
                    >
                      <option value="active">All Active Surveys (Excludes Legacy)</option>
                      {allSurveys.map((s) => (
                        <option key={s.id} value={s.form_key}>
                          {s.title}
                        </option>
                      ))}
                      <option value="all_with_legacy">Include Legacy Records</option>
                      <option value="legacy">Legacy Records Only</option>
                    </select>
                  </label>
                  <label className="field compact" style={{ minWidth: 160 }}>
                    <span>District</span>
                    <select
                      value={profileFilters.district}
                      onChange={(e) =>
                        setProfileFilters((f) => ({ ...f, district: e.target.value }))
                      }
                    >
                      <option value="">All districts</option>
                      {(profileData?.geoSummary?.districts || []).map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={profileLoading}
                    onClick={() => loadProfile(profileUser)}
                  >
                    {profileLoading ? 'Loading…' : 'Filter'}
                  </button>
                </div>

                {profileLoading ? (
                  <p className="muted">Loading records…</p>
                ) : profileData ? (
                  <>
                    {profileData.items.length === 0 ? (
                      <p className="muted">No records for this filter.</p>
                    ) : (
                      <ul className="user-list">
                        {profileData.items.map((it, i) => (
                          <li key={it.id || i} style={{ padding: '10px 12px', background: '#1e293b', borderRadius: 8, marginBottom: 8 }}>
                            <div>
                              <strong>#{it.record_index ?? it.id ?? i + 1}</strong>
                              <span className="meta" style={{ marginLeft: 8 }}>
                                {it.created_at || ''} · {it.form_key || 'field'}
                              </span>
                              <span className="meta" style={{ display: 'block', marginTop: 2 }}>
                                {it.answers?.district || 'no district'}
                                {it.answers?.constituency
                                  ? ` · ${it.answers.constituency}`
                                  : ''}
                              </span>
                            </div>
                            <span className={`pill ${it.status === 'confirmed' ? 'ok' : ''}`} style={{ background: it.status === 'confirmed' ? '#059669' : '#d97706', color: '#fff', fontWeight: 'bold' }}>
                              {it.status === 'confirmed' ? 'Approved ✓' : 'Pending ⏳'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="muted">Click Filter to load submission details.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="muted">Select a surveyor from the dropdown above or click <strong>View Profile</strong> on any surveyor in the list.</p>
          )}
        </div>
      )}
    </div>
  )
}
