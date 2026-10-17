import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  claimReload,
  installChunkReloadGuard,
  isChunkLoadError,
  reloadSoon,
} from '../src/reloadGuard.js'
import { blockedStorage, stubStorage, stubWindow } from './stubs.js'

const RELOAD_KEY = 'esurvey_reload_guard'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('isChunkLoadError', () => {
  it('recognises the wording of every engine it has met', () => {
    const webpack = new Error('loading')
    webpack.name = 'ChunkLoadError'
    expect(isChunkLoadError(webpack)).toBe(true)
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: /assets/x-abc.js'))).toBe(true)
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Loading chunk 5 failed'))).toBe(true)
  })

  // If this ever returns true for ordinary bugs, screens would reload-loop
  // instead of showing their error state.
  it('leaves ordinary failures alone', () => {
    expect(isChunkLoadError(new TypeError('x is not a function'))).toBe(false)
    expect(isChunkLoadError(new Error('Network request failed'))).toBe(false)
    expect(isChunkLoadError(new Error(''))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError('dynamically imported module')).toBe(false)
  })
})

describe('claimReload', () => {
  it('claims the first reload and records it', () => {
    const store = stubStorage()
    expect(claimReload()).toBe(true)
    expect(Number(store.get(RELOAD_KEY))).toBeCloseTo(Date.now(), -2)
  })

  it('refuses a second attempt inside the cooldown', () => {
    stubStorage({ [RELOAD_KEY]: String(Date.now()) })
    expect(claimReload()).toBe(false)
    stubStorage({ [RELOAD_KEY]: String(Date.now() - 29_999) })
    expect(claimReload()).toBe(false)
  })

  it('allows one again once the cooldown has passed', () => {
    stubStorage({ [RELOAD_KEY]: String(Date.now() - 30_001) })
    expect(claimReload()).toBe(true)
  })

  it('still claims when storage is blocked, rather than stranding the user', () => {
    blockedStorage()
    expect(claimReload()).toBe(true)
  })
})

describe('reloadSoon', () => {
  it('waits for the failing screen to paint before reloading', () => {
    const win = stubWindow()
    vi.useFakeTimers()
    reloadSoon()
    expect(win.location.reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(349)
    expect(win.location.reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })

  it('honours a custom delay', () => {
    const win = stubWindow()
    vi.useFakeTimers()
    reloadSoon(50)
    vi.advanceTimersByTime(50)
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })
})

describe('installChunkReloadGuard', () => {
  it('heals a failed chunk fetch once, then the shared cooldown stops the loop', () => {
    const win = stubWindow()
    stubStorage()
    vi.useFakeTimers()

    installChunkReloadGuard()
    expect(win.addEventListener.mock.calls[0][0]).toBe('vite:preloadError')
    const handler = win.addEventListener.mock.calls[0][1]

    const first = { preventDefault: vi.fn() }
    handler(first)
    expect(first.preventDefault).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(350)
    expect(win.location.reload).toHaveBeenCalledTimes(1)

    // A deploy that removed the chunk would fire this on every screen: the
    // second event must not reload again.
    handler({ preventDefault: vi.fn() })
    vi.advanceTimersByTime(1000)
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })
})
