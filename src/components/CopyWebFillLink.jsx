import { useEffect, useState } from 'react'
import { listWebFillLinks, mintWebFillUrl } from '../api'

function clampMax(n) {
  const x = Math.floor(Number(n) || 0)
  if (x < 1) return 1
  if (x > 9999) return 9999
  return x
}

export default function CopyWebFillLink({ formKey, title, onToast, compact = false }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [maxUses, setMaxUses] = useState(100)
  const [live, setLive] = useState(null)
  const [quota, setQuota] = useState({ used: 0, cap: 100 })

  useEffect(() => {
    const key = String(formKey || '').trim()
    if (!key || key === 'default' || key === 'legacy') {
      setLive(null)
      setQuota({ used: 0, cap: 100 })
      return undefined
    }
    let dead = false
    listWebFillLinks(key)
      .then((d) => {
        if (dead) return
        setLive(d.live || null)
        const cap = Number(d.live?.max_uses || d.cap || 100) || 100
        const used = Number(d.live?.use_count ?? d.used ?? d.submitted ?? 0) || 0
        setQuota({ used, cap })
        if (d.live?.max_uses) setMaxUses(clampMax(d.live.max_uses))
      })
      .catch(() => {
        if (!dead) {
          setLive(null)
          setQuota({ used: 0, cap: 100 })
        }
      })
    return () => {
      dead = true
    }
  }, [formKey])

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
      setLive({ max_uses: limit, use_count: 0, remaining: limit, expired: false })
      setQuota({ used: 0, cap: limit })
      listWebFillLinks(key)
        .then((d) => {
          setLive(d.live || { max_uses: limit, use_count: 0, remaining: limit })
          const cap = Number(d.live?.max_uses || limit) || limit
          const used = Number(d.live?.use_count ?? d.used ?? 0) || 0
          setQuota({ used, cap })
        })
        .catch(() => {})
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

  const cap = Number(quota.cap || maxUses || 100) || 100
  const used = Math.max(0, Number(quota.used) || 0)
  const pct = Math.min(100, Math.round((used / cap) * 100))
  const full = used >= cap
  const usage = (
    <div
      style={{
        margin: compact ? '0 0 6px' : '0 0 12px',
        padding: compact ? '8px 10px' : '12px 14px',
        borderRadius: 10,
        border: `1px solid ${full ? '#fecaca' : '#bbf7d0'}`,
        background: full ? '#fef2f2' : '#f0fdf4',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: full ? '#b91c1c' : '#15803d', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        Web survey quota
      </div>
      <div style={{ fontSize: compact ? 16 : 20, fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
        <span style={{ color: full ? '#dc2626' : '#059669' }}>{used}</span>
        <span style={{ fontWeight: 600, color: '#64748b' }}> used of {cap}</span>
      </div>
      <div style={{ height: 8, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden', marginTop: 8 }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: full ? '#dc2626' : pct >= 80 ? '#f59e0b' : '#059669',
          }}
        />
      </div>
      {live?.expired || full ? (
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
          This link has reached its limit. Copy a new link to collect more.
        </p>
      ) : (
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
          {Math.max(0, cap - used)} remaining
        </p>
      )}
    </div>
  )

  if (compact) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {usage}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {picker}
        <button type="button" className="btn small" disabled={busy || !formKey} onClick={() => void mintAndCopy()}>
          {busy ? 'Creating…' : 'Copy web link'}
        </button>
      </div>
      </div>
    )
  }

  return (
    <div style={{ margin: '0 0 12px' }}>
      <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700 }}>Web survey link</p>
      {usage}
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
