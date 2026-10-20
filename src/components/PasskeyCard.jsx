import { useCallback, useEffect, useState } from 'react'
import { nativeBiometricSupported } from '../nativeBiometric'
import {
  enableWebPasskey,
  getPasskeyStatus,
  passkeyError,
  removeWebPasskey,
  webPasskeySupported,
} from '../webauthn'

/**
 * Web-only fingerprint/passkey setup card. Hidden in the Android app, where
 * native fingerprint unlock is used instead.
 */
export default function PasskeyCard({ onToast }) {
  const isNative = nativeBiometricSupported()
  const supported = webPasskeySupported()
  const [count, setCount] = useState(null)
  const [loading, setLoading] = useState(supported)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!supported) return
    setLoading(true)
    try {
      const data = await getPasskeyStatus()
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

  if (isNative) return null
  if (!supported) {
    return (
      <div className="card" style={{ marginTop: 16, padding: 16 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>
          Fingerprint / passkey (web)
        </h3>
        <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
          This browser does not support fingerprint/passkey login. Use Chrome,
          Edge, or Safari over HTTPS. The Android APK has native fingerprint
          unlock with no passkey.
        </p>
      </div>
    )
  }

  async function enable() {
    setBusy(true)
    try {
      await enableWebPasskey()
      await load()
      onToast?.('Fingerprint / passkey login enabled on this device', 'ok')
    } catch (e) {
      onToast?.(passkeyError(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm('Remove fingerprint/passkey login from all devices for this account?')) {
      return
    }
    setBusy(true)
    try {
      await removeWebPasskey()
      setCount(0)
      onToast?.('Fingerprint / passkey login removed', 'ok')
    } catch (e) {
      onToast?.(e.message || 'Could not remove fingerprint/passkey login', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ marginTop: 16, padding: 16 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>
        Fingerprint / passkey (web)
      </h3>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 12, lineHeight: 1.5 }}>
        Browsers can only use the fingerprint sensor through a passkey. Your
        browser may say “Create a passkey” or “Use a passkey” — confirm with
        your fingerprint, face, or screen lock. The fingerprint itself never
        leaves your device.
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
          {busy ? 'Waiting for fingerprint…' : count > 0 ? 'Add this device' : 'Enable fingerprint / passkey'}
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
        In the Android app, fingerprint unlock uses the native sensor with no passkey.
      </p>
    </div>
  )
}
