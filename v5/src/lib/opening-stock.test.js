import { describe, it, expect } from 'vitest';
import {
  epOpeningStock,
  epOpeningFromSources,
  epDeliveredQty,
  epDamagedQty,
  openingByProduct,
  countedInFromDeliveries,
} from './opening-stock.js';

const product = {
  id: 'p1',
  name: 'Test Lager',
  units_per_case: 24,
  case_size: '24×330ml',
};

describe('epOpeningFromSources', () => {
  it('matches epOpeningStock when no live maps', () => {
    const ep = { product_id: 'p1', product, delivered_qty: 100, damaged_qty: 5 };
    expect(epOpeningFromSources(ep)).toBe(95);
    expect(epOpeningStock(ep)).toBe(95);
  });

  it('prefers live delivery sums over stale delivered_qty', () => {
    const ep = { product_id: 'p1', product, delivered_qty: 6, damaged_qty: 0 };
    const countedIn = { p1: 100 };
    expect(epDeliveredQty(ep, countedIn)).toBe(100);
    expect(epOpeningFromSources(ep, countedIn)).toBe(100);
    expect(epOpeningStock(ep)).toBe(6);
  });

  it('prefers live damaged map', () => {
    const ep = { product_id: 'p1', product, delivered_qty: 100, damaged_qty: 0 };
    expect(epDamagedQty(ep, { p1: 3 })).toBe(3);
    expect(epOpeningFromSources(ep, { p1: 100 }, { p1: 3 })).toBe(97);
  });

  it('falls back to qty_ordered when delivered unset', () => {
    const ep = { product_id: 'p1', product, qty_ordered: 40, damaged_qty: 2 };
    expect(epOpeningFromSources(ep)).toBe(38);
  });
});

describe('openingByProduct', () => {
  it('builds map using live sources when provided', () => {
    const eps = [
      { product_id: 'p1', product, delivered_qty: 6, damaged_qty: 0 },
    ];
    const map = openingByProduct(eps, { p1: 50 }, { p1: 2 });
    expect(map.p1).toBe(48);
  });
});

describe('countedInFromDeliveries', () => {
  it('sums delivery lines', () => {
    const eps = [{ product_id: 'p1', product }];
    const map = countedInFromDeliveries(
      [{ lines: [{ product_id: 'p1', qty: 10 }, { product_id: 'p1', qty: 5 }] }],
      eps,
      [],
    );
    expect(map.p1).toBe(15);
  });
});
