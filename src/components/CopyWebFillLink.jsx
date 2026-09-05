import { useEffect, useState } from 'react'
import { listWebFillLinks, mintWebFillUrl, webFillUrl } from '../api'

function clampMax(n) {
  const x = Math.floor(Number(n) || 0)
  if (x < 1) return 1
  if (x > 9999) return 9999
  return x
}

export default function CopyWebFillLink({ formKey, title, onToast, compact = false, maxRecords = 0 }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [maxUses, setMaxUses] = useState(100)
  const [live, setLive] = useState(null)
  const [quota, setQuota] = useState({ used: 0, cap: 100, submitted: 0, linkUsed: 0 })
  const [alloc, setAlloc] = useState({ max_records: 0, field_used: 0, web_reserved: 0, field_remaining: 0 })

  useEffect(() => {
    const key = String(formKey || '').trim()
    if (!key || key === 'default' || key === 'legacy') {
      setLive(null)
      setQuota({ used: 0, cap: 100, submitted: 0, linkUsed: 0 })
      return undefined
    }
    let dead = false
    listWebFillLinks(key)
      .then((d) => {
        if (dead) return
        const share = d.live || null
        setLive(share)
        const cap = Number(share?.max_uses || d.cap || 100) || 100
        const submitted = Number(d.submitted ?? d.used ?? 0) || 0
        const linkUsed = Number(d.link_used ?? share?.use_count ?? 0) || 0
        setQuota({ used: submitted, cap, submitted, linkUsed })
        if (share?.max_uses) setMaxUses(clampMax(share.max_uses))
        if (share?.token) setUrl(webFillUrl(key, share.token))
        if (d.max_records != null || d.field_remaining != null) {
          setAlloc({
            max_records: Number(d.max_records) || 0,
            field_used: Number(d.field_used) || 0,
            web_reserved: Number(d.web_reserved) || 0,
            field_remaining: Number(d.field_remaining) || 0,
          })
        }
      })
      .catch(() => {
        if (!dead) {
          setLive(null)
          setQuota({ used: 0, cap: 100, submitted: 0, linkUsed: 0 })
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
      if (full || live?.expired) {
        onToast?.('Target reached — sharing is disabled for this survey', 'error')
        return
      }
      const d = await mintWebFillUrl(key, limit)
      const link = d.url || d
      setUrl(typeof link === 'string' ? link : '')
      setLive((prev) => ({
        ...(prev || {}),
        token: d.token,
        max_uses: d.max_uses || limit,
        use_count: d.use_count || 0,
        expired: false,
      }))
      setQuota((q) => ({
        ...q,
        cap: Number(d.max_uses) || limit,
        linkUsed: Number(d.use_count) || 0,
      }))
      if (d.max_records != null || d.field_remaining != null) {
        setAlloc({
          max_records: Number(d.max_records) || 0,
          field_used: Number(d.field_used) || 0,
          web_reserved: Number(d.web_reserved) || 0,
          field_remaining: Number(d.field_remaining) || 0,
        })
      }
      try {
        window.dispatchEvent(new CustomEvent('esurvey-quota-changed'))
      } catch {
        /* ignore */
      }
      const remaining = Number(d.field_remaining)
      try {
        await navigator.clipboard.writeText(typeof link === 'string' ? link : String(link || ''))
        onToast?.(
          Number.isFinite(remaining)
            ? `Quota ${limit} reserved · ${remaining.toLocaleString()} remaining for field`
            : `Copied ${title || 'survey'} link · ${limit} reserved`,
          'ok',
        )
      } catch {
        onToast?.(typeof link === 'string' ? link : 'Copied', 'ok')
      }
    } catch (e) {
      onToast?.(e.message || 'Could not copy link', 'error')
    } finally {
      setBusy(false)
    }
  }

  const cap = Number(quota.cap || maxUses || 100) || 100
  const submitted = Math.max(0, Number(quota.submitted ?? quota.used) || 0)
  const linkUsed = Math.max(0, Number(quota.linkUsed) || 0)
  const pct = Math.min(100, Math.round((linkUsed / cap) * 100))
  const full = linkUsed >= cap || live?.expired

  const picker = (
    <label className="field" style={{ margin: 0, minWidth: compact ? 120 : 180 }}>
      <span>Responses allowed</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button type="button" className="btn small" disabled={busy || full || live?.expired || maxUses <= 1} onClick={() => bump(-1)}>
          −
        </button>
        <input
          type="number"
          min={1}
          max={9999}
          step={1}
          value={maxUses}
          disabled={busy || full || live?.expired}
          onChange={(e) => setMaxUses(clampMax(e.target.value))}
          style={{ width: compact ? 72 : 88, textAlign: 'center' }}
        />
        <button type="button" className="btn small" disabled={busy || full || live?.expired || maxUses >= 9999} onClick={() => bump(1)}>
          +
        </button>
      </div>
    </label>
  )

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
        {title || 'Web survey'}
      </div>
      <div style={{ fontSize: compact ? 16 : 20, fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
        <span style={{ color: '#059669' }}>{submitted}</span>
        <span style={{ fontWeight: 600, color: '#64748b' }}> submitted</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#334155', marginTop: 4 }}>
        This link: <span style={{ color: full ? '#dc2626' : '#0f172a' }}>{linkUsed}</span>
        <span style={{ fontWeight: 500, color: '#64748b' }}> used of {cap}</span>
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
          Target reached — sharing is disabled for {title || 'this survey'}.
        </p>
      ) : (
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
          {Math.max(0, cap - linkUsed)} remaining · one unique link for {title || 'this survey'}
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
        <button
          type="button"
          className="btn small"
          disabled={busy || !formKey || full || live?.expired}
          onClick={() => void mintAndCopy()}
        >
          {full || live?.expired ? 'Sharing disabled' : busy ? 'Copying…' : 'Copy web link'}
        </button>
      </div>
      </div>
    )
  }

  return (
    <div style={{ margin: '0 0 12px' }}>
      <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700 }}>
        {title ? `${title} — web link` : 'Web survey link'}
      </p>
      {usage}
      <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
        One unique link for this survey. Sharing turns off when the target is reached.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
        {picker}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          readOnly
          value={url}
          placeholder="Unique survey link"
          disabled={full || live?.expired}
          style={{ flex: 1, minWidth: 220, fontSize: 13, opacity: full || live?.expired ? 0.6 : 1 }}
          onFocus={(e) => e.target.select()}
        />
        <button
          type="button"
          className="btn primary"
          disabled={busy || !formKey || full || live?.expired}
          onClick={() => void mintAndCopy()}
        >
          {full || live?.expired ? 'Sharing disabled' : busy ? 'Copying…' : 'Copy web link'}
        </button>
      </div>
    </div>
  )
}
