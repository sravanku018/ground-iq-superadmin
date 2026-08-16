import { useState } from 'react'
import { clearSession, login } from './api'
import { versionLabel } from './version'

/** Client Admin web portal login — clean form, no demo credentials.
 * superAdminOnly → separate Super Admin console (server-enforced expected_role=super_admin). */
export default function AdminLogin({ onSuccess, onToast, superAdminOnly = false }) {
  const [username, setUsername] = useState('')
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
      const data = await login(
        username.trim(),
        password,
        superAdminOnly ? 'super_admin' : 'admin',
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
      const msg =
        err.status === 429
          ? 'Too many login attempts — please wait 60 seconds.'
          : err.message || 'Login failed'
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
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="app-version-foot" aria-label="App version">
          {versionLabel()}
        </p>
      </div>
    </div>
  )
}
