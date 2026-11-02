/**
 * Mandatory APK update prompt shown only when a sync is attempted.
 * It never blocks capture or the local queue: closing it keeps recording and
 * leaves packages on the phone. A failed download offers retry + direct link.
 */
import { useState } from 'react'
import { launchApkUpdate } from './appUpdate'

export default function MandatoryUpdatePrompt({ latest, onClose, onToast }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!latest) return null

  const handleUpdate = async () => {
    setBusy(true)
    setError('')
    try {
      await launchApkUpdate(latest.apkUrl)
      onToast?.('Update started — the recording queue is safe on this phone', 'ok')
    } catch (e) {
      const message = e?.message || 'Update download failed'
      setError(message)
      onToast?.(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Update available"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 84,
        transform: 'translateX(-50%)',
        width: 'calc(100% - 24px)',
        maxWidth: 460,
        zIndex: 99998,
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        border: '1px solid rgba(56, 189, 248, 0.45)',
        borderRadius: 14,
        padding: '14px 16px',
        boxShadow: '0 18px 40px -12px rgba(0,0,0,0.7)',
        color: '#f8fafc',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <strong style={{ fontSize: 14, color: '#38bdf8' }}>
          Update available
        </strong>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 18, cursor: 'pointer' }}
        >
          ×
        </button>
      </div>
      <p style={{ margin: '6px 0 10px', fontSize: 13, color: '#cbd5e1', lineHeight: 1.45 }}>
        Install v{latest.version} for the latest fixes. Your answers, photo and voice
        stay safely on this phone, and syncing continues either way.
      </p>
      {error ? (
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#fca5a5', lineHeight: 1.4 }}>
          {error}. Retry below or use the direct download link.
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleUpdate()}
          style={{
            flex: 1, minWidth: 130, padding: '9px 12px', borderRadius: 8,
            background: '#0284c7', color: '#fff', border: 'none',
            fontWeight: 600, fontSize: 13, cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Downloading…' : 'Update now'}
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{
            flex: 1, minWidth: 130, padding: '9px 12px', borderRadius: 8,
            background: 'transparent', color: '#cbd5e1',
            border: '1px solid rgba(148,163,184,0.35)', fontSize: 13, cursor: 'pointer',
          }}
        >
          Not now
        </button>
      </div>
      <a
        href={latest.apkUrl}
        target="_blank"
        rel="noreferrer"
        style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: '#7dd3fc' }}
      >
        Download APK directly
      </a>
    </div>
  )
}
