import './styles/v5.css';
import './styles/kit-count.css';
import { $, toast, syncChromeSizes } from './lib/util.js';
import { loadCaseSizes, loadEventsList, loadEventFull, loadSuppliers } from './db.js';
import { getDB } from './db.js';
import {
  flushQueue,
  bindOnlineFlush,
} from './sync-queue.js';
import { initSheet } from './components/sheet.js';
import { initCounts, loadCountsView, flushPendingCounts, onCountsTabVisible, startNewCount } from './counts.js';
import { initDeliveries, loadDeliveriesView, flushPendingDeliveries, startNewDelivery } from './deliveries.js';
import { initTransfers, loadTransfersView, startNewTransfer } from './transfers.js';
import { initWastage, loadWastageView } from './wastage.js';
import { loadDbScript } from './lib/load-db.js';
import { initSpreadsheetCells } from './lib/spreadsheet-cells.js';
import { loadWarehousesList } from './lib/transfer-form.js';
import { startKitCountApp } from './kit-count-app.js';
import { setupMeasuredPwaInstall } from './lib/pwa-install.js';
import { showEventGate, hideEventGate } from './event-gate.js';

const TABS = new Set(['counts', 'kit', 'deliveries', 'transfers', 'wastage']);
const DEFAULT_TAB = 'counts';
const EVENT_STORE_KEY = 'v5_event';
const WAREHOUSE_STORE_KEY = 'v5_warehouse';

const state = {
  eventId: '',
  event: null,
  warehouseId: '',
  warehouse: null,
  suppliers: [],
  caseSizes: [],
  tab: DEFAULT_TAB,
  /** @type {Array<{ id: string, name?: string, status?: string }>} */
  events: [],
  /** @type {Array<{ id: string, name?: string, address?: string }>} */
  warehouses: [],
  ready: false,
};

/** @type {null | {
 *   setPreferredEvent?: (id: string, name?: string) => void,
 *   setPreferredWarehouse?: (id: string, name?: string) => void,
 *   runHomeAction?: (action: string) => Promise<boolean> | boolean,
 * }} */
let kitApi = null;
let kitStarting = false;

function hasLocation() {
  return !!(state.eventId || state.warehouseId);
}

function selectedKind() {
  return state.warehouseId ? 'warehouse' : 'event';
}

function selectedId() {
  return state.warehouseId || state.eventId || '';
}

function getContext() {
  return {
    eventId: state.eventId,
    event: state.event,
    suppliers: state.suppliers,
    caseSizes: state.caseSizes,
  };
}

function tabFromUrl() {
  const params = new URLSearchParams(location.search);
  const tab = (params.get('tab') || '').trim().toLowerCase();
  return TABS.has(tab) ? tab : DEFAULT_TAB;
}

function setUrlTab(tab) {
  const url = new URL(location.href);
  if (tab && tab !== DEFAULT_TAB) url.searchParams.set('tab', tab);
  else url.searchParams.delete('tab');
  if (tab !== 'kit') url.searchParams.delete('c');
  history.replaceState(null, '', url.pathname + url.search);
}

function setKitDeep(deep) {
  document.documentElement.classList.toggle('kit-deep', !!deep);
  syncComposeFab();
  syncChromeSizes();
}

