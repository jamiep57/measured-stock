/**
 * Edge auth gate for Measured Stock.
 * Requires a signed ms_auth cookie (issued by /api/auth/session after
 * Supabase Auth sign-in). Unauthenticated HTML requests redirect to /login.
 */
import { COOKIE_NAME, getAuthCookie, verifyAuthToken } from './lib/cookie.js';

// Paths a "staff" session may reach. Everything else is admin-only.
function isStaffAllowed(pathname) {
  return (
    pathname === '/app' ||
    pathname === '/app/' ||
    pathname === '/app.html' ||
    pathname.startsWith('/app/') ||
    pathname === '/scan' ||
    pathname === '/scan/' ||
    pathname === '/scan.html' ||
    pathname.startsWith('/scan/') ||
    pathname === '/mobile' ||
    pathname === '/mobile.html' ||
    pathname.startsWith('/mobile/') ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/static/') ||
    pathname === '/favicon.ico' ||
    pathname === '/api/logout' ||
    pathname === '/api/client-error' ||
    pathname === '/login' ||
    pathname === '/login.html'
  );
}

function isPublicPath(pathname) {
  return (
    pathname === '/login' ||
    pathname === '/login.html' ||
    pathname === '/setup' ||
    pathname === '/setup.html' ||
    pathname === '/onboard' ||
    pathname === '/onboard.html' ||
    pathname.startsWith('/assets/js/login') ||
    pathname.startsWith('/assets/js/setup') ||
    pathname.startsWith('/assets/js/onboard')
  );
}

export default async function middleware(request) {
  const url = new URL(request.url);

  if (isPublicPath(url.pathname)) {
    return;
  }

  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    return Response.redirect(new URL('/login?error=config', request.url), 302);
  }

  const cookie = getAuthCookie(request.headers.get('cookie'));
  const session = cookie ? await verifyAuthToken(secret, cookie) : null;

  if (session) {
    if (session.role === 'admin' || isStaffAllowed(url.pathname)) {
      return;
    }
    return Response.redirect(new URL('/app/', request.url), 302);
  }

  const next = encodeURIComponent(url.pathname + url.search);
  return Response.redirect(new URL(`/login?next=${next}`, request.url), 302);
}

export const config = {
  // Skip auth for:
  //   /login, /login.html     — sign-in UI
  //   /api/auth/*             — session + user admin APIs
  //   /api/logout             — clear cookies
  //   /api/sync-catchup       — cron (CRON_SECRET inside handler)
  //   static assets           — css/js/images/fonts
  matcher: [
    '/((?!login(?:\\.html)?$|setup(?:\\.html)?$|onboard(?:\\.html)?$|api/auth(?:/|$)|api/logout$|api/unlock$|api/sync-catchup|api/client-error$|assets/js/(?:login|setup|onboard)\\.js$|.*\\.(?:css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|webmanifest)$).*)',
  ],
};
