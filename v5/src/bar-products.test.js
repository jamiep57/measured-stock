import { describe, it, expect } from 'vitest';
import {
  barServesProduct,
  filterEventProductsForBar,
  hasBarMenu,
} from './bar-products.js';

const barProducts = [
  { bar_id: 'bar-a', product_id: 'p1' },
  { bar_id: 'bar-a', product_id: 'p2' },
  { bar_id: 'bar-b', product_id: 'p3' },
];

const eventProducts = [
  { product_id: 'p1', product: { name: 'Lager' } },
  { product_id: 'p2', product: { name: 'Ale' } },
  { product_id: 'p3', product: { name: 'Cider' } },
  { product_id: 'p4', product: { name: 'Wine' } },
];

describe('barServesProduct', () => {
  it('returns false without a bar', () => {
    expect(barServesProduct(barProducts, null, 'p1')).toBe(false);
  });

  it('restricts to menu when bar has rows', () => {
    expect(barServesProduct(barProducts, 'bar-a', 'p1')).toBe(true);
    expect(barServesProduct(barProducts, 'bar-a', 'p4')).toBe(false);
  });

  it('serves all event products when bar menu is empty', () => {
    expect(barServesProduct(barProducts, 'bar-empty', 'p4')).toBe(true);
  });
});

describe('filterEventProductsForBar', () => {
  it('filters to bar menu', () => {
    const filtered = filterEventProductsForBar(eventProducts, barProducts, 'bar-a');
    expect(filtered.map((ep) => ep.product_id)).toEqual(['p1', 'p2']);
  });

  it('returns all products when bar has no menu rows', () => {
    const filtered = filterEventProductsForBar(eventProducts, barProducts, 'bar-empty');
    expect(filtered).toHaveLength(4);
  });

  it('returns empty when no bar selected', () => {
    expect(filterEventProductsForBar(eventProducts, barProducts, null)).toEqual([]);
  });
});

describe('hasBarMenu', () => {
  it('detects configured menus', () => {
    expect(hasBarMenu(barProducts, 'bar-a')).toBe(true);
    expect(hasBarMenu(barProducts, 'bar-empty')).toBe(false);
  });
});
