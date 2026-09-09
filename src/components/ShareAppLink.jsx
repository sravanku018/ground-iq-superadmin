import { useMemo, useState } from 'react'
import Icon from '../Icons'
import { apkDownloadUrl, fieldAppShareText, fieldAppUrl } from '../api'

async function copyText(text) {
  await navigator.clipboard.writeText(text)
}

export default function ShareAppLink({ onToast }) {
  const apkLink = useMemo(() => apkDownloadUrl(), [])
  const pwaLink = useMemo(() => fieldAppUrl(), [])
  const [copied, setCopied] = useState('')

  async function copy(text, key, okMsg) {
    try {
      await copyText(text)
      setCopied(key)
      onToast?.(okMsg, 'ok')
      setTimeout(() => setCopied((cur) => (cur === key ? '' : cur)), 1600)
    } catch {
      onToast?.(text, 'ok')
    }
  }

  async function shareApk() {
    const text = fieldAppShareText()
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Smart Survey X', text, url: apkLink })
        onToast?.('Share sheet opened', 'ok')
        return
      }
    } catch (e) {
      if (e?.name === 'AbortError') return
    }
    await copy(text, 'share', 'APK link copied')
  }

  async function sharePwa() {
    const text = `Smart Survey X — Surveyor App (PWA)\nOpen in Chrome / Safari and Add to Home Screen:\n${pwaLink}`
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Smart Survey X — Surveyor App', text, url: pwaLink })
        onToast?.('Share sheet opened', 'ok')
        return
      }
    } catch (e) {
      if (e?.name === 'AbortError') return
    }
    await copy(text, 'pwa-share', 'PWA link copied')
  }

  return (
    <div className="card" style={{ marginBottom: 16, padding: 16 }}>
      <p style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="link" size={16} /> Share Surveyor Field App
      </p>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: 12, lineHeight: 1.5 }}>
        Choose how surveyors access the app: via direct <strong>PWA Web App</strong> (works instantly on Android &amp; iPhone, bypasses Google Play restrictions, updates automatically) or <strong>Android APK download</strong>.
      </p>

      {/* Option 1: PWA Web Link */}
      <div style={{ padding: 12, borderRadius: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <strong style={{ fontSize: 13, color: '#166534', display: 'flex', alignItems: 'center', gap: 6 }}>
            📱 PWA App Link (Android &amp; iPhone)
          </strong>
          <span style={{ fontSize: 10, background: '#dcfce7', color: '#15803d', fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>
            Recommended · No Play Store needed
          </span>
        </div>
        <p style={{ fontSize: 12, color: '#374151', margin: '0 0 8px' }}>
          Open in mobile Chrome or Safari → tap <em>&ldquo;Add to Home screen&rdquo;</em>. Works offline and syncs automatically.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            readOnly
            value={pwaLink}
            style={{ flex: 1, minWidth: 220, fontSize: 12, background: '#fff' }}
            onFocus={(e) => e.target.select()}
          />
          <button
            type="button"
            className="btn primary"
            style={{ background: '#16a34a', borderColor: '#15803d' }}
            onClick={() => void copy(pwaLink, 'pwa', 'PWA App link copied')}
          >
            {copied === 'pwa' ? 'Copied ✓' : 'Copy PWA link'}
          </button>
          <a className="btn" href={pwaLink} target="_blank" rel="noopener noreferrer">
            Open ↗
          </a>
          <button type="button" className="btn" onClick={() => void sharePwa()}>
            {copied === 'pwa-share' ? 'Copied ✓' : 'Share PWA'}
          </button>
        </div>
      </div>

      {/* Option 2: Android APK */}
      <div style={{ padding: 12, borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <strong style={{ fontSize: 13, color: '#334155' }}>
            🤖 Android APK (Direct Installer)
          </strong>
          <span style={{ fontSize: 10, background: '#e2e8f0', color: '#475569', fontWeight: 600, padding: '2px 8px', borderRadius: 999 }}>
            Standalone APK
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            readOnly
            value={apkLink}
            style={{ flex: 1, minWidth: 220, fontSize: 12, background: '#fff' }}
            onFocus={(e) => e.target.select()}
          />
          <button
            type="button"
            className="btn"
            onClick={() => void copy(apkLink, 'apk', 'APK link copied')}
          >
            {copied === 'apk' ? 'Copied ✓' : 'Copy APK link'}
          </button>
          <a className="btn" href={apkLink} download="SmartSurveyX.apk" rel="noopener">
            Download
          </a>
          <button type="button" className="btn" onClick={() => void shareApk()}>
            {copied === 'share' ? 'Copied ✓' : 'Share APK'}
          </button>
        </div>
      </div>
    </div>
  )
}
