import { describe, it, expect } from 'vitest';
import {
  closingSorPct,
  maxReturnable,
  closeCountTotal,
  carriedOver,
  returnAmountToForm,
  closingCountToForm,
  closingPatchFromDraft,
  exceedsMaxReturnable,
  buildClosingRow,
  filterClosingRows,
  sortClosingList,
  groupClosingByCategory,
} from './closing-stock.js';

const product = {
  id: 'p1',
  name: 'Test Lager',
  case_size: '24×330ml',
  units_per_case: 24,
  stock_unit: 'case',
  category: { id: 'c1', name: 'Beer' },
  product_suppliers: [{
    supplier_id: 's1',
    is_preferred: true,
    case_price: 24,
    supplier: { name: 'Acme' },
  }],
};

describe('closingSorPct', () => {
  it('uses event override when set', () => {
    expect(closingSorPct(
      { sor_pct_override: 15, product },
      [{ id: 's1', default_sor_pct: 10 }],
    )).toBe(15);
  });

  it('falls back to supplier default', () => {
    expect(closingSorPct(
      { product },
      [{ id: 's1', default_sor_pct: 10 }],
    )).toBe(10);
  });
});

describe('maxReturnable', () => {
  it('returns null without SOR', () => {
    expect(maxReturnable(100, 0)).toBeNull();
  });

  it('returns null when invoice is 0 so return can be overwritten', () => {
    expect(maxReturnable(0, 10)).toBeNull();
  });

  it('applies SOR percent', () => {
    expect(maxReturnable(100, 10)).toBe(10);
    expect(maxReturnable(80, 12.5)).toBe(10);
  });
});

describe('closeCountTotal', () => {
  it('adds singles as fraction of case', () => {
    expect(closeCountTotal(product, 2, 12, [])).toBe(2.5);
  });
});

describe('carriedOver', () => {
  it('never goes negative', () => {
    expect(carriedOver(10, 12)).toBe(0);
    expect(carriedOver(10, 3)).toBe(7);
  });
});

describe('returnAmountToForm', () => {
  it('puts total in primary column', () => {
    expect(returnAmountToForm(5.5)).toEqual({ cases: '5.5', singles: '' });
    expect(returnAmountToForm(0)).toEqual({ cases: '', singles: '' });
  });
});

describe('closingCountToForm', () => {
  it('reads split fields', () => {
    expect(closingCountToForm({ closing_cases: 3, closing_singles: 2 }))
      .toEqual({ cases: '3', singles: '2' });
  });

  it('falls back to close_count', () => {
    expect(closingCountToForm({ close_count: 8 }))
      .toEqual({ cases: '8', singles: '0' });
  });

  it('keeps explicit zeros distinct from blank', () => {
    expect(closingCountToForm({})).toEqual({ cases: '', singles: '' });
    expect(closingCountToForm({ closing_cases: 0, closing_singles: 0 }))
      .toEqual({ cases: '0', singles: '0' });
    expect(closingCountToForm({ closing_cases: 0, closing_singles: 2 }))
      .toEqual({ cases: '0', singles: '2' });
  });
});

