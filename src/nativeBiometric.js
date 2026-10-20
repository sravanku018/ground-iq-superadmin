import { Capacitor, registerPlugin } from '@capacitor/core'
import { getApiBase, getToken, setSession } from './api'

const BiometricAuth = registerPlugin('BiometricAuth')

/** True only in the Android APK, where Android BiometricPrompt exists. */
export function nativeBiometricSupported() {
  return (
    typeof Capacitor !== 'undefined' &&
    Capacitor.isNativePlatform?.() &&
    Capacitor.getPlatform?.() === 'android'
  )
}

async function request(path, { method = 'POST', body } = {}) {
  const token = getToken()
  const hasBody = body !== undefined
  const res = await fetch(`${getApiBase()}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return data
}

export function biometricStatus() {
  return BiometricAuth.status()
}

/**
 * Mint a long-lived device token, then ask Android to store it behind the
 * fingerprint. Called while the user is already signed in.
 */
export async function enableBiometricUnlock(username) {
  const minted = await request('/api/auth/device-token', { body: {} })
  const deviceToken = String(minted.device_token || '')
  if (!deviceToken) throw new Error('Could not create fingerprint unlock')
  try {
    return await BiometricAuth.enable({
      token: deviceToken,
      username: username || '',
    })
  } catch (e) {
    // The biometric prompt was cancelled: revoke the token we just minted.
    await request('/api/auth/device-token', {
      method: 'DELETE',
      body: { device_token: deviceToken },
    }).catch(() => null)
    throw e
  }
}

/** Ask for the fingerprint, then exchange the device token for a session. */
export async function authenticateBiometric(expectedRole) {
  const native = await BiometricAuth.authenticate()
  const deviceToken = String(native?.token || '')
  if (!deviceToken) throw new Error('Fingerprint unlock is not set up')
  try {
    const data = await request('/api/auth/device-login', {
      body: { device_token: deviceToken, expected_role: expectedRole },
    })
    setSession(data.token, data.user)
    return data
  } catch (e) {
    // Revoked/expired device token: remove the local copy so the button
    // disappears and the user signs in with a password again.
    if (e?.status === 401 || e?.status === 403) {
      await BiometricAuth.disable().catch(() => null)
    }
    throw e
  }
}

export async function disableBiometricUnlock() {
  let deviceToken = ''
  try {
    const res = await BiometricAuth.disable()
    deviceToken = String(res?.token || '')
  } catch {
    /* ignore */
  }
  if (deviceToken) {
    await request('/api/auth/device-token', {
      method: 'DELETE',
      body: { device_token: deviceToken },
    }).catch(() => null)
  }
}

/** After a password login, offer to set up fingerprint unlock on this phone. */
export async function offerBiometricAfterLogin(username) {
  if (!nativeBiometricSupported()) return false
  try {
    const st = await biometricStatus()
    if (!st?.available || st?.hasToken) return false
    if (!window.confirm('Enable fingerprint unlock for next time?')) return false
    await enableBiometricUnlock(username)
    return true
  } catch {
    return false
  }
}
