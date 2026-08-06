import { describe, it, expect } from 'vitest';
import { buildReconRow, closingInvoiceQty, reconBudgetCost, varianceClass } from './recon.js';

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
    expect(row.deliverySources).toEqual([]);
    expect(row.multiSupplierDelivery).toBe(false);
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

describe('buildReconRow deliverySources', () => {
  const product = {
    id: 'p1',
    name: 'White Claw',
    case_size: '12×330ml',
    units_per_case: 12,
    case_price: 18,
    category: { id: 'c1', name: 'Seltzers' },
    product_suppliers: [
      { supplier_id: 's1', is_preferred: true, case_price: 18, supplier: { name: 'LWC' } },
      { supplier_id: 's2', case_price: 22, supplier: { name: 'Booker' } },
    ],
  };

  function ctx(overrides = {}) {
    const ep = {
      product_id: 'p1',
      product,
      delivered_qty: 15,
      ...(overrides.ep || {}),
    };
    return {
      ep,
      closingRow: {},
      pluByPid: {},
      suppliers: [{ id: 's1', name: 'LWC' }, { id: 's2', name: 'Booker' }],
      caseSizes: [],
      wastageMap: {},
      transferMap: {},
      supplierReturns: overrides.supplierReturns || [],
      event: { id: 'e1', event_products: [ep] },
      countedIn: overrides.countedIn,
      deliveries: overrides.deliveries,
    };
  }

  it('one supplier → single delivery source, no multi flags', () => {
    const deliveries = [{
      id: 'd1',
      supplier_id: 's1',
      supplier: { name: 'LWC' },
      lines: [{ product_id: 'p1', qty: 10 }],
    }];
    const row = buildReconRow(ctx({
      deliveries,
      countedIn: { p1: 10 },
    }));
    expect(row.deliverySources).toHaveLength(1);
    expect(row.deliverySources[0]).toMatchObject({
      supplierId: 's1',
      supplierName: 'LWC',
      qty: 10,
      unitPrice: 18,
      returned: 0,
    });
    expect(row.multiSupplierDelivery).toBe(false);
    expect(row.multiSupplierPriceWarn).toBe(false);
    expect(row.delivered).toBe(10);
  });

  it('two suppliers at different prices → multi delivery + price warn', () => {
    const deliveries = [
      {
        id: 'd1',
        supplier_id: 's1',
        supplier: { name: 'LWC' },
        lines: [{ product_id: 'p1', qty: 10 }],
      },
      {
        id: 'd2',
        supplier_id: 's2',
        supplier: { name: 'Booker' },
        lines: [{ product_id: 'p1', qty: 5 }],
      },
    ];
    const row = buildReconRow(ctx({
      deliveries,
      countedIn: { p1: 15 },
    }));
    expect(row.multiSupplierDelivery).toBe(true);
    expect(row.multiSupplierPriceWarn).toBe(true);
    expect(row.deliverySources).toHaveLength(2);
    expect(row.deliverySources[0]).toMatchObject({
      supplierId: 's1',
      supplierName: 'LWC',
      qty: 10,
      unitPrice: 18,
      cost: 180,
      returned: 0,
    });
    expect(row.deliverySources[1]).toMatchObject({
      supplierId: 's2',
      supplierName: 'Booker',
      qty: 5,
      unitPrice: 22,
      cost: 110,
      returned: 0,
    });
    expect(row.delivered).toBe(15);
    expect(row.delivered).toBe(
      row.deliverySources.reduce((sum, s) => sum + s.qty, 0),
    );
  });

  it('attributes closing return_amount to preferred supplier when no return lines', () => {
    const deliveries = [
      {
        id: 'd1',
        supplier_id: null,
        lines: [{ product_id: 'p1', qty: 18 }],
      },
      {
        id: 'd2',
        supplier_id: 's1',
        supplier: { name: 'LWC' },
        lines: [{ product_id: 'p1', qty: 10 }],
      },
    ];
    const ep = {
      product_id: 'p1',
      product,
      delivered_qty: 28,
    };
    const row = buildReconRow({
      ep,
      closingRow: { return_amount: 3 },
      pluByPid: {},
      suppliers: [{ id: 's1', name: 'LWC' }, { id: 's2', name: 'Booker' }],
      caseSizes: [],
      wastageMap: {},
      transferMap: {},
      supplierReturns: [],
      event: { id: 'e1', event_products: [ep] },
      countedIn: { p1: 28 },
      deliveries,
    });
    expect(row.supplierReturns).toBe(3);
    expect(row.multiSupplierDelivery).toBe(true);
    const preferred = row.deliverySources.find((s) => s.supplierId === 's1');
    const none = row.deliverySources.find((s) => s.supplierId == null);
    expect(preferred).toMatchObject({ qty: 10, returned: 3 });
    expect(none).toMatchObject({ qty: 18, returned: 0 });
  });

  it('attributes supplier returns onto the matching nested source', () => {
    const deliveries = [
      {
        id: 'd1',
        supplier_id: null,
        lines: [{ product_id: 'p1', qty: 18 }],
      },
      {
        id: 'd2',
        supplier_id: 's1',
        supplier: { name: 'LWC' },
        lines: [{ product_id: 'p1', qty: 10 }],
      },
    ];
    const supplierReturns = [
      { product_id: 'p1', supplier_id: 's1', qty: 3, singles: 0 },
    ];
    const row = buildReconRow(ctx({
      deliveries,
      countedIn: { p1: 28 },
      supplierReturns,
    }));
    expect(row.multiSupplierDelivery).toBe(true);
    expect(row.supplierReturns).toBe(3);
    const lwc = row.deliverySources.find((s) => s.supplierId === 's1');
    const none = row.deliverySources.find((s) => s.supplierId == null);
    expect(lwc).toMatchObject({ qty: 10, returned: 3 });
    expect(none).toMatchObject({ qty: 18, returned: 0 });
    expect(row.deliverySources.reduce((sum, s) => sum + s.returned, 0)).toBe(3);
  });

  it('adds a return-only supplier source when that supplier did not deliver', () => {
    const deliveries = [{
      id: 'd1',
      supplier_id: 's1',
      supplier: { name: 'LWC' },
      lines: [{ product_id: 'p1', qty: 10 }],
    }];
    const supplierReturns = [
      { product_id: 'p1', supplier_id: 's2', qty: 2, singles: 0 },
    ];
    const row = buildReconRow(ctx({
      deliveries,
      countedIn: { p1: 10 },
      supplierReturns,
    }));
    expect(row.multiSupplierDelivery).toBe(true);
    expect(row.deliverySources).toEqual(expect.arrayContaining([
      expect.objectContaining({ supplierId: 's1', qty: 10, returned: 0 }),
      expect.objectContaining({ supplierId: 's2', supplierName: 'Booker', qty: 0, returned: 2 }),
    ]));
  });

  it('two suppliers at the same price → multi delivery, no price warn', () => {
    const samePrice = {
      ...product,
      product_suppliers: [
        { supplier_id: 's1', is_preferred: true, case_price: 20, supplier: { name: 'LWC' } },
        { supplier_id: 's2', case_price: 20, supplier: { name: 'Booker' } },
      ],
    };
    const ep = { product_id: 'p1', product: samePrice, delivered_qty: 8 };
    const deliveries = [
      {
        id: 'd1',
        supplier_id: 's1',
        lines: [{ product_id: 'p1', qty: 3 }],
      },
      {
        id: 'd2',
        supplier_id: 's2',
        lines: [{ product_id: 'p1', qty: 5 }],
      },
    ];
    const row = buildReconRow({
      ep,
      closingRow: {},
      pluByPid: {},
      suppliers: [{ id: 's1', name: 'LWC' }, { id: 's2', name: 'Booker' }],
      caseSizes: [],
      wastageMap: {},
      transferMap: {},
      supplierReturns: [],
      event: { id: 'e1', event_products: [ep] },
      countedIn: { p1: 8 },
      deliveries,
    });
    expect(row.multiSupplierDelivery).toBe(true);
    expect(row.multiSupplierPriceWarn).toBe(false);
    expect(row.deliverySources.every((s) => s.unitPrice === 20)).toBe(true);
    expect(row.delivered).toBe(8);
  });
});

