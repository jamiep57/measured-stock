import { describe, it, expect } from 'vitest';
import { normaliseTweSuggestion, slugifyTweName, findTweSupplier } from './twe-catalog.js';
import { mapCatalogHitToFields } from './supplier-catalogs.js';
import { inferPackLabel, matchCaseSize, matchCategory } from './lwc-catalog.js';

const CASE_SIZES = [
  { id: 'cs-70', label: '70cl' },
  { id: 'cs-750', label: '750ml' },
];
const CATEGORIES = [
  { id: 'cat-wine', name: 'Wine', colour_key: 'wine' },
  { id: 'cat-spirits', name: 'Spirits', colour_key: 'spirits' },
];

describe('slugifyTweName', () => {
  it('builds a product-path slug', () => {
    expect(slugifyTweName('Macallan 12yo Double Cask')).toBe('macallan-12yo-double-cask');
  });
});

describe('normaliseTweSuggestion', () => {
  it('maps a product suggestion to catalogue fields', () => {
    const hit = normaliseTweSuggestion({
      value: 'Macallan 12yo Double Cask',
      data: { otype: 'product', oid: '34537' },
    });
    expect(hit).toMatchObject({
      name: 'Macallan 12yo Double Cask',
      sku: '34537',
      source: 'twe',
      sourceLabel: 'TWE',
      productCategory: 'Spirits',
      unitSize: '70cl',
    });
    expect(hit.url).toBe('https://www.thewhiskyexchange.com/p/34537/macallan-12yo-double-cask');
    expect(hit.image).toBe('https://img.thewhiskyexchange.com/80/34537.jpg');
  });

  it('skips brand-only suggestions', () => {
    expect(normaliseTweSuggestion({
      value: 'Macallan',
      data: { otype: 'brand', oid: '580003455' },
    })).toBeNull();
  });

  it('reads bottle size from the name when present', () => {
    const hit = normaliseTweSuggestion({
      value: 'Macallan 12yo Double Cask 70cl',
      data: { otype: 'product', oid: '1' },
    });
    expect(inferPackLabel(hit)).toBe('70cl');
  });
});

describe('findTweSupplier', () => {
  it('matches Whisky Exchange supplier names', () => {
    expect(findTweSupplier([
      { id: 'l', name: 'LWC' },
      { id: 't', name: 'The Whisky Exchange' },
    ])?.id).toBe('t');
    expect(findTweSupplier([{ id: 'x', name: 'TWE' }])?.id).toBe('x');
  });
});

describe('mapCatalogHitToFields for TWE', () => {
  it('fills spirits pack and TWE supplier', () => {
    const hit = normaliseTweSuggestion({
      value: 'Macallan 12yo Sherry Oak',
      data: { otype: 'product', oid: '3512' },
    });
    const mapped = mapCatalogHitToFields(hit, {
      categories: CATEGORIES,
      caseSizes: CASE_SIZES,
      suppliers: [{ id: 'twe', name: 'The Whisky Exchange' }, { id: 'lwc', name: 'LWC' }],
    });
    expect(mapped.sourceLabel).toBe('TWE');
    expect(mapped.sku).toBe('3512');
    expect(mapped.caseSizeId).toBe('cs-70');
    expect(mapped.categoryId).toBe('cat-spirits');
    expect(mapped.supplierId).toBe('twe');
    expect(matchCaseSize(hit.unitSize, CASE_SIZES)?.id).toBe('cs-70');
    expect(matchCategory(hit, CATEGORIES)?.id).toBe('cat-spirits');
  });
});
