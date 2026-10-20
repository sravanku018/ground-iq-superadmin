import { useEffect, useState } from 'react'
import { clearSession, login } from './api'
import { versionLabel } from './version'
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

/**
 * Surveyor field app login ONLY.
 * Credentials from Client Admin. No demo credentials on screen.
 */
export default function LoginScreen({ onSuccess, onToast }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [bioLoading, setBioLoading] = useState(false)
  const [bioReady, setBioReady] = useState(false)
  const [bioStatus, setBioStatus] = useState(null)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [error, setError] = useState('')
  const nativeBio = nativeBiometricSupported()
  const webPasskey = !nativeBio && webPasskeySupported()

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
      const data = await authenticateBiometric('surveyor')
      if (data.user?.role !== 'surveyor') {
        clearSession()
        throw new Error('This fingerprint is not a surveyor login.')
      }
      if (data.user?.active === false) {
        clearSession()
        throw new Error('Account disabled.')
      }
      onToast?.(`Hi ${data.user.name}`, 'ok')
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
      const data = await passkeyLogin(username.trim(), 'surveyor')
      if (data.user?.role !== 'surveyor') {
        clearSession()
        throw new Error('This fingerprint is not a surveyor login.')
      }
      if (data.user?.active === false) {
        clearSession()
        throw new Error('Account disabled.')
      }
      onToast?.(`Hi ${data.user.name}`, 'ok')
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
      setError('Enter username and password')
      onToast?.('Enter username and password', 'error')
      return
    }
    setLoading(true)
    try {
      clearSession()
      const data = await login(username.trim(), password, 'surveyor')
      const role = data.user?.role
      if (role === 'admin' || role === 'super_admin') {
        onToast?.(`Welcome ${data.user.name || data.user.username}`, 'ok')
        window.location.href = '/admin'
        return
      }
      if (role !== 'surveyor') {
        clearSession()
        const msg = 'Invalid surveyor login.'
        setError(msg)
        throw new Error(msg)
      }
      if (data.user?.active === false) {
        clearSession()
        const msg = 'Account disabled.'
        setError(msg)
        throw new Error(msg)
      }
      if (nativeBio) {
        const enabled = await offerBiometricAfterLogin(
          data.user?.username || username.trim(),
        )
        if (enabled) onToast?.('Fingerprint unlock enabled', 'ok')
      }
      onToast?.(`Hi ${data.user.name}`, 'ok')
      onSuccess?.(data.user)
    } catch (err) {
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
    <div className="fl-root">
      <div className="fl-bg" aria-hidden />

      <header className="fl-header">
        <img className="fl-logo" src={logoMark} alt="Smart Survey X" />
        <div>
          <p className="fl-brand">Smart Survey X</p>
          <p className="fl-tag">Field Survey App</p>
        </div>
      </header>

      <main className="fl-main">
        <h1 className="fl-title">Sign in</h1>
        <p className="fl-lead">Surveyor access only.</p>

        <form className="fl-form" onSubmit={handleLogin} autoComplete="on">
          <label className="fl-label">
            Username
            <input
              className="fl-input"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              placeholder="Username"
            />
          </label>

          <label className="fl-label">
            Password
            <div className="fl-pass-wrap">
              <input
                className="fl-input"
                name="password"
                type={showPass ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
              />
              <button
                type="button"
                className="fl-eye"
                onClick={() => setShowPass((v) => !v)}
                aria-label={showPass ? 'Hide password' : 'Show password'}
              >
                {showPass ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          {error ? (
            <div className="fl-error" role="alert">
              {error}
            </div>
          ) : null}

          <button type="submit" className="fl-submit" disabled={loading || bioLoading || passkeyLoading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

          {bioReady ? (
            <>
              <button
                type="button"
                className="fl-submit"
                style={{
                  marginTop: 10,
                  background: 'rgba(255,255,255,0.10)',
                  color: '#e2e8f0',
                  border: '1px solid rgba(255,255,255,0.18)',
                }}
                onClick={handleNativeUnlock}
                disabled={loading || bioLoading}
              >
                {bioLoading ? 'Waiting for fingerprint…' : '🔒 Unlock with fingerprint'}
              </button>
              <p className="fl-lead" style={{ margin: '8px 0 0', fontSize: 11 }}>
                Uses the fingerprint saved on this phone. No passkey.
              </p>
            </>
          ) : null}
          {webPasskey ? (
            <>
              <button
                type="button"
                className="fl-submit"
                style={{
                  marginTop: 10,
                  background: 'rgba(255,255,255,0.10)',
                  color: '#e2e8f0',
                  border: '1px solid rgba(255,255,255,0.18)',
                }}
                onClick={handlePasskey}
                disabled={loading || bioLoading || passkeyLoading}
              >
                {passkeyLoading ? 'Waiting for fingerprint…' : '🔒 Sign in with fingerprint / passkey'}
              </button>
              <p className="fl-lead" style={{ margin: '8px 0 0', fontSize: 11 }}>
                Web browsers call this a “passkey”. First sign in with your password,
                then enable it in Profile — confirm with fingerprint or screen lock.
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

        {/* Hide Client Admin link when launched as installed standalone PWA app */}
        {!(typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone)) && (
          <div style={{ marginTop: 20, textAlign: 'center', borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 14 }}>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 8px' }}>Are you a Client Admin?</p>
            <a
              href="/admin"
              className="btn secondary small"
              style={{ display: 'inline-block', textDecoration: 'none', fontWeight: 600, padding: '8px 16px', background: 'rgba(255,255,255,0.08)', color: '#4f7dc6', border: '1px solid rgba(79,125,198,0.4)', borderRadius: 8 }}
            >
              🛡️ Sign in to Client Admin Portal →
            </a>
          </div>
        )}

        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => {
              if (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone) {
                onToast?.('App is already installed on this phone ✓', 'ok')
              } else {
                window.alert(
                  '📱 To install this surveyor app on your home screen:\n\n1. In Chrome: Tap the 3 dots (⋮) in the top-right corner.\n2. Tap "Add to Home screen" or "Install App".\n3. Tap Add/Install.\n\nThe app will now appear on your home screen and works offline!',
                )
              }
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: 12,
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            📱 Install as Home Screen App (PWA)
          </button>
        </div>

        <p className="fl-version" aria-label="Build version">
          {versionLabel()}
        </p>
      </main>
    </div>
  )
}
