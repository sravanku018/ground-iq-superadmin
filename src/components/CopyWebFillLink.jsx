import { useState } from 'react'
import { mintWebFillUrl } from '../api'

function clampMax(n) {
  const x = Math.floor(Number(n) || 0)
  if (x < 1) return 1
  if (x > 9999) return 9999
  return x
}

export default function CopyWebFillLink({ formKey, title, onToast, compact = false }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [maxUses, setMaxUses] = useState(10)

  function bump(delta) {
    setMaxUses((n) => clampMax(n + delta))
  }

  async function mintAndCopy() {
    const key = String(formKey || '').trim()
    if (!key || key === 'default' || key === 'legacy') {
      onToast?.('Pick a survey first', 'error')
      return
    }
    const limit = clampMax(maxUses)
    setMaxUses(limit)
    setBusy(true)
    try {
      const link = await mintWebFillUrl(key, limit)
      setUrl(link)
      try {
        await navigator.clipboard.writeText(link)
        onToast?.(
          `Web link copied · ${limit} response${limit === 1 ? '' : 's'} then expires${title ? ` · ${title}` : ''}`,
          'ok',
        )
      } catch {
        onToast?.(link, 'ok')
      }
    } catch (e) {
      onToast?.(e.message || 'Could not create link', 'error')
    } finally {
      setBusy(false)
    }
  }

  const picker = (
    <label className="field" style={{ margin: 0, minWidth: compact ? 120 : 180 }}>
      <span>Responses allowed</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button type="button" className="btn small" disabled={busy || maxUses <= 1} onClick={() => bump(-1)}>
          −
        </button>
        <input
          type="number"
          min={1}
          max={9999}
          step={1}
          value={maxUses}
          onChange={(e) => setMaxUses(clampMax(e.target.value))}
          style={{ width: compact ? 72 : 88, textAlign: 'center' }}
        />
        <button type="button" className="btn small" disabled={busy || maxUses >= 9999} onClick={() => bump(1)}>
          +
        </button>
      </div>
    </label>
  )

  if (compact) {
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {picker}
        <button type="button" className="btn small" disabled={busy || !formKey} onClick={() => void mintAndCopy()}>
          {busy ? 'Creating…' : 'Copy web link'}
        </button>
      </div>
    )
  }

  return (
    <div style={{ margin: '0 0 12px' }}>
      <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700 }}>Web survey link</p>
      <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
        Set how many people can submit with this link. After that number is reached, the link
        expires. Copy again to make a new link.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
        {picker}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          readOnly
          value={url}
          placeholder="Click Copy to create the link"
          style={{ flex: 1, minWidth: 220, fontSize: 13 }}
          onFocus={(e) => e.target.select()}
        />
        <button type="button" className="btn primary" disabled={busy || !formKey} onClick={() => void mintAndCopy()}>
          {busy ? 'Creating…' : 'Copy web link'}
        </button>
      </div>
    </div>
  )
}
