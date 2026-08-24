/**
 * PeriodTable — Period-based data table with tab switching.
 *
 * From mock3/period-table.html:
 *   - Period tabs: Total / Today / This Week / This Month
 *   - Party-colored dots, trend indicators, mini-bar charts
 *   - Consistent table component for Party, Districts, Surveyors
 *
 * Google principle: data legible, not taste-driven.
 * Google principle: measure what works, don't guess.
 */
import { useState } from 'react'

export default function PeriodTable({
  title,
  subtitle,
  columns = [],
  data = {},
  periods = ['total', 'today'],
  initialPeriod = 'total',
  onRowClick,
  className = '',
}) {
  const [activePeriod, setActivePeriod] = useState(initialPeriod)

  const rows = data[activePeriod] || data.total || []
  const currentPeriod = periods.find(p => p === activePeriod) || periods[0]

  return (
    <div
      className={`card ${className}`}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--surface-hover)',
        borderRadius: 'var(--r-lg, 12px)',
        padding: 'var(--sp-5, 20px)',
        boxShadow: 'var(--shadow-sm)',
        width: '100%',
      }}
    >
      <h3 style={{ fontSize: 'var(--fs-md, 15px)', fontWeight: 700, marginBottom: 2 }}>
        {title}
      </h3>
      {subtitle && (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)', marginBottom: 12 }}>
          {subtitle}
        </div>
      )}

      {/* Period tabs */}
      {periods.length > 1 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {periods.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setActivePeriod(p)}
              style={{
                padding: '6px 14px',
                borderRadius: 'var(--r-pill)',
                border: `1px solid ${currentPeriod === p ? 'var(--accent)' : 'var(--surface-hover)'}`,
                background: currentPeriod === p ? 'var(--accent)' : 'var(--surface)',
                color: currentPeriod === p ? '#fff' : 'var(--ink-secondary)',
                fontSize: 'var(--fs-xs)',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 120ms ease-out',
              }}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 'var(--fs-sm)',
          }}
        >
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th
                  key={i}
                  style={{
                    textAlign: col.align || (col.align === 'right' ? 'right' : 'left'),
                    padding: '8px 12px',
                    fontWeight: 700,
                    borderBottom: '2px solid var(--surface-hover)',
                    color: 'var(--ink-secondary)',
                    fontSize: 'var(--fs-xs)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.3px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.id || i}
                onClick={() => onRowClick?.(row)}
                style={{
                  cursor: onRowClick ? 'pointer' : 'default',
                  transition: 'background 120ms',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-alt)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {columns.map((col, j) => (
                  <td
                    key={j}
                    style={{
                      padding: '8px 12px',
                      borderBottom: '1px solid var(--surface-alt)',
                      fontVariantNumeric: 'tabular-nums',
                      textAlign: col.align === 'right' ? 'right' : 'left',
                      fontWeight: col.bold ? 700 : 400,
                    }}
                  >
                    {/* Party dot */}
                    {col.render
                      ? col.render(row)
                      : col.key === 'trend'
                        ? <span style={{ color: row.trend?.startsWith('↑') ? 'var(--ok)' : row.trend?.startsWith('↓') ? 'var(--bad)' : 'var(--ink-faint)', fontSize: 10 }}>{row[col.key]}</span>
                        : col.key === 'bar'
                          ? (
                            <div style={{ width: 80, height: 6, background: 'var(--surface-hover)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ height: '100%', borderRadius: 3, width: `${row.barPct || 0}%`, background: row.barColor || 'var(--accent)', transition: 'width 350ms cubic-bezier(0.16,1,0.3,1)' }} />
                            </div>
                          )
                          : col.key === 'party' || col.key === 'lead'
                            ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                {row.partyColor && (
                                  <span style={{ width: 8, height: 8, borderRadius: 2, display: 'inline-block', background: row.partyColor }} />
                                )}
                                {row[col.key]}
                              </span>
                            )
                            : row[col.key]
                    }
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
