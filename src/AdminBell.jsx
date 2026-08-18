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

/** Docs stay in the inbox until Client Admin verifies that surveyor. */
function isHeldVerify(it) {
  return it?.kind === 'docs' && it?.verified !== true
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
        const byId = new Map(prev.map((p) => [p.id, p]))
        for (const it of list) {
          if (!it?.id) continue
          const old = byId.get(it.id)
          byId.set(it.id, old ? { ...old, ...it } : it)
        }
        const extra = list.filter((it) => it.id && !prev.some((p) => p.id === it.id))
        if (!extra.length && list.every((it) => {
          const old = prev.find((p) => p.id === it.id)
          return old && old.verified === it.verified
        })) {
          return prev
        }
        return [...byId.values()]
          .sort((a, b) => (Number(b.seq) || 0) - (Number(a.seq) || 0))
          .slice(0, 80)
      })
      if (seed && !seeded.current) {
        seeded.current = true
        const ids = list.filter((i) => !isHeldVerify(i)).map((i) => i.id)
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
    const id = setInterval(pull, 12_000)
    return () => {
      dead = true
      clearInterval(id)
    }
  }, [enabled, open, addItems])

  if (!enabled) return null

  const unread = items.filter((i) => isHeldVerify(i) || !seen.includes(i.id))
  const count = unread.length
  const shown = unread.slice(0, 40)
  const clearableCount = unread.filter((i) => !isHeldVerify(i)).length

  const clearAll = () => {
    const heldIds = new Set(items.filter(isHeldVerify).map((i) => i.id))
    if (!clearableCount) return
    const ids = [...new Set([...seen, ...items.map((i) => i.id)])].filter((id) => !heldIds.has(id))
    writeSeen(user?.id, ids)
    setSeen(ids)
    setOpen(false)
  }

  const dismissItem = (e, item) => {
    e.stopPropagation()
    const ids = [...new Set([...seen, item.id])]
    writeSeen(user?.id, ids)
    setSeen(ids)
  }

  const openItem = (it) => {
    setOpen(false)
    const page =
      it?.page === 'users' || it?.kind === 'docs'
        ? 'users'
        : it?.page === 'review' || it?.kind === 'activity'
          ? 'review'
          : it?.page || ''
    onGoPage?.({
      page,
      userId: it?.userId ?? null,
      submissionId: it?.submissionId ?? null,
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
            {clearableCount > 0 && (
              <button type="button" className="link-btn" onClick={clearAll}>
                Clear ({clearableCount})
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
                const pending = isHeldVerify(it)
                return (
                  <li key={it.id} style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                    <button
                      type="button"
                      className={`admin-bell-item${!seen.includes(it.id) ? ' is-new' : ''}`}
                      onClick={() => openItem(it)}
                      style={{ flex: 1, textAlign: 'left' }}
                    >
                      <span className="admin-bell-kind">
                        {it.kind === 'docs' ? (it.verified ? 'ID Verified ✓' : 'ID Pending') : 'Activity'}
                      </span>
                      <span className="admin-bell-title">{it.title}</span>
                      <span className="admin-bell-detail">
                        {pending
                          ? 'Verification pending — complete verification in Users tab to unlock clear'
                          : it.kind === 'docs' && it.verified === true
                            ? 'Verification complete ✓ — clear notification'
                            : it.detail}
                      </span>
                    </button>
                    {!pending && (
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
                          color: '#94a3b8',
                          fontSize: '14px',
                          borderRadius: '4px',
                        }}
                      >
                        ✕
                      </button>
                    )}
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
