import { useCallback, useEffect, useState } from 'react'
import {
  getMyProgress,
  getMySubmissions,
  getStats,
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
import { deleteDraft, draftCount, listDrafts, listPendingPackages, pushDraft } from './localStore'
import { clearSession, getSurveyForm } from './api'
import { APP_VERSION, versionLabel } from './version'
import VerifiedBadge from './VerifiedBadge'
import './App.css'

/** Surveyor-only field app (mobile / APK) */
const TABS = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'collect', label: 'Collect', icon: '✎' },
  { id: 'drafts', label: 'Pending', icon: '📦' },
  { id: 'records', label: 'Records', icon: '☰' },
  { id: 'profile', label: 'Profile', icon: '👤' },
]

/** On version change, clear old session so login screen + new build show cleanly */
function ensureUiVersion() {
  try {
    const key = 'esurvey_ui_version'
    const prev = localStorage.getItem(key)
    if (prev !== APP_VERSION) {
      clearSession()
      localStorage.setItem(key, APP_VERSION)
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

function HomeScreen({
  user,
  network,
  pendingSync,
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
          {pendingSync > 0 && (
            <div className="pill warn">
              <span className="dot" />
              {pendingSync} queued on phone
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
          <strong>{pendingSync ?? 0}</strong>
          <span>Queued</span>
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
          ? 'Target complete ✓'
          : done > 0
            ? `Continue record #${myProgress?.next_record || done + 1}`
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

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const d = await getMySubmissions()
      setRecords(d.items || [])
    } catch (e) {
      onToast?.(e.message || 'Failed to load your records', 'error')
    } finally {
      setRefreshing(false)
    }
  }, [onToast])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="screen records-screen">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <h2 style={{ margin: 0 }}>My Submitted Records</h2>
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
        Submissions stored on server for @{user?.username}. Tap a record to open photo/audio.
      </p>

      {records === null ? (
        <p className="muted">Loading records…</p>
      ) : records.length === 0 ? (
        <p className="muted">No records submitted yet.</p>
      ) : (
        records.map((r) => {
          const open = openId === r.id
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
                  Record #{r.id}
                  <span className={`pill ${r.status === 'confirmed' ? 'ok' : ''}`} style={{ marginLeft: 8 }}>
                    {r.status}
                  </span>
                </span>
                <span className="muted" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                  {String(r.created_at || '').slice(0, 16).replace('T', ' ')}
                  {r.submitted_by ? ` · ${r.submitted_by}` : ''}
                </span>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {open ? 'Hide photo/audio ▲' : 'Show photo/audio ▼'}
                </div>
              </button>
              {open && <SubmissionMedia item={r} compact style={{ marginTop: 8 }} />}
            </div>
          )
        })
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
    setSavingPhone(true)
    try {
      await updateUser(user.id, { phone: phone.trim() })
      onUserUpdated?.((prev) => ({ ...prev, phone: phone.trim() }))
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
              👤
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
            {user?.verified ? '🔒' : '📷'}
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
          <h3 style={{ margin: 0, fontSize: 15, color: '#f8fafc' }}>📞 Surveyor Mobile Number</h3>
          {user?.verified ? (
            <span aria-label="Locked" title="Locked" style={{ fontSize: 14 }}>
              🔒
            </span>
          ) : null}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
          {user?.verified ? 'Phone cannot be changed.' : 'Registered phone number for contact.'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            type="tel"
            placeholder="+91 9876543210"
            value={phone}
            disabled={user?.verified === true}
            onChange={(e) => setPhone(e.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              fontSize: 18,
              fontWeight: 'bold',
              letterSpacing: '0.04em',
              padding: '12px 16px',
              minHeight: 52,
              borderRadius: 12,
              border: user?.verified ? '1px solid #cbd5e1' : '2px solid #059669',
              background: user?.verified ? '#e2e8f0' : '#ffffff',
              color: user?.verified ? '#94a3b8' : '#0f172a',
              cursor: user?.verified ? 'not-allowed' : 'text',
            }}
          />
          {!user?.verified && (
            <button
              type="button"
              className="btn primary"
              style={{
                width: '100%',
                padding: '12px',
                fontSize: 15,
                fontWeight: 'bold',
                minHeight: 48,
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
          <h3 style={{ margin: 0 }}>🪪 Aadhaar Identity Verification</h3>
          {user?.verified ? (
            <span aria-label="Locked" title="Locked" style={{ fontSize: 14 }}>
              🔒
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
              <div style={{ height: 95, background: 'rgba(15,23,42,0.06)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, marginBottom: 8 }}>
                🪪
              </div>
            )}
            <label
              className="btn small"
              style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', cursor: user?.verified ? 'not-allowed' : 'pointer', background: user?.verified ? '#e2e8f0' : undefined, color: user?.verified ? '#94a3b8' : undefined, border: user?.verified ? '1px solid #cbd5e1' : undefined }}
            >
              {uploading.front ? 'Uploading…' : user?.verified ? '🔒' : user?.aadhaar_front ? 'Change Front' : 'Upload Front'}
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
              <div style={{ height: 95, background: 'rgba(15,23,42,0.06)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, marginBottom: 8 }}>
                🪪
              </div>
            )}
            <label
              className="btn small"
              style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', cursor: user?.verified ? 'not-allowed' : 'pointer', background: user?.verified ? '#e2e8f0' : undefined, color: user?.verified ? '#94a3b8' : undefined, border: user?.verified ? '1px solid #cbd5e1' : undefined }}
            >
              {uploading.back ? 'Uploading…' : user?.verified ? '🔒' : user?.aadhaar_back ? 'Change Back' : 'Upload Back'}
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
      onToast?.('Draft pushed to client admin — pending review', 'ok')
      void forceSyncNow()
      await load()
    } catch (e) {
      onToast?.(e.message || 'Push failed', 'error')
    } finally {
      setPushing(null)
    }
  }

  const remove = async (id) => {
    if (!confirm('Delete this record from the phone?')) return
    await deleteDraft(id).catch(() => {})
    await load()
  }

  const retry = async () => {
    await forceSyncNow().catch(() => {})
    await load()
  }

  const draftN = (items || []).filter((i) => i.kind === 'draft').length
  const queuedN = (items || []).filter((i) => i.kind === 'queued').length

  return (
    <div className="screen home-screen">
      <p className="ptr-hint">All records stay on this phone until you confirm & push them</p>
      <div className="hero-card">
        <p className="eyebrow">Phone pending</p>
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
            Nothing pending — records you collect stay on this phone as drafts. Review them here
            and tap “Push to admin” to send them to Client Admin.
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
        return (
          <div key={d.id} className="card" style={{ marginTop: 12, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
              <strong style={{ fontSize: 14 }}>
                {a.respondent_name || a.district || loc.display_name || 'Survey'}
                {d.recordIndex != null && (
                  <span className="muted" style={{ fontWeight: 600 }}>
                    {' '}
                    · Record #{d.recordIndex}
                  </span>
                )}
              </strong>
              <span className={`pill ${isFailed ? '' : isDraft ? '' : 'ok'}`} style={{ fontSize: 11 }}>
                {isFailed ? 'failed' : isDraft ? 'draft' : 'to sync'}
              </span>
            </div>
            <span className="muted" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
              {String(d.createdAt || '').slice(0, 16).replace('T', ' ')} · geo{' '}
              {qa.geo?.lat != null ? '✓' : '✗'} · photo {d.photoDataUrl ? '✓' : '✗'} · voice{' '}
              {d.audioDataUrl ? '✓' : '✗'}
            </span>

            {isDraft && (
              <span className="muted" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                Status: {typeof d.step === 'number' ? `step ${d.step + 1}/4` : 'draft'}
                {d.total != null
                  ? ` · ${d.answered ?? 0}/${d.total} questions answered`
                  : ''}
              </span>
            )}

            {isFailed && (
              <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                Sync failed{d.lastError ? `: ${d.lastError}` : ''} — tap “Sync now” to retry.
              </p>
            )}
            {!isDraft && !isFailed && (
              <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                {isSyncing ? 'Syncing to server…' : 'Waiting for network — auto-syncs when online.'}
              </p>
            )}

            {isDraft && (
              <div className="pill-row" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="cta secondary"
                  disabled={pushing === d.id}
                  onClick={() => onEdit(d)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="cta"
                  disabled={pushing === d.id}
                  onClick={() => push(d.id)}
                >
                  {pushing === d.id ? 'Pushing…' : 'Push to admin'}
                </button>
                <button
                  type="button"
                  className="cta secondary danger-cta"
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

  const refreshDraftCount = useCallback(async () => {
    try {
      setDraftsCount(await draftCount())
    } catch {
      /* ignore */
    }
  }, [])

  const notify = useCallback((message, type = 'ok') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3200)
  }, [])

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
        // Records tab: user + progress
        const prog = await getMyProgress().catch(() => null)
        if (prog) setMyProgress(prog)
        notify('Records refreshed ✓', 'ok')
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
      // Remount Collect so form reloads latest questions
      setCollectKey((k) => k + 1)
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
    const stopNet = watchNetwork(setNetwork, { intervalMs: 45_000 })
    startSyncEngine()
    setPendingSync(queueCount())
    void refreshQueueCountCache().then(setPendingSync)
    void getQueueSnapshot().then((s) => {
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
    try {
      setMyProgress(await getMyProgress())
    } catch {
      /* ignore */
    }
    try {
      const data = await getSurveyForm()
      setQuestionsMeta({
        title: data.title,
        count: (data.questions || []).length,
        questions: data.questions,
        updated_at: data.updated_at,
      })
    } catch {
      /* questions after redeploy */
    }
    try {
      await getStats()
    } catch {
      /* optional */
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

  // Account revalidation — a disabled/inactive user must never stay logged in or auto-login:
  // re-check every 5 min and whenever the app returns to foreground. 401/disabled → force
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
            e?.disabled ? 'Account disabled — logged out' : 'Session expired — sign in again',
            'error',
          )
        }
        // else: transient network error — keep session, retry next tick
      }
    }
    const iv = setInterval(check, 5 * 60 * 1000)
    const onVis = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      dead = true
      clearInterval(iv)
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
    if (!TABS.some((t) => t.id === tab)) setTab('home')
  }, [user, tab, notify])

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
            setTab('home')
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
          onRefresh={pullRefreshAll}
          label={tab === 'profile' ? '↓ Pull to refresh profile' : tab === 'records' ? '↓ Pull to refresh records' : '↓ Pull to refresh'}
          refreshingLabel={tab === 'profile' ? 'Refreshing profile…' : tab === 'records' ? 'Refreshing records…' : 'Refreshing…'}
        >
          {tab === 'home' && (
            <HomeScreen
              user={user}
              network={network}
              pendingSync={pendingSync}
              myProgress={myProgress}
              questionsMeta={questionsMeta}
              onNewSurvey={() => setTab('collect')}
              onSync={() => {
                forceSyncNow().then(() => notify('Syncing device queue…', 'ok'))
              }}
              onLogout={handleLogout}
            />
          )}
          {tab === 'collect' && (
            <FieldCollectScreen
              key={collectKey}
              user={user}
              draft={editDraft}
              onToast={notify}
              onDone={(_id, prog) => {
                setEditDraft(null)
                if (prog) setMyProgress(prog)
                else getMyProgress().then(setMyProgress).catch(() => {})
                void getQueueSnapshot().then((s) => setPendingSync(s.pending))
              }}
              onSavedDraft={() => {
                setEditDraft(null)
                setTab('drafts')
                refreshDraftCount()
              }}
            />
          )}
          {tab === 'drafts' && (
            <DraftsScreen
              user={user}
              onToast={notify}
              onEdit={(d) => {
                setEditDraft(d)
                setCollectKey((k) => k + 1)
                setTab('collect')
                notify('Draft loaded — review, then push', 'ok')
              }}
            />
          )}
          {tab === 'records' && <MyRecordsScreen user={user} onToast={notify} />}
          {tab === 'profile' && (
            <SurveyorProfileScreen
              user={user}
              onToast={notify}
              onUserUpdated={(updater) => setUser(updater)}
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
            onClick={() => setTab(t.id)}
          >
            <span className="nav-icon" aria-hidden>
              {t.icon}
            </span>
            <span>{t.label}</span>
            {t.id === 'drafts' && draftsCount > 0 && (
              <span
                style={{
                  background: '#e11d48',
                  color: '#fff',
                  borderRadius: 10,
                  fontSize: 10,
                  lineHeight: '16px',
                  padding: '0 6px',
                  marginLeft: 4,
                }}
              >
                {draftsCount}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  )
}
