import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser'
import { getApiBase, getToken, setSession } from './api'

function authHeaders() {
  const token = getToken()
  return {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function send(path, { method = 'POST', body } = {}) {
  const hasBody = body !== undefined
  const res = await fetch(`${getApiBase()}${path}`, {
    method,
    headers: {
      ...authHeaders(),
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

/**
 * Web fingerprint login is implemented with WebAuthn. Browsers call this a
 * "passkey"; there is no non-passkey browser fingerprint API. The Android app
 * uses native BiometricPrompt instead (see nativeBiometric.js).
 */
export function webPasskeySupported() {
  try {
    if (typeof window === 'undefined') return false
    if (window.Capacitor?.isNativePlatform?.()) return false
    return window.isSecureContext === true && browserSupportsWebAuthn()
  } catch {
    return false
  }
}

function currentOrigin() {
  return typeof window !== 'undefined' ? window.location.origin : ''
}

export function getPasskeyStatus() {
  return send('/api/auth/webauthn/credentials', { method: 'GET' })
}

export async function enableWebPasskey() {
  const origin = currentOrigin()
  const opts = await send('/api/auth/webauthn/register/options', {
    body: { origin },
  })
  const response = await startRegistration({ optionsJSON: opts.options })
  return send('/api/auth/webauthn/register/verify', {
    body: { flow_id: opts.flow_id, response, origin },
  })
}

export async function passkeyLogin(username, expectedRole) {
  const origin = currentOrigin()
  const name = String(username || '').trim()
  const opts = await send('/api/auth/webauthn/login/options', {
    body: { username: name, origin },
  })
  const allowed = opts?.options?.allowCredentials
  if (name && (!Array.isArray(allowed) || allowed.length === 0)) {
    throw new Error(
      'No fingerprint/passkey is set up for this username on this device. Sign in with your password, then open Profile → Fingerprint / passkey → Enable.',
    )
  }
  const response = await startAuthentication({ optionsJSON: opts.options })
  const data = await send('/api/auth/webauthn/login/verify', {
    body: {
      flow_id: opts.flow_id,
      response,
      origin,
      expected_role: expectedRole,
    },
  })
  setSession(data.token, data.user)
  return data
}

export function removeWebPasskey() {
  return send('/api/auth/webauthn/credentials', { method: 'DELETE' })
}

export function passkeyError(e) {
  const name = String(e?.name || '')
  if (name === 'NotAllowedError') {
    return 'Fingerprint/passkey was cancelled or timed out. Try again.'
  }
  if (name === 'InvalidStateError') {
    return 'This device is already set up for fingerprint/passkey login.'
  }
  if (name === 'NotSupportedError') {
    return 'This browser/device does not support fingerprint/passkey login.'
  }
  if (name === 'SecurityError') {
    return 'Fingerprint/passkey login needs HTTPS and the correct website domain.'
  }
  return e?.message || 'Fingerprint/passkey sign-in failed.'
}
