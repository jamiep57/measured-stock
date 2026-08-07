/**
 * History-based router for V5 admin.
 * Routes documented in v5/README.md
 */

const BASE = '/v5/admin';

export const SETTINGS_SECTIONS = ['users', 'warehouses', 'categories', 'case-sizes'];

export function parseRoute(pathname = location.pathname) {
  const path = pathname.replace(/\/+$/, '') || BASE;
  const rest = path.startsWith(BASE) ? path.slice(BASE.length).replace(/^\//, '') : path;

  if (!rest) return { view: 'home' };

  // Legacy Catalog → Case sizes URL now lives under Workspace settings.
  if (rest === 'case-sizes') return { view: 'settings', section: 'case-sizes' };

  // Legacy standalone users → Workspace settings → Users.
  if (rest === 'users') return { view: 'settings', section: 'users' };

  // Workspace settings (+ optional section).
  const settingsMatch = rest.match(/^settings(?:\/([^/]+))?$/);
  if (settingsMatch) {
    const section = settingsMatch[1] || 'users';
    if (!SETTINGS_SECTIONS.includes(section)) return { view: 'not-found' };
    return { view: 'settings', section };
  }

  // Dev tools home + nested pages (audit / bugs live here, not in main nav).
  if (rest === 'dev') return { view: 'dev' };
  if (rest === 'dev/bugs' || rest === 'bugs') return { view: 'bugs' };
  if (rest === 'dev/audit') return { view: 'audit' };

  const global = ['library', 'kit-library', 'suppliers', 'warehouses', 'volume-pools'];
  if (global.includes(rest)) return { view: rest };

  const m = rest.match(/^events\/([^/]+)(?:\/(.+))?$/);
  if (m) {
    let panel = m[2] || 'dashboard';
    if (panel === 'opening') panel = 'products';
    // Stock projections live on the event dashboard now.
    if (panel === 'projections') panel = 'dashboard';
    // Stock levels panel is not shipped yet — bookmarks land on dashboard.
    if (panel === 'stock-levels') panel = 'dashboard';
    // Legacy "summary" URL is Reports.
    if (panel === 'summary') panel = 'reports';
    // Forensic audit moved under /dev — keep event URL as a bookmark alias.
    if (panel === 'audit') {
      return { view: 'audit', eventId: m[1] };
    }
    return {
      view: 'event',
      eventId: m[1],
      panel,
    };
  }

  return { view: 'not-found' };
}

export function hrefForRoute(route) {
  if (route.view === 'home') return BASE;
  if (route.view === 'dev') return `${BASE}/dev`;
  if (route.view === 'bugs') return `${BASE}/dev/bugs`;
  if (route.view === 'audit') return `${BASE}/dev/audit`;
  if (route.view === 'settings') {
    const section = route.section || 'users';
    return `${BASE}/settings/${section}`;
  }
  if (route.view === 'event') {
    const panel = route.panel || 'dashboard';
    return `${BASE}/events/${route.eventId}/${panel}`;
  }
  return `${BASE}/${route.view}`;
}

export function navigate(route, { replace = false } = {}) {
  const href = hrefForRoute(route);
  if (replace) history.replaceState(route, '', href);
  else history.pushState(route, '', href);
  return route;
}

export function startRouter(onRoute) {
  const emit = () => onRoute(parseRoute());
  window.addEventListener('popstate', emit);
  emit();
  return emit;
}

export function linkSidebar(route) {
  document.querySelectorAll('.nav-link[data-route], .nav-link-cog[data-route], [data-profile-action="settings"][data-route]').forEach((el) => {
    const isEvent = el.hasAttribute('data-event');
    let active = false;
    if (route.view === 'event' && isEvent) {
      active = el.dataset.route === route.panel;
    } else if (!isEvent && route.view === el.dataset.route) {
      if (el.dataset.section) {
        active = route.section === el.dataset.section;
      } else {
        active = true;
      }
    }
    el.classList.toggle('active', active);
    if (isEvent && route.view === 'event' && route.eventId) {
      el.href = `${BASE}/events/${route.eventId}/${el.dataset.route}`;
    }
  });
  document.getElementById('topbarProfileBtn')?.classList.toggle('active', route.view === 'settings');
}

export { BASE };
