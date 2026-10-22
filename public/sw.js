const CACHE = 'ysc-v147';
const APP_SHELL = ['/'];

// API paths that should never be served from cache. NOTE: every API resource must
// be listed here — a missing one (e.g. lifegroups) falls through to the cache-first
// asset path and can get the SPA HTML cached under its URL, breaking JSON parsing.
const API_RE = /^\/(auth|students|leaders|prayers|notices|bus|intake|connections|overview|trends|lifegroups|at-risk|import|settings|admin|accounts|audits|health|batch|setup|link|sync|manifest\.json)(\/|$|\?)/;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Network-only for API routes (never stale data)
  if (API_RE.test(url.pathname)) return;

  // Network-first for the HTML shell — always get the latest version when online
  if (url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(
      fetch(request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
        }
        return res;
      }).catch(() => caches.match(request, { ignoreSearch: true })) // F-52: /?nav=notices offline gets the shell
    );
    return;
  }

  // Cache-first for all other assets (fonts, icons, etc.)
  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
        }
        return res;
      });
    })
  );
});

// ─── Notice alerts (web push, ported from MyYouthCamp) ───────────────────────────
// userVisibleOnly is mandatory, so every push MUST show a notification. The server sends only
// { title: 'New notice', body: <the notice's first line>, screen: 'notices' }; it may show on a locked screen.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = {}; }
  e.waitUntil(self.registration.showNotification(d.title || 'New notice', {
    body: d.body || 'Open the app for details.',
    icon: '/icons/icon-192.png',
    tag: 'notice',
    renotify: true, // a second notice replacing the first must still alert (Android is silent otherwise)
    data: { screen: 'notices' },
  }));
});

// The SPA has no URL router: tell an open window to go to Notices, or cold-start with /?nav=notices.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if ('focus' in c) { c.postMessage({ type: 'push-nav', screen: 'notices' }); return c.focus(); }
      }
      return self.clients.openWindow('/?nav=notices');
    })
  );
});
