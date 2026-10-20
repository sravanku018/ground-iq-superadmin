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

/** Fingerprint/passkeys need HTTPS (or localhost) and WebAuthn support. */
export function fingerprintSupported() {
  try {
    return (
      typeof window !== 'undefined' &&
      window.isSecureContext === true &&
      browserSupportsWebAuthn()
    )
  } catch {
    return false
  }
}

function currentOrigin() {
  return typeof window !== 'undefined' ? window.location.origin : ''
}

export function getFingerprintStatus() {
  return send('/api/auth/webauthn/credentials', { method: 'GET' })
}

/** Register this device's fingerprint / passkey for the signed-in account. */
export async function enableFingerprint() {
  const origin = currentOrigin()
  const opts = await send('/api/auth/webauthn/register/options', {
    body: { origin },
  })
  const response = await startRegistration({ optionsJSON: opts.options })
  return send('/api/auth/webauthn/register/verify', {
    body: { flow_id: opts.flow_id, response, origin },
  })
}

/** Sign in with the fingerprint / passkey registered for this username. */
export async function fingerprintLogin(username, expectedRole) {
  const origin = currentOrigin()
  const opts = await send('/api/auth/webauthn/login/options', {
    body: { username, origin },
  })
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

export function removeFingerprint() {
  return send('/api/auth/webauthn/credentials', { method: 'DELETE' })
}

/** Friendly text for the browser's WebAuthn errors. */
export function fingerprintError(e) {
  const name = String(e?.name || '')
  if (name === 'NotAllowedError') {
    return 'Fingerprint was cancelled or timed out. Try again.'
  }
  if (name === 'InvalidStateError') {
    return 'This device is already set up for fingerprint login.'
  }
  if (name === 'NotSupportedError') {
    return 'This browser/device does not support fingerprint login.'
  }
  if (name === 'SecurityError') {
    return 'Fingerprint login needs HTTPS and the correct website domain.'
  }
  return e?.message || 'Fingerprint sign-in failed.'
}
