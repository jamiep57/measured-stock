/**
 * Admin table filter — combined tabbed panel for distribution & future tables.
 */

import { $ } from '../lib/util.js';
import {
  mountCombinedTableFilterPanel,
  tableFilterIsActive,
} from '../components/table-filter-panel.js';
import {
  RECON_COLS,
  loadReconColVisibility,
  saveReconColVisibility,
} from '../lib/recon.js';

export const ADMIN_TABLE_FILTER = 'admin-table-filter';
export const ADMIN_DIST_CONTROLS = ADMIN_TABLE_FILTER;

const FIXED_COLUMNS = [
  { key: 'pack', label: 'Pack' },
  { key: 'opening', label: 'Opening' },
  { key: 'lta', label: 'Left to allocate' },
  { key: 'bone-yard', label: 'Bone Yard' },
];

const DEFAULT_DIST = {
  sort: 'category',
  categories: [],
  hiddenColumns: [],
};

let routeKey = '';
let panelApi = null;
let activeConfig = null;
let topbarApi = null;
let activeTab = 'filter';
let distState = { ...DEFAULT_DIST, hiddenColumns: [] };
let reconColVis = loadReconColVisibility();
let reconState = { categories: [], showHidden: false };
let categories = [];
let reconCategoryOptions = [];
let bars = [];

function fixedColumnKeys() {
  return FIXED_COLUMNS.map((c) => c.key);
}

function barColumnKeys() {
  return bars.map((b) => `bar:${b.id}`);
}

function visibleFixedColumns() {
  return fixedColumnKeys().filter((k) => !distState.hiddenColumns.includes(k));
}

function visibleBarColumns() {
  return barColumnKeys().filter((k) => !distState.hiddenColumns.includes(k));
}

function filterPanelValues() {
  return {
    categories: [...distState.categories],
    visibleFixedColumns: visibleFixedColumns(),
  };
}

function filterPanelDefaults() {
  return {
    categories: [],
    visibleFixedColumns: fixedColumnKeys(),
  };
}

function sortPanelValues() {
  return { sort: distState.sort };
}

function sortPanelDefaults() {
  return { sort: 'category' };
}

function barsPanelValues() {
  return { visibleBars: visibleBarColumns() };
}

function barsPanelDefaults() {
  return { visibleBars: barColumnKeys() };
}

export function getDistControls() {
  return {
    categories: [...distState.categories],
    sort: distState.sort,
    hiddenColumns: [...distState.hiddenColumns],
  };
}

export function getReconColVisibility() {
  return { ...reconColVis };
}

export function getReconControls() {
  return {
    colVis: getReconColVisibility(),
    categories: [...reconState.categories],
    showHidden: reconState.showHidden,
  };
}

function visibleReconColumns() {
  return RECON_COLS.filter((c) => reconColVis[c.id] !== false).map((c) => c.id);
}

function reconFilterPanelValues() {
  return {
    categories: [...reconState.categories],
    showHidden: reconState.showHidden ? 'hidden' : 'active',
  };
}

function reconFilterPanelDefaults() {
  return {
    categories: [],
    showHidden: 'active',
  };
}

function reconColumnsPanelValues() {
  return { visibleColumns: visibleReconColumns() };
}

function reconColumnsPanelDefaults() {
  return { visibleColumns: RECON_COLS.map((c) => c.id) };
}

function setReconColumnVisibility(visibleKeys) {
  const next = {};
  RECON_COLS.forEach((c) => {
    next[c.id] = visibleKeys.includes(c.id);
  });
  // Keep at least Product visible
  if (next.item === false) next.item = true;
  reconColVis = next;
  saveReconColVisibility(reconColVis);
}

function resetReconState() {
  reconState = { categories: [], showHidden: false };
  reconColVis = loadReconColVisibility();
}

function emitFilter() {
  const id = activeConfig?.id || null;
  let values = null;
  if (id === 'distribution') values = getDistControls();
  else if (id === 'recon') values = getReconControls();
  document.dispatchEvent(new CustomEvent(ADMIN_TABLE_FILTER, {
    detail: { panel: id, values },
  }));
}

function buildSortSections() {
  return [{
    id: 'sort',
    label: 'Order',
    type: 'radio',
    options: [
      { value: 'category', label: 'Category, then name' },
      { value: 'name', label: 'Product A–Z' },
      { value: 'name-desc', label: 'Product Z–A' },
      { value: 'lta-desc', label: 'Most left to allocate' },
      { value: 'lta-asc', label: 'Least left to allocate' },
    ],
  }];
}

