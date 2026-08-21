import { Component, useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icons'

class CollectErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    console.error('Collect Screen Error:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="card" style={{ padding: 24, textAlign: 'center', margin: 16 }}>
          <h3 style={{ marginTop: 0, color: '#ef4444' }}>⚠️ Collect Screen Error</h3>
          <p className="muted" style={{ fontSize: 13 }}>
            {this.state.error?.message || 'An unexpected error occurred while loading the survey collector.'}
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              this.setState({ hasError: false, error: null })
              this.props.onReset?.()
            }}
          >
            🔄 Reload Collect Screen
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
import {
  getMyProgress,
  getMySubmissions,
  getToken,
  logout,
  me,
  updateUser,
  uploadProfileMedia,
} from './api'
import SubmissionMedia from './SubmissionMedia'
import { QUALITY, watchNetwork } from './network'
import { queueCount, refreshQueueCountCache } from './offlineQueue'
import {
  forceSyncNow,
  getQueueSnapshot,
  onSyncEngine,
  startSyncEngine,
  stopSyncEngine,
} from './syncEngine'
import LoginScreen from './Login'
import FieldCollectScreen from './FieldCollect'
import PullToRefresh from './PullToRefresh'
import {
  collapseDuplicateDrafts,
  deleteDraft,
  draftCount,
  listDrafts,
  listPendingPackages,
  pushDraft,
} from './localStore'
import { clearSession, getSurveyForm } from './api'
import { APP_BUILD, APP_VERSION, APP_VERSION_CODE, versionLabel } from './version'
import PhoneIndiaField from './PhoneIndiaField'
import { isValidInMobile, toE164In } from './phoneIn'
import VerifiedBadge from './VerifiedBadge'
import {
  getNavMode,
  setNavMode as persistNavMode,
  getFontScale,
  setFontScale as persistFontScale,
  applyFontScale,
  NAV_MODES,
  FONT_SCALES,
} from './prefs'
import './App.css'

