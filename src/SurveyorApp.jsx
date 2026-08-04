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
        <h1>
          Hi, {user?.name || user?.username}
          {user?.verified && (
            <span className="pill ok" style={{ background: '#059669', color: '#fff', fontSize: 12, marginLeft: 8, verticalAlign: 'middle', fontWeight: 'bold' }}>
              Verified ✓
            </span>
          )}
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
          {user?.verified && (
            <div className="pill ok" style={{ background: '#059669', color: '#fff', fontWeight: 'bold' }}>
              <span className="dot" />
              Verified ✓
            </div>
          )}
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
            background: 'rgba(255,255,255,0.08)',
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
function SurveyorProfileScreen({ user, onToast, onUserUpdated }) {
  const [phone, setPhone] = useState(user?.phone || '')
  const [savingPhone, setSavingPhone] = useState(false)
  const [uploading, setUploading] = useState({ photo: false, front: false, back: false })

  useEffect(() => {
    setPhone(user?.phone || '')
  }, [user?.phone])

  const handleMediaUpload = (field, file) => {
    if (!file) return
    if (file.size > 4 * 1024 * 1024) {
      onToast?.('Image too large. Max 3MB.', 'error')
      return
    }
    const fieldKey = field === 'front' ? 'aadhaar_front' : field === 'back' ? 'aadhaar_back' : 'photo'
    setUploading((u) => ({ ...u, [field]: true }))
    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target?.result
      if (typeof dataUrl === 'string') {
        try {
          await uploadProfileMedia(fieldKey, dataUrl)
          onUserUpdated?.((prev) => ({ ...prev, [fieldKey]: dataUrl }))
          onToast?.(`${fieldKey.replace('_', ' ')} updated ✓`, 'ok')
        } catch (err) {
          onToast?.(err.message || 'Upload failed', 'error')
        } finally {
          setUploading((u) => ({ ...u, [field]: false }))
        }
      }
    }
    reader.readAsDataURL(file)
  }

  const handleSavePhone = async () => {
    setSavingPhone(true)
    try {
      await updateUser(user.id, { phone: phone.trim() })
      onUserUpdated?.((prev) => ({ ...prev, phone: phone.trim() }))
      onToast?.('Phone number updated ✓', 'ok')
    } catch (err) {
      onToast?.(err.message || 'Failed to update phone', 'error')
    } finally {
      setSavingPhone(false)
    }
  }

  return (
    <div className="screen profile-screen" style={{ padding: '12px 14px' }}>
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
                background: '#243041',
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
              background: '#00e599',
              color: '#111',
              borderRadius: '50%',
              width: 30,
              height: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontWeight: 'bold',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}
            title="Upload photo"
          >
            📷
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => handleMediaUpload('photo', e.target.files?.[0])}
            />
          </label>
        </div>
        <h2 style={{ margin: '4px 0 2px', fontSize: 20 }}>
          {user?.name || user?.display_name || user?.username}
          {user?.verified && (
            <span className="pill ok" style={{ background: '#059669', color: '#fff', fontSize: 12, marginLeft: 8, verticalAlign: 'middle', fontWeight: 'bold' }}>
              Verified ✓
            </span>
          )}
        </h2>
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>@{user?.username}</p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ background: 'rgba(0,229,153,0.12)', border: '1px solid rgba(0,229,153,0.3)', borderRadius: 20, padding: '4px 14px' }}>
            <span style={{ fontSize: 12, color: '#00e599', fontWeight: 'bold' }}>
              Key ID: {user?.key_id || 'GROUND-KEY'}
            </span>
          </div>
          {user?.verified ? (
            <div style={{ background: 'rgba(16,185,129,0.2)', border: '1px solid #10b981', borderRadius: 20, padding: '4px 14px' }}>
              <span style={{ fontSize: 12, color: '#10b981', fontWeight: 'bold' }}>
                Identity Verified ✓
              </span>
            </div>
          ) : (
            <div style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid #f59e0b', borderRadius: 20, padding: '4px 14px' }}>
              <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 'bold' }}>
                Verification Pending ⏳
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3>📞 Surveyor Mobile Number</h3>
        <p className="muted" style={{ fontSize: 12, margin: '2px 0 10px' }}>
          Registered phone number for contact & admin verification.
        </p>
        <div className="field" style={{ margin: 0 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              type="tel"
              placeholder="+91 9876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={{
                flex: 1,
                fontSize: 18,
                fontWeight: 'bold',
                letterSpacing: '0.04em',
                padding: '12px 16px',
                minHeight: 52,
                borderRadius: 12,
                border: '1px solid #00e599',
                background: '#1a2332',
                color: '#ffffff',
              }}
            />
            <button
              type="button"
              className="btn primary"
              style={{ padding: '12px 24px', fontSize: 15, fontWeight: 'bold', minHeight: 52, minWidth: 90 }}
              disabled={savingPhone || phone === (user?.phone || '')}
              onClick={handleSavePhone}
            >
              {savingPhone ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3>Aadhaar Identity Verification</h3>
        <p className="muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
          Upload front & back images of your Aadhaar card for field surveyor verification.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {/* Front */}
          <div style={{ border: '1px dashed #334155', borderRadius: 8, padding: 10, textAlign: 'center', background: 'rgba(0,0,0,0.15)' }}>
            <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 'bold' }}>Aadhaar Front</p>
            {user?.aadhaar_front ? (
              <img
                src={user.aadhaar_front}
                alt="Aadhaar Front"
                style={{ width: '100%', height: 95, objectFit: 'cover', borderRadius: 6, marginBottom: 8 }}
              />
            ) : (
              <div style={{ height: 95, background: 'rgba(255,255,255,0.03)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, marginBottom: 8 }}>
                🪪
              </div>
            )}
            <label className="btn small primary" style={{ display: 'block', width: '100%', boxSizing: 'border-box', cursor: 'pointer', textAlign: 'center' }}>
              {uploading.front ? 'Uploading…' : user?.aadhaar_front ? 'Change Front' : 'Upload Front'}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => handleMediaUpload('front', e.target.files?.[0])}
              />
            </label>
          </div>

          {/* Back */}
          <div style={{ border: '1px dashed #334155', borderRadius: 8, padding: 10, textAlign: 'center', background: 'rgba(0,0,0,0.15)' }}>
            <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 'bold' }}>Aadhaar Back</p>
            {user?.aadhaar_back ? (
              <img
                src={user.aadhaar_back}
                alt="Aadhaar Back"
                style={{ width: '100%', height: 95, objectFit: 'cover', borderRadius: 6, marginBottom: 8 }}
              />
            ) : (
              <div style={{ height: 95, background: 'rgba(255,255,255,0.03)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, marginBottom: 8 }}>
                🪪
              </div>
            )}
            <label className="btn small primary" style={{ display: 'block', width: '100%', boxSizing: 'border-box', cursor: 'pointer', textAlign: 'center' }}>
              {uploading.back ? 'Uploading…' : user?.aadhaar_back ? 'Change Back' : 'Upload Back'}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => handleMediaUpload('back', e.target.files?.[0])}
              />
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
      <p className="ptr-hint">Done records stay on this phone until they reach the server</p>
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
            Nothing pending — collected records are synced automatically. Use “Save draft only”
            while collecting to keep records on this phone.
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

  /** App-wide pull-to-refresh: questions + progress + queue */
  const pullRefreshAll = useCallback(async () => {
    try {
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
      // Remount Collect so form reloads latest questions from admin
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
  }, [notify])

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
    const stopNet = watchNetwork(setNetwork, { intervalMs: 20_000 })
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
          label="↓ Pull to refresh"
          refreshingLabel="Refreshing questions…"
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