function buildFilterSections() {
  const sections = [];

  if (categories.length) {
    sections.push({
      id: 'categories',
      label: 'Category',
      type: 'checkbox',
      showCount: true,
      scroll: true,
      options: categories.map((cat) => ({ value: cat, label: cat })),
    });
  }

  sections.push({
    id: 'visibleFixedColumns',
    label: 'Columns',
    type: 'checkbox',
    showCount: true,
    hideCountWhenFull: true,
    options: FIXED_COLUMNS.map((c) => ({ value: c.key, label: c.label })),
  });

  return sections;
}

function buildBarsSections() {
  return [{
    id: 'visibleBars',
    label: 'Show on grid',
    type: 'checkbox',
    showCount: true,
    hideCountWhenFull: true,
    scroll: true,
    options: bars.map((b) => ({
      value: `bar:${b.id}`,
      label: b.name || 'Bar',
    })),
  }];
}

function extractCategories(products) {
  const set = new Set();
  (products || []).forEach((item) => {
    const cat = item.product?.category?.name || item.category?.name;
    set.add(cat || 'Uncategorised');
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

function extractReconCategories(products) {
  const map = new Map();
  (products || []).forEach((item) => {
    const cat = item.product?.category || item.category;
    if (cat?.id) map.set(cat.id, cat.name || 'Uncategorised');
  });
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resetDistState() {
  distState = { ...DEFAULT_DIST, hiddenColumns: [] };
}

function setFixedColumnVisibility(visibleKeys) {
  const hiddenBars = distState.hiddenColumns.filter((k) => k.startsWith('bar:'));
  const hiddenFixed = fixedColumnKeys().filter((k) => !visibleKeys.includes(k));
  distState.hiddenColumns = [...hiddenFixed, ...hiddenBars];
}

function setBarColumnVisibility(visibleKeys) {
  const hiddenFixed = distState.hiddenColumns.filter((k) => !k.startsWith('bar:'));
  const hiddenBars = barColumnKeys().filter((k) => !visibleKeys.includes(k));
  distState.hiddenColumns = [...hiddenFixed, ...hiddenBars];
}

function applyFilterChange(sectionId, value) {
  if (sectionId === 'categories') distState.categories = value;
  else if (sectionId === 'visibleFixedColumns') setFixedColumnVisibility(value);
}

function buildReconFilterSections() {
  const sections = [];

  if (reconCategoryOptions.length) {
    sections.push({
      id: 'categories',
      label: 'Category',
      type: 'checkbox',
      showCount: true,
      scroll: true,
      options: reconCategoryOptions.map((c) => ({ value: c.id, label: c.name })),
    });
  }

  sections.push({
    id: 'showHidden',
    label: 'Products',
    type: 'radio',
    options: [
      { value: 'active', label: 'Included in recon' },
      { value: 'hidden', label: 'Excluded from recon' },
    ],
  });

  return sections;
}

function buildReconActiveItems() {
  const items = [];
  reconState.categories.forEach((id) => {
    const cat = reconCategoryOptions.find((c) => c.id === id);
    items.push({ id: `categories:${id}`, label: cat?.name || id });
  });
  if (reconState.showHidden) {
    items.push({ id: 'showHidden', label: 'Excluded from recon' });
  }
  RECON_COLS.forEach((c) => {
    if (reconColVis[c.id] === false) {
      items.push({ id: `visibleColumns:${c.id}`, label: c.label });
    }
  });
  return items;
}

function buildActiveItems() {
  if (activeConfig?.id === 'recon') return buildReconActiveItems();

  const items = [];

  distState.categories.forEach((cat) => {
    items.push({ id: `categories:${cat}`, label: cat });
  });

  fixedColumnKeys()
    .filter((k) => distState.hiddenColumns.includes(k))
    .forEach((key) => {
      const col = FIXED_COLUMNS.find((c) => c.key === key);
      items.push({ id: `visibleFixedColumns:${key}`, label: col?.label || key });
    });

  if (distState.sort !== DEFAULT_DIST.sort) {
    const opt = buildSortSections()[0].options.find((o) => o.value === distState.sort);
    items.push({ id: 'sort', label: opt?.label || distState.sort });
  }

  barColumnKeys()
    .filter((k) => distState.hiddenColumns.includes(k))
    .forEach((key) => {
      const bar = bars.find((b) => `bar:${b.id}` === key);
      items.push({ id: `visibleBars:${key}`, label: bar?.name || 'Bar' });
    });

  return items;
}

function syncPanelValues() {
  if (activeConfig?.id === 'recon') {
    panelApi?.updateTab('filter', reconFilterPanelValues());
    panelApi?.updateTab('columns', reconColumnsPanelValues());
    return;
  }
  panelApi?.updateTab('filter', filterPanelValues());
  panelApi?.updateTab('sort', sortPanelValues());
  if (bars.length) panelApi?.updateTab('bars', barsPanelValues());
}

function removeActiveItem(id) {
  if (activeConfig?.id === 'recon') {
    if (id.startsWith('categories:')) {
      const catId = id.slice('categories:'.length);
      reconState.categories = reconState.categories.filter((c) => c !== catId);
    } else if (id === 'showHidden') {
      reconState.showHidden = false;
    } else if (id.startsWith('visibleColumns:')) {
      const key = id.slice('visibleColumns:'.length);
      reconColVis = { ...reconColVis, [key]: true };
      saveReconColVisibility(reconColVis);
    } else {
      return;
    }
    syncPanelValues();
    updateTopbarButton();
    panelApi?.repaint();
    emitFilter();
    return;
  }

  if (id === 'sort') {
    distState.sort = DEFAULT_DIST.sort;
  } else if (id.startsWith('categories:')) {
    const cat = id.slice('categories:'.length);
    distState.categories = distState.categories.filter((c) => c !== cat);
  } else if (id.startsWith('visibleFixedColumns:')) {
    const key = id.slice('visibleFixedColumns:'.length);
    distState.hiddenColumns = distState.hiddenColumns.filter((k) => k !== key);
  } else if (id.startsWith('visibleBars:')) {
    const key = id.slice('visibleBars:'.length);
    distState.hiddenColumns = distState.hiddenColumns.filter((k) => k !== key);
  } else {
    return;
  }

  syncPanelValues();
  updateTopbarButton();
  panelApi?.repaint();
  emitFilter();
}

function buildReconTabs() {
  const tabs = [{
    id: 'filter',
    label: 'Filter',
    icon: 'funnel',
    sections: buildReconFilterSections(),
    values: reconFilterPanelValues(),
    onChange(sectionId, value) {
      if (sectionId === 'categories') reconState.categories = value;
      else if (sectionId === 'showHidden') reconState.showHidden = value === 'hidden';
      updateTopbarButton();
      panelApi.updateTab('filter', reconFilterPanelValues());
      emitFilter();
    },
    onReset() {
      reconState.categories = [];
      reconState.showHidden = false;
      panelApi.repaint();
      updateTopbarButton();
      emitFilter();
    },
  }, {
    id: 'columns',
    label: 'Columns',
    icon: 'columns',
    sections: [{
      id: 'visibleColumns',
      label: 'Visible columns',
      type: 'checkbox',
      showCount: true,
      hideCountWhenFull: true,
      scroll: true,
      options: RECON_COLS.map((c) => ({
        value: c.id,
        label: c.label,
        disabled: c.id === 'item',
      })),
    }],
    values: reconColumnsPanelValues(),
    onChange(_sectionId, value) {
      setReconColumnVisibility(value);
      updateTopbarButton();
      panelApi.updateTab('columns', reconColumnsPanelValues());
      emitFilter();
    },
    onReset() {
      setReconColumnVisibility(RECON_COLS.map((c) => c.id));
      panelApi.repaint();
      updateTopbarButton();
      emitFilter();
    },
  }];

  return tabs;
}

function buildTabs() {
  if (activeConfig?.id === 'recon') return buildReconTabs();

  const tabs = [{
    id: 'filter',
    label: 'Filter',
    icon: 'funnel',
    sections: buildFilterSections(),
    values: filterPanelValues(),
    onChange(sectionId, value) {
      applyFilterChange(sectionId, value);
      updateTopbarButton();
      panelApi.updateTab('filter', filterPanelValues());
      emitFilter();
    },
    onReset() {
      distState.categories = [];
      setFixedColumnVisibility(fixedColumnKeys());
      panelApi.repaint();
      updateTopbarButton();
      emitFilter();
    },
  }, {
    id: 'sort',
    label: 'Sort',
    icon: 'list-sort-descending',
    sections: buildSortSections(),
    values: sortPanelValues(),
    onChange(sectionId, value) {
      if (sectionId === 'sort') distState.sort = value;
      updateTopbarButton();
      panelApi.updateTab('sort', sortPanelValues());
      emitFilter();
    },
    onReset() {
      distState.sort = DEFAULT_DIST.sort;
      panelApi.repaint();
      updateTopbarButton();
      emitFilter();
    },
  }];

  if (bars.length) {
    tabs.push({
      id: 'bars',
      label: 'Bars',
      icon: 'columns',
      sections: buildBarsSections(),
      values: barsPanelValues(),
      onChange(_sectionId, value) {
        setBarColumnVisibility(value);
        updateTopbarButton();
        panelApi.updateTab('bars', barsPanelValues());
        emitFilter();
      },
      onReset() {
        setBarColumnVisibility(barColumnKeys());
        panelApi.repaint();
        updateTopbarButton();
        emitFilter();
      },
    });
  }

  return tabs;
}

function isPanelActive() {
  if (activeConfig?.id === 'recon') {
    const filterActive = tableFilterIsActive(
      reconFilterPanelValues(),
      reconFilterPanelDefaults(),
      buildReconFilterSections(),
    );
    const columnsActive = tableFilterIsActive(
      reconColumnsPanelValues(),
      reconColumnsPanelDefaults(),
      [{
        id: 'visibleColumns',
        type: 'checkbox',
        options: RECON_COLS.map((c) => ({ value: c.id })),
      }],
    );
    return Boolean(filterActive || columnsActive);
  }
  const filterActive = tableFilterIsActive(
    filterPanelValues(),
    filterPanelDefaults(),
    buildFilterSections(),
  );
  const sortActive = tableFilterIsActive(
    sortPanelValues(),
    sortPanelDefaults(),
    buildSortSections(),
  );
  const barsActive = distState.hiddenColumns.some((k) => k.startsWith('bar:'));
  return filterActive || sortActive || barsActive;
}

function updateTopbarButton() {
  $('topbarTableFilterBtn')?.classList.toggle('topbar-tool--active', isPanelActive());
}

function remountPanel(container) {
  if (activeConfig?.id === 'recon') {
    const allowed = new Set(buildReconTabs().map((t) => t.id));
    if (!activeTab || !allowed.has(activeTab)) activeTab = defaultTabForPanel();
  } else if (!activeTab || (activeTab === 'bars' && !bars.length) || activeTab === 'columns') {
    activeTab = 'filter';
  }

  panelApi = mountCombinedTableFilterPanel(container, {
    tabs: buildTabs(),
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

function defaultTabForPanel() {
  return 'filter';
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
  // Panel open — always show primary tab; never close (outside click closes).
  focusFilterTab();
}

export function initTableFilterTopbar() {
  if (topbarApi) return topbarApi;

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
      let nextKey = '';
      let panelId = null;
      if (route.view === 'event' && route.panel === 'distribution') {
        nextKey = `dist:${route.eventId}`;
        panelId = 'distribution';
      } else if (route.view === 'event' && route.panel === 'recon') {
        nextKey = `recon:${route.eventId}`;
        panelId = 'recon';
      }
      const show = Boolean(nextKey);

      if (!show) {
        closePanel();
        activeConfig = null;
        panelApi = null;
        return;
      }

      activeConfig = { id: panelId };

      const routeChanged = nextKey !== routeKey;
      if (routeChanged) {
        routeKey = nextKey;
        if (panelId === 'distribution') resetDistState();
        if (panelId === 'recon') resetReconState();
      }

      if (panelId === 'recon') {
        reconCategoryOptions = extractReconCategories(context.products);
        reconState.categories = reconState.categories.filter((id) =>
          reconCategoryOptions.some((c) => c.id === id));
        categories = [];
      } else {
        categories = extractCategories(context.products);
        reconCategoryOptions = [];
      }
      bars = context.bars || [];
      if (routeChanged) activeTab = defaultTabForPanel();
      updateTopbarButton();
      emitFilter();

      if (!dropdown.hidden) remountPanel(dropdown);
    },

    reset() {
      if (activeConfig?.id === 'recon') resetReconState();
      else resetDistState();
      activeTab = defaultTabForPanel();
      updateTopbarButton();
      emitFilter();
    },
  };

  return topbarApi;
}

/** @deprecated */
export function initTopbarControls() {
  return initTableFilterTopbar();
}

export function registerTableFilterConfig(config) {
  activeConfig = config;
}
