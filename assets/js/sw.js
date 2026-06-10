/*
  Service worker for the mobile "on the go" PWA (/mobile).
  ---------------------------------------------------------------------------
  Goals:
   - Make the app installable + launchable from the home screen.
   - Serve the app shell instantly and survive flaky connectivity.
   - NEVER cache auth, API, or Supabase traffic — those must always hit the
     network so data stays live and the PIN gate keeps working.

  Strategy:
   - Navigations (the /mobile document): network-first, fall back to the
     cached shell when offline.
   - Same-origin static assets + the font/icon CDNs: stale-while-revalidate.
   - Everything else (Supabase, /api/*, non-GET): straight to the network.
*/

const VERSION = 'v1';
const SHELL_CACHE = `stock-shell-${VERSION}`;
const ASSET_CACHE = `stock-assets-${VERSION}`;

// Cached up front so the app opens offline. /mobile is the app shell.
const SHELL_URLS = [
  '/mobile',
  '/assets/js/db.js',
  '/assets/manifest.webmanifest',
  '/assets/img/favicon.png',
  '/assets/img/icon-192.png',
  '/assets/img/icon-512.png',
  '/assets/img/apple-touch-icon.png',
];

// CDNs whose responses are safe to cache (fonts + icon webfonts).
const CACHEABLE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Don't let one failed request abort the whole install.
      await Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// Let the page trigger an immediate update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function isCacheableAsset(url) {
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return false;
    return url.pathname.startsWith('/assets/');
  }
  return CACHEABLE_HOSTS.includes(url.hostname);
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    // Only cache a genuine page, never a 401 login page or a redirect.
    if (response && response.ok && response.type === 'basic') {
      cache.put('/mobile', response.clone());
    }
    return response;
  } catch (err) {
    const cached = (await cache.match(request)) || (await cache.match('/mobile'));
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);
  return cached || (await network) || fetch(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isCacheableAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
