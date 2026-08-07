import '../styles/admin.css';
import { $, toast } from '../lib/util.js';
import { initIcons } from '../lib/icons.js';
import { loadDbScript } from '../lib/load-db.js';
import { loadEventsList, getDB, isNetworkFetchError } from '../db.js';
import { parseRoute, navigate, startRouter, linkSidebar, hrefForRoute } from './router.js';
import { initSidebar, syncSidebar } from './sidebar.js';
import { readRememberedEventId, writeRememberedEventId, resolveActiveEventId } from './event-workspace.js';
import { initSheet } from '../components/sheet.js';
import { initBugSheet } from '../components/bug-sheet.js';
import { PANEL_TITLES, renderPanel, mountPanel, prefetchEventPanels } from './panels/index.js';
import { ADMIN_EVENTS_CHANGED } from './panels/home.js';
import { syncBugOpenDot, mountBugReportFab, syncBugFabVisibility } from './panels/bugs.js';
import { initGlobalSearch, applyGenericProductFilter, ADMIN_PRODUCT_FILTER } from './global-search.js';
import { initSpreadsheetCells } from '../lib/spreadsheet-cells.js';
import { syncAppPresence } from '../lib/app-presence.js';
import { ensureAppAuth, signOutApp, getCachedProfile } from '../lib/auth.js';
import { openOwnProfileEditor } from './panels/users.js';
import { initClientErrorReporting } from '../lib/client-errors.js';
import { initSyncStatus } from '../components/sync-status.js';
import { flushQueue } from '../sync-queue.js';

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
/** Bumps on every navigate so a slow mount can't overwrite a newer panel. */
let renderGen = 0;

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
  const gen = ++renderGen;
  if (route.view === 'audit' && route.eventId) {
    setEventId(route.eventId);
  }

  // Canonicalize URL (legacy /v5/admin/*, /users, event audit aliases, etc.).
  if (route.view !== 'not-found') {
    const canonical = hrefForRoute(route);
    const current = location.pathname.replace(/\/+$/, '') || '/';
    if (current !== canonical) {
      navigate(route, { replace: true });
      route = parseRoute();
    }
  }

  if ((route.view === 'event' || route.view === 'audit') && resolveActiveEventId(route, state)) {
    prefetchEventPanels();
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
  // Immediate feedback while lazy panels (reports/recon/…) download.
  content.innerHTML = '<div class="admin-page"><div class="muted" style="padding:24px">Loading…</div></div>';

  try {
    const html = await renderPanel(route, state);
    if (gen !== renderGen) return;
    content.innerHTML = html;
    // Overlap topbar context load with panel mount — loadEventFull coalesces.
    const searchReady = globalSearch?.syncRoute(route) ?? Promise.resolve();
    const [cleanup] = await Promise.all([
      mountPanel(route, state),
      searchReady,
    ]);
    if (gen !== renderGen) {
      cleanup?.();
      return;
    }
    cleanupPanel = cleanup || null;
  } catch (err) {
    if (gen !== renderGen) return;
    // Stale Vite chunk after deploy → dynamic import() rejects with Failed to fetch.
    if (isNetworkFetchError(err) || /Loading chunk|error loading dynamically imported/i.test(String(err?.message || err))) {
      window.location.reload();
      return;
    }
    console.error(err);
    content.innerHTML = `<div class="admin-page"><div class="dist-empty del-empty--err">${String(err?.message || 'Failed to load page').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))}</div></div>`;
    toast(err.message || 'Failed to load page', true);
    return;
  }
  syncBugFabVisibility();
  requestAnimationFrame(() => {
    if (gen !== renderGen) return;
    content.classList.add('admin-content--enter');
  });
}

function goEventPanel(panel) {
  const eventId = resolveActiveEventId(parseRoute(), state);
  if (!eventId || !panel) return false;
  navigate({ view: 'event', eventId, panel });
  void render(parseRoute());
  return true;
}

function wireNav() {
  document.getElementById('sidebarGlobal')?.addEventListener('click', (e) => {
    const eventLink = e.target.closest('a[data-event], .nav-link-cog[data-event]');
    if (eventLink) {
      e.preventDefault();
      goEventPanel(eventLink.dataset.route);
      return;
    }
    const a = e.target.closest('a[data-route]:not([data-event])');
    if (!a) return;
    e.preventDefault();
    const view = a.dataset.route;
    if (view === 'home') navigate({ view: 'home' });
    else if (view === 'settings') navigate({ view: 'settings', section: a.dataset.section || 'users' });
    else navigate({ view });
    void render(parseRoute());
  });

  document.querySelector('.sidebar-nav-tools')?.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-route]:not([data-event])');
    if (!a) return;
    e.preventDefault();
    const view = a.dataset.route;
    if (view === 'settings') navigate({ view: 'settings', section: a.dataset.section || 'users' });
    else navigate({ view });
    void render(parseRoute());
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
        void render(parseRoute());
        return;
      }
      const a = e.target.closest('a[data-event], .nav-link-cog[data-event]');
      if (!a) return;
      e.preventDefault();
      goEventPanel(a.dataset.route);
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
  initClientErrorReporting();
  // After a Vercel deploy, stale hashed chunks 404 and dynamic import() rejects
  // with "Failed to fetch". One reload picks up the new admin entry + assets.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    window.location.reload();
  });
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
  initSyncStatus({
    bannerId: 'adminOfflineBanner',
    badgeId: 'adminSyncBadge',
    lastSyncId: 'adminLastSync',
    onOnline: async () => {
      try {
        await flushQueue(getDB());
      } catch (err) {
        console.warn('admin flush', err);
      }
    },
  });

  initSheet();
  initBugSheet();
  initIcons();
  // Mount early so the report button survives later boot failures.
  mountBugReportFab();
  initSpreadsheetCells(document.body);
  wireNav();
  initSidebar((opts = {}) => {
    if (opts.clearEvent) setEventId('');
    if (opts.panel) {
      goEventPanel(opts.panel);
      return;
    }
    void render(parseRoute());
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
