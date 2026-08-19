import { useState } from 'react'
import { clearSession, login } from './api'
import { versionLabel } from './version'

/** Client Admin web portal login — clean form, no demo credentials.
 * superAdminOnly → separate Super Admin console (server-enforced expected_role=super_admin). */
export default function AdminLogin({ onSuccess, onToast, superAdminOnly = false }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [totpStep, setTotpStep] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
          <span className="portal-logo">◆</span>
          <div>
            <p className="eyebrow">Ground IQ</p>
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
                Issuer <strong>Ground IQ</strong> · account <strong>{totpStep.account || username}</strong>
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
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? 'Signing in…' : totpStep ? 'Verify & sign in' : 'Sign in'}
          </button>
        </form>
        <p className="app-version-foot" aria-label="App version">
          {versionLabel()}
        </p>
      </div>
    </div>
  )
}
