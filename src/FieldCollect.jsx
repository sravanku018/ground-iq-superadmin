import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icons'
import { getMyProgress, getSurveyForm } from './api'
import {
  compressPhotoFromImage,
  pickAudioRecorderOptions,
  toSpeechWav16k,
  blobToDataUrl,
  AUDIO_SAMPLE_RATE,
} from './mediaOptimize'
import { slugQuestionKey } from './questionKey'

function mapAnswersToQuestions(answers, questions) {
  const src = answers || {}
  const out = { ...src }
  const qs = (questions || []).filter((q) => q && (q.id || q.label))
  const used = new Set()
  for (const q of qs) {
    const id = String(q.id || slugQuestionKey(q.label) || '').trim()
    if (!id) continue
    if (src[id] != null && src[id] !== '') {
      used.add(id)
      out[id] = src[id]
      continue
    }
    const slug = slugQuestionKey(q.label || '')
    const hit = [q.label, slug].find((k) => k && src[k] != null && src[k] !== '')
    if (hit) {
      out[id] = src[hit]
      used.add(hit)
    }
  }
  const leftover = Object.keys(src)
    .filter((k) => /^q_\d+$/i.test(k) && !used.has(k) && src[k] != null && src[k] !== '')
    .sort()
  const emptyQs = qs.filter((q) => {
    const id = String(q.id || slugQuestionKey(q.label) || '').trim()
    return id && (out[id] == null || out[id] === '')
  })
  leftover.forEach((k, i) => {
    const q = emptyQs[i]
    if (!q) return
    const id = String(q.id || slugQuestionKey(q.label) || '').trim()
    if (id) out[id] = src[k]
  })
  return out
}
import {
  collapseDuplicateDrafts,
  deleteDraft,
  findOpenDraft,
  getPackage,
  savePackageLocal,
} from './localStore'

function openDraftStorageKey(user) {
  return `esurvey_open_draft_${user?.id || user?.username || 'me'}`
}

function readStoredOpenDraft(user) {
  try {
    const raw = localStorage.getItem(openDraftStorageKey(user))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && parsed.id ? parsed : null
  } catch {
    return null
  }
}

function writeStoredOpenDraft(user, data) {
  try {
    const key = openDraftStorageKey(user)
    if (!data?.id) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}
import { forceSyncNow, getQueueSnapshot } from './syncEngine'
import { displayOption, displayQuestion, getDisplayLang, getNavMode } from './prefs'
import { startSurveyNotify, stopSurveyNotify } from './surveyNotify'
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

// Auto-lock/meta keys written into answers — excluded from answered-question count
const META_ANSWER_KEYS = [
  '_draft',
  '_timing',
  '_duration_sec',
  '_voice_required',
  'geo_lat',
  'geo_lng',
  'geo_accuracy',
  'geo_at',
  'location_display',
  'location_district',
  'location_mandal',
  'location_state',
]

function emptyTiming() {
  return { gps_start: null, finish: null }
}

function nowIso() {
  return new Date().toISOString()
}

function secBetweenClient(a, b) {
  const t1 = new Date(a || '').getTime()
  const t2 = new Date(b || '').getTime()
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t2 < t1) return ''
  return String(Math.round((t2 - t1) / 1000))
}

// Sentiment type: Positive / Neutral / Negative
const SENTIMENT_COLORS = {
  Positive: '#16a34a',
  Neutral: '#fbbf24',
  Negative: '#ef4444',
}

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

const IDLE_HOME_MS = 3 * 60 * 1000

function revokeBlobUrl(url) {
  if (url && String(url).startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }
}

