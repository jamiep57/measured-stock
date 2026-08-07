import { describe, expect, it } from 'vitest';
import {
  renderCombinedTableFilterPanel,
  tableFilterIsActive,
  parseActiveItemId,
} from './table-filter-panel.js';
import {
  buildStandardActiveItems,
  removeStandardActiveItem,
  extractCategoryNames,
} from '../admin/filter-helpers.js';
import { getTableFilterConfig } from '../admin/table-filter.js';
import { ALL_FILTER_CONFIGS } from '../admin/filter-configs.js';

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
