/**
 * PermissionLockCard — Read-only account permissions view.
 *
 * From mock3/permission-lock.html:
 *   - Identity row with avatar and lock indicator
 *   - Power grid (all read-only, no toggles)
 *   - Caps display
 *   - Read-only notice
 *
 * Apple principle: progressive disclosure — show what's granted, hide what's not.
 * Google principle: one system — same tokens as admin power editing.
 */
export default function PermissionLockCard({
  avatar,
  name,
  username,
  role,
  powers = [],
  caps = [],
  className = '',
}) {
  return (
    <div
      className={className}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--surface-hover)',
        borderRadius: 'var(--r-lg, 12px)',
        padding: 'var(--sp-5, 20px)',
        boxShadow: 'var(--shadow-sm)',
        maxWidth: 420,
        width: '100%',
      }}
    >
      <h3 style={{ fontSize: 'var(--fs-md, 15px)', fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        🔒 Read-Only Profile
      </h3>

      {/* Identity row */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: 16, background: 'var(--surface-alt)',
          borderRadius: 'var(--r-lg, 12px)', marginBottom: 16,
        }}
      >
        <div
          style={{
            width: 52, height: 52, borderRadius: '50%',
            background: 'var(--accent)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'var(--fs-lg)', fontWeight: 700, flexShrink: 0,
            position: 'relative',
          }}
        >
          {avatar}
          <div
            style={{
              position: 'absolute', bottom: -2, right: -2,
              width: 20, height: 20, borderRadius: '50%',
              background: 'var(--ok)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, border: '2px solid var(--surface-alt)',
            }}
          >
            🔒
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
            {name}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)', marginTop: 1 }}>
            {username} · {role}
          </div>
        </div>
      </div>

      {/* Power grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 16 }}>
        {powers.map((p, i) => (
          <div
            key={i}
            style={{
              fontSize: 'var(--fs-xs)',
              padding: '8px 10px',
              borderRadius: 'var(--r-sm, 6px)',
              border: `1px solid ${p.granted ? 'var(--accent-border)' : 'var(--surface-hover)'}`,
              background: p.granted ? 'var(--accent-bg)' : 'transparent',
              color: p.granted ? 'var(--accent)' : 'var(--ink-faint)',
              fontWeight: p.granted ? 700 : 400,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <span
              style={{
                width: 14, height: 14, borderRadius: 3,
                border: '1.5px solid currentColor',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, flexShrink: 0,
                ...(p.granted ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}),
              }}
            >
              {p.granted ? '✓' : ''}
            </span>
            {p.label}
          </div>
        ))}
      </div>

      {/* Caps */}
      {caps.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {caps.map((c, i) => (
            <span
              key={i}
              style={{
                fontSize: 'var(--fs-xs)',
                padding: '4px 10px',
                borderRadius: 'var(--r-pill)',
                background: 'var(--surface-alt)',
                color: 'var(--ink-secondary)',
              }}
            >
              {c.label} <b style={{ color: 'var(--ink)' }}>{c.value}</b>
            </span>
          ))}
        </div>
      )}

      {/* Read-only notice */}
      <div
        style={{
          fontSize: 'var(--fs-xs)',
          color: 'var(--ink-muted)',
          background: 'var(--surface-alt)',
          border: '1px solid var(--surface-hover)',
          borderRadius: 'var(--r-md, 10px)',
          padding: '10px 12px',
          display: 'flex', gap: 8, alignItems: 'flex-start',
        }}
      >
        <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>ℹ️</span>
        <span>
          This is a read-only view. Permissions are managed by the Super Admin.
          Contact support to request changes.
        </span>
      </div>
    </div>
  )
}