describe('reconBudgetCost', () => {
  const charges = {
    consumptionCharge: 100,
    consumptionLooseCharge: 10,
    pluCharge: 90,
    invoiceCharge: 120,
    invoiced: 0,
  };

  it('selects each explicit budget method', () => {
    expect(reconBudgetCost(charges, { budget_method: 'consumption' })).toBe(100);
    expect(reconBudgetCost(charges, { budget_method: 'consumption_loose' })).toBe(110);
    expect(reconBudgetCost(charges, { budget_method: 'plu' })).toBe(90);
    expect(reconBudgetCost(charges, { budget_method: 'invoice' })).toBe(120);
  });

  it('uses manual override when set', () => {
    expect(reconBudgetCost(charges, {
      budget_method: 'manual',
      budget_override: 55.5,
    })).toBe(55.5);
    expect(reconBudgetCost(charges, { budget_method: 'manual' })).toBe(0);
  });

  it('auto prefers consumption+loose when invoiced', () => {
    expect(reconBudgetCost(
      { ...charges, invoiced: 5 },
      { budget_method: 'auto' },
    )).toBe(110);
  });

  it('auto takes max of consumption+loose and PLU when not invoiced', () => {
    expect(reconBudgetCost(charges, { budget_method: 'auto' })).toBe(110);
    expect(reconBudgetCost(
      { ...charges, pluCharge: 200 },
      { budget_method: 'auto' },
    )).toBe(200);
    expect(reconBudgetCost(charges, {})).toBe(110);
  });
});