function setComposeFabOpen(open) {
  const root = $('composeFab');
  const menu = $('composeFabMenu');
  const backdrop = $('composeFabBackdrop');
  const btn = $('composeFabBtn');
  if (!root || !menu || !btn) return;
  root.classList.toggle('is-open', open);
  menu.hidden = !open;
  if (backdrop) backdrop.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function syncComposeFab() {
  const fab = $('composeFab');
  if (!fab) return;
  const show = state.ready
    && !document.documentElement.classList.contains('counting')
    && !document.documentElement.classList.contains('kit-deep');
  fab.hidden = !show;
  if (!show) setComposeFabOpen(false);
}

async function runComposeAction(action) {
  setComposeFabOpen(false);

  if (action === 'count') {
    switchTab('counts');
    // Wait a tick so the counts view has rendered / context is fresh.
    await Promise.resolve();
    startNewCount();
    return;
  }
  if (action === 'delivery') {
    switchTab('deliveries');
    await Promise.resolve();
    startNewDelivery();
    return;
  }
  if (action === 'transfer') {
    switchTab('transfers');
    await Promise.resolve();
    startNewTransfer();
    return;
  }
  if (action === 'kit') {
    switchTab('kit');
    await ensureKit();
    return;
  }
}

function initComposeFab() {
  const btn = $('composeFabBtn');
  const backdrop = $('composeFabBackdrop');
  if (!btn) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const root = $('composeFab');
    setComposeFabOpen(!root?.classList.contains('is-open'));
  });
  backdrop?.addEventListener('click', () => setComposeFabOpen(false));

  document.querySelectorAll('[data-compose]').forEach((item) => {
    item.addEventListener('click', () => {
      runComposeAction(item.dataset.compose);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setComposeFabOpen(false);
  });
}

function updateEventPickerLabel() {
  const label = $('eventPickerLabel');
  const wrap = $('eventSelectWrap');
  const btn = $('eventPickerBtn');
  if (!label || !wrap) return;

  wrap.classList.remove('is-static');
  if (state.warehouseId) {
    label.textContent = state.warehouse?.name || 'Warehouse';
    if (btn) btn.setAttribute('aria-label', 'Change warehouse');
    return;
  }
  label.textContent = state.event?.name || 'Select location';
  if (btn) btn.setAttribute('aria-label', 'Change location');
}

async function flushAll() {
  try {
    const DB = getDB();
    await flushQueue(DB);
    await flushPendingCounts();
    await flushPendingDeliveries();
    return true;
  } catch (err) {
    console.warn('flush', err);
    toast('Sync failed — check connection', true);
    return false;
  }
}

function initPullToRefresh() {
  const main = $('main');
  const ptr = $('pullRefresh');
  if (!main || !ptr) return;

  const THRESHOLD = 64;
  let startY = null;
  let pulling = false;
  let refreshing = false;

  function resetPtr() {
    ptr.classList.remove('is-ready', 'is-refreshing');
    ptr.style.height = '0px';
    ptr.hidden = true;
    ptr.setAttribute('aria-hidden', 'true');
    const label = ptr.querySelector('.ptr-label');
    if (label) label.textContent = 'Pull to refresh';
  }

  function canPull() {
    if (!state.ready || refreshing) return false;
    if (document.documentElement.classList.contains('counting')) return false;
    if (document.documentElement.classList.contains('kit-deep')) return false;
    return main.scrollTop <= 0;
  }

  main.addEventListener('touchstart', (e) => {
    if (!canPull()) {
      startY = null;
      pulling = false;
      return;
    }
    startY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  main.addEventListener('touchmove', (e) => {
    if (!pulling || startY == null || refreshing) return;
    if (main.scrollTop > 0) {
      pulling = false;
      resetPtr();
      return;
    }
    const dy = e.touches[0].clientY - startY;
    if (dy <= 8) return;
    const pull = Math.min(dy * 0.4, 88);
    ptr.hidden = false;
    ptr.setAttribute('aria-hidden', 'false');
    ptr.style.height = `${pull}px`;
    const ready = pull >= THRESHOLD;
    ptr.classList.toggle('is-ready', ready);
    const label = ptr.querySelector('.ptr-label');
    if (label) label.textContent = ready ? 'Release to refresh' : 'Pull to refresh';
  }, { passive: true });

  main.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;
    startY = null;
    const ready = ptr.classList.contains('is-ready');
    if (!ready || refreshing) {
      resetPtr();
      return;
    }

    refreshing = true;
    ptr.hidden = false;
    ptr.style.height = '48px';
    ptr.classList.add('is-refreshing');
    ptr.classList.remove('is-ready');
    const label = ptr.querySelector('.ptr-label');
    if (label) label.textContent = 'Refreshing…';

    flushAll()
      .then((ok) => {
        if (!ok) return;
        if (state.ready) reloadTab();
        toast('Synced');
      })
      .finally(() => {
        refreshing = false;
        resetPtr();
      });
  }, { passive: true });

  main.addEventListener('touchcancel', () => {
    pulling = false;
    startY = null;
    if (!refreshing) resetPtr();
  }, { passive: true });
}

function syncKitPreferred() {
  if (!kitApi) return;
  if (state.warehouseId) {
    kitApi.setPreferredWarehouse?.(state.warehouseId, state.warehouse?.name || '');
    return;
  }
  kitApi.setPreferredEvent?.(state.eventId, state.event?.name || '');
}

async function ensureKit() {
  if (kitApi) {
    syncKitPreferred();
    return kitApi;
  }
  if (kitStarting) return null;
  kitStarting = true;
  const root = $('view-kit');
  if (root) {
    root.classList.add('kc-root');
    root.innerHTML = `<div class="kc-loading">Loading kit…</div>`;
  }
  try {
    kitApi = await startKitCountApp(getDB(), {
      rootEl: root,
      embedded: true,
      preferredEventId: state.warehouseId ? '' : state.eventId,
      preferredEventName: state.warehouseId ? '' : (state.event?.name || ''),
      preferredWarehouseId: state.warehouseId,
      preferredWarehouseName: state.warehouse?.name || '',
      onDeepChange: setKitDeep,
    }) || {};
  } catch (err) {
    console.error(err);
    if (root) {
      root.innerHTML = `<div class="kc-fatal">${err.message || 'Kit failed to start'}</div>`;
    }
    toast(err.message || 'Kit failed to start', true);
  } finally {
    kitStarting = false;
  }
  return kitApi;
}

function switchTab(tab) {
  if (!TABS.has(tab)) tab = DEFAULT_TAB;
  state.tab = tab;
  setUrlTab(tab);

  document.documentElement.classList.toggle('kit-tab', tab === 'kit');

  document.querySelectorAll('.view').forEach((v) => {
    const on = v.id === 'view-' + tab;
    v.classList.toggle('active', on);
    v.hidden = !on;
    v.toggleAttribute('inert', !on);
  });
  document.querySelectorAll('.navbtn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Leaving Kit clears deep chrome so Home/Counts never inherit kit-only UI.
  if (tab !== 'kit') {
    setKitDeep(false);
    document.documentElement.classList.remove('kit-deep');
  }

  onCountsTabVisible(tab === 'counts');
  updateEventPickerLabel();
  reloadTab();
  syncComposeFab();
  syncChromeSizes();
}

function reloadTab() {
  initCounts(getContext());
  initDeliveries(getContext());
  initTransfers(getContext());
  initWastage(getContext());

  if (state.tab === 'deliveries') {
    loadDeliveriesView();
  } else if (state.tab === 'counts') {
    loadCountsView();
  } else if (state.tab === 'kit') {
    ensureKit();
  } else if (state.tab === 'transfers') {
    loadTransfersView();
  } else if (state.tab === 'wastage') {
    loadWastageView();
  }
}

function afterLocationReady(preferTab) {
  hideEventGate();
  document.documentElement.classList.remove('event-gate-ready');
  if (!state.ready) {
    state.ready = true;
    document.documentElement.classList.add('app-ready');
    switchTab(preferTab || tabFromUrl());
    syncComposeFab();
    // Measure after the float-in starts so content clears the bar.
    requestAnimationFrame(() => {
      syncChromeSizes();
      window.setTimeout(syncChromeSizes, 560);
    });
    return;
  }
  updateEventPickerLabel();
  if (preferTab) switchTab(preferTab);
  else reloadTab();
  syncComposeFab();
  syncChromeSizes();
}

function openEventGate() {
  document.documentElement.classList.toggle('event-gate-ready', state.ready);
  showEventGate({
    events: state.events,
    warehouses: state.warehouses,
    selectedId: selectedId(),
    selectedKind: selectedKind(),
    dismissible: state.ready && hasLocation(),
    onDismiss: () => {
      document.documentElement.classList.remove('event-gate-ready');
    },
    onSelect: async ({ kind, id }) => {
      if (kind === 'warehouse') {
        await onWarehouseChange(id);
        afterLocationReady('kit');
        return;
      }
      await onEventChange(id);
      afterLocationReady();
    },
  });
  syncChromeSizes();
}

function clearWarehouseSelection() {
  state.warehouseId = '';
  state.warehouse = null;
  try {
    localStorage.removeItem(WAREHOUSE_STORE_KEY);
  } catch { /* ignore */ }
}

function clearEventSelection() {
  state.eventId = '';
  state.event = null;
  try {
    localStorage.removeItem(EVENT_STORE_KEY);
  } catch { /* ignore */ }
  const pick = $('eventPick');
  if (pick) pick.value = '';
}

async function onWarehouseChange(id) {
  clearEventSelection();
  state.warehouseId = id || '';
  state.warehouse = state.warehouses.find((w) => w.id === id) || null;
  try {
    id
      ? localStorage.setItem(WAREHOUSE_STORE_KEY, id)
      : localStorage.removeItem(WAREHOUSE_STORE_KEY);
  } catch { /* ignore */ }
  syncKitPreferred();
  updateEventPickerLabel();
}

async function onEventChange(id) {
  clearWarehouseSelection();
  state.eventId = id;
  try {
    id ? localStorage.setItem(EVENT_STORE_KEY, id) : localStorage.removeItem(EVENT_STORE_KEY);
  } catch { /* ignore */ }

  const pick = $('eventPick');
  if (pick && pick.value !== id) pick.value = id;

  state.event = null;
  if (id) {
    try {
      const [ev, suppliers] = await Promise.all([
        loadEventFull(id),
        state.suppliers.length ? Promise.resolve(state.suppliers) : loadSuppliers(),
      ]);
      state.event = ev;
      state.suppliers = suppliers || [];
    } catch (err) {
      console.error(err);
      toast(err.message || 'Failed to load event', true);
    }
  }
  syncKitPreferred();
  updateEventPickerLabel();
}

async function boot() {
  try {
    await loadDbScript();
  } catch {
    toast('Database layer failed to load', true);
    return;
  }

  initSheet();
  initSpreadsheetCells(document.body);
  initComposeFab();

  initCounts(getContext());
  initDeliveries(getContext());
  initTransfers(getContext());
  initWastage(getContext());

  bindOnlineFlush(flushAll);
  setupMeasuredPwaInstall();
  initPullToRefresh();

  document.querySelectorAll('.navbtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!state.ready) {
        openEventGate();
        return;
      }
      switchTab(btn.dataset.tab);
    });
  });
  $('eventPickerBtn')?.addEventListener('click', () => {
    openEventGate();
  });

  try {
    state.caseSizes = await loadCaseSizes();
    const [events, warehouses] = await Promise.all([
      loadEventsList(),
      loadWarehousesList(),
    ]);
    state.events = events;
    state.warehouses = (warehouses || []).slice().sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || '')));

    const rememberedWh = localStorage.getItem(WAREHOUSE_STORE_KEY) || '';
    const remembered = localStorage.getItem(EVENT_STORE_KEY) || localStorage.getItem('v2_event') || '';
    $('eventPick').innerHTML = '<option value="">Select an event…</option>' +
      state.events.map((e) => `<option value="${e.id}">${e.name}</option>`).join('');

    if (rememberedWh && state.warehouses.some((w) => w.id === rememberedWh)) {
      // Prefill warehouse highlight on the gate; user still confirms by tapping.
      state.warehouseId = rememberedWh;
      state.warehouse = state.warehouses.find((w) => w.id === rememberedWh) || null;
    } else if (remembered && state.events.some((e) => e.id === remembered)) {
      $('eventPick').value = remembered;
      // Prefill selection highlight on the gate; user still confirms by tapping.
      state.eventId = remembered;
      try {
        state.event = await loadEventFull(remembered);
      } catch {
        state.event = null;
        state.eventId = '';
      }
    }
  } catch (err) {
    console.error('boot', err);
    toast(err.message || 'Failed to start', true);
  }

  await flushAll();

  // Always open with the full-page event selector.
  openEventGate();

  window.addEventListener('resize', syncChromeSizes);
  window.addEventListener('orientationchange', () => {
    window.setTimeout(syncChromeSizes, 50);
    window.setTimeout(syncChromeSizes, 300);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncChromeSizes);
    window.visualViewport.addEventListener('scroll', syncChromeSizes);
  }
  syncChromeSizes();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/v5/sw.js', { scope: '/v5/' }).catch((err) => {
      console.warn('SW registration failed', err);
    });
  });
}

boot().catch((err) => {
  console.error('boot', err);
  toast(err.message || 'Failed to start', true);
});
