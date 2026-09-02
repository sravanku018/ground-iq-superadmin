import { useState } from 'react'
import { mintWebFillUrl } from '../api'

export default function CopyWebFillLink({ formKey, title, onToast }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  async function mintAndCopy() {
    const key = String(formKey || '').trim()
    if (!key || key === 'default' || key === 'legacy') {
      onToast?.('Pick a survey first', 'error')
      return
    }
    setBusy(true)
    try {
      const link = await mintWebFillUrl(key)
      setUrl(link)
      try {
        await navigator.clipboard.writeText(link)
        onToast?.(`One-time web link copied${title ? ` · ${title}` : ''}`, 'ok')
      } catch {
        onToast?.(link, 'ok')
      }
    } catch (e) {
      onToast?.(e.message || 'Could not create link', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ margin: '0 0 12px' }}>
      <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700 }}>Web survey link (one-time)</p>
      <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
        Copy creates a new link. After the recipient submits, that link expires and cannot be used
        again. Copy again for the next person.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          readOnly
          value={url}
          placeholder="Click Copy to create a one-time link"
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
