import { useCallback, useEffect, useState } from 'react'
import {
  enableFingerprint,
  fingerprintError,
  fingerprintSupported,
  getFingerprintStatus,
  removeFingerprint,
} from '../webauthn'

/**
 * Profile card: register/remove this device's fingerprint or passkey.
 * Visible only when the browser supports WebAuthn on a secure origin.
 */
export default function FingerprintCard({ onToast }) {
  const supported = fingerprintSupported()
  const [count, setCount] = useState(null)
  const [loading, setLoading] = useState(supported)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!supported) return
    setLoading(true)
    try {
      const data = await getFingerprintStatus()
      setCount(Number(data?.count) || 0)
    } catch (e) {
      onToast?.(e.message || 'Could not read fingerprint settings', 'error')
    } finally {
      setLoading(false)
    }
  }, [onToast, supported])

  useEffect(() => {
    void load()
  }, [load])

  async function enable() {
    setBusy(true)
    try {
      await enableFingerprint()
      await load()
      onToast?.('Fingerprint login enabled on this device', 'ok')
    } catch (e) {
      onToast?.(fingerprintError(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm('Remove fingerprint login from all devices for this account?')) {
      return
    }
    setBusy(true)
    try {
      await removeFingerprint()
      setCount(0)
      onToast?.('Fingerprint login removed', 'ok')
    } catch (e) {
      onToast?.(e.message || 'Could not remove fingerprint login', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!supported) {
    return (
      <div className="card" style={{ marginTop: 16, padding: 16 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>
          Fingerprint login
        </h3>
        <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
          This browser or device does not support fingerprint / passkey sign-in.
          Use the Android app or a modern browser over HTTPS.
        </p>
      </div>
    )
  }

  return (
    <div className="card" style={{ marginTop: 16, padding: 16 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>
        Fingerprint login
      </h3>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 12, lineHeight: 1.5 }}>
        Sign in with your phone or laptop fingerprint instead of typing the
        password. The fingerprint itself never leaves your device.
      </p>
      <p className={`pill ${count > 0 ? 'ok' : 'warn'}`} style={{ margin: '0 0 12px' }}>
        <span className="dot" />
        {loading
          ? 'Checking…'
          : count > 0
            ? `Enabled on ${count} device${count === 1 ? '' : 's'}`
            : 'Not set up on this account'}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void enable()}>
          {busy ? 'Waiting for fingerprint…' : count > 0 ? 'Add this device' : 'Enable fingerprint'}
        </button>
        {count > 0 && (
          <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}>
            Remove all
          </button>
        )}
        <button type="button" className="btn small" disabled={loading || busy} onClick={() => void load()}>
          ↻ Check status
        </button>
      </div>
      <p className="muted" style={{ margin: '10px 0 0', fontSize: 11 }}>
        Set up one device per browser. Passkeys may sync with your Google/Apple account.
      </p>
    </div>
  )
}
