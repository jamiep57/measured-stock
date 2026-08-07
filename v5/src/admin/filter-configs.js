/**
 * Declarative table-filter configs for all data pages.
 */

import {
  RECON_COLS,
  loadReconColVisibility,
  saveReconColVisibility,
} from '../lib/recon.js';
import {
  extractCategoryNames,
  extractCategoryIdOptions,
  extractSupplierOptions,
  loadPersisted,
  savePersisted,
  buildStandardActiveItems,
  removeStandardActiveItem,
  tabValuesFromState,
  applySectionChange,
  resetSections,
} from './filter-helpers.js';

const FIXED_COLUMNS = [
  { key: 'pack', label: 'Pack' },
  { key: 'opening', label: 'Opening' },
  { key: 'lta', label: 'Left to allocate' },
  { key: 'bone-yard', label: 'Bone Yard' },
];

function eventMatch(panel) {
  return (route) => route.view === 'event' && route.panel === panel;
}

function viewMatch(view) {
  return (route) => route.view === view;
}

function distDefaults() {
  return { sort: 'category', categories: [], hiddenColumns: [] };
}

function reconDefaults() {
  const colVis = loadReconColVisibility();
  return {
    status: '',
    categories: [],
    showHidden: false,
    sort: 'category',
    colVis: { ...colVis },
  };
}

function visibleFixed(state) {
  return FIXED_COLUMNS.map((c) => c.key).filter((k) => !state.hiddenColumns.includes(k));
}

function barKeys(bars) {
  return (bars || []).map((b) => `bar:${b.id}`);
}

function visibleBars(state, bars) {
  return barKeys(bars).filter((k) => !state.hiddenColumns.includes(k));
}

function setFixedVisible(state, visibleKeys) {
  const hiddenBars = state.hiddenColumns.filter((k) => k.startsWith('bar:'));
  const hiddenFixed = FIXED_COLUMNS.map((c) => c.key).filter((k) => !visibleKeys.includes(k));
  return { ...state, hiddenColumns: [...hiddenFixed, ...hiddenBars] };
}

function setBarsVisible(state, visibleKeys, bars) {
  const hiddenFixed = state.hiddenColumns.filter((k) => !k.startsWith('bar:'));
  const hiddenBars = barKeys(bars).filter((k) => !visibleKeys.includes(k));
  return { ...state, hiddenColumns: [...hiddenFixed, ...hiddenBars] };
}

function visibleReconCols(colVis) {
  return RECON_COLS.filter((c) => colVis[c.id] !== false).map((c) => c.id);
}

function setReconCols(visibleKeys) {
  const next = {};
  RECON_COLS.forEach((c) => { next[c.id] = visibleKeys.includes(c.id); });
  if (next.item === false) next.item = true;
  saveReconColVisibility(next);
  return next;
}

function makeControllerHelpers(api) {
  return {
    patch(updater) {
      api.setState(typeof updater === 'function' ? updater(api.getState()) : { ...api.getState(), ...updater });
    },
    emit() { api.emit(); },
    remount() { api.remount(); },
  };
}

