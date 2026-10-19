import { describe, expect, it } from 'vitest';
import {
  renderCombinedTableFilterPanel,
  tableFilterIsActive,
  parseActiveItemId,
  toggleSegmentSelection,
} from './table-filter-panel.js';
import {
  buildStandardActiveItems,
  removeStandardActiveItem,
  extractCategoryNames,
} from '../admin/filter-helpers.js';
import { getTableFilterConfig } from '../admin/table-filter.js';
import { ALL_FILTER_CONFIGS, LIBRARY_COLUMNS, libraryConfig } from '../admin/filter-configs.js';

describe('tableFilterIsActive', () => {
  it('detects checkbox and radio differences from defaults', () => {
    const sections = [
      { id: 'categories', type: 'checkbox' },
      { id: 'sort', type: 'radio' },
    ];
    expect(tableFilterIsActive(
      { categories: [], sort: 'name' },
      { categories: [], sort: 'name' },
      sections,
    )).toBe(false);
    expect(tableFilterIsActive(
      { categories: ['Beer'], sort: 'name' },
      { categories: [], sort: 'name' },
      sections,
    )).toBe(true);
    expect(tableFilterIsActive(
      { categories: [], sort: 'qty' },
      { categories: [], sort: 'name' },
      sections,
    )).toBe(true);
  });

  it('detects text and date-range differences', () => {
    const sections = [
      { id: 'query', type: 'text' },
      { id: 'dates', type: 'date-range' },
    ];
    expect(tableFilterIsActive(
      { query: '', dates: { from: '', to: '' } },
      { query: '', dates: { from: '', to: '' } },
      sections,
    )).toBe(false);
    expect(tableFilterIsActive(
      { query: 'acme', dates: { from: '', to: '' } },
      { query: '', dates: { from: '', to: '' } },
      sections,
    )).toBe(true);
    expect(tableFilterIsActive(
      { query: '', dates: { from: '2026-01-01', to: '' } },
      { query: '', dates: { from: '', to: '' } },
      sections,
    )).toBe(true);
  });

  it('detects multi-select segment differences', () => {
    const sections = [{ id: 'status', type: 'segment', multi: true }];
    expect(tableFilterIsActive({ status: [] }, { status: [] }, sections)).toBe(false);
    expect(tableFilterIsActive({ status: ['red'] }, { status: [] }, sections)).toBe(true);
    expect(tableFilterIsActive({ status: ['red', 'green'] }, { status: ['green', 'red'] }, sections)).toBe(false);
  });
});

describe('parseActiveItemId', () => {
  it('parses section and value chips', () => {
    expect(parseActiveItemId('sort')).toEqual({ sectionId: 'sort', value: null });
    expect(parseActiveItemId('categories:Beer')).toEqual({
      sectionId: 'categories',
      value: 'Beer',
    });
  });
});

describe('renderCombinedTableFilterPanel', () => {
  it('renders segment, searchable, date-range, and text sections', () => {
    const html = renderCombinedTableFilterPanel({
      tabs: [{
        id: 'filter',
        label: 'Filter',
        values: {
          status: 'open',
          categories: ['A'],
          dates: { from: '2026-01-01', to: '' },
          query: 'x',
        },
        sections: [
          {
            id: 'status',
            label: 'Status',
            type: 'segment',
            options: [
              { value: '', label: 'All' },
              { value: 'open', label: 'Open' },
            ],
          },
          {
            id: 'categories',
            label: 'Category',
            type: 'searchable-checkbox',
            options: [{ value: 'A', label: 'A' }],
          },
          { id: 'dates', label: 'Date', type: 'date-range' },
          { id: 'query', label: 'Search', type: 'text', placeholder: 'Find…' },
        ],
      }],
      activeTab: 'filter',
    });
    expect(html).toContain('tfp-seg');
    expect(html).toContain('tfp-search');
    expect(html).toContain('tfp-date-range');
    expect(html).toContain('tfp-text-input');
    expect(html).toContain('Find…');
    expect(html).toContain('data-type="segment"');
  });

  it('renders multi status segments as toggleable checkboxes', () => {
    const html = renderCombinedTableFilterPanel({
      tabs: [{
        id: 'filter',
        label: 'Filter',
        values: { status: ['red', 'blue'] },
        sections: [{
          id: 'status',
          label: 'Status',
          type: 'segment',
          multi: true,
          options: [
            { value: '', label: 'All' },
            { value: 'red', label: 'Action', dot: 'red' },
            { value: 'yellow', label: 'Review', dot: 'yellow' },
            { value: 'blue', label: 'None returned', dot: 'blue' },
          ],
        }],
      }],
      activeTab: 'filter',
    });
    expect(html).toContain('role="group"');
    expect(html).toContain('role="checkbox"');
    expect(html).toMatch(/data-value="red"[^>]*aria-checked="true"/);
    expect(html).toMatch(/data-value="yellow"[^>]*aria-checked="false"/);
    expect(html).toMatch(/data-value="blue"[^>]*aria-checked="true"/);
    expect(html).toMatch(/data-value=""[^>]*aria-checked="false"/);
  });
});

describe('toggleSegmentSelection', () => {
  it('replaces the value for single-select segments', () => {
    expect(toggleSegmentSelection('red', 'green')).toBe('green');
  });

  it('toggles values and treats All as a clear', () => {
    expect(toggleSegmentSelection([], 'red', { multi: true })).toEqual(['red']);
    expect(toggleSegmentSelection(['red'], 'green', { multi: true })).toEqual(['red', 'green']);
    expect(toggleSegmentSelection(['red', 'green'], 'red', { multi: true })).toEqual(['green']);
    expect(toggleSegmentSelection(['red'], '', { multi: true })).toEqual([]);
    expect(toggleSegmentSelection(['green'], 'green', { multi: true })).toEqual([]);
  });
});

