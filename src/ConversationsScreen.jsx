import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icons'
import {
  conversationAudioPath,
  deleteConversation as deleteServerConversation,
  fetchMediaBlobUrl,
  getConversationConfig,
} from './api'
import {
  deleteConversationLocal,
  listConversationsLocal,
  saveConversationLocal,
  updateConversationLocal,
} from './conversationStore'
import {
  onConversationSync,
  triggerConversationSync,
} from './conversationSync'
import {
  blobToDataUrl,
  pickAudioRecorderOptions,
  toSpeechWav16k,
} from './mediaOptimize'
import {
  backgroundRecordingAvailable,
  backgroundRecordingStatus,
  startBackgroundRecording,
  stopBackgroundRecording,
} from './converseRecorder'

const DEFAULT_MAX_SECONDS = 600
const MIN_RECORDING_MS = 1200

function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms || 0) / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatWhen(value) {
  const d = new Date(value || '')
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d)
  } catch {
    return d.toLocaleString()
  }
}

function conversationTitle(now = new Date()) {
  return `Conversation · ${formatWhen(now.toISOString())}`
}

function statusOf(c) {
  if (c.transcriptStatus === 'completed') {
    return c.transcript
      ? { label: 'English ready', tone: 'ok' }
      : { label: 'No speech detected', tone: 'warn' }
  }
  if (c.transcriptStatus === 'error') {
    return { label: 'Translation failed', tone: 'bad' }
  }
  if (!c.serverId) {
    return { label: 'On phone · waiting for internet', tone: 'warn' }
  }
  if (c.status === 'uploading') {
    return { label: 'Uploading…', tone: 'warn' }
  }
  return { label: 'Translating to English…', tone: 'warn' }
}

/**
 * Offline conversation recorder.
 *
 * Audio is written to the phone as soon as recording stops. The English
 * translation and server upload happen later, in the background, as soon as a
 * usable connection exists. This tab stays mounted while hidden so a recording
 * is not interrupted by switching tabs.
 */
