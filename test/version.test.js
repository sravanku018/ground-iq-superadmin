import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APP_BUILD,
  APP_VERSION,
  APP_VERSION_CODE,
  getStoredAppVersion,
  isNewerBuild,
  reloadOnceIfUpgraded,
  storeAppVersion,
  versionFullLabel,
  versionLabel,
  versionPayload,
} from '../src/version.js'
import { blockedStorage, stubStorage, stubWindow } from './stubs.js'

const VERSION_KEY = 'esurvey_app_version'
const META_KEY = 'esurvey_app_version_meta'
const GUARD_KEY = 'esurvey_reload_guard'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('build constants', () => {
  it('comes from the build-time defines, not the dev fallback', () => {
    expect(APP_VERSION).toBe('2.0.88')
    expect(APP_BUILD).toBe('2026-10-17')
    expect(APP_VERSION_CODE).toBe(20088)
  })
})

describe('labels', () => {
  it('renders the footer label', () => {
    expect(versionLabel()).toBe('v2.0.88 · 2026-10-17')
  })

  it('renders the full label with the Android versionCode', () => {
    expect(versionFullLabel()).toBe('v2.0.88 (#20088) · build 2026-10-17')
  })

  it('sends the payload fragment with API calls', () => {
    expect(versionPayload()).toEqual({
      app_version: '2.0.88',
      app_build: '2026-10-17',
      app_version_code: 20088,
    })
  })
})

describe('isNewerBuild', () => {
  it('trusts versionCode first, because it is monotonic', () => {
    expect(isNewerBuild({ versionCode: 20089 })).toBe(true)
    expect(isNewerBuild({ versionCode: '20089' })).toBe(true)
    expect(isNewerBuild({ versionCode: 20088 })).toBe(false)
    expect(isNewerBuild({ versionCode: 20087 })).toBe(false)
    expect(isNewerBuild({ versionCode: 20089, version: '1.0.0' })).toBe(true)
  })

  it('falls back to semver when the API reports no versionCode', () => {
    expect(isNewerBuild({ version: '2.0.89' })).toBe(true)
    expect(isNewerBuild({ version: '2.1.0' })).toBe(true)
    expect(isNewerBuild({ version: '3.0.0' })).toBe(true)
    expect(isNewerBuild({ version: '2.0.88' })).toBe(false)
    expect(isNewerBuild({ version: '2.0.87' })).toBe(false)
    expect(isNewerBuild({ version: '1.9.9' })).toBe(false)
  })

  // The whole point of the function: an API advertising an older or equal
  // release must never trigger the "new version, reloading" path.
  it('never upgrades on equal, older or unparseable input', () => {
    expect(isNewerBuild({})).toBe(false)
    expect(isNewerBuild(null)).toBe(false)
    expect(isNewerBuild(undefined)).toBe(false)
    expect(isNewerBuild({ version: 'not a version' })).toBe(false)
    expect(isNewerBuild({ version: 'v2.0.89' })).toBe(false)
    expect(isNewerBuild({ versionCode: 'abc' })).toBe(false)
  })
})

describe('storeAppVersion', () => {
  it('records the running build on first run without claiming an upgrade', () => {
    const store = stubStorage()
    expect(storeAppVersion()).toEqual({
      prev: null,
      current: '2.0.88',
      build: '2026-10-17',
      upgraded: false,
    })
    expect(store.get(VERSION_KEY)).toBe('2.0.88')
    expect(JSON.parse(store.get(META_KEY))).toMatchObject({
      version: '2.0.88',
      build: '2026-10-17',
      versionCode: 20088,
    })
  })

  it('is not an upgrade when nothing changed', () => {
    stubStorage({ [VERSION_KEY]: '2.0.88', [META_KEY]: JSON.stringify({ build: '2026-10-17' }) })
    expect(storeAppVersion().upgraded).toBe(false)
  })

  it('is an upgrade when the version moved', () => {
    stubStorage({ [VERSION_KEY]: '2.0.87', [META_KEY]: JSON.stringify({ build: '2026-10-01' }) })
    expect(storeAppVersion()).toMatchObject({ prev: '2.0.87', current: '2.0.88', upgraded: true })
  })

  it('is an upgrade when only the build moved, as in a re-publish', () => {
    stubStorage({ [VERSION_KEY]: '2.0.88', [META_KEY]: JSON.stringify({ build: '2026-10-01' }) })
    expect(storeAppVersion().upgraded).toBe(true)
  })

  it('treats corrupt meta as an upgrade rather than throwing', () => {
    stubStorage({ [VERSION_KEY]: '2.0.87', [META_KEY]: '{not json' })
    expect(storeAppVersion().upgraded).toBe(true)
  })

  it('reports "nothing happened" when storage is blocked', () => {
    blockedStorage()
    expect(storeAppVersion()).toEqual({
      prev: null,
      current: '2.0.88',
      build: '2026-10-17',
      upgraded: false,
    })
  })
})

describe('getStoredAppVersion', () => {
  it('returns the stored meta', () => {
    stubStorage({ [META_KEY]: JSON.stringify({ version: '2.0.87', build: '2026-10-01' }) })
    expect(getStoredAppVersion()).toEqual({ version: '2.0.87', build: '2026-10-01' })
  })

  it('falls back to the plain version key when meta is absent', () => {
    stubStorage({ [VERSION_KEY]: '2.0.87' })
    expect(getStoredAppVersion()).toEqual({ version: '2.0.87' })
  })

  it('falls back to the running version on a fresh device', () => {
    stubStorage()
    expect(getStoredAppVersion()).toEqual({ version: '2.0.88' })
  })

  it('survives corrupt meta and blocked storage', () => {
    stubStorage({ [META_KEY]: '{not json' })
    expect(getStoredAppVersion()).toEqual({ version: '2.0.88' })
    blockedStorage()
    expect(getStoredAppVersion()).toEqual({ version: '2.0.88' })
  })
})

describe('reloadOnceIfUpgraded', () => {
  it('does nothing on a fresh device', () => {
    const win = stubWindow()
    stubStorage()
    expect(reloadOnceIfUpgraded().upgraded).toBe(false)
    expect(win.location.reload).not.toHaveBeenCalled()
  })

  it('hard-reloads once when a newer build was deployed', () => {
    const win = stubWindow()
    stubStorage({ [VERSION_KEY]: '2.0.87', [META_KEY]: JSON.stringify({ build: '2026-10-01' }) })
    expect(reloadOnceIfUpgraded()).toMatchObject({ prev: '2.0.87', upgraded: true })
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })

  it('reports the upgrade but holds the reload while the shared cooldown runs', () => {
    const win = stubWindow()
    stubStorage({
      [VERSION_KEY]: '2.0.87',
      [META_KEY]: JSON.stringify({ build: '2026-10-01' }),
      [GUARD_KEY]: String(Date.now()),
    })
    expect(reloadOnceIfUpgraded().upgraded).toBe(true)
    expect(win.location.reload).not.toHaveBeenCalled()
  })
})
