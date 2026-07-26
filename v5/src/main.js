import './styles/v5.css';
import './styles/kit-count.css';
import { $, toast, syncChromeSizes } from './lib/util.js';
import { loadCaseSizes, loadEventsList, loadEventFull, loadSuppliers } from './db.js';
import { getDB } from './db.js';
import {
  flushQueue,
  bindOnlineFlush,
  setSyncStatusListener,
  getQueueStats,
} from './sync-queue.js';
import { initSheet } from './components/sheet.js';
import { initCounts, loadCountsView, flushPendingCounts, onCountsTabVisible } from './counts.js';
import { initDeliveries, loadDeliveriesView, flushPendingDeliveries } from './deliveries.js';
import { loadDbScript } from './lib/load-db.js';
import { initSpreadsheetCells } from './lib/spreadsheet-cells.js';
import { loadHomeView } from './home.js';
import { startKitCountApp } from './kit-count-app.js';
import { setupMeasuredPwaInstall } from './lib/pwa-install.js';
import { showEventGate, hideEventGate } from './event-gate.js';

const TABS = new Set(['home', 'counts', 'kit', 'deliveries']);

const state = {
  eventId: '',
  event: null,
  suppliers: [],
  caseSizes: [],
  tab: 'home',
  /** @type {Array<{ id: string, name?: string, status?: string }>} */
  events: [],
  ready: false,
};

/** @type {null | { setPreferredEvent?: (id: string, name?: string) => void }} */
let kitApi = null;
let kitStarting = false;

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
  return TABS.has(tab) ? tab : 'home';
}

function setUrlTab(tab) {
  const url = new URL(location.href);
  if (tab && tab !== 'home') url.searchParams.set('tab', tab);
  else url.searchParams.delete('tab');
  if (tab !== 'kit') url.searchParams.delete('c');
  history.replaceState(null, '', url.pathname + url.search);
}

function setKitDeep(deep) {
  document.documentElement.classList.toggle('kit-deep', !!deep);
  syncChromeSizes();
}

async function updateSyncBadge() {
  const badge = $('syncBadge');
  if (!badge) return;
  try {
    const stats = await getQueueStats();
    if (stats.total > 0) {
      badge.hidden = false;
      badge.classList.toggle('failed', stats.failed > 0);
      badge.title = stats.failed
        ? `${stats.failed} failed sync — tap to retry`
        : `${stats.pending} pending sync — tap to sync`;
    } else {
      badge.hidden = true;
      badge.removeAttribute('title');
    }
  } catch {
    badge.hidden = true;
  }
}

function updateEventPickerLabel() {
  const label = $('eventPickerLabel');
  const wrap = $('eventSelectWrap');
  if (!label || !wrap) return;

  if (state.tab === 'kit') {
    wrap.classList.add('is-static');
    label.textContent = 'Kit';
    return;
  }

  wrap.classList.remove('is-static');
  label.textContent = state.event?.name || 'Select event';
}

async function flushAll() {
  try {
    const DB = getDB();
    await flushQueue(DB);
    await flushPendingCounts();
    await flushPendingDeliveries();
    await updateSyncBadge();
  } catch (err) {
    console.warn('flush', err);
    toast('Sync failed — check connection', true);
  }
}

async function ensureKit() {
  if (kitApi) {
    kitApi.setPreferredEvent?.(state.eventId, state.event?.name || '');
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
      preferredEventId: state.eventId,
      preferredEventName: state.event?.name || '',
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
  if (!TABS.has(tab)) tab = 'home';
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
  syncChromeSizes();
}

function reloadTab() {
  initCounts(getContext());
  initDeliveries(getContext());

  if (state.tab === 'home') {
    loadHomeView({
      eventId: state.eventId,
      event: state.event,
      onNavigate: switchTab,
    });
  } else if (state.tab === 'deliveries') {
    loadDeliveriesView();
  } else if (state.tab === 'counts') {
    loadCountsView();
  } else if (state.tab === 'kit') {
    ensureKit();
  }
}

function openEventGate() {
  document.documentElement.classList.toggle('event-gate-ready', state.ready);
  showEventGate({
    events: state.events,
    selectedId: state.eventId,
    dismissible: state.ready && !!state.eventId,
    onDismiss: () => {
      document.documentElement.classList.remove('event-gate-ready');
    },
    onSelect: async (id) => {
      await onEventChange(id);
      hideEventGate();
      document.documentElement.classList.remove('event-gate-ready');
      if (!state.ready) {
        state.ready = true;
        document.documentElement.classList.add('app-ready');
        switchTab(tabFromUrl());
        // Measure after the float-in starts so content clears the bar.
        requestAnimationFrame(() => {
          syncChromeSizes();
          window.setTimeout(syncChromeSizes, 560);
        });
      } else {
        updateEventPickerLabel();
        reloadTab();
        syncChromeSizes();
      }
    },
  });
  syncChromeSizes();
}

async function onEventChange(id) {
  state.eventId = id;
  try {
    id ? localStorage.setItem('v5_event', id) : localStorage.removeItem('v5_event');
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
  kitApi?.setPreferredEvent?.(state.eventId, state.event?.name || '');
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

  initCounts(getContext());
  initDeliveries(getContext());

  setSyncStatusListener(updateSyncBadge);
  bindOnlineFlush(flushAll);
  setupMeasuredPwaInstall();

  document.querySelectorAll('.navbtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!state.ready) {
        openEventGate();
        return;
      }
      switchTab(btn.dataset.tab);
    });
  });
  $('reloadBtn')?.addEventListener('click', () => {
    flushAll().then(() => {
      toast('Synced');
      if (state.ready) reloadTab();
    });
  });
  $('eventPickerBtn')?.addEventListener('click', () => {
    if (state.tab === 'kit') return;
    openEventGate();
  });

  try {
    state.caseSizes = await loadCaseSizes();
    state.events = await loadEventsList();
    const remembered = localStorage.getItem('v5_event') || localStorage.getItem('v2_event') || '';
    $('eventPick').innerHTML = '<option value="">Select an event…</option>' +
      state.events.map((e) => `<option value="${e.id}">${e.name}</option>`).join('');

    if (remembered && state.events.some((e) => e.id === remembered)) {
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