describe('closingPatchFromDraft', () => {
  it('builds upsert patch', () => {
    expect(closingPatchFromDraft(product, {
      closingCases: 4,
      closingSingles: 0,
      returnCases: 1,
      returnSingles: 0,
    }, [])).toEqual({
      closing_cases: 4,
      closing_singles: 0,
      close_count: 4,
      return_amount: 1,
      carried_over: 3,
      capped: [],
    });
  });

  it('soft-caps return to max returnable and closing count', () => {
    expect(closingPatchFromDraft(product, {
      closingCases: 2,
      closingSingles: 0,
      returnCases: 9,
      returnSingles: 0,
    }, [], { maxReturnable: 5 })).toEqual({
      closing_cases: 2,
      closing_singles: 0,
      close_count: 2,
      return_amount: 2,
      carried_over: 0,
      capped: ['max returnable', 'closing count'],
    });
  });

  it('does not soft-cap to max returnable when invoice/max is 0', () => {
    expect(closingPatchFromDraft(product, {
      closingCases: 4,
      closingSingles: 0,
      returnCases: 3,
      returnSingles: 0,
    }, [], { maxReturnable: 0 })).toEqual({
      closing_cases: 4,
      closing_singles: 0,
      close_count: 4,
      return_amount: 3,
      carried_over: 1,
      capped: [],
    });
  });

  it('allows return above max returnable when explicitly allowed', () => {
    expect(closingPatchFromDraft(product, {
      closingCases: 12,
      closingSingles: 0,
      returnCases: 9,
      returnSingles: 0,
    }, [], { maxReturnable: 5, allowOverMaxReturnable: true })).toEqual({
      closing_cases: 12,
      closing_singles: 0,
      close_count: 12,
      return_amount: 9,
      carried_over: 3,
      capped: [],
    });
  });

  it('still hard-caps to closing count when over-max is allowed', () => {
    expect(closingPatchFromDraft(product, {
      closingCases: 2,
      closingSingles: 0,
      returnCases: 9,
      returnSingles: 0,
    }, [], { maxReturnable: 5, allowOverMaxReturnable: true })).toEqual({
      closing_cases: 2,
      closing_singles: 0,
      close_count: 2,
      return_amount: 2,
      carried_over: 0,
      capped: ['closing count'],
    });
  });
});

describe('exceedsMaxReturnable', () => {
  it('is true only for a positive max that is exceeded', () => {
    expect(exceedsMaxReturnable(6, 5)).toBe(true);
    expect(exceedsMaxReturnable(5, 5)).toBe(false);
    expect(exceedsMaxReturnable(6, 0)).toBe(false);
    expect(exceedsMaxReturnable(6, null)).toBe(false);
  });
});

describe('buildClosingRow', () => {
  it('computes SOR, max returnable, and carried over', () => {
    const row = buildClosingRow({
      ep: { product_id: 'p1', product, invoice_qty: 100 },
      closingRow: { closing_cases: 20, closing_singles: 0, return_amount: 5 },
      suppliers: [{ id: 's1', name: 'Acme', default_sor_pct: 10 }],
      caseSizes: [],
    });
    expect(row.sor).toBe(10);
    expect(row.maxReturnable).toBe(10);
    expect(row.hasClosing).toBe(true);
    expect(row.closeCount).toBe(20);
    expect(row.returnAmount).toBe(5);
    expect(row.carriedOver).toBe(15);
    expect(row.supplierName).toBe('Acme');
  });

  it('treats missing closing row as blank, not zero', () => {
    const blank = buildClosingRow({
      ep: { product_id: 'p1', product, invoice_qty: 10 },
      closingRow: {},
      suppliers: [{ id: 's1', name: 'Acme', default_sor_pct: 10 }],
      caseSizes: [],
    });
    expect(blank.hasClosing).toBe(false);
    expect(blank.closingCases).toBe(0);
    expect(blank.closeCount).toBe(0);

    const zero = buildClosingRow({
      ep: { product_id: 'p1', product, invoice_qty: 10 },
      closingRow: { closing_cases: 0, closing_singles: 0, close_count: 0 },
      suppliers: [{ id: 's1', name: 'Acme', default_sor_pct: 10 }],
      caseSizes: [],
    });
    expect(zero.hasClosing).toBe(true);
    expect(zero.closingCases).toBe(0);
    expect(zero.closeCount).toBe(0);
  });

  it('treats draft zeros as counted before the row is saved', () => {
    const drafted = buildClosingRow({
      ep: { product_id: 'p1', product, invoice_qty: 10 },
      closingRow: {},
      suppliers: [{ id: 's1', name: 'Acme', default_sor_pct: 10 }],
      caseSizes: [],
      draft: { closingCases: 0, closingSingles: 0 },
    });
    expect(drafted.hasClosing).toBe(true);
    expect(drafted.closingCases).toBe(0);
    expect(drafted.closeCount).toBe(0);
  });

  it('prefers supplier_return_lines over closing_stock.return_amount', () => {
    const row = buildClosingRow({
      ep: { product_id: 'p1', product, invoice_qty: 100 },
      closingRow: { closing_cases: 20, closing_singles: 0, return_amount: 0 },
      suppliers: [{ id: 's1', name: 'Acme', default_sor_pct: 10 }],
      caseSizes: [],
      supplierReturns: [{ product_id: 'p1', qty: 7, singles: 0 }],
    });
    expect(row.returnAmount).toBe(7);
    expect(row.returnCases).toBe(7);
    expect(row.carriedOver).toBe(13);
  });
});

