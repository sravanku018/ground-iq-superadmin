import { useState } from 'react'
import Icon from './Icons'
import { resetSuperAdminTotp, updateUser } from './api'
import VerifiedBadge from './VerifiedBadge'

/** Super Admin console — own account (name / password). */
export default function AdminProfileScreen({ user, onToast, onUserUpdated }) {
  const [name, setName] = useState(user?.name || user?.username || '')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [totpSetup, setTotpSetup] = useState(null)
  const [totpBusy, setTotpBusy] = useState(false)

  async function save(e) {
    e.preventDefault()
    if (!user?.id) return
    setSaving(true)
    try {
      const body = { name: name.trim() }
      if (password.trim()) {
        if (password.trim().length < 8) {
          onToast?.('Password min 8 characters', 'error')
          setSaving(false)
          return
        }
        body.password = password.trim()
      }
      const res = await updateUser(user.id, body)
      const next = res.user || { ...user, name: name.trim() }
      onUserUpdated?.(next)
      setPassword('')
      onToast?.(
        res.password_changed ? 'Profile saved · password updated · other sessions revoked' : 'Profile saved',
        'ok',
      )
    } catch (err) {
      onToast?.(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="star" size={18} /> Super Admin profile
      </h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Platform account. Full powers (including web survey and Telugu translate) — no grant needed.
      </p>

      <div className="card" style={{ maxWidth: 480, marginBottom: 16 }}>
        <p style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <strong>{user?.name || user?.username}</strong>
          {user?.verified ? <VerifiedBadge size={16} /> : null}
        </p>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          @{user?.username} · super_admin
          {user?.key_id ? ` · Key ${user.key_id}` : ''}
        </p>
      </div>

      <form onSubmit={save} className="card" style={{ maxWidth: 480 }}>
        <label className="field">
          <span>Display name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        <label className="field">
          <span>New password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="Leave blank to keep"
          />
        </label>
        <button type="submit" className="btn primary" disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </form>

      <div className="card" style={{ maxWidth: 480, marginTop: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Authenticator (TOTP)</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          All 3 Super Admin slots sign in with password + a 6-digit app code.
        </p>
        <button
          type="button"
          className="btn small"
          disabled={totpBusy || !user?.id}
          onClick={async () => {
            if (!window.confirm('Reset your authenticator? You will need the new secret to sign in.')) return
            setTotpBusy(true)
            try {
              const res = await resetSuperAdminTotp(user.id)
              setTotpSetup(res)
              onToast?.('New TOTP secret — save it now', 'ok')
            } catch (e) {
              onToast?.(e.message, 'error')
            } finally {
              setTotpBusy(false)
            }
          }}
        >
          {totpBusy ? 'Resetting…' : 'Reset my TOTP'}
        </button>
        {totpSetup?.totp_secret ? (
          <div style={{ marginTop: 12 }}>
            <code style={{ display: 'block', wordBreak: 'break-all', fontWeight: 700 }}>
              {totpSetup.totp_secret}
            </code>
            {totpSetup.otpauth_url ? (
              <a href={totpSetup.otpauth_url} style={{ display: 'inline-block', marginTop: 8, fontSize: 12 }}>
                Open otpauth link
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
