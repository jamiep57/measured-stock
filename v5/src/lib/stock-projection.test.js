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
