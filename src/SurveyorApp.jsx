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
  getPackage,
  listDrafts,
  listPendingPackages,
  pushDraft,
  updatePackage,
} from './localStore'
import { clearSession, getSurveyForm } from './api'
import { APP_BUILD, APP_VERSION, APP_VERSION_CODE, versionLabel } from './version'
import { slugQuestionKey } from './questionKey'
import { compressImageFile } from './mediaOptimize'
import PhoneIndiaField from './PhoneIndiaField'
import { isValidInMobile, toE164In } from './phoneIn'
import VerifiedBadge from './VerifiedBadge'
import {
  getNavMode,
  setNavMode as persistNavMode,
  getFontScale,
  setFontScale as persistFontScale,
  applyFontScale,
  getDisplayLang,
  setDisplayLang as persistDisplayLang,
  NAV_MODES,
} from './prefs'
import './App.css'

function mergeUserKeepMedia(prev, next) {
  if (!next) return prev || null
  return {
    ...prev,
    ...next,
    photo: next.photo || prev?.photo || null,
    aadhaar_front: next.aadhaar_front || prev?.aadhaar_front || null,
    aadhaar_back: next.aadhaar_back || prev?.aadhaar_back || null,
  }
}

/** Surveyor-only field app (mobile / APK) — 4 focused tabs */
const TABS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'collect', label: 'Collect', icon: 'pencil' },
  { id: 'submissions', label: 'Submissions', icon: 'box' },
  { id: 'profile', label: 'Profile', icon: 'user' },
]

