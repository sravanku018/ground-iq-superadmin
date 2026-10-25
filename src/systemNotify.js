import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

let webSwReady = null
let nextId = 1

/**
 * Ask the OS for notification permission — once, after login.
 * Android 13+ needs POST_NOTIFICATIONS at runtime; web needs Notification.
 * Returns true when system notifications can be shown.
 */
export async function enableSystemNotifications() {
  try {
    if (Capacitor.isNativePlatform()) {
      const res = await LocalNotifications.requestPermissions()
      return res?.display === 'granted'
    }
    if (typeof Notification === 'undefined') return false
    if (Notification.permission === 'granted') return true
    if (Notification.permission === 'denied') return false
    const p = await Notification.requestPermission()
    return p === 'granted'
  } catch {
    return false
  }
}

/** Notification-only service worker — no fetch handler, so it never interferes. */
async function webRegistration() {
  if (!('serviceWorker' in navigator)) return null
  if (!webSwReady) {
    webSwReady = navigator.serviceWorker
      .register('/sw-notifications.js')
      .catch(() => null)
  }
  try {
    return await webSwReady
  } catch {
    return null
  }
}

/**
 * Real system notification — appears in the tray / lock screen and stays
 * until dismissed, unlike a 3-second in-app toast. Returns false when
 * unavailable (permission denied / unsupported) so the caller can fall back.
 */
export async function systemNotify(title, body) {
  try {
    if (Capacitor.isNativePlatform()) {
      await LocalNotifications.schedule({
        notifications: [{ id: nextId++, title, body }],
      })
      return true
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      // Android Chrome needs a service worker for notifications; desktop
      // browsers work with the plain constructor.
      const reg = await webRegistration()
      if (reg) {
        await reg.showNotification(title, { body, tag: 'smartsurveyx-confirm' })
      } else {
        new Notification(title, { body, tag: 'smartsurveyx-confirm' })
      }
      return true
    }
  } catch {
    /* fall back to a toast */
  }
  return false
}
