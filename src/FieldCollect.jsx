import { useCallback, useEffect, useRef, useState } from 'react'
import { getMyProgress, getQuestions } from './api'
import { savePackageLocal } from './localStore'
import { forceSyncNow, getQueueSnapshot } from './syncEngine'
/**
 * LOCKED collect flow — surveyor cannot skip:
 * (Pull-to-refresh is provided by SurveyorApp shell.)
 * 1) GPS lock (accuracy) + location details
 * 2) Photo lock
 * 3) Voice activation lock → then Q/A while recording
 * 4) Save only when all locks held
 */

const MAX_ACCURACY_M = 120 // meters — reject coarse GPS
const MIN_AUDIO_BYTES = 2500 // ~tiny silence rejection
const MIN_PHOTO_CHARS = 800 // base64 length floor

function isGeoValid(g) {
  if (!g) return false
  const lat = Number(g.lat)
  const lng = Number(g.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false
  if (lat === 0 && lng === 0) return false
  if (g.accuracy != null && Number(g.accuracy) > MAX_ACCURACY_M) return false
  return true
}

async function reverseGeocode(lat, lng) {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}` +
      `&zoom=14&addressdetails=1`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json()
    const a = data.address || {}
    return {
      display_name: data.display_name || '',
      district:
        a.state_district || a.county || a.city_district || a.city || a.town || '',
      mandal: a.suburb || a.village || a.town || a.municipality || '',
      state: a.state || '',
      country: a.country || '',
      postcode: a.postcode || '',
      road: a.road || a.neighbourhood || '',
      raw: a,
    }
  } catch {
    return null
  }
}

export default function FieldCollectScreen({ user, onToast, onDone }) {
  const [step, setStep] = useState(0) // 0 geo, 1 photo, 2 voice+qa, 3 done
  const [formMeta, setFormMeta] = useState(null)
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [geo, setGeo] = useState(null)
  const [locationDetails, setLocationDetails] = useState(null)
  const [geoLoading, setGeoLoading] = useState(false)
  const [photoDataUrl, setPhotoDataUrl] = useState('')
  const [audioBlob, setAudioBlob] = useState(null)
  const [audioUrl, setAudioUrl] = useState('')
  const [recording, setRecording] = useState(false)
  const [voiceActivated, setVoiceActivated] = useState(false)
  const [listening, setListening] = useState(false)
  const [activeQ, setActiveQ] = useState(0)
  const [saving, setSaving] = useState(false)
  const [loadErr, setLoadErr] = useState('')
  const [progress, setProgress] = useState(null)
  const [queueInfo, setQueueInfo] = useState(null)
  const [localDoneCount, setLocalDoneCount] = useState(0)

  const mediaRec = useRef(null)
  const chunks = useRef([])
  const recognitionRef = useRef(null)
  const fileRef = useRef(null)
  const watchId = useRef(null)
  const streamRef = useRef(null)
  const audioStartedAt = useRef(null)

  const geoLocked = isGeoValid(geo)
  const locationLocked = geoLocked && !!locationDetails
  const photoLocked = !!(photoDataUrl && photoDataUrl.length >= MIN_PHOTO_CHARS)
  const voiceLocked = voiceActivated && (!!audioBlob || recording)
  const locks = {
    geo: geoLocked,
    location: locationLocked,
    photo: photoLocked,
    voice: voiceLocked,
  }
  const allHardLocks = geoLocked && photoLocked && voiceLocked && locationLocked

  const refreshProgress = useCallback(async () => {
    try {
      const p = await getMyProgress()
      setProgress(p)
      return p
    } catch {
      return null
    }
  }, [])

  const refreshQueue = useCallback(async () => {
    try {
      const q = await getQueueSnapshot()
      setQueueInfo(q)
      return q
    } catch {
      return null
    }
  }, [])

  const loadQuestions = useCallback(
    async (opts = {}) => {
      const silent = !!opts.silent
      try {
        setLoadErr('')
        const data = await getQuestions()
        setFormMeta(data)
        setQuestions(data.questions || [])
        if (opts.resetAnswers !== false) {
          const init = {}
          for (const q of data.questions || []) init[q.id] = ''
          setAnswers(init)
          setActiveQ(0)
        }
        await refreshProgress()
        await refreshQueue()
        if (!silent) {
          onToast?.(`Questions loaded · ${(data.questions || []).length} item(s)`, 'ok')
        }
        return data
      } catch (e) {
        setLoadErr(e.message)
        onToast?.(e.message, 'error')
        throw e
      }
    },
    [onToast, refreshProgress, refreshQueue],
  )

  useEffect(() => {
    loadQuestions({ silent: true }).catch(() => {})
    return () => {
      if (watchId.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId.current)
      }
      try {
        streamRef.current?.getTracks?.().forEach((t) => t.stop())
      } catch {
        /* ignore */
      }
    }
  }, [loadQuestions])

  function clearAudioUrl() {
    if (audioUrl) {
      try {
        URL.revokeObjectURL(audioUrl)
      } catch {
        /* ignore */
      }
    }
  }

  function resetForNextRecord() {
    setStep(0)
    setGeo(null)
    setLocationDetails(null)
    setPhotoDataUrl('')
    setAudioBlob(null)
    clearAudioUrl()
    setAudioUrl('')
    setRecording(false)
    setVoiceActivated(false)
    setListening(false)
    setActiveQ(0)
    audioStartedAt.current = null
    try {
      streamRef.current?.getTracks?.().forEach((t) => t.stop())
    } catch {
      /* ignore */
    }
    streamRef.current = null
    mediaRec.current = null
    const init = {}
    for (const q of questions) init[q.id] = ''
    setAnswers(init)
  }

  async function applyGeoLock(pos) {
    const next = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      altitude: pos.coords.altitude,
      heading: pos.coords.heading,
      speed: pos.coords.speed,
      at: new Date().toISOString(),
      locked: true,
      source: 'device_gps',
    }
    if (!isGeoValid(next)) {
      onToast?.(
        `GPS too weak (±${Math.round(next.accuracy || 999)}m). Need ≤${MAX_ACCURACY_M}m — go outdoors.`,
        'error',
      )
      return false
    }
    setGeo(next)
    // Location details (geography) — reverse geocode when online
    const details = await reverseGeocode(next.lat, next.lng)
    if (details) {
      setLocationDetails({
        ...details,
        locked: true,
        locked_at: next.at,
        lat: next.lat,
        lng: next.lng,
      })
      // Pre-fill district-like questions if empty
      setAnswers((prev) => {
        const a = { ...prev }
        if (details.district && !String(a.district || '').trim()) a.district = details.district
        if (details.mandal && !String(a.mandal || '').trim()) a.mandal = details.mandal
        return a
      })
    } else {
      setLocationDetails({
        display_name: `${next.lat.toFixed(5)}, ${next.lng.toFixed(5)}`,
        district: '',
        mandal: '',
        locked: true,
        locked_at: next.at,
        lat: next.lat,
        lng: next.lng,
        offline: true,
      })
    }
    onToast?.('Location locked', 'ok')
    return true
  }

  async function activateGeo() {
    if (!navigator.geolocation) {
      onToast?.('Geolocation not supported — use a phone with GPS', 'error')
      return
    }
    setGeoLoading(true)
    onToast?.('Locking GPS… keep outdoors, wait for accuracy', 'ok')

    // Clear previous watch
    if (watchId.current != null) {
      navigator.geolocation.clearWatch(watchId.current)
      watchId.current = null
    }

    // Prefer live watch until accuracy is good
    watchId.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const acc = pos.coords.accuracy
        if (acc != null && acc > MAX_ACCURACY_M) {
          // still waiting for better fix
          return
        }
        const ok = await applyGeoLock(pos)
        if (ok) {
          if (watchId.current != null) {
            navigator.geolocation.clearWatch(watchId.current)
            watchId.current = null
          }
          setGeoLoading(false)
          setStep(1)
        }
      },
      (err) => {
        setGeoLoading(false)
        onToast?.(
          err.code === 1
            ? 'Location denied — enable GPS & permission for this app'
            : err.message || 'Location failed',
          'error',
        )
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    )

    // Also one-shot fallback after short wait
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (isGeoValid({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        })) {
          const ok = await applyGeoLock(pos)
          if (ok) {
            if (watchId.current != null) {
              navigator.geolocation.clearWatch(watchId.current)
              watchId.current = null
            }
            setGeoLoading(false)
            setStep(1)
          } else {
            setGeoLoading(false)
          }
        }
      },
      () => {
        /* watch handles errors */
      },
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 },
    )
  }

  function onPickPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      onToast?.('Photo must be an image', 'error')
      return
    }
    if (file.size < 2000) {
      onToast?.('Photo too small — retake', 'error')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const maxW = 960
        const scale = Math.min(1, maxW / img.width)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.72)
        if (dataUrl.length < MIN_PHOTO_CHARS) {
          onToast?.('Photo invalid — retake', 'error')
          return
        }
        setPhotoDataUrl(dataUrl)
        onToast?.('Photo locked', 'ok')
      }
      img.onerror = () => onToast?.('Could not read photo', 'error')
      img.src = reader.result
    }
    reader.readAsDataURL(file)
    // allow re-pick same file later
    e.target.value = ''
  }

  async function startAudio() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      streamRef.current = stream
      chunks.current = []
      const rec = new MediaRecorder(stream)
      mediaRec.current = rec
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunks.current.push(ev.data)
      }
      rec.onstop = () => {
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
        setAudioBlob(blob)
        setAudioUrl(URL.createObjectURL(blob))
        try {
          stream.getTracks().forEach((t) => t.stop())
        } catch {
          /* ignore */
        }
      }
      rec.start(1000)
      audioStartedAt.current = Date.now()
      setRecording(true)
      setVoiceActivated(true)
      onToast?.('Voice activated · recording locked on', 'ok')
    } catch (e) {
      setVoiceActivated(false)
      onToast?.(e.message || 'Microphone permission required — voice is locked mandatory', 'error')
    }
  }

  function stopAudio() {
    if (mediaRec.current && recording) {
      mediaRec.current.stop()
      setRecording(false)
    }
  }

  /** Speech recognition fills current question (requires voice activated) */
  function startSpeechFill() {
    if (!voiceActivated) {
      onToast?.('Activate voice first', 'error')
      return
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      onToast?.('Speech recognition not available — type answers', 'error')
      return
    }
    const q = questions[activeQ]
    if (!q) return
    if (window.speechSynthesis && q.speak) {
      const u = new SpeechSynthesisUtterance(q.speak)
      u.lang = 'en-IN'
      window.speechSynthesis.speak(u)
    }
    const rec = new SR()
    recognitionRef.current = rec
    rec.lang = 'en-IN'
    rec.interimResults = true
    rec.continuous = false
    rec.onresult = (ev) => {
      let text = ''
      for (let i = 0; i < ev.results.length; i++) {
        text += ev.results[i][0].transcript
      }
      text = text.trim()
      if (!text) return
      if (q.type === 'choice' && q.options?.length) {
        const low = text.toLowerCase()
        const hit = q.options.find((o) => low.includes(String(o).toLowerCase()))
        setAnswers((a) => ({ ...a, [q.id]: hit || text }))
      } else {
        setAnswers((a) => ({ ...a, [q.id]: text }))
      }
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    rec.start()
    setListening(true)
  }

  function stopSpeechFill() {
    try {
      recognitionRef.current?.stop()
    } catch {
      /* ignore */
    }
    setListening(false)
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result || ''))
      r.onerror = reject
      r.readAsDataURL(blob)
    })
  }

  function assertLocksForSave() {
    if (!isGeoValid(geo)) {
      onToast?.('GPS lock required', 'error')
      setStep(0)
      return false
    }
    if (!locationDetails && !geo) {
      onToast?.('Location details required', 'error')
      setStep(0)
      return false
    }
    if (!photoDataUrl || photoDataUrl.length < MIN_PHOTO_CHARS) {
      onToast?.('Photo lock required', 'error')
      setStep(1)
      return false
    }
    if (!voiceActivated) {
      onToast?.('Voice activation required', 'error')
      setStep(2)
      return false
    }
    return true
  }

  async function finishUpload() {
    for (const q of questions) {
      if (q.required && !String(answers[q.id] || '').trim()) {
        onToast?.(`Required: ${q.label}`, 'error')
        setStep(2)
        setActiveQ(questions.indexOf(q))
        return
      }
    }
    if (!assertLocksForSave()) return

    // Flush recorder if still live — wait for onstop to fill chunks
    if (recording && mediaRec.current) {
      await new Promise((resolve) => {
        const rec = mediaRec.current
        const prev = rec.onstop
        rec.onstop = (ev) => {
          try {
            prev?.call(rec, ev)
          } catch {
            /* ignore */
          }
          const b = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
          setAudioBlob(b)
          setAudioUrl(URL.createObjectURL(b))
          try {
            streamRef.current?.getTracks?.().forEach((t) => t.stop())
          } catch {
            /* ignore */
          }
          setRecording(false)
          resolve(b)
        }
        try {
          rec.stop()
        } catch {
          resolve(null)
        }
      })
      await new Promise((r) => setTimeout(r, 200))
    }

    let blob = audioBlob
    if ((!blob || blob.size < MIN_AUDIO_BYTES) && chunks.current.length) {
      blob = new Blob(chunks.current, { type: 'audio/webm' })
      setAudioBlob(blob)
    }

    if (!blob || blob.size < MIN_AUDIO_BYTES) {
      onToast?.(
        'Voice recording too short or missing — re-activate voice and record interview',
        'error',
      )
      setStep(2)
      return
    }

    const durationMs = audioStartedAt.current
      ? Date.now() - audioStartedAt.current
      : 0
    if (durationMs > 0 && durationMs < 2500) {
      onToast?.('Record at least a few seconds of voice before save', 'error')
      return
    }

    setSaving(true)
    try {
      const audioDataUrl = await blobToBase64(blob)
      const audioMime = blob.type || 'audio/webm'

      // Locked location + geo stamped into answers (immutable client fields)
      const lockedAnswers = {
        ...answers,
        _geo_locked: true,
        _photo_locked: true,
        _voice_locked: true,
        _location_locked: true,
        geo_lat: geo.lat,
        geo_lng: geo.lng,
        geo_accuracy: geo.accuracy,
        geo_at: geo.at,
        location_display: locationDetails?.display_name || '',
        location_district: locationDetails?.district || answers.district || '',
        location_mandal: locationDetails?.mandal || answers.mandal || '',
        location_state: locationDetails?.state || '',
      }

      const localSeq = localDoneCount + 1
      const packageId = await savePackageLocal({
        form_key: formMeta?.form_key || 'default',
        form_id: `field-${user?.username || 's'}-${Date.now()}`,
        source: 'mobile-field-survey',
        submitted_by: user?.name || user?.username,
        user_id: user?.id,
        geo: { ...geo, locked: true },
        location_details: locationDetails,
        answers: lockedAnswers,
        photoDataUrl,
        audioDataUrl,
        audioMime,
        recordIndex: localSeq,
        locks: {
          geo: true,
          photo: true,
          voice: true,
          location: true,
        },
      })

      setLocalDoneCount(localSeq)
      const qstats = await refreshQueue()
      onToast?.(
        `Saved · locks OK · queue #${localSeq} · pending ${qstats?.pending ?? '—'}`,
        'ok',
      )

      void forceSyncNow()

      const p = await refreshProgress()
      const target = p?.target ?? 0
      const effectiveDone = Math.max(p?.done || 0, localSeq)
      const complete = target > 0 && effectiveDone >= target

      onDone?.(packageId, {
        ...p,
        done: effectiveDone,
        local_queued: true,
        package_id: packageId,
      })

      if (complete) {
        setStep(3)
        onToast?.(`Target reached (${effectiveDone}/${target}) · queue will sync`, 'ok')
      } else {
        resetForNextRecord()
        const next = effectiveDone + 1
        onToast?.(
          `Auto next · local record ${next}${target ? ` / ${target}` : ''}`,
          'ok',
        )
      }
    } catch (e) {
      onToast?.(e.message || 'Local save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const q = questions[activeQ]

  if (loadErr) {
    return (
      <div className="screen">
        <header className="screen-head">
          <h2>Collect</h2>
          <p className="muted">{loadErr}</p>
        </header>
        <button
          type="button"
          className="btn primary"
          onClick={() => loadQuestions({ silent: false })}
        >
          Retry load questions
        </button>
      </div>
    )
  }

  const progLabel =
    progress?.label || (progress ? `${progress.done}/${progress.target || '—'}` : '…')

  // Shell pull-to-refresh remounts this screen (collectKey) → useEffect reloads questions
  return (
      <div className="screen field-collect">
        <p className="ptr-hint">↓ Pull down to refresh questions from admin</p>
        <header className="screen-head">
          <h2>{formMeta?.title || 'Field survey'}</h2>
          <p>
            {user?.name || user?.username} · step {step + 1}/4 · {questions.length} Qs
          </p>
        </header>

        {/* Lock status — mandatory */}
        <div className="card lock-bar" style={{ marginBottom: 10, padding: '10px 12px' }}>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700 }}>
            LOCKED REQUIREMENTS (cannot skip)
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span className={`pill ${locks.geo ? 'ok' : 'bad'}`}>
              <span className="dot" />
              GPS {locks.geo ? 'LOCKED' : 'OPEN'}
            </span>
            <span className={`pill ${locationLocked ? 'ok' : 'bad'}`}>
              <span className="dot" />
              Location {locationLocked ? 'LOCKED' : 'OPEN'}
            </span>
            <span className={`pill ${locks.photo ? 'ok' : 'bad'}`}>
              <span className="dot" />
              Photo {locks.photo ? 'LOCKED' : 'OPEN'}
            </span>
            <span className={`pill ${locks.voice ? 'ok' : 'bad'}`}>
              <span className="dot" />
              Voice {locks.voice ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>

        {/* Live quota + device queue */}
        <div className="card" style={{ marginBottom: 10, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>
              Record{' '}
              {progress?.target > 0
                ? `${Math.min(localDoneCount + 1, progress.target)} / ${progress.target}`
                : `#${localDoneCount + 1}`}
            </strong>
            <span
              className={`pill ${
                progress?.status === 'completed'
                  ? 'ok'
                  : progress?.status === 'in_progress'
                    ? 'warn'
                    : 'bad'
              }`}
            >
              <span className="dot" />
              {progress?.status || '…'}
            </span>
          </div>
          <p className="muted" style={{ margin: '6px 0 4px', fontSize: 12 }}>
            {progLabel}
            {progress?.remaining != null && progress.remaining > 0
              ? ` · ${progress.remaining} left`
              : ''}
          </p>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
            Device queue: <strong>{queueInfo?.pending ?? 0}</strong> waiting ·{' '}
            <strong>{queueInfo?.failed ?? 0}</strong> failed · sync: QA → photo → audio
          </p>
          {progress?.target > 0 && (
            <div
              style={{
                height: 10,
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 99,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.min(
                    100,
                    Math.round(
                      ((localDoneCount || progress.done || 0) / progress.target) * 100,
                    ),
                  )}%`,
                  height: '100%',
                  background: progress.complete ? '#22c55e' : '#38bdf8',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          )}
          <button
            type="button"
            className="btn small"
            style={{ marginTop: 8 }}
            onClick={() => {
              void forceSyncNow().then(() => {
                refreshQueue()
                refreshProgress()
                onToast?.('Queue sync started', 'ok')
              })
            }}
          >
            Sync queue now
          </button>
        </div>

        <div className="stepper">
          {['GPS', 'Photo', 'Voice+Q/A', 'Done'].map((label, i) => (
            <div
              key={label}
              className={`step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
              title={label}
            >
              {i + 1}
            </div>
          ))}
        </div>

        {/* STEP 0 — GPS + location details LOCK */}
        {step === 0 && (
          <div className="card">
            <h3>1 · Lock GPS + location</h3>
            <p className="muted">
              Geography is mandatory. Accuracy must be ≤{MAX_ACCURACY_M}m. You cannot skip this
              step.
            </p>
            {geo && locks.geo ? (
              <div className="lock-detail">
                <p className="pill ok" style={{ display: 'inline-flex', marginBottom: 8 }}>
                  <span className="dot" />
                  GPS LOCKED
                </p>
                <p>
                  <strong>
                    {geo.lat.toFixed(6)}, {geo.lng.toFixed(6)}
                  </strong>
                  <br />
                  <span className="muted">
                    ±{Math.round(geo.accuracy)}m · {geo.at?.slice(0, 19).replace('T', ' ')}
                  </span>
                </p>
                {locationDetails && (
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <strong>Location details</strong>
                    <p style={{ margin: '4px 0' }}>
                      {locationDetails.display_name || 'Coords only (offline)'}
                    </p>
                    {(locationDetails.district || locationDetails.mandal) && (
                      <p className="muted" style={{ margin: 0 }}>
                        {locationDetails.district}
                        {locationDetails.mandal ? ` · ${locationDetails.mandal}` : ''}
                        {locationDetails.state ? ` · ${locationDetails.state}` : ''}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="muted">GPS not locked yet</p>
            )}
            <button
              type="button"
              className="btn primary"
              onClick={activateGeo}
              disabled={geoLoading}
            >
              {geoLoading ? 'Locking GPS…' : locks.geo ? 'Re-lock GPS' : 'Enable & lock GPS'}
            </button>
            <button
              type="button"
              className="btn secondary"
              style={{ marginTop: 8 }}
              disabled={!locks.geo || !locationLocked}
              onClick={() => {
                if (!locks.geo) {
                  onToast?.('Lock GPS first', 'error')
                  return
                }
                setStep(1)
              }}
            >
              Continue to photo →
            </button>
            {!locks.geo && (
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Tip: stand outdoors, wait until accuracy is good enough.
              </p>
            )}
          </div>
        )}

        {/* STEP 1 — PHOTO LOCK */}
        {step === 1 && (
          <div className="card">
            <h3>2 · Lock photo</h3>
            <p className="muted">
              Camera capture required (respondent / booth). Cannot open questions without photo.
            </p>
            {!locks.geo && (
              <p className="pill bad" style={{ marginBottom: 8 }}>
                <span className="dot" />
                GPS not locked — go back
              </p>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={onPickPhoto}
            />
            <button
              type="button"
              className="btn primary"
              disabled={!locks.geo}
              onClick={() => {
                if (!locks.geo) {
                  onToast?.('Lock GPS first', 'error')
                  setStep(0)
                  return
                }
                fileRef.current?.click()
              }}
            >
              {locks.photo ? 'Retake photo' : 'Take photo (camera)'}
            </button>
            {photoDataUrl && (
              <img
                src={photoDataUrl}
                alt="capture locked"
                style={{
                  width: '100%',
                  borderRadius: 12,
                  marginTop: 12,
                  border: locks.photo ? '2px solid #22c55e' : 'none',
                }}
              />
            )}
            {locks.photo && (
              <p className="pill ok" style={{ marginTop: 8, display: 'inline-flex' }}>
                <span className="dot" />
                PHOTO LOCKED
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="btn secondary" onClick={() => setStep(0)}>
                Back
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!locks.photo || !locks.geo}
                onClick={async () => {
                  if (!locks.geo) {
                    onToast?.('GPS lock required', 'error')
                    setStep(0)
                    return
                  }
                  if (!locks.photo) {
                    onToast?.('Photo lock required', 'error')
                    return
                  }
                  setStep(2)
                  if (!recording && !voiceActivated) {
                    await startAudio()
                  }
                }}
              >
                Continue · activate voice →
              </button>
            </div>
          </div>
        )}

        {/* STEP 2 — VOICE LOCK + Q/A */}
        {step === 2 && (
          <div>
            <div className="card" style={{ marginBottom: 10 }}>
              <h3>3 · Voice activation (mandatory)</h3>
              <p className="muted" style={{ fontSize: 12 }}>
                Microphone must be on. Interview audio is locked before answers can be saved.
              </p>
              {!locks.geo || !locks.photo ? (
                <p className="pill bad">
                  <span className="dot" />
                  Complete GPS + photo locks first
                </p>
              ) : null}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {!recording ? (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!locks.geo || !locks.photo}
                    onClick={startAudio}
                  >
                    {audioBlob ? 'Re-activate voice' : 'Activate voice · start recording'}
                  </button>
                ) : (
                  <button type="button" className="btn danger" onClick={stopAudio}>
                    Stop recording (keep lock)
                  </button>
                )}
                {recording && (
                  <span className="pill warn">
                    <span className="dot" />● LIVE
                  </span>
                )}
                {voiceActivated && (
                  <span className="pill ok">
                    <span className="dot" />
                    VOICE ACTIVATED
                  </span>
                )}
              </div>
              {audioUrl && (
                <audio controls src={audioUrl} style={{ width: '100%', marginTop: 10 }} />
              )}
            </div>

            {!voiceActivated ? (
              <div className="card">
                <p className="muted">
                  Questions stay locked until voice is activated. Tap{' '}
                  <strong>Activate voice</strong> above.
                </p>
                <button type="button" className="btn secondary" onClick={() => setStep(1)}>
                  Back to photo
                </button>
              </div>
            ) : (
              <>
                {q && (
                  <div className="card">
                    <p className="muted">
                      Question {activeQ + 1} / {questions.length}
                    </p>
                    <h3>{q.label}</h3>
                    {q.speak && (
                      <p className="muted" style={{ fontSize: 12 }}>
                        Voice: “{q.speak}”
                      </p>
                    )}

                    {q.type === 'choice' ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {(q.options || []).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            className={`chip ${answers[q.id] === opt ? 'selected' : ''}`}
                            onClick={() => setAnswers((a) => ({ ...a, [q.id]: opt }))}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <label className="field">
                        <span>Answer</span>
                        <input
                          value={answers[q.id] || ''}
                          onChange={(e) =>
                            setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                          }
                        />
                      </label>
                    )}

                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      {!listening ? (
                        <button type="button" className="btn secondary" onClick={startSpeechFill}>
                          🎤 Speak fill
                        </button>
                      ) : (
                        <button type="button" className="btn danger" onClick={stopSpeechFill}>
                          Stop speech
                        </button>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={activeQ === 0}
                        onClick={() => setActiveQ((i) => Math.max(0, i - 1))}
                      >
                        Prev
                      </button>
                      {activeQ < questions.length - 1 ? (
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => setActiveQ((i) => i + 1)}
                        >
                          Next
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn primary"
                          disabled={saving || !allHardLocks}
                          onClick={finishUpload}
                        >
                          {saving
                            ? 'Saving on device…'
                            : allHardLocks
                              ? 'Save (all locks OK)'
                              : 'Locks incomplete'}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {!questions.length && (
                  <div className="card">
                    <p className="muted">
                      No questions from dashboard. Admin must save questions first.
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  className="btn secondary"
                  style={{ marginTop: 10 }}
                  onClick={() => setStep(1)}
                >
                  Back to photo
                </button>
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="card">
            <h3>{progress?.complete ? 'Target complete ✓' : 'Batch paused'}</h3>
            <p>
              {progress?.complete
                ? `You finished ${progress.done} / ${progress.target} records assigned by admin.`
                : `Saved ${progress?.done ?? '—'} records.`}
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              Each record was saved with GPS + location + photo + voice locks.
            </p>
            {!progress?.complete && (
              <button type="button" className="btn primary" onClick={resetForNextRecord}>
                Continue next record
              </button>
            )}
            <button
              type="button"
              className="btn secondary"
              style={{ marginTop: 8 }}
              onClick={() => refreshProgress()}
            >
              Refresh status
            </button>
          </div>
        )}
      </div>
  )
}