/** Record build stamp in local storage without clearing active session. */
function ensureUiVersion() {
  try {
    const key = 'esurvey_ui_build'
    const stamp = `${APP_VERSION}:${APP_VERSION_CODE}:${APP_BUILD}`
    const prev = localStorage.getItem(key)
    if (prev !== stamp) {
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

/** Queue / activity lists must never print photo or voice payloads. */
function queueAnswerText(v) {
  if (v == null || v === '') return null
  if (Array.isArray(v)) {
    const parts = v.map(queueAnswerText).filter(Boolean)
    return parts.length ? parts.join(', ') : null
  }
  if (typeof v === 'object') return null
  const s = String(v)
  if (/^data:(image|audio|video)\//i.test(s)) return null
  if (s.length > 400 && /^[A-Za-z0-9+/=]+$/.test(s.slice(0, 80))) return null
  return s
}

function isAnswerMetaKey(k) {
  const s = String(k || '')
  if (!s || s.startsWith('_') || s.startsWith('geo_') || s.startsWith('location_')) return true
  return [
    'draft',
    'data_collector',
    'client_package_id',
    'submitted_by',
    'has_photo',
    'has_audio',
    'photo',
    'audio',
    'photo_url',
    'audio_url',
  ].includes(s)
}

/** Show the question text, never the field id slug. */
function labelForAnswerKey(key, questions) {
  const k = String(key || '')
  const hit = (questions || []).find((q) => {
    const id = String(q.id || '')
    const label = String(q.label || '')
    return id === k || label === k || slugQuestionKey(label) === k
  })
  if (hit?.label) return hit.label
  if (hit?.label_en) return hit.label_en
  return 'Question'
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
  const hasPhoto = !!(d.hasPhoto || d.flags?.photo)
  const hasVoice = !!(d.hasAudio || d.flags?.audio)
  if (d.kind !== 'draft' && (!hasGeo || !hasPhoto || !hasVoice)) return true
  return /GPS|voice|lock|incomplete|required|too large|compress|geo_lock/i.test(
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
  _onViewRecords,
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

      {(questionsMeta?.title || (questionsMeta?.surveys || []).length > 0) && (
        <div className="pill-row" style={{ paddingTop: 0 }}>
          <span className="pill ok" style={{ fontSize: 11 }}>
            {(questionsMeta.surveys || []).length > 1
              ? `${questionsMeta.surveys.length} surveys assigned`
              : questionsMeta.title}
          </span>
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

/** My submitted records — answers only; photo/audio stay off this list. */
function MyRecordsScreen({ user, onToast, questions }) {
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
                              if (isAnswerMetaKey(k)) return null
                              const valStr = queueAnswerText(v)
                              if (!valStr) return null
                              return (
                                <tr key={k} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                  <td className="muted" style={{ padding: '6px 8px' }}>{labelForAnswerKey(k, questions)}:</td>
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


function SurveyorProfileScreen({ user, onToast, onUserUpdated }) {
  const [phone, setPhone] = useState(user?.phone || '')
  const [savingPhone, setSavingPhone] = useState(false)
  const [editingPhone, setEditingPhone] = useState(false)
  const [uploading, setUploading] = useState({ photo: false, front: false, back: false })

  useEffect(() => {
    setPhone(user?.phone || '')
  }, [user?.phone])

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
      const compressedDataUrl = await compressImageFile(file)
      const res = await uploadProfileMedia(fieldKey, compressedDataUrl)
      const newUrl = res?.[fieldKey] || compressedDataUrl
      onUserUpdated?.((prev) => ({ ...prev, [fieldKey]: newUrl }))
      onToast?.(`${fieldKey.replace('_', ' ')} updated ✓`, 'ok')
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
      setEditingPhone(false)
      onToast?.('Phone number updated ✓', 'ok')
      me().then((m) => m?.user && onUserUpdated?.(m.user)).catch(() => {})
    } catch (err) {
      onToast?.(err.message || 'Failed to update phone', 'error')
    } finally {
      setSavingPhone(false)
    }
  }

  const initials = (user?.name || user?.username || 'S')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="screen profile-screen" style={{ padding: '8px 0 100px' }}>
      {/* Centered Profile Hero */}
      <div className="prof">
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: 8 }}>
          {user?.photo ? (
            <img
              src={user.photo}
              alt="Profile"
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                objectFit: 'cover',
                border: '2px solid #bfdbfe',
              }}
            />
          ) : (
            <div className="avatar">
              {initials}
            </div>
          )}
          <label
            style={{
              position: 'absolute',
              bottom: -2,
              right: -2,
              background: '#ffffff',
              borderRadius: '50%',
              width: 24,
              height: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: user?.verified ? 'default' : 'pointer',
              fontSize: 12,
              boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
              border: '1px solid #e2e8f0',
            }}
            title={user?.verified ? 'Photo locked' : 'Upload photo'}
          >
            {user?.verified ? '🔒' : uploading.photo ? '…' : '📷'}
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

        <div className="pname" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          {user?.name || user?.display_name || user?.username}
          {user?.verified ? <VerifiedBadge size={16} /> : null}
        </div>
        <div className="puser">@{user?.username}</div>
        <div className="keychip">
          Key ID: {user?.key_id || `GROUND-KEY-${String(user?.id || '0000').padStart(4, '0')}`}
        </div>
      </div>

      {/* Phone Card */}
      <div className="idcard">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h4>📞 Phone {user?.verified ? '🔒' : ''}</h4>
          {!user?.verified && !editingPhone && (
            <button
              type="button"
              onClick={() => setEditingPhone(true)}
              style={{
                background: 'none',
                border: 'none',
                color: '#1a73e8',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Edit
            </button>
          )}
        </div>
        {editingPhone ? (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <PhoneIndiaField value={phone} onChange={setPhone} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn small primary"
                disabled={savingPhone}
                onClick={handleSavePhone}
                style={{ flex: 1 }}
              >
                {savingPhone ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  setPhone(user?.phone || '')
                  setEditingPhone(false)
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p style={{ margin: '2px 0 0' }}>
            {user?.phone ? `${user.phone} · verified` : 'No phone linked'}
          </p>
        )}
      </div>

      {/* Aadhaar Card with Compact Tiles */}
      <div className="idcard">
        <h4>🪪 Aadhaar Identity {user?.verified ? '🔒' : ''}</h4>
        <p style={{ margin: '2px 0 0' }}>
          {user?.verified ? 'Verified documents locked' : 'Upload front & back to verify'}
        </p>
        <div className="id-tiles">
          {/* Front Tile */}
          <label
            className={`id-tile ${user?.aadhaar_front ? 'ok' : ''}`}
            style={{ position: 'relative', overflow: 'hidden', cursor: user?.verified ? 'default' : 'pointer' }}
          >
            {user?.aadhaar_front ? (
              <>
                <img
                  src={user.aadhaar_front}
                  alt="Front"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.25 }}
                />
                <span style={{ position: 'relative', zIndex: 1 }}>Front ✓</span>
              </>
            ) : (
              <span>{uploading.front ? 'Uploading…' : '＋ Front'}</span>
            )}
            {!user?.verified && (
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => handleMediaUpload('front', e.target.files?.[0])}
              />
            )}
          </label>

          {/* Back Tile */}
          <label
            className={`id-tile ${user?.aadhaar_back ? 'ok' : ''}`}
            style={{ position: 'relative', overflow: 'hidden', cursor: user?.verified ? 'default' : 'pointer' }}
          >
            {user?.aadhaar_back ? (
              <>
                <img
                  src={user.aadhaar_back}
                  alt="Back"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.25 }}
                />
                <span style={{ position: 'relative', zIndex: 1 }}>Back ✓</span>
              </>
            ) : (
              <span>{uploading.back ? 'Uploading…' : '＋ Back'}</span>
            )}
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

      {/* App Preferences & Settings */}
      <div className="card" style={{ marginTop: 14, padding: 16 }}>
        <h4 style={{ marginTop: 0, marginBottom: 8, fontSize: 15 }}>🌐 Display Language</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {[
            { id: 'en', label: 'English' },
            { id: 'te', label: 'తెలుగు' },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip ${displayLang === p.id ? 'selected' : ''}`}
              onClick={() => onDisplayLangChange?.(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <h4 style={{ marginTop: 0, marginBottom: 8, fontSize: 15 }}>📝 Question Layout</h4>
        <div style={{ display: 'grid', gap: 8 }}>
          {NAV_MODES.map((mode) => {
            const info = NAV_MODE_INFO[mode]
            const selected = navMode === mode
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onNavModeChange?.(mode)}
                aria-pressed={selected}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: selected ? '2px solid #00e599' : '1px solid #e2e8f0',
                  background: selected ? 'rgba(0,229,153,0.08)' : '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    border: selected ? '5px solid #00e599' : '2px solid #cbd5e1',
                    boxSizing: 'border-box',
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: selected ? 700 : 500 }}>{info.title}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* App Version & OTA Updates */}
      <div className="card" style={{ marginTop: 14, padding: 16, textAlign: 'center' }}>
        <p style={{ margin: '0 0 8px', fontSize: 13, color: '#64748b', fontWeight: 600 }}>
          {versionLabel()}
        </p>
        <button
          type="button"
          className="btn small"
          style={{ width: '100%', marginBottom: 10 }}
          onClick={async () => {
            onToast?.('Checking for updates…', 'ok')
            try {
              const res = await checkForAppUpdate({ ignoreDismissed: true })
              if (res.hasUpdate) {
                launchApkUpdate(res.latest.apkUrl)
              } else {
                onToast?.('App is up to date ✓', 'ok')
              }
            } catch {
              onToast?.('Could not check updates', 'error')
            }
          }}
        >
          ⚡ Check for Updates
        </button>

        <button
          type="button"
          className="cta secondary danger-cta"
          style={{ width: '100%', marginTop: 6 }}
          onClick={onLogout}
        >
          Log out
        </button>
      </div>
    </div>
  )
}

/**
 * Phone pending records: drafts (saved locally, verified then pushed) plus
 * queued packages (collected "done" but not yet synced to the server).
 * Surveyors see every done record here BEFORE it reaches the admin.
 */
function DraftsScreen({ user, onToast, onEdit, questions }) {
  const [items, setItems] = useState(null)
  const [pushing, setPushing] = useState(null)
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    try {
      await collapseDuplicateDrafts().catch(() => {})
      const [drafts, queued] = await Promise.all([
        listDrafts({ media: false }),
        listPendingPackages(),
      ])
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
              {String(d.createdAt || '').slice(0, 16).replace('T', ' ')}
              {qa.form_key ? ` · ${qa.form_key}` : ''}
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

            <div
              className="act-actions"
              style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}
            >
              {!isSyncing && (
                <button
                  type="button"
                  className="btn primary"
                  disabled={pushing === d.id}
                  onClick={() => onEdit(d)}
                  style={{ flex: '1 1 120px' }}
                >
                  Edit
                </button>
              )}
              {isDraft && !failedReq && (
                <button
                  type="button"
                  className="btn secondary"
                  disabled={pushing === d.id}
                  onClick={() => push(d.id)}
                  style={{ flex: '1 1 120px' }}
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
                  style={{ flex: '1 1 120px' }}
                >
                  Retry sync
                </button>
              )}
              <button
                type="button"
                className="btn secondary danger-cta"
                disabled={pushing === d.id || isSyncing}
                onClick={() => remove(d.id)}
                style={{ flex: '1 1 120px' }}
              >
                Delete
              </button>
            </div>

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
                  .filter(([k, v]) => !isAnswerMetaKey(k) && queueAnswerText(v) != null)
                  .map(([k, v]) => (
                    <div key={k}>
                      <strong>{labelForAnswerKey(k, questions)}:</strong> {queueAnswerText(v)}
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

/**
 * Combined Submissions tab: switch between Pending Drafts and Sent Activity.
 */
function SubmissionsScreen({ user, onToast, onEdit, questions, initialSubTab = 'drafts' }) {
  const [subTab, setSubTab] = useState(initialSubTab)
  const [draftsN, setDraftsN] = useState(0)

  useEffect(() => {
    const updateCount = async () => {
      try {
        const [d, q] = await Promise.all([listDrafts({ media: false }), listPendingPackages()])
        setDraftsN((d?.length || 0) + (q?.length || 0))
      } catch {
        setDraftsN(0)
      }
    }
    void updateCount()
    window.addEventListener('esurvey-queue-change', updateCount)
    return () => window.removeEventListener('esurvey-queue-change', updateCount)
  }, [])

  return (
    <div className="screen submissions-shell" style={{ paddingBottom: 90 }}>
      <div
        style={{
          display: 'flex',
          background: '#f1f5f9',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: 4,
          margin: '10px 14px 12px',
          gap: 4,
        }}
      >
        <button
          type="button"
          onClick={() => setSubTab('drafts')}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 8,
            border: 'none',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            background: subTab === 'drafts' ? '#ffffff' : 'transparent',
            color: subTab === 'drafts' ? '#0f172a' : '#64748b',
            boxShadow: subTab === 'drafts' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          📦 Pending Sync
          {draftsN > 0 && (
            <span
              style={{
                background: '#ef4444',
                color: '#fff',
                fontSize: 11,
                padding: '1px 6px',
                borderRadius: 999,
                fontWeight: 700,
              }}
            >
              {draftsN}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setSubTab('records')}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 8,
            border: 'none',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            background: subTab === 'records' ? '#ffffff' : 'transparent',
            color: subTab === 'records' ? '#0f172a' : '#64748b',
            boxShadow: subTab === 'records' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
          }}
        >
          📜 Sent Activity
        </button>
      </div>

      {subTab === 'drafts' ? (
        <DraftsScreen user={user} questions={questions} onToast={onToast} onEdit={onEdit} />
      ) : (
        <MyRecordsScreen user={user} onToast={onToast} questions={questions} />
      )}
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
  const [displayLang, setDisplayLangState] = useState(getDisplayLang)
  const wasVerified = useRef(false)

  const changeNavMode = useCallback((mode) => {
    setNavModeState(persistNavMode(mode))
  }, [])

  const changeFontScale = useCallback((scale) => {
    setFontScaleState(persistFontScale(scale))
  }, [])

  const changeDisplayLang = useCallback((lang) => {
    setDisplayLangState(persistDisplayLang(lang))
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
      if (meRes?.user) setUser((prev) => mergeUserKeepMedia(prev, meRes.user))

      if (tab === 'profile') {
        // Profile tab: just user refresh + feedback
        notify('Profile refreshed', 'ok')
        return
      }

      if (tab === 'submissions') {
        // Submissions tab: user + progress + sent list + queue
        const prog = await getMyProgress().catch(() => null)
        if (prog) setMyProgress(prog)
        window.dispatchEvent(new Event('esurvey-activity-refresh'))
        window.dispatchEvent(new Event('esurvey-queue-change'))
        notify('Submissions refreshed ✓', 'ok')
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
        surveys: data.surveys || [],
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
    void getSurveyForm()
      .then((data) => {
        setQuestionsMeta({
          title: data.title,
          count: (data.questions || []).length,
          questions: data.questions,
          surveys: data.surveys || [],
          updated_at: data.updated_at,
        })
      })
      .catch(() => {})

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
        surveys: form.surveys || [],
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
        if (!dead && res.user.verified !== user.verified) {
          setUser((prev) => mergeUserKeepMedia(prev, res.user))
        }
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
          label={tab === 'profile' ? '↓ Pull to refresh profile' : tab === 'submissions' ? '↓ Pull to refresh submissions' : '↓ Pull to refresh'}
          refreshingLabel={tab === 'profile' ? 'Refreshing profile…' : tab === 'submissions' ? 'Refreshing submissions…' : 'Refreshing…'}
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
              onViewRecords={() => {
                setTab('submissions')
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

          {tab === 'submissions' && (
            <SubmissionsScreen
              user={user}
              questions={questionsMeta?.questions}
              onToast={notify}
              onEdit={async (d) => {
                if (lockForVerify) {
                  alertVerifyPending()
                  setTab('profile')
                  return
                }
                try {
                  let pkg = await getPackage(d.id)
                  if (!pkg) pkg = d
                  if (pkg.phase && pkg.phase !== 'draft' && pkg.phase !== 'syncing') {
                    pkg = (await updatePackage(pkg.id, { phase: 'draft', lastError: null })) || pkg
                  }
                  setEditDraft(pkg)
                  setCollectKey((k) => k + 1)
                  setTab('collect')
                  notify('Opened for edit — photo and voice stay on the phone', 'ok')
                } catch (e) {
                  notify(e.message || 'Could not open this record', 'error')
                }
              }}
            />
          )}
          {tab === 'profile' && (
            <SurveyorProfileScreen
              user={user}
              onToast={notify}
              onUserUpdated={(next) =>
                setUser((prev) => mergeUserKeepMedia(prev, typeof next === 'function' ? next(prev) : next))
              }
              navMode={navMode}
              onNavModeChange={changeNavMode}
              fontScale={fontScale}
              onFontScaleChange={changeFontScale}
              displayLang={displayLang}
              onDisplayLangChange={changeDisplayLang}
              onLogout={handleLogout}
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
              {t.id === 'submissions' && draftsCount > 0 && (
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