export default function ConversationsScreen({ user, active, onToast }) {
  const [config, setConfig] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [recording, setRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [expandedId, setExpandedId] = useState(null)
  const [audioUrls, setAudioUrls] = useState({})
  const [syncing, setSyncing] = useState(false)

  const mediaRec = useRef(null)
  const chunks = useRef([])
  const streamRef = useRef(null)
  const startedAt = useRef(0)
  const tickRef = useRef(null)
  const maxTimerRef = useRef(null)
  const recorderEnded = useRef(false)
  const mountedRef = useRef(true)
  const audioUrlsRef = useRef({})
  const userRef = useRef(user)
  userRef.current = user

  const maxSeconds = Number(config?.max_duration_sec) > 0
    ? Number(config.max_duration_sec)
    : DEFAULT_MAX_SECONDS

  const refresh = useCallback(async () => {
    try {
      const rows = await listConversationsLocal()
      const uid = userRef.current?.id
      // A shared phone must not show one surveyor's notes to the next login.
      const mine =
        uid != null
          ? rows.filter(
              (c) => c.userId == null || String(c.userId) === String(uid),
            )
          : rows
      if (mountedRef.current) setItems(mine)
    } catch (e) {
      console.warn('[conversations] list failed', e)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  const stopTracks = useCallback(() => {
    try {
      streamRef.current?.getTracks?.().forEach((t) => t.stop())
    } catch {
      /* ignore */
    }
    streamRef.current = null
  }, [])

  const nativeRecorder = backgroundRecordingAvailable()
  const recordingRef = useRef(false)
  recordingRef.current = recording
  const savingRef = useRef(false)

  const persistRecording = useCallback(
    async ({ audioDataUrl, audioMime, durationMs }) => {
      if (savingRef.current) return
      savingRef.current = true
      if (mountedRef.current) setSaving(true)
      try {
        const who = userRef.current
        await saveConversationLocal({
          userId: who?.id ?? null,
          userName: who?.name || who?.username || '',
          title: conversationTitle(),
          recordedAt: new Date().toISOString(),
          durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
          audioDataUrl,
          audioMime: audioMime || 'audio/webm',
          transcriptStatus: 'queued',
          status: 'local',
          attempts: 0,
          nextAttemptAt: 0,
          lastError: '',
        })
        await refresh()
        onToast?.('Saved on phone · English translation starts when online', 'ok')
        void triggerConversationSync().finally(() => {
          if (mountedRef.current) setSyncing(false)
        })
      } catch (e) {
        onToast?.(e.message || 'Could not save the recording', 'error')
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [onToast, refresh],
  )

  const syncNativeRecording = useCallback(async () => {
    if (!nativeRecorder) return
    try {
      const st = await backgroundRecordingStatus()
      if (!st) return
      if (st.recording) {
        if (!recordingRef.current) {
          startedAt.current = Number(st.startedAt) || Date.now()
          if (mountedRef.current) {
            setRecording(true)
            setElapsedMs(Date.now() - startedAt.current)
          }
          clearInterval(tickRef.current)
          tickRef.current = setInterval(() => {
            if (mountedRef.current) setElapsedMs(Date.now() - startedAt.current)
          }, 250)
        }
        return
      }
      if (!recordingRef.current) return
      // The native service reached its limit while the app was backgrounded.
      clearInterval(tickRef.current)
      tickRef.current = null
      clearTimeout(maxTimerRef.current)
      maxTimerRef.current = null
      if (mountedRef.current) {
        setRecording(false)
        setElapsedMs(0)
      }
      const res = await stopBackgroundRecording()
      if (res?.base64 && Number(res.size || 0) >= 800) {
        await persistRecording({
          audioDataUrl: `data:${res.mime || 'audio/mp4'};base64,${res.base64}`,
          audioMime: res.mime || 'audio/mp4',
          durationMs: Number(res.durationMs) || 0,
        })
      }
    } catch {
      /* ignore — the recording stays on the phone */
    }
  }, [nativeRecorder, persistRecording])

  const stopRecording = useCallback(async () => {
    clearInterval(tickRef.current)
    tickRef.current = null
    clearTimeout(maxTimerRef.current)
    maxTimerRef.current = null

    if (nativeRecorder) {
      if (!recordingRef.current) return
      const elapsed = Math.max(0, Date.now() - startedAt.current)
      if (mountedRef.current) {
        setRecording(false)
        setElapsedMs(0)
      }
      try {
        const res = await stopBackgroundRecording()
        const durationMs = Number(res?.durationMs) || elapsed
        if (
          !res?.base64 ||
          Number(res.size || 0) < 800 ||
          durationMs < MIN_RECORDING_MS
        ) {
          onToast?.('Recording too short — hold the mic a little longer', 'error')
          return
        }
        await persistRecording({
          audioDataUrl: `data:${res.mime || 'audio/mp4'};base64,${res.base64}`,
          audioMime: res.mime || 'audio/mp4',
          durationMs,
        })
      } catch (e) {
        onToast?.(e.message || 'Could not finish the recording', 'error')
      }
      return
    }

    const rec = mediaRec.current
    if (!rec) return
    try {
      if (rec.state !== 'inactive') rec.stop()
    } catch {
      /* ignore */
    }
  }, [nativeRecorder, onToast, persistRecording])

  const startRecording = useCallback(async () => {
    if (recordingRef.current || savingRef.current) return

    if (nativeRecorder) {
      try {
        await startBackgroundRecording({ maxSeconds })
        startedAt.current = Date.now()
        setRecording(true)
        setElapsedMs(0)
        clearInterval(tickRef.current)
        tickRef.current = setInterval(() => {
          if (mountedRef.current) setElapsedMs(Date.now() - startedAt.current)
        }, 250)
        maxTimerRef.current = setTimeout(() => {
          if (recordingRef.current) {
            onToast?.(
              `Stopped at the ${Math.round(maxSeconds / 60)} minute limit`,
              'ok',
            )
            void stopRecording()
          }
        }, Math.max(5, maxSeconds) * 1000)
        onToast?.('Recording continues in the background', 'ok')
      } catch (e) {
        onToast?.(e.message || 'Microphone permission is required', 'error')
      }
      return
    }

    if (typeof MediaRecorder === 'undefined') {
      onToast?.('This device does not support audio recording', 'error')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      onToast?.('Microphone is not available in this browser', 'error')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 16000 },
        },
      })
      streamRef.current = stream
      chunks.current = []
      recorderEnded.current = false

      const opts = pickAudioRecorderOptions()
      // 16 kbps keeps a 10-minute conversation under the server's 2 MB cap.
      const rec = opts.mimeType
        ? new MediaRecorder(stream, { ...opts, audioBitsPerSecond: 16000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 16000 })
      mediaRec.current = rec
      rec.ondataavailable = (ev) => {
        if (ev.data?.size) chunks.current.push(ev.data)
      }
      rec.onerror = () => {
        onToast?.('Recording failed on this device', 'error')
      }
      rec.onstop = async () => {
        if (recorderEnded.current) return
        recorderEnded.current = true
        const durationMs = Math.max(0, Date.now() - startedAt.current)
        stopTracks()
        setRecording(false)
        setElapsedMs(0)
        clearInterval(tickRef.current)
        tickRef.current = null
        const raw = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
        chunks.current = []
        mediaRec.current = null
        if (raw.size < 800 || durationMs < MIN_RECORDING_MS) {
          onToast?.('Recording too short — hold the mic a little longer', 'error')
          return
        }
        const blob = await toSpeechWav16k(raw)
        const audioDataUrl = await blobToDataUrl(blob)
        await persistRecording({
          audioDataUrl,
          audioMime: blob.type || 'audio/webm',
          durationMs,
        })
      }

      rec.start(1000)
      startedAt.current = Date.now()
      setRecording(true)
      setElapsedMs(0)
      tickRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAt.current)
      }, 250)
      maxTimerRef.current = setTimeout(() => {
        if (rec.state !== 'inactive') {
          onToast?.(`Stopped at the ${Math.round(maxSeconds / 60)} minute limit`, 'ok')
          void stopRecording()
        }
      }, Math.max(5, maxSeconds) * 1000)
    } catch (e) {
      stopTracks()
      setRecording(false)
      onToast?.(e.message || 'Microphone permission is required', 'error')
    }
  }, [maxSeconds, nativeRecorder, onToast, persistRecording, stopRecording, stopTracks])

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    getConversationConfig()
      .then((cfg) => {
        if (mountedRef.current) setConfig(cfg || null)
      })
      .catch(() => {
        // Offline is expected in the field — recording still works locally.
        if (mountedRef.current) setConfig((prev) => prev || { enabled: false, offline: true })
      })
    const off = onConversationSync(() => {
      void refresh()
    })
    return () => {
      mountedRef.current = false
      off()
    }
  }, [refresh])

  useEffect(() => {
    if (!active) return
    void refresh()
    setSyncing(true)
    void triggerConversationSync().finally(() => {
      if (mountedRef.current) setSyncing(false)
    })
  }, [active, refresh])

  useEffect(() => {
    if (!active || !nativeRecorder) return
    void syncNativeRecording()
  }, [active, nativeRecorder, syncNativeRecording])

  useEffect(() => {
    if (!nativeRecorder) return undefined
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncNativeRecording()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [nativeRecorder, syncNativeRecording])

  useEffect(() => {
    audioUrlsRef.current = audioUrls
  }, [audioUrls])

  useEffect(() => {
    return () => {
      // A native recording can outlive this screen; save it rather than lose it.
      if (nativeRecorder && recordingRef.current) {
        void stopBackgroundRecording()
          .then((res) => {
            if (!res?.base64 || Number(res.size || 0) < 800) return null
            const who = userRef.current
            return saveConversationLocal({
              userId: who?.id ?? null,
              userName: who?.name || who?.username || '',
              title: conversationTitle(),
              recordedAt: new Date().toISOString(),
              durationMs: Number(res.durationMs) || 0,
              audioDataUrl: `data:${res.mime || 'audio/mp4'};base64,${res.base64}`,
              audioMime: res.mime || 'audio/mp4',
              transcriptStatus: 'queued',
              status: 'local',
            })
          })
          .catch(() => null)
      }
      // Keep the UI consistent if the component is ever unmounted mid-recording.
      try {
        if (mediaRec.current?.state !== 'inactive') mediaRec.current?.stop()
      } catch {
        /* ignore */
      }
      stopTracks()
      clearInterval(tickRef.current)
      clearTimeout(maxTimerRef.current)
      Object.values(audioUrlsRef.current).forEach((url) => {
        try {
          if (url && url.startsWith('blob:')) URL.revokeObjectURL(url)
        } catch {
          /* ignore */
        }
      })
    }
  }, [stopTracks])

  const counts = useMemo(() => {
    let waiting = 0
    let translating = 0
    let ready = 0
    for (const c of items) {
      if (c.transcriptStatus === 'completed') ready += 1
      else if (!c.serverId || c.transcriptStatus === 'error') waiting += 1
      else translating += 1
    }
    return { waiting, translating, ready }
  }, [items])

  async function toggleExpand(c) {
    setExpandedId((id) => (id === c.id ? null : c.id))
    if (!c.audioDataUrl && c.serverId && !audioUrls[c.id]) {
      try {
        const url = await fetchMediaBlobUrl(conversationAudioPath(c.serverId))
        if (url) setAudioUrls((prev) => ({ ...prev, [c.id]: url }))
      } catch {
        onToast?.('Could not load the server audio copy', 'error')
      }
    }
  }

  async function retry(c) {
    await updateConversationLocal(c.id, {
      attempts: 0,
      nextAttemptAt: 0,
      lastError: '',
      transcriptStatus: c.serverId ? 'stored' : 'queued',
      status: c.serverId ? 'sent' : 'local',
    })
    await refresh()
    setSyncing(true)
    void triggerConversationSync().finally(() => {
      if (mountedRef.current) setSyncing(false)
    })
  }

  async function remove(c) {
    if (!window.confirm('Delete this conversation and its audio? This cannot be undone.')) {
      return
    }
    if (c.serverId) {
      await deleteServerConversation(c.serverId).catch(() => null)
    }
    await deleteConversationLocal(c.id)
    const url = audioUrls[c.id]
    if (url?.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url)
      } catch {
        /* ignore */
      }
    }
    setAudioUrls((prev) => {
      const next = { ...prev }
      delete next[c.id]
      return next
    })
    await refresh()
    onToast?.('Conversation deleted', 'ok')
  }

  async function copyTranscript(text) {
    try {
      await navigator.clipboard.writeText(text)
      onToast?.('English text copied', 'ok')
    } catch {
      onToast?.('Could not copy — long-press the text instead', 'error')
    }
  }

  const translationOff = config && config.enabled === false && !config.offline

  return (
    <div className="screen conversations-screen" style={{ paddingBottom: 96 }}>
      <div className="screen-toolbar">
        <h2 style={{ margin: 0 }}>Converse</h2>
        <span className="muted" style={{ fontSize: 12 }}>
          {counts.waiting + counts.translating + counts.ready} saved
        </span>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Record a conversation on this phone. Audio stays on the device until there is
          internet, then it is uploaded once and translated to English on the server.
          You do not need a connection during the interview.
        </p>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '6px 0 2px',
          }}
        >
          <button
            type="button"
            className={`btn ${recording ? 'danger' : 'primary'}`}
            aria-label={recording ? 'Stop and save recording' : 'Start recording conversation'}
            disabled={saving}
            onClick={recording ? stopRecording : startRecording}
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: recording ? '0 0 0 8px rgba(220,38,38,0.12)' : '0 6px 18px rgba(37,99,235,0.22)',
            }}
          >
            <Icon name={recording ? 'cross' : 'mic'} size={30} />
          </button>
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: 'block', fontSize: 16 }}>
              {recording
                ? 'Recording conversation…'
                : saving
                  ? 'Saving on phone…'
                  : 'Record a conversation'}
            </strong>
            <span
              className="muted"
              style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}
              aria-live="polite"
            >
              {recording
                ? `${formatDuration(elapsedMs)} / ${formatDuration(maxSeconds * 1000)} · tap to stop`
                : `Up to ${Math.round(maxSeconds / 60)} minutes · saved offline first`}
            </span>
          </div>
        </div>

        {translationOff ? (
          <p className="pill bad" style={{ marginTop: 10 }}>
            <span className="dot" />
            Server translation is off (Soniox key missing). Recordings stay on this phone.
          </p>
        ) : (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Telugu speech is translated to English. Mixed English answers are kept as spoken.
          </p>
        )}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          {nativeRecorder
            ? 'Background recording is on — you can minimize the app or lock the screen.'
            : 'Keep this screen open while recording. Background recording needs the Android app.'}
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        {counts.waiting > 0 && (
          <span className="pill warn" style={{ margin: 0 }}>
            {counts.waiting} waiting
          </span>
        )}
        {counts.translating > 0 && (
          <span className="pill warn" style={{ margin: 0 }}>
            {counts.translating} translating
          </span>
        )}
        {counts.ready > 0 && (
          <span className="pill ok" style={{ margin: 0 }}>
            {counts.ready} English ready
          </span>
        )}
        <button
          type="button"
          className="btn small secondary"
          style={{ marginLeft: 'auto' }}
          disabled={syncing}
          onClick={() => {
            setSyncing(true)
            void triggerConversationSync().finally(() => {
              if (mountedRef.current) setSyncing(false)
            })
          }}
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {loading ? (
        <p className="muted">Loading voice notes…</p>
      ) : items.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 24 }}>
          <Icon name="mic" size={28} style={{ opacity: 0.4 }} />
          <p className="muted" style={{ marginBottom: 0 }}>
            No conversations yet. Tap the mic to record one.
          </p>
        </div>
      ) : (
        <ul className="user-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((c) => {
            const status = statusOf(c)
            const open = expandedId === c.id
            const audioSrc = c.audioDataUrl || audioUrls[c.id] || ''
            return (
              <li key={c.id} className="card" style={{ marginBottom: 10, padding: 12 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong style={{ display: 'block', fontSize: 14 }}>
                      {c.title || 'Voice conversation'}
                    </strong>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {formatWhen(c.recordedAt)} · {formatDuration(c.durationMs)}
                      {c.transcriptStatus === 'completed' ? ' · saved on server' : ''}
                    </span>
                  </div>
                  <span className={`pill ${status.tone}`} style={{ margin: 0 }}>
                    {status.label}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  <button type="button" className="btn small" onClick={() => void toggleExpand(c)}>
                    {open ? 'Hide' : 'Open'}
                  </button>
                  {c.transcriptStatus === 'error' && (
                    <button type="button" className="btn small secondary" onClick={() => void retry(c)}>
                      Retry
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn small danger"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => void remove(c)}
                  >
                    Delete
                  </button>
                </div>

                {open && (
                  <div style={{ marginTop: 10 }}>
                    {audioSrc ? (
                      <audio controls preload="metadata" src={audioSrc} style={{ width: '100%' }} />
                    ) : (
                      <p className="muted" style={{ fontSize: 12 }}>
                        {c.serverId ? 'Loading audio…' : 'Audio is stored on this phone.'}
                      </p>
                    )}

                    <div
                      style={{
                        marginTop: 10,
                        padding: 10,
                        borderRadius: 8,
                        border: '1px solid #e2e8f0',
                        background: '#f8fafc',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <span className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
                          ENGLISH TRANSLATION
                        </span>
                        {c.transcript ? (
                          <button
                            type="button"
                            className="btn small"
                            style={{ padding: '2px 8px', fontSize: 11 }}
                            onClick={() => void copyTranscript(c.transcript)}
                          >
                            Copy
                          </button>
                        ) : null}
                      </div>
                      {c.transcript ? (
                        <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                          {c.transcript}
                        </p>
                      ) : (
                        <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                          {c.transcriptStatus === 'error'
                            ? c.lastError || 'Translation failed. Tap Retry when online.'
                            : c.transcriptStatus === 'completed'
                              ? 'No English speech was detected in this recording.'
                              : c.serverId
                                ? 'Translation is running. It will appear here automatically.'
                                : 'Waiting for internet. The recording is safe on this phone.'}
                        </p>
                      )}
                    </div>

                    {c.transcriptOriginal && c.transcriptOriginal !== c.transcript && (
                      <details style={{ marginTop: 8 }}>
                        <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>
                          Original speech text
                        </summary>
                        <p style={{ margin: '6px 0 0', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                          {c.transcriptOriginal}
                        </p>
                      </details>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
