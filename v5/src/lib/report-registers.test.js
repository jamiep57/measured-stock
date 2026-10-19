import { describe, expect, it } from 'vitest';
import {
  buildClosingRegister,
  buildCountRegister,
  buildDeliveryRegister,
  buildOrderRegister,
  buildProductRegister,
  buildTransferRegister,
  buildWastageRegister,
  inReportDateRange,
} from './report-registers.js';

const event = {
  name: 'Summer',
  bars: [{ id: 'bar-1', name: 'Main bar' }],
  recipients: [{ id: 'rec-1', name: 'Artist Liaison' }],
  event_products: [
    {
      product_id: 'p1',
      already_in_stock: 4,
      product: { id: 'p1', name: 'Lager', case_size: '24 × 330ml', abv: 4.5, category: { name: 'Beer' } },
    },
    {
      product_id: 'p2',
      product: { id: 'p2', name: 'Cola', case_size: '24 × 330ml', category: { name: 'Soft' } },
    },
  ],
};

describe('inReportDateRange', () => {
  it('keeps an empty range and drops dates outside it', () => {
    expect(inReportDateRange('2026-01-01T00:00:00.000Z', '', '')).toBe(true);
    expect(inReportDateRange('', '2026-06-01', '2026-06-30')).toBe(false);
    expect(inReportDateRange('2026-06-15T12:00:00.000Z', '2026-06-01', '2026-06-30')).toBe(true);
    expect(inReportDateRange('2026-05-01T12:00:00.000Z', '2026-06-01', '2026-06-30')).toBe(false);
  });
});

describe('report registers', () => {
  it('lists deliveries with supplier, products and quantity', () => {
    const report = buildDeliveryRegister({
      event,
      supplierId: 'sup-1',
      deliveries: [
        {
          id: 'd1',
          supplier_id: 'sup-1',
          supplier: { name: 'Brew Co' },
          delivered_at: '2026-06-02T10:00:00.000Z',
          reference: 'INV-1',
          notes: 'Back door',
          lines: [{ product_id: 'p1', qty: 3, singles: 2 }],
        },
        {
          id: 'd2',
          supplier_id: 'sup-2',
          supplier: { name: 'Other' },
          delivered_at: '2026-06-03T10:00:00.000Z',
          lines: [],
        },
      ],
    });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].cells.supplier).toBe('Brew Co');
    expect(report.rows[0].cells.lines).toBe('Lager');
    expect(report.rows[0].cells.qty).toContain('3 cases');
    expect(report.rows[0].cells.qty).toContain('2 singles');
    expect(report.csv).toContain('Reference');
    expect(report.csv).toContain('INV-1');
  });

  it('lists wastage by reason', () => {
    const report = buildWastageRegister({
      event,
      batches: [{
        id: 'w1',
        reason: 'Broken',
        recorded_at: '2026-06-04T10:00:00.000Z',
        notes: 'Dropped',
        lines: [{ product_id: 'p2', qty: 1 }],
      }],
    });
    expect(report.rows[0].cells.reason).toBe('Broken');
    expect(report.rows[0].cells.lines).toBe('Cola');
    expect(report.csv).toContain('Broken');
  });

  it('lists counted lines and keeps an empty session', () => {
    const report = buildCountRegister({
      event,
      sessions: [
        { id: 'c1', name: 'Open', counted_at: '2026-06-05T10:00:00.000Z', bar_id: 'bar-1' },
        { id: 'c2', name: 'Empty', counted_at: '2026-06-06T10:00:00.000Z' },
      ],
      linesBySession: new Map([
        ['c1', [{ id: 'l1', product_id: 'p1', bar_id: 'bar-1', cases: 2, singles: 1 }]],
        ['c2', []],
      ]),
    });
    expect(report.rows).toHaveLength(2);
    expect(report.rows.find((row) => row.cells.session === 'Open').cells).toMatchObject({
      location: 'Main bar',
      product: 'Lager',
      cases: '2',
      singles: '1',
    });
    expect(report.rows.find((row) => row.cells.session === 'Empty').cells.product).toBe('');
  });

  it('lists event products with opening quantity', () => {
    const report = buildProductRegister({ event });
    expect(report.rows.map((row) => row.cells.product)).toEqual(['Cola', 'Lager']);
    expect(report.rows.find((row) => row.cells.product === 'Lager').cells).toMatchObject({
      category: 'Beer',
      pack: '24 × 330ml',
      abv: '4.5%',
      opening: '4',
    });
    expect(report.csv.startsWith('Product,Category,Pack,ABV,Opening')).toBe(true);
  });

  it('lists purchase orders and offers a PDF when the order has lines', () => {
    const report = buildOrderRegister({
      orders: [{
        id: 'po1',
        reference: 'PO-9',
        status: 'confirmed',
        supplier_id: 'sup-1',
        order_date: '2026-06-01',
        delivery_date: '2026-06-03',
        purchase_order_lines: [
          { product_id: 'p1', qty_cases: 4, case_price: 10 },
          { product_id: 'p2', qty_cases: 1, case_price: null },
        ],
      }],
      suppliers: [{ id: 'sup-1', name: 'Brew Co' }],
      names: new Map([['p1', 'Lager']]),
    });
    expect(report.rows[0].action).toBe('po-pdf');
    expect(report.rows[0].cells).toMatchObject({
      reference: 'PO-9',
      status: 'Confirmed',
      supplier: 'Brew Co',
      lines: '2',
      cases: '5',
      total: '40.00',
    });
  });

  it('lists transfers and names the destination', () => {
    const report = buildTransferRegister({
      event,
      transfers: [{
        id: 't1',
        transferred_at: '2026-06-07T15:00:00.000Z',
        from_bar_id: 'bar-1',
        recipient_id: 'rec-1',
        lines: [{ product_id: 'p1', qty: 2 }],
      }],
    });
    expect(report.rows[0].action).toBe('delivery-note');
    expect(report.rows[0].cells.from).toBe('Main bar');
    expect(report.rows[0].cells.to).toBe('Artist Liaison');
    expect(report.rows[0].cells.lines).toBe('Lager');
  });

  it('lists closing counts and offers a sticker when cases were counted', () => {
    const report = buildClosingRegister({
      event,
      closingRows: [
        { product_id: 'p1', closing_cases: 6, closing_singles: 3, return_amount: 1 },
        { product_id: 'p2', closing_cases: 0, closing_singles: 2 },
      ],
    });
    const lager = report.rows.find((row) => row.cells.product === 'Lager');
    const cola = report.rows.find((row) => row.cells.product === 'Cola');
    expect(lager.action).toBe('pallet-sticker');
    expect(lager.sticker.cases).toBe(6);
    expect(lager.cells.singles).toBe('3');
    expect(cola.action).toBe('');
    expect(report.csv).toContain('Closing cases');
  });
});
