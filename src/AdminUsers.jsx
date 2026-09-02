import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icons'
import {
  createSeatRequest,
  createSuperAdmin,
  resetSuperAdminTotp,
  seedSuperAdminSlots,
  createUser,
  deleteUser,
  disableUser,
  enableUser,
  generateUsers,
  getProgressBoard,
  getSeatRequests,
  getStoredUser,
  getUserSurveys,
  listSurveys,
  listUsers,
  revokeUserSessions,
  setProgressQuota,
  setUserSurveys,
  updateUser,
  apkDownloadUrl,
} from './api'
import VerifiedBadge from './VerifiedBadge'
import PhoneIndiaField from './PhoneIndiaField'
import ShareAppLink from './components/ShareAppLink'
import { digits10, isValidInMobile, toE164In, formatInMobile } from './phoneIn'
import { compressImageFile } from './mediaOptimize'

function formatIstStamp(v) {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return String(v).replace('T', ' ').replace('Z', '')
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d)
}

function surveyIdsOf(u) {
  return (Array.isArray(u?.surveys) ? u.surveys : [])
    .map((s) => {
      if (s == null) return ''
      if (typeof s === 'object' && s.id != null) return String(s.id)
      if (typeof s === 'number' || typeof s === 'string') return String(s)
      return ''
    })
    .filter((id) => id && id !== 'undefined' && id !== 'null')
}

function nextSurveyQuotas(prev, ids, fallback) {
  const next = {}
  const prevMap = prev && typeof prev === 'object' ? prev : {}
  const fb = Math.max(0, Number(fallback) || 0)
  for (const id of ids || []) {
    const sid = String(id)
    const cur = Number(prevMap[sid])
    next[sid] = Number.isFinite(cur) ? cur : fb
  }
  return next
}

function quotasPayload(ids, quotas, fallback) {
  const out = {}
  const fb = Math.max(0, Number(fallback) || 0)
  for (const id of ids || []) {
    const n = Number(quotas?.[String(id)])
    out[String(id)] = Number.isFinite(n) ? Math.max(0, n) : fb
  }
  return out
}

function SurveyQuotaFields({ surveyIds, all, quotas, onChange, fallback = 0 }) {
  const selected = (Array.isArray(all) ? all : []).filter((s) =>
    (surveyIds || []).map(String).includes(String(s.id)),
  )
  if (!selected.length) return null
  const total = selected.reduce((n, s) => {
    const v = Number(quotas?.[String(s.id)])
    return n + (Number.isFinite(v) ? v : Number(fallback) || 0)
  }, 0)
  const qTotal = selected.reduce((n, s) => n + (Number(s.question_count) || 0), 0)
  return (
    <div style={{ marginTop: 8 }}>
      {selected.map((s) => {
        const sid = String(s.id)
        const val = quotas?.[sid] ?? fallback
        return (
          <label key={sid} className="field compact" style={{ margin: '6px 0 0' }}>
            <span style={{ fontSize: 11 }}>
              Target records · {s.title || sid}
              {s.question_count ? ` · ${s.question_count} questions` : ''}
            </span>
            <input
              type="number"
              min={0}
              value={val}
              onChange={(e) => onChange(sid, Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
        )
      })}
      <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
        Total target {total}
        {qTotal ? ` · total questions ${qTotal}` : ''}
        {selected.length > 1
          ? ' · Home shows a stretched bar with one segment per survey'
          : ''}
      </p>
    </div>
  )
}

function SurveySelect({ value, onChange, all, inline = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const selected = Array.isArray(value) ? value.map(String) : []
  const list = Array.isArray(all) ? all : []

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!list.length) {
    return (
      <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
        No surveys yet — create them in the Surveys tab first.
      </p>
    )
  }

  const toggle = (id) => {
    const sid = String(id)
    onChange(selected.includes(sid) ? selected.filter((x) => x !== sid) : [...selected, sid])
  }

  const checks = list.map((s) => {
    const sid = String(s.id)
    const on = selected.includes(sid)
    return (
      <button
        key={sid}
        type="button"
        className="btn small"
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          margin: '2px 0',
          background: on ? 'rgba(0,229,153,0.15)' : undefined,
        }}
        onClick={() => toggle(sid)}
      >
        {s.title || sid}
        {on ? ' ✓' : ''}
      </button>
    )
  })

  if (inline) {
    return (
      <div>
        {checks}
        <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
          <button type="button" className="btn small" onClick={() => onChange(list.map((s) => String(s.id)))}>
            All
          </button>
          <button type="button" className="btn small" onClick={() => onChange([])}>
            Clear
          </button>
        </div>
      </div>
    )
  }

  const selectedTitles = list
    .filter((s) => selected.includes(String(s.id)))
    .map((s) => s.title || String(s.id))

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        className="btn small"
        style={{ width: '100%', textAlign: 'left' }}
        onClick={() => setOpen((o) => !o)}
      >
        {selectedTitles.length
          ? selectedTitles.join(' · ')
          : 'Select surveys…'}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            zIndex: 80,
            top: '100%',
            left: 0,
            marginTop: 4,
            minWidth: '100%',
            background: '#fff',
            color: '#222',
            border: '1px solid rgba(0,0,0,0.25)',
            borderRadius: 8,
            padding: 8,
            maxHeight: 220,
            overflowY: 'auto',
            boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
          }}
        >
          {checks}
          <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
            <button type="button" className="btn small" onClick={() => onChange(list.map((s) => String(s.id)))}>
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

