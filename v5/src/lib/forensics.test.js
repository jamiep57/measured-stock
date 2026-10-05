import { describe, it, expect } from 'vitest';
import {
  ALL_CHECK_IDS,
  buildAuditContext,
  filterFindings,
  runEventAudit,
} from './forensics.js';

const product = {
  id: 'p1',
  name: 'Test Lager',
  case_size: '24×330ml',
  units_per_case: 24,
  case_price: 24,
  category: { id: 'c1', name: 'Beer' },
  product_suppliers: [
    { supplier_id: 's1', is_preferred: true, case_price: 24, supplier: { name: 'Acme' } },
  ],
};

function cleanFixture() {
  const ep = {
    product_id: 'p1',
    product,
    delivered_qty: 100,
    qty_ordered: 100,
    damaged_qty: 0,
    already_in_stock: 0,
  };
  return {
    event: { id: 'e1', event_products: [ep], bars: [{ id: 'b1', name: 'Main' }] },
    caseSizes: [],
    deliveries: [{
      id: 'd1',
      supplier_id: 's1',
      lines: [{ product_id: 'p1', qty: 100, cases: 100, singles: 0, damaged_qty: 0 }],
    }],
    closingRows: [{
      product_id: 'p1',
      closing_cases: 20,
      closing_singles: 0,
      close_count: 20,
      return_amount: 5,
      carried_over: 15,
    }],
    supplierReturns: [{
      product_id: 'p1',
      supplier_id: 's1',
      qty: 5,
      cases: 5,
      singles: 0,
    }],
    transfers: [],
    wastageBatches: [],
    // 1920 bottles @ 24 upc → PLU 80; closing 20 of 100 delivered → consumption 80
    tillRows: [{ name: 'Lager Pint', variation: 'Regular', items_sold: 1920 }],
    recipes: [{
      id: 'r1',
      till_item: 'Lager Pint',
      till_variation: 'Regular',
      ingredients: [{ product_name: 'Test Lager', qty: 1, position: 0 }],
    }],
    products: [product],
    suppliers: [{ id: 's1', name: 'Acme' }],
    distRows: [{ bar_id: 'b1', product_id: 'p1', qty_allocated: 50 }],
    bars: [{ id: 'b1', name: 'Main' }],
    isBoneYard: () => false,
    modifierRows: [],
    syncQueueStats: { pending: 0, failed: 0, total: 0 },
  };
}

describe('buildAuditContext / runEventAudit', () => {
  it('registers all planned checks', () => {
    expect(ALL_CHECK_IDS).toEqual([
      'delivered_consistency',
      'opening_identity',
      'closing_identity',
      'recon_consumption',
      'damaged_semantics',
      'return_dual_write',
      'distribution_overalloc',
      'sync_queue_backlog',
      'stale_aggregate',
    ]);
  });

  it('clean event produces zero errors', () => {
    const report = runEventAudit(cleanFixture());
    expect(report.summary.errors).toBe(0);
    expect(report.findings.filter((f) => f.severity === 'error')).toEqual([]);
  });
});

