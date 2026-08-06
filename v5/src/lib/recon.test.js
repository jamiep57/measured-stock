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
    expect(row.hasClosing).toBe(true);
    expect(row.hasInvoice).toBe(false);
    expect(row.pluCharge).toBe(row.plu * row.rowPrice);
    expect(row.multiOfferWarn).toBe(false);
  });

  it('prefers summed delivery lines over stale delivered_qty', () => {
    const ep = {
      product_id: 'p1',
      product,
      delivered_qty: 6,
      qty_ordered: 6,
      damaged_qty: 0,
    };
    const row = buildReconRow({
      ep,
      closingRow: { closing_cases: 12, closing_singles: 0 },
      pluByPid: { p1: 11.97 },
      suppliers: [{ id: 's1', name: 'Acme' }],
      caseSizes: [],
      wastageMap: {},
      transferMap: {},
      supplierReturns: [],
      event: { id: 'e1', event_products: [ep] },
      countedIn: { p1: 24 },
    });
    expect(row.delivered).toBe(24);
    expect(row.consumption).toBe(12);
  });

  it('warns when multiple supplier offers differ', () => {
    const multi = {
      ...product,
      product_suppliers: [
        { supplier_id: 's1', is_preferred: true, case_price: 24, purchase_case_size_id: 'a', supplier: { name: 'Acme' } },
        { supplier_id: 's2', case_price: 30, purchase_case_size_id: 'b', supplier: { name: 'Beta' } },
      ],
    };
    const ep = { product_id: 'p1', product: multi, delivered_qty: 10 };
    const row = buildReconRow({
      ep,
      closingRow: {},
      pluByPid: {},
      suppliers: [{ id: 's1', name: 'Acme' }, { id: 's2', name: 'Beta' }],
      caseSizes: [],
      wastageMap: {},
      transferMap: {},
      supplierReturns: [],
      event: { id: 'e1', event_products: [ep] },
    });
    expect(row.multiOfferWarn).toBe(true);
  });

  it('tracks invoice draft and explicit zero closing', () => {
    const ep = {
      product_id: 'p1',
      product,
      delivered_qty: 10,
      invoice_qty: 12,
    };
    const row = buildReconRow({
      ep,
      closingRow: { closing_cases: 0, closing_singles: 0 },
      pluByPid: {},
      suppliers: [{ id: 's1', name: 'Acme' }],
      caseSizes: [],
      wastageMap: {},
      transferMap: {},
      supplierReturns: [],
      event: { id: 'e1', event_products: [ep] },
      draft: { invoiceSet: true, invoiced: 9, closingCases: 0, closingSingles: 0 },
    });
    expect(row.hasInvoice).toBe(true);
    expect(row.invoiced).toBe(9);
    expect(row.hasClosing).toBe(true);
    expect(row.closingCases).toBe(0);
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
