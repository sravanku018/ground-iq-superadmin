/**
 * Super Admin → Errors: local error tracking. Client (portal/web/apk) and
 * server crashes land in the client_errors table on the VPS — nothing is
 * sent to a third party.
 */
import { useCallback, useEffect, useState } from 'react'
import { getAppTraffic, getClientErrors, setClientErrorResolved } from './api'

const APP_COLORS = {
  portal: '#1a73e8',
  web: '#16a34a',
  apk: '#7c3aed',
  server: '#dc2626',
}

function fmt(value) {
  const d = new Date(value || '')
  if (Number.isNaN(d.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit',
    }).format(d)
  } catch {
    return d.toLocaleString()
  }
}

export default function AdminErrors({ onToast }) {
  const [items, setItems] = useState([])
  const [traffic, setTraffic] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('open')
  const [openId, setOpenId] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [res, tr] = await Promise.all([
        getClientErrors(),
        getAppTraffic().catch(() => null),
      ])
      setItems(Array.isArray(res?.items) ? res.items : [])
      setTraffic(tr && Array.isArray(tr.rows) ? tr : null)
    } catch (e) {
      onToast?.(e?.message || 'Could not load errors', 'error')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [onToast])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (row) => {
    setBusyId(row.id)
    try {
      await setClientErrorResolved(row.id, !row.resolved)
      setItems((list) => list.map((r) => (r.id === row.id ? { ...r, resolved: !r.resolved } : r)))
    } catch (e) {
      onToast?.(e?.message || 'Update failed', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const shown = items.filter((r) =>
    filter === 'all' ? true : filter === 'open' ? !r.resolved : r.resolved,
  )
  const openCount = items.filter((r) => !r.resolved).length

  return (
    <div className="portal-page">
      <header className="portal-page-head">
        <div>
          <p className="eyebrow">Super Admin</p>
          <h1>Errors</h1>
          <p className="portal-lead">
            Local error tracking — client (portal / web / APK) and server exceptions · {openCount} open
          </p>
        </div>
        <button type="button" className="btn small" onClick={() => void load()}>Refresh</button>
      </header>

      {traffic ? (
        <div className="card" style={{ padding: 12, marginBottom: 12 }}>
          <h3 style={{ margin: '0 0 4px' }}>API host traffic · last {traffic.days} days</h3>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
            Legacy sslip host: <strong>{Number(traffic.old_host_requests || 0).toLocaleString()}</strong>{' '}
            requests
            {traffic.old_host_last_seen ? ` · last ${fmt(traffic.old_host_last_seen)}` : ''}
          </p>
          {traffic.rows.length === 0 ? (
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>No traffic recorded yet.</p>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Host</th><th>App version</th><th>Requests</th><th>Last seen</th></tr>
                </thead>
                <tbody>
                  {traffic.rows.slice(0, 12).map((r, i) => {
                    const old = String(r.host || '').endsWith('.sslip.io')
                    return (
                      <tr key={`${r.host}|${r.app_version}|${i}`}>
                        <td style={{ fontWeight: old ? 700 : 400, color: old ? '#b45309' : undefined }}>
                          {r.host}
                        </td>
                        <td>{r.app_version}</td>
                        <td>{Number(r.requests || 0).toLocaleString()}</td>
                        <td>{fmt(r.last_seen)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          ['open', `Open (${openCount})`],
          ['resolved', `Resolved (${items.length - openCount})`],
          ['all', `All (${items.length})`],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`btn small ${filter === k ? 'primary' : ''}`}
            onClick={() => setFilter(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card" style={{ padding: 16 }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div className="card muted" style={{ padding: 16 }}>
          No {filter === 'all' ? '' : filter} errors. 🎉
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map((r) => (
            <div
              key={r.id}
              className="card"
              style={{ padding: 12, borderLeft: `4px solid ${r.resolved ? '#16a34a' : APP_COLORS[r.app] || '#f59e0b'}` }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em',
                    padding: '2px 8px', borderRadius: 999,
                    background: '#f1f5f9', color: APP_COLORS[r.app] || '#334155',
                  }}
                >
                  {r.app}
                </span>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, wordBreak: 'break-word' }}>{r.message}</div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                    {fmt(r.created_at)}
                    {r.version ? ` · v${r.version}` : ''}
                    {r.username ? ` · @${r.username}` : ''}
                    {r.url ? ` · ${String(r.url).replace(/^https?:\/\/[^/]+/, '').slice(0, 60)}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {r.stack ? (
                    <button type="button" className="btn small" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                      {openId === r.id ? 'Hide stack' : 'Stack'}
                    </button>
                  ) : null}
                  <button type="button" className="btn small" disabled={busyId === r.id} onClick={() => void toggle(r)}>
                    {busyId === r.id ? '…' : r.resolved ? 'Reopen' : 'Resolve'}
                  </button>
                </div>
              </div>
              {openId === r.id && r.stack ? (
                <pre
                  style={{
                    marginTop: 8, padding: 10, background: '#0f172a', color: '#e2e8f0',
                    borderRadius: 8, fontSize: 11, lineHeight: 1.45, overflowX: 'auto', whiteSpace: 'pre-wrap',
                  }}
                >
                  {r.stack}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
