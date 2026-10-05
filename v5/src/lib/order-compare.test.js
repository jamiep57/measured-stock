import { describe, it, expect } from 'vitest';
import {
  compareOrders,
  compareStatus,
  compareSummary,
  draftOrdersFromShortfalls,
  orderLinesTotal,
  orderedByProduct,
  plannedCases,
  plannedProductCases,
  servesPerCase,
} from './order-compare.js';

const keg = { id: 'keg', units_per_case: 1, product_suppliers: [{ supplier_id: 's1', case_price: 95, is_preferred: true }] };
const cans = { id: 'cans', units_per_case: 24, supplier_id: 's2' };
const loose = { id: 'loose', units_per_case: 6 };

describe('servesPerCase', () => {
  it('uses the menu Serves figure as the serves in one case', () => {
    expect(servesPerCase(24, cans)).toBe(24);
    expect(servesPerCase(88, keg)).toBe(88);
    expect(servesPerCase(null, keg)).toBeNull();
  });
});

describe('plannedCases', () => {
  it('rounds projected serves up to whole cases', () => {
    expect(plannedCases({}, { projectedServes: 1000, servesPerUnit: 88 }, keg)).toEqual({ cases: 12, source: 'projection' });
  });
  it('applies the order buffer', () => {
    expect(plannedCases({}, { projectedServes: 880, servesPerUnit: 88 }, keg, [], 10).cases).toBe(11);
  });
  it('does not round an exact multiple up', () => {
    expect(plannedCases({}, { projectedServes: 240, servesPerUnit: 24 }, cans).cases).toBe(10);
  });
  it('override wins, even for items taken off the menu', () => {
    expect(plannedCases({ planned_qty_override: 3, included: false }, {}, keg)).toEqual({ cases: 3, source: 'override' });
  });
  it('nothing planned without serves or when off the menu', () => {
    expect(plannedCases({}, { projectedServes: null, servesPerUnit: 88 }, keg).cases).toBeNull();
    expect(plannedCases({ included: false }, { projectedServes: 100, servesPerUnit: 88 }, keg).cases).toBeNull();
  });

  it('adds pint and half into one keg order', () => {
    const items = [
      { included: true, projected_serves: 80, portion: 1, serves_per_unit: 88 },
      { included: true, projected_serves: 40, portion: 0.5, serves_per_unit: 88 },
    ];
    expect(plannedProductCases(items, 0, keg).cases).toBe(2);
    expect(plannedProductCases(items, 88, keg).cases).toBe(3);
    expect(plannedProductCases([{ ...items[0], planned_qty_override: 5 }], 0, keg)).toEqual({ cases: 5, source: 'override' });
  });
});

describe('orderedByProduct', () => {
  it('buckets confirmed vs pending and ignores cancelled orders', () => {
    const map = orderedByProduct([
      { reference: 'PO-1', status: 'confirmed', purchase_order_lines: [{ product_id: 'keg', qty_cases: 10 }] },
      { reference: 'PO-2', status: 'sent', purchase_order_lines: [{ product_id: 'keg', qty_cases: 2 }] },
      { reference: 'PO-3', status: 'cancelled', purchase_order_lines: [{ product_id: 'keg', qty_cases: 50 }] },
    ]);
    expect(map.get('keg')).toEqual({ confirmed: 10, pending: 2, refs: ['PO-1', 'PO-2'] });
  });
});

describe('compareStatus', () => {
  it('classifies shortages and over-orders', () => {
    expect(compareStatus(10, 8)).toBe('short');
    expect(compareStatus(10, 12)).toBe('over');
    expect(compareStatus(10, 10)).toBe('ok');
    expect(compareStatus(null, 4)).toBe('unplanned');
    expect(compareStatus(null, 0)).toBe('none');
  });
});

describe('compareOrders', () => {
  const ordered = orderedByProduct([
    { reference: 'PO-1', status: 'confirmed', purchase_order_lines: [{ product_id: 'keg', qty_cases: 10 }] },
    { reference: 'PO-2', status: 'draft', purchase_order_lines: [{ product_id: 'keg', qty_cases: 1 }] },
  ]);
  const rows = compareOrders({
    productIds: ['keg', 'cans', 'loose'],
    planned: new Map([['keg', 12], ['cans', 5], ['loose', null]]),
    ordered,
    eventProducts: [
      { product_id: 'keg', qty_ordered: 0 },
      { product_id: 'cans', qty_ordered: 6, delivered_qty: 6 },
      { product_id: 'loose', qty_ordered: 2 },
    ],
    countedIn: { keg: 4 },
  });
  const byId = Object.fromEntries(rows.map((r) => [r.productId, r]));

  it('uses confirmed orders and reports the shortage', () => {
    expect(byId.keg).toMatchObject({ confirmed: 10, pending: 1, gap: -2, status: 'short', confirmedSource: 'orders' });
    expect(byId.keg.shortfallAfterPending).toBe(1);
    expect(byId.keg.undelivered).toBe(6);
  });
  it('falls back to manual qty_ordered when a product has no orders', () => {
    expect(byId.cans).toMatchObject({ confirmed: 6, confirmedSource: 'manual', status: 'over', gap: 1, countedIn: 6, undelivered: 0 });
  });
  it('flags ordered stock with no plan', () => {
    expect(byId.loose.status).toBe('unplanned');
    expect(byId.loose.gap).toBeNull();
  });
  it('summarises', () => {
    const s = compareSummary(rows);
    expect(s).toMatchObject({ planned: 17, confirmed: 18, pending: 1, short: 1, over: 1, unplanned: 1 });
  });
});

describe('draftOrdersFromShortfalls', () => {
  it('groups remaining shortfalls by preferred supplier', () => {
    const rows = [
      { productId: 'keg', shortfallAfterPending: 2.2 },
      { productId: 'cans', shortfallAfterPending: 3 },
      { productId: 'loose', shortfallAfterPending: 1 },
      { productId: 'keg2', shortfallAfterPending: 0 },
    ];
    const byId = new Map([['keg', keg], ['cans', cans], ['loose', loose]]);
    const { orders, unassigned } = draftOrdersFromShortfalls(rows, byId);
    expect(orders).toEqual([
      { supplierId: 's1', lines: [{ product_id: 'keg', qty_cases: 3, case_price: 95 }] },
      { supplierId: 's2', lines: [{ product_id: 'cans', qty_cases: 3, case_price: null }] },
    ]);
    expect(unassigned).toEqual([{ productId: 'loose', qty: 1 }]);
  });
});

describe('orderLinesTotal', () => {
  it('totals priced lines only', () => {
    expect(orderLinesTotal([
      { qty_cases: 3, case_price: 95 },
      { qty_cases: 2, case_price: null },
    ])).toEqual({ total: 285, priced: 1, lines: 2 });
  });
});
