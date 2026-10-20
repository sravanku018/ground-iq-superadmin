/*
 * Service worker — offline app shell for the web/PWA build.
 * - Navigations: network-first, fall back to the cached index.html so the
 *   app opens with no network (the app's own offline queue handles data).
 * - Hashed /assets/*: cache-first (immutable content).
 * - Cross-origin requests (the survey API) are never touched.
 * Not registered inside the Capacitor APK — the APK updates as a whole,
 * and a cached shell could serve stale assets after an app update.
 */
const CACHE = 'giq-shell-v3';
const CORE = ['/', '/app.html', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) =>
        Promise.all(CORE.map((url) => cache.add(url).catch(() => null))),
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          // Cache under the real URL: / is the landing page, /admin and /field
          // are the SPA shell. Never overwrite the SPA shell with the landing.
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(async () =>
          (await caches.match(req)) ||
          caches.match('/app.html') ||
          caches.match('/index.html')
        )
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        });
      })
    );
  }
});
