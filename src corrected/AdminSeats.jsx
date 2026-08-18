import { useCallback, useEffect, useState } from 'react'
import Icon from './Icons'
import { approveSeatRequest, denySeatRequest, getSeatRequests } from './api'

function fmtTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const STATUS_STYLE = {
  pending: { icon: 'clock', label: 'Pending', color: '#d97706', bg: 'rgba(217,119,6,0.12)' },
  approved: { icon: 'check', label: 'Approved', color: '#059669', bg: 'rgba(5,150,105,0.12)' },
  denied: { icon: 'cross', label: 'Denied', color: '#dc2626', bg: 'rgba(220,38,38,0.10)' },
}

export default function AdminSeatsScreen({ onToast }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await getSeatRequests())
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [onToast])

  useEffect(() => {
    void load()
  }, [load])

  async function decide(id, approve) {
    setBusyId(id)
    try {
      if (approve) await approveSeatRequest(id)
      else await denySeatRequest(id)
      onToast?.(approve ? 'Request approved — seat limit raised' : 'Request denied', 'ok')
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setBusyId(null)
    }
  }

  const requests = data?.requests || []
  const pending = requests.filter((r) => r.status === 'pending')
  const decided = requests.filter((r) => r.status !== 'pending')
  const limits = data?.limits || {}
  const currentAdmins = data?.current_admins ?? 0
  const approvedLimit = limits.approved_limit != null ? Number(limits.approved_limit) : 5

  return (
    <div className="screen">
      <header className="screen-head">
        <h2>Super Admin · Seat Limits</h2>
        <p>
          BR-006 / FR-USR-10: Client Admins request more admin seats; approval raises the limit
          immediately. No billing at MVP — this is the governance workflow.
        </p>
      </header>

      <div className="card" style={{ marginBottom: 12, border: '1px solid rgba(245,158,11,0.45)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h3 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="chair" size={16} /> Admin seats (platform)</h3>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Approved limit raised by Super Admin on request approval (default 5).
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <strong style={{ fontSize: 20 }}>
              {currentAdmins} / {approvedLimit}
            </strong>{' '}
            <span className="muted" style={{ fontSize: 12 }}>active admins</span>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              {limits.updated_by ? `last change by ${limits.updated_by} · ${fmtTime(limits.updated_at)}` : 'default'}
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading seat requests…</p>
      ) : (
        <>
          <h3 style={{ fontSize: 14, margin: '14px 0 8px' }}>
            <Icon name="clock" size={13} /> Pending requests ({pending.length})
          </h3>
          {pending.length === 0 ? (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>No pending seat upgrade requests.</p>
            </div>
          ) : (
            pending.map((r) => (
              <div
                key={r.id}
                className="card"
                style={{
                  marginBottom: 10,
                  padding: '12px 14px',
                  borderLeft: '4px solid #d97706',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{r.requested_by_name || `@${r.requested_by}`}</strong>
                    <span className="pill ok" style={{ fontSize: 11 }}>
                      admin seats → <b>{r.requested_limit}</b>
                    </span>
                  </div>
                  {r.reason ? (
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: '#475569' }}>
                      “{r.reason}”
                    </p>
                  ) : (
                    <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>No reason given</p>
                  )}
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    requested {fmtTime(r.created_at)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={busyId === r.id}
                    onClick={() => void decide(r.id, true)}
                  >
                    {busyId === r.id ? '…' : <><Icon name="check" size={12} /> Approve</>}
                  </button>
                  <button
                    type="button"
                    className="btn small danger"
                    disabled={busyId === r.id}
                    onClick={() => void decide(r.id, false)}
                  >
                    {busyId === r.id ? '…' : '✕ Deny'}
                  </button>
                </div>
              </div>
            ))
          )}

          <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>History ({decided.length})</h3>
          {decided.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>No decisions yet.</p>
          ) : (
            decided.map((r) => {
              const st = STATUS_STYLE[r.status] || STATUS_STYLE.pending
              return (
                <div
                  key={r.id}
                  className="card"
                  style={{
                    marginBottom: 8,
                    padding: '10px 14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13 }}>{r.requested_by_name || `@${r.requested_by}`}</strong>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 'bold',
                          color: st.color,
                          background: st.bg,
                          borderRadius: 12,
                          padding: '2px 10px',
                        }}
                      >
                        <Icon name={st.icon} size={11} /> {st.label}
                      </span>
                      <span className="pill" style={{ fontSize: 11 }}>limit {r.requested_limit}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                      {fmtTime(r.created_at)}
                      {r.decided_by_name ? ` · decided by ${r.decided_by_name} · ${fmtTime(r.decided_at)}` : ''}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </>
      )}
    </div>
  )
}
