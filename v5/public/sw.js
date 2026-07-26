/**
 * V5 service worker — cache shell only; never cache Supabase.
 */
const VERSION = 'v5-47-fab-spacing';
const SHELL = `v5-shell-${VERSION}`;

const SHELL_URLS = [
  '/v5/',
  '/v5/index.html',
  '/v5/scan',
  '/v5/scan.html',
  '/v5/manifest.webmanifest',
  '/assets/js/db.js',
  '/assets/img/favicon.png',
  '/v5/apple-touch-icon.png',
  '/v5/kit-count-icon.png',
  '/v5/kit-count-icon-192.png',
  '/v5/kit-count-icon-512.png',
  '/v5/kit-count-icon-maskable-512.png',
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
    // Always prefer network for app shell + hashed bundles so hero/UI fixes ship.
    event.respondWith(
      fetch(event.request).then((res) => {
        const isHashedAsset = /\/v5\/assets\/.+-[A-Za-z0-9_-]{6,}\.(js|css)$/.test(url.pathname);
        if (res.ok && res.type === 'basic' && !isHashedAsset) {
          caches.open(SHELL).then((c) => c.put(event.request, res.clone()));
        }
        return res;
      }).catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (url.pathname.startsWith('/v5/scan')) {
          return (await caches.match('/v5/scan.html'))
            || (await caches.match('/v5/scan'));
        }
        return caches.match('/v5/');
      })
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
