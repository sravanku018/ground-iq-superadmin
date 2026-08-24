import Icon from './Icons'
import { resetSuperAdminTotp, updateUser } from './api'
import CredentialsCard from './components/CredentialsCard'

/** Super Admin console — own account (name / password / TOTP). */
export default function AdminProfileScreen({ user, onToast, onUserUpdated }) {
  return (
    <div>
      <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="star" size={18} /> Super Admin profile
      </h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 20 }}>
        Platform account. Full powers (including web survey and Telugu translate) — no grant needed.
      </p>

      <CredentialsCard
        name={user?.name || user?.username}
        username={user?.username}
        role="Super Admin"
        avatar={(user?.name || user?.username || 'SA').slice(0, 2).toUpperCase()}
        onPasswordChange={async ({ displayName, newPw }) => {
          if (!user?.id) return
          const body = { name: displayName.trim() }
          if (newPw && newPw.trim()) {
            if (newPw.trim().length < 8) {
              onToast?.('Password min 8 characters', 'error')
              throw new Error('Password min 8 characters')
            }
            body.password = newPw.trim()
          }
          const res = await updateUser(user.id, body)
          const next = res.user || { ...user, name: displayName.trim() }
          onUserUpdated?.(next)
          onToast?.(
            res.password_changed ? 'Profile saved · password updated · other sessions revoked' : 'Profile saved',
            'ok',
          )
        }}
        onTotpReset={async () => {
          if (!window.confirm('Reset your authenticator? You will need the new secret to sign in.')) return null
          try {
            const res = await resetSuperAdminTotp(user.id)
            onToast?.('New TOTP secret — save it now', 'ok')
            return res.totp_secret
          } catch (e) {
            onToast?.(e.message, 'error')
            return null
          }
        }}
      />
    </div>
  )
}
