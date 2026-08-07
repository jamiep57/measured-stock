/**
 * History-based router for V5 admin (site root).
 * Routes documented in v5/README.md
 */

/** Admin lives at site root — home is `/`. */
const BASE = '';

export const SETTINGS_SECTIONS = ['users', 'warehouses', 'categories', 'case-sizes'];

function joinAdmin(...parts) {
  const rest = parts.filter(Boolean).join('/');
  return rest ? `/${rest}` : '/';
}

/** Strip legacy `/v5/admin` prefix so old bookmarks still parse. */
export function stripLegacyAdminPrefix(pathname) {
  const raw = String(pathname || '');
  if (raw === '/v5/admin' || raw === '/v5/admin/' || raw === '/v5/admin.html') return '/';
  if (raw.startsWith('/v5/admin/')) return raw.slice('/v5/admin'.length) || '/';
  return raw;
}

export function parseRoute(pathname = location.pathname) {
  const path = stripLegacyAdminPrefix(pathname).replace(/\/+$/, '') || '/';
  const rest = path === '/' ? '' : path.replace(/^\//, '');

  if (!rest) return { view: 'home' };

  if (rest === 'case-sizes') return { view: 'settings', section: 'case-sizes' };
  if (rest === 'users') return { view: 'settings', section: 'users' };

  const settingsMatch = rest.match(/^settings(?:\/([^/]+))?$/);
  if (settingsMatch) {
    const section = settingsMatch[1] || 'users';
    if (!SETTINGS_SECTIONS.includes(section)) return { view: 'not-found' };
    return { view: 'settings', section };
  }

  if (rest === 'dev') return { view: 'dev' };
  if (rest === 'dev/bugs' || rest === 'bugs') return { view: 'bugs' };
  if (rest === 'dev/audit') return { view: 'audit' };

  const global = ['library', 'kit-library', 'suppliers', 'warehouses', 'volume-pools'];
  if (global.includes(rest)) return { view: rest };

  const m = rest.match(/^events\/([^/]+)(?:\/(.+))?$/);
  if (m) {
    let panel = m[2] || 'dashboard';
    if (panel === 'opening') panel = 'products';
    if (panel === 'projections') panel = 'dashboard';
    if (panel === 'stock-levels') panel = 'dashboard';
    if (panel === 'summary') panel = 'reports';
    if (panel === 'audit') {
      return { view: 'audit', eventId: m[1] };
    }
    return { view: 'event', eventId: m[1], panel };
  }

  return { view: 'not-found' };
}

export function hrefForRoute(route) {
  if (route.view === 'home') return '/';
  if (route.view === 'dev') return '/dev';
  if (route.view === 'bugs') return '/dev/bugs';
  if (route.view === 'audit') return '/dev/audit';
  if (route.view === 'settings') {
    const section = route.section || 'users';
    return `/settings/${section}`;
  }
  if (route.view === 'event') {
    const panel = route.panel || 'dashboard';
    return `/events/${route.eventId}/${panel}`;
  }
  return joinAdmin(route.view);
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
      el.href = `/events/${route.eventId}/${el.dataset.route}`;
    }
  });
  document.getElementById('topbarProfileBtn')?.classList.toggle('active', route.view === 'settings');
}

export { BASE };
