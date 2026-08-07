import '../styles/admin.css';
import { $, toast } from '../lib/util.js';
import { initIcons } from '../lib/icons.js';
import { loadDbScript } from '../lib/load-db.js';
import { loadEventsList } from '../db.js';
import { parseRoute, navigate, startRouter, linkSidebar, hrefForRoute } from './router.js';
import { initSidebar, syncSidebar } from './sidebar.js';
import { readRememberedEventId, writeRememberedEventId } from './event-workspace.js';
import { initSheet } from '../components/sheet.js';
import { initBugSheet } from '../components/bug-sheet.js';
import { PANEL_TITLES, renderPanel, mountPanel } from './panels/index.js';
import { ADMIN_EVENTS_CHANGED } from './panels/home.js';
import { syncBugOpenDot, mountBugReportFab, syncBugFabVisibility } from './panels/bugs.js';
import { initGlobalSearch, applyGenericProductFilter, ADMIN_PRODUCT_FILTER } from './global-search.js';
import { initSpreadsheetCells } from '../lib/spreadsheet-cells.js';
import { syncAppPresence } from '../lib/app-presence.js';
import { ensureAppAuth, signOutApp, getCachedProfile } from '../lib/auth.js';
import { openOwnProfileEditor } from './panels/users.js';

const state = {
  events: [],
  eventId: readRememberedEventId(),
};

function setEventId(id) {
  state.eventId = id || '';
  writeRememberedEventId(state.eventId);
}

let cleanupPanel = null;
let globalSearch = null;
let genericFilterOff = null;

function wireGenericProductFilter() {
  if (genericFilterOff) genericFilterOff();
  const handler = (e) => {
    if (e.detail?.handled) return;
    applyGenericProductFilter(e.detail);
  };
  document.addEventListener(ADMIN_PRODUCT_FILTER, handler);
  genericFilterOff = () => document.removeEventListener(ADMIN_PRODUCT_FILTER, handler);
}

async function loadEvents() {
  state.events = await loadEventsList();
}

async function render(route) {
  if (route.view === 'audit' && route.eventId) {
    setEventId(route.eventId);
  }
  // Canonical audit URL is /v5/admin/dev/audit (legacy event URLs still parse).
  if (route.view === 'audit') {
    const canonical = '/v5/admin/dev/audit';
    if (location.pathname.replace(/\/+$/, '') !== canonical) {
      navigate({ view: 'audit' }, { replace: true });
      route = parseRoute();
    }
  }

  // Canonical settings URLs are /v5/admin/settings/:section (legacy /users, /case-sizes, bare /settings).
  if (route.view === 'settings') {
    const canonical = hrefForRoute(route);
    if (location.pathname.replace(/\/+$/, '') !== canonical) {
      navigate(route, { replace: true });
      route = parseRoute();
    }
  }

  linkSidebar(route);
  syncSidebar(route, state);
  const presenceEventId = (route.view === 'event' && route.eventId)
    || (route.view === 'audit' ? state.eventId : '')
    || '';
  const presencePanel = route.view === 'event'
    ? (route.panel || '')
    : (route.view || '');
  syncAppPresence({ eventId: presenceEventId, panel: presencePanel });

  const title = route.view === 'event'
    ? (PANEL_TITLES[route.panel] || route.panel)
    : (PANEL_TITLES[route.view] || 'Admin');

  if (route.view === 'event' && route.eventId) {
    setEventId(route.eventId);
    const event = state.events.find((e) => e.id === route.eventId);
    $('pageTitle').textContent = event ? `${title} · ${event.name}` : title;
  } else if (route.view === 'audit' && state.eventId) {
    const event = state.events.find((e) => e.id === state.eventId);
    $('pageTitle').textContent = event ? `${title} · ${event.name}` : title;
  } else {
    $('pageTitle').textContent = title;
  }

  if (cleanupPanel) {
    cleanupPanel();
    cleanupPanel = null;
  }

  const content = $('adminContent');
  content.classList.remove('admin-content--enter');
  content.innerHTML = await renderPanel(route, state);
  await globalSearch?.syncRoute(route);
  cleanupPanel = mountPanel(route, state);
  syncBugFabVisibility();
  requestAnimationFrame(() => {
    content.classList.add('admin-content--enter');
  });
}