/** Surveyor-only field app (mobile / APK) */
const TABS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'collect', label: 'Collect', icon: 'pencil' },
  { id: 'drafts', label: 'Pending', icon: 'box' },
  { id: 'records', label: 'Activity', icon: 'menu' },
  { id: 'profile', label: 'Profile', icon: 'user' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

/** New install or new APK build must show login — never restore an old session. */
function ensureUiVersion() {
  try {
    const key = 'esurvey_ui_build'
    const stamp = `${APP_VERSION}:${APP_VERSION_CODE}:${APP_BUILD}`
    const prev = localStorage.getItem(key)
    if (prev !== stamp) {
      clearSession()
      try {
        localStorage.removeItem('esurvey_ui_version')
      } catch {
        /* ignore */
      }
      localStorage.setItem(key, stamp)
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}

function networkPillClass(quality) {
  if (quality === QUALITY.STRONG || quality === QUALITY.OK) return 'ok'
  if (quality === QUALITY.WEAK) return 'warn'
  return 'bad'
}

const FIELD_TZ = 'Asia/Kolkata'

function ymdInTz(value, tz = FIELD_TZ) {
  const d = value instanceof Date ? value : new Date(value || Date.now())
  if (Number.isNaN(d.getTime())) {
    const s = String(value || '')
    return s.length >= 10 ? s.slice(0, 10) : ''
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function formatDayLabel(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  if (!y || !m || !d) return ymd || 'Unknown date'
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function groupRecordsByDay(records) {
  const map = new Map()
  for (const r of records || []) {
    const day = ymdInTz(r.created_at) || 'unknown'
    if (!map.has(day)) map.set(day, [])
    map.get(day).push(r)
  }
  return [...map.entries()].map(([date, items]) => ({
    date,
    pretty: date === 'unknown' ? 'Unknown date' : formatDayLabel(date),
    items,
  }))
}

/** Sequential 1..N by created time (oldest = 1). Optional storedKey uses saved record number when set. */
function recordNumberMap(records, idKey = 'id', timeKey = 'created_at', storedKey = 'record_index') {
  const list = records || []
  const map = new Map()
  const sorted = [...list].sort((a, b) =>
    String(a?.[timeKey] || '').localeCompare(String(b?.[timeKey] || '')),
  )
  sorted.forEach((r, i) => {
    const stored = storedKey ? Number(r?.[storedKey]) : NaN
    map.set(r[idKey], Number.isFinite(stored) && stored > 0 ? stored : i + 1)
  })
  return map
}

function packageFailedRequirements(d) {
  if (!d) return false
  if (d.phase === 'failed') return true
  const qa = d.qa || {}
  const hasGeo = qa.geo?.lat != null || qa.answers?.geo_lat != null
  const hasPhoto = !!(d.photoDataUrl || d.hasPhoto || d.flags?.photo)
  const hasVoice = !!(d.audioDataUrl || d.hasAudio || d.flags?.audio)
  if (d.kind !== 'draft' && (!hasGeo || !hasPhoto || !hasVoice)) return true
  return /GPS|photo|voice|lock|incomplete|required|too large|compress|geo_lock/i.test(
    String(d.lastError || ''),
  )
}

function HomeScreen({
  user,
  network,
  pendingSync,
  pendingLocal,
  myProgress,
  questionsMeta,
  onNewSurvey,
  onSync,
  onLogout,
}) {
  const quality = network?.quality || QUALITY.OFFLINE
  const label = network?.label || 'Offline'
  const done = myProgress?.done ?? 0
  const target = myProgress?.target ?? 0
  const complete = myProgress?.complete || (target > 0 && done >= target)
  const qCount = questionsMeta?.count ?? questionsMeta?.questions?.length ?? 0
  const localPending = pendingLocal ?? pendingSync ?? 0

  return (
    <div className="screen home-screen">
      <p className="ptr-hint">↓ Pull down to refresh questions · progress · queue</p>
      <div className="hero-card">
        <p className="eyebrow">Field survey · Surveyor</p>
        <h1 style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          Hi, {user?.name || user?.username}
          {user?.verified ? <VerifiedBadge size={22} /> : null}
        </h1>
        <p className="hero-sub">
          {myProgress?.label ||
            'GPS → Photo → Q/A + audio · saved on device · auto next'}
        </p>
        <div className="pill-row">
          <div className={`pill ${networkPillClass(quality)}`} title={network?.error || ''}>
            <span className="dot" />
            {label}
          </div>
          {localPending > 0 && (
            <div className="pill warn">
              <span className="dot" />
              {localPending} pending on phone
            </div>
          )}
          {complete && (
            <div className="pill ok">
              <span className="dot" />
              Target complete
            </div>
          )}
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <strong>
            {done}
            {target ? `/${target}` : ''}
          </strong>
          <span>On server</span>
        </div>
        <div className="stat">
          <strong>{localPending}</strong>
          <span>Pending</span>
        </div>
        <div className="stat">
          <strong>{qCount || '—'}</strong>
          <span>Questions</span>
        </div>
        <div className="stat">
          <strong>{myProgress?.status || '—'}</strong>
          <span>Status</span>
        </div>
      </div>

      {questionsMeta?.title && (
        <div className="card" style={{ marginBottom: 12, padding: '12px 14px' }}>
          <strong style={{ fontSize: 14 }}>{questionsMeta.title}</strong>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
            {qCount} question(s) loaded
            {questionsMeta.updated_at
              ? ` · updated ${String(questionsMeta.updated_at).slice(0, 16).replace('T', ' ')}`
              : ''}
            . Pull down to fetch latest from Client Admin.
          </p>
        </div>
      )}

      {target > 0 && (
        <div
          style={{
            height: 10,
            background: 'rgba(15,23,42,0.08)',
            borderRadius: 99,
            marginBottom: 14,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${myProgress?.pct || Math.min(100, Math.round((done / target) * 100))}%`,
              height: '100%',
              background: complete ? '#22c55e' : '#38bdf8',
            }}
          />
        </div>
      )}

      <button type="button" className="cta" onClick={onNewSurvey} disabled={complete}>
        {complete
          ? <><Icon name="check" size={13} /> Target complete</>
          : done > 0
            ? `Continue activity #${myProgress?.next_record || done + 1}`
            : 'Start collect · GPS → Photo → Q/A'}
      </button>

      {pendingSync > 0 && (
        <button type="button" className="cta secondary" onClick={onSync}>
          Sync {pendingSync} package(s) now
        </button>
      )}

      <p className="app-version-foot" aria-label="App version">
        {versionLabel()}
      </p>

      <button type="button" className="cta secondary danger-cta" onClick={onLogout}>
        Log out
      </button>
    </div>
  )
}

/** My submitted records: photo + audio openable from the field app */
function MyRecordsScreen({ user, onToast }) {
  const [records, setRecords] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const recNums = recordNumberMap(records || [])

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const d = await getMySubmissions()
      setRecords(d.items || [])
    } catch (e) {
      onToast?.(e.message || 'Failed to load your activity', 'error')
    } finally {
      setRefreshing(false)
    }
  }, [onToast])

  useEffect(() => {
    load()
    const onRefresh = () => load()
    window.addEventListener('esurvey-activity-refresh', onRefresh)
    return () => window.removeEventListener('esurvey-activity-refresh', onRefresh)
  }, [load])

  return (
    <div className="screen records-screen">
      <div className="screen-toolbar">
        <h2>My activity</h2>
        <button
          type="button"
          className="btn small"
          onClick={load}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Sent items for @{user?.username}, grouped by date. Tap one to view details.
      </p>

      {records === null ? (
        <p className="muted">Loading activity…</p>
      ) : records.length === 0 ? (
        <p className="muted">No activity yet.</p>
      ) : (
        groupRecordsByDay(records).map((group) => (
          <section key={group.date} className="activity-day-group">
            <header className="activity-day-head">
              <strong>{group.pretty}</strong>
              <span className="activity-day-count">{group.items.length} sent</span>
            </header>
            {group.items.map((r) => {
              const open = openId === r.id
              const isConfirmed = r.status === 'confirmed' || r.fact_status === 'confirmed' || r.fact_status === 'materialized'
              const ans = r.answers || r.payload?.answers || {}
              const recNo = recNums.get(r.id) ?? r.record_index ?? r.id
              return (
                <div key={r.id} className="card" style={{ marginTop: 10, padding: 12 }}>
                  <button
                    type="button"
                    style={{
                      width: '100%',
                      background: 'none',
                      border: 0,
                      textAlign: 'left',
                      padding: 0,
                      cursor: 'pointer',
                    }}
                    onClick={() => setOpenId(open ? null : r.id)}
                  >
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      Record #{recNo}
                      <span className={`pill ${isConfirmed ? 'ok' : ''}`} style={{ marginLeft: 8 }}>
                        {isConfirmed ? <><Icon name="check" size={11} /> Confirmed</> : r.status || 'pending'}
                      </span>
                    </span>
                    <span className="muted" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                      {String(r.created_at || '').slice(0, 16).replace('T', ' ')}
                      {r.submitted_by || r.payload?.submitted_by ? ` · ${r.submitted_by || r.payload?.submitted_by}` : ''}
                    </span>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      {open ? 'Hide details ▲' : 'Show details ▼'}
                    </div>
                  </button>
                  {open && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e2e8f0' }}>
                      <SubmissionMedia item={r} compact />
                      <div style={{ fontSize: 13, marginTop: 8 }}>
                        <strong style={{ display: 'block', marginBottom: 6, color: '#0f172a' }}>Activity details</strong>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6 }}>
                          <tbody>
                            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td className="muted" style={{ padding: '6px 8px' }}>Record number:</td>
                              <td style={{ textAlign: 'right', fontWeight: 600, padding: '6px 8px' }}>#{recNo}</td>
                            </tr>
                            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td className="muted" style={{ padding: '6px 8px' }}>Status:</td>
                              <td style={{ textAlign: 'right', fontWeight: 600, padding: '6px 8px', color: isConfirmed ? '#059669' : '#d97706' }}>
                                {isConfirmed ? <><Icon name="check" size={11} /> Confirmed</> : r.status || 'pending'}
                              </td>
                            </tr>
                            {(r.submitted_by || r.payload?.submitted_by) && (
                              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td className="muted" style={{ padding: '6px 8px' }}>Surveyor:</td>
                                <td style={{ textAlign: 'right', fontWeight: 600, padding: '6px 8px' }}>{r.submitted_by || r.payload?.submitted_by}</td>
                              </tr>
                            )}
                            {r.created_at && (
                              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td className="muted" style={{ padding: '6px 8px' }}>Submitted At:</td>
                                <td style={{ textAlign: 'right', padding: '6px 8px' }}>{String(r.created_at).slice(0, 16).replace('T', ' ')}</td>
                              </tr>
                            )}
                            {Object.entries(ans).map(([k, v]) => {
                              if (k.startsWith('_') || k.startsWith('geo_') || k.startsWith('location_')) return null
                              if (v == null || v === '') return null
                              const valStr = Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)
                              return (
                                <tr key={k} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                  <td className="muted" style={{ padding: '6px 8px', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}:</td>
                                  <td style={{ textAlign: 'right', fontWeight: 600, padding: '6px 8px' }}>{valStr}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        ))
      )}
    </div>
  )
}

/** Surveyor Profile Screen: Name, Photo, Phone, Aadhaar Front & Back, Key ID */
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

function SurveyorProfileScreen({ user, onToast, onUserUpdated }) {
  const [phone, setPhone] = useState(user?.phone || '')
  const [savingPhone, setSavingPhone] = useState(false)
  const [uploading, setUploading] = useState({ photo: false, front: false, back: false })

  useEffect(() => {
    setPhone(user?.phone || '')
  }, [user?.phone])

  // Fetch latest live profile on mount (including verification status from admin)
  useEffect(() => {
    me()
      .then((res) => {
        if (res?.user) {
          onUserUpdated?.(res.user)
        }
      })
      .catch(() => {})
  }, [onUserUpdated])

  const handleMediaUpload = async (field, file) => {
    if (!file) return
    const fieldKey = field === 'front' ? 'aadhaar_front' : field === 'back' ? 'aadhaar_back' : 'photo'
    setUploading((u) => ({ ...u, [field]: true }))
    try {
      const compressedDataUrl = await compressImageFile(file, 1200, 0.75)
      const res = await uploadProfileMedia(fieldKey, compressedDataUrl)
      const newUrl = res?.[fieldKey] || compressedDataUrl
      onUserUpdated?.((prev) => ({ ...prev, [fieldKey]: newUrl }))
      onToast?.(`${fieldKey.replace('_', ' ')} uploaded to DB ✓`, 'ok')
      me().then((m) => m?.user && onUserUpdated?.(m.user)).catch(() => {})
    } catch (err) {
      onToast?.(err.message || 'Upload failed', 'error')
    } finally {
      setUploading((u) => ({ ...u, [field]: false }))
    }
  }

  const handleSavePhone = async () => {
    if (!isValidInMobile(phone)) {
      onToast?.('Enter a 10-digit Indian mobile (+91)', 'error')
      return
    }
    const saved = toE164In(phone)
    setSavingPhone(true)
    try {
      await updateUser(user.id, { phone: saved })
      onUserUpdated?.((prev) => ({ ...prev, phone: saved }))
      onToast?.('Phone number updated ✓', 'ok')
      me().then((m) => m?.user && onUserUpdated?.(m.user)).catch(() => {})
    } catch (err) {
      onToast?.(err.message || 'Failed to update phone', 'error')
    } finally {
      setSavingPhone(false)
    }
  }

  return (
    <div className="screen profile-screen" style={{ padding: '12px 14px 110px' }}>
      {!user?.verified && (
        <div
          className="card"
          role="alert"
          style={{
            marginBottom: 14,
            padding: '14px 16px',
            border: '2px solid #f59e0b',
            background: '#fffbeb',
          }}
        >
          <strong style={{ display: 'block', fontSize: 15, color: '#92400e' }}>
            Profile verification pending
          </strong>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#78350f' }}>
            Upload your photo and Aadhaar, then wait for Client Admin to verify you.
            Home and Collect stay locked until verification is complete.
          </p>
        </div>
      )}
      <div className="card" style={{ marginBottom: 14, textAlign: 'center', padding: '16px 14px' }}>
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: 10 }}>
          {user?.photo ? (
            <img
              src={user.photo}
              alt="Profile"
              style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover', border: '3px solid #00e599' }}
            />
          ) : (
            <div
              style={{
                width: 84,
                height: 84,
                borderRadius: '50%',
                background: '#e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 38,
                margin: '0 auto',
              }}
            >
              <Icon name="user" size={38} />
            </div>
          )}
          <label
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              background: user?.verified ? '#cbd5e1' : '#059669',
              color: user?.verified ? '#334155' : '#111',
              borderRadius: '50%',
              width: 30,
              height: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: user?.verified ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}
            title={user?.verified ? 'Photo locked' : 'Upload photo'}
          >
            {user?.verified ? <Icon name="lock" size={16} /> : <Icon name="camera" size={16} />}
            {!user?.verified && (
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => handleMediaUpload('photo', e.target.files?.[0])}
              />
            )}
          </label>
        </div>
        <h2
          style={{
            margin: '4px 0 2px',
            fontSize: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          {user?.name || user?.display_name || user?.username}
          {user?.verified ? <VerifiedBadge size={20} /> : null}
        </h2>
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>@{user?.username}</p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ background: 'rgba(0,229,153,0.12)', border: '1px solid rgba(0,229,153,0.3)', borderRadius: 20, padding: '4px 14px' }}>
            <span style={{ fontSize: 12, color: '#059669', fontWeight: 'bold' }}>
              Key ID: {user?.key_id || 'GROUND-KEY'}
            </span>
          </div>
          {!user?.verified && (
            <div style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid #f59e0b', borderRadius: 20, padding: '4px 14px' }}>
              <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 'bold' }}>
                Pending
              </span>
            </div>
          )}
        </div>
        <p className="muted" style={{ fontSize: 11, margin: '10px 0 0' }}>
          ↓ Pull down to refresh verification status
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Phone</h3>
          {user?.verified ? (
            <span aria-label="Locked" title="Locked" style={{ fontSize: 14 }}>
              <Icon name="lock" size={14} />
            </span>
          ) : null}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
          {user?.verified
            ? 'Phone cannot be changed.'
            : 'Indian mobile only — +91 and 10 digits.'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PhoneIndiaField
            value={phone}
            disabled={user?.verified === true}
            onChange={setPhone}
          />
          {!user?.verified && (
            <button
              type="button"
              className="btn primary"
              style={{
                fontSize: 15,
                fontWeight: 'bold',
                borderRadius: 12,
                background: '#059669',
                color: '#ffffff',
                cursor: 'pointer',
              }}
              disabled={savingPhone || phone === (user?.phone || '')}
              onClick={handleSavePhone}
            >
              {savingPhone ? 'Saving Phone…' : 'Save Phone Number'}
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Aadhaar</h3>
          {user?.verified ? (
            <span aria-label="Locked" title="Locked" style={{ fontSize: 14 }}>
              <Icon name="lock" size={14} />
            </span>
          ) : null}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
          {user?.verified
            ? 'Documents cannot be changed.'
            : 'Upload front & back images of your Aadhaar card.'}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {/* Front */}
          <div style={{ border: user?.verified ? '1px solid #cbd5e1' : '1px dashed #94a3b8', borderRadius: 8, padding: 10, textAlign: 'center', background: user?.verified ? 'rgba(15,23,42,0.05)' : 'rgba(15,23,42,0.03)' }}>
            <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 'bold', color: user?.verified ? '#64748b' : '#0f172a' }}>Aadhaar Front</p>
            {user?.aadhaar_front ? (
              <img
                src={user.aadhaar_front}
                alt="Aadhaar Front"
                style={{ width: '100%', height: 95, objectFit: 'cover', borderRadius: 6, marginBottom: 8, opacity: user?.verified ? 0.7 : 1 }}
              />
            ) : (
              <div style={{ height: 95, background: 'rgba(15,23,42,0.06)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                <Icon name="idCard" size={26} />
              </div>
            )}
            <label
              className="btn small"
              style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', cursor: user?.verified ? 'not-allowed' : 'pointer', background: user?.verified ? '#e2e8f0' : undefined, color: user?.verified ? '#94a3b8' : undefined, border: user?.verified ? '1px solid #cbd5e1' : undefined }}
            >
              {uploading.front ? 'Uploading…' : user?.verified ? <Icon name="lock" size={12} /> : user?.aadhaar_front ? 'Change Front' : 'Upload Front'}
              {!user?.verified && (
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => handleMediaUpload('front', e.target.files?.[0])}
                />
              )}
            </label>
          </div>

          {/* Back */}
          <div style={{ border: user?.verified ? '1px solid #cbd5e1' : '1px dashed #94a3b8', borderRadius: 8, padding: 10, textAlign: 'center', background: user?.verified ? 'rgba(15,23,42,0.05)' : 'rgba(15,23,42,0.03)' }}>
            <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 'bold', color: user?.verified ? '#64748b' : '#0f172a' }}>Aadhaar Back</p>
            {user?.aadhaar_back ? (
              <img
                src={user.aadhaar_back}
                alt="Aadhaar Back"
                style={{ width: '100%', height: 95, objectFit: 'cover', borderRadius: 6, marginBottom: 8, opacity: user?.verified ? 0.7 : 1 }}
              />
            ) : (
              <div style={{ height: 95, background: 'rgba(15,23,42,0.06)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                <Icon name="idCard" size={26} />
              </div>
            )}
            <label
              className="btn small"
              style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', cursor: user?.verified ? 'not-allowed' : 'pointer', background: user?.verified ? '#e2e8f0' : undefined, color: user?.verified ? '#94a3b8' : undefined, border: user?.verified ? '1px solid #cbd5e1' : undefined }}
            >
              {uploading.back ? 'Uploading…' : user?.verified ? <Icon name="lock" size={12} /> : user?.aadhaar_back ? 'Change Back' : 'Upload Back'}
              {!user?.verified && (
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => handleMediaUpload('back', e.target.files?.[0])}
                />
              )}
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Phone pending records: drafts (saved locally, verified then pushed) plus
 * queued packages (collected "done" but not yet synced to the server).
 * Surveyors see every done record here BEFORE it reaches the admin.
 */
function DraftsScreen({ user, onToast, onEdit }) {
  const [items, setItems] = useState(null)
  const [pushing, setPushing] = useState(null)
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    try {
      await collapseDuplicateDrafts().catch(() => {})
      const [drafts, queued] = await Promise.all([listDrafts(), listPendingPackages()])
      const all = [
        ...(drafts || []).map((d) => ({ ...d, kind: 'draft' })),
        ...(queued || []).map((q) => ({ ...q, kind: 'queued' })),
      ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      setItems(all)
    } catch {
      setItems([])
    }
  }, [])

  useEffect(() => {
    load()
    const onQ = () => load()
    window.addEventListener('esurvey-queue-change', onQ)
    return () => window.removeEventListener('esurvey-queue-change', onQ)
  }, [load])

  const push = async (id) => {
    setPushing(id)
    try {
      await pushDraft(id)
      onToast?.('Sent — pending review', 'ok')
      void forceSyncNow()
      await load()
    } catch (e) {
      onToast?.(e.message || 'Send failed', 'error')
    } finally {
      setPushing(null)
    }
  }

  const remove = async (id) => {
    if (!confirm('Delete this from the phone? It will not be sent.')) return
    await deleteDraft(id).catch(() => {})
    await load()
  }

  const retry = async () => {
    await forceSyncNow().catch(() => {})
    await load()
  }

  const draftN = (items || []).filter((i) => i.kind === 'draft').length
  const queuedN = (items || []).filter((i) => i.kind === 'queued').length
  const pendingNums = recordNumberMap(items || [], 'id', 'createdAt', null)

  return (
    <div className="screen home-screen">
      <p className="ptr-hint">Items stay on this phone until you send them</p>
      <div className="hero-card">
        <p className="eyebrow">Pending</p>
        <h1>{user?.name || user?.username}</h1>
        <p className="hero-sub">
          {items == null
            ? 'Loading…'
            : `${items.length} pending · ${draftN} draft · ${queuedN} waiting to sync`}
        </p>
        <div className="pill-row">
          <button type="button" className="cta secondary" onClick={load}>
            Refresh
          </button>
          {queuedN > 0 && (
            <button type="button" className="cta" onClick={retry}>
              Sync now
            </button>
          )}
        </div>
      </div>

      {items && items.length === 0 && (
        <div className="card" style={{ marginTop: 12, padding: '14px' }}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Nothing pending — collected activity stays on this phone as drafts. Review them here
            and tap Send.
          </p>
        </div>
      )}

      {items?.map((d) => {
        const qa = d.qa || {}
        const a = qa.answers || {}
        const loc = qa.location_details || {}
        const open = openId === d.id
        const isDraft = d.kind === 'draft'
        const isFailed = d.phase === 'failed'
        const isSyncing = d.phase === 'syncing'
        const failedReq = packageFailedRequirements(d)
        const pendingNo = pendingNums.get(d.id) ?? 0
        const kindLabel = isFailed || failedReq ? 'Failed' : isDraft ? 'Draft' : 'Queued'
        return (
          <div key={d.id} className="card" style={{ marginTop: 12, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 14 }}>
                {a.respondent_name || a.district || loc.display_name || 'Survey'}
                <span className="pill" style={{ fontWeight: 'bold', background: '#e0f2fe', color: '#0369a1', marginLeft: 6 }}>
                  {kindLabel} #{pendingNo}
                </span>
              </strong>
              <span className={`pending-chip ${isFailed || failedReq ? 'fail' : isDraft ? 'draft' : 'sync'}`}>
                {isFailed || failedReq ? 'failed' : isDraft ? 'draft' : 'to sync'}
              </span>
            </div>
            <span className="muted" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
              {String(d.createdAt || '').slice(0, 16).replace('T', ' ')} · geo{' '}
              {qa.geo?.lat != null ? <Icon name="check" size={11} /> : <Icon name="cross" size={11} />} · photo {d.photoDataUrl ? <Icon name="check" size={11} /> : <Icon name="cross" size={11} />} · voice{' '}
              {d.audioDataUrl ? <Icon name="check" size={11} /> : <Icon name="cross" size={11} />}
            </span>

            {isDraft && (
              <span className="muted" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                Status: {typeof d.step === 'number' ? `step ${d.step + 1}/4` : 'draft'}
                {d.total != null
                  ? ` · ${d.answered ?? 0}/${d.total} questions answered`
                  : ''}
              </span>
            )}

            {(isFailed || failedReq) && (
              <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                {isFailed
                  ? `Sync failed${d.lastError ? `: ${d.lastError}` : ''}`
                  : 'Missing GPS, photo or voice lock'}
                {' '}— delete this item or fix and retry.
              </p>
            )}
            {!isDraft && !isFailed && !failedReq && (
              <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                {isSyncing ? 'Syncing to server…' : 'Waiting for network — auto-syncs when online.'}
              </p>
            )}

            {(isDraft || failedReq) && (
              <div className="act-actions">
                {isDraft && (
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={pushing === d.id}
                    onClick={() => onEdit(d)}
                  >
                    Edit
                  </button>
                )}
                {isDraft && !failedReq && (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={pushing === d.id}
                    onClick={() => push(d.id)}
                  >
                    {pushing === d.id ? 'Sending…' : 'Send'}
                  </button>
                )}
                {failedReq && !isDraft && (
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={pushing === d.id}
                    onClick={retry}
                  >
                    Retry sync
                  </button>
                )}
                <button
                  type="button"
                  className="btn secondary danger-cta"
                  disabled={pushing === d.id}
                  onClick={() => remove(d.id)}
                >
                  Delete
                </button>
              </div>
            )}

            <button
              type="button"
              className="btn small"
              style={{ marginTop: 8 }}
              onClick={() => setOpenId(open ? null : d.id)}
            >
              {open ? 'Hide answers ▲' : 'Show answers ▼'}
            </button>
            {open && (
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {Object.entries(a)
                  .filter(([k]) => !String(k).startsWith('_'))
                  .map(([k, v]) => (
                    <div key={k}>
                      <strong>{k}:</strong> {String(v)}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const NAV_MODE_INFO = {
  next: { title: 'Next button', desc: 'One question at a time, with Prev / Next buttons.' },
  swipe: { title: 'Swipe', desc: 'One question at a time — swipe left or right to move.' },
  scroll: { title: 'Vertical scroll', desc: 'All questions in one scrollable page.' },
}
const FONT_SCALE_LABELS = ['Normal', 'Large', 'Larger', 'Largest']

/** Device-local UI preferences: survey question layout + app display size. */
function SurveyorSettingsScreen({ navMode, onNavModeChange, fontScale, onFontScaleChange }) {
  return (
    <div className="screen settings-screen" style={{ padding: '12px 14px 110px' }}>
      <div className="card" style={{ marginBottom: 14, padding: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 16 }}>Survey question layout</h3>
        <p className="muted" style={{ marginTop: 0, marginBottom: 14, fontSize: 13 }}>
          Choose how questions appear while collecting a survey. Saved on this device only.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          {NAV_MODES.map((mode) => {
            const info = NAV_MODE_INFO[mode]
            const selected = navMode === mode
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onNavModeChange(mode)}
                aria-pressed={selected}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: selected ? '2px solid #00e599' : '2px solid #e2e8f0',
                  background: selected ? 'rgba(0,229,153,0.10)' : '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    flexShrink: 0,
                    boxSizing: 'border-box',
                    border: selected ? '6px solid #00e599' : '2px solid #cbd5e1',
                  }}
                />
                <span>
                  <strong style={{ display: 'block', fontSize: 15 }}>{info.title}</strong>
                  <span className="muted" style={{ fontSize: 12.5 }}>{info.desc}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 16 }}>Display size</h3>
        <p className="muted" style={{ marginTop: 0, marginBottom: 14, fontSize: 13 }}>
          Make the whole app bigger for easier reading outdoors.
        </p>
        <div
          className="qa-options"
          style={{ display: 'grid', gridTemplateColumns: `repeat(${FONT_SCALES.length}, 1fr)`, gap: 8 }}
        >
          {FONT_SCALES.map((scale, i) => {
            const selected = fontScale === scale
            return (
              <button
                key={scale}
                type="button"
                className={`qa-opt${selected ? ' selected' : ''}`}
                onClick={() => onFontScaleChange(scale)}
                aria-pressed={selected}
                style={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 52 }}
              >
                <span style={{ fontSize: `${Math.round(13 * scale)}px`, fontWeight: 700, lineHeight: 1 }}>A</span>
                <span style={{ fontSize: 10.5 }}>{FONT_SCALE_LABELS[i]}</span>
              </button>
            )
          })}
        </div>
        <div className="card" style={{ marginTop: 14, background: '#f8fafc', padding: '12px 14px' }}>
          <span className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Preview
          </span>
          <p style={{ margin: '6px 0 0' }}>The quick brown fox jumps — 1234567890</p>
        </div>
      </div>
    </div>
  )
}

export default function SurveyorApp() {
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [tab, setTab] = useState('home')
  const [network, setNetwork] = useState(null)
  const [pendingSync, setPendingSync] = useState(() => queueCount())
  const [myProgress, setMyProgress] = useState(null)
  const [questionsMeta, setQuestionsMeta] = useState(null)
  const [toast, setToast] = useState(null)
  const [collectKey, setCollectKey] = useState(0)
  const [editDraft, setEditDraft] = useState(null)
  const [draftsCount, setDraftsCount] = useState(0)
  // Device-local UI prefs (per-phone, not synced to the account).
  const [navMode, setNavModeState] = useState(getNavMode)
  const [fontScale, setFontScaleState] = useState(getFontScale)
  const wasVerified = useRef(false)

  const changeNavMode = useCallback((mode) => {
    setNavModeState(persistNavMode(mode))
  }, [])

  const changeFontScale = useCallback((scale) => {
    setFontScaleState(persistFontScale(scale))
  }, [])

  // Apply the display-size zoom to the whole app on mount and whenever it
  // changes, so the scale is live on every tab — not just Settings.
  useEffect(() => {
    applyFontScale(fontScale)
  }, [fontScale])

  const verified = !!user?.verified
  const lockForVerify = !!user && user.role === 'surveyor' && !verified

  const alertVerifyPending = useCallback(() => {
    window.alert(
      'Surveyor profile verification is pending. Client Admin must verify your profile before you can open Home or collect.',
    )
  }, [])

  const refreshDraftCount = useCallback(async () => {
    try {
      const s = await getQueueSnapshot()
      setPendingSync(s.pending ?? 0)
      setDraftsCount((s.drafts ?? 0) + (s.pending ?? 0))
    } catch {
      try {
        setDraftsCount(await draftCount())
      } catch {
        /* ignore */
      }
    }
  }, [])

  const toastTimer = useRef(0)
  const notify = useCallback((message, type = 'ok') => {
    setToast({ message, type })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3200)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  /** App-wide pull-to-refresh: tab-aware — refreshes right data for active tab */
  const pullRefreshAll = useCallback(async () => {
    try {
      // Always fetch fresh user profile (catches admin verification, phone changes)
      const meRes = await me().catch(() => null)
      if (meRes?.user) setUser(meRes.user)

      if (tab === 'profile') {
        // Profile tab: just user refresh + feedback
        notify('Profile refreshed', 'ok')
        return
      }

      if (tab === 'records') {
        // Records tab: user + progress + sent list
        const prog = await getMyProgress().catch(() => null)
        if (prog) setMyProgress(prog)
        window.dispatchEvent(new Event('esurvey-activity-refresh'))
        notify('Activity refreshed ✓', 'ok')
        return
      }

      // Home / Collect / Drafts: full refresh
      const [data, prog, queue] = await Promise.all([
        getSurveyForm(),
        getMyProgress().catch(() => null),
        getQueueSnapshot().catch(() => null),
      ])
      setQuestionsMeta({
        title: data.title,
        count: (data.questions || []).length,
        questions: data.questions,
        updated_at: data.updated_at,
      })
      if (prog) setMyProgress(prog)
      if (queue) setPendingSync(queue.pending ?? 0)
      notify(
        `Refreshed · ${(data.questions || []).length} question(s)` +
          (prog ? ` · ${prog.done ?? 0}/${prog.target || '—'}` : ''),
        'ok',
      )
    } catch (e) {
      notify(e.message || 'Pull refresh failed', 'error')
      throw e
    }
  }, [notify, tab])

  const onCollectDone = useCallback((_id, prog) => {
    setEditDraft(null)
    if (prog) setMyProgress(prog)
    else getMyProgress().then(setMyProgress).catch(() => {})
    void getQueueSnapshot().then((s) => setPendingSync(s.pending)).catch(() => {})
  }, [])

  const onCollectSavedDraft = useCallback(() => {
    setEditDraft(null)
    setTab('drafts')
    refreshDraftCount()
  }, [refreshDraftCount])

  const onCollectIdleHome = useCallback(() => {
    setEditDraft(null)
    setTab(lockForVerify ? 'profile' : 'home')
    setCollectKey((k) => k + 1)
  }, [lockForVerify])

  const handleLogout = useCallback(async () => {
    stopSyncEngine()
    await logout()
    setUser(null)
    setMyProgress(null)
    setTab('home')
    notify('Logged out', 'ok')
  }, [notify])

  useEffect(() => {
    if (!user || !authReady) return undefined
    const stopNet = watchNetwork((s) => {
      setNetwork((prev) => {
        if (prev && prev.quality === s.quality && prev.online === s.online) return prev
        return s
      })
    }, { intervalMs: 60_000 })
    startSyncEngine()
    setPendingSync(queueCount())
    void refreshQueueCountCache().then(setPendingSync)
    void collapseDuplicateDrafts()
      .catch(() => {})
      .then(() => getQueueSnapshot())
      .then((s) => {
        setPendingSync(s.pending)
        setDraftsCount((s.drafts ?? 0) + (s.pending ?? 0))
      })
    void refreshDraftCount()

    const offSync = onSyncEngine((ev) => {
      if (ev.type === 'drain-done') {
        setPendingSync(ev.pending ?? 0)
        if (ev.ok > 0) {
          notify(`Queue synced: ${ev.ok} package(s)`, 'ok')
          getMyProgress().then(setMyProgress).catch(() => {})
        }
      }
      if (ev.type === 'package-done') {
        void getQueueSnapshot().then((s) => {
          setPendingSync(s.pending)
          setDraftsCount((s.drafts ?? 0) + (s.pending ?? 0))
        })
      }
    })

    const onQueue = () => {
      void getQueueSnapshot().then((s) => {
        setPendingSync(s.pending)
        setDraftsCount((s.drafts ?? 0) + (s.pending ?? 0))
      })
    }
    window.addEventListener('esurvey-queue-change', onQueue)

    return () => {
      stopNet()
      offSync()
      window.removeEventListener('esurvey-queue-change', onQueue)
      stopSyncEngine()
    }
  }, [user, authReady, notify])



  const loadAppData = useCallback(async () => {
    if (!getToken()) return
    const [prog, form] = await Promise.all([
      getMyProgress().catch(() => null),
      getSurveyForm().catch(() => null),
    ])
    if (prog) setMyProgress(prog)
    if (form) {
      setQuestionsMeta({
        title: form.title,
        count: (form.questions || []).length,
        questions: form.questions,
        updated_at: form.updated_at,
      })
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    // New UI install → force login screen (not old cached home)
    const forced = ensureUiVersion()
    if (forced) {
      setUser(null)
      setAuthReady(true)
      return undefined
    }

    const timeout = setTimeout(() => {
      if (!cancelled) {
        setUser(null)
        setAuthReady(true)
      }
    }, 4000)

    ;(async () => {
      if (!getToken()) {
        clearTimeout(timeout)
        if (!cancelled) {
          setUser(null)
          setAuthReady(true)
        }
        return
      }
      try {
        const data = await me()
        const role = data.user?.role
        // Field app: only surveyor accounts created by Client Admin
        if (role !== 'surveyor') {
          await logout()
          if (!cancelled) {
            setUser(null)
            setAuthReady(true)
            notify(
              role === 'admin'
                ? 'Client Admin uses /admin portal'
                : 'Need a surveyor login from Client Admin',
              'error',
            )
          }
          return
        }
        // Defensive: never auto-login a disabled account
        if (data.user?.active === false) {
          await logout()
          if (!cancelled) {
            setUser(null)
            setAuthReady(true)
            notify('Account disabled — contact Client Admin', 'error')
          }
          return
        }
        if (!cancelled) {
          setUser(data.user)
          setAuthReady(true)
        }
      } catch {
        if (!cancelled) {
          await logout()
          setUser(null)
          setAuthReady(true)
        }
      } finally {
        clearTimeout(timeout)
      }
    })()
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [notify])

  // Global listener for 401 / unauthorized events (e.g. account updated, role changed, password reset)
  useEffect(() => {
    const onUnauthorized = (e) => {
      stopSyncEngine()
      clearSession()
      setUser(null)
      setMyProgress(null)
      const msg = e?.detail?.error || 'Account updated or session expired — please log in again'
      notify(msg, 'error')
    }
    window.addEventListener('esurvey-unauthorized', onUnauthorized)
    return () => window.removeEventListener('esurvey-unauthorized', onUnauthorized)
  }, [notify])

  // Account revalidation — a disabled/inactive user must never stay logged in or auto-login:
  // re-check every 120 seconds and whenever the app returns to foreground. 401/disabled → force
  // logout (clears the stored session). Transient network errors keep the session so a
  // surveyor in the field is never logged out by a bad connection.
  useEffect(() => {
    if (!user || !authReady) return undefined
    let dead = false
    const check = async () => {
      try {
        const res = await me()
        if (!res?.user || res.user.active === false || res.user.role !== 'surveyor') {
          const err = new Error('Account no longer active')
          err.status = 401
          err.disabled = true
          throw err
        }
        // Only re-set when something actually changed (avoids effect churn on identical objects)
        if (!dead && res.user.verified !== user.verified) setUser(res.user)
      } catch (e) {
        if (dead) return
        if (e?.status === 401 || e?.disabled) {
          stopSyncEngine()
          await logout().catch(() => {})
          setUser(null)
          setMyProgress(null)
          notify(
            e?.disabled ? 'Account updated / disabled — logged out' : 'Session expired — sign in again',
            'error',
          )
        }
        // else: transient network error — keep session, retry next tick
      }
    }
    const iv = setInterval(check, 120 * 1000)
    let visTimer = 0
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      window.clearTimeout(visTimer)
      visTimer = window.setTimeout(() => {
        if (!dead) void check()
      }, 800)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      dead = true
      clearInterval(iv)
      window.clearTimeout(visTimer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [user, authReady, notify])

  useEffect(() => {
    if (user && authReady) loadAppData()
  }, [user, authReady, loadAppData])

  useEffect(() => {
    if (!user) return
    if (user.role !== 'surveyor') {
      logout()
      setUser(null)
      notify('Surveyor app only — login must be created by Client Admin', 'error')
      return
    }
    if (!TABS.some((t) => t.id === tab)) setTab(lockForVerify ? 'profile' : 'home')
    if (lockForVerify && tab !== 'profile') setTab('profile')
  }, [user, tab, notify, lockForVerify])

  useEffect(() => {
    if (!user) {
      wasVerified.current = false
      return
    }
    if (user.verified && !wasVerified.current) {
      notify('Profile verified ✓ Home is unlocked', 'ok')
    }
    wasVerified.current = !!user.verified
  }, [user, notify])

  if (!authReady) {
    return (
      <div className="mobile-shell login-screen">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <p className="eyebrow">Field survey</p>
          <h1 style={{ fontSize: 22 }}>Starting…</h1>
          <p className="login-sub">Checking session</p>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              logout()
              setUser(null)
              setAuthReady(true)
            }}
          >
            Go to login
          </button>
        </div>
      </div>
    )
  }

  if (!user) {
    // Full-screen login (no bottom nav) — new surveyor login UI
    return (
      <div className="mobile-shell login-only">
        {toast && (
          <div className={`toast ${toast.type}`} role="status">
            {toast.message}
          </div>
        )}
        <LoginScreen
          onToast={notify}
          onSuccess={(u) => {
            setUser(u)
            if (u?.role === 'surveyor' && !u.verified) {
              setTab('profile')
              window.alert(
                'Surveyor profile verification is pending. Client Admin must verify your profile before you can open Home or collect.',
              )
            } else {
              setTab('home')
            }
          }}
        />
      </div>
    )
  }

  return (
    <div className="mobile-shell">
      {toast && (
        <div className={`toast ${toast.type}`} role="status">
          {toast.message}
        </div>
      )}

      <main className="main">
        <PullToRefresh
          disabled={tab === 'collect'}
          onRefresh={pullRefreshAll}
          label={tab === 'profile' ? '↓ Pull to refresh profile' : tab === 'records' ? '↓ Pull to refresh activity' : '↓ Pull to refresh'}
          refreshingLabel={tab === 'profile' ? 'Refreshing profile…' : tab === 'records' ? 'Refreshing activity…' : 'Refreshing…'}
        >
          {tab === 'home' && (
            <HomeScreen
              user={user}
              network={network}
              pendingSync={pendingSync}
              pendingLocal={draftsCount}
              myProgress={myProgress}
              questionsMeta={questionsMeta}
              onNewSurvey={() => {
                if (lockForVerify) {
                  alertVerifyPending()
                  setTab('profile')
                  return
                }
                setTab('collect')
              }}
              onSync={() => {
                forceSyncNow().then(() => notify('Syncing device queue…', 'ok'))
              }}
              onLogout={handleLogout}
            />
          )}
          <div style={{ display: tab === 'collect' ? 'block' : 'none' }}>
            <CollectErrorBoundary onReset={() => setCollectKey((k) => k + 1)}>
              <FieldCollectScreen
                key={collectKey}
                active={tab === 'collect'}
                user={user}
                draft={editDraft}
                navMode={navMode}
                onToast={notify}
                onDone={onCollectDone}
                onSavedDraft={onCollectSavedDraft}
                onIdleHome={onCollectIdleHome}
              />
            </CollectErrorBoundary>
          </div>
          {tab === 'drafts' && (
            <DraftsScreen
              user={user}
              onToast={notify}
              onEdit={(d) => {
                if (lockForVerify) {
                  alertVerifyPending()
                  setTab('profile')
                  return
                }
                setEditDraft(d)
                setCollectKey((k) => k + 1)
                setTab('collect')
                notify('Draft loaded — review, then send', 'ok')
              }}
            />
          )}
          {tab === 'records' && <MyRecordsScreen user={user} onToast={notify} />}
          {tab === 'profile' && (
            <SurveyorProfileScreen
              user={user}
              onToast={notify}
              onUserUpdated={setUser}
            />
          )}
          {tab === 'settings' && (
            <SurveyorSettingsScreen
              navMode={navMode}
              onNavModeChange={changeNavMode}
              fontScale={fontScale}
              onFontScaleChange={changeFontScale}
            />
          )}
        </PullToRefresh>
      </main>

      <nav
        className="bottom-nav"
        aria-label="Main"
        style={{ gridTemplateColumns: `repeat(${TABS.length}, 1fr)` }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'nav-item active' : 'nav-item'}
            style={lockForVerify && t.id !== 'profile' ? { opacity: 0.4 } : undefined}
            aria-disabled={lockForVerify && t.id !== 'profile'}
            onClick={() => {
              if (lockForVerify && t.id !== 'profile') {
                alertVerifyPending()
                setTab('profile')
                return
              }
              setTab(t.id)
            }}
          >
            <span className="nav-icon" aria-hidden>
              <Icon name={t.icon} size={20} />
              {t.id === 'drafts' && draftsCount > 0 && (
                <span className="nav-badge" aria-label={`${draftsCount} pending`}>
                  {draftsCount > 99 ? '99+' : draftsCount}
                </span>
              )}
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
