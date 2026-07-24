import { describe, it, expect } from 'vitest';
import {
  deliveryCasePrice,
  deliveryUnitPrice,
  costDeliveryLine,
  buildSupplierDeliveryCostReport,
  supplierDeliveryCostCsv,
} from './supplier-delivery-cost.js';

const lager = {
  id: 'p1',
  name: 'Test Lager',
  case_size: '24×330ml',
  units_per_case: 24,
  case_price: 20,
  product_suppliers: [
    { supplier_id: 's1', is_preferred: true, case_price: 24 },
    { supplier_id: 's2', is_preferred: false, case_price: 22 },
  ],
};

const spirit = {
  id: 'p2',
  name: 'Gin',
  stock_unit: 'bottle',
  units_per_case: 6,
  unit_price: 18,
  case_price: 100,
  product_suppliers: [
    { supplier_id: 's1', is_preferred: true, unit_price: 16, case_price: 90 },
  ],
};

describe('deliveryCasePrice', () => {
  it('uses event override first', () => {
    expect(deliveryCasePrice({ order_price_override: 30 }, lager, 's1')).toBe(30);
  });

  it('uses offer for the delivery supplier', () => {
    expect(deliveryCasePrice({}, lager, 's2')).toBe(22);
  });

  it('falls back to preferred offer then product price', () => {
    expect(deliveryCasePrice({}, lager, 's-missing')).toBe(24);
    expect(deliveryCasePrice({}, { ...lager, product_suppliers: [] }, null)).toBe(20);
  });
});

describe('deliveryUnitPrice', () => {
  it('uses unit override and offer unit price', () => {
    expect(deliveryUnitPrice({ order_unit_price_override: 12 }, spirit, 's1')).toBe(12);
    expect(deliveryUnitPrice({}, spirit, 's1')).toBe(16);
  });
});

describe('costDeliveryLine', () => {
  const event = {
    event_products: [{ product_id: 'p1', product: lager }],
  };

  it('costs received qty at supplier offer', () => {
    const row = costDeliveryLine({
      line: { product_id: 'p1', qty: 10, singles: 0 },
      supplierId: 's2',
      event,
      caseSizes: [],
    });
    expect(row.qty).toBe(10);
    expect(row.unitPrice).toBe(22);
    expect(row.cost).toBe(220);
    expect(row.missingPrice).toBe(false);
  });

  it('prefers invoice qty when qtyMode is invoiced', () => {
    const row = costDeliveryLine({
      line: { product_id: 'p1', qty: 10, singles: 0, invoice_qty: 8, invoice_singles: 0 },
      supplierId: 's1',
      event,
      caseSizes: [],
      qtyMode: 'invoiced',
    });
    expect(row.qty).toBe(8);
    expect(row.cost).toBe(192);
  });
});

describe('buildSupplierDeliveryCostReport', () => {
  const event = {
    event_products: [
      { product_id: 'p1', product: lager },
      { product_id: 'p2', product: spirit },
    ],
  };

  const deliveries = [
    {
      id: 'd1',
      supplier_id: 's1',
      supplier: { id: 's1', name: 'Acme' },
      delivered_at: '2026-07-10T12:00:00Z',
      reference: 'PO-1',
      lines: [{ product_id: 'p1', qty: 5, singles: 0 }],
    },
    {
      id: 'd2',
      supplier_id: 's2',
      supplier: { id: 's2', name: 'Beta' },
      delivered_at: '2026-07-20T12:00:00Z',
      reference: 'PO-2',
      lines: [{ product_id: 'p1', qty: 2, singles: 0 }],
    },
  ];

  it('totals cost across deliveries and by supplier', () => {
    const report = buildSupplierDeliveryCostReport({
      deliveries,
      event,
      suppliers: [{ id: 's1', name: 'Acme' }, { id: 's2', name: 'Beta' }],
    });
    expect(report.deliveryCount).toBe(2);
    expect(report.totalCost).toBe(5 * 24 + 2 * 22);
    expect(report.supplierRows[0].supplierName).toBe('Acme');
    expect(report.supplierRows[0].cost).toBe(120);
  });

  it('filters by supplier and date', () => {
    const report = buildSupplierDeliveryCostReport({
      deliveries,
      event,
      supplierId: 's2',
      dateFrom: '2026-07-15',
      dateTo: '2026-07-25',
    });
    expect(report.deliveryCount).toBe(1);
    expect(report.totalCost).toBe(44);
  });
});

describe('supplierDeliveryCostCsv', () => {
  it('includes a total row', () => {
    const { content, filename } = supplierDeliveryCostCsv({
      totalCost: 100,
      deliveryRows: [{
        deliveredAt: '2026-07-10T12:00:00Z',
        supplierName: 'Acme',
        reference: 'PO-1',
        lines: [{
          productName: 'Lager',
          qty: 5,
          unitPrice: 20,
          cost: 100,
          priceBasis: 'case',
          missingPrice: false,
        }],
      }],
    }, 'Gullies Fest');
    expect(filename).toContain('Supplier delivery cost');
    expect(content).toContain('TOTAL');
    expect(content).toContain('100.00');
  });
});
