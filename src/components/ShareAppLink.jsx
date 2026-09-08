import { useMemo, useState } from 'react'
import Icon from '../Icons'
import { apkDownloadUrl, fieldAppShareText } from '../api'

async function copyText(text) {
  await navigator.clipboard.writeText(text)
}

export default function ShareAppLink({ onToast }) {
  const apkLink = useMemo(() => apkDownloadUrl(), [])
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

  return (
    <div className="card" style={{ marginBottom: 16, padding: 14 }}>
      <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="link" size={16} /> Share field app
      </p>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>
        Send this Android download to surveyors. Open it on the phone (not WhatsApp in-app browser
        if it fails — use Chrome). Install, then sign in with the username and password you create
        under Surveyors.
      </p>

      <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700 }}>Android APK</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          readOnly
          value={apkLink}
          style={{ flex: 1, minWidth: 220, fontSize: 13 }}
          onFocus={(e) => e.target.select()}
        />
        <button
          type="button"
          className="btn primary"
          onClick={() => void copy(apkLink, 'apk', 'APK link copied')}
        >
          {copied === 'apk' ? 'Copied' : 'Copy download link'}
        </button>
        <a className="btn" href={apkLink} download="SmartSurveyX.apk" rel="noopener">
          Download
        </a>
        <button type="button" className="btn" onClick={() => void shareApk()}>
          {copied === 'share' ? 'Copied' : 'Share'}
        </button>
      </div>
    </div>
  )
}
