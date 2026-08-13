import { useCallback, useEffect, useRef, useState } from 'react'
import { listNotifications, notificationsStreamUrl } from './api'

function seenKey(adminId) {
  return `esurvey_bell_${adminId || 'admin'}`
}

function readSeen(adminId) {
  try {
    const raw = localStorage.getItem(seenKey(adminId))
    if (!raw) return null
    const p = JSON.parse(raw)
    return Array.isArray(p?.ids) ? p.ids : null
  } catch {
    return null
  }
}

function writeSeen(adminId, ids) {
  try {
    localStorage.setItem(seenKey(adminId), JSON.stringify({ ids, at: Date.now() }))
  } catch {
    /* ignore */
  }
}

export default function AdminBell({ user, onGoPage, enabled = true }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [seen, setSeen] = useState(() => readSeen(user?.id) || [])
  const seeded = useRef(!!readSeen(user?.id))
  const maxSeq = useRef(0)

  const addItems = useCallback(
    (incoming, { seed = false } = {}) => {
      const list = Array.isArray(incoming) ? incoming : []
      if (!list.length) return
      for (const it of list) {
        const seq = Number(it.seq) || 0
        if (seq > maxSeq.current) maxSeq.current = seq
      }
      setItems((prev) => {
        const have = new Set(prev.map((p) => p.id))
        const extra = list.filter((it) => it.id && !have.has(it.id))
        return extra.length ? [...extra, ...prev].slice(0, 80) : prev
      })
      if (seed && !seeded.current) {
        seeded.current = true
        const ids = list.map((i) => i.id)
        writeSeen(user?.id, ids)
        setSeen(ids)
      }
    },
    [user?.id],
  )

  useEffect(() => {
    if (!enabled) return undefined
    let es = null
    let dead = false
    ;(async () => {
      try {
        const d = await listNotifications(0)
        if (dead) return
        addItems(d.items || [], { seed: true })
      } catch {
        /* ignore */
      }
      if (dead) return
      try {
        es = new EventSource(notificationsStreamUrl(maxSeq.current))
        es.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data)
            if (msg?.type === 'item' && msg.item) addItems([msg.item])
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* EventSource unavailable */
      }
    })()
    return () => {
      dead = true
      try {
        es?.close()
      } catch {
        /* ignore */
      }
    }
  }, [enabled, addItems])

  if (!enabled) return null

  const unread = items.filter((i) => !seen.includes(i.id))
  const count = unread.length
  const shown = items.slice(0, 40)

  const markAll = () => {
    const ids = items.map((i) => i.id)
    writeSeen(user?.id, ids)
    setSeen(ids)
  }

  const openItem = (it) => {
    const ids = seen.includes(it.id) ? seen : [...seen, it.id]
    writeSeen(user?.id, ids)
    setSeen(ids)
    setOpen(false)
    onGoPage?.(it)
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
              <button type="button" className="link-btn" onClick={markAll}>
                Mark read
              </button>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="muted" style={{ margin: 0, padding: '10px 12px', fontSize: 13 }}>
              No verification uploads or new activity yet.
            </p>
          ) : (
            <ul className="admin-bell-list">
              {shown.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    className={`admin-bell-item${!seen.includes(it.id) ? ' is-new' : ''}`}
                    onClick={() => openItem(it)}
                  >
                    <span className="admin-bell-kind">
                      {it.kind === 'docs' ? 'ID' : 'Activity'}
                    </span>
                    <span className="admin-bell-title">{it.title}</span>
                    <span className="admin-bell-detail">{it.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
