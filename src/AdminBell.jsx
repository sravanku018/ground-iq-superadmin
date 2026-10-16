import { useCallback, useEffect, useRef, useState } from 'react'
import { listNotifications, notificationsStreamUrl, authHeaders } from './api'

function dismissedKey(adminId) {
  return `esurvey_bell_dismissed_${adminId || 'admin'}`
}

function readDismissed(adminId) {
  try {
    const raw = localStorage.getItem(dismissedKey(adminId))
    if (!raw) return []
    const p = JSON.parse(raw)
    return Array.isArray(p?.ids) ? p.ids : []
  } catch {
    return []
  }
}

const DISMISSED_CAP = 200

/** Keep only the most recent dismissed IDs. Returns the capped list so state matches storage. */
function writeDismissed(adminId, ids) {
  const capped = ids.slice(-DISMISSED_CAP)
  try {
    localStorage.setItem(dismissedKey(adminId), JSON.stringify({ ids: capped, at: Date.now() }))
  } catch {
    /* ignore */
  }
  return capped
}

export default function AdminBell({ user, onGoPage, enabled = true }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [dismissed, setDismissed] = useState(() => readDismissed(user?.id))
  const maxSeq = useRef(0)

  const addItems = useCallback((incoming) => {
    const list = Array.isArray(incoming) ? incoming : []
    if (!list.length) return
    for (const it of list) {
      const seq = Number(it.seq) || 0
      if (seq > maxSeq.current) maxSeq.current = seq
    }
    setItems((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]))
      for (const it of list) {
        if (!it?.id) continue
        const old = byId.get(it.id)
        byId.set(it.id, old ? { ...old, ...it } : it)
      }
      return [...byId.values()]
        .sort((a, b) => (Number(b.seq) || 0) - (Number(a.seq) || 0))
        .slice(0, 80)
    })
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    let dead = false
    let controller = null
    let retries = 0
    let retryTimer = 0

    const consume = (chunk) => {
      const line = chunk.split('\n').find((l) => l.startsWith('data:'))
      if (!line) return
      try {
        const msg = JSON.parse(line.slice(5).trim())
        if (msg?.type === 'item' && msg.item) addItems([msg.item])
      } catch {
        /* ignore malformed frame */
      }
    }

    const connect = async () => {
      try {
        const d = await listNotifications(0)
        if (dead) return
        addItems(d.items || [])
      } catch {
        /* ignore */
      }
      if (dead) return
      // The API only accepts the token via header, so EventSource can't be used
      // (it cannot set Authorization). Stream the SSE body with fetch() instead.
      let status = 0
      try {
        controller = new AbortController()
        const res = await fetch(notificationsStreamUrl(maxSeq.current), {
          headers: authHeaders(),
          cache: 'no-store',
          signal: controller.signal,
        })
        status = res.status
        if (dead) return
        if (res.ok && res.body) {
          retries = 0
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buf = ''
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            let idx
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              consume(buf.slice(0, idx))
              buf = buf.slice(idx + 2)
            }
          }
        }
      } catch {
        /* aborted or network error — fall through to retry */
      }
      if (dead) return
      // 401/403 means the session is gone — stop instead of hammering the API.
      if (status === 401 || status === 403) return
      retries += 1
      retryTimer = window.setTimeout(() => {
        if (!dead) void connect()
      }, Math.min(30_000, 2_000 * retries))
    }

    void connect()

    return () => {
      dead = true
      window.clearTimeout(retryTimer)
      try {
        controller?.abort()
      } catch {
        /* ignore */
      }
    }
  }, [enabled, addItems])

  useEffect(() => {
    if (!enabled || !open) return undefined
    let dead = false
    const pull = async () => {
      try {
        const d = await listNotifications(0)
        if (!dead) addItems(d.items || [])
      } catch {
        /* ignore */
      }
    }
    void pull()
    const id = setInterval(pull, 8_000)
    return () => {
      dead = true
      clearInterval(id)
    }
  }, [enabled, open, addItems])

  if (!enabled) return null

  // Active items not dismissed by user
  const activeItems = items.filter((i) => !dismissed.includes(i.id))
  const count = activeItems.length
  const shown = activeItems.slice(0, 40)

  const clearAll = () => {
    if (!count) return
    const newDismissed = [...new Set([...dismissed, ...activeItems.map((i) => i.id)])]
    setDismissed(writeDismissed(user?.id, newDismissed))
  }

  const dismissItem = (e, item) => {
    e.stopPropagation()
    const newDismissed = [...new Set([...dismissed, item.id])]
    setDismissed(writeDismissed(user?.id, newDismissed))
  }

  const openItem = (it) => {
    setOpen(false)
    const page =
      it?.page === 'users' || it?.kind === 'docs'
        ? 'users'
        : it?.kind === 'web' || it?.page === 'web' || it?.page === 'review' || it?.kind === 'activity'
          ? 'review'
          : it?.page || ''
    onGoPage?.({
      page,
      userId: it?.userId ?? null,
      submissionId: it?.submissionId ?? null,
      source: it?.kind === 'web' || it?.source === 'web' ? 'web' : it?.source || null,
      formKey: it?.formKey || it?.form_key || null,
    })
  }

  return (
    <div className="admin-bell">
      <button
        type="button"
        className="admin-bell-btn"
        aria-label={count ? `${count} notifications` : 'Notifications'}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden>🔔</span>
        {count > 0 && <span className="admin-bell-dot">{count > 9 ? '9+' : count}</span>}
      </button>
      {open && (
        <div className="admin-bell-panel" role="dialog" aria-label="Notifications">
          <div className="admin-bell-head">
            <strong>Notifications</strong>
            {count > 0 && (
              <button type="button" className="link-btn" onClick={clearAll}>
                Clear All
              </button>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="muted" style={{ margin: 0, padding: '10px 12px', fontSize: 13 }}>
              No new notifications.
            </p>
          ) : (
            <ul className="admin-bell-list">
              {shown.map((it) => {
                const isDocs = it.kind === 'docs'
                const isWeb = it.kind === 'web'
                const isVerified = isDocs && it.verified === true
                return (
                  <li key={it.id} style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                    <button
                      type="button"
                      className={`admin-bell-item${isVerified ? ' is-verified' : ''}`}
                      onClick={() => openItem(it)}
                      style={{ flex: 1, textAlign: 'left' }}
                    >
                      <span className="admin-bell-kind" style={{ color: isVerified ? '#4f7dc6' : isWeb ? '#1d4ed8' : isDocs ? '#d97706' : undefined }}>
                        {isWeb ? 'Web survey' : isDocs ? (isVerified ? 'ID Verified ✓' : 'ID Pending ⏳') : 'Activity'}
                      </span>
                      <span className="admin-bell-title">{it.title}</span>
                      <span className="admin-bell-detail">
                        {isDocs
                          ? isVerified
                            ? 'Verification complete ✓'
                            : 'Verification pending (click to open Users tab)'
                          : isWeb
                            ? `${it.detail || 'Web respondent'} · pending · open Review QA (Web survey)`
                            : it.detail}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="admin-bell-dismiss"
                      title="Clear notification"
                      aria-label="Clear notification"
                      onClick={(e) => dismissItem(e, it)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '6px 10px',
                        color: '#64748b',
                        fontSize: '14px',
                        borderRadius: '4px',
                      }}
                    >
                      ✕
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
