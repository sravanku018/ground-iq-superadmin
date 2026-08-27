import { resetSuperAdminTotp, updateUser } from './api'
import CredentialsCard from './components/CredentialsCard'


/** Admin console — own account (name / password / TOTP for Super Admin; Granted powers for Client Admin). */
export default function AdminProfileScreen({ user, onToast, onUserUpdated }) {
  const isSuper = user?.role === 'super_admin'

  const POWERS = [
    { key: 'can_crud_questionnaire', label: 'Create & Manage Surveys', desc: 'Build questionnaires & assign surveys', active: isSuper || !!user?.can_crud_questionnaire || !!user?.can_edit_surveys },
    { key: 'can_review_data', label: 'Data Review & QA', desc: 'Confirm or reject field submissions', active: isSuper || !!user?.can_review_data },
    { key: 'can_verify_surveyors', label: 'Verify Surveyor Profiles', desc: 'Approve Aadhaar & phone credentials', active: isSuper || !!user?.can_verify_surveyors },
    { key: 'can_record_voice', label: 'Voice Recording', desc: isSuper ? 'Set field-app voice Off/Required and minute auto-stop on projects' : 'Turn voice Off vs Required when granted. Minute limits are Super Admin only.', active: isSuper || !!user?.can_record_voice },
    { key: 'can_web_survey', label: 'Web Survey Submissions', desc: 'Direct web link survey collection', active: isSuper || !!user?.can_web_survey },
    { key: 'can_translate_telugu', label: 'Telugu Translation', desc: 'Auto-translate questions to Telugu', active: isSuper || !!user?.can_translate_telugu },
  ]

  return (
    <div className="portal-page">
      <header className="portal-page-head">
        <div>
          <p className="eyebrow">{isSuper ? 'Super Admin Console' : 'Client Admin'}</p>
          <h1>{isSuper ? 'Super Admin Profile' : 'My Access & Account'}</h1>
          <p className="portal-lead">
            {isSuper
              ? 'Platform account with root governance powers.'
              : `Account credentials & platform powers granted by Super Admin · ${user?.company_name || 'Organization Account'}`}
          </p>
        </div>
      </header>

      <div style={{ maxWidth: 680 }}>
        <CredentialsCard
          name={user?.name || user?.username}
          username={user?.username}
          role={isSuper ? 'Super Admin' : 'Client Admin'}
          avatar={(user?.name || user?.username || 'CA').slice(0, 2).toUpperCase()}
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
          onTotpReset={isSuper ? async () => {
            if (!window.confirm('Reset your authenticator? You will need the new secret to sign in.')) return null
            try {
              const res = await resetSuperAdminTotp(user.id)
              onToast?.('New TOTP secret — save it now', 'ok')
              return res.totp_secret
            } catch (e) {
              onToast?.(e.message, 'error')
              return null
            }
          } : undefined}
        />

        {!isSuper && (
          <div className="card" style={{ marginTop: 20 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Granted Capabilities</h3>
            <p className="csub" style={{ margin: '0 0 16px', fontSize: 12, color: '#64748b' }}>
              Permissions allocated to your account by the Super Admin.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
              {POWERS.map((p) => (
                <div
                  key={p.key}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: `1px solid ${p.active ? '#bfdbfe' : '#e2e8f0'}`,
                    background: p.active ? '#eff6ff' : '#f8fafc',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <div>
                    <strong style={{ fontSize: 13, color: p.active ? '#1d6fe0' : '#475569', display: 'block' }}>
                      {p.label}
                    </strong>
                    <span style={{ fontSize: 11, color: '#64748b' }}>{p.desc}</span>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: 6,
                      background: p.active ? '#dbeafe' : '#e2e8f0',
                      color: p.active ? '#1e40af' : '#64748b',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.active ? 'Granted ✓' : 'Locked'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

