/**
 * Admin table filter — registry-driven topbar Filter / Sort / Columns panel.
 */

import { $ } from '../lib/util.js';
import {
  mountCombinedTableFilterPanel,
} from '../components/table-filter-panel.js';
import { ALL_FILTER_CONFIGS } from './filter-configs.js';

export const ADMIN_TABLE_FILTER = 'admin-table-filter';
export const ADMIN_DIST_CONTROLS = ADMIN_TABLE_FILTER;

const configs = new Map();
const stateByKey = new Map();

let routeKey = '';
let panelApi = null;
let activeConfig = null;
let liveContext = {};
let topbarApi = null;
let activeTab = 'filter';
let registered = false;

function ensureRegistered() {
  if (registered) return;
  registered = true;
  ALL_FILTER_CONFIGS.forEach((cfg) => registerTableFilterConfig(cfg));
}

export function registerTableFilterConfig(config) {
  if (!config?.id || typeof config.match !== 'function') {
    console.warn('Invalid table filter config', config);
    return;
  }
  configs.set(config.id, config);
}

export function getTableFilterConfig(route) {
  ensureRegistered();
  for (const cfg of configs.values()) {
    if (cfg.match(route)) return cfg;
  }
  return null;
}

export function hasTableFilter(route) {
  return Boolean(getTableFilterConfig(route));
}

function getOrCreateState(config, key) {
  if (stateByKey.has(key)) return stateByKey.get(key);
  const state = config.createState
    ? config.createState()
    : { ...(config.defaults?.() || {}) };
  stateByKey.set(key, state);
  return state;
}

function controllerApi(config) {
  return {
    getState() {
      return stateByKey.get(routeKey) || config.defaults?.() || {};
    },
    setState(next) {
      stateByKey.set(routeKey, next);
      config.onStateChange?.(next);
    },
    getContext() {
      return liveContext;
    },
    getActiveTab() {
      return activeTab;
    },
    emit() {
      emitFilter();
    },
    remount() {
      const dropdown = $('topbarTableFilterPanel');
      if (dropdown && !dropdown.hidden) remountPanel(dropdown);
    },
    /** Update active-dot + emit without destroying focused inputs. */
    touch() {
      updateTopbarButton();
      emitFilter();
    },
    syncUi() {
      updateTopbarButton();
      const dropdown = $('topbarTableFilterPanel');
      if (dropdown && !dropdown.hidden) remountPanel(dropdown);
      else panelApi?.repaint?.();
    },
  };
}

function emitFilter() {
  const config = activeConfig;
  if (!config) {
    document.dispatchEvent(new CustomEvent(ADMIN_TABLE_FILTER, {
      detail: { panel: null, values: null },
    }));
    return;
  }
  const api = controllerApi(config);
  const values = config.toValues
    ? config.toValues(api.getState(), liveContext)
    : { ...api.getState() };
  document.dispatchEvent(new CustomEvent(ADMIN_TABLE_FILTER, {
    detail: { panel: config.id, values },
  }));
}

function buildTabs() {
  if (!activeConfig) return [];
  return activeConfig.buildTabs(controllerApi(activeConfig)) || [];
}

function buildActiveItems() {
  if (!activeConfig?.buildActiveItems) return [];
  return activeConfig.buildActiveItems(controllerApi(activeConfig)) || [];
}

function removeActiveItem(id) {
  if (!activeConfig?.removeActiveItem) return;
  const ok = activeConfig.removeActiveItem(controllerApi(activeConfig), id);
  if (ok === false) return;
  updateTopbarButton();
  const dropdown = $('topbarTableFilterPanel');
  if (dropdown && !dropdown.hidden) remountPanel(dropdown);
  emitFilter();
}

function isPanelActive() {
  if (!activeConfig) return false;
  if (activeConfig.isActive) return Boolean(activeConfig.isActive(controllerApi(activeConfig)));
  return false;
}

function updateTopbarButton() {
  $('topbarTableFilterBtn')?.classList.toggle('topbar-tool--active', isPanelActive());
}

function defaultTabForPanel() {
  const tabs = buildTabs();
  return tabs[0]?.id || 'filter';
}

function remountPanel(container) {
  const tabs = buildTabs();
  const allowed = new Set(tabs.map((t) => t.id));
  if (!activeTab || !allowed.has(activeTab)) activeTab = defaultTabForPanel();

  panelApi = mountCombinedTableFilterPanel(container, {
    tabs,
    activeTab,
    onTabChange(id) {
      activeTab = id;
    },
    getActiveItems: buildActiveItems,
    onRemoveActiveItem: removeActiveItem,
  });
}

function closePanel() {
  const dropdown = $('topbarTableFilterPanel');
  const btn = $('topbarTableFilterBtn');
  if (dropdown) dropdown.hidden = true;
  btn?.setAttribute('aria-expanded', 'false');
}

function openPanel() {
  const dropdown = $('topbarTableFilterPanel');
  const btn = $('topbarTableFilterBtn');
  if (!dropdown || !activeConfig) return;
  dropdown.hidden = false;
  btn?.setAttribute('aria-expanded', 'true');
  remountPanel(dropdown);
}

