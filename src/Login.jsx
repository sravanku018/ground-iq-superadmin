import { useState } from 'react'
import { clearSession, login } from './api'
import { versionLabel } from './version'

/**
 * Surveyor field app login ONLY.
 * Credentials from Client Admin. No demo credentials on screen.
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
        <div className="fl-logo">S</div>
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

          <button type="submit" className="fl-submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: 'center', borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 14 }}>
          <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 8px' }}>Are you a Client Admin?</p>
          <a
            href="/admin"
            className="btn secondary small"
            style={{ display: 'inline-block', textDecoration: 'none', fontWeight: 600, padding: '8px 16px', background: 'rgba(255,255,255,0.08)', color: '#00e599', border: '1px solid rgba(0,229,153,0.3)', borderRadius: 8 }}
          >
            🛡️ Sign in to Client Admin Portal →
          </a>
        </div>

        <p className="fl-version" aria-label="Build version">
          {versionLabel()}
        </p>
      </main>
    </div>
  )
}
