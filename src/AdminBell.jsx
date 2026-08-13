import { useCallback, useEffect, useRef, useState } from 'react'
import { listSubmissions, listSurveys, listUsers } from './api'

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

function buildItems({ users, surveys, submissions }) {
  const items = []
  for (const u of users || []) {
    if (u.role !== 'surveyor' && u.role !== 'field') continue
    const bits = []
    if (u.photo) bits.push('photo')
    if (u.aadhaar_front) bits.push('Aadhaar front')
    if (u.aadhaar_back) bits.push('Aadhaar back')
    if (bits.length && !u.verified) {
      items.push({
        id: `docs-${u.id}`,
        kind: 'docs',
        page: 'users',
        title: `@${u.username} uploaded verification docs`,
        detail: bits.join(' · '),
      })
    }
  }
  for (const s of surveys || []) {
    items.push({
      id: `survey-${s.id}`,
      kind: 'survey',
      page: 'surveys',
      title: `Survey · ${s.title || s.form_key || s.id}`,
      detail: 'Ready to assign or collect',
    })
  }
  for (const it of submissions || []) {
    const st = it.status || 'pending'
    if (st !== 'pending') continue
    items.push({
      id: `sub-${it.id}`,
      kind: 'activity',
      page: 'review',
      title: `New activity #${it.id}`,
      detail: it.submitted_by || 'surveyor',
    })
  }
  return items
}

export default function AdminBell({ user, onGoPage, enabled = true }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [seen, setSeen] = useState(() => readSeen(user?.id) || [])
  const seeded = useRef(!!readSeen(user?.id))

  const load = useCallback(async () => {
    if (!enabled) return
    try {
      const [u, s, sub] = await Promise.all([
        listUsers().catch(() => ({ users: [] })),
        listSurveys().catch(() => ({ surveys: [] })),
        listSubmissions(80, 'pending').catch(() => ({ items: [] })),
      ])
      const next = buildItems({
        users: u.users || [],
        surveys: s.surveys || s.items || [],
        submissions: sub.items || [],
      })
      setItems(next)
      if (!seeded.current) {
        seeded.current = true
        const ids = next.map((i) => i.id)
        writeSeen(user?.id, ids)
        setSeen(ids)
      }
    } catch {
      /* ignore */
    }
  }, [enabled, user?.id])

  useEffect(() => {
    if (!enabled) return undefined
    void load()
    const iv = setInterval(load, 45_000)
    const onVis = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [enabled, load])

  if (!enabled) return null

  const unread = items.filter((i) => !seen.includes(i.id))
  const count = unread.length
  const shown = [
    ...items.filter((i) => i.kind === 'docs'),
    ...items.filter((i) => i.kind !== 'docs' && !seen.includes(i.id)),
  ]

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
    onGoPage?.(it.page)
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
              No verification uploads or new activity.
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
                      {it.kind === 'docs' ? 'ID' : it.kind === 'survey' ? 'Survey' : 'Activity'}
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
