/**
 * These modules read localStorage and window at call time, so a minimal stub of
 * each is all the native environment needs. vi.stubGlobal + vi.unstubAllGlobals
 * in the tests means nothing leaks between files.
 */
import { vi } from 'vitest'

export function stubStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  })
  return store
}

export function blockedStorage() {
  vi.stubGlobal('localStorage', {
    getItem() {
      throw new Error('storage blocked')
    },
    setItem() {
      throw new Error('storage blocked')
    },
  })
}

export function stubWindow() {
  const win = { location: { reload: vi.fn() }, addEventListener: vi.fn() }
  vi.stubGlobal('window', win)
  return win
}
