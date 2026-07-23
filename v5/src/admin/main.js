import '../styles/admin.css';
import { $, toast } from '../lib/util.js';
import { initIcons } from '../lib/icons.js';
import { loadDbScript } from '../lib/load-db.js';
import { loadEventsList } from '../db.js';
import { parseRoute, navigate, startRouter, linkSidebar } from './router.js';
import { initSidebar, syncSidebar } from './sidebar.js';
import { initSheet } from '../components/sheet.js';
import { PANEL_TITLES, renderPanel, mountPanel } from './panels/index.js';
import { initGlobalSearch, applyGenericProductFilter, ADMIN_PRODUCT_FILTER } from './global-search.js';
import { initSpreadsheetCells } from '../lib/spreadsheet-cells.js';

const state = {
  events: [],
  eventId: '',
};

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
  linkSidebar(route);
  syncSidebar(route, state);

  const title = route.view === 'event'
    ? (PANEL_TITLES[route.panel] || route.panel)
    : (PANEL_TITLES[route.view] || 'Admin');

  if (route.view === 'event' && route.eventId) {
    state.eventId = route.eventId;
    const event = state.events.find((e) => e.id === route.eventId);
    $('pageTitle').textContent = event ? `${title} · ${event.name}` : title;
  } else {
    $('pageTitle').textContent = title;
  }

  if (cleanupPanel) {
    cleanupPanel();
    cleanupPanel = null;
  }

  $('adminContent').innerHTML = await renderPanel(route, state);
  await globalSearch?.syncRoute(route);
  cleanupPanel = mountPanel(route, state);
}

function wireNav() {
  document.getElementById('sidebarPrimary')?.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-route]:not([data-event])');
    if (!a) return;
    e.preventDefault();
    state.eventId = '';
    navigate({ view: 'home' });
    render(parseRoute());
  });

  document.getElementById('sidebarGlobal')?.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-route]:not([data-event])');
    if (!a) return;
    e.preventDefault();
    const view = a.dataset.route;
    navigate(view === 'home' ? { view: 'home' } : { view });
    render(parseRoute());
  });

  const eventNavIds = ['sidebarEventStock', 'sidebarEventSales'];
  eventNavIds.forEach((id) => {
    document.getElementById(id)?.addEventListener('click', (e) => {
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

async function boot() {
  try {
    await loadDbScript();
  } catch {
    toast('Database layer failed to load', true);
    return;
  }

  initSheet();
  initIcons();
  initSpreadsheetCells(document.body);
  wireNav();
  initSidebar((opts = {}) => {
    if (opts.clearEvent) state.eventId = '';
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

  const route = parseRoute();
  startRouter(render);
}

boot().catch((err) => {
  console.error(err);
  toast(err.message || 'Admin failed to start', true);
});