export default function FieldCollectScreen({
  user,
  onToast,
  onDone,
  onSavedDraft,
  onIdleHome,
  draft,
  active = true,
  navMode: navModeProp,
}) {
  // Device-local question-navigation preference (Profile → Question layout).
  // The prop is the live source; fall back to localStorage if omitted.
  const navMode = navModeProp || getNavMode()
  const [deviceLang, setDeviceLang] = useState(getDisplayLang)
  useEffect(() => {
    const onLang = () => setDeviceLang(getDisplayLang())
    window.addEventListener('esurvey-display-lang', onLang)
    return () => window.removeEventListener('esurvey-display-lang', onLang)
  }, [])
  const [step, setStep] = useState(0) // 0 geo, 1 photo, 2 voice+qa, 3 done
  const [formMeta, setFormMeta] = useState(null)
  const [surveyChosen, setSurveyChosen] = useState(false)
  const displayLang = formMeta?.display_lang === 'te' || formMeta?.display_lang === 'en'
    ? formMeta.display_lang
    : deviceLang
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [geo, setGeo] = useState(null)
  const [locationDetails, setLocationDetails] = useState(null)
  const [geoLoading, setGeoLoading] = useState(false)
  const [photoDataUrl, setPhotoDataUrl] = useState('')
  const [audioBlob, setAudioBlob] = useState(null)
  const [, setAudioUrl] = useState('')
  const [recording, setRecording] = useState(false)
  const [voiceActivated, setVoiceActivated] = useState(false)
  const [listening, setListening] = useState(false)
  const [activeQ, setActiveQ] = useState(0)
  const [saving, setSaving] = useState(false)
  const [loadErr, setLoadErr] = useState('')
  const [progress, setProgress] = useState(null)
  const [queueInfo, setQueueInfo] = useState(null)
  const [localDoneCount, setLocalDoneCount] = useState(0)

  // Resume the record number after relogin/remount — count records already
  // saved on this phone by this surveyor (drafts included)
  useEffect(() => {
    let alive = true
    import('./localStore')
      .then(({ listAllPackages }) => listAllPackages())
      .then((all) => {
        if (!alive) return
        const list = Array.isArray(all) ? all : []
        const meName = String(user?.name || '').toLowerCase()
        const meUsername = String(user?.username || '').toLowerCase()
        const mine = list.filter((p) => {
          if (!p) return false
          const pUser = String(p.submitted_by || p.qa?.submitted_by || '').toLowerCase()
          if (!pUser || (meName && pUser === meName) || (meUsername && pUser === meUsername)) return true
          return true
        })
        const maxIdx = mine.reduce((m, p) => Math.max(m, Number(p?.recordIndex) || 0), 0)
        const count = Math.max(maxIdx, mine.length)
        if (count > 0) setLocalDoneCount(count)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [user])

  const mediaRec = useRef(null)
  const chunks = useRef([])
  const recognitionRef = useRef(null)
  const audioUrlRef = useRef('')
  const saveDraftRef = useRef(null)
  const watchId = useRef(null)
  const streamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const audioStartedAt = useRef(null)
  const audioTimerRef = useRef(null)
  const timingRef = useRef(emptyTiming())

  function markTiming(key) {
    const t = timingRef.current
    if (!t[key]) t[key] = nowIso()
  }

  function chooseAnswer(qid, value) {
    setAnswers((a) => ({ ...a, [qid]: value }))
  }

  function buildTimingPayload() {
    const t = timingRef.current
    if (!t.finish) t.finish = nowIso()
    const sec = secBetweenClient(t.gps_start, t.finish)
    return {
      _timing: { gps_start: t.gps_start || null, finish: t.finish },
      _duration_sec: sec === '' ? null : Number(sec),
    }
  }

  // Swipe-navigation gesture tracking (only used when navMode === 'swipe')
  const touchStartX = useRef(null)
  const touchStartY = useRef(null)
  const storedOpen = readStoredOpenDraft(user)
  const workingDraftIdRef = useRef(draft?.id || storedOpen?.id || null)
  const draftCreatedAtRef = useRef(draft?.createdAt || storedOpen?.createdAt || null)
  const workingRecordIndexRef = useRef(
    draft?.recordIndex ?? storedOpen?.recordIndex ?? null,
  )

  function hydrateFromPackage(pkg) {
    if (!pkg) return
    const d = pkg.qa || pkg
    const init = {}
    for (const q of questions || []) {
      const id = q?.id || slugQuestionKey(q?.label || '')
      if (id) init[id] = ''
    }
    setAnswers(mapAnswersToQuestions({ ...init, ...d.answers }, questions || []))
    if (d.answers?._timing && typeof d.answers._timing === 'object') {
      timingRef.current = {
        gps_start: d.answers._timing.gps_start || null,
        finish: d.answers._timing.finish || null,
      }
    }
    const g = d.geo
    if (g && Number.isFinite(Number(g.lat))) {
      setGeo({ lat: Number(g.lat), lng: Number(g.lng), accuracy: g.accuracy ?? 0, at: g.at ?? '', locked: true })
      setLocationDetails(d.location_details || null)
    }
    if (pkg.photoDataUrl) setPhotoDataUrl(pkg.photoDataUrl)
    if (pkg.audioDataUrl) {
      assignAudioUrl(pkg.audioDataUrl)
      setVoiceActivated(true)
      try {
        fetch(pkg.audioDataUrl)
          .then((r) => r.blob())
          .then((b) => setAudioBlob(b))
          .catch(() => {})
      } catch {
        /* ignore */
      }
    }
    const hasGeo = g && Number.isFinite(Number(g.lat))
    const hasPhoto = !!(pkg.photoDataUrl && String(pkg.photoDataUrl).length >= MIN_PHOTO_CHARS)
    let nextStep = typeof pkg.step === 'number' ? Math.min(Math.max(0, pkg.step), 2) : 2
    if (!hasGeo) nextStep = 0
    else if (!hasPhoto) nextStep = Math.min(nextStep, 1)
    setStep(nextStep)
    if (typeof pkg.activeQ === 'number' && pkg.activeQ >= 0) {
      setActiveQ(pkg.activeQ)
    }
    setSurveyChosen(true)
  }

  // Editing a saved draft: prefill everything from phone storage
  const draftLoaded = useRef(null)
  useEffect(() => {
    if (!draft || !draft.id) return
    if (draftLoaded.current === draft.id && questions.length) return
    draftLoaded.current = draft.id
    hydrateFromPackage(draft)
  }, [draft, questions])

  // Resume the in-progress survey if Collect remounted (tab / refresh / crash)
  const resumedRef = useRef(false)
  useEffect(() => {
    if (draft?.id || resumedRef.current) return
    const stored = readStoredOpenDraft(user)
    if (!stored?.id) return
    resumedRef.current = true
    let alive = true
    getPackage(stored.id)
      .then((pkg) => {
        if (!alive || !pkg || pkg.phase !== 'draft') return
        hydrateFromPackage(pkg)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [user, draft])

  const geoLocked = isGeoValid(geo)
  const locationLocked = geoLocked && !!locationDetails
  const photoLocked = !!(photoDataUrl && photoDataUrl.length >= MIN_PHOTO_CHARS)
  // Voice recording: optional by default, or mandatory if project sets voice_required: true
  const voiceRequired = formMeta?.voice_required === true
  const voiceTimeLimit = Number(formMeta?.voice_time_limit || 0) // minutes, 0 = no limit
  const voiceLocked = voiceRequired ? (voiceActivated && (!!audioBlob || recording)) : true
  const questionsOpen = geoLocked && photoLocked && (!voiceRequired || voiceActivated)
  const editingDraft = !!draft?.id
  const locks = {
    geo: geoLocked,
    location: locationLocked,
    photo: photoLocked,
    voice: voiceLocked,
  }
  const allHardLocks = geoLocked && photoLocked && voiceLocked && locationLocked
  const surveyUnlocked = geoLocked && photoLocked && (!voiceRequired || voiceLocked)
  const surveyRunning =
    step < 3 &&
    (geoLoading || geoLocked || photoLocked || recording || step >= 1 || !!workingDraftIdRef.current)

  useEffect(() => {
    if (!surveyRunning) {
      void stopSurveyNotify()
      return undefined
    }
    const phase = geoLoading
      ? 'Locking GPS…'
      : step === 0
        ? 'GPS'
        : step === 1
          ? 'Photo'
          : recording
            ? 'Recording'
            : 'Questions'
    const title = formMeta?.title ? String(formMeta.title) : 'Survey running'
    void startSurveyNotify(`${phase} · tap to return`, title)
    return undefined
  }, [surveyRunning, geoLoading, step, recording, formMeta?.title])

  useEffect(() => () => {
    void stopSurveyNotify()
  }, [])


  useEffect(() => {
    if (step >= 2 && !surveyUnlocked) {
      setStep(!geoLocked ? 0 : 1)
      setVoiceActivated(false)
      onToast?.('Lock GPS and photo before the survey', 'error')
    }
  }, [step, surveyUnlocked, geoLocked, onToast])

  // Scroll mode has no per-question Next tap, so quietly checkpoint the draft as
  // answers change (debounced) — otherwise leaving mid-scroll loses everything
  // since the last save. Next/swipe modes already checkpoint on each advance.
  useEffect(() => {
    if (navMode !== 'scroll') return
    if (step !== 2 || !voiceActivated || !questions.length || saving) return
    const t = setTimeout(() => {
      void saveDraft({ mode: 'checkpoint', silent: true })
    }, 1500)
    return () => clearTimeout(t)
    // saveDraft is a stable in-component declaration; deps intentionally track
    // only the inputs that should (re)arm the autosave timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, navMode, step, voiceActivated, questions.length, saving])

  // Survey status saved with the draft: answered questions out of total (meta keys excluded)
  const answeredCount = useMemo(() => {
    const meta = new Set(META_ANSWER_KEYS)
    let n = 0
    for (const [k, v] of Object.entries(answers || {})) {
      if (meta.has(k)) continue
      if (v !== undefined && v !== null && String(v).trim() !== '') n += 1
    }
    return n
  }, [answers])

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
        const data = await getSurveyForm()
        const list = Array.isArray(data.surveys) && data.surveys.length
          ? data.surveys
          : data.form_key
            ? [data]
            : []
        const draftKey = draft?.qa?.form_key || draft?.form_key
        const resumeKey = !draft
          ? (readStoredOpenDraft(user)?.form_key || '')
          : ''
        const preferKey = draftKey || resumeKey
        const pick = preferKey
          ? list.find((s) => String(s.form_key) === String(preferKey))
          : list.length === 1
            ? list[0]
            : null
        if (pick) {
          setFormMeta({ ...pick, surveys: list })
          setQuestions(pick.questions || [])
          setSurveyChosen(true)
          if (opts.resetAnswers !== false) {
            const init = {}
            for (const q of pick.questions || []) init[q.id] = ''
            setAnswers(init)
            setActiveQ(0)
          }
        } else {
          setFormMeta({
            title: list.length ? 'Choose survey' : 'No survey assigned',
            form_key: '',
            questions: [],
            surveys: list,
          })
          setQuestions([])
          setSurveyChosen(false)
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
    [onToast, refreshProgress, refreshQueue, draft, user],
  )

  useEffect(() => {
    const resume = !draft && !!readStoredOpenDraft(user)?.id
    loadQuestions({ silent: true, resetAnswers: !draft && !resume }).catch(() => {})
    return () => {
      if (watchId.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId.current)
      }
      try {
        if (mediaRec.current) {
          mediaRec.current.ondataavailable = null
          mediaRec.current.onstop = null
          mediaRec.current.stop()
        }
      } catch {
        /* ignore */
      }
      mediaRec.current = null
      try {
        audioCtxRef.current?.close()
      } catch {
        /* ignore */
      }
      audioCtxRef.current = null
      try {
        clearTimeout(audioTimerRef.current)
      } catch {
        /* ignore */
      }
      audioTimerRef.current = null
      try {
        recognitionRef.current?.abort()
      } catch {
        /* ignore */
      }
      recognitionRef.current = null
      try {
        streamRef.current?.getTracks?.().forEach((t) => t.stop())
      } catch {
        /* ignore */
      }
      streamRef.current = null
      revokeBlobUrl(audioUrlRef.current)
      audioUrlRef.current = ''
      setAudioUrl('')
    }
  }, [loadQuestions, draft])

  useEffect(() => {
    if (active) return undefined
    const started =
      geoLoading || !!geo || !!photoDataUrl || recording || step >= 1
    // In-progress survey keeps GPS / mic while the app is backgrounded or
    // the user is on another tab — notification stays until finish.
    if (started) return undefined
    if (watchId.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId.current)
      watchId.current = null
    }
    try {
      mediaRec.current?.stop()
    } catch {
      /* ignore */
    }
    try {
      recognitionRef.current?.abort()
    } catch {
      /* ignore */
    }
    recognitionRef.current = null
    try {
      streamRef.current?.getTracks?.().forEach((t) => t.stop())
    } catch {
      /* ignore */
    }
    setRecording(false)
    setListening(false)
    return undefined
  }, [active, geoLoading, geo, photoDataUrl, recording, step])

  useEffect(() => {
    if (!active || !onIdleHome) return undefined
    let timer = 0
    const arm = () => {
      window.clearTimeout(timer)
      if (typeof document !== 'undefined' && document.hidden) return
      timer = window.setTimeout(() => {
        if (typeof document !== 'undefined' && document.hidden) return
        const go = () => {
          onToast?.('Idle 3 minutes — back to Home', 'ok')
          onIdleHome()
        }
        const persist = saveDraftRef.current
        if (typeof persist === 'function') {
          persist({ mode: 'checkpoint', silent: true }).catch(() => {}).finally(go)
        } else {
          go()
        }
      }, IDLE_HOME_MS)
    }
    arm()
    const evs = ['pointerdown', 'touchstart', 'keydown']
    evs.forEach((e) => window.addEventListener(e, arm, { passive: true }))
    const onVis = () => {
      if (document.hidden) window.clearTimeout(timer)
      else arm()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearTimeout(timer)
      evs.forEach((e) => window.removeEventListener(e, arm))
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [active, onIdleHome, onToast])

  function assignAudioUrl(next) {
    const url = next || ''
    const prev = audioUrlRef.current
    if (prev && prev !== url) revokeBlobUrl(prev)
    audioUrlRef.current = url
    setAudioUrl(url)
  }

  function clearAudioUrl() {
    assignAudioUrl('')
  }

  function resetForNextRecord() {
    void stopSurveyNotify()
    setStep(0)
    setGeo(null)
    setLocationDetails(null)
    setPhotoDataUrl('')
    setAudioBlob(null)
    clearAudioUrl()
    setRecording(false)
    setVoiceActivated(false)
    setListening(false)
    setActiveQ(0)
    audioStartedAt.current = null
    timingRef.current = emptyTiming()
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
    markTiming('gps_start')
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
        if (document.visibilityState === 'hidden') return
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
        const dataUrl = compressPhotoFromImage(img)
        if (dataUrl.length < MIN_PHOTO_CHARS) {
          onToast?.('Photo invalid — retake', 'error')
          return
        }
        setPhotoDataUrl(dataUrl)
        onToast?.('Photo locked', 'ok')
        void saveDraftRef.current?.({ mode: 'checkpoint', silent: true }).catch(() => {})
      }
      img.onerror = () => onToast?.('Could not read photo', 'error')
      img.src = reader.result
    }
    reader.readAsDataURL(file)
    // allow re-pick same file later
    e.target.value = ''
  }

  async function startAudio() {
    if (!geoLocked || !photoLocked) {
      onToast?.('Lock GPS and photo before the survey', 'error')
      setStep(!geoLocked ? 0 : 1)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: { ideal: 1 },
          sampleRate: { ideal: AUDIO_SAMPLE_RATE },
        },
      })
      streamRef.current = stream
      chunks.current = []
      let recStream = stream
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext
        const ctx = new Ctx({ sampleRate: AUDIO_SAMPLE_RATE })
        if (ctx.state === 'suspended') await ctx.resume()
        audioCtxRef.current = ctx
        const src = ctx.createMediaStreamSource(stream)
        const dest = ctx.createMediaStreamDestination()
        src.connect(dest)
        recStream = dest.stream
      } catch {
        audioCtxRef.current = null
      }
      const recOpts = pickAudioRecorderOptions()
      const rec = recOpts.mimeType
        ? new MediaRecorder(recStream, recOpts)
        : new MediaRecorder(recStream, { audioBitsPerSecond: recOpts.audioBitsPerSecond })
      mediaRec.current = rec
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunks.current.push(ev.data)
      }
      rec.onstop = () => {
        const raw = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
        void toSpeechWav16k(raw).then((blob) => {
          setAudioBlob(blob)
          assignAudioUrl(URL.createObjectURL(blob))
        })
        try {
          stream.getTracks().forEach((t) => t.stop())
        } catch {
          /* ignore */
        }
        try {
          audioCtxRef.current?.close()
        } catch {
          /* ignore */
        }
        audioCtxRef.current = null
      }
      rec.start(1000)
      audioStartedAt.current = Date.now()
      setRecording(true)
      setVoiceActivated(true)
      onToast?.(voiceTimeLimit ? `Voice activated · ${voiceTimeLimit} min limit` : 'Voice activated · Opus 24 kbps', 'ok')
      // Auto-stop after voice_time_limit minutes
      if (voiceTimeLimit > 0) {
        const timerMs = voiceTimeLimit * 60 * 1000
        audioTimerRef.current = setTimeout(() => {
          if (mediaRec.current && recording) {
            mediaRec.current.stop()
            setRecording(false)
            onToast?.(`Voice auto-stopped at ${voiceTimeLimit} min limit`, 'ok')
          }
        }, timerMs)
      }
    } catch (e) {
      setVoiceActivated(false)
      onToast?.(e.message || (voiceRequired ? 'Microphone permission required' : 'Microphone permission denied'), 'error')
    }
  }

  function stopAudio() {
    clearTimeout(audioTimerRef.current)
    audioTimerRef.current = null
    if (mediaRec.current && recording) {
      mediaRec.current.stop()
      setRecording(false)
    }
  }

  /** Speech recognition fills current question (requires voice activated) */
  function startSpeechFill(targetQ) {
    if (!voiceActivated) {
      onToast?.('Activate voice first', 'error')
      return
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      onToast?.('Speech recognition not available — type answers', 'error')
      return
    }
    // Accept an explicit target (scroll mode fills a specific card); default to
    // the active question. Guard against a stray event object being passed in.
    const q = targetQ && targetQ.id ? targetQ : questions[activeQ]
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
      if (q.options?.length) {
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
    return blobToDataUrl(blob)
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
    if (voiceRequired && !voiceActivated) {
      onToast?.('Voice activation required for this survey', 'error')
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
        // In scroll mode activeQ isn't the visible position, so bring the
        // missing question into view by its stable id.
        if (navMode === 'scroll' && typeof document !== 'undefined' && q.id) {
          try {
            document
              .getElementById(`qa-q-${q.id}`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          } catch {
            /* ignore */
          }
        }
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
          const raw = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
          void toSpeechWav16k(raw).then((b) => {
            setAudioBlob(b)
            assignAudioUrl(URL.createObjectURL(b))
            try {
              streamRef.current?.getTracks?.().forEach((t) => t.stop())
            } catch {
              /* ignore */
            }
            setRecording(false)
            resolve(b)
          })
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
      blob = await toSpeechWav16k(new Blob(chunks.current, { type: 'audio/webm' }))
      setAudioBlob(blob)
    }

    if (voiceRequired && (!blob || blob.size < MIN_AUDIO_BYTES)) {
      onToast?.(
        'Voice recording too short or missing — re-activate voice and record interview',
        'error',
      )
      setStep(2)
      return
    }

    if (voiceRequired) {
      const durationMs = audioStartedAt.current
        ? Date.now() - audioStartedAt.current
        : 0
      if (durationMs > 0 && durationMs < 2500) {
        onToast?.('Record at least a few seconds of voice before save', 'error')
        return
      }
    }

    setSaving(true)
    try {
      let audioDataUrl = null
      let audioMime = 'audio/webm'
      if (blob && blob.size >= MIN_AUDIO_BYTES) {
        audioDataUrl = await blobToBase64(blob)
        audioMime = blob.type || 'audio/webm'
      }

      // Locked location + geo stamped into answers (immutable client fields).
      // Draft markers are stripped — a confirmed record is finished work.
      const cleanAnswers = { ...answers }
      delete cleanAnswers._draft
      delete cleanAnswers.draft
      const remapped = mapAnswersToQuestions(cleanAnswers, questions || [])
      const currentDone = Math.max(localDoneCount, progress?.done || 0)
      const reuseId = workingDraftIdRef.current || draft?.id || null
      const localSeq =
        workingRecordIndexRef.current ??
        draft?.recordIndex ??
        Math.max(progress?.next_record || 0, currentDone + 1)
      markTiming('finish')
      const lockedAnswers = {
        ...remapped,
        ...buildTimingPayload(),
        _geo_locked: true,
        _photo_locked: true,
        _voice_locked: voiceRequired ? true : !!audioDataUrl,
        _voice_required: voiceRequired,
        _location_locked: true,
        _recordIndex: localSeq,
        geo_lat: geo.lat,
        geo_lng: geo.lng,
        geo_accuracy: geo.accuracy,
        geo_at: geo.at,
        location_display: locationDetails?.display_name || '',
        location_district: locationDetails?.district || answers.district || '',
        location_mandal: locationDetails?.mandal || answers.mandal || '',
        location_state: locationDetails?.state || '',
      }
      const packageId = await savePackageLocal({
        id: reuseId,
        createdAt: draftCreatedAtRef.current || draft?.createdAt,
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
        voice_required: voiceRequired,
        locks: {
          geo: true,
          photo: true,
          voice: voiceRequired ? true : !!audioDataUrl,
          location: true,
        },
      })

      setLocalDoneCount(localSeq)
      writeStoredOpenDraft(user, null)
      workingDraftIdRef.current = null
      workingRecordIndexRef.current = null
      draftCreatedAtRef.current = null
      const qstats = await refreshQueue()
      onToast?.(
        `Saved · locks OK · queue #${localSeq} · pending ${qstats?.pending ?? '—'}`,
        'ok',
      )

      if (draft?.id && draft.id !== packageId) {
        await deleteDraft(draft.id).catch(() => {})
        draftLoaded.current = null
      }
      await collapseDuplicateDrafts().catch(() => {})

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
          `Auto next · activity ${next}${target ? ` / ${target}` : ''}`,
          'ok',
        )
      }
    } catch (e) {
      onToast?.(e.message || 'Local save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  /**
   * Save to phone storage only (draft-first): nothing reaches the server until
   * the surveyor explicitly confirms (Push to admin / Confirm & push).
   * mode 'checkpoint' → Next button: upsert the same draft and stay on Collect.
   * autoNext → stay on Collect and start the next record.
   */
  async function saveDraft({ autoNext = false, mode = 'finish', questionIndex, silent = false } = {}) {
    const checkpoint = mode === 'checkpoint'
    if (!checkpoint) {
      if (!geoLocked) {
        onToast?.('Lock GPS first (step 1)', 'error')
        setStep(0)
        return false
      }
      if (!photoLocked) {
        onToast?.('Capture photo first (step 2)', 'error')
        setStep(1)
        return false
      }
    }
    if (!checkpoint) setSaving(true)
    try {
      // Reserve the same draft id + record # BEFORE any await so Next cannot
      // race and write a second package beside the original.
      if (!workingDraftIdRef.current) {
        const stored = readStoredOpenDraft(user)
        workingDraftIdRef.current =
          draft?.id ||
          stored?.id ||
          (typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `draft_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`)
        if (stored?.createdAt && !draftCreatedAtRef.current) {
          draftCreatedAtRef.current = stored.createdAt
        }
        if (stored?.recordIndex != null && workingRecordIndexRef.current == null) {
          workingRecordIndexRef.current = stored.recordIndex
        }
      }
      if (!draftCreatedAtRef.current) {
        draftCreatedAtRef.current = draft?.createdAt || new Date().toISOString()
      }
      if (workingRecordIndexRef.current == null) {
        const currentDone = Math.max(localDoneCount, progress?.done || 0)
        workingRecordIndexRef.current =
          draft?.recordIndex ??
          Math.max(progress?.next_record || 0, currentDone + 1)
      }
      writeStoredOpenDraft(user, {
        id: workingDraftIdRef.current,
        createdAt: draftCreatedAtRef.current,
        recordIndex: workingRecordIndexRef.current,
      })

      let audioDataUrl = null
      let audioMime = 'audio/webm'
      let blob = audioBlob
      if ((!blob || blob.size < MIN_AUDIO_BYTES) && chunks.current.length) {
        blob = await toSpeechWav16k(new Blob(chunks.current, { type: 'audio/webm;codecs=opus' }))
        if (!checkpoint) setAudioBlob(blob)
      }
      if (blob && blob.size >= MIN_AUDIO_BYTES) {
        blob = await toSpeechWav16k(blob)
        audioDataUrl = await blobToBase64(blob)
        audioMime = blob.type || 'audio/webm'
      } else if (!checkpoint && voiceRequired) {
        onToast?.('Voice recording required to save a draft — activate voice and record', 'error')
        setStep(2)
        return false
      }

      // If this collect remounted, adopt any leftover draft for the same record.
      const existing = await findOpenDraft({
        userId: user?.id,
        submittedBy: user?.name || user?.username,
        formKey: formMeta?.form_key || 'default',
        recordIndex: workingRecordIndexRef.current,
      }).catch(() => null)
      if (existing?.id && existing.id !== workingDraftIdRef.current) {
        workingDraftIdRef.current = existing.id
        draftCreatedAtRef.current = existing.createdAt || draftCreatedAtRef.current
        writeStoredOpenDraft(user, {
          id: existing.id,
          createdAt: draftCreatedAtRef.current,
          recordIndex: workingRecordIndexRef.current,
        })
      }

      // Keep meta keys in sync with META_ANSWER_KEYS (excluded from the answered count)
      const lockedAnswers = {
        ...answers,
        ...buildTimingPayload(),
        _draft: true,
        _voice_required: voiceRequired,
        _recordIndex: workingRecordIndexRef.current,
        geo_lat: geo?.lat,
        geo_lng: geo?.lng,
        geo_accuracy: geo?.accuracy,
        geo_at: geo?.at,
        location_display: locationDetails?.display_name || '',
        location_district: locationDetails?.district || answers.district || '',
        location_mandal: locationDetails?.mandal || answers.mandal || '',
        location_state: locationDetails?.state || '',
      }

      const localSeq = workingRecordIndexRef.current

      await savePackageLocal(
        {
          id: workingDraftIdRef.current,
          createdAt: draftCreatedAtRef.current,
          form_key: formMeta?.form_key || 'default',
          form_id: `field-${user?.username || 's'}-${Date.now()}`,
          source: 'mobile-field-survey',
          submitted_by: user?.name || user?.username,
          user_id: user?.id,
          geo: geo ? { ...geo, locked: !!geoLocked } : null,
          location_details: locationDetails,
          answers: lockedAnswers,
          photoDataUrl,
          audioDataUrl,
          audioMime,
          recordIndex: localSeq,
          locks: {
            geo: !!geoLocked,
            location: !!locationDetails,
            photo: !!photoLocked,
            voice: !!audioDataUrl,
          },
          step,
          activeQ: Number.isInteger(questionIndex) ? questionIndex : activeQ,
          answered: answeredCount,
          total: questions.length,
        },
        { draft: true },
      )
      if (draft?.id && draft.id !== workingDraftIdRef.current) {
        await deleteDraft(draft.id).catch(() => {})
        draftLoaded.current = null
      }
      await collapseDuplicateDrafts().catch(() => {})
      if (checkpoint) {
        if (!silent) {
          onToast?.(`Saved as draft · Q${(Number.isInteger(questionIndex) ? questionIndex : activeQ) + 1}`, 'ok')
        }
        return true
      }
      if (autoNext) {
        workingDraftIdRef.current = null
        draftCreatedAtRef.current = null
        workingRecordIndexRef.current = null
        writeStoredOpenDraft(user, null)
        resetForNextRecord()
        onToast?.(`Saved as draft #${localSeq} — review & send from Pending`, 'ok')
        onDone?.(null, null)
      } else {
        workingDraftIdRef.current = null
        draftCreatedAtRef.current = null
        workingRecordIndexRef.current = null
        writeStoredOpenDraft(user, null)
        onToast?.('Draft saved on this phone — review & send from Pending', 'ok')
        onSavedDraft?.()
      }
      return true
    } catch (e) {
      onToast?.(e.message || 'Draft save failed', 'error')
      return false
    } finally {
      if (!checkpoint) setSaving(false)
    }
  }
  saveDraftRef.current = saveDraft

  /** Discard the draft being edited (drafts never reach the server on their own) */
  async function removeCurrentDraft() {
    if (!draft?.id) return
    if (!confirm('Delete this draft from the phone? Its answers and media will be removed.')) return
    setSaving(true)
    try {
      await deleteDraft(draft.id).catch(() => {})
      draftLoaded.current = null
      onToast?.('Draft deleted', 'ok')
      onSavedDraft?.()
    } catch (e) {
      onToast?.(e.message || 'Delete failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const q = questions[activeQ]

  // ── Survey question navigation (Profile → Question layout) ────────
  function scrollToQuestionCenter() {
    requestAnimationFrame(() => {
      try {
        const card = document.querySelector('.qa-card')
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
        }
      } catch {
        /* ignore */
      }
    })
  }

  // Shared advance/retreat used by the Prev/Next buttons and swipe gestures.
  function goPrev() {
    setActiveQ((i) => {
      const prevQ = Math.max(0, i - 1)
      scrollToQuestionCenter()
      return prevQ
    })
  }
  function goNext() {
    if (activeQ < questions.length - 1) {
      const nextQ = activeQ + 1
      setActiveQ(nextQ)
      scrollToQuestionCenter()
      void saveDraft({ mode: 'checkpoint', questionIndex: nextQ })
    }
  }
  function onSwipeStart(e) {
    // Don't hijack text inputs or sliders
    const el = e.target
    if (
      el &&
      el.closest &&
      el.closest('input[type="text"], input[type="number"], textarea, select, [contenteditable], .qa-meter')
    ) {
      touchStartX.current = null
      return
    }
    const t = e.changedTouches?.[0]
    touchStartX.current = t ? t.clientX : null
    touchStartY.current = t ? t.clientY : null
  }
  function onSwipeEnd(e) {
    if (touchStartX.current == null) return
    const t = e.changedTouches?.[0]
    const startX = touchStartX.current
    const startY = touchStartY.current
    touchStartX.current = null
    touchStartY.current = null
    if (!t) return
    const dx = t.clientX - startX
    const dy = t.clientY - startY
    // Require a deliberate, mostly-horizontal swipe (min 35px, horizontal > vertical)
    if (Math.abs(dx) < 35 || Math.abs(dx) < Math.abs(dy) * 1.1) return
    if (dx < 0) goNext()
    else goPrev()
  }

  // Answer inputs for one question — identical markup in every nav mode.
  function renderAnswerBody(qq) {
    return qq.type === 'yesno' ? (
      <div className="qa-options">
        <button
          type="button"
          className={`qa-opt yes${answers[qq.id] === 'Yes' ? ' selected' : ''}`}
          onClick={() => chooseAnswer(qq.id, 'Yes')}
        >
          {displayOption('Yes', qq, 0, displayLang)}
        </button>
        <button
          type="button"
          className={`qa-opt no${answers[qq.id] === 'No' ? ' selected' : ''}`}
          onClick={() => chooseAnswer(qq.id, 'No')}
        >
          {displayOption('No', qq, 1, displayLang)}
        </button>
      </div>
    ) : qq.type === 'sentiment_text' ? (
      <div style={{ marginTop: 10 }}>
        <label className="field" style={{ marginBottom: 8 }}>
          <span>Response Text</span>
          <textarea
            rows={3}
            value={answers[qq.id] || ''}
            onChange={(e) => chooseAnswer(qq.id, e.target.value)}
            placeholder="Type respondent feedback or opinion…"
            style={{ width: '100%', resize: 'vertical' }}
          />
        </label>
        <p style={{ margin: '4px 0 6px', fontSize: 12, fontWeight: 'bold', color: '#38bdf8' }}>
          Tag Sentiment Filler:
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { label: `😀 ${displayOption('Positive', qq, 0, displayLang)}`, val: 'Positive', color: '#059669' },
            { label: `😐 ${displayOption('Neutral', qq, 1, displayLang)}`, val: 'Neutral', color: '#d97706' },
            { label: `🙁 ${displayOption('Negative', qq, 2, displayLang)}`, val: 'Negative', color: '#dc2626' },
          ].map((item) => {
            const active = (answers[qq.id] || '').includes(`[${item.val}]`)
            return (
              <button
                key={item.val}
                type="button"
                style={{
                  background: item.color,
                  color: '#fff',
                  border: 0,
                  borderRadius: 20,
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  outline: active ? '2px solid #fff' : 'none',
                  outlineOffset: 2,
                  opacity: answers[qq.id] && !active ? 0.7 : 1,
                }}
                onClick={() => {
                  const prev = answers[qq.id] || ''
                  const cleaned = prev.replace(/\s*\[(Positive|Neutral|Negative)\]/g, '').trim()
                  chooseAnswer(qq.id, `${cleaned} [${item.val}]`.trim())
                }}
              >
                {item.label}
              </button>
            )
          })}
        </div>
      </div>
    ) : qq.type === 'meter' ? (
      <div className="qa-meter">
        {(() => {
          const raw = String(answers[qq.id] || '').replace('%', '').trim()
          const n = Number(raw)
          const val = n >= 1 && n <= 100 ? n : 50
          const mood = val <= 33 ? 'Negative' : val <= 66 ? 'Neutral' : 'Positive'
          const moodClass = val <= 33 ? 'neg' : val <= 66 ? 'neu' : 'pos'
          return (
            <>
              <div className="qa-meter-track">
                <input
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  value={val}
                  onChange={(e) => chooseAnswer(qq.id, `${Number(e.target.value)}%`)}
                  aria-label="Sentiment 1 to 100"
                />
              </div>
              <div className="qa-meter-scale">
                <span>{displayOption('Negative', qq, 0, displayLang)}</span>
                <span>{displayOption('Neutral', qq, 1, displayLang)}</span>
                <span>{displayOption('Positive', qq, 2, displayLang)}</span>
              </div>
              <div className="qa-meter-value">
                <strong>{answers[qq.id] ? `${val}%` : '—'}</strong>
                {answers[qq.id] ? (
                  <span className={`qa-opt selected ${moodClass}`} style={{ minHeight: 32, padding: '4px 12px' }}>
                    {displayOption(mood, qq, mood === 'Negative' ? 0 : mood === 'Neutral' ? 1 : 2, displayLang)}
                  </span>
                ) : (
                  <span className="muted">Tap the bar</span>
                )}
              </div>
            </>
          )
        })()}
      </div>
    ) : (Array.isArray(qq.options) && qq.options.length > 0) || (qq.type === 'range' || qq.type === 'numeric_range' || qq.type === 'age') ? (
      <div>
        <div
          className={`qa-options${
            (Array.isArray(qq.options) ? qq.options.length : 5) === 1 ? ' cols-1' : ''
          }`}
        >
          {(Array.isArray(qq.options) && qq.options.length > 0
            ? qq.options
            : ['10-20', '21-30', '31-40', '41-50', '50+']
          ).map((opt, oi) => {
            const sel = answers[qq.id] === opt
            const optKey = String(opt || '').trim().toLowerCase()
            const sent =
              qq.type === 'sentiment' || SENTIMENT_COLORS[String(opt || '').trim()]
                ? optKey.startsWith('pos')
                  ? 'pos'
                  : optKey.startsWith('neg')
                    ? 'neg'
                    : 'neu'
                : ''
            const partyClass =
              optKey.includes('congress') || optKey.includes('inc')
                ? 'party-congress'
                : optKey.includes('bjp')
                  ? 'party-bjp'
                  : optKey.includes('brs') || optKey.includes('trs')
                    ? 'party-brs'
                    : optKey.includes('others')
                      ? 'party-others'
                      : optKey.includes('undecided')
                        ? 'party-undecided'
                        : ''
            return (
              <button
                key={opt}
                type="button"
                className={`qa-opt opt-btn${sel ? ' selected' : ''}${sent ? ` ${sent}` : ''}${partyClass ? ` ${partyClass}` : ''}`}
                onClick={() => chooseAnswer(qq.id, opt)}
              >
                {partyClass ? (
                  <span
                    className="swatch"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      marginRight: 6,
                      display: 'inline-block',
                      background: `var(--${partyClass})`,
                    }}
                  />
                ) : null}
                {displayOption(opt, qq, oi, displayLang)}
              </button>
            )
          })}
        </div>
        {(qq.type === 'range' || qq.type === 'numeric_range' || qq.type === 'age') && (
          <label className="field" style={{ marginTop: 12 }}>
            <span>Or type exact number / age</span>
            <input
              type="text"
              inputMode="numeric"
              value={answers[qq.id] || ''}
              onChange={(e) => chooseAnswer(qq.id, e.target.value)}
              placeholder="e.g. 25"
            />
          </label>
        )}
        {qq.type === 'choice' && (
          <label className="field" style={{ marginTop: 12 }}>
            <span>Or type your own answer (not listed above)</span>
            <input
              type="text"
              value={(() => {
                const v = answers[qq.id]
                const opts = Array.isArray(qq.options) ? qq.options : []
                return v != null && String(v).trim() !== '' && !opts.includes(String(v))
                  ? String(v)
                  : ''
              })()}
              onChange={(e) => chooseAnswer(qq.id, e.target.value.trim() || '')}
              placeholder="Type a custom answer…"
            />
          </label>
        )}
      </div>
    ) : (
      <label className="field" style={{ marginTop: 10 }}>
        <span>Answer{qq.type === 'age' ? ' (number)' : ''}</span>
        <input
          value={answers[qq.id] || ''}
          inputMode={qq.type === 'age' ? 'numeric' : undefined}
          onChange={(e) => chooseAnswer(qq.id, e.target.value)}
        />
      </label>
    )
  }

  // Title + optional speak prompt + answer body (+ optional per-card Speak-fill).
  function renderQuestionCard(qq, { speakFill = false } = {}) {
    return (
      <>
        <h3 className="qa-title" style={{ textAlign: 'center' }}>{displayQuestion(qq, displayLang)}</h3>
        {qq.speak &&
          String(qq.speak).trim() &&
          String(qq.speak).trim().toLowerCase() !== 'new question' &&
          String(qq.speak).trim() !== String(qq.label || '').trim() && (
            <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 12, textAlign: 'center' }}>
              {qq.speak}
            </p>
          )}
        {renderAnswerBody(qq)}
        {speakFill && (
          <div className="qa-tools">
            {!listening ? (
              <button type="button" className="btn secondary" onClick={() => startSpeechFill(qq)}>
                Speak fill
              </button>
            ) : (
              <button type="button" className="btn danger" onClick={stopSpeechFill}>
                Stop speech
              </button>
            )}
          </div>
        )}
      </>
    )
  }

  // Bottom action row shared by 'next' + 'swipe' (Prev / Next / Finish / Send).
  function renderNavButtons() {
    return (
      <div className="qa-nav">
        <button type="button" className="btn secondary" disabled={activeQ === 0} onClick={goPrev}>
          Prev
        </button>
        {activeQ < questions.length - 1 ? (
          <button type="button" className="btn primary" disabled={saving} onClick={goNext}>
            Next
          </button>
        ) : !editingDraft ? (
          <button
            type="button"
            className="btn primary"
            disabled={saving}
            onClick={() => saveDraft({ autoNext: true })}
          >
            {saving ? 'Saving…' : 'Finish'}
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={saving || !allHardLocks}
            onClick={finishUpload}
          >
            {saving ? 'Saving…' : allHardLocks ? 'Send' : 'Locks incomplete'}
          </button>
        )}
      </div>
    )
  }

  // Editing-a-draft footer tools (Keep as draft / Delete draft).
  function renderDraftTools() {
    if (!editingDraft) return null
    return (
      <div className="qa-tools">
        <button
          type="button"
          className="btn secondary"
          disabled={saving}
          onClick={() => saveDraft({ autoNext: false })}
        >
          Keep as draft
        </button>
        <button
          type="button"
          className="btn secondary danger-cta"
          disabled={saving}
          onClick={removeCurrentDraft}
        >
          Delete draft
        </button>
      </div>
    )
  }

  // 'next' (default) + 'swipe': one question at a time. Swipe adds gesture
  // handlers + a hint and position dots, but keeps the Prev/Next buttons.
  function renderSingleCard({ swipe = false } = {}) {
    return (
      <div
        className={`card qa-card${swipe ? ' qa-swipe' : ''}`}
        onTouchStart={onSwipeStart}
        onTouchEnd={onSwipeEnd}
      >
        <div className="qa-progress">
          <div className="qa-progress-bar" aria-hidden>
            <i style={{ width: `${Math.round(((activeQ + 1) / Math.max(1, questions.length)) * 100)}%` }} />
          </div>
          <span className="qa-progress-n">
            {activeQ + 1} / {questions.length}
          </span>
        </div>
        {renderQuestionCard(q)}
        <div className="qa-tools">
          {!listening ? (
            <button type="button" className="btn secondary" onClick={() => startSpeechFill()}>
              Speak fill
            </button>
          ) : (
            <button type="button" className="btn danger" onClick={stopSpeechFill}>
              Stop speech
            </button>
          )}
        </div>
        {swipe && (
          <div className="qa-swipe-hint" aria-hidden>
            <span className="muted" style={{ fontSize: 11 }}>← swipe →</span>
            <div className="qa-dots">
              {questions.map((_, i) => (
                <span key={i} className={`qa-dot${i === activeQ ? ' on' : ''}`} />
              ))}
            </div>
          </div>
        )}
        {renderNavButtons()}
        {renderDraftTools()}
      </div>
    )
  }

  // 'scroll': every question stacked in one column; one Finish/Send at the end.
  function renderScrollList() {
    return (
      <div className="qa-scroll-list">
        {questions.map((qq, i) => (
          <div className="card qa-card" key={qq.id || i} id={`qa-q-${qq.id}`}>
            <div className="qa-progress-n" style={{ display: 'block', marginBottom: 6 }}>
              {i + 1} / {questions.length}
            </div>
            {renderQuestionCard(qq, { speakFill: true })}
          </div>
        ))}
        <div className="card qa-card">
          <div className="qa-nav">
            {!editingDraft ? (
              <button
                type="button"
                className="btn primary"
                disabled={saving}
                onClick={() => saveDraft({ autoNext: true })}
              >
                {saving ? 'Saving…' : 'Finish'}
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                disabled={saving || !allHardLocks}
                onClick={finishUpload}
              >
                {saving ? 'Saving…' : allHardLocks ? 'Send' : 'Locks incomplete'}
              </button>
            )}
          </div>
          {renderDraftTools()}
        </div>
      </div>
    )
  }

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

  const doneCount = Math.max(
    Number(localDoneCount) || 0,
    Number(progress?.done) || 0,
  )
  const nextRecordNum = Math.max(
    doneCount + 1,
    Number(progress?.next_record) || 0,
  )
  const targetCount = Number(progress?.target) || 0

  const progLabel =
    progress?.label || (progress ? `${doneCount}/${targetCount || '—'}` : '…')

  // Shell pull-to-refresh remounts this screen (collectKey) → useEffect reloads questions
  return (
      <div className={`screen field-collect${step === 2 && voiceActivated ? ' qa-focus' : ''}`}>
        <p className="ptr-hint">↓ Pull down to refresh questions from admin</p>
        <header className="screen-head">
          <h2>
            {surveyChosen || (formMeta?.surveys || []).length <= 1
              ? (formMeta?.title || 'Field survey')
              : 'Choose survey'}
          </h2>
          <p>
            {user?.name || user?.username}
            {surveyChosen || (formMeta?.surveys || []).length <= 1
              ? ` · step ${step + 1}/4 · ${questions.length} Qs`
              : ' · pick a survey first'}
          </p>
        </header>

        {(formMeta?.surveys || []).length > 1 && (
          <div className="card" style={{ marginBottom: 10, padding: 14 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Choose survey</h3>
            <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
              Required — pick which survey this record is for before GPS.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(formMeta.surveys || []).map((s) => {
                const on = surveyChosen && String(s.form_key) === String(formMeta?.form_key)
                return (
                  <button
                    key={s.id || s.form_key}
                    type="button"
                    className={`btn ${on ? 'primary' : 'secondary'}`}
                    style={{ width: '100%', textAlign: 'left', fontWeight: 700 }}
                    onClick={() => {
                      setFormMeta({ ...s, surveys: formMeta.surveys })
                      setQuestions(s.questions || [])
                      const init = {}
                      for (const q of s.questions || []) init[q.id] = ''
                      setAnswers(init)
                      setActiveQ(0)
                      setSurveyChosen(true)
                      setStep(0)
                      setGeo(null)
                      setLocationDetails(null)
                      setPhotoDataUrl('')
                      onToast?.(`Collecting "${s.title}"`, 'ok')
                    }}
                  >
                    {on ? '✓ ' : ''}{s.title}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {!surveyChosen && (formMeta?.surveys || []).length > 1 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            GPS, photo and questions stay locked until you choose a survey.
          </p>
        ) : null}

        {(formMeta?.surveys || []).length === 0 && formMeta ? (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>No survey assigned</h3>
            <p className="muted" style={{ marginBottom: 0 }}>
              Client Admin must assign a survey on your profile. Pull to refresh after they assign.
            </p>
          </div>
        ) : null}

        {surveyChosen || (formMeta?.surveys || []).length === 1 ? (
        <>
        {/* Mock 3 Stepper Flow */}
        <div className="stepper">
          <div className={`step ${locks.geo ? 'done' : 'active'}`}>
            <div className="dot">{locks.geo ? '✓' : '1'}</div>
            <div className="lbl">GPS</div>
          </div>
          <div className={`step ${locks.photo ? 'done' : locks.geo ? 'active' : ''}`}>
            <div className="dot">{locks.photo ? '✓' : '2'}</div>
            <div className="lbl">Photo</div>
          </div>
          <div className={`step ${voiceActivated ? 'done' : (locks.geo && locks.photo) ? 'active' : ''}`}>
            <div className="dot">{voiceActivated ? '✓' : '3'}</div>
            <div className="lbl">{voiceRequired ? 'Voice' : 'Voice (Opt)'}</div>
          </div>
          <div className={`step ${(locks.geo && locks.photo && (!voiceRequired || voiceActivated)) ? 'active' : ''}`}>
            <div className="dot">4</div>
            <div className="lbl">Q/A</div>
          </div>
        </div>

        {/* Mock 3 Lockbar */}
        <div className="lockbar">
          <div className="hd">Locked Requirements (Cannot Skip)</div>
          <div className="lock-pills">
            <div className={`lock-pill ${locks.geo ? 'ok' : 'bad'}`}>
              <span>{locks.geo ? '✓' : '✗'}</span> GPS {locks.geo ? 'LOCKED' : 'OPEN'}
            </div>
            <div className={`lock-pill ${locks.photo ? 'ok' : 'bad'}`}>
              <span>{locks.photo ? '✓' : '✗'}</span> Photo {locks.photo ? 'LOCKED' : 'OPEN'}
            </div>
            <div className={`lock-pill ${voiceActivated ? 'ok' : voiceRequired ? 'bad' : 'ok'}`}>
              <span>{voiceActivated ? '✓' : voiceRequired ? '✗' : '🎙'}</span> Voice {voiceActivated ? 'ON' : voiceRequired ? 'OFF' : 'OPTIONAL'}
            </div>
          </div>
        </div>


        {/* Live quota + device queue */}
        <div className="card quota-card" style={{ marginBottom: 10, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>
              Activity{' '}
              {targetCount > 0
                ? `${Math.min(nextRecordNum, targetCount)} / ${targetCount}`
                : `#${nextRecordNum}`}
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
            <strong>{queueInfo?.failed ?? 0}</strong> failed
          </p>
          {targetCount > 0 && (
            <div
              style={{
                height: 10,
                background: 'rgba(15,23,42,0.08)',
                borderRadius: 99,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.min(
                    100,
                    Math.round((doneCount / targetCount) * 100),
                  )}%`,
                  height: '100%',
                  background: progress?.complete ? '#22c55e' : '#38bdf8',
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              <label
                className={`btn primary ${!locks.geo ? 'disabled' : ''}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  cursor: locks.geo ? 'pointer' : 'not-allowed',
                  opacity: !locks.geo ? 0.6 : 1,
                  textAlign: 'center',
                  position: 'relative',
                  overflow: 'hidden',
                  margin: 0,
                  padding: '12px 16px',
                }}
                onClick={(e) => {
                  if (!locks.geo) {
                    e.preventDefault()
                    onToast?.('Lock GPS first', 'error')
                    setStep(0)
                  }
                }}
              >
                <Icon name="camera" size={18} />
                <span>{locks.photo ? 'Retake photo (Camera)' : 'Take photo (Camera)'}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={!locks.geo}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    opacity: 0,
                    cursor: locks.geo ? 'pointer' : 'not-allowed',
                    zIndex: 2,
                  }}
                  onChange={onPickPhoto}
                />
              </label>

              <label
                className="btn secondary"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  cursor: locks.geo ? 'pointer' : 'not-allowed',
                  opacity: !locks.geo ? 0.6 : 1,
                  textAlign: 'center',
                  position: 'relative',
                  overflow: 'hidden',
                  margin: 0,
                  padding: '10px 16px',
                  fontSize: 13,
                }}
                onClick={(e) => {
                  if (!locks.geo) {
                    e.preventDefault()
                    onToast?.('Lock GPS first', 'error')
                    setStep(0)
                  }
                }}
              >
                <Icon name="image" size={16} />
                <span>Choose from Gallery / Camera</span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={!locks.geo}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    opacity: 0,
                    cursor: locks.geo ? 'pointer' : 'not-allowed',
                    zIndex: 2,
                  }}
                  onChange={onPickPhoto}
                />
              </label>
            </div>
            {photoDataUrl && !editingDraft && (
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
            {photoDataUrl && editingDraft && (
              <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                Photo is saved on this phone — not shown in the queue.
              </p>
            )}
            {locks.photo && (
              <p className="pill ok" style={{ marginTop: 8, display: 'inline-flex' }}>
                <span className="dot" />
                PHOTO LOCKED
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {!editingDraft && (
                <button type="button" className="btn secondary" onClick={() => setStep(0)}>
                  Back
                </button>
              )}
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
                  if (!locks.geo || !locks.photo) {
                    onToast?.('Lock GPS and photo before the survey', 'error')
                    setStep(!locks.geo ? 0 : 1)
                    return
                  }
                  setStep(2)
                  if (voiceRequired && !recording && !voiceActivated) {
                    await startAudio()
                  }
                }}
              >
                {voiceRequired ? 'Continue to voice' : 'Continue to questions'}
              </button>
            </div>
          </div>
        )}

        {/* STEP 2 — VOICE LOCK + Q/A */}
        {step === 2 && (
          <div>
            {voiceRequired && voiceActivated ? (
              <div className="voice-strip">
                {recording ? <span className="live-dot" aria-hidden /> : <span className="pill ok" style={{ margin: 0 }}>Voice on</span>}
                <strong>{recording ? 'Recording interview' : 'Voice locked'}</strong>
                {editingDraft && voiceLocked ? null : recording ? (
                  <button type="button" className="btn secondary" onClick={stopAudio}>
                    Stop
                  </button>
                ) : (
                  <button type="button" className="btn secondary" onClick={startAudio}>
                    Re-record
                  </button>
                )}
              </div>
            ) : voiceRequired ? (
              <div className="card" style={{ marginBottom: 10 }}>
                <h3>3 · Voice activation (required)</h3>
                <p className="muted" style={{ fontSize: 12 }}>
                  Super Admin / Client Admin required interview audio on this survey.
                </p>
                {!locks.geo || !locks.photo ? (
                  <p className="pill bad">
                    <span className="dot" />
                    Complete GPS + photo locks first
                  </p>
                ) : null}
                <button
                  type="button"
                  className="btn primary"
                  style={{ marginTop: 8 }}
                  disabled={!locks.geo || !locks.photo}
                  onClick={startAudio}
                >
                  {audioBlob ? 'Re-activate voice' : 'Activate voice · start recording'}
                </button>
              </div>
            ) : null}

            {!questionsOpen ? (
              <div className="card">
                <p className="muted">
                  {voiceRequired
                    ? 'Questions stay locked until voice is activated.'
                    : 'Lock GPS and photo first.'}
                </p>
                {!editingDraft && (
                  <button type="button" className="btn secondary" onClick={() => setStep(1)}>
                    Back to photo
                  </button>
                )}
              </div>
            ) : (
              <>
                {!q ? (
                  <div className="card" style={{ padding: 20, textAlign: 'center' }}>
                    <p className="muted">Loading survey questions or no questions available for this survey…</p>
                    <button
                      type="button"
                      className="btn small primary"
                      style={{ marginTop: 8 }}
                      onClick={() => loadQuestions({ silent: false })}
                    >
                      🔄 Refresh survey questions
                    </button>
                  </div>
                ) : navMode === 'scroll' ? (
                  renderScrollList()
                ) : (
                  renderSingleCard({ swipe: navMode === 'swipe' })
                )}

                {!questions.length && (
                  <div className="card">
                    <p className="muted">
                      No questions loaded. Assign this surveyor on the survey (Surveys → field team), save questions, then pull to refresh.
                    </p>
                  </div>
                )}

                {!editingDraft && (
                  <button
                    type="button"
                    className="btn secondary qa-back"
                    onClick={() => setStep(1)}
                  >
                    Back to photo
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="card">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{progress?.complete ? <><Icon name="check" size={15} /> Target complete</> : 'Batch paused'}</h3>
            <p>
              {progress?.complete
                ? `You finished ${progress.done} / ${progress.target} activities assigned by admin.`
                : `Saved ${progress?.done ?? '—'} activities.`}
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              Each activity was saved with GPS + photo{voiceRequired ? ' + voice' : ''} locks.
            </p>
            {!progress?.complete && (
              <button type="button" className="btn primary" onClick={resetForNextRecord}>
                Continue next activity
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
        </>
        ) : null}
      </div>
  )
}
