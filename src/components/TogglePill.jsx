/**
 * TogglePill — Powers & caps matrix toggle.
 *
 * From mock3/toggle-pill.html:
 *   - Click pill to toggle power on/off
 *   - Flip is instant (optimistic), background sync + rollback on failure
 *   - Used in Super Admin governance for admin powers matrix
 *
 * Google principle: one system, canonical matrix.
 * Twitter principle: optimistic — flip instantly, sync later.
 */
import { useState, useCallback } from 'react'

export default function TogglePill({
  power,
  label,
  icon,
  initialOn = false,
  disabled = false,
  onChange,
}) {
  const [on, setOn] = useState(initialOn)
  const [flash, setFlash] = useState(false)

  const toggle = useCallback(() => {
    if (disabled) return
    const next = !on

    // Optimistic flip
    setOn(next)
    setFlash(true)
    setTimeout(() => setFlash(false), 300)

    // Notify parent for background sync
    onChange?.(power, next)
  }, [disabled, on, power, onChange])

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      style={{
        fontSize: 'var(--fs-xs)',
        padding: '7px 10px',
        borderRadius: 'var(--r-sm, 6px)',
        border: `1px solid ${on ? 'var(--accent-border)' : 'var(--surface-hover)'}`,
        background: on ? 'var(--accent-bg)' : 'transparent',
        color: on ? 'var(--accent)' : disabled ? 'var(--ink-faint)' : 'var(--ink-muted)',
        fontWeight: on ? 700 : 400,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 120ms ease-out',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        opacity: disabled ? 0.5 : 1,
        ...(flash ? { animation: 'pillFlash 0.3s ease-out' } : {}),
      }}
    >
      <span
        style={{
          width: 14, height: 14, borderRadius: 3,
          border: '1.5px solid currentColor',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, flexShrink: 0,
          transition: 'all 120ms ease-out',
          ...(on ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}),
        }}
      >
        {on ? '✓' : ''}
      </span>
      {icon && <span>{icon}</span>}
      {label}
    </button>
  )
}