describe('buildReconRow budget method', () => {
  const product = {
    id: 'p1',
    name: 'Test Lager',
    case_size: '24×330ml',
    units_per_case: 24,
    case_price: 24,
    category: { id: 'c1', name: 'Beer' },
    product_suppliers: [{ supplier_id: 's1', is_preferred: true, case_price: 24, supplier: { name: 'Acme' } }],
  };

  function baseCtx(overrides = {}) {
    const ep = {
      product_id: 'p1',
      product,
      delivered_qty: 100,
      qty_ordered: 100,
      damaged_qty: 0,
      invoice_qty: 100,
    };
    return {
      ep,
      closingRow: { closing_cases: 20, closing_singles: 0 },
      pluByPid: { p1: 75 },
      suppliers: [{ id: 's1', name: 'Acme' }],
      caseSizes: [],
      wastageMap: {},
      transferMap: {},
      supplierReturns: [],
      event: { id: 'e1', event_products: [ep] },
      ...overrides,
    };
  }

  it('wires closingRow budget_method into budgetCost', () => {
    const pluRow = buildReconRow(baseCtx({
      closingRow: { closing_cases: 20, closing_singles: 0, budget_method: 'plu' },
    }));
    expect(pluRow.budgetMethod).toBe('plu');
    expect(pluRow.budgetCost).toBe(pluRow.pluCharge);

    const invRow = buildReconRow(baseCtx({
      closingRow: { closing_cases: 20, closing_singles: 0, budget_method: 'invoice' },
    }));
    expect(invRow.budgetCost).toBe(invRow.invoiceCharge);

    const consRow = buildReconRow(baseCtx({
      closingRow: { closing_cases: 20, closing_singles: 0, budget_method: 'consumption' },
    }));
    expect(consRow.budgetCost).toBe(consRow.consumptionCharge);
  });

  it('applies draft budget method and manual override', () => {
    const row = buildReconRow(baseCtx({
      closingRow: { closing_cases: 20, closing_singles: 0, budget_method: 'plu' },
      draft: { budgetMethod: 'manual', budgetOverride: 42 },
    }));
    expect(row.budgetMethod).toBe('manual');
    expect(row.budgetCost).toBe(42);
  });

  it('auto uses consumption+loose when invoice qty present', () => {
    const row = buildReconRow(baseCtx({
      closingRow: { closing_cases: 20, closing_singles: 0, budget_method: 'auto' },
    }));
    expect(row.invoiced).toBe(100);
    expect(row.consumptionLooseCharge).toBe(0);
    expect(row.budgetCost).toBe(row.consumptionCharge + row.consumptionLooseCharge);
  });

  it('computes loose charge from closing singles ÷ units per case × price', () => {
    const row = buildReconRow(baseCtx({
      closingRow: { closing_cases: 20, closing_singles: 12 },
    }));
    // 12 singles / 24 upc × £24 case price = £12
    expect(row.ups).toBe(24);
    expect(row.rowPrice).toBe(24);
    expect(row.consumptionLooseCharge).toBe(12);
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