function wireNav() {
  document.getElementById('sidebarGlobal')?.addEventListener('click', (e) => {
    const eventLink = e.target.closest('a[data-event], .nav-link-cog[data-event]');
    if (eventLink) {
      e.preventDefault();
      const route = parseRoute();
      const eventId = (route.view === 'event' && route.eventId) || state.eventId;
      if (!eventId) return;
      navigate({ view: 'event', eventId, panel: eventLink.dataset.route });
      render(parseRoute());
      return;
    }
    const a = e.target.closest('a[data-route]:not([data-event])');
    if (!a) return;
    e.preventDefault();
    const view = a.dataset.route;
    if (view === 'home') navigate({ view: 'home' });
    else if (view === 'settings') navigate({ view: 'settings', section: a.dataset.section || 'users' });
    else navigate({ view });
    render(parseRoute());
  });

  document.querySelector('.sidebar-nav-tools')?.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-route]:not([data-event])');
    if (!a) return;
    e.preventDefault();
    const view = a.dataset.route;
    if (view === 'settings') navigate({ view: 'settings', section: a.dataset.section || 'users' });
    else navigate({ view });
    render(parseRoute());
  });

  const eventNavIds = ['sidebarEventStock', 'sidebarEventKit', 'sidebarEventSales', 'sidebarEventReports'];
  eventNavIds.forEach((id) => {
    document.getElementById(id)?.addEventListener('click', (e) => {
      const globalLink = e.target.closest('a[data-route]:not([data-event])');
      if (globalLink) {
        e.preventDefault();
        const view = globalLink.dataset.route;
        if (view === 'settings') navigate({ view: 'settings', section: globalLink.dataset.section || 'users' });
        else navigate({ view });
        render(parseRoute());
        return;
      }
      const a = e.target.closest('a[data-event], .nav-link-cog[data-event]');
      if (!a) return;
      e.preventDefault();
      const route = parseRoute();
      const eventId = (route.view === 'event' && route.eventId) || state.eventId;
      if (!eventId) return;
      navigate({ view: 'event', eventId, panel: a.dataset.route });
      render(parseRoute());
    });
  });
}

function syncProfileMenuLabel() {
  const label = document.getElementById('topbarProfileLabel');
  if (!label) return;
  const profile = getCachedProfile();
  const name = profile?.display_name?.trim();
  const email = profile?.email?.trim();
  label.textContent = name || email || 'Account';
}

function closeProfileMenu() {
  const btn = document.getElementById('topbarProfileBtn');
  const menu = document.getElementById('topbarProfileMenu');
  if (!btn || !menu || menu.hidden) return;
  menu.hidden = true;
  btn.setAttribute('aria-expanded', 'false');
}

function openProfileMenu() {
  const btn = document.getElementById('topbarProfileBtn');
  const menu = document.getElementById('topbarProfileMenu');
  if (!btn || !menu) return;
  syncProfileMenuLabel();
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
}

function wireProfileMenu() {
  const wrap = document.getElementById('topbarProfileWrap');
  const btn = document.getElementById('topbarProfileBtn');
  const menu = document.getElementById('topbarProfileMenu');
  if (!wrap || !btn || !menu) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) openProfileMenu();
    else closeProfileMenu();
  });

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-profile-action]');
    if (!item) return;
    const action = item.getAttribute('data-profile-action');
    if (action === 'settings') {
      e.preventDefault();
      closeProfileMenu();
      navigate({ view: 'settings', section: 'users' });
      render(parseRoute());
      return;
    }
    if (action === 'profile') {
      e.preventDefault();
      closeProfileMenu();
      openOwnProfileEditor();
      return;
    }
    if (action === 'logout') {
      e.preventDefault();
      closeProfileMenu();
      signOutApp();
    }
  });

  document.addEventListener('click', (e) => {
    if (!menu.hidden && !wrap.contains(e.target)) closeProfileMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeProfileMenu();
  });
}

async function boot() {
  try {
    await loadDbScript();
  } catch {
    toast('Database layer failed to load', true);
    return;
  }

  const auth = await ensureAppAuth({ requireAdmin: true });
  if (!auth) return;

  wireProfileMenu();
  syncProfileMenuLabel();

  initSheet();
  initBugSheet();
  initIcons();
  // Mount early so the report button survives later boot failures.
  mountBugReportFab();
  initSpreadsheetCells(document.body);
  wireNav();
  initSidebar((opts = {}) => {
    if (opts.clearEvent) setEventId('');
    render(parseRoute());
  });
  wireGenericProductFilter();
  globalSearch = initGlobalSearch();

  try {
    await loadEvents();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Failed to load events', true);
  }

  syncBugOpenDot();

  document.addEventListener(ADMIN_EVENTS_CHANGED, async (e) => {
    try {
      await loadEvents();
    } catch (err) {
      console.warn(err);
    }
    const eventId = e.detail?.eventId;
    if (eventId) setEventId(eventId);
    render(parseRoute());
  });

  startRouter(render);
}

boot().catch((err) => {
  console.error(err);
  toast(err.message || 'Admin failed to start', true);
});
