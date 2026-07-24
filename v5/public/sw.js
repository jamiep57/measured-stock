/**
 * V5 service worker — cache shell only; never cache Supabase.
 */
const VERSION = 'v5-2';
const SHELL = `v5-shell-${VERSION}`;

const SHELL_URLS = [
  '/v5/',
  '/v5/index.html',
  '/v5/manifest.webmanifest',
  '/assets/js/db.js',
  '/assets/img/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      Promise.allSettled(SHELL_URLS.map((u) => cache.add(u)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('v5-shell-') && k !== SHELL).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.hostname.includes('supabase.co')) return;
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/v5')) {
    event.respondWith(
      fetch(event.request).then((res) => {
        if (res.ok && res.type === 'basic') {
          caches.open(SHELL).then((c) => c.put(event.request, res.clone()));
        }
        return res;
      }).catch(() => caches.match(event.request).then((r) => r || caches.match('/v5/')))
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const cached = await cache.match(event.request);
        const network = fetch(event.request).then((res) => {
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        });
        return cached || network;
      })
    );
  }
});
