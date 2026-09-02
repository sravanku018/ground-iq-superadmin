/**
 * FeedCard — ONE card component for Report feed, Audit log, and scorecards.
 *
 * From mock3/feed-card.html:
 *   - Avatar → name → pills → trust ring → status
 *   - Click to expand pillar breakdown (explainable)
 *   - Syncing/failed states
 *   - Confirm/Reject actions (optimistic)
 *
 * Twitter principle: one consistent card, scannable feed.
 * Twitter principle: explainable — click to expand, score derived from real signals.
 * Google principle: one system — same component, same tokens.
 */
import { useState } from 'react'

export default function FeedCard({
  id,
  avatar,
  name,
  verified = false,
  location,
  time,
  pills = [],
  status = 'pending',
  signals = [],
  actions,
  detail,
  syncing = false,
  failed = false,
  className = '',
  onClick,
}) {
  const [expanded, setExpanded] = useState(false)

  const statusClass = status === 'confirmed' ? 'confirmed' : status === 'rejected' ? 'rejected' : 'pending'
  const cardClass = [
    'fc',
    syncing && 'syncing',
    failed && 'failed',
    expanded && 'expanded',
    className,
  ].filter(Boolean).join(' ')

  return (
    <div
      className={cardClass}
      onClick={() => {
        if (onClick) onClick()
        else setExpanded(e => !e)
      }}
      style={{
        background: 'var(--surface)',
        border: `1px solid ${failed ? 'var(--bad)' : 'var(--surface-hover)'}`,
        borderRadius: 'var(--r-lg, 12px)',
        padding: 'var(--sp-4, 16px)',
        marginBottom: 'var(--sp-3, 12px)',
        boxShadow: 'var(--shadow-sm)',
        transition: 'box-shadow var(--dur-normal) ease-out, transform var(--dur-normal) ease-out',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        ...(failed ? { background: 'var(--bad-bg)' } : {}),
        ...(syncing ? { opacity: 0.65, borderStyle: 'dashed' } : {}),
      }}
      data-submission-id={id}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 34, height: 34, borderRadius: '50%',
              background: 'var(--accent-bg)', border: '2px solid var(--accent-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--accent)',
              flexShrink: 0,
            }}
          >
            {avatar}
          </div>
          <div>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>
              {name}{' '}
              {verified && (
                <svg width="14" height="14" viewBox="0 0 22 22" style={{ verticalAlign: 'middle' }}>
                  <path fill="#1D9BF0" d="M11 2l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.6 2.7.6 2.7-2.3 1.4-1 2.5-2.7-.2L11 20l-2.2-1.6-2.7.2-1-2.5-2.3-1.4.6-2.7-.6-2.7 2.3-1.4 1-2.5 2.7.2z" />
                  <path fill="#fff" d="M9.6 13.4l-2-2 1-1 1 1 3.2-3.2 1 1z" />
                </svg>
              )}
            </div>
            {location && (
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}>{location}</div>
            )}
          </div>
        </div>
        {time && (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-faint)' }}>{time}</span>
        )}
      </div>

      {/* Answer pills */}
      {pills.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {pills.map((p, i) => (
            <span
              key={i}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 'var(--fs-xs)', fontWeight: 500,
                padding: '3px 9px', borderRadius: 'var(--r-pill)',
                background: 'var(--surface-alt)', color: 'var(--ink-secondary)',
                border: '1px solid var(--surface-hover)',
              }}
            >
              {(p.color || p.dot) && (
                <span style={{ width: 7, height: 7, borderRadius: 2, flexShrink: 0, background: p.color || p.dot }} />
              )}
              {p.label}
            </span>
          ))}
        </div>
      )}

      {/* Footer: trust ring + signals + status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2, 8px)' }}>
          {signals.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {signals.map((sig, i) => {
                const isOk = sig.type === 'ok' || sig.status === 'ok'
                const isBad = sig.type === 'bad' || sig.status === 'bad'
                return (
                  <span
                    key={i}
                    style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 6px',
                      borderRadius: 'var(--r-sm)',
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      background: isOk ? 'var(--ok-bg)' : isBad ? 'var(--bad-bg)' : 'var(--warn-bg)',
                      color: isOk ? 'var(--ok)' : isBad ? 'var(--bad)' : 'var(--warn)',
                    }}
                  >
                    {sig.label}
                  </span>
                )
              })}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span
            style={{
              fontSize: 'var(--fs-xs)', fontWeight: 700,
              padding: '3px 9px', borderRadius: 'var(--r-sm)',
              background: statusClass === 'confirmed' ? 'var(--ok-bg)' : statusClass === 'rejected' ? 'var(--bad-bg)' : 'var(--warn-bg)',
              color: statusClass === 'confirmed' ? 'var(--ok)' : statusClass === 'rejected' ? 'var(--bad)' : 'var(--warn)',
            }}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        </div>
      </div>

      {/* Review actions */}
      {actions && (
        <div
          style={{
            display: 'flex', gap: 6, marginTop: 12, paddingTop: 12,
            borderTop: '1px solid var(--surface-alt)',
          }}
          onClick={e => e.stopPropagation()}
        >
          {actions}
        </div>
      )}

      {/* Parent may pass detail only when open (Review). Always render if provided. */}
      {detail && (
        <div
          style={{
            marginTop: 12, paddingTop: 12,
            borderTop: '1px solid var(--surface-alt)',
            fontSize: 'var(--fs-xs)', color: 'var(--ink-secondary)',
            lineHeight: 1.6,
          }}
        >
          {detail}
        </div>
      )}
    </div>
  )
}
