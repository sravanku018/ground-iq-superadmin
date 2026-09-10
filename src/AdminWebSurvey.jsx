import { useCallback, useEffect, useState } from 'react'
import {
  deactivateWebFillLink,
  listActiveWebFillLinks,
  listSubmissions,
  listSurveys,
  listWebFillLinks,
  mintWebFillUrl,
  webFillUrl,
} from './api'

/* ─── helpers ─────────────────────────────────────────────────── */
function fmt(v) {
  if (!v) return '—'
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d)
}

function shareViaWhatsApp(url, title) {
  const text = encodeURIComponent(`Please fill this survey: ${title}\n${url}`)
  window.open(`https://wa.me/?text=${text}`, '_blank')
}

function Pill({ label, color = '#64748b', bg = '#f1f5f9', dot }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: bg, color, fontSize: 11, fontWeight: 700,
      letterSpacing: '0.04em', padding: '3px 9px',
      borderRadius: 99, whiteSpace: 'nowrap',
    }}>
      {dot && (
        <span style={{
          width: 7, height: 7, borderRadius: '50%', background: color,
          animation: dot === 'pulse' ? 'live-pulse 1.4s ease-in-out infinite' : 'none',
          display: 'inline-block',
        }} />
      )}
      {label}
    </span>
  )
}

