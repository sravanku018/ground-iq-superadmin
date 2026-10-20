import { useEffect, useState } from 'react'
import { clearSession, login } from './api'
import {
  authenticateBiometric,
  biometricStatus,
  nativeBiometricSupported,
  offerBiometricAfterLogin,
} from './nativeBiometric'
import {
  passkeyError,
  passkeyLogin,
  webPasskeySupported,
} from './webauthn'
import logoMark from './assets/logo-mark.png'

/** Client Admin web portal login — clean form, no demo credentials.
 * superAdminOnly → separate Super Admin console (server-enforced expected_role=super_admin). */
export default function AdminLogin({ onSuccess, onToast, superAdminOnly = false }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [totpStep, setTotpStep] = useState(null)
  const [loading, setLoading] = useState(false)
  const [bioLoading, setBioLoading] = useState(false)
  const [bioReady, setBioReady] = useState(false)
  const [bioStatus, setBioStatus] = useState(null)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [error, setError] = useState('')
  const nativeBio = nativeBiometricSupported() && !superAdminOnly
  const webPasskey = !nativeBio && !superAdminOnly && webPasskeySupported()

  useEffect(() => {
    if (!nativeBio) return undefined
    let cancelled = false
    biometricStatus()
      .then((st) => {
        if (!cancelled) {
          setBioStatus(st || null)
          setBioReady(!!st?.available && !!st?.hasToken)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [nativeBio])

  async function handleNativeUnlock() {
    setError('')
    setBioLoading(true)
    try {
      const data = await authenticateBiometric('admin')
      if (data.user?.role !== 'admin') {
        clearSession()
        throw new Error('Client Admin portal only.')
      }
      onToast?.(`Welcome ${data.user.name}`, 'ok')
      onSuccess?.(data.user)
    } catch (e) {
      const msg = e?.message || 'Fingerprint unlock failed'
      setError(msg)
      onToast?.(msg, 'error')
    } finally {
      setBioLoading(false)
    }
  }

  async function handlePasskey() {
    setError('')
    if (!username.trim()) {
      const msg = 'Enter your username first, then use fingerprint.'
      setError(msg)
      onToast?.(msg, 'error')
      return
    }
    setPasskeyLoading(true)
    try {
      const data = await passkeyLogin(username.trim(), 'admin')
      if (data.user?.role !== 'admin') {
        clearSession()
        throw new Error('Client Admin portal only.')
      }
      onToast?.(`Welcome ${data.user.name}`, 'ok')
      onSuccess?.(data.user)
    } catch (e) {
      const msg = e?.name
        ? passkeyError(e)
        : e.message || 'Fingerprint/passkey sign-in failed'
      setError(msg)
      onToast?.(msg, 'error')
    } finally {
      setPasskeyLoading(false)
    }
  }

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password) {
      const msg = 'Enter username and password'
      setError(msg)
      onToast?.(msg, 'error')
      return
    }
    if (totpStep && !String(totp).replace(/\s/g, '').match(/^\d{6}$/)) {
      const msg = 'Enter the 6-digit authenticator code'
      setError(msg)
      onToast?.(msg, 'error')
      return
    }
    setLoading(true)
    try {
      clearSession()
      const data = await login(
        username.trim(),
        password,
        superAdminOnly ? 'super_admin' : 'admin',
        totpStep ? totp.replace(/\s/g, '') : undefined,
      )
      const okRole = superAdminOnly
        ? data.user?.role === 'super_admin'
        : data.user?.role === 'admin' || data.user?.role === 'super_admin'
      if (!okRole) {
        clearSession()
        throw new Error(
          superAdminOnly ? 'Super Admin console only.' : 'Client Admin portal only.',
        )
      }
      if (nativeBio) {
        const enabled = await offerBiometricAfterLogin(
          data.user?.username || username.trim(),
        )
        if (enabled) onToast?.('Fingerprint unlock enabled', 'ok')
      }
      onToast?.(`Welcome ${data.user.name}`, 'ok')
      onSuccess?.(data.user)
    } catch (err) {
      if (err.totp_required || err.data?.totp_required) {
        setTotpStep(err.data || { totp_required: true })
        setTotp('')
        const msg = err.message || 'Authenticator code required'
        setError(msg)
        onToast?.(msg, 'error')
        setLoading(false)
        return
      }
      const msg =
        err.status === 429
          ? 'Too many login attempts — please wait 60 seconds.'
          : err.message || 'Login failed'
      setError(msg)
      onToast?.(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="portal-login">
      <div className="portal-login-card">
        <div className="portal-brand">
          <img className="portal-logo" src={logoMark} alt="Smart Survey X" />
          <div>
            <p className="eyebrow">Smart Survey X</p>
            <h1>{superAdminOnly ? 'Super Admin Console' : 'Client Admin'}</h1>
          </div>
        </div>
        <p className="login-sub">
          {superAdminOnly
            ? 'Sign in to manage the platform, all tenants and teams.'
            : 'Sign in to manage surveys and surveyors.'}
        </p>
        <form onSubmit={handleLogin} className="login-form">
          <label className="field">
            <span>Username</span>
            <input
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoFocus
              placeholder="Username"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
            />
          </label>
          {totpStep ? (
            <label className="field">
              <span>Authenticator code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                placeholder="6-digit code"
                autoFocus
              />
            </label>
          ) : null}
          {totpStep?.totp_setup && totpStep.totp_secret ? (
            <div className="card" style={{ margin: '0 0 10px', padding: 12, background: '#fffbeb' }}>
              <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700 }}>
                Add this slot to Google Authenticator / Authy
              </p>
              <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
                Issuer <strong>Smart Survey X</strong> · account <strong>{totpStep.account || username}</strong>
              </p>
              <code style={{ display: 'block', wordBreak: 'break-all', fontSize: 13, fontWeight: 700 }}>
                {totpStep.totp_secret}
              </code>
              {totpStep.otpauth_url ? (
                <a
                  href={totpStep.otpauth_url}
                  style={{ display: 'inline-block', marginTop: 8, fontSize: 12 }}
                >
                  Open in authenticator app
                </a>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <div className="login-alert" role="alert">
              {error}
            </div>
          ) : null}
          <button type="submit" className="btn primary" disabled={loading || bioLoading || passkeyLoading}>
            {loading ? 'Signing in…' : totpStep ? 'Verify & sign in' : 'Sign in'}
          </button>
          {bioReady ? (
            <>
              <button
                type="button"
                className="btn"
                style={{ marginTop: 10 }}
                onClick={handleNativeUnlock}
                disabled={loading || bioLoading}
              >
                {bioLoading ? 'Waiting for fingerprint…' : '🔒 Unlock with fingerprint'}
              </button>
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 11 }}>
                Uses the fingerprint saved on this phone. No passkey.
              </p>
            </>
          ) : null}
          {webPasskey ? (
            <>
              <button
                type="button"
                className="btn"
                style={{ marginTop: 10 }}
                onClick={handlePasskey}
                disabled={loading || bioLoading || passkeyLoading}
              >
                {passkeyLoading ? 'Waiting for fingerprint…' : '🔒 Sign in with fingerprint / passkey'}
              </button>
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 11 }}>
                Web browsers call this a “passkey”. First sign in with your password,
                then enable it under Organization → Fingerprint / passkey.
              </p>
            </>
          ) : null}
          {nativeBio && bioStatus && !bioStatus.hasToken ? (
            <p className="fl-lead" style={{ margin: '10px 0 0', fontSize: 11 }}>
              {bioStatus.available
                ? 'Fingerprint unlock is not set up yet. Sign in with your password once, then enable it in Profile → Fingerprint unlock.'
                : 'No fingerprint is enrolled on this phone. Add one in Android Settings, then enable fingerprint unlock in Profile.'}
            </p>
          ) : null}
        </form>

        <div style={{ marginTop: 20, textAlign: 'center', borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
          {superAdminOnly ? (
            <p style={{ fontSize: 13, margin: '0 0 10px' }}>
              <a href="/admin" style={{ color: '#4f7dc6', fontWeight: 600, textDecoration: 'none' }}>
                ← Switch to Client Admin portal
              </a>
            </p>
          ) : (
            <p style={{ fontSize: 13, margin: '0 0 10px' }}>
              <a href="/?super=1" style={{ color: '#64748b', fontWeight: 600, textDecoration: 'none' }}>
                👑 Super Admin console →
              </a>
            </p>
          )}
          {/* Surveyor field app link (hidden in standalone PWA) */}
          {!(typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone)) && (
            <>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 8px' }}>Surveyor collecting field data?</p>
              <a
                href="/field"
                className="btn secondary small"
                style={{ display: 'inline-block', textDecoration: 'none', fontWeight: 600, padding: '8px 16px' }}
              >
                📱 Switch to Surveyor Field App →
              </a>
            </>
          )}

          {/* Client Admin PWA install helper */}
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone)) {
                  onToast?.('Client Admin portal is already installed ✓', 'ok')
                } else {
                  window.alert(
                    '💻📱 Install Client Admin Portal as an App:\n\n• On Chrome/Edge (PC/Mac/Android): Click the Install icon in the address bar or menu (⋮) → "Install App".\n• On iPhone/iPad (Safari): Tap Share (↑) → "Add to Home Screen".\n\nRuns standalone with instant updates!',
                  )
                }
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748b',
                fontSize: 12,
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              💻📱 Install Client Admin Portal (PWA)
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