describe('math checks', () => {
  it('flags delivered_consistency when lines ≠ delivered_qty', () => {
    const raw = cleanFixture();
    raw.event.event_products[0].delivered_qty = 6;
    const report = runEventAudit(raw, { checkIds: ['delivered_consistency'] });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].checkId).toBe('delivered_consistency');
    expect(report.findings[0].expected).toBe(100);
    expect(report.findings[0].actual).toBe(6);
    expect(report.findings[0].severity).toBe('error');
  });

  it('flags closing_identity when carried_over is wrong', () => {
    const raw = cleanFixture();
    raw.closingRows[0].carried_over = 99;
    const report = runEventAudit(raw, { checkIds: ['closing_identity'] });
    const hit = report.findings.find((f) => f.checkId === 'closing_identity' && f.expected === 15);
    expect(hit).toBeTruthy();
    expect(hit.actual).toBe(99);
  });

  it('does not flag when return equals close (decimal Return C / cases+singles)', () => {
    // Gottwood-style: close 5C+2S = 5.5, return stored as 5.5 in qty (shown in Return C).
    const product = {
      id: 'p-lemon',
      name: 'Little Mixers Lemon Juice',
      case_size: '4×1000ml',
      units_per_case: 4,
      stock_unit: 'case',
      case_size_id: 'cs4',
      stock_case_size_id: 'cs4',
      category: { id: 'c1', name: 'COCKTAILS' },
    };
    const ep = {
      product_id: 'p-lemon',
      product,
      delivered_qty: 15,
      invoice_qty: 15,
      damaged_qty: 0,
    };
    const report = runEventAudit({
      event: { id: 'gottwood', event_products: [ep] },
      caseSizes: [{ id: 'cs4', label: '4×1000ml', units_per_case: 4, stock_unit: 'case' }],
      closingRows: [{
        product_id: 'p-lemon',
        closing_cases: 5,
        closing_singles: 2,
        close_count: 5.5,
        return_amount: 5.5,
        carried_over: 0,
      }],
      supplierReturns: [{
        product_id: 'p-lemon',
        supplier_id: 's1',
        qty: 5.5,
        singles: 0,
      }],
      suppliers: [{ id: 's1', name: 'Proof', default_sor_pct: 100 }],
      deliveries: [],
      transfers: [],
      wastageBatches: [],
      tillRows: [],
      recipes: [],
      products: [product],
      distRows: [],
      bars: [],
    }, { checkIds: ['closing_identity'] });
    expect(report.findings).toEqual([]);
  });

  it('does not flag return over close (credit note without full count)', () => {
    // Ops: no full onsite close (close 0) but return qty from supplier credit note.
    const raw = cleanFixture();
    raw.closingRows[0].closing_cases = 0;
    raw.closingRows[0].closing_singles = 0;
    raw.closingRows[0].close_count = 0;
    raw.closingRows[0].return_amount = 36;
    raw.closingRows[0].carried_over = 0;
    raw.supplierReturns = [{
      product_id: 'p1',
      supplier_id: 's1',
      qty: 36,
      singles: 0,
    }];
    const report = runEventAudit(raw, { checkIds: ['closing_identity'] });
    expect(report.findings.filter((f) => f.id?.includes('return-over'))).toEqual([]);
    expect(report.findings).toEqual([]);
  });

  it('does not flag damaged_semantics when damaged is excluded from consumption', () => {
    const raw = cleanFixture();
    raw.event.event_products[0].damaged_qty = 2;
    raw.deliveries[0].lines[0].damaged_qty = 2;
    const report = runEventAudit(raw, { checkIds: ['damaged_semantics', 'recon_consumption'] });
    expect(report.findings.filter((f) => f.checkId === 'damaged_semantics')).toEqual([]);
    expect(report.findings.filter((f) => f.checkId === 'recon_consumption')).toEqual([]);
    const row = report.ctx.reconRows[0];
    // 100 delivered − 2 damaged − 20 closing = 78
    expect(row.damaged).toBe(2);
    expect(row.consumption).toBe(78);
  });

  it('recon_consumption passes when row matches formula', () => {
    const report = runEventAudit(cleanFixture(), { checkIds: ['recon_consumption'] });
    expect(report.findings).toEqual([]);
  });
});

describe('save / integrity checks', () => {
  it('flags return_dual_write mismatch', () => {
    const raw = cleanFixture();
    raw.closingRows[0].return_amount = 1;
    const report = runEventAudit(raw, { checkIds: ['return_dual_write'] });
    expect(report.findings.some((f) => f.severity === 'error')).toBe(true);
    expect(report.findings[0].expected).toBe(5);
    expect(report.findings[0].actual).toBe(1);
  });

  it('flags distribution_overalloc', () => {
    const raw = cleanFixture();
    raw.distRows[0].qty_allocated = 150;
    const report = runEventAudit(raw, { checkIds: ['distribution_overalloc'] });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].severity).toBe('error');
  });

  it('flags sync_queue_backlog', () => {
    const raw = cleanFixture();
    raw.syncQueueStats = { pending: 2, failed: 1, total: 3 };
    const report = runEventAudit(raw, { checkIds: ['sync_queue_backlog'] });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].severity).toBe('error');
    expect(report.findings[0].actual).toBe(3);
  });

  it('flags stale_aggregate damaged mismatch', () => {
    const raw = cleanFixture();
    raw.event.event_products[0].damaged_qty = 0;
    raw.deliveries[0].lines[0].damaged_qty = 3;
    const report = runEventAudit(raw, { checkIds: ['stale_aggregate'] });
    expect(report.findings.some((f) => f.checkId === 'stale_aggregate')).toBe(true);
  });
});

describe('filterFindings', () => {
  it('filters by severity, check, and query', () => {
    const report = runEventAudit({
      ...cleanFixture(),
      event: {
        ...cleanFixture().event,
        event_products: [{
          ...cleanFixture().event.event_products[0],
          delivered_qty: 1,
        }],
      },
    });
    const ctx = buildAuditContext(cleanFixture());
    expect(ctx.reconRows.length).toBe(1);
    const errors = filterFindings(report.findings, { severity: 'error' });
    expect(errors.every((f) => f.severity === 'error')).toBe(true);
    const byCheck = filterFindings(report.findings, { checkId: 'delivered_consistency' });
    expect(byCheck.every((f) => f.checkId === 'delivered_consistency')).toBe(true);
    const byQuery = filterFindings(report.findings, { query: 'lager' });
    expect(byQuery.length).toBeGreaterThan(0);
  });
});
