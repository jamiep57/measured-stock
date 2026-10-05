import { describe, it, expect } from 'vitest';
import {
  parseQty,
  formToStored,
  storedToForm,
  formToCountStored,
  totalUnits,
} from './stock-entry.js';
import { packMetrics, productStockPack, countEntryMode } from './pack-metrics.js';

describe('parseQty', () => {
  it('parses numbers', () => {
    expect(parseQty('12')).toBe(12);
    expect(parseQty('0.5')).toBe(0.5);
  });
  it('evaluates basic arithmetic', () => {
    expect(parseQty('4+10')).toBe(14);
    expect(parseQty('2*3+4')).toBe(10);
    expect(parseQty('(8+4)/2')).toBe(6);
  });
  it('returns 0 for empty or invalid', () => {
    expect(parseQty('')).toBe(0);
    expect(parseQty('abc')).toBe(0);
    expect(parseQty('-1')).toBe(0);
  });
});

describe('WYSIWYG round-trip', () => {
  it('formToStored passthrough', () => {
    expect(formToStored({ cases: '2', singles: '3' })).toEqual({ qty: 2, singles: 3 });
  });
  it('storedToForm passthrough', () => {
    expect(storedToForm({ qty: 2, singles: 3 })).toEqual({ cases: '2', singles: '3' });
  });
  it('does not change values on round-trip', () => {
    const stored = formToCountStored({ cases: '24', singles: '0.5' });
    expect(stored).toEqual({ cases: 24, singles: 0.5 });
    const form = storedToForm({ cases: stored.cases, singles: stored.singles });
    expect(form).toEqual({ cases: '24', singles: '0.5' });
  });
});

describe('totalUnits', () => {
  const spirit70 = packMetrics({
    stock_unit: 'bottle',
    units_per_case: 1,
    servings_per_unit: 28,
  });

  it('combines bottles and partial for spirits', () => {
    expect(totalUnits(24, 0.5, spirit70)).toBeCloseTo(24.5, 4);
  });

  const wine750 = packMetrics({
    stock_unit: 'bottle',
    units_per_case: 1,
    servings_per_unit: 1,
  });

  it('combines bottles and partial for wine', () => {
    expect(totalUnits(10, 0.5, wine750)).toBeCloseTo(10.5, 4);
  });

  const beer24 = packMetrics({
    stock_unit: 'case',
    units_per_case: 24,
    servings_per_unit: 1,
  });

  it('combines cases and singles for beer', () => {
    expect(totalUnits(2, 6, beer24)).toBeCloseTo(2.25, 4);
  });

  const keg30 = packMetrics({
    stock_unit: 'keg',
    units_per_case: 1,
    servings_per_unit: 52,
  });

  it('combines kegs and partial', () => {
    expect(totalUnits(12, 0.5, keg30)).toBeCloseTo(12.5, 4);
  });
});

describe('countEntryMode', () => {
  const caseSizes = [
    { id: '1', label: '70cl', stock_unit: 'bottle', units_per_case: 1, servings_per_unit: 28 },
    { id: '2', label: '24×330ml', stock_unit: 'case', units_per_case: 24, servings_per_unit: 1 },
  ];

  it('spirits use bottles + partial', () => {
    const product = {
      stock_case_size_id: '1',
      category: { colour_key: 'spirits' },
    };
    const mode = countEntryMode(product, caseSizes);
    expect(mode.columnLabels.primary).toBe('Bottles');
    expect(mode.columnLabels.secondary).toBe('Partial');
  });

  it('beer uses cases + singles', () => {
    const product = {
      stock_case_size_id: '2',
      category: { colour_key: 'beer' },
    };
    const mode = countEntryMode(product, caseSizes);
    expect(mode.columnLabels.primary).toBe('Cases');
    expect(mode.columnLabels.secondary).toBe('Singles');
  });

  it('kegs use kegs + partial', () => {
    const kegSizes = [
      ...caseSizes,
      { id: '3', label: '30L Keg', stock_unit: 'keg', units_per_case: 1, servings_per_unit: 52 },
    ];
    const product = {
      stock_case_size_id: '3',
      category: { colour_key: 'draught beer' },
    };
    const mode = countEntryMode(product, kegSizes);
    expect(mode.columnLabels.primary).toBe('Kegs');
    expect(mode.columnLabels.secondary).toBe('Partial');
  });
});

describe('productStockPack', () => {
  it('resolves from stock_case_size_id', () => {
    const cs = [{ id: 'a', label: '70cl', stock_unit: 'bottle', units_per_case: 1, servings_per_unit: 28 }];
    const p = { stock_case_size_id: 'a' };
    expect(productStockPack(p, cs).label).toBe('70cl');
  });

  it('falls back to legacy product units_per_case', () => {
    const p = { name: 'Carton Water', case_size: '12×330ml', units_per_case: 12, stock_unit: 'case' };
    const pack = productStockPack(p, []);
    expect(pack.unitsPerCase).toBe(12);
    expect(pack.label).toBe('12×330ml');
    expect(pack.stockUnit).toBe('case');
  });
});