/* ─── per-survey card ─────────────────────────────────────────── */
function SurveyWebCard({ survey, onToast, expanded, onToggle, canDeactivate, reloadAt, onDeactivated }) {
  const [link, setLink] = useState(null)       // { token, max_uses, use_count, expired }
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [maxUses, setMaxUses] = useState(100)
  const [recents, setRecents] = useState([])
  const [recLoading, setRecLoading] = useState(false)

  const fk = survey.form_key

  /* load link status */
  useEffect(() => {
    if (!fk) return
    let dead = false
    setLoading(true)
    listWebFillLinks(fk)
      .then((d) => {
        if (dead) return
        const share = d.live || null
        setLink(share)
        if (share?.max_uses) setMaxUses(Number(share.max_uses) || 100)
      })
      .catch(() => {})
      .finally(() => { if (!dead) setLoading(false) })
    return () => { dead = true }
  }, [fk, reloadAt])

  /* load recent web submissions when expanded */
  useEffect(() => {
    if (!expanded || !fk) return
    let dead = false
    setRecLoading(true)
    listSubmissions(10, 'all', { survey: fk, source: 'web' })
      .then((d) => { if (!dead) setRecents(d.items || []) })
      .catch(() => {})
      .finally(() => { if (!dead) setRecLoading(false) })
    return () => { dead = true }
  }, [expanded, fk])

  const cap = Number(link?.max_uses || maxUses || 100) || 100
  const used = Math.max(Number(survey.web_submissions) || 0, Number(link?.use_count) || 0)
  const left = Math.max(0, cap - used)
  const pct = Math.min(100, Math.round((used / cap) * 100))
  const capHit = cap > 0 && used >= cap
  const deactivated = !!(link?.used_at || link?.ended_at) && !capHit
  const full = capHit
  const isLive = !!link?.token && !deactivated && !full && !link?.expired
  const quotaFrozen = Boolean(link?.token) && !deactivated
  const url = link?.token ? webFillUrl(fk, link.token) : ''

  const startTime = link?.starts_at || link?.created_at || survey.web_link?.starts_at || survey.web_link?.created_at
  const endTime = link?.ended_at || link?.used_at || survey.web_link?.ended_at || survey.web_link?.used_at

  async function handleMint() {
    if (!fk) return
    setBusy(true)
    try {
      const d = await mintWebFillUrl(fk, maxUses)
      const newUrl = d.url || ''
      setLink({
        token: d.token,
        max_uses: d.max_uses || maxUses,
        use_count: d.use_count || 0,
        expired: false,
        created_at: d.created_at || new Date().toISOString(),
        starts_at: d.starts_at || d.created_at || new Date().toISOString(),
        used_at: d.used_at || null,
        ended_at: d.ended_at || null,
      })
      try { await navigator.clipboard.writeText(newUrl) } catch { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent('esurvey-quota-changed')) } catch { /* ignore */ }
      onToast?.(`Link created & copied · ${maxUses} responses allowed`, 'ok')
      onDeactivated?.()
    } catch (e) {
      onToast?.(e.message || 'Could not create link', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleCopy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      onToast?.('Link copied to clipboard ✓', 'ok')
    } catch {
      onToast?.(url, 'ok')
    }
  }

  async function handleDeactivate() {
    if (!fk || !isLive) return
    const title = survey.title || fk
    if (!window.confirm(`Deactivate the live web link for “${title}”? Copied URLs will stop working.`)) return
    setBusy(true)
    try {
      await deactivateWebFillLink(fk)
      setLink((prev) => prev ? { ...prev, expired: true, used_at: new Date().toISOString(), ended_at: new Date().toISOString() } : prev)
      onToast?.(`“${title}” web link deactivated`, 'ok')
      onDeactivated?.()
    } catch (e) {
      onToast?.(e.message || 'Could not deactivate', 'error')
    } finally {
      setBusy(false)
    }
  }

  const barColor = full ? '#dc2626' : pct >= 80 ? '#f59e0b' : '#059669'

  return (
    <div style={{
      border: `1.5px solid ${isLive ? '#86efac' : full ? '#fecaca' : '#e2e8f0'}`,
      borderRadius: 14,
      background: isLive ? '#f0fdf4' : full ? '#fef2f2' : '#fff',
      marginBottom: 12,
      overflow: 'hidden',
    }}>
      {/* ── card header (always visible, tap to expand) ── */}
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%', textAlign: 'left', background: 'none',
          border: 'none', padding: '14px 16px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <strong style={{ fontSize: 15, color: '#0f172a' }}>{survey.title || fk}</strong>
            {loading ? (
              <Pill label="Loading…" />
            ) : isLive ? (
              <Pill label="LIVE" color="#15803d" bg="#dcfce7" dot="pulse" />
            ) : deactivated ? (
              <Pill label="Deactivated" color="#92400e" bg="#fef3c7" />
            ) : full ? (
              <Pill label="Target reached" color="#b91c1c" bg="#fee2e2" />
            ) : link?.token ? (
              <Pill label="Disabled" color="#92400e" bg="#fef3c7" />
            ) : (
              <Pill label="No link yet" color="#64748b" bg="#f1f5f9" />
            )}
          </div>
          {/* progress bar & timing */}
          {link?.token && !loading && (
            <div>
              <div style={{ height: 5, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden', marginBottom: 4 }}>
                <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 99 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: full ? '#dc2626' : '#64748b' }}>
                  {used.toLocaleString()} / {cap.toLocaleString()} responses
                  {!full && ` · ${left.toLocaleString()} left`}
                </span>
                {startTime && (
                  <span style={{ fontSize: 11, color: '#475569', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span>🕒 <strong>Started:</strong> {fmt(startTime)}</span>
                    {endTime ? (
                      <span>· 🏁 <strong>Ended:</strong> {fmt(endTime)}</span>
                    ) : isLive ? (
                      <span style={{ color: '#15803d', fontWeight: 600 }}>· 🟢 Active</span>
                    ) : null}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        <span style={{ fontSize: 18, color: '#94a3b8', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {/* ── expanded panel ── */}
      {expanded && (
        <div style={{ padding: '0 16px 16px' }}>

          {/* quota + action row */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <label className="field" style={{ margin: 0, flex: '0 0 auto' }}>
              <span style={{ fontSize: 12 }}>Responses allowed</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button" className="btn small"
                  disabled={busy || quotaFrozen || maxUses <= 1}
                  onClick={() => setMaxUses(n => Math.max(1, n - (n > 50 ? 10 : 1)))}
                  style={{ minHeight: 40, minWidth: 40 }}
                >−</button>
                <input
                  type="number" min={1} max={9999} value={maxUses}
                  disabled={busy || quotaFrozen}
                  readOnly={quotaFrozen}
                  onChange={(e) => setMaxUses(Math.max(1, Math.min(9999, Number(e.target.value) || 1)))}
                  style={{ width: 72, textAlign: 'center', minHeight: 40, fontSize: 16, opacity: quotaFrozen ? 0.7 : 1 }}
                />
                <button
                  type="button" className="btn small"
                  disabled={busy || quotaFrozen || maxUses >= 9999}
                  onClick={() => setMaxUses(n => Math.min(9999, n + (n >= 50 ? 10 : 1)))}
                  style={{ minHeight: 40, minWidth: 40 }}
                >+</button>
              </div>
              {quotaFrozen && (
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  Quota locked after link generation
                </span>
              )}
            </label>

            {full ? (
              <div style={{
                flex: 1, padding: '10px 14px', borderRadius: 10,
                background: '#fef2f2', border: '1px solid #fecaca',
                fontSize: 13, color: '#b91c1c', fontWeight: 600,
              }}>
                🛑 Target reached — sharing disabled
              </div>
            ) : (
              <button
                type="button"
                className="btn primary"
                disabled={busy || loading}
                onClick={() => void (isLive ? handleCopy() : handleMint())}
                style={{ minHeight: 44, flex: 1, fontSize: 14, fontWeight: 700 }}
              >
                {busy ? (isLive ? 'Copying…' : 'Creating…') : isLive ? '📋 Copy link' : '🔗 Create & copy link'}
              </button>
            )}
          </div>

          {/* survey start / end timing block */}
          {startTime && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
              padding: '10px 14px', background: isLive ? '#f0fdf4' : full ? '#fef2f2' : '#f8fafc',
              border: `1px solid ${isLive ? '#bbf7d0' : full ? '#fecaca' : '#e2e8f0'}`,
              borderRadius: 10, marginBottom: 12, fontSize: 12,
            }}>
              <div>
                <span style={{ fontSize: 10, color: '#64748b', display: 'block', fontWeight: 700, letterSpacing: '0.04em' }}>
                  STARTING TIME
                </span>
                <strong style={{ color: '#0f172a', fontSize: 13 }}>🕒 {fmt(startTime)}</strong>
              </div>
              <div style={{ width: 1, height: 26, background: '#cbd5e1' }} />
              <div>
                <span style={{ fontSize: 10, color: '#64748b', display: 'block', fontWeight: 700, letterSpacing: '0.04em' }}>
                  ENDING TIME
                </span>
                {endTime ? (
                  <strong style={{ color: '#0f172a', fontSize: 13 }}>🏁 {fmt(endTime)}</strong>
                ) : isLive ? (
                  <span style={{ color: '#15803d', fontWeight: 700, fontSize: 13 }}>🟢 Live &amp; Ongoing (Active)</span>
                ) : full ? (
                  <span style={{ color: '#b91c1c', fontWeight: 700, fontSize: 13 }}>🛑 Closed (Target reached)</span>
                ) : (
                  <span className="muted">Pending</span>
                )}
              </div>
            </div>
          )}

          {/* link row (when live) */}
          {isLive && url && (
            <div style={{ marginBottom: 12 }}>
              <div style={{
                display: 'flex', gap: 8, alignItems: 'center',
                background: '#f8fafc', border: '1px solid #e2e8f0',
                borderRadius: 10, padding: '8px 12px', flexWrap: 'wrap',
              }}>
                <span style={{
                  flex: 1, fontSize: 12, color: '#334155', wordBreak: 'break-all',
                  fontFamily: 'monospace',
                }}>{url}</span>
              </div>

              {/* share buttons */}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="btn"
                  style={{ flex: 1, minHeight: 44, fontSize: 13, fontWeight: 600 }}
                >
                  📋 Copy
                </button>
                <button
                  type="button"
                  onClick={() => shareViaWhatsApp(url, survey.title)}
                  style={{
                    flex: 1, minHeight: 44, fontSize: 13, fontWeight: 700,
                    background: '#25D366', color: '#fff', border: 'none',
                    borderRadius: 10, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  WhatsApp
                </button>
                {navigator.share && (
                  <button
                    type="button"
                    className="btn"
                    style={{ flex: 1, minHeight: 44, fontSize: 13, fontWeight: 600 }}
                    onClick={() => navigator.share({ title: survey.title, url }).catch(() => {})}
                  >
                    ↗ Share
                  </button>
                )}
                {canDeactivate && (
                  <button
                    type="button"
                    className="btn danger"
                    disabled={busy}
                    onClick={() => void handleDeactivate()}
                    style={{ flex: 1, minHeight: 44, fontSize: 13, fontWeight: 700 }}
                  >
                    {busy ? 'Stopping…' : 'Deactivate'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* recent web responses */}
          <div>
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
              Recent web responses
              <span style={{ marginLeft: 6, fontWeight: 400, color: '#64748b', fontSize: 12 }}>
                ({used} total)
              </span>
            </p>
            {recLoading ? (
              <p className="muted" style={{ fontSize: 13 }}>Loading…</p>
            ) : recents.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>No web responses yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recents.slice(0, 5).map((r) => {
                  const status = r.payload?.status || r.status || 'pending'
                  const name = r.payload?.answers?.name || r.payload?.name || r.payload?.answers?.respondent_name || '—'
                  const ts = fmt(r.payload?.submitted_at || r.created_at)
                  const statusColor = status === 'confirmed' ? '#059669' : status === 'rejected' ? '#dc2626' : '#f59e0b'
                  return (
                    <div key={r.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '8px 12px', background: '#f8fafc', borderRadius: 8,
                      border: '1px solid #e2e8f0', gap: 8, flexWrap: 'wrap',
                    }}>
                      <span style={{ fontSize: 13, color: '#334155', flex: 1 }}>{name}</span>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{ts}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: statusColor,
                        background: `${statusColor}18`, padding: '2px 8px', borderRadius: 99,
                      }}>
                        {status}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── main screen ─────────────────────────────────────────────── */
export default function AdminWebSurveyScreen({ onToast, user }) {
  const [surveys, setSurveys] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)  // form_key of open card
  const [search, setSearch] = useState('')
  const [activeLinks, setActiveLinks] = useState([])
  const [activeLoading, setActiveLoading] = useState(false)
  const [deactKey, setDeactKey] = useState('')
  const [reloadAt, setReloadAt] = useState(0)

  const isSuper = user?.role === 'super_admin'

  // Quick generator states
  const [genSurveyKey, setGenSurveyKey] = useState('')
  const [genQuota, setGenQuota] = useState(100)
  const [genBusy, setGenBusy] = useState(false)
  const [genUrl, setGenUrl] = useState('')
  const [genLockedKey, setGenLockedKey] = useState('')

  const selectedSurveyObj = surveys.find((s) => s.form_key === genSurveyKey) || null
  const genFrozen = Boolean(
    genSurveyKey && (
      genSurveyKey === genLockedKey ||
      (selectedSurveyObj?.web_link?.token && !selectedSurveyObj?.web_link?.expired)
    ),
  )

  useEffect(() => {
    if (surveys.length > 0 && !genSurveyKey) {
      setGenSurveyKey(surveys[0].form_key)
    }
  }, [surveys, genSurveyKey])

  useEffect(() => {
    const live = selectedSurveyObj?.web_link
    if (live?.token && !live.expired && live.max_uses) {
      setGenQuota(Number(live.max_uses) || 100)
    }
  }, [genSurveyKey, selectedSurveyObj?.web_link?.token, selectedSurveyObj?.web_link?.max_uses, selectedSurveyObj?.web_link?.expired])

  async function handleQuickGenerate() {
    if (!genSurveyKey) return
    if (genFrozen) {
      const token = selectedSurveyObj?.web_link?.token
      const u = (genUrl && genLockedKey === genSurveyKey)
        ? genUrl
        : (token ? webFillUrl(genSurveyKey, token) : '')
      if (!u) return
      setGenUrl(u)
      try { await navigator.clipboard.writeText(u) } catch { /* ignore */ }
      onToast?.('Link copied to clipboard ✓', 'ok')
      return
    }
    setGenBusy(true)
    try {
      const d = await mintWebFillUrl(genSurveyKey, genQuota)
      const u = d.url || ''
      setGenUrl(u)
      setGenLockedKey(genSurveyKey)
      if (d.max_uses) setGenQuota(Number(d.max_uses) || genQuota)
      try { await navigator.clipboard.writeText(u) } catch {}
      onToast?.(`Link generated & copied for "${selectedSurveyObj?.title || genSurveyKey}" ✓`, 'ok')
      setReloadAt((n) => n + 1)
      void load()
    } catch (e) {
      onToast?.(e.message || 'Could not generate link', 'error')
    } finally {
      setGenBusy(false)
    }
  }

  const loadActive = useCallback(async () => {
    if (!isSuper) {
      setActiveLinks([])
      return
    }
    setActiveLoading(true)
    try {
      const d = await listActiveWebFillLinks()
      setActiveLinks(d.items || [])
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setActiveLoading(false)
    }
  }, [isSuper, onToast])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await listSurveys()
      const items = (d.items || []).filter(
        (s) => s.form_key !== 'default' && s.form_key !== 'legacy',
      )
      setSurveys(items)
      setExpanded((cur) => {
        if (cur && items.some((s) => s.form_key === cur)) return cur
        const liveOne = items.find((s) => s.web_link?.token && !s.web_link?.expired)
        if (liveOne) return liveOne.form_key
        if (items.length === 1) return items[0].form_key
        return null
      })
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setLoading(false)
    }
    void loadActive()
  }, [onToast, loadActive])

  useEffect(() => { void load() }, [load])

  async function deactivateSurveyLink(formKey, title) {
    if (!formKey) return
    if (!window.confirm(`Deactivate the live web link for “${title || formKey}”? Copied URLs will stop working.`)) return
    setDeactKey(formKey)
    try {
      await deactivateWebFillLink(formKey)
      onToast?.(`“${title || formKey}” web link deactivated`, 'ok')
      setReloadAt((n) => n + 1)
      await load()
    } catch (e) {
      onToast?.(e.message || 'Could not deactivate', 'error')
    } finally {
      setDeactKey('')
    }
  }

  const filtered = surveys.filter((s) =>
    !search.trim() || (s.title || s.form_key).toLowerCase().includes(search.toLowerCase()),
  )

  const liveCount = surveys.filter((s) => {
    const l = s.web_link
    if (!l?.token) return false
    const cap = Number(l.max_uses) || 0
    const used = Math.max(Number(s.web_submissions) || 0, Number(l.use_count) || 0)
    return !l.expired && !(cap > 0 && used >= cap)
  }).length

  return (
    <div>
      {/* ── header ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
              🌐 Web Survey
              {liveCount > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: '#dcfce7', color: '#15803d',
                  fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99,
                  border: '1px solid #86efac',
                }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', background: '#16a34a',
                    animation: 'live-pulse 1.4s ease-in-out infinite', display: 'inline-block',
                  }} />
                  {liveCount} LIVE
                </span>
              )}
            </h2>
            <p className="muted" style={{ margin: '3px 0 0', fontSize: 13 }}>
              {isSuper
                ? 'See every live public fill link. Only Super Admin can deactivate. Ending a survey expires the link.'
                : 'Create links, track responses, share via WhatsApp. Super Admin deactivates links; Client Admin cannot.'
            </p>
          </div>
          <button
            type="button" className="btn small"
            onClick={() => void load()}
            style={{ minHeight: 40 }}
          >↻ Refresh</button>
        </div>
      </div>

      {isSuper && (
        <div className="card" style={{ padding: 16, marginBottom: 20, border: '1.5px solid #86efac', background: '#f0fdf4' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 16, color: '#14532d' }}>
              Active web links
              <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: '#15803d' }}>
                {activeLoading ? '…' : `${activeLinks.length} live`}
              </span>
            </h3>
          </div>
          {activeLoading ? (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>Loading live links…</p>
          ) : activeLinks.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>No active web links right now.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activeLinks.map((l) => {
                const url = l.url || webFillUrl(l.form_key, l.token)
                const used = Number(l.use_count) || 0
                const cap = Number(l.max_uses) || 0
                const busyThis = deactKey === l.form_key
                return (
                  <div
                    key={l.token || l.form_key}
                    style={{
                      background: '#fff',
                      border: '1px solid #bbf7d0',
                      borderRadius: 12,
                      padding: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      <div>
                        <strong style={{ fontSize: 14, color: '#0f172a' }}>{l.title || l.form_key}</strong>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                          {[l.company_name, l.owner_name].filter(Boolean).join(' · ') || '—'}
                          {cap > 0 ? ` · ${used.toLocaleString()} / ${cap.toLocaleString()} responses` : ''}
                          {l.created_at || l.starts_at ? ` · started ${fmt(l.starts_at || l.created_at)}` : ''}
                        </div>
                      </div>
                      <Pill label="LIVE" color="#15803d" bg="#dcfce7" dot="pulse" />
                    </div>
                    <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#334155', wordBreak: 'break-all', marginBottom: 8 }}>
                      {url}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn small"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(url)
                            onToast?.('Link copied ✓', 'ok')
                          } catch {
                            onToast?.(url, 'ok')
                          }
                        }}
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        className="btn small danger"
                        disabled={busyThis}
                        onClick={() => void deactivateSurveyLink(l.form_key, l.title)}
                      >
                        {busyThis ? 'Stopping…' : 'Deactivate'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Quick Link Generator Card ── */}
      <div className="card" style={{ padding: 18, marginBottom: 20, background: 'linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%)', border: '1.5px solid #86efac', borderRadius: 14, boxShadow: '0 4px 12px rgba(22, 163, 74, 0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#14532d', display: 'flex', alignItems: 'center', gap: 8 }}>
              ⚡ Quick Public Survey Link Generator
            </h3>
            <p className="muted" style={{ margin: '3px 0 0', fontSize: 12 }}>
              Select any survey by name, set response quota, and generate a shareable WhatsApp/Web link instantly.
            </p>
          </div>
          <span style={{ fontSize: 11, background: '#dcfce7', color: '#15803d', fontWeight: 700, padding: '3px 10px', borderRadius: 99, border: '1px solid #86efac' }}>
            Public Access · No Login Required
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, alignItems: 'flex-end' }}>
          <label className="field" style={{ margin: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b' }}>Select Survey by Name</span>
            <select
              value={genSurveyKey}
              onChange={(e) => setGenSurveyKey(e.target.value)}
              style={{ width: '100%', minHeight: 42, fontSize: 14, fontWeight: 600, background: '#fff', border: '1.5px solid #cbd5e1', borderRadius: 8 }}
            >
              {surveys.length === 0 ? (
                <option value="">No surveys found</option>
              ) : (
                surveys.map((s) => (
                  <option key={s.form_key} value={s.form_key}>
                    {s.title || s.form_key} {s.web_link?.token && !s.web_link?.expired ? '🟢 (Active Link)' : ''}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="field" style={{ margin: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b' }}>Response Quota (Max Uses)</span>
            <input
              type="number"
              min={1}
              max={9999}
              value={genQuota}
              disabled={genBusy || genFrozen}
              readOnly={genFrozen}
              onChange={(e) => setGenQuota(Math.max(1, Math.min(9999, Number(e.target.value) || 1)))}
              style={{
                width: '100%', minHeight: 42, fontSize: 14, fontWeight: 600,
                background: genFrozen ? '#f1f5f9' : '#fff',
                border: '1.5px solid #cbd5e1', borderRadius: 8,
                opacity: genFrozen ? 0.75 : 1,
              }}
            />
            {genFrozen && (
              <span style={{ fontSize: 11, color: '#64748b', marginTop: 4, display: 'block' }}>
                Quota locked after link generation
              </span>
            )}
          </label>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn primary"
              disabled={genBusy || !genSurveyKey}
              onClick={handleQuickGenerate}
              style={{ flex: 1, minHeight: 42, fontSize: 14, fontWeight: 700, background: '#16a34a', borderColor: '#15803d', boxShadow: '0 2px 6px rgba(22, 163, 74, 0.3)' }}
            >
              {genBusy ? 'Generating…' : genFrozen ? '📋 Copy link' : '🔗 Generate & Copy Link'}
            </button>
          </div>
        </div>

        {/* Live Generated URL display */}
        {genUrl && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: '#ffffff', border: '1.5px solid #86efac' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#15803d' }}>
                ✓ Live Link for: <strong>{selectedSurveyObj?.title || genSurveyKey}</strong>
              </span>
              <span style={{ fontSize: 11, color: '#64748b' }}>Quota: {genQuota} responses</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                readOnly
                value={genUrl}
                onFocus={(e) => e.target.select()}
                style={{ flex: 1, minWidth: 240, fontSize: 12, fontFamily: 'monospace', color: '#0f172a', background: '#f8fafc' }}
              />
              <button
                type="button"
                className="btn small"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(genUrl)
                    onToast?.('Link copied to clipboard ✓', 'ok')
                  } catch {
                    onToast?.(genUrl, 'ok')
                  }
                }}
                style={{ fontWeight: 700 }}
              >
                📋 Copy
              </button>
              <button
                type="button"
                className="btn small"
                onClick={() => shareViaWhatsApp(genUrl, selectedSurveyObj?.title || 'Survey')}
                style={{ background: '#25D366', color: '#fff', border: 'none', fontWeight: 700 }}
              >
                WhatsApp ↗
              </button>
              <a
                className="btn small"
                href={genUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open ↗
              </a>
            </div>
          </div>
        )}
      </div>

      {/* ── search ── */}
      {surveys.length > 2 && (
        <input
          type="search"
          placeholder="Search surveys by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', marginBottom: 14, minHeight: 44, fontSize: 15, boxSizing: 'border-box' }}
        />
      )}

      {/* ── survey cards ── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <p className="muted">Loading surveys…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '40px 20px',
          background: '#f8fafc', border: '1.5px dashed #cbd5e1', borderRadius: 14,
        }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🔗</div>
          <h3 style={{ margin: '0 0 6px', color: '#334155' }}>No surveys yet</h3>
          <p className="muted" style={{ fontSize: 13 }}>
            Create a survey first from the Surveys & Forms tab, then come back here to generate a web link.
          </p>
        </div>
      ) : (
        filtered.map((s) => (
          <SurveyWebCard
            key={s.form_key}
            survey={s}
            onToast={onToast}
            expanded={expanded === s.form_key}
            onToggle={() => setExpanded(expanded === s.form_key ? null : s.form_key)}
            canDeactivate={isSuper}
            reloadAt={reloadAt}
            onDeactivated={() => {
              setReloadAt((n) => n + 1)
              void load()
            }}
          />
        ))
      )}
    </div>
  )
}
