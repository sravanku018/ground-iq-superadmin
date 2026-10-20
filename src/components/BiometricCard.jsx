import { useCallback, useEffect, useState } from 'react'
import {
  biometricStatus,
  disableBiometricUnlock,
  enableBiometricUnlock,
  nativeBiometricSupported,
} from '../nativeBiometric'

/**
 * Profile card: enable/remove native Android fingerprint unlock.
 * Renders only in the APK; the web app has no direct fingerprint API.
 */
export default function BiometricCard({ user, onToast }) {
  const supported = nativeBiometricSupported()
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(supported)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!supported) return
    setLoading(true)
    try {
      setStatus(await biometricStatus())
    } catch (e) {
      onToast?.(e.message || 'Could not read fingerprint settings', 'error')
    } finally {
      setLoading(false)
    }
  }, [onToast, supported])

  useEffect(() => {
    void load()
  }, [load])

  if (!supported) return null

  const available = status?.available === true
  const enabled = status?.hasToken === true

  async function enable() {
    setBusy(true)
    try {
      await enableBiometricUnlock(user?.username)
      await load()
      onToast?.('Fingerprint unlock enabled on this phone', 'ok')
    } catch (e) {
      onToast?.(e.message || 'Fingerprint unlock was cancelled', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm('Remove fingerprint unlock from this phone?')) return
    setBusy(true)
    try {
      await disableBiometricUnlock()
      setStatus((prev) => ({ ...prev, hasToken: false }))
      onToast?.('Fingerprint unlock removed', 'ok')
    } catch (e) {
      onToast?.(e.message || 'Could not remove fingerprint unlock', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ marginTop: 16, padding: 16 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>
        Fingerprint unlock
      </h3>
      <p className="muted" style={{ margin: '0 0 10px', fontSize: 12, lineHeight: 1.5 }}>
        Unlock this app with your phone fingerprint instead of typing the password.
        No passkey is used.
      </p>
      <p
        className={`pill ${enabled ? 'ok' : 'warn'}`}
        style={{ margin: '0 0 12px' }}
      >
        <span className="dot" />
        {loading
          ? 'Checking…'
          : !available
            ? 'Add a fingerprint in Android Settings first'
            : enabled
              ? 'Enabled on this phone'
              : 'Not set up on this phone'}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn primary"
          disabled={busy || loading || !available}
          onClick={() => void enable()}
        >
          {busy ? 'Waiting for fingerprint…' : enabled ? 'Replace fingerprint' : 'Enable fingerprint unlock'}
        </button>
        {enabled && (
          <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}>
            Remove
          </button>
        )}
        <button type="button" className="btn small" disabled={loading || busy} onClick={() => void load()}>
          ↻ Check
        </button>
      </div>
      <p className="muted" style={{ margin: '10px 0 0', fontSize: 11 }}>
        The app stores an encrypted device token on this phone. Your password is never stored.
      </p>
    </div>
  )
}
