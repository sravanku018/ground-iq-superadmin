/**
 * One guard for every "reload to heal" path.
 *
 * A tab can end up running a bundle whose hashed chunks no longer exist (a deploy
 * replaced them, a chunk fetch failed, or index.html was served from cache). Each
 * case used to carry its own detection and its own localStorage key, so loop
 * protection only ever covered one path at a time. They share one cooldown now.
 */

const RELOAD_KEY = 'esurvey_reload_guard'
const COOLDOWN_MS = 30_000

/**
 * Was this error a chunk that could not be loaded, rather than a screen bug?
 * Covers the current wording of each engine; Safari says neither of the two
 * "dynamically imported module" strings, which is why it is listed separately.
 */
export function isChunkLoadError(error) {
  const name = String(error?.name || '')
  const msg = String(error?.message || '')
  return (
    name.includes('ChunkLoadError') || // webpack-era wording
    msg.includes('dynamically imported module') || // Chrome, Firefox
    msg.includes('error loading dynamically imported module') || // Firefox (older)
    msg.includes('Importing a module script failed') || // Safari
    msg.includes('Loading chunk') // webpack-era wording
  )
}

/**
 * True only when no reload was attempted in the last 30s — and records the
 * attempt when it returns true. A false return means "show the manual card",
 * never "try again", so this cannot loop.
 */
export function claimReload() {
  let last = 0
  try {
    last = Number(localStorage.getItem(RELOAD_KEY) || 0)
  } catch {
    /* storage blocked — treat as no recent attempt */
  }
  if (Date.now() - last < COOLDOWN_MS) return false
  try {
    localStorage.setItem(RELOAD_KEY, Date.now().toString())
  } catch {
    /* storage blocked: a reload is still the right move */
  }
  return true
}

/**
 * Force a FRESH document: a plain reload can be served from Firefox's cache
 * with the old chunk names, which 404 after a deploy and show the error card
 * again. A cache-busting query param guarantees a new document fetch.
 */
export function hardReload() {
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('r', String(Date.now()))
    window.location.replace(url.toString())
  } catch {
    window.location.reload()
  }
}

/** Reload a beat later so a failing screen can paint its message first. */
export function reloadSoon(delayMs = 350) {
  setTimeout(() => hardReload(), delayMs)
}

/**
 * Vite fires this on window when a dynamic import's chunk fails to fetch. That
 * includes imports triggered outside React's render path, which no error boundary
 * can see, so the entry installs one handler for both apps.
 */
export function installChunkReloadGuard() {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    if (claimReload()) reloadSoon()
  })
}
