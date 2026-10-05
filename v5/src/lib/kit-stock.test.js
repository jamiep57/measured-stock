import { describe, it, expect } from 'vitest';
import {
  eventQtySign,
  affectsWarehouse,
  warehouseQtyDelta,
  balancesByProduct,
  validateEventStock,
  normalizeKitSource,
  isOwnSource,
  isOwnShort,
  isHireUncovered,
  isLineShort,
  packListStats,
  contentsByContainer,
  scaledContainerContents,
} from './kit-stock.js';

describe('kit-stock', () => {
  it('signs event qty by movement type', () => {
    expect(eventQtySign('warehouse_in')).toBe(1);
    expect(eventQtySign('hire_in')).toBe(1);
    expect(eventQtySign('warehouse_out')).toBe(-1);
    expect(eventQtySign('hire_return')).toBe(-1);
    expect(eventQtySign('write_off')).toBe(-1);
  });

  it('computes warehouse deltas', () => {
    expect(affectsWarehouse('warehouse_in')).toBe(true);
    expect(affectsWarehouse('hire_in')).toBe(false);
    expect(warehouseQtyDelta('warehouse_in', 5)).toBe(-5);
    expect(warehouseQtyDelta('warehouse_out', 5)).toBe(5);
    expect(warehouseQtyDelta('hire_in', 5)).toBe(0);
  });

  it('aggregates owned vs hired balances', () => {
    const map = balancesByProduct([
      {
        movement_type: 'warehouse_in',
        lines: [{ product_id: 'a', qty: 10 }],
      },
      {
        movement_type: 'hire_in',
        lines: [{ product_id: 'a', qty: 3 }],
      },
      {
        movement_type: 'warehouse_out',
        lines: [{ product_id: 'a', qty: 2 }],
      },
      {
        movement_type: 'hire_return',
        lines: [{ product_id: 'a', qty: 1 }],
      },
    ]);
    expect(map.get('a')).toEqual({ onHand: 10, owned: 8, hired: 2 });
  });

  it('rejects outbound when event stock insufficient', () => {
    const bal = balancesByProduct([
      { movement_type: 'warehouse_in', lines: [{ product_id: 'a', qty: 2 }] },
    ]);
    expect(validateEventStock(bal, 'warehouse_out', [{ product_id: 'a', qty: 2 }]).ok).toBe(true);
    const bad = validateEventStock(bal, 'warehouse_out', [{ product_id: 'a', qty: 5 }]);
    expect(bad.ok).toBe(false);
    expect(bad.available).toBe(2);
  });

  it('normalizes planned source', () => {
    expect(normalizeKitSource('own')).toBe('own');
    expect(normalizeKitSource('hire')).toBe('hire');
    expect(normalizeKitSource(null)).toBe('own');
    expect(isOwnSource('hire')).toBe(false);
    expect(isOwnSource('own')).toBe(true);
  });

  it('flags own short and hire uncovered lines', () => {
    expect(isOwnShort({ source: 'own', qty_planned: 5 }, 3)).toBe(true);
    expect(isOwnShort({ source: 'own', qty_planned: 5 }, 5)).toBe(false);
    expect(isOwnShort({ source: 'hire', qty_planned: 5 }, 0)).toBe(false);

    expect(isHireUncovered({ source: 'hire', qty_planned: 4 }, { hired: 1 })).toBe(true);
    expect(isHireUncovered({ source: 'hire', qty_planned: 4 }, { hired: 4 })).toBe(false);
    expect(isHireUncovered({ source: 'own', qty_planned: 4 }, { hired: 0 })).toBe(false);

    expect(isLineShort({ source: 'own', qty_planned: 2 }, 1, null)).toBe(true);
    expect(isLineShort({ source: 'hire', qty_planned: 2 }, 10, { hired: 0 })).toBe(true);
  });

  it('aggregates pack list stats', () => {
    const avail = new Map([['a', 2], ['b', 0], ['c', 5]]);
    const bal = new Map([['b', { owned: 0, hired: 1, onHand: 1 }]]);
    const stats = packListStats(
      [
        { product_id: 'a', source: 'own', qty_planned: 5 },
        { product_id: 'b', source: 'hire', qty_planned: 3 },
        { product_id: 'c', source: 'own', qty_planned: 1 },
      ],
      avail,
      bal,
    );
    expect(stats).toEqual({ lines: 3, own: 2, hire: 1, short: 2 });
  });

  it('groups and scales container contents', () => {
    const map = contentsByContainer([
      {
        container_product_id: 'box',
        child_product_id: 'cups',
        qty: 50,
        sort_order: 1,
        child: { name: 'Plastic cups' },
      },
      {
        container_product_id: 'box',
        child_product_id: 'straws',
        qty: 100,
        sort_order: 0,
        child: { name: 'Straws' },
      },
      {
        container_product_id: 'other',
        child_product_id: 'x',
        qty: 1,
        child: { name: 'X' },
      },
    ]);
    expect(map.get('box')?.map((c) => c.child_product_id)).toEqual(['straws', 'cups']);
    expect(scaledContainerContents(map.get('box'), 2)).toEqual([
      expect.objectContaining({ child_product_id: 'straws', qty: 200 }),
      expect.objectContaining({ child_product_id: 'cups', qty: 100 }),
    ]);
    expect(scaledContainerContents(map.get('box'), 0)[0].qty).toBe(100);
  });
});