export default function AdminUsersScreen({ onToast, user: portalUser, focusUserId, onFocusConsumed }) {
  const [users, setUsers] = useState([])
  const [board, setBoard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saBusy, setSaBusy] = useState(false)
  const [saUsername, setSaUsername] = useState('')
  const [saPassword, setSaPassword] = useState('')
  const [saName, setSaName] = useState('')
  const [totpSetup, setTotpSetup] = useState(null)
  const [seatData, setSeatData] = useState(null)
  const [seatRequestedLimit, setSeatRequestedLimit] = useState(10)
  const [seatReason, setSeatReason] = useState('')
  const [seatBusy, setSeatBusy] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [edit, setEdit] = useState({
    username: '',
    name: '',
    password: '',
    target_quota: 0,
    surveys: [],
    surveyQuotas: {},
  })
  const [gen, setGen] = useState({
    count: 10,
    prefix: 's',
    password: 'survey123',
    target_quota: 20,
    surveys: [],
    surveyQuotas: {},
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
    phone: '',
    surveys: [],
    surveyQuotas: {},
  })
  const [allSurveys, setAllSurveys] = useState([])
  const [tab, setTab] = useState('create') // create | bulk | profiles
  const [profileUser, setProfileUser] = useState(null)
  const [profileData, setProfileData] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileSurveys, setProfileSurveys] = useState([])
  const [profileForm, setProfileForm] = useState({
    name: '',
    username: '',
    phone: '',
    password: '',
    target_quota: 20,
  })
  const [profileQuotas, setProfileQuotas] = useState({})
  const [profileSaving, setProfileSaving] = useState(false)
  const drawerRef = useRef(null)
  const drawerPrevFocus = useRef(null)
  const [profileFilters, setProfileFilters] = useState({
    period: 'total',
    day: new Date().toISOString().slice(0, 10),
    month: new Date().toISOString().slice(0, 7),
    district: '',
    survey: '',
  })

  const load = useCallback(async (opts = {}) => {
    const silent = !!opts.silent
    if (!silent) setLoading(true)
    try {
      const [data, prog, seats] = await Promise.all([
        listUsers(),
        getProgressBoard().catch(() => null),
        getSeatRequests().catch(() => null),
      ])
      setUsers(data.users || [])
      setBoard(prog)
      if (seats) setSeatData(seats)
    } catch (e) {
      if (!silent) onToast?.(e.message, 'error')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [onToast])

  const loadSurveyList = useCallback(async (opts = {}) => {
    try {
      const svs = await listSurveys('')
      setAllSurveys(svs.items || [])
    } catch (e) {
      if (!opts.silent) onToast?.(`Could not load surveys: ${e.message}`, 'error')
    }
  }, [onToast])

  useEffect(() => {
    load()
    loadSurveyList()
  }, [load, loadSurveyList])

  // Auto-refresh progress so field completions appear without manual Refresh
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      void load({ silent: true })
      void loadSurveyList({ silent: true })
    }
    const id = setInterval(tick, 20_000)
    const onVis = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load, loadSurveyList])

  const closeProfile = useCallback(() => {
    setProfileUser(null)
    setProfileSurveys([])
    setProfileQuotas({})
  }, [])

  const profileId = profileUser?.id
  useEffect(() => {
    if (!profileId) return undefined
    drawerPrevFocus.current = document.activeElement
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    let panel = drawerRef.current
    const getFocusable = () =>
      panel
        ? [...panel.querySelectorAll(
            'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
          )]
        : []
    const focusFirst = () => {
      panel = drawerRef.current
      getFocusable()[0]?.focus()
    }
    const raf = window.requestAnimationFrame(focusFirst)
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeProfile()
        return
      }
      panel = drawerRef.current
      if (e.key !== 'Tab' || !panel) return
      const items = getFocusable()
      if (!items.length) return
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      window.cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      const prev = drawerPrevFocus.current
      if (prev && typeof prev.focus === 'function') {
        try {
          prev.focus()
        } catch {
          /* ignore */
        }
      }
    }
  }, [profileId, closeProfile])

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
    const surs = surveyIdsOf(u)
    setProfileSurveys(surs)
    const fromUser = {}
    for (const s of u.surveys || []) {
      if (s?.id == null) continue
      fromUser[String(s.id)] = Number(s.target_quota) || Number(u.target_quota ?? u.target) || 0
    }
    setProfileQuotas(fromUser)
    setProfileForm({
      name: u.display_name || u.name || '',
      username: u.username || '',
      phone: u.phone ? digits10(u.phone) : '',
      password: '',
      target_quota: Number(u.target_quota ?? u.target ?? 20) || 0,
    })
    setProfileData(null)
    const initialFilters = { period: 'total', district: '', survey: 'active', day: '', month: '' }
    setProfileFilters(initialFilters)
    setTab('profiles')
    loadProfile(u, initialFilters)
    getUserSurveys(u.id)
      .then((d) => {
        const ids = (d.items || []).map((s) => String(s.id)).filter(Boolean)
        if (ids.length) setProfileSurveys(ids)
        setProfileQuotas((prev) => {
          const next = { ...prev }
          for (const s of d.items || []) {
            if (s?.id == null) continue
            const qn = Number(s.target_quota) || 0
            if (qn > 0) next[String(s.id)] = qn
          }
          return next
        })
      })
      .catch(() => {})
  }

  async function handleSaveProfile(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault()
    if (!profileUser) return
    setProfileSaving(true)
    try {
      const displayName = profileForm.name.trim() || profileForm.username.trim()
      const uname = profileForm.username.trim().toLowerCase()
      if (!uname) {
        onToast?.('Username is required', 'error')
        setProfileSaving(false)
        return
      }

      const patch = {
        name: displayName,
        display_name: displayName,
        username: uname,
        target_quota: Number(profileForm.target_quota) || 0,
      }

      const rawPhone = (profileForm.phone || '').trim()
      if (rawPhone) {
        if (!isValidInMobile(rawPhone)) {
          onToast?.('Phone must be a valid 10-digit Indian mobile number', 'error')
          setProfileSaving(false)
          return
        }
        patch.phone = toE164In(rawPhone)
      } else {
        patch.phone = null
      }

      if (profileForm.password && profileForm.password.trim()) {
        if (profileForm.password.trim().length < 4) {
          onToast?.('Password must be at least 4 characters', 'error')
          setProfileSaving(false)
          return
        }
        patch.password = profileForm.password.trim()
      }

      if (canAssignSurveys && profileSurveys) {
        const ids = profileSurveys.map(Number)
        const quotas = quotasPayload(ids, profileQuotas, patch.target_quota)
        const total = Object.values(quotas).reduce((n, v) => n + (Number(v) || 0), 0)
        if (ids.length) patch.target_quota = total
        await updateUser(profileUser.id, patch)
        await setUserSurveys(profileUser.id, ids, { quotas })
      } else {
        await updateUser(profileUser.id, patch)
      }

      onToast?.(`Profile for @${uname} saved successfully! ✓`, 'ok')
      setProfileUser((prev) => (prev ? { ...prev, ...patch, phone: patch.phone, target_quota: patch.target_quota } : null))
      setProfileForm((prev) => ({ ...prev, password: '' }))
      await load({ silent: true })
    } catch (err) {
      onToast?.(err.message || 'Failed to save profile', 'error')
    } finally {
      setProfileSaving(false)
    }
  }

  const openedFocusId = useRef(null)
  useEffect(() => {
    if (focusUserId == null) {
      openedFocusId.current = null
      return
    }
    if (!users.length) return
    if (String(openedFocusId.current) === String(focusUserId)) return
    const u = users.find((x) => Number(x.id) === Number(focusUserId))
    if (!u) {
      onToast?.('That surveyor is not in your list', 'error')
      onFocusConsumed?.()
      return
    }
    openedFocusId.current = focusUserId
    try {
      openProfile(u)
    } catch (e) {
      onToast?.(e?.message || 'Could not open that profile', 'error')
    }
    onFocusConsumed?.()
  }, [focusUserId, users])

  function openEdit(u) {
    setEditingId(u.id)
    setEdit({
      username: u.username || '',
      name: u.name || u.display_name || '',
      phone: u.phone || '',
      password: '',
      target_quota: u.target ?? u.target_quota ?? 0,
      surveys: surveyIdsOf(u),
      surveyQuotas: nextSurveyQuotas(
        Object.fromEntries(
          (u.surveys || []).map((s) => [String(s.id), Number(s.target_quota) || Number(u.target_quota) || 0]),
        ),
        surveyIdsOf(u),
        u.target ?? u.target_quota ?? 0,
      ),
    })
  }

  function closeEdit() {
    setEditingId(null)
    setEdit({ username: '', name: '', phone: '', password: '', target_quota: 0, surveys: [], surveyQuotas: {} })
  }

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    // Capture before clearing form
    const typedUser = form.username.trim()
    const typedPass = form.password
    const typedName = (form.name || form.username).trim()
    const typedQuota = form.target_quota
    const typedPhone = form.phone ? toE164In(form.phone) : ''
    // Client Admin surveyor creation is always a surveyor — admin accounts are created
    // exclusively by Super Admin in the Super Admin console (Client Admins tab).
    const typedRole = 'surveyor'
    if (form.phone && !isValidInMobile(form.phone)) {
      onToast?.('Surveyor phone must be +91 and 10 digits', 'error')
      setSaving(false)
      return
    }
    try {
      const body = {
        username: typedUser,
        password: typedPass,
        name: typedName || typedUser,
        role: typedRole,
        target_quota: typedQuota,
        ...(typedPhone ? { phone: typedPhone } : {}),
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
            const quotas = quotasPayload(surveyIds, form.surveyQuotas, typedQuota)
            await setUserSurveys(created.id, surveyIds, { quotas })
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
        phone: '',
        surveys: [],
        surveyQuotas: {},
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
                await setUserSurveys(u.id, genSurveyIds, {
                  quotas: quotasPayload(genSurveyIds, gen.surveyQuotas, gen.target_quota),
                })
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
      if (edit.phone && !isValidInMobile(edit.phone)) {
        onToast?.('Surveyor phone must be +91 and 10 digits', 'error')
        setSaving(false)
        return
      }
      const body = {
        username: edit.username.trim().toLowerCase(),
        name: edit.name.trim(),
        phone: edit.phone ? toE164In(edit.phone) : null,
        target_quota: Number(edit.target_quota) || 0,
      }
      if (edit.password.trim()) {
        body.password = edit.password.trim()
      }
      const res = await updateUser(user.id, body)
      if (user.role === 'surveyor' || user.role === 'field') {
        const next = Array.isArray(edit.surveys)
          ? edit.surveys.map(Number)
          : []
        try {
          const quotas = quotasPayload(next, edit.surveyQuotas, edit.target_quota)
          const total = Object.values(quotas).reduce((n, v) => n + (Number(v) || 0), 0)
          if (next.length) {
            await updateUser(user.id, { ...body, target_quota: total })
          }
          await setUserSurveys(user.id, next, { quotas })
          onToast?.(`Assigned surveys updated for @${user.username}`, 'ok')
        } catch (e) {
          onToast?.(`Surveys assign failed: ${e.message}`, 'error')
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
    if (!canVerify) {
      onToast?.('Super Admin has not granted your account surveyor-verification rights', 'error')
      return
    }
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
      const compressedDataUrl = await compressImageFile(file)
      const res = await uploadProfileMedia(fieldKey, compressedDataUrl, profileUser.id)
      const newUrl = res?.[fieldKey] || compressedDataUrl
      setProfileUser((prev) => (prev ? { ...prev, [fieldKey]: newUrl } : null))
      onToast?.(`Uploaded ${fieldKey.replace('_', ' ')} to DB ✓`, 'ok')
      load()
    } catch (err) {
      onToast?.(err.message || 'Upload failed', 'error')
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
  const surveyorRows = useMemo(() => {
    return users
      .filter((u) => u.role === 'surveyor' || u.role === 'field')
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
      .sort((a, b) => Number(b.id) - Number(a.id))
  }, [users, board])

  const me = useMemo(() => portalUser || getStoredUser(), [portalUser])
  const allotCap = Number(me?.max_records) || 0
  const allotUsed = Number(board?.totals?.done ?? me?.record_count ?? me?.surveyor_record_count) || 0
  const allotLeft = allotCap > 0 ? Math.max(0, allotCap - allotUsed) : null
  const allotPct = allotCap > 0 ? Math.min(100, Math.round((allotUsed / allotCap) * 100)) : 0
  const admins = useMemo(
    () => users.filter((u) => u.role === 'admin' || u.role === 'super_admin'),
    [users],
  )

  /** Create a Super Admin (max 3 platform-wide). First-setup form uses inline inputs;
   *  the Super Admin panel falls back to prompts. */
  const createSuperAdminAcct = async () => {
    const username = saUsername.trim() || window.prompt('Super Admin username (unique, lowercase):', '')
    const password = saPassword || window.prompt('Super Admin password (min 8 characters):', '')
    if (!username || !password) return
    setSaBusy(true)
    try {
      const res = await createSuperAdmin({
        username: username.trim().toLowerCase(),
        password,
        name: saName.trim() || 'Super Admin',
      })
      setTotpSetup(res)
      onToast?.('Slot created — scan TOTP before that account signs in', 'ok')
      setSaUsername('')
      setSaPassword('')
      setSaName('')
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setSaBusy(false)
    }
  }
  const resetSlotTotp = async (sa) => {
    if (!window.confirm(`Reset authenticator for @${sa.username}? They must scan a new secret.`)) return
    setSaBusy(true)
    try {
      const res = await resetSuperAdminTotp(sa.id)
      setTotpSetup(res)
      onToast?.('New TOTP secret — save it now', 'ok')
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setSaBusy(false)
    }
  }
  const surveyChoices = useMemo(() => {
    const byId = new Map()
    for (const s of allSurveys) {
      const id = Number(s?.id)
      if (!Number.isFinite(id)) continue
      byId.set(id, {
        id,
        title: s.title,
        form_key: s.form_key,
        question_count: Number(s.question_count) || 0,
        submissions: Number(s.submissions) || 0,
      })
    }
    for (const u of users) {
      for (const s of u.surveys || []) {
        const id = Number(s?.id)
        if (!Number.isFinite(id) || byId.has(id)) continue
        byId.set(id, {
          id,
          title: s.title,
          form_key: s.form_key,
          question_count: Number(s.question_count) || 0,
          submissions: Number(s.submissions) || 0,
        })
      }
    }
    return [...byId.values()]
  }, [allSurveys, users])

  const surveysForAssign = (selected = []) => {
    const sel = new Set((selected || []).map(String))
    return surveyChoices.filter(
      (s) => (Number(s.question_count) || 0) > 0 || sel.has(String(s.id)),
    )
  }

  const surveysWithSubmissions = useMemo(
    () => surveyChoices.filter((s) => (Number(s.submissions) || 0) > 0),
    [surveyChoices],
  )

  const superAdmins = users.filter((u) => u.role === 'super_admin')
  const saSlots = [0, 1, 2].map((i) => superAdmins[i] || null)

  const submitSeatRequest = async () => {
    setSeatBusy(true)
    try {
      await createSeatRequest({
        requested_limit: Number(seatRequestedLimit) || 10,
        reason: seatReason,
      })
      onToast?.('Seat upgrade request sent to Super Admin ✓', 'ok')
      setSeatReason('')
      const seats = await getSeatRequests()
      setSeatData(seats)
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setSeatBusy(false)
    }
  }

  const seatPending = (seatData?.requests || []).filter((r) => r.status === 'pending')
  const seatDecided = (seatData?.requests || []).filter((r) => r.status !== 'pending')
  const currentAdmins = seatData?.current_admins ?? 0
  const approvedLimit = seatData?.limits?.approved_limit != null ? Number(seatData.limits.approved_limit) : 5

  // Grant-based powers (least privilege): Super Admin grants/revokes each per Client Admin.
  // Super Admin always has every power; the server enforces these on every relevant endpoint.
  const POWER_DEFS = [
    { key: 'can_manage_questions', label: 'Q-Bank', icon: '📚' },
    { key: 'can_edit_surveys', label: 'Survey questions', icon: '▤' },
    { key: 'can_review_data', label: 'Data review', icon: '✓' },
    { key: 'can_verify_surveyors', label: 'Verify surveyors', icon: '🛡' },
    { key: 'can_assign_surveyors', label: 'Assign surveys', icon: '👥' },
    { key: 'can_crud_questionnaire', label: 'CRUD questionnaire', icon: '🗂' },
    { key: 'can_validate_proof', label: 'Proof validation', icon: '📞' },
    { key: 'can_web_survey', label: 'Web survey', icon: '✎' },
    { key: 'can_record_voice', label: 'Voice recording', icon: '🎙' },
    { key: 'can_translate_telugu', label: 'Telugu translation', icon: 'తె' },
  ]
  const powersOf = (u) => (u.role === 'admin' ? POWER_DEFS.filter((p) => u[p.key]) : [])
  const canVerify = me?.role === 'super_admin' || !!me?.can_verify_surveyors
  const canSeeIdDocs =
    me?.role === 'super_admin' || !!me?.can_verify_surveyors || !!me?.can_validate_proof
  const canAssignSurveys = me?.role === 'admin' && !!me?.can_assign_surveyors
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
        <h2>{me?.role === 'super_admin' ? 'Super Admin' : 'Client Admin'} · Surveyors</h2>
        <p>
          Create surveyor logins · open a surveyor profile to assign surveys · filters by
          day / month / geo
        </p>
      </header>

      <ShareAppLink onToast={onToast} />

      {/* Quota Allocation Banner for Client Admin */}
      {me?.role === 'admin' && (
        <div
          className="card"
          style={{
            marginBottom: 14,
            padding: '14px 16px',
            background: 'linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%)',
            border: '1px solid #bbf7d0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Used / Allocated
              </div>
              <strong style={{ fontSize: 18, color: '#0f172a' }}>
                {allotCap > 0 ? (
                  <>
                    <span style={{ color: '#059669' }}>{allotUsed}</span> of {allotCap.toLocaleString()} used
                  </>
                ) : (
                  <>
                    <span style={{ color: '#059669' }}>{allotUsed}</span> used (Unlimited allocated)
                  </>
                )}
              </strong>
            </div>
            {allotCap > 0 && (
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: allotLeft === 0 ? '#dc2626' : '#059669' }}>
                  {allotLeft.toLocaleString()} remaining
                </span>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  {allotPct}% quota consumed
                </div>
              </div>
            )}
          </div>

          {allotCap > 0 && (
            <div style={{ height: 8, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${allotPct}%`,
                  height: '100%',
                  background: allotPct >= 100 ? '#dc2626' : allotPct >= 80 ? '#f59e0b' : '#059669',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="stat-row" style={{ marginBottom: 10 }}>
          <div className="stat">
            <strong>{board?.totals?.surveyors ?? '—'}</strong>
            <span>Surveyors</span>
          </div>
          <div className="stat">
            <strong>
              {allotCap > 0 ? `${allotUsed} / ${allotCap}` : (board?.totals?.done ?? '—')}
            </strong>
            <span>{allotCap > 0 ? 'Used / Allocated' : 'Records done'}</span>
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

      {/* Super Admin management only on Super Admin console — never in Client Admin portal */}
      {me?.role === 'super_admin' && (
        <div className="card" style={{ marginBottom: 14, border: '1px solid rgba(245,158,11,0.45)' }}>
          <h3 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="star" size={16} /> Super Admin slots (3) · TOTP
          </h3>
          <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>
            {superAdmins.length} of 3 seats used. Logins: <strong>superadmin</strong>,{' '}
            <strong>superadmin2</strong>, <strong>superadmin3</strong>. New seats start as{' '}
            <code>admin123</code> + TOTP — they change password in Profile. Your existing
            password is never overwritten.
          </p>
          {superAdmins.length < 3 && (
            <button
              type="button"
              className="btn small primary"
              style={{ marginBottom: 10 }}
              disabled={saBusy}
              onClick={async () => {
                setSaBusy(true)
                try {
                  const res = await seedSuperAdminSlots()
                  onToast?.(res.note || `Created ${(res.created || []).join(', ') || 'none'}`, 'ok')
                  await load()
                } catch (e) {
                  onToast?.(e.message, 'error')
                } finally {
                  setSaBusy(false)
                }
              }}
            >
              {saBusy ? 'Creating…' : 'Create remaining slots (admin123)'}
            </button>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {saSlots.map((sa, i) => (
              <div
                key={sa?.id || `empty-${i}`}
                style={{
                  border: '1px solid #fde68a',
                  borderRadius: 10,
                  padding: 12,
                  background: sa ? 'rgba(245,158,11,0.08)' : '#fffbeb',
                }}
              >
                <strong style={{ fontSize: 13 }}>Slot {i + 1}</strong>
                {sa ? (
                  <>
                    <p style={{ margin: '6px 0 4px', fontSize: 14 }}>
                      {sa.name || sa.username}
                    </p>
                    <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                      @{sa.username}
                      {sa.totp_enabled ? ' · TOTP on' : ' · TOTP pending first login'}
                    </p>
                    <button
                      type="button"
                      className="btn small"
                      style={{ marginTop: 8 }}
                      disabled={saBusy}
                      onClick={() => void resetSlotTotp(sa)}
                    >
                      Reset TOTP
                    </button>
                  </>
                ) : (
                  <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>Empty</p>
                )}
              </div>
            ))}
          </div>
          {superAdmins.length < 3 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'flex-end' }}>
              <label className="field compact">
                <span>Username</span>
                <input value={saUsername} onChange={(e) => setSaUsername(e.target.value)} placeholder="slot username" />
              </label>
              <label className="field compact">
                <span>Name</span>
                <input value={saName} onChange={(e) => setSaName(e.target.value)} placeholder="Super Admin" />
              </label>
              <label className="field compact">
                <span>Password</span>
                <input type="password" value={saPassword} onChange={(e) => setSaPassword(e.target.value)} placeholder="min 8 chars" />
              </label>
              <button
                type="button"
                className="btn small primary"
                disabled={saBusy || !saUsername.trim() || saPassword.length < 8}
                onClick={() => void createSuperAdminAcct()}
              >
                {saBusy ? 'Creating…' : `Fill slot ${superAdmins.length + 1}`}
              </button>
            </div>
          )}
          {totpSetup?.totp_secret ? (
            <div className="card" style={{ marginTop: 12, background: '#fffbeb', border: '1px solid #fbbf24' }}>
              <p style={{ margin: '0 0 6px', fontWeight: 700 }}>
                Save this authenticator secret now — it is not shown again
              </p>
              <p className="muted" style={{ margin: '0 0 6px', fontSize: 12 }}>
                @{totpSetup.account || totpSetup.user?.username} · add in Google Authenticator / Authy as Smart Survey X
              </p>
              <code style={{ display: 'block', wordBreak: 'break-all', fontWeight: 700 }}>
                {totpSetup.totp_secret}
              </code>
              {totpSetup.otpauth_url ? (
                <a href={totpSetup.otpauth_url} style={{ display: 'inline-block', marginTop: 8, fontSize: 12 }}>
                  Open otpauth link
                </a>
              ) : null}
              <button type="button" className="btn small" style={{ marginTop: 8, marginLeft: 8 }} onClick={() => setTotpSetup(null)}>
                Dismiss
              </button>
            </div>
          ) : null}
        </div>
      )}

      {me?.role === 'admin' && (
        <div className="card" style={{ marginBottom: 14, border: '1px solid rgba(56,189,248,0.45)' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div>
              <h3 style={{ margin: '0 0 4px' }}>🪑 Admin seat limit</h3>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                {currentAdmins} of {approvedLimit} admin seats used. Request an upgrade; Super Admin
                approves it (BR-006).
              </p>
            </div>
            {seatPending.length > 0 && (
              <span
                className="pill"
                style={{ fontSize: 11, fontWeight: 'bold', background: 'rgba(217,119,6,0.12)', border: '1px solid rgba(217,119,6,0.5)', color: '#d97706' }}
              >
                ⏳ {seatPending.length} pending request{seatPending.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          {seatPending.length === 0 ? (
            <form
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                marginTop: 10,
                alignItems: 'flex-end',
              }}
              onSubmit={(e) => {
                e.preventDefault()
                void submitSeatRequest()
              }}
            >
              <label className="field compact" style={{ width: 130 }}>
                <span>Requested seats</span>
                <input
                  type="number"
                  min={currentAdmins + 1}
                  value={seatRequestedLimit}
                  onChange={(e) => setSeatRequestedLimit(Number(e.target.value) || 10)}
                />
              </label>
              <label className="field compact" style={{ flex: 1, minWidth: 200 }}>
                <span>Reason</span>
                <input
                  value={seatReason}
                  onChange={(e) => setSeatReason(e.target.value)}
                  placeholder="e.g. new team joining next month"
                />
              </label>
              <button type="submit" className="btn small primary" disabled={seatBusy}>
                {seatBusy ? 'Sending…' : 'Request upgrade'}
              </button>
            </form>
          ) : (
            <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13 }}>
              {seatPending.map((r) => (
                <li key={r.id}>
                  Pending: {r.requested_limit} admin seats
                  {r.reason ? ` — “${r.reason}”` : ''} (sent{' '}
                  {new Date(r.created_at).toLocaleDateString()})
                </li>
              ))}
            </ul>
          )}
          {seatDecided.length > 0 && (
            <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
              Recent decisions:{' '}
              {seatDecided.slice(0, 3).map((r) => `${r.requested_limit} seats ${r.status}${r.decided_by_name ? ` by ${r.decided_by_name}` : ''}`).join(' · ')}
            </p>
          )}
        </div>
      )}

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
            <span>Default target records per assigned survey</span>
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
            <span>Assign surveys to all created users (required on the phone)</span>
            <p className="muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>
              Pick one or more surveys — every created surveyor gets all of them. Set a
              different target on each survey. Collect will not start until at least one
              survey is assigned.
            </p>
            <SurveySelect
              value={gen.surveys}
              onChange={(ids) =>
                setGen((g) => ({
                  ...g,
                  surveys: ids,
                  surveyQuotas: nextSurveyQuotas(g.surveyQuotas, ids, g.target_quota),
                }))
              }
              all={surveysForAssign(gen.surveys)}
            />
            <SurveyQuotaFields
              surveyIds={gen.surveys}
              all={surveysForAssign(gen.surveys)}
              quotas={gen.surveyQuotas}
              fallback={gen.target_quota}
              onChange={(sid, n) =>
                setGen((g) => ({ ...g, surveyQuotas: { ...g.surveyQuotas, [sid]: n } }))
              }
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
            <span>
              Default target per survey
              {allotCap > 0 ? ` (allotted ${allotUsed}/${allotCap}, ${allotLeft} left)` : ''}
            </span>
            <input
              type="number"
              min={0}
              value={form.target_quota}
              onChange={(e) =>
                setForm({ ...form, target_quota: Number(e.target.value) || 0 })
              }
            />
          </label>
          <div className="field">
            <span>Assign surveys (required on the phone)</span>
            <p className="muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>
              Tick every survey they must fill. Each survey has its own target — assigning 2
              surveys does not change the quota to 2. Home stretches one bar with both quotas.
              Questions on the phone come from these surveys.
            </p>
            <SurveySelect
              value={form.surveys}
              onChange={(ids) =>
                setForm((f) => ({
                  ...f,
                  surveys: ids,
                  surveyQuotas: nextSurveyQuotas(f.surveyQuotas, ids, f.target_quota),
                }))
              }
              all={surveysForAssign(form.surveys)}
            />
            <SurveyQuotaFields
              surveyIds={form.surveys}
              all={surveysForAssign(form.surveys)}
              quotas={form.surveyQuotas}
              fallback={form.target_quota}
              onChange={(sid, n) =>
                setForm((f) => ({ ...f, surveyQuotas: { ...f.surveyQuotas, [sid]: n } }))
              }
            />
          </div>
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
            <span>Mobile (+91, 10 digits)</span>
            <PhoneIndiaField
              value={form.phone}
              onChange={(phone) => setForm({ ...form, phone })}
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
            shown again later. Share the Android download link with them.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <button
              type="button"
              className="btn primary"
              onClick={async () => {
                const link = apkDownloadUrl()
                try {
                  await navigator.clipboard.writeText(link)
                  onToast?.('APK download link copied', 'ok')
                } catch {
                  onToast?.(link, 'ok')
                }
              }}
            >
              Copy download link
            </button>
          </div>
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
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    marginBottom: 10,
                    borderColor: justCreated ? '#00e599' : '#e2e8f0',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  }}
                >
                  {/* Top Bar: Avatar, Identity, Badges & Status */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      {u.photo ? (
                        <img
                          src={u.photo}
                          alt=""
                          style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover', border: '2px solid #00e599', flexShrink: 0 }}
                        />
                      ) : (
                        <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#f1f5f9', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Icon name="user" size={18} />
                        </div>
                      )}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 15, color: '#0f172a' }}>
                            {u.name || loginUser}
                          </strong>
                          {u.verified ? <VerifiedBadge size={16} /> : null}
                          <span style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>
                            @{loginUser}
                          </span>
                          {u.key_id && (
                            <span style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}>
                              [{u.key_id}]
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, fontSize: 12, color: '#64748b', flexWrap: 'wrap' }}>
                          {u.phone ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              <Icon name="phone" size={11} /> {formatInMobile(u.phone)}
                            </span>
                          ) : (
                            <span className="muted">No phone</span>
                          )}
                          <span>·</span>
                          <span>
                            {(u.surveys || []).length > 0
                              ? `Surveys: ${(u.surveys || []).map((s) => s.title).join(', ')}`
                              : 'Default Survey'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <span className={`pill ${statusColor(status)}`}>
                      <span className="dot" />
                      {justCreated ? 'new' : status}
                    </span>
                  </div>

                  {/* Progress Bar & Quota Status */}
                  <div style={{ marginTop: 10, padding: '10px 12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 5 }}>
                      <span style={{ fontWeight: 600, color: '#334155' }}>
                        Progress: <strong>{done}</strong> / {target > 0 ? `${target} target` : 'No quota set'}
                      </span>
                      <span style={{ fontWeight: 700, color: pct >= 100 ? '#16a34a' : '#0284c7' }}>
                        {target > 0 ? `${pct}%` : '—'}
                      </span>
                    </div>
                    <div style={{ height: 6, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${Math.min(100, pct || 0)}%`,
                          height: '100%',
                          background: pct >= 100 ? '#22c55e' : '#38bdf8',
                        }}
                      />
                    </div>
                  </div>

                  {/* Actions Row */}
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn small primary"
                        style={{ fontSize: 12, padding: '5px 14px', display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 700 }}
                        onClick={() => openProfile(u)}
                      >
                        <Icon name="user" size={13} /> Edit Profile & Quota
                      </button>
                      {canVerify && (
                        <button
                          type="button"
                          className={`btn small ${u.verified ? 'ok' : ''}`}
                          style={{ fontSize: 11, padding: '4px 10px' }}
                          onClick={() => handleToggleVerify(u)}
                        >
                          {u.verified ? 'Verified ✓' : 'Verify'}
                        </button>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 4 }}>
                      {u.active === false ? (
                        <button
                          type="button"
                          className="btn small primary"
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          onClick={() => handleEnable(u)}
                        >
                          Enable
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn small danger"
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          onClick={() => handleDisable(u)}
                        >
                          Disable
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn small"
                        style={{ fontSize: 11, padding: '3px 8px' }}
                        onClick={() => handleRevoke(u)}
                        title="Force logout on surveyor app"
                      >
                        Revoke
                      </button>
                      <button
                        type="button"
                        className="btn small danger"
                        style={{ fontSize: 11, padding: '3px 8px' }}
                        onClick={() => handleDelete(u)}
                        title="Delete surveyor account"
                      >
                        Delete
                      </button>
                    </div>
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
                    <strong>
                      {u.name || u.username}{' '}
                      {u.verified ? <VerifiedBadge size={16} title="Verified client admin" /> : null}
                    </strong>
                    <span className="meta">
                      @{u.username} ·{' '}
                      {u.role === 'super_admin' ? '★ super admin' : 'admin'}
                      {u.role === 'admin' && u.active !== false && (
                        <>
                          {' · '}
                          {powersOf(u).length > 0
                            ? `powers: ${powersOf(u).map((p) => `${p.icon} ${p.label}`).join(', ')}`
                            : '🔒 no powers granted'}
                        </>
                      )}
                      {u.active === false ? ' · disabled' : ''}
                    </span>
                  </div>
                  <div className="user-actions">
                    {u.role === 'super_admin' ? (
                      <span className="meta" style={{ fontSize: 11 }}>
                        Platform account
                      </span>
                    ) : (
                      <>
                        {me?.role === 'super_admin' && (
                          <button
                            type="button"
                            className={`btn small ${u.verified ? 'ok' : 'primary'}`}
                            onClick={() => handleToggleVerify(u)}
                          >
                            {u.verified ? 'Verified ✓' : 'Verify admin'}
                          </button>
                        )}
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
                      </>
                    )}
                  </div>
                  {me?.role === 'super_admin' && u.role === 'admin' && (
                    <div
                      style={{
                        display: 'flex',
                        gap: 6,
                        flexWrap: 'wrap',
                        marginTop: 8,
                        maxWidth: 560,
                      }}
                    >
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
                    </div>
                  )}
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
                      {(u.role === 'surveyor' || u.role === 'field') && (
                        <div className="field compact">
                          <span>Assign surveys (required on the phone)</span>
                          <p className="muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>
                            The app will not collect until at least one survey is assigned.
                            Set a target on each survey — Home stretches one bar per quota.
                          </p>
                          <SurveySelect
                            value={edit.surveys}
                            onChange={(ids) =>
                              setEdit((ed) => ({
                                ...ed,
                                surveys: ids,
                                surveyQuotas: nextSurveyQuotas(
                                  ed.surveyQuotas,
                                  ids,
                                  ed.target_quota,
                                ),
                              }))
                            }
                            all={surveysForAssign(edit.surveys)}
                          />
                          <SurveyQuotaFields
                            surveyIds={edit.surveys}
                            all={surveysForAssign(edit.surveys)}
                            quotas={edit.surveyQuotas}
                            fallback={edit.target_quota}
                            onChange={(sid, n) =>
                              setEdit((ed) => ({
                                ...ed,
                                surveyQuotas: { ...ed.surveyQuotas, [sid]: n },
                              }))
                            }
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
            <p className="muted" style={{ margin: 0 }}>
              Profile for <strong>@{profileUser.username}</strong> is open in the panel.
            </p>
          ) : (
            <p className="muted">Select a surveyor from the dropdown above or click <strong>Profile</strong> on any surveyor in the list.</p>
          )}
        </div>
      )}

      {profileUser
        ? createPortal(
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 10000,
                background: 'rgba(15, 23, 42, 0.55)',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
              onClick={(e) => {
                if (e.target === e.currentTarget) closeProfile()
              }}
            >
              <div
                ref={drawerRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="surveyor-profile-title"
                style={{
                  width: '100%',
                  maxWidth: 580,
                  height: '100%',
                  maxHeight: '100dvh',
                  background: '#ffffff',
                  borderLeft: '1px solid #e2e8f0',
                  padding: 20,
                  overflowY: 'auto',
                  boxShadow: '-10px 0 30px rgba(15,23,42,0.15)',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 id="surveyor-profile-title" style={{ margin: 0, fontSize: 16, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="user" size={16} /> Surveyor Profile & Identity
                  </h3>
                  <button
                    type="button"
                    className="btn small"
                    onClick={closeProfile}
                    style={{ fontSize: 13, padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    ✕ Close
                  </button>
                </div>

                {/* Profile Identity Bar */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: '#f8fafc', padding: 12, borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 12 }}>
                  {profileUser.photo ? (
                    <img
                      src={profileUser.photo}
                      alt="Profile"
                      style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', border: '2px solid #00e599' }}
                    />
                  ) : (
                    <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="user" size={22} />
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <h4 style={{ margin: 0, fontSize: 16, color: '#0f172a', fontWeight: 800 }}>
                        {profileUser.display_name || profileUser.name || profileUser.username}
                      </h4>
                      {profileUser.verified ? (
                        <VerifiedBadge size={16} />
                      ) : (
                        <span style={{ background: '#d97706', color: '#fff', fontSize: 10, fontWeight: 'bold', padding: '1px 6px', borderRadius: 8 }}>
                          Unverified
                        </span>
                      )}
                    </div>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                      @{profileUser.username} · Key ID: <strong style={{ color: '#059669' }}>{profileUser.key_id || '—'}</strong>
                    </p>
                  </div>
                  {canVerify && (
                    <button
                      type="button"
                      className="btn small"
                      style={{
                        background: profileUser.verified ? '#dc2626' : '#059669',
                        color: '#ffffff',
                        fontWeight: 'bold',
                        padding: '6px 12px',
                        fontSize: 11,
                        border: 0,
                      }}
                      onClick={() => handleToggleVerify(profileUser)}
                    >
                      {profileUser.verified ? 'Unverify' : 'Verify ✓'}
                    </button>
                  )}
                </div>

                {/* Profile Edit Form Card with Save Button */}
                <form
                  onSubmit={handleSaveProfile}
                  style={{
                    background: '#ffffff',
                    padding: 14,
                    borderRadius: 10,
                    border: '1px solid #cbd5e1',
                    marginBottom: 12,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <strong style={{ fontSize: 13, color: '#0f172a' }}>✏️ Edit Profile & App Login</strong>
                    <span style={{ fontSize: 11, color: '#64748b' }}>Role: Surveyor</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <label className="field compact" style={{ margin: 0 }}>
                      <span style={{ fontSize: 11 }}>Display Name</span>
                      <input
                        value={profileForm.name}
                        onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                        placeholder="e.g. Allu Arjun"
                      />
                    </label>
                    <label className="field compact" style={{ margin: 0 }}>
                      <span style={{ fontSize: 11 }}>Username (App Login)</span>
                      <input
                        value={profileForm.username}
                        onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value })}
                        placeholder="e.g. allu"
                        autoCapitalize="none"
                        autoCorrect="off"
                      />
                    </label>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <label className="field compact" style={{ margin: 0 }}>
                      <span style={{ fontSize: 11 }}>Mobile Number (+91)</span>
                      <PhoneIndiaField
                        value={profileForm.phone}
                        onChange={(phone) => setProfileForm({ ...profileForm, phone })}
                      />
                    </label>
                    <label className="field compact" style={{ margin: 0 }}>
                      <span style={{ fontSize: 11 }}>Default target (used when a survey has no quota yet)</span>
                      <input
                        type="number"
                        min={0}
                        value={profileForm.target_quota}
                        onChange={(e) =>
                          setProfileForm({
                            ...profileForm,
                            target_quota: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </label>
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <label className="field compact" style={{ margin: 0 }}>
                      <span style={{ fontSize: 11 }}>New Password (leave blank to keep current)</span>
                      <input
                        type="text"
                        value={profileForm.password}
                        onChange={(e) => setProfileForm({ ...profileForm, password: e.target.value })}
                        placeholder="•••• or type new password"
                        autoComplete="new-password"
                      />
                    </label>
                  </div>

                  {(profileUser.role === 'surveyor' || profileUser.role === 'field') && (
                    <div style={{ marginBottom: 12 }}>
                      <span style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#334155' }}>
                        Assigned Surveys
                      </span>
                      {canAssignSurveys ? (
                        <>
                        <SurveySelect
                          value={profileSurveys}
                          onChange={(ids) => {
                            setProfileSurveys(ids)
                            setProfileQuotas((prev) =>
                              nextSurveyQuotas(prev, ids, profileForm.target_quota),
                            )
                          }}
                          all={surveysForAssign(profileSurveys)}
                        />
                        <SurveyQuotaFields
                          surveyIds={profileSurveys}
                          all={surveysForAssign(profileSurveys)}
                          quotas={profileQuotas}
                          fallback={profileForm.target_quota}
                          onChange={(sid, n) =>
                            setProfileQuotas((prev) => ({ ...prev, [sid]: n }))
                          }
                        />
                        </>
                      ) : (
                        <p className="muted" style={{ fontSize: 11, margin: 0 }}>
                          {(profileUser.surveys || []).length > 0
                            ? (profileUser.surveys || []).map((s) => (s && s.title) || s).filter(Boolean).join(' · ')
                            : 'Default survey assigned'}
                        </p>
                      )}
                    </div>
                  )}

                  <button
                    type="submit"
                    className="btn primary"
                    disabled={profileSaving}
                    style={{
                      width: '100%',
                      minHeight: 38,
                      fontWeight: 700,
                      fontSize: 13,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    {profileSaving ? 'Saving Changes…' : '💾 Save Profile Changes'}
                  </button>
                </form>

                {/* Metrics: Surveys Done / Approved / Pending */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                  <div style={{ background: '#f8fafc', padding: '8px 6px', borderRadius: 8, textAlign: 'center', border: '1px solid #e2e8f0' }}>
                    <span style={{ display: 'block', fontSize: 18, fontWeight: '800', color: '#059669' }}>
                      {profileData?.geoSummary?.records ?? (profileUser.done_count || 0)}
                    </span>
                    <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: '700' }}>
                      Done
                    </span>
                  </div>
                  <div style={{ background: '#f8fafc', padding: '8px 6px', borderRadius: 8, textAlign: 'center', border: '1px solid #059669' }}>
                    <span style={{ display: 'block', fontSize: 18, fontWeight: '800', color: '#10b981' }}>
                      {profileData?.geoSummary?.confirmed ?? (profileUser.confirmed_count || 0)}
                    </span>
                    <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: '700' }}>
                      Approved ✓
                    </span>
                  </div>
                  <div style={{ background: '#f8fafc', padding: '8px 6px', borderRadius: 8, textAlign: 'center', border: '1px solid #d97706' }}>
                    <span style={{ display: 'block', fontSize: 18, fontWeight: '800', color: '#f59e0b' }}>
                      {profileData?.items ? profileData.items.filter((it) => it.status === 'pending').length : (profileUser.pending_count || 0)}
                    </span>
                    <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: '700' }}>
                      Pending ⏳
                    </span>
                  </div>
                </div>

                {/* Aadhaar — only when Super Admin granted verify / proof */}
                {canSeeIdDocs && (
                <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <strong style={{ fontSize: 12, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Icon name="idCard" size={13} /> Aadhaar Identity
                    </strong>
                    <span style={{ fontSize: 11, fontWeight: 'bold', color: profileUser.verified ? '#059669' : '#f59e0b' }}>
                      {profileUser.verified ? 'Verified ✓' : 'Pending'}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <span style={{ display: 'block', fontSize: 10, color: '#64748b', marginBottom: 4, fontWeight: 'bold' }}>Front Side</span>
                      {profileUser.aadhaar_front ? (
                        <a href={profileUser.aadhaar_front} target="_blank" rel="noreferrer">
                          <img src={profileUser.aadhaar_front} alt="Aadhaar Front" style={{ width: '100%', height: 75, objectFit: 'cover', borderRadius: 6, border: '1px solid #00e599', marginBottom: 4 }} />
                        </a>
                      ) : (
                        <div style={{ height: 60, background: '#f1f5f9', borderRadius: 6, border: '1px dashed #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>
                          No Front
                        </div>
                      )}
                      <label className="btn small primary" style={{ display: 'block', width: '100%', boxSizing: 'border-box', cursor: 'pointer', textAlign: 'center', fontSize: 10, padding: '3px 6px' }}>
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
                      <span style={{ display: 'block', fontSize: 10, color: '#64748b', marginBottom: 4, fontWeight: 'bold' }}>Back Side</span>
                      {profileUser.aadhaar_back ? (
                        <a href={profileUser.aadhaar_back} target="_blank" rel="noreferrer">
                          <img src={profileUser.aadhaar_back} alt="Aadhaar Back" style={{ width: '100%', height: 75, objectFit: 'cover', borderRadius: 6, border: '1px solid #00e599', marginBottom: 4 }} />
                        </a>
                      ) : (
                        <div style={{ height: 60, background: '#f1f5f9', borderRadius: 6, border: '1px dashed #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>
                          No Back
                        </div>
                      )}
                      <label className="btn small primary" style={{ display: 'block', width: '100%', boxSizing: 'border-box', cursor: 'pointer', textAlign: 'center', fontSize: 10, padding: '3px 6px' }}>
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
                )}

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
                      {surveysWithSubmissions.map((s) => (
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
                        {profileData.items.map((it, i) => {
                          const approved = it.status === 'confirmed'
                          return (
                          <li
                            key={it.id || i}
                            style={{
                              padding: '10px 12px',
                              background: '#f1f5f9',
                              borderRadius: 8,
                              marginBottom: 8,
                              flexDirection: 'row',
                              alignItems: 'flex-start',
                              justifyContent: 'space-between',
                              gap: 8,
                            }}
                          >
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <strong>#{it.record_index ?? it.id ?? i + 1}</strong>
                              {approved ? (
                                <span
                                  style={{
                                    marginLeft: 6,
                                    color: '#059669',
                                    fontWeight: 700,
                                    fontSize: 12,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 3,
                                    verticalAlign: 'middle',
                                  }}
                                >
                                  <Icon name="check" size={13} /> Approved
                                </span>
                              ) : (
                                <span
                                  style={{
                                    marginLeft: 6,
                                    color: '#d97706',
                                    fontWeight: 700,
                                    fontSize: 12,
                                  }}
                                >
                                  Pending
                                </span>
                              )}
                              <span className="meta" style={{ marginLeft: 0, display: 'block', marginTop: 4 }}>
                                {formatIstStamp(it.created_at) || '—'}
                                {it.form_key ? ` · ${it.form_key}` : ''}
                              </span>
                              <span className="meta" style={{ display: 'block', marginTop: 2 }}>
                                {it.answers?.district || 'no district'}
                                {it.answers?.constituency
                                  ? ` · ${it.answers.constituency}`
                                  : ''}
                              </span>
                            </div>
                          </li>
                          )
                        })}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="muted">Click Filter to load submission details.</p>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
