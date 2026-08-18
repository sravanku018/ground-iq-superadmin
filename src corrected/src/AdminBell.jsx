import { useCallback, useEffect, useRef, useState } from 'react'
import { listNotifications, notificationsStreamUrl } from './api'

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

function writeDismissed(adminId, ids) {
  try {
    localStorage.setItem(dismissedKey(adminId), JSON.stringify({ ids, at: Date.now() }))
  } catch {
    /* ignore */
  }
}

/** Docs stay in the inbox until Client Admin (user.role === 'admin') verifies that surveyor. */
function isHeldVerify(it, user) {
  const isClientAdmin = user?.role === 'admin'
  return isClientAdmin && it?.kind === 'docs' && it?.verified !== true
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
    let es = null
    let dead = false
    ;(async () => {
      try {
        const d = await listNotifications(0)
        if (dead) return
        addItems(d.items || [])
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
    const id = setInterval(pull, 8_000)
    return () => {
      dead = true
      clearInterval(id)
    }
  }, [enabled, open, addItems])

  if (!enabled) return null

  // Filter out items explicitly dismissed by user
  const activeItems = items.filter((i) => !dismissed.includes(i.id))
  const count = activeItems.length
  const shown = activeItems.slice(0, 40)

  // Clearable items are active items that are NOT held pending verification
  const clearableItems = activeItems.filter((i) => !isHeldVerify(i, user))
  const clearableCount = clearableItems.length

  const clearAll = () => {
    if (!clearableCount) return
    const newDismissed = [...new Set([...dismissed, ...clearableItems.map((i) => i.id)])]
    writeDismissed(user?.id, newDismissed)
    setDismissed(newDismissed)
  }

  const dismissItem = (e, item) => {
    e.stopPropagation()
    const newDismissed = [...new Set([...dismissed, item.id])]
    writeDismissed(user?.id, newDismissed)
    setDismissed(newDismissed)
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
                Clear All ({clearableCount})
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
                const pending = isHeldVerify(it, user)
                const isVerified = it.kind === 'docs' && it.verified === true
                return (
                  <li key={it.id} style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                    <button
                      type="button"
                      className={`admin-bell-item${isVerified ? ' is-verified' : ''}`}
                      onClick={() => openItem(it)}
                      style={{ flex: 1, textAlign: 'left' }}
                    >
                      <span className="admin-bell-kind" style={{ color: isVerified ? '#059669' : undefined }}>
                        {it.kind === 'docs' ? (isVerified ? 'ID Verified ✓' : 'ID Pending ⏳') : 'Activity'}
                      </span>
                      <span className="admin-bell-title">{it.title}</span>
                      <span className="admin-bell-detail">
                        {pending
                          ? 'Verification pending — complete verification in Users tab'
                          : isVerified
                            ? 'Verification complete ✓ — click Clear to dismiss'
                            : it.detail}
                      </span>
                    </button>
                    {!pending ? (
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
                          color: '#059669',
                          fontWeight: 'bold',
                          fontSize: '14px',
                          borderRadius: '4px',
                        }}
                      >
                        ✕
                      </button>
                    ) : (
                      <span
                        title="Complete verification in Users tab to unlock clear"
                        style={{ padding: '6px 10px', color: '#94a3b8', fontSize: '12px' }}
                      >
                        🔒
                      </span>
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
