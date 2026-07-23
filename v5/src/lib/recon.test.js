import { describe, it, expect } from 'vitest';
import { buildReconRow, closingInvoiceQty, varianceClass } from './recon.js';

describe('buildReconRow', () => {
  const product = {
    id: 'p1',
    name: 'Test Lager',
    case_size: '24×330ml',
    units_per_case: 24,
    case_price: 24,
    category: { id: 'c1', name: 'Beer' },
    product_suppliers: [{ supplier_id: 's1', is_preferred: true, case_price: 24, supplier: { name: 'Acme' } }],
  };

  it('computes consumption from delivered minus closing', () => {
    const ep = {
      product_id: 'p1',
      product,
      delivered_qty: 100,
      qty_ordered: 100,
      damaged_qty: 0,
    };
    const row = buildReconRow({
      ep,
      closingRow: { closing_cases: 20, closing_singles: 0 },
      pluByPid: { p1: 75 },
      suppliers: [{ id: 's1', name: 'Acme' }],
      caseSizes: [],
      wastageMap: {},
      transferMap: {},
      supplierReturns: [],
      event: { id: 'e1', event_products: [ep] },
    });
    expect(row.consumption).toBe(80);
    expect(row.plu).toBe(75);
    expect(row.variance).toBe(-5);
    expect(row.supplierName).toBe('Acme');
  });
});

describe('closingInvoiceQty', () => {
  it('prefers invoice_qty over ordered', () => {
    expect(closingInvoiceQty({ invoice_qty: 12, qty_ordered: 10 })).toBe(12);
    expect(closingInvoiceQty({ qty_ordered: 10 })).toBe(10);
  });
});

describe('varianceClass', () => {
  it('flags large variance as bad', () => {
    expect(varianceClass(10, 20, 10)).toBe('recon-var-bad');
    expect(varianceClass(10, 10.5, 0.5)).toBe('recon-var-good');
  });
});