describe('filterClosingRows / sortClosingList', () => {
  const rows = [
    {
      pid: 'a', p: { name: 'Alpha' }, category: 'Beer', supplierId: 's1', supplierName: 'Acme',
      hasClosing: false, invoiceQty: 10, closeCount: 0, returnAmount: 0, carriedOver: 0, sor: 10, maxReturnable: 1,
    },
    {
      pid: 'b', p: { name: 'Bravo' }, category: 'Spirits', supplierId: 's2', supplierName: 'Beta Co',
      hasClosing: true, invoiceQty: 50, closeCount: 20, returnAmount: 8, carriedOver: 12, sor: 20, maxReturnable: 10,
    },
    {
      pid: 'c', p: { name: 'Charlie' }, category: 'Beer', supplierId: 's1', supplierName: 'Acme',
      hasClosing: true, invoiceQty: 30, closeCount: 5, returnAmount: 0, carriedOver: 5, sor: 5, maxReturnable: 1.5,
    },
  ];

  it('filters by status', () => {
    expect(filterClosingRows(rows, { statusFilter: 'uncounted' }).map((r) => r.pid)).toEqual(['a']);
    expect(filterClosingRows(rows, { statusFilter: 'counted' }).map((r) => r.pid)).toEqual(['b', 'c']);
    expect(filterClosingRows(rows, { statusFilter: 'returning' }).map((r) => r.pid)).toEqual(['b']);
    expect(filterClosingRows(rows, { statusFilter: 'carried' }).map((r) => r.pid)).toEqual(['b', 'c']);
    expect(filterClosingRows(rows, { statusFilter: 'over_sor' }).map((r) => r.pid)).toEqual([]);
  });

  it('filters over SOR returns', () => {
    const over = [{ ...rows[1], returnAmount: 12, maxReturnable: 10 }];
    expect(filterClosingRows(over, { statusFilter: 'over_sor' })).toHaveLength(1);
  });

  it('filters by category and supplier', () => {
    expect(filterClosingRows(rows, { categoryFilter: 'Beer' }).map((r) => r.pid)).toEqual(['a', 'c']);
    expect(filterClosingRows(rows, { supplierFilter: 's2' }).map((r) => r.pid)).toEqual(['b']);
  });

  it('sorts by numeric keys then name', () => {
    expect(sortClosingList(rows, 'invoice').map((r) => r.pid)).toEqual(['b', 'c', 'a']);
    expect(sortClosingList(rows, 'return').map((r) => r.pid)).toEqual(['b', 'a', 'c']);
    expect(sortClosingList(rows, 'name').map((r) => r.pid)).toEqual(['a', 'b', 'c']);
  });

  it('groups and sorts within categories', () => {
    const grouped = groupClosingByCategory(rows, 'closing');
    expect(Object.keys(grouped).sort()).toEqual(['Beer', 'Spirits']);
    expect(grouped.Beer.map((r) => r.pid)).toEqual(['c', 'a']);
  });
});
