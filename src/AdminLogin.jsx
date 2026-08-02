import { useState } from 'react'
import { clearSession, login } from './api'
import { versionLabel } from './version'

/** Client Admin web portal login */
export default function AdminLogin({ onSuccess, onToast }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    if (!username.trim() || !password) {
      onToast?.('Enter username and password', 'error')
      return
    }
    setLoading(true)
    try {
      clearSession()
      // Server enforces expected_role=admin — surveyor field logins rejected here
      const data = await login(username.trim(), password, 'admin')
      if (data.user?.role !== 'admin') {
        clearSession()
        throw new Error('Client Admin portal only. Surveyors use the field app.')
      }
      onToast?.(`Welcome ${data.user.name}`, 'ok')
      onSuccess?.(data.user)
    } catch (err) {
      onToast?.(err.message || 'Login failed', 'error')
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
            <h1>Client Admin Portal</h1>
          </div>
        </div>
        <p className="login-sub">
          Create surveyor logins here — they sign in only on the field app (not this portal).
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
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? 'Signing in…' : 'Open portal'}
          </button>
        </form>
        <div className="role-hint single">
          <div>
            <strong>Demo</strong>
            <code>admin / admin123</code>
          </div>
        </div>
        <p className="portal-foot">
          Surveyor field app → <a href="/">open field app</a>
        </p>
        <p className="app-version-foot" aria-label="App version">
          {versionLabel()}
        </p>
      </div>
    </div>
  )
}