export const distributionConfig = {
  id: 'distribution',
  match: eventMatch('distribution'),
  routeKey: (route) => `dist:${route.eventId}`,
  defaults: distDefaults,
  createState: distDefaults,
  getContext(_route, ctx) {
    return {
      categories: extractCategoryNames(ctx.products),
      bars: ctx.bars || [],
    };
  },
  pruneState(state, context) {
    const cats = new Set(context.categories || []);
    return {
      ...state,
      categories: (state.categories || []).filter((c) => cats.has(c)),
    };
  },
  toValues(state) {
    return {
      categories: [...state.categories],
      sort: state.sort,
      hiddenColumns: [...state.hiddenColumns],
    };
  },
  buildTabs(api) {
    const state = api.getState();
    const context = api.getContext();
    const defaults = distDefaults();
    const h = makeControllerHelpers(api);
    const filterSections = [];
    if (context.categories?.length) {
      filterSections.push({
        id: 'categories',
        label: 'Category',
        type: 'searchable-checkbox',
        showCount: true,
        scroll: true,
        options: context.categories.map((cat) => ({ value: cat, label: cat })),
      });
    }
    filterSections.push({
      id: 'visibleFixedColumns',
      label: 'Columns',
      type: 'checkbox',
      showCount: true,
      hideCountWhenFull: true,
      options: FIXED_COLUMNS.map((c) => ({ value: c.key, label: c.label })),
    });

    const sortSections = [{
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

    const tabs = [{
      id: 'filter',
      label: 'Filter',
      icon: 'funnel',
      sections: filterSections,
      values: {
        categories: [...state.categories],
        visibleFixedColumns: visibleFixed(state),
      },
      onChange(sectionId, value) {
        if (sectionId === 'categories') h.patch({ categories: value });
        else if (sectionId === 'visibleFixedColumns') h.patch((s) => setFixedVisible(s, value));
        else h.patch(applySectionChange(api.getState(), sectionId, value));
        api.syncUi();
        h.emit();
      },
      onReset() {
        h.patch((s) => setFixedVisible({ ...s, categories: [] }, FIXED_COLUMNS.map((c) => c.key)));
        api.syncUi();
        h.emit();
      },
    }, {
      id: 'sort',
      label: 'Sort',
      icon: 'list-sort-descending',
      sections: sortSections,
      values: { sort: state.sort },
      onChange(sectionId, value) {
        h.patch({ [sectionId]: value });
        api.syncUi();
        h.emit();
      },
      onReset() {
        h.patch({ sort: defaults.sort });
        api.syncUi();
        h.emit();
      },
    }];

    if (context.bars?.length) {
      tabs.push({
        id: 'bars',
        label: 'Bars',
        icon: 'columns',
        sections: [{
          id: 'visibleBars',
          label: 'Show on grid',
          type: 'searchable-checkbox',
          showCount: true,
          hideCountWhenFull: true,
          scroll: true,
          options: context.bars.map((b) => ({
            value: `bar:${b.id}`,
            label: b.name || 'Bar',
          })),
        }],
        values: { visibleBars: visibleBars(state, context.bars) },
        onChange(_sectionId, value) {
          h.patch((s) => setBarsVisible(s, value, context.bars));
          api.syncUi();
          h.emit();
        },
        onReset() {
          h.patch((s) => setBarsVisible(s, barKeys(context.bars), context.bars));
          api.syncUi();
          h.emit();
        },
      });
    }
    return tabs;
  },
  buildActiveItems(api) {
    const state = api.getState();
    const context = api.getContext();
    const activeTab = api.getActiveTab();
    const defaults = distDefaults();
    const items = [];
    if (activeTab !== 'filter') {
      state.categories.forEach((cat) => items.push({ id: `categories:${cat}`, label: cat }));
      FIXED_COLUMNS.filter((c) => state.hiddenColumns.includes(c.key))
        .forEach((c) => items.push({ id: `visibleFixedColumns:${c.key}`, label: c.label }));
    }
    if (activeTab !== 'sort' && state.sort !== defaults.sort) {
      const labels = {
        category: 'Category, then name',
        name: 'Product A–Z',
        'name-desc': 'Product Z–A',
        'lta-desc': 'Most left to allocate',
        'lta-asc': 'Least left to allocate',
      };
      items.push({ id: 'sort', label: labels[state.sort] || state.sort });
    }
    if (activeTab !== 'bars') {
      barKeys(context.bars)
        .filter((k) => state.hiddenColumns.includes(k))
        .forEach((key) => {
          const bar = context.bars.find((b) => `bar:${b.id}` === key);
          items.push({ id: `visibleBars:${key}`, label: bar?.name || 'Bar' });
        });
    }
    return items;
  },
  removeActiveItem(api, id) {
    const state = api.getState();
    const context = api.getContext();
    const defaults = distDefaults();
    if (id === 'sort') {
      api.setState({ ...state, sort: defaults.sort });
    } else if (id.startsWith('categories:')) {
      const cat = id.slice('categories:'.length);
      api.setState({ ...state, categories: state.categories.filter((c) => c !== cat) });
    } else if (id.startsWith('visibleFixedColumns:')) {
      const key = id.slice('visibleFixedColumns:'.length);
      api.setState({ ...state, hiddenColumns: state.hiddenColumns.filter((k) => k !== key) });
    } else if (id.startsWith('visibleBars:')) {
      const key = id.slice('visibleBars:'.length);
      api.setState({ ...state, hiddenColumns: state.hiddenColumns.filter((k) => k !== key) });
    } else {
      return false;
    }
    return true;
  },
  isActive(api) {
    const state = api.getState();
    const defaults = distDefaults();
    return state.categories.length > 0
      || state.sort !== defaults.sort
      || state.hiddenColumns.length > 0;
  },
};

export const reconConfig = {
  id: 'recon',
  match: eventMatch('recon'),
  routeKey: (route) => `recon:${route.eventId}`,
  defaults: () => {
    const d = reconDefaults();
    return {
      status: d.status,
      categories: [],
      showHidden: false,
      sort: d.sort,
    };
  },
  createState() {
    return reconDefaults();
  },
  getContext(_route, ctx) {
    return {
      categories: extractCategoryIdOptions(ctx.products),
    };
  },
  pruneState(state, context) {
    const ids = new Set((context.categories || []).map((c) => c.value));
    return {
      ...state,
      categories: (state.categories || []).filter((id) => ids.has(id)),
      colVis: state.colVis || loadReconColVisibility(),
    };
  },
  toValues(state) {
    return {
      statusFilter: state.status || '',
      categories: [...state.categories],
      showHidden: Boolean(state.showHidden),
      sort: state.sort || 'category',
      colVis: { ...(state.colVis || loadReconColVisibility()) },
    };
  },
  buildTabs(api) {
    const state = api.getState();
    const context = api.getContext();
    const h = makeControllerHelpers(api);
    const filterSections = [{
      id: 'status',
      label: 'Status',
      type: 'segment',
      options: [
        { value: '', label: 'All' },
        { value: 'red', label: 'Action', dot: 'red' },
        { value: 'yellow', label: 'Review', dot: 'yellow' },
        { value: 'green', label: 'Done', dot: 'green' },
        { value: 'blue', label: 'None returned', dot: 'blue' },
        { value: 'none', label: 'Unmarked' },
      ],
    }];
    if (context.categories?.length) {
      filterSections.push({
        id: 'categories',
        label: 'Category',
        type: 'searchable-checkbox',
        showCount: true,
        scroll: true,
        options: context.categories,
      });
    }
    filterSections.push({
      id: 'showHidden',
      label: 'Products',
      type: 'radio',
      options: [
        { value: 'active', label: 'Included in recon' },
        { value: 'hidden', label: 'Excluded from recon' },
      ],
    });

    return [{
      id: 'filter',
      label: 'Filter',
      icon: 'funnel',
      sections: filterSections,
      values: {
        status: state.status || '',
        categories: [...state.categories],
        showHidden: state.showHidden ? 'hidden' : 'active',
      },
      onChange(sectionId, value) {
        if (sectionId === 'showHidden') h.patch({ showHidden: value === 'hidden' });
        else h.patch({ [sectionId]: value });
        api.syncUi();
        h.emit();
      },
      onReset() {
        h.patch({ status: '', categories: [], showHidden: false });
        api.syncUi();
        h.emit();
      },
    }, {
      id: 'sort',
      label: 'Sort',
      icon: 'list-sort-descending',
      sections: [{
        id: 'sort',
        label: 'Order',
        type: 'radio',
        options: [
          { value: 'category', label: 'Category, then name' },
          { value: 'name', label: 'Product A–Z' },
          { value: 'name-desc', label: 'Product Z–A' },
        ],
      }],
      values: { sort: state.sort || 'category' },
      onChange(_id, value) {
        h.patch({ sort: value });
        api.syncUi();
        h.emit();
      },
      onReset() {
        h.patch({ sort: 'category' });
        api.syncUi();
        h.emit();
      },
    }, {
      id: 'columns',
      label: 'Columns',
      icon: 'columns',
      sections: [{
        id: 'visibleColumns',
        label: 'Visible columns',
        type: 'searchable-checkbox',
        showCount: true,
        hideCountWhenFull: true,
        scroll: true,
        options: RECON_COLS.map((c) => ({
          value: c.id,
          label: c.label,
          disabled: c.id === 'item',
        })),
      }],
      values: { visibleColumns: visibleReconCols(state.colVis || {}) },
      onChange(_id, value) {
        h.patch({ colVis: setReconCols(value) });
        api.syncUi();
        h.emit();
      },
      onReset() {
        h.patch({ colVis: setReconCols(RECON_COLS.map((c) => c.id)) });
        api.syncUi();
        h.emit();
      },
    }];
  },
  buildActiveItems(api) {
    const state = api.getState();
    const context = api.getContext();
    const activeTab = api.getActiveTab();
    const items = [];
    if (activeTab !== 'filter') {
      if (state.status) {
        const labels = {
          red: 'Action', yellow: 'Review', green: 'Done', blue: 'None returned', none: 'Unmarked',
        };
        items.push({ id: 'status', label: labels[state.status] || state.status });
      }
      state.categories.forEach((id) => {
        const cat = context.categories?.find((c) => c.value === id);
        items.push({ id: `categories:${id}`, label: cat?.label || id });
      });
      if (state.showHidden) items.push({ id: 'showHidden', label: 'Excluded from recon' });
    }
    if (activeTab !== 'sort' && state.sort && state.sort !== 'category') {
      items.push({
        id: 'sort',
        label: state.sort === 'name-desc' ? 'Product Z–A' : 'Product A–Z',
      });
    }
    if (activeTab !== 'columns') {
      RECON_COLS.forEach((c) => {
        if (state.colVis?.[c.id] === false) {
          items.push({ id: `visibleColumns:${c.id}`, label: c.label });
        }
      });
    }
    return items;
  },
  removeActiveItem(api, id) {
    const state = api.getState();
    if (id === 'status') api.setState({ ...state, status: '' });
    else if (id === 'showHidden') api.setState({ ...state, showHidden: false });
    else if (id === 'sort') api.setState({ ...state, sort: 'category' });
    else if (id.startsWith('categories:')) {
      const catId = id.slice('categories:'.length);
      api.setState({ ...state, categories: state.categories.filter((c) => c !== catId) });
    } else if (id.startsWith('visibleColumns:')) {
      const key = id.slice('visibleColumns:'.length);
      const colVis = { ...state.colVis, [key]: true };
      saveReconColVisibility(colVis);
      api.setState({ ...state, colVis });
    } else return false;
    return true;
  },
  isActive(api) {
    const state = api.getState();
    const hiddenCols = RECON_COLS.some((c) => state.colVis?.[c.id] === false);
    return Boolean(state.status)
      || state.categories.length > 0
      || state.showHidden
      || (state.sort && state.sort !== 'category')
      || hiddenCols;
  },
};

function simpleEventConfig({
  id, defaults, persist, buildFilterSections, sortOptions, toValues,
}) {
  return {
    id,
    match: eventMatch(id),
    routeKey: (route) => `${id}:${route.eventId}`,
    defaults,
    persist,
    createState() {
      return loadPersisted(persist?.storageKey, defaults(), persist?.keys || []);
    },
    getContext(_route, ctx) {
      return {
        categories: extractCategoryNames(ctx.products),
        categoryOptions: extractCategoryIdOptions(ctx.products),
        suppliers: extractSupplierOptions(ctx.products),
        warehouses: ctx.warehouses || [],
        groups: ctx.groups || extractCategoryNames(ctx.products),
        extra: ctx.extra || {},
        ...ctx.filterContext,
      };
    },
    pruneState(state, context) {
      const next = { ...state };
      if (Array.isArray(state.categories) && context.categories) {
        const set = new Set(context.categories);
        next.categories = state.categories.filter((c) => set.has(c));
      }
      if (state.category && context.categories && state.category && !context.categories.includes(state.category)) {
        next.category = '';
      }
      if (state.supplierId && context.suppliers) {
        if (!context.suppliers.some((s) => s.value === state.supplierId)) next.supplierId = '';
      }
      return next;
    },
    toValues: toValues || ((state) => ({ ...state })),
    onStateChange(state) {
      if (persist?.storageKey) savePersisted(persist.storageKey, state, persist.keys || []);
    },
    buildTabs(api) {
      const state = api.getState();
      const context = api.getContext();
      const def = defaults();
      const h = makeControllerHelpers(api);
      const filterSections = buildFilterSections(state, context) || [];
      const sectionType = Object.fromEntries(filterSections.map((s) => [s.id, s.type]));
      const softTypes = new Set(['text', 'date-range']);
      const tabs = [];
      if (filterSections.length) {
        const ids = filterSections.map((s) => s.id);
        tabs.push({
          id: 'filter',
          label: 'Filter',
          icon: 'funnel',
          sections: filterSections,
          values: tabValuesFromState(state, ids),
          onChange(sectionId, value) {
            h.patch(applySectionChange(api.getState(), sectionId, value));
            if (softTypes.has(sectionType[sectionId])) {
              api.touch();
              return;
            }
            api.syncUi();
            h.emit();
          },
          onReset() {
            h.patch((s) => resetSections(s, def, ids));
            api.syncUi();
            h.emit();
          },
        });
      }
      if (sortOptions?.length) {
        tabs.push({
          id: 'sort',
          label: 'Sort',
          icon: 'list-sort-descending',
          sections: [{
            id: 'sort',
            label: 'Order',
            type: 'radio',
            options: sortOptions,
          }],
          values: { sort: state.sort },
          onChange(_id, value) {
            h.patch({ sort: value });
            api.syncUi();
            h.emit();
          },
          onReset() {
            h.patch({ sort: def.sort });
            api.syncUi();
            h.emit();
          },
        });
      }
      return tabs;
    },
    buildActiveItems(api) {
      const state = api.getState();
      const context = api.getContext();
      const def = defaults();
      const filterSections = buildFilterSections(state, context) || [];
      const sectionsByTab = { filter: filterSections };
      if (sortOptions?.length) {
        sectionsByTab.sort = [{
          id: 'sort',
          type: 'radio',
          options: sortOptions,
        }];
      }
      return buildStandardActiveItems({
        state,
        defaults: def,
        activeTab: api.getActiveTab(),
        sectionsByTab,
      });
    },
    removeActiveItem(api, id) {
      const def = defaults();
      api.setState(removeStandardActiveItem(api.getState(), def, id));
      return true;
    },
    isActive(api) {
      const state = api.getState();
      const def = defaults();
      return JSON.stringify(pickComparable(state, def)) !== JSON.stringify(pickComparable(def, def));
    },
  };
}

function pickComparable(state, defaults) {
  const out = {};
  Object.keys(defaults).forEach((k) => { out[k] = state[k]; });
  return out;
}

export const closingConfig = simpleEventConfig({
  id: 'closing',
  defaults: () => ({
    status: '',
    category: '',
    supplierId: '',
    sort: 'name',
  }),
  persist: { keys: ['sort'], storageKey: 'v5ClosingTableFilter' },
  buildFilterSections(_state, context) {
    const sections = [{
      id: 'status',
      label: 'Status',
      type: 'segment',
      options: [
        { value: '', label: 'All' },
        { value: 'uncounted', label: 'Uncounted' },
        { value: 'counted', label: 'Counted' },
        { value: 'returning', label: 'Returning' },
        { value: 'carried', label: 'Carried over' },
        { value: 'over_sor', label: 'Over SOR' },
      ],
    }];
    if (context.categories?.length) {
      sections.push({
        id: 'category',
        label: 'Category',
        type: 'radio',
        scroll: true,
        options: [
          { value: '', label: 'All categories' },
          ...context.categories.map((c) => ({ value: c, label: c })),
        ],
      });
    }
    if (context.suppliers?.length) {
      sections.push({
        id: 'supplierId',
        label: 'Supplier',
        type: 'searchable-checkbox',
        showCount: true,
        scroll: true,
        // single-select via checkbox list is awkward — use radio list scrollable
        // Override: use radio with searchable feel via searchable-checkbox of one?
        // Plan: searchable multi for multi; for single use radio in scroll
      });
      // Replace last with radio scroll
      sections.pop();
      sections.push({
        id: 'supplierId',
        label: 'Supplier',
        type: 'radio',
        scroll: true,
        options: [
          { value: '', label: 'All suppliers' },
          ...context.suppliers,
        ],
      });
    }
    return sections;
  },
  sortOptions: [
    { value: 'name', label: 'Name A–Z' },
    { value: 'invoice', label: 'Invoice ↓' },
    { value: 'closing', label: 'Closing ↓' },
    { value: 'return', label: 'Return ↓' },
    { value: 'carried', label: 'Carried ↓' },
    { value: 'sor', label: 'SOR % ↓' },
  ],
  toValues(state) {
    return {
      statusFilter: state.status || '',
      categoryFilter: state.category || '',
      supplierFilter: state.supplierId || '',
      sortKey: state.sort || 'name',
    };
  },
});

export const salesConfig = simpleEventConfig({
  id: 'sales',
  defaults: () => ({
    mapFilter: '',
    category: '',
    sort: 'name',
  }),
  persist: { keys: ['sort'], storageKey: 'v5SalesTableFilter' },
  buildFilterSections(_state, context) {
    const groups = context.groups || context.categories || [];
    const sections = [{
      id: 'mapFilter',
      label: 'Mapping',
      type: 'segment',
      options: [
        { value: '', label: 'All' },
        { value: 'unmapped', label: 'Need mapping' },
        { value: 'mapped', label: 'Mapped' },
        { value: 'warn', label: 'Stock warn' },
      ],
    }];
    if (groups.length) {
      sections.push({
        id: 'category',
        label: context.groupLabel || 'Category',
        type: 'radio',
        scroll: true,
        options: [
          { value: '', label: `All ${context.groupLabel || 'categories'}` },
          ...groups.map((g) => ({ value: g, label: g })),
        ],
      });
    }
    return sections;
  },
  sortOptions: [
    { value: 'name', label: 'Name A–Z' },
    { value: 'qty', label: 'Qty sold ↓' },
    { value: 'status', label: 'Need mapping first' },
  ],
  toValues(state) {
    return {
      mapFilter: state.mapFilter || '',
      categoryFilter: state.category || '',
      sortKey: state.sort || 'name',
    };
  },
});

export const productsConfig = simpleEventConfig({
  id: 'products',
  defaults: () => ({ categories: [], sort: 'category' }),
  persist: { keys: ['sort'], storageKey: 'v5ProductsTableFilter' },
  buildFilterSections(_state, context) {
    if (!context.categories?.length) return [];
    return [{
      id: 'categories',
      label: 'Category',
      type: 'searchable-checkbox',
      showCount: true,
      scroll: true,
      options: context.categories.map((c) => ({ value: c, label: c })),
    }];
  },
  sortOptions: [
    { value: 'category', label: 'Category, then name' },
    { value: 'name', label: 'Product A–Z' },
    { value: 'name-desc', label: 'Product Z–A' },
  ],
});

export const countsConfig = simpleEventConfig({
  id: 'counts',
  defaults: () => ({ categories: [], sort: 'category' }),
  persist: { keys: ['sort'], storageKey: 'v5CountsTableFilter' },
  buildFilterSections(_state, context) {
    if (!context.categories?.length) return [];
    return [{
      id: 'categories',
      label: 'Category',
      type: 'searchable-checkbox',
      showCount: true,
      scroll: true,
      options: context.categories.map((c) => ({ value: c, label: c })),
    }];
  },
  sortOptions: [
    { value: 'category', label: 'Category, then name' },
    { value: 'name', label: 'Product A–Z' },
    { value: 'name-desc', label: 'Product Z–A' },
  ],
});

export const kitConfig = simpleEventConfig({
  id: 'kit',
  defaults: () => ({ stockFilter: 'all', warehouseId: '', sort: 'category' }),
  persist: { keys: ['sort'], storageKey: 'v5KitTableFilter' },
  buildFilterSections(_state, context) {
    const sections = [{
      id: 'stockFilter',
      label: 'Lines',
      type: 'segment',
      options: [
        { value: 'all', label: 'All' },
        { value: 'own', label: 'Own' },
        { value: 'hire', label: 'Hire' },
        { value: 'short', label: 'Short' },
      ],
    }];
    const wh = context.warehouses || [];
    if (wh.length) {
      sections.push({
        id: 'warehouseId',
        label: 'Warehouse',
        type: 'radio',
        scroll: true,
        options: [
          { value: '', label: 'All warehouses' },
          ...wh.map((w) => ({ value: w.id || w.value, label: w.name || w.label })),
        ],
      });
    }
    return sections;
  },
  sortOptions: [
    { value: 'category', label: 'Category, then name' },
    { value: 'name', label: 'Name A–Z' },
    { value: 'name-desc', label: 'Name Z–A' },
  ],
  toValues(state) {
    return {
      stockFilter: state.stockFilter || 'all',
      warehouseId: state.warehouseId || '',
      sort: state.sort || 'category',
    };
  },
});

export const deliveriesConfig = simpleEventConfig({
  id: 'deliveries',
  defaults: () => ({
    supplierIds: [],
    dates: { from: '', to: '' },
    sort: 'date-desc',
  }),
  persist: { keys: ['sort'], storageKey: 'v5DeliveriesTableFilter' },
  buildFilterSections(_state, context) {
    const sections = [];
    if (context.suppliers?.length) {
      sections.push({
        id: 'supplierIds',
        label: 'Supplier',
        type: 'searchable-checkbox',
        showCount: true,
        scroll: true,
        options: context.suppliers,
      });
    }
    sections.push({
      id: 'dates',
      label: 'Date',
      type: 'date-range',
    });
    return sections;
  },
  sortOptions: [
    { value: 'date-desc', label: 'Newest first' },
    { value: 'date-asc', label: 'Oldest first' },
    { value: 'supplier', label: 'Supplier A–Z' },
  ],
});

export const transfersConfig = simpleEventConfig({
  id: 'transfers',
  defaults: () => ({ dates: { from: '', to: '' }, sort: 'date-desc' }),
  persist: { keys: ['sort'], storageKey: 'v5TransfersTableFilter' },
  buildFilterSections() {
    return [{ id: 'dates', label: 'Date', type: 'date-range' }];
  },
  sortOptions: [
    { value: 'date-desc', label: 'Newest first' },
    { value: 'date-asc', label: 'Oldest first' },
  ],
});

export const wastageConfig = simpleEventConfig({
  id: 'wastage',
  defaults: () => ({ dates: { from: '', to: '' }, sort: 'date-desc' }),
  persist: { keys: ['sort'], storageKey: 'v5WastageTableFilter' },
  buildFilterSections() {
    return [{ id: 'dates', label: 'Date', type: 'date-range' }];
  },
  sortOptions: [
    { value: 'date-desc', label: 'Newest first' },
    { value: 'date-asc', label: 'Oldest first' },
  ],
});

export const reportsConfig = simpleEventConfig({
  id: 'reports',
  defaults: () => ({
    kind: 'clients',
    recipientId: '',
    supplierId: '',
    dates: { from: '', to: '' },
    qtyMode: 'received',
    supplierView: 'suppliers',
  }),
  buildFilterSections(_state, context) {
    const sections = [{
      id: 'kind',
      label: 'Report type',
      type: 'segment',
      options: [
        { value: 'clients', label: 'Transfers by client' },
        { value: 'suppliers', label: 'Supplier delivery cost' },
      ],
    }, {
      id: 'dates',
      label: 'Date',
      type: 'date-range',
    }];
    const recipients = context.recipients || [];
    const suppliers = context.suppliers || [];
    if (recipients.length) {
      sections.push({
        id: 'recipientId',
        label: 'Client',
        type: 'radio',
        scroll: true,
        options: [
          { value: '', label: 'Select a client' },
          ...recipients.map((r) => ({ value: r.id || r.value, label: r.name || r.label })),
        ],
      });
    }
    if (suppliers.length) {
      sections.push({
        id: 'supplierId',
        label: 'Supplier',
        type: 'radio',
        scroll: true,
        options: [
          { value: '', label: 'All suppliers' },
          ...suppliers,
        ],
      });
    }
    sections.push({
      id: 'qtyMode',
      label: 'Quantity basis',
      type: 'segment',
      options: [
        { value: 'received', label: 'Received' },
        { value: 'invoiced', label: 'Invoiced' },
      ],
    }, {
      id: 'supplierView',
      label: 'Supplier view',
      type: 'segment',
      options: [
        { value: 'suppliers', label: 'By supplier' },
        { value: 'deliveries', label: 'By delivery' },
      ],
    });
    return sections;
  },
  sortOptions: null,
});

export const projectionsConfig = simpleEventConfig({
  id: 'projections',
  defaults: () => ({ runoutFilter: 'runout', sort: 'name', sortDir: 'asc' }),
  persist: { keys: ['sort', 'sortDir', 'runoutFilter'], storageKey: 'v5ProjectionsTableFilter' },
  buildFilterSections() {
    return [{
      id: 'runoutFilter',
      label: 'Products',
      type: 'segment',
      options: [
        { value: 'all', label: 'All mapped products' },
        { value: 'runout', label: 'Runs out before target' },
      ],
    }];
  },
  sortOptions: [
    { value: 'name', label: 'Name' },
    { value: 'servingsSold', label: 'Servings sold' },
    { value: 'baselineCases', label: 'Baseline cases' },
    { value: 'projectedCases', label: 'Projected cases' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'wastage', label: 'Wastage' },
    { value: 'available', label: 'Available' },
    { value: 'runOutRevenue', label: 'Run-out revenue' },
    { value: 'pct', label: '% used' },
  ],
  toValues(state) {
    return {
      runoutFilter: state.runoutFilter || 'runout',
      sortKey: state.sort || 'name',
      sortDir: state.sortDir || 'asc',
    };
  },
});

export const dashboardConfig = {
  id: 'dashboard',
  match: eventMatch('dashboard'),
  routeKey: (route) => `dashboard:${route.eventId}`,
  defaults: () => ({ runoutFilter: 'all', sort: 'name', sortDir: 'asc' }),
  persist: { keys: ['sort', 'sortDir', 'runoutFilter'], storageKey: 'v5DashboardTableFilter' },
  createState() {
    return loadPersisted('v5DashboardTableFilter', {
      runoutFilter: 'all', sort: 'name', sortDir: 'asc',
    }, ['sort', 'sortDir', 'runoutFilter']);
  },
  getContext() { return {}; },
  onStateChange(state) {
    savePersisted('v5DashboardTableFilter', state, ['sort', 'sortDir', 'runoutFilter']);
  },
  toValues(state) {
    return {
      runoutFilter: state.runoutFilter || 'all',
      sortKey: state.sort || 'name',
      sortDir: state.sortDir || 'asc',
    };
  },
  buildTabs(api) {
    const state = api.getState();
    const h = makeControllerHelpers(api);
    const sortOptions = [
      { value: 'name', label: 'Name' },
      { value: 'servingsSold', label: 'Servings sold' },
      { value: 'baselineCases', label: 'Baseline cases' },
      { value: 'projectedCases', label: 'Projected cases' },
      { value: 'delivered', label: 'Delivered' },
      { value: 'wastage', label: 'Wastage' },
      { value: 'available', label: 'Available' },
      { value: 'runOutRevenue', label: 'Run-out revenue' },
      { value: 'pct', label: '% used' },
    ];
    return [{
      id: 'filter',
      label: 'Filter',
      icon: 'funnel',
      sections: [{
        id: 'runoutFilter',
        label: 'Products',
        type: 'segment',
        options: [
          { value: 'all', label: 'All mapped products' },
          { value: 'runout', label: 'Runs out before target' },
        ],
      }],
      values: { runoutFilter: state.runoutFilter || 'all' },
      onChange(_id, value) {
        h.patch({ runoutFilter: value });
        api.syncUi();
        h.emit();
      },
      onReset() {
        h.patch({ runoutFilter: 'all' });
        api.syncUi();
        h.emit();
      },
    }, {
      id: 'sort',
      label: 'Sort',
      icon: 'list-sort-descending',
      sections: [{
        id: 'sort',
        label: 'Order',
        type: 'radio',
        options: sortOptions,
      }],
      values: { sort: state.sort },
      onChange(_id, value) {
        h.patch({ sort: value });
        api.syncUi();
        h.emit();
      },
      onReset() {
        h.patch({ sort: 'name', sortDir: 'asc' });
        api.syncUi();
        h.emit();
      },
    }];
  },
  buildActiveItems(api) {
    const state = api.getState();
    const items = [];
    if (api.getActiveTab() !== 'filter' && state.runoutFilter === 'runout') {
      items.push({ id: 'runoutFilter', label: 'Runs out before target' });
    }
    if (api.getActiveTab() !== 'sort' && state.sort !== 'name') {
      items.push({ id: 'sort', label: state.sort });
    }
    return items;
  },
  removeActiveItem(api, id) {
    const state = api.getState();
    if (id === 'runoutFilter') api.setState({ ...state, runoutFilter: 'all' });
    else if (id === 'sort') api.setState({ ...state, sort: 'name', sortDir: 'asc' });
    else return false;
    return true;
  },
  isActive(api) {
    const state = api.getState();
    return state.sort !== 'name' || state.runoutFilter === 'runout';
  },
};

function viewConfig({
  id, defaults, persist, buildFilterSections, sortOptions, toValues,
}) {
  const base = simpleEventConfig({
    id, defaults, persist, buildFilterSections, sortOptions, toValues,
  });
  return {
    ...base,
    match: viewMatch(id),
    routeKey: () => id,
  };
}

export const libraryConfig = viewConfig({
  id: 'library',
  defaults: () => ({ category: '', supplierId: '', sort: 'name', sortDir: 'asc' }),
  persist: { keys: ['sort', 'sortDir'], storageKey: 'v5LibraryTableFilter' },
  buildFilterSections(_state, context) {
    const sections = [];
    if (context.categories?.length) {
      sections.push({
        id: 'category',
        label: 'Category',
        type: 'radio',
        scroll: true,
        options: [
          { value: '', label: 'All categories' },
          ...context.categories.map((c) => ({ value: c, label: c })),
        ],
      });
    }
    if (context.suppliers?.length) {
      sections.push({
        id: 'supplierId',
        label: 'Supplier',
        type: 'radio',
        scroll: true,
        options: [
          { value: '', label: 'All suppliers' },
          ...context.suppliers,
        ],
      });
    }
    return sections;
  },
  sortOptions: [
    { value: 'name', label: 'Name' },
    { value: 'case_size', label: 'Case size' },
    { value: 'stock_unit', label: 'Stock unit' },
    { value: 'category', label: 'Category' },
    { value: 'supplier', label: 'Supplier' },
    { value: 'units_per_case', label: 'Units / case' },
    { value: 'case_price', label: 'Case price' },
    { value: 'unit_price', label: 'Unit price' },
  ],
  toValues(state) {
    return {
      categoryFilter: state.category || '',
      supplierFilter: state.supplierId || '',
      sortKey: state.sort || 'name',
      sortDir: state.sortDir || 'asc',
    };
  },
});

export const kitLibraryConfig = viewConfig({
  id: 'kit-library',
  defaults: () => ({
    category: '',
    stockFilter: 'all',
    showArchived: 'hide',
    sort: 'name',
    sortDir: 'asc',
  }),
  persist: { keys: ['sort', 'sortDir'], storageKey: 'v5KitLibraryTableFilter' },
  buildFilterSections(_state, context) {
    const sections = [];
    if (context.categories?.length) {
      sections.push({
        id: 'category',
        label: 'Category',
        type: 'radio',
        scroll: true,
        options: [
          { value: '', label: 'All categories' },
          ...context.categories.map((c) => ({ value: c, label: c })),
        ],
      });
    }
    sections.push({
      id: 'stockFilter',
      label: 'Stock',
      type: 'segment',
      options: [
        { value: 'all', label: 'All' },
        { value: 'in-stock', label: 'In stock' },
        { value: 'zero', label: 'Zero' },
      ],
    }, {
      id: 'showArchived',
      label: 'Archived',
      type: 'radio',
      options: [
        { value: 'hide', label: 'Hide archived' },
        { value: 'show', label: 'Show archived' },
      ],
    });
    return sections;
  },
  sortOptions: [
    { value: 'name', label: 'Name' },
    { value: 'barcode', label: 'Barcode' },
    { value: 'sku', label: 'SKU' },
    { value: 'stock', label: 'Stock' },
    { value: 'notes', label: 'Notes' },
  ],
  toValues(state) {
    return {
      categoryFilter: state.category || '',
      stockFilter: state.stockFilter || 'all',
      showArchived: state.showArchived === true || state.showArchived === 'show',
      sortKey: state.sort || 'name',
      sortDir: state.sortDir || 'asc',
    };
  },
});

export const suppliersConfig = viewConfig({
  id: 'suppliers',
  defaults: () => ({ query: '', sort: 'name' }),
  persist: { keys: ['sort'], storageKey: 'v5SuppliersTableFilter' },
  buildFilterSections() {
    return [{
      id: 'query',
      label: 'Name',
      type: 'text',
      placeholder: 'Filter suppliers…',
    }];
  },
  sortOptions: [
    { value: 'name', label: 'Name A–Z' },
    { value: 'name-desc', label: 'Name Z–A' },
  ],
});

export const warehousesConfig = viewConfig({
  id: 'warehouses',
  defaults: () => ({ query: '', kind: 'stock', sort: 'name' }),
  persist: { keys: ['sort', 'kind'], storageKey: 'v5WarehousesTableFilter' },
  buildFilterSections() {
    return [{
      id: 'query',
      label: 'Search',
      type: 'text',
      placeholder: 'Filter warehouses…',
    }, {
      id: 'kind',
      label: 'Type',
      type: 'segment',
      options: [
        { value: 'stock', label: 'Stock' },
        { value: 'kit', label: 'Kit' },
      ],
    }];
  },
  sortOptions: [
    { value: 'name', label: 'Name A–Z' },
    { value: 'name-desc', label: 'Name Z–A' },
  ],
});

export const volumePoolsConfig = viewConfig({
  id: 'volume-pools',
  defaults: () => ({ query: '', sort: 'name' }),
  persist: { keys: ['sort'], storageKey: 'v5VolumePoolsTableFilter' },
  buildFilterSections() {
    return [{
      id: 'query',
      label: 'Search',
      type: 'text',
      placeholder: 'Filter pools…',
    }];
  },
  sortOptions: [
    { value: 'name', label: 'Name A–Z' },
    { value: 'name-desc', label: 'Name Z–A' },
  ],
});

export const bugsConfig = viewConfig({
  id: 'bugs',
  defaults: () => ({ status: 'open', type: 'all', sort: 'date-desc' }),
  persist: { keys: ['status', 'type', 'sort'], storageKey: 'v5BugsTableFilter' },
  buildFilterSections() {
    return [{
      id: 'status',
      label: 'Status',
      type: 'segment',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'resolved', label: 'Resolved' },
        { value: 'all', label: 'All' },
      ],
    }, {
      id: 'type',
      label: 'Type',
      type: 'segment',
      options: [
        { value: 'all', label: 'All' },
        { value: 'bug', label: 'Bug' },
        { value: 'feature', label: 'Feature' },
      ],
    }];
  },
  sortOptions: [
    { value: 'date-desc', label: 'Newest first' },
    { value: 'date-asc', label: 'Oldest first' },
  ],
});