describe('filter helpers', () => {
  it('extracts category names from nested products', () => {
    const cats = extractCategoryNames([
      { product: { category: { name: 'Spirits' } } },
      { category: { name: 'Beer' } },
      { product: { name: 'X' } },
    ]);
    expect(cats).toEqual(['Beer', 'Spirits', 'Uncategorised']);
  });

  it('builds and removes standard active items', () => {
    const state = { categories: ['Beer'], sort: 'qty', query: '' };
    const defaults = { categories: [], sort: 'name', query: '' };
    const items = buildStandardActiveItems({
      state,
      defaults,
      activeTab: 'columns',
      sectionsByTab: {
        filter: [{ id: 'categories', type: 'checkbox', options: [{ value: 'Beer', label: 'Beer' }] }],
        sort: [{ id: 'sort', type: 'radio', options: [{ value: 'qty', label: 'Qty ↓' }] }],
      },
    });
    expect(items.some((i) => i.id === 'categories:Beer')).toBe(true);
    expect(items.some((i) => i.id === 'sort')).toBe(true);

    const next = removeStandardActiveItem(state, defaults, 'categories:Beer');
    expect(next.categories).toEqual([]);
  });
});

describe('filter config registry', () => {
  it('registers all data-page configs', () => {
    expect(ALL_FILTER_CONFIGS.length).toBeGreaterThanOrEqual(18);
    const ids = ALL_FILTER_CONFIGS.map((c) => c.id);
    expect(ids).toContain('distribution');
    expect(ids).toContain('closing');
    expect(ids).toContain('library');
    expect(ids).toContain('audit');
  });

  it('resolves configs by route', () => {
    expect(getTableFilterConfig({ view: 'event', panel: 'distribution', eventId: 'e1' })?.id)
      .toBe('distribution');
    expect(getTableFilterConfig({ view: 'event', panel: 'closing', eventId: 'e1' })?.id)
      .toBe('closing');
    expect(getTableFilterConfig({ view: 'library' })?.id).toBe('library');
    expect(getTableFilterConfig({ view: 'suppliers' })?.id).toBe('suppliers');
    expect(getTableFilterConfig({ view: 'audit' })?.id).toBe('audit');
    expect(getTableFilterConfig({ view: 'settings' })).toBeNull();
  });
});

describe('library column visibility', () => {
  function apiFor(state, { tab = 'filter' } = {}) {
    let current = state;
    return {
      getState: () => current,
      setState(next) { current = next; },
      getContext: () => ({ categories: ['Beer'], suppliers: [] }),
      getActiveTab: () => tab,
      emit() {},
      remount() {},
      syncUi() {},
      touch() {},
    };
  }

  it('lists every library column and keeps Product visible', () => {
    const api = apiFor(libraryConfig.defaults());
    const tabs = libraryConfig.buildTabs(api);
    expect(tabs.map((t) => t.id)).toEqual(['filter', 'sort', 'columns']);
    const columns = tabs.find((t) => t.id === 'columns');
    expect(columns.sections[0].options.map((o) => o.label)).toEqual(
      LIBRARY_COLUMNS.map((c) => c.label),
    );
    expect(columns.sections[0].options[0]).toMatchObject({ value: 'name', disabled: true });
    expect(libraryConfig.toValues(libraryConfig.defaults()).visibleColumns).toEqual(
      LIBRARY_COLUMNS.map((c) => c.value),
    );
    expect(libraryConfig.toValues({
      ...libraryConfig.defaults(),
      visibleColumns: ['abv', 'case_size'],
    }).visibleColumns).toEqual(['name', 'case_size', 'abv']);
  });

  it('chips a hidden column and restores it when the chip is removed', () => {
    const api = apiFor({ ...libraryConfig.defaults(), visibleColumns: ['name', 'abv'] });
    const chips = libraryConfig.buildActiveItems(api);
    expect(chips.some((c) => c.id === 'columns-hidden:stock_unit')).toBe(true);
    expect(chips.some((c) => c.id === 'columns-hidden:pallet_qty')).toBe(true);
    expect(chips.some((c) => c.id === 'columns-hidden:name')).toBe(false);
    libraryConfig.removeActiveItem(api, 'columns-hidden:keg_coupler');
    expect(api.getState().visibleColumns).toEqual(['name', 'abv', 'keg_coupler']);
  });

  it('shows columns in a saved order and keeps that order when one is hidden', () => {
    const columnOrder = [
      'supplier',
      ...LIBRARY_COLUMNS.map((col) => col.value).filter((id) => id !== 'supplier'),
    ];
    const api = apiFor({
      ...libraryConfig.defaults(),
      columnOrder,
      visibleColumns: columnOrder,
    });
    expect(libraryConfig.toValues(api.getState()).visibleColumns.slice(0, 3)).toEqual([
      'supplier', 'name', 'case_size',
    ]);
    const columns = libraryConfig.buildTabs(api).find((tab) => tab.id === 'columns');
    columns.onChange('visibleColumns', columnOrder.filter((id) => id !== 'abv'));
    const shown = libraryConfig.toValues(api.getState()).visibleColumns;
    expect(shown[0]).toBe('supplier');
    expect(shown).not.toContain('abv');
    expect(api.getState().columnOrder[0]).toBe('supplier');
    columns.onReset();
    expect(libraryConfig.toValues(api.getState()).columnOrder).toEqual(
      LIBRARY_COLUMNS.map((col) => col.value),
    );
    expect(libraryConfig.toValues(api.getState()).visibleColumns).toEqual(
      LIBRARY_COLUMNS.map((col) => col.value),
    );
  });
});
