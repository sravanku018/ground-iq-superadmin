/**
 * CredentialsCard — TOTP reset + password change.
 *
 * From mock3/credentials.html:
 *   - Super Admin self-service: change password, reset TOTP
 *   - Apple principle: ruthless subtraction — only essential actions
 *   - TOTP reveal with animation
 *
 * Apple principle: craft in feel — gradient identity card, slide-in reveal.
 * Apple principle: subtractive — only two actions, nothing else.
 */
import { useState, useCallback } from 'react'

export default function CredentialsCard({
  avatar,
  name,
  username,
  role,
  onPasswordChange,
  onTotpReset,
}) {
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [displayName, setDisplayName] = useState(name || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showTotp, setShowTotp] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [totpSecret, setTotpSecret] = useState('')
  const [pwVisible, setPwVisible] = useState(false)

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await onPasswordChange?.({ displayName, currentPw, newPw })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }, [displayName, currentPw, newPw, onPasswordChange])

  const handleTotp = useCallback(async () => {
    if (showTotp) {
      setShowTotp(false)
      return
    }
    setGenerating(true)
    try {
      const secret = await onTotpReset?.()
      setTotpSecret(secret || 'JBSW Y3DP EHPK 3PXP')
      setShowTotp(true)
    } finally {
      setGenerating(false)
    }
  }, [showTotp, onTotpReset])

  const inputStyle = {
    minHeight: 42,
    border: '1px solid var(--surface-hover)',
    borderRadius: 'var(--r-md, 10px)',
    padding: '0 12px',
    fontSize: 'var(--fs-base)',
    fontFamily: 'var(--font)',
    background: 'var(--surface)',
    color: 'var(--ink)',
    width: '100%',
    boxSizing: 'border-box',
    outline: 'none',
    transition: 'border-color 120ms',
  }

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--surface-hover)',
        borderRadius: 'var(--r-lg, 12px)',
        padding: 'var(--sp-5, 20px)',
        boxShadow: 'var(--shadow-sm)',
        maxWidth: 440,
        width: '100%',
      }}
    >
      {/* Identity */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: 16,
          background: 'linear-gradient(135deg, var(--accent-bg), var(--surface))',
          border: '1px solid var(--accent-border)',
          borderRadius: 'var(--r-lg, 12px)',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--accent)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'var(--fs-lg)', fontWeight: 700, flexShrink: 0,
          }}
        >
          {avatar || 'SA'}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
            {displayName}
            <svg width="14" height="14" viewBox="0 0 22 22">
              <path fill="#1D9BF0" d="M11 2l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.6 2.7.6 2.7-2.3 1.4-1 2.5-2.7-.2L11 20l-2.2-1.6-2.7.2-1-2.5-2.3-1.4.6-2.7-.6-2.7 2.3-1.4 1-2.5 2.7.2z" />
              <path fill="#fff" d="M9.6 13.4l-2-2 1-1 1 1 3.2-3.2 1 1z" />
            </svg>
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)', marginTop: 2 }}>
            @{username} · {role}
          </div>
        </div>
      </div>

      {/* Password section */}
      <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 4 }}>🔐 Password</h3>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)', marginBottom: 16 }}>
        Change your password. Minimum 8 characters.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--ink-secondary)', display: 'block', marginBottom: 4 }}>
            Display name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--ink-secondary)' }}>
              Current password
            </label>
            <button
              type="button"
              onClick={() => setPwVisible(v => !v)}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 'var(--fs-xs)', cursor: 'pointer', padding: 0 }}
            >
              {pwVisible ? 'Hide' : 'Show'}
            </button>
          </div>
          <input
            type={pwVisible ? 'text' : 'password'}
            value={currentPw}
            onChange={e => setCurrentPw(e.target.value)}
            placeholder="Required to change"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--ink-secondary)', display: 'block', marginBottom: 4 }}>
            New password
          </label>
          <input
            type={pwVisible ? 'text' : 'password'}
            value={newPw}
            onChange={e => setNewPw(e.target.value)}
            placeholder="Leave blank to keep current"
            style={inputStyle}
          />
          <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>Minimum 8 characters</span>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            minHeight: 42, width: '100%', padding: '0 18px',
            background: saved ? 'var(--ok)' : 'var(--accent)',
            color: '#fff', border: 'none',
            borderRadius: 'var(--r-md, 10px)',
            fontSize: 'var(--fs-sm)', fontWeight: 700,
            cursor: 'pointer',
            boxShadow: saved ? 'none' : '0 2px 8px rgba(29,111,224,0.2)',
            transition: 'all 120ms',
          }}
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save profile'}
        </button>
      </div>

      {/* TOTP section */}
      <div style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 4 }}>🔐 Authenticator (TOTP)</h3>
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)', marginBottom: 16 }}>
          All 3 Super Admin slots sign in with password + a 6-digit app code.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>Current TOTP</span>
          <span
            style={{
              fontSize: 10, fontWeight: 700, padding: '3px 8px',
              borderRadius: 'var(--r-sm)',
              background: 'var(--ok-bg)', color: 'var(--ok)',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            ✓ Active
          </span>
        </div>

        <button
          type="button"
          onClick={handleTotp}
          disabled={generating}
          style={{
            minHeight: 42, width: '100%', padding: '0 18px',
            background: 'var(--surface)', color: 'var(--ink-secondary)',
            border: '1px solid var(--surface-hover)',
            borderRadius: 'var(--r-md, 10px)',
            fontSize: 'var(--fs-sm)', fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {generating ? 'Generating…' : showTotp ? 'Hide secret' : 'Reset my TOTP'}
        </button>

        {/* TOTP reveal */}
        {showTotp && (
          <div
            style={{
              marginTop: 12,
              background: 'var(--surface-alt)',
              borderRadius: 'var(--r-md, 10px)',
              padding: 12,
              animation: 'fadeIn 200ms ease-out',
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginBottom: 6 }}>
              New secret — scan or paste into your authenticator app:
            </div>
            <code
              style={{
                fontFamily: "'SF Mono', Menlo, monospace",
                fontWeight: 700,
                wordBreak: 'break-all',
                fontSize: 'var(--fs-sm)',
                display: 'block',
                background: 'var(--surface)',
                padding: '8px 12px',
                borderRadius: 'var(--r-sm)',
                marginBottom: 6,
                border: '1px solid var(--surface-hover)',
              }}
            >
              {totpSecret}
            </code>
            <div style={{ fontSize: 10, color: 'var(--ink-faint)', wordBreak: 'break-all', lineHeight: 1.5 }}>
              otpauth://totp/SmartSurveyX:{username}?secret={totpSecret.replace(/\s/g, '')}&issuer=SmartSurveyX
            </div>
          </div>
        )}
      </div>

      {/* How TOTP works */}
      <div style={{ marginTop: 16, fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)', lineHeight: 1.6 }}>
        <strong>How TOTP works:</strong><br />
        1. Install Google Authenticator or Authy<br />
        2. Scan the QR code or paste the secret<br />
        3. Enter the 6-digit code at login<br />
        4. Reset if you lose your device
      </div>
    </div>
  )
}
