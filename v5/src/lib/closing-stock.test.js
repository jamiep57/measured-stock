import { describe, it, expect } from 'vitest';
import {
  closingSorPct,
  maxReturnable,
  closeCountTotal,
  carriedOver,
  returnAmountToForm,
  closingCountToForm,
  closingPatchFromDraft,
  buildClosingRow,
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
      .toEqual({ cases: '8', singles: '' });
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
    });
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
    expect(row.closeCount).toBe(20);
    expect(row.returnAmount).toBe(5);
    expect(row.carriedOver).toBe(15);
    expect(row.supplierName).toBe('Acme');
  });
});
