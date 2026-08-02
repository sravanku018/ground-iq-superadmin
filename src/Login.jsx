import { useState } from 'react'
import { clearSession, login } from './api'
import { versionLabel } from './version'

/**
 * Surveyor field app login ONLY.
 * Credentials must be created by Client Admin (Users / generate).
 * No self-signup. Admins must use /admin portal.
 */
export default function LoginScreen({ onSuccess, onToast }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password) {
      setError('Enter the username and password from Client Admin')
      onToast?.('Enter username and password', 'error')
      return
    }
    setLoading(true)
    try {
      clearSession()
      // Server enforces expected_role=surveyor — admin logins rejected here
      const data = await login(username.trim(), password, 'surveyor')
      const role = data.user?.role
      if (role !== 'surveyor') {
        clearSession()
        const msg =
          role === 'admin'
            ? 'Client Admin uses the web portal (/admin), not this app.'
            : 'Not a surveyor login. Ask Client Admin to create your app access.'
        setError(msg)
        throw new Error(msg)
      }
      if (data.user?.active === false) {
        clearSession()
        const msg = 'Account disabled. Contact Client Admin.'
        setError(msg)
        throw new Error(msg)
      }
      onToast?.(`Hi ${data.user.name}`, 'ok')
      onSuccess?.(data.user)
    } catch (err) {
      const msg =
        err.message ||
        'Login failed. Use the surveyor username/password Client Admin created.'
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
        <div className="fl-logo">G</div>
        <div>
          <p className="fl-brand">Ground IQ</p>
          <p className="fl-tag">Field Survey App</p>
        </div>
      </header>

      <main className="fl-main">
        <h1 className="fl-title">Surveyor sign in</h1>
        <p className="fl-lead">
          Use the <strong>username &amp; password created by Client Admin</strong>. There is no
          self-registration.
        </p>

        <form className="fl-form" onSubmit={handleLogin} autoComplete="on">
          <label className="fl-label">
            Username (from admin)
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
              placeholder="e.g. s001"
            />
          </label>

          <label className="fl-label">
            Password (from admin)
            <div className="fl-pass-wrap">
              <input
                className="fl-input"
                name="password"
                type={showPass ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password from admin"
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

          <button type="submit" className="fl-submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in to field app'}
          </button>
        </form>

        <div className="fl-admin-hint">
          <p>
            <strong>No account?</strong> Ask Client Admin to open the portal →{' '}
            <strong>Users</strong> → create or generate surveyors, then give you username +
            password.
          </p>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Client Admin portal → <a href="/admin">/admin</a> (not this screen)
          </p>
        </div>

        <p className="fl-hint">
          Demo (if seeded) · <span>s001</span> / <span>survey123</span>
        </p>

        <p className="fl-version" aria-label="Build version">
          {versionLabel()}
        </p>
      </main>
    </div>
  )
}
