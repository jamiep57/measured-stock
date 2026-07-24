import { describe, it, expect } from 'vitest';
import { computeStockProjection, sortProjectionItems, projectionStatus } from './stock-projection.js';

describe('computeStockProjection', () => {
  const event = {
    target_revenue: 100000,
    event_products: [{
      product_id: 'p1',
      delivered_qty: 10,
      damaged_qty: 0,
      product: { id: 'p1', name: 'Gin', case_size: '6x70cl' },
    }],
  };

  const recipes = [{
    till_item: 'G&T',
    till_variation: 'Regular',
    ingredients: [{ product_name: 'Gin', qty: 0.05, position: 0 }],
  }];

  const products = [{ id: 'p1', name: 'Gin', case_size: '6x70cl' }];

  it('computes run-out from mapped till sales', () => {
    const result = computeStockProjection({
      event,
      tillRows: [{
        name: 'G&T',
        variation: 'Regular',
        items_sold: 100,
        net_sales: 5000,
      }],
      recipes,
      products,
      caseSizes: [],
    });

    expect(result.baselineNet).toBe(5000);
    expect(result.mappedNet).toBe(5000);
    expect(result.factor).toBe(20);
    expect(result.items.length).toBe(1);
    expect(result.items[0].inEvent).toBe(true);
    expect(result.items[0].projectedCases).toBeGreaterThan(0);
    expect(result.items[0].servingsSold).toBe(100);
    expect(result.items[0].delivered).toBe(10);
    expect(result.items[0].available).toBe(10);
  });

  it('flags items that run out before target', () => {
    const result = computeStockProjection({
      event,
      tillRows: [{
        name: 'G&T',
        variation: 'Regular',
        items_sold: 1000,
        net_sales: 50000,
      }],
      recipes,
      products,
      caseSizes: [],
    });

    const item = result.items[0];
    const st = projectionStatus(item, event.target_revenue);
    expect(st.tone).toBe('danger');
    expect(item.runOutRevenue).toBeLessThan(event.target_revenue);
  });

  it('matches multi-pack products by recipe qty and uses that SKU stock', () => {
    const multiEvent = {
      target_revenue: 125000,
      event_products: [
        {
          product_id: 'w12',
          delivered_qty: 662,
          damaged_qty: 0,
          product: { id: 'w12', name: 'Carton Water', case_size: '12×330ml', units_per_case: 12 },
        },
        {
          product_id: 'w24',
          delivered_qty: 47.3,
          damaged_qty: 0,
          product: { id: 'w24', name: 'Carton Water', case_size: '24×330ml', units_per_case: 24 },
        },
      ],
    };
    const result = computeStockProjection({
      event: multiEvent,
      tillRows: [
        {
          name: 'Still Water',
          variation: 'Regular',
          items_sold: 97,
          net_sales: 262.86,
        },
        // Other mapped sales so total baseline matches a real event mix.
        {
          name: 'G&T',
          variation: 'Regular',
          items_sold: 100,
          net_sales: 17271.01,
        },
      ],
      recipes: [
        {
          till_item: 'Still Water',
          till_variation: 'Regular',
          ingredients: [{ product_name: 'Carton Water', qty: 1 / 12, position: 0 }],
        },
        {
          till_item: 'G&T',
          till_variation: 'Regular',
          ingredients: [{ product_name: 'Gin', qty: 0.05, position: 0 }],
        },
      ],
      products: [
        { id: 'w24', name: 'Carton Water', case_size: '24×330ml', units_per_case: 24 },
        { id: 'w12', name: 'Carton Water', case_size: '12×330ml', units_per_case: 12 },
        { id: 'p1', name: 'Gin', case_size: '6x70cl', units_per_case: 6 },
      ],
      caseSizes: [],
    });

    const item = result.items.find((it) => it.name.startsWith('Carton Water'));
    expect(item).toBeTruthy();
    expect(item.name).toBe('Carton Water — 12×330ml');
    expect(item.servingsSold).toBe(97);
    expect(item.delivered).toBe(662);
    expect(item.available).toBe(662);
    expect(item.projectedCases).toBeCloseTo((97 * (1 / 12)) * (125000 / 17533.87), 1);
    expect(projectionStatus(item, multiEvent.target_revenue).label).toBe('Lasts');
  });

  it('sums delivered across multiple delivery lines when deliveries are provided', () => {
    const result = computeStockProjection({
      event: {
        target_revenue: 100000,
        event_products: [{
          product_id: 'keg1',
          delivered_qty: 18, // stale single-delivery writeback
          damaged_qty: 0,
          product: { id: 'keg1', name: 'Utopian Lager', case_size: '50L Keg' },
        }],
      },
      tillRows: [{
        name: 'Lager',
        variation: 'Pint',
        items_sold: 10,
        net_sales: 50,
      }],
      recipes: [{
        till_item: 'Lager',
        till_variation: 'Pint',
        ingredients: [{ product_name: 'Utopian Lager', qty: 1, position: 0 }],
      }],
      products: [{ id: 'keg1', name: 'Utopian Lager', case_size: '50L Keg' }],
      caseSizes: [],
      deliveries: [
        { lines: [{ product_id: 'keg1', qty: 12, singles: 0, damaged_qty: 0 }] },
        { lines: [{ product_id: 'keg1', qty: 18, singles: 0, damaged_qty: 0 }] },
      ],
    });

    expect(result.items[0].delivered).toBe(30);
    expect(result.items[0].available).toBe(30);
    expect(result.items[0].wastage).toBe(0);
  });

  it('subtracts wastage from available stock and exposes it', () => {
    const result = computeStockProjection({
      event: {
        target_revenue: 100000,
        event_products: [{
          product_id: 'keg1',
          delivered_qty: 30,
          damaged_qty: 0,
          product: { id: 'keg1', name: 'Utopian Lager', case_size: '50L Keg' },
        }],
      },
      tillRows: [{
        name: 'Lager',
        variation: 'Pint',
        items_sold: 10,
        net_sales: 50,
      }],
      recipes: [{
        till_item: 'Lager',
        till_variation: 'Pint',
        ingredients: [{ product_name: 'Utopian Lager', qty: 1, position: 0 }],
      }],
      products: [{ id: 'keg1', name: 'Utopian Lager', case_size: '50L Keg' }],
      caseSizes: [],
      deliveries: [
        { lines: [{ product_id: 'keg1', qty: 30, singles: 0, damaged_qty: 0 }] },
      ],
      wastageBatches: [
        { lines: [{ product_id: 'keg1', qty: 2, singles: 0 }] },
      ],
    });

    expect(result.items[0].delivered).toBe(30);
    expect(result.items[0].wastage).toBe(2);
    expect(result.items[0].available).toBe(28);
  });
});

describe('sortProjectionItems', () => {
  it('sorts by run-out revenue ascending by default', () => {
    const items = [
      { name: 'B', inEvent: true, runOutRevenue: 5000 },
      { name: 'A', inEvent: true, runOutRevenue: 1000 },
    ];
    const sorted = sortProjectionItems(items, null, 1, 10000);
    expect(sorted[0].name).toBe('A');
  });
});
