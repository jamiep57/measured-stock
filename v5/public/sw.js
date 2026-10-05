/**
 * Measured staff PWA service worker — cache shell + CDN chrome; never cache Supabase.
 */
const VERSION = 'app-61-root-cutover';
const SHELL = `app-shell-${VERSION}`;

const SHELL_URLS = [
  '/app/',
  '/app.html',
  '/scan',
  '/scan.html',
  '/manifest.webmanifest',
  '/assets/js/db.js',
  '/assets/img/favicon.png',
  '/apple-touch-icon.png',
  '/kit-count-icon.png',
  '/kit-count-icon-192.png',
  '/kit-count-icon-512.png',
  '/kit-count-icon-maskable-512.png',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap',
  'https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css',
  'https://unpkg.com/@phosphor-icons/web@2.1.1/src/bold/style.css',
];

function isCdnHost(hostname) {
  return hostname === 'fonts.googleapis.com'
    || hostname === 'fonts.gstatic.com'
    || hostname === 'unpkg.com';
}

function isAppPath(pathname) {
  return pathname === '/app'
    || pathname === '/app/'
    || pathname.startsWith('/app/')
    || pathname === '/app.html'
    || pathname === '/scan'
    || pathname === '/scan/'
    || pathname.startsWith('/scan/')
    || pathname === '/scan.html'
    || pathname.startsWith('/static/');
}

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
      Promise.all(
        keys
          .filter((k) => (k.startsWith('app-shell-') || k.startsWith('v5-shell-')) && k !== SHELL)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.hostname.includes('supabase.co')) return;
  if (url.pathname.startsWith('/api/')) return;

  if (isCdnHost(url.hostname)) {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const cached = await cache.match(event.request);
        const network = fetch(event.request).then((res) => {
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        }).catch(() => null);
        if (cached) {
          network.catch(() => {});
          return cached;
        }
        const res = await network;
        if (res) return res;
        throw new Error('CDN offline and uncached');
      })
    );
    return;
  }

  if (isAppPath(url.pathname)) {
    event.respondWith(
      fetch(event.request).then((res) => {
        const isHashedAsset = /\/static\/.+-[A-Za-z0-9_-]{6,}\.(js|css)$/.test(url.pathname);
        if (res.ok && res.type === 'basic' && !isHashedAsset) {
          caches.open(SHELL).then((c) => c.put(event.request, res.clone()));
        }
        return res;
      }).catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (url.pathname.startsWith('/scan')) {
          return (await caches.match('/scan.html'))
            || (await caches.match('/scan'));
        }
        return caches.match('/app/') || caches.match('/app.html');
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
