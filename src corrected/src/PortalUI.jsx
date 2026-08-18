/** Shared Client Admin loading / empty / error blocks */

export function PortalSkeleton({ rows = 4, label = 'Loading…' }) {
  return (
    <div className="portal-state portal-skeleton" role="status" aria-busy="true">
      <p className="muted portal-state-label">{label}</p>
      <div className="portal-skeleton-rows">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="portal-skeleton-row" style={{ width: `${88 - i * 8}%` }} />
        ))}
      </div>
    </div>
  )
}

export function PortalEmpty({ title = 'Nothing here yet', children, action }) {
  return (
    <div className="portal-state portal-empty card">
      <strong className="portal-state-title">{title}</strong>
      {children ? <div className="muted portal-state-body">{children}</div> : null}
      {action ? <div className="portal-state-action">{action}</div> : null}
    </div>
  )
}

export function PortalError({ title = 'Something went wrong', message, onRetry }) {
  return (
    <div className="portal-state portal-error card" role="alert">
      <strong className="portal-state-title">{title}</strong>
      {message ? <p className="muted portal-state-body">{message}</p> : null}
      {onRetry ? (
        <button type="button" className="btn small primary" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  )
}

/** Collapsible section for heavy filter groups */
export function FilterSection({ title, defaultOpen = true, children, badge }) {
  return (
    <details className="filter-section" open={defaultOpen}>
      <summary className="filter-section-sum">
        <span>{title}</span>
        {badge != null && badge !== '' ? (
          <span className="filter-section-badge">{badge}</span>
        ) : null}
      </summary>
      <div className="filter-section-body">{children}</div>
    </details>
  )
}
