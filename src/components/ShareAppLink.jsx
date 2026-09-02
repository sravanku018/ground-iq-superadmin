import { useMemo, useState } from 'react'
import Icon from '../Icons'
import { apkDownloadUrl, fieldAppShareText, fieldAppUrl } from '../api'

async function copyText(text) {
  await navigator.clipboard.writeText(text)
}

export default function ShareAppLink({ onToast }) {
  const appLink = useMemo(() => fieldAppUrl(), [])
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

  async function shareAll() {
    const text = fieldAppShareText()
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Smart Survey X', text, url: appLink })
        onToast?.('Share sheet opened', 'ok')
        return
      }
    } catch (e) {
      if (e?.name === 'AbortError') return
    }
    await copy(text, 'share', 'App links copied')
  }

  return (
    <div className="card" style={{ marginBottom: 16, padding: 14 }}>
      <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="link" size={16} /> Share field app
      </p>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>
        Send this to surveyors. They install the Android app or open the web app, then sign in
        with the username and password you create under Surveyors.
      </p>

      <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700 }}>Web app link</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input
          readOnly
          value={appLink}
          style={{ flex: 1, minWidth: 220, fontSize: 13 }}
          onFocus={(e) => e.target.select()}
        />
        <button
          type="button"
          className="btn primary"
          onClick={() => void copy(appLink, 'app', 'App link copied')}
        >
          {copied === 'app' ? 'Copied' : 'Copy link'}
        </button>
        <a className="btn" href={appLink} target="_blank" rel="noreferrer">
          Open
        </a>
      </div>

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
          className="btn"
          onClick={() => void copy(apkLink, 'apk', 'APK link copied')}
        >
          {copied === 'apk' ? 'Copied' : 'Copy APK'}
        </button>
        <a className="btn" href={apkLink} target="_blank" rel="noreferrer">
          Download
        </a>
        <button type="button" className="btn" onClick={() => void shareAll()}>
          {copied === 'share' ? 'Copied' : 'Share both'}
        </button>
      </div>
    </div>
  )
}