const AUDIT_CHECKS = [
  { value: 'delivered_consistency', label: 'Delivered consistency' },
  { value: 'opening_identity', label: 'Opening identity' },
  { value: 'closing_identity', label: 'Closing identity' },
  { value: 'recon_consumption', label: 'Recon consumption' },
  { value: 'damaged_semantics', label: 'Damaged semantics' },
  { value: 'return_dual_write', label: 'Return dual-write' },
  { value: 'distribution_overalloc', label: 'Distribution overallocation' },
  { value: 'sync_queue_backlog', label: 'Sync queue backlog' },
  { value: 'stale_aggregate', label: 'Stale aggregate' },
];

export const auditConfig = viewConfig({
  id: 'audit',
  defaults: () => ({ severity: '', check: '', query: '' }),
  buildFilterSections() {
    return [{
      id: 'severity',
      label: 'Severity',
      type: 'segment',
      options: [
        { value: '', label: 'All' },
        { value: 'error', label: 'Error' },
        { value: 'warn', label: 'Warn' },
        { value: 'info', label: 'Info' },
      ],
    }, {
      id: 'check',
      label: 'Check',
      type: 'radio',
      scroll: true,
      options: [
        { value: '', label: 'All checks' },
        ...AUDIT_CHECKS,
      ],
    }, {
      id: 'query',
      label: 'Search',
      type: 'text',
      placeholder: 'Filter findings…',
    }];
  },
  sortOptions: null,
});

export const ALL_FILTER_CONFIGS = [
  distributionConfig,
  reconConfig,
  closingConfig,
  salesConfig,
  productsConfig,
  countsConfig,
  kitConfig,
  deliveriesConfig,
  transfersConfig,
  wastageConfig,
  reportsConfig,
  projectionsConfig,
  dashboardConfig,
  libraryConfig,
  kitLibraryConfig,
  suppliersConfig,
  warehousesConfig,
  volumePoolsConfig,
  bugsConfig,
  auditConfig,
];
