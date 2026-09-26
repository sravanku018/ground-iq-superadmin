import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline app shell for web/PWA only — never inside the Capacitor APK
// (APK updates replace all assets; a cached shell would go stale).
if ('serviceWorker' in navigator) {
  const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()
  const secure = location.protocol === 'https:' || location.hostname === 'localhost'
  if (!isNative && secure) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    })
  }
}