function clickIsInsideTopbarFilter(e, btn, dropdown) {
  return e.composedPath().some((el) => el === btn || el === dropdown
    || (el instanceof Element && (
      el.classList?.contains('topbar-tool-wrap')
      || el.id === 'topbarFilterStrip'
    )));
}

function focusFilterTab() {
  const dropdown = $('topbarTableFilterPanel');
  if (!dropdown || dropdown.hidden) return;
  activeTab = defaultTabForPanel();
  panelApi?.setActiveTab(activeTab);
}

function onFilterButtonClick(e) {
  e.stopPropagation();
  const dropdown = $('topbarTableFilterPanel');
  if (!dropdown) return;
  if (dropdown.hidden) {
    activeTab = defaultTabForPanel();
    openPanel();
    return;
  }
  focusFilterTab();
}

/** Push dynamic options from a mounted panel (groups, warehouses, recipients…). */
export function setTableFilterContext(panelId, patch = {}) {
  if (!activeConfig || activeConfig.id !== panelId) return;
  liveContext = {
    ...liveContext,
    ...patch,
    filterContext: { ...(liveContext.filterContext || {}), ...patch },
  };
  if (activeConfig.pruneState) {
    const state = stateByKey.get(routeKey);
    if (state) stateByKey.set(routeKey, activeConfig.pruneState(state, liveContext));
  }
  updateTopbarButton();
  const dropdown = $('topbarTableFilterPanel');
  if (dropdown && !dropdown.hidden) remountPanel(dropdown);
}

/** Imperatively patch filter state (e.g. column-header sort sync). */
export function patchTableFilterState(panelId, patch) {
  if (!activeConfig || activeConfig.id !== panelId) return;
  const cur = stateByKey.get(routeKey) || activeConfig.defaults?.() || {};
  const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
  stateByKey.set(routeKey, next);
  activeConfig.onStateChange?.(next);
  updateTopbarButton();
  const dropdown = $('topbarTableFilterPanel');
  if (dropdown && !dropdown.hidden) remountPanel(dropdown);
  emitFilter();
}

export function getTableFilterValues(panelId) {
  const config = configs.get(panelId) || (activeConfig?.id === panelId ? activeConfig : null);
  if (!config) return null;
  const key = routeKey;
  const state = (activeConfig?.id === panelId && stateByKey.has(key))
    ? stateByKey.get(key)
    : null;
  if (!state) return config.toValues?.(config.defaults?.() || {}, {}) ?? config.defaults?.() ?? null;
  return config.toValues?.(state, liveContext) ?? state;
}

export function getDistControls() {
  return getTableFilterValues('distribution') || {
    categories: [],
    sort: 'category',
    hiddenColumns: [],
  };
}

export function getReconControls() {
  return getTableFilterValues('recon') || {
    statusFilter: '',
    categories: [],
    showHidden: false,
    sort: 'category',
    colVis: {},
  };
}

export function getReconColVisibility() {
  const values = getReconControls();
  return { ...(values.colVis || {}) };
}

export function initTableFilterTopbar() {
  if (topbarApi) return topbarApi;
  ensureRegistered();

  const btn = $('topbarTableFilterBtn');
  const dropdown = $('topbarTableFilterPanel');
  if (!btn || !dropdown) return { syncRoute: () => {} };

  btn.addEventListener('click', onFilterButtonClick);

  document.addEventListener('click', (e) => {
    if (dropdown.hidden) return;
    if (clickIsInsideTopbarFilter(e, btn, dropdown)) return;
    closePanel();
  });

  topbarApi = {
    syncRoute(route, context = {}) {
      ensureRegistered();
      const config = getTableFilterConfig(route);
      if (!config) {
        closePanel();
        activeConfig = null;
        panelApi = null;
        routeKey = '';
        liveContext = {};
        return;
      }

      const nextKey = config.routeKey(route);
      const routeChanged = nextKey !== routeKey;
      activeConfig = config;
      routeKey = nextKey;

      let state = getOrCreateState(config, nextKey);
      liveContext = config.getContext
        ? config.getContext(route, context)
        : { products: context.products || [], bars: context.bars || [] };

      if (config.pruneState) {
        state = config.pruneState(state, liveContext);
        stateByKey.set(nextKey, state);
      }

      if (routeChanged) activeTab = defaultTabForPanel();
      updateTopbarButton();
      emitFilter();

      if (!dropdown.hidden) remountPanel(dropdown);
    },

    reset() {
      if (!activeConfig) return;
      const fresh = activeConfig.createState
        ? activeConfig.createState()
        : { ...(activeConfig.defaults?.() || {}) };
      stateByKey.set(routeKey, fresh);
      activeTab = defaultTabForPanel();
      updateTopbarButton();
      emitFilter();
      const dropdownEl = $('topbarTableFilterPanel');
      if (dropdownEl && !dropdownEl.hidden) remountPanel(dropdownEl);
    },
  };

  return topbarApi;
}

/** @deprecated */
export function initTopbarControls() {
  return initTableFilterTopbar();
}
