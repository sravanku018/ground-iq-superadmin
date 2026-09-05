/** Compact allocation pill — one indicator for all Client Admin pages. */
export default function QuotaIndicator({ user, stats, surveys = [] }) {
  if (!user || user.role === 'super_admin') return null
  const cap = Number(user.max_records) || 0
  if (cap <= 0) return null

  const fieldUsed =
    (Number(stats?.field_pending) || 0) + (Number(stats?.field_confirmed) || 0)
  const fromSurveys = (Array.isArray(surveys) ? surveys : []).reduce(
    (n, s) => n + (Number(s.web_link?.max_uses) || 0),
    0,
  )
  const webReserved = fromSurveys || Number(user.web_reserved) || 0
  const left = Math.max(0, cap - fieldUsed - webReserved)
  const pct = Math.min(100, Math.round(((fieldUsed + webReserved) / cap) * 100))
  const hot = left === 0

  return (
    <div
      title={`${cap.toLocaleString()} allocated · ${webReserved.toLocaleString()} web reserved · ${fieldUsed.toLocaleString()} field used`}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 3,
        padding: '4px 12px',
        borderRadius: 9999,
        background: hot ? '#fef2f2' : '#f0fdf4',
        border: `1px solid ${hot ? '#fecaca' : '#dcfce7'}`,
        minWidth: 160,
        maxWidth: 280,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: hot ? '#dc2626' : '#16a34a' }}>
          {left.toLocaleString()} field left
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>
          {cap.toLocaleString()}
          {webReserved > 0 ? ` − ${webReserved.toLocaleString()} web` : ''}
        </span>
      </div>
      <div style={{ height: 4, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: hot ? '#dc2626' : pct >= 80 ? '#f59e0b' : '#16a34a',
          }}
        />
      </div>
    </div>
  )
}
