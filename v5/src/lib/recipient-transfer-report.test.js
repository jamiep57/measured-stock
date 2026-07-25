import { describe, it, expect } from 'vitest';
import {
  applyRecipientReportPricing,
  buildRecipientTransferReport,
  formatTransferQtyLabel,
  overrideStorageKey,
  recipientTransferCsv,
} from './recipient-transfer-report.js';

const lager = {
  id: 'p1',
  name: 'Test Lager',
  case_size: '24×330ml',
  units_per_case: 24,
  case_price: 20,
  product_suppliers: [{ supplier_id: 's1', is_preferred: true, case_price: 24 }],
};

const gin = {
  id: 'p2',
  name: 'Gin',
  stock_unit: 'bottle',
  units_per_case: 6,
  unit_price: 14,
  product_suppliers: [{ supplier_id: 's1', is_preferred: true, unit_price: 16, case_price: 90 }],
};

const event = {
  id: 'e1',
  recipients: [
    { id: 'r1', name: 'Artist Liaison' },
    { id: 'r2', name: 'Production' },
  ],
  event_products: [
    { product_id: 'p1', product: lager },
    { product_id: 'p2', product: gin },
  ],
};

const transfers = [
  {
    id: 't1',
    recipient_id: 'r1',
    recipients: { id: 'r1', name: 'Artist Liaison' },
    from_event_id: 'e1',
    transferred_at: '2026-07-10T12:00:00Z',
    lines: [
      { product_id: 'p1', qty: 5, singles: 0 },
      { product_id: 'p2', qty: 2, singles: 0 },
    ],
  },
  {
    id: 't2',
    recipient_id: 'r1',
    recipients: { id: 'r1', name: 'Artist Liaison' },
    from_event_id: 'e1',
    transferred_at: '2026-07-12T12:00:00Z',
    lines: [{ product_id: 'p1', qty: 3, singles: 0 }],
  },
  {
    id: 't3',
    recipient_id: 'r2',
    recipients: { id: 'r2', name: 'Production' },
    from_event_id: 'e1',
    transferred_at: '2026-07-11T12:00:00Z',
    lines: [{ product_id: 'p1', qty: 1, singles: 0 }],
  },
  {
    id: 't4',
    recipient_id: null,
    to_bar_id: 'b1',
    from_event_id: 'e1',
    transferred_at: '2026-07-11T12:00:00Z',
    lines: [{ product_id: 'p1', qty: 9, singles: 0 }],
  },
];

describe('formatTransferQtyLabel', () => {
  it('labels cases', () => {
    expect(formatTransferQtyLabel(5, lager, [])).toBe('5 cases');
  });
});

describe('buildRecipientTransferReport', () => {
  it('groups products by client and ignores bar transfers', () => {
    const report = buildRecipientTransferReport({ transfers, event, caseSizes: [] });
    expect(report.recipientCount).toBe(2);
    expect(report.transferCount).toBe(3);

    const artist = report.recipientRows.find((r) => r.recipientName === 'Artist Liaison');
    expect(artist.transferCount).toBe(2);
    expect(artist.products.find((p) => p.productName === 'Test Lager').qty).toBe(8);
    expect(artist.summary).toContain('Test Lager');
    expect(artist.summary).toContain('Gin');
  });

  it('prices transfers from preferred offer / event override', () => {
    const report = buildRecipientTransferReport({ transfers, event, caseSizes: [] });
    // Lager £24/case × (8+1) + Gin £16/bottle × 2
    expect(report.totalCost).toBe(24 * 9 + 16 * 2);

    const artist = report.recipientRows.find((r) => r.recipientName === 'Artist Liaison');
    expect(artist.totalCost).toBe(24 * 8 + 16 * 2);
    expect(artist.products.find((p) => p.productName === 'Test Lager').cost).toBe(24 * 8);
    expect(artist.products.find((p) => p.productName === 'Gin').cost).toBe(32);
  });

  it('uses event order price override when set', () => {
    const pricedEvent = {
      ...event,
      event_products: [
        { product_id: 'p1', product: lager, order_price_override: 30 },
        { product_id: 'p2', product: gin },
      ],
    };
    const report = buildRecipientTransferReport({
      transfers: [transfers[2]],
      event: pricedEvent,
      caseSizes: [],
    });
    expect(report.totalCost).toBe(30);
  });

  it('filters by recipient and date', () => {
    const report = buildRecipientTransferReport({
      transfers,
      event,
      recipientId: 'r1',
      dateFrom: '2026-07-11',
      dateTo: '2026-07-12',
    });
    expect(report.transferCount).toBe(1);
    expect(report.recipientRows[0].products[0].qty).toBe(3);
    expect(report.totalCost).toBe(72);
  });

  it('merges same-named products across transfers and catalog ids', () => {
    const waterA = { id: 'w1', name: 'Carton Water', case_size: '24×500ml', units_per_case: 24, case_price: 10 };
    const waterB = { id: 'w2', name: 'Carton Water', case_size: '24×500ml', units_per_case: 24, case_price: 10 };
    const waterEvent = {
      ...event,
      event_products: [
        { product_id: 'w1', product: waterA },
        { product_id: 'w2', product: waterB },
      ],
    };
    const report = buildRecipientTransferReport({
      transfers: [
        {
          id: 'tw1',
          recipient_id: 'r1',
          recipients: { id: 'r1', name: 'Artist Liaison' },
          from_event_id: 'e1',
          transferred_at: '2026-07-10T12:00:00Z',
          lines: [{ product_id: 'w1', qty: 17, singles: 0 }],
        },
        {
          id: 'tw2',
          recipient_id: 'r1',
          recipients: { id: 'r1', name: 'Artist Liaison' },
          from_event_id: 'e1',
          transferred_at: '2026-07-12T12:00:00Z',
          lines: [{ product_id: 'w2', qty: 5, singles: 0 }],
        },
      ],
      event: waterEvent,
      caseSizes: [],
    });
    const artist = report.recipientRows[0];
    expect(artist.products).toHaveLength(1);
    expect(artist.products[0].productName).toBe('Carton Water');
    expect(artist.products[0].qty).toBe(22);
  });
});

describe('recipientTransferCsv', () => {
  it('writes client product rows with cost', () => {
    const report = buildRecipientTransferReport({ transfers, event });
    const { content, filename } = recipientTransferCsv(report, 'Gullies');
    expect(filename).toContain('Transfers by client');
    expect(content).toContain('Artist Liaison');
    expect(content).toContain('Test Lager');
    expect(content).toContain('Unit price');
    expect(content).toContain('24.00');
  });
});

describe('applyRecipientReportPricing', () => {
  it('overrides unit prices and bakes markup into charged amounts', () => {
    const base = buildRecipientTransferReport({ transfers, event, caseSizes: [] });
    const artist = base.recipientRows.find((r) => r.recipientName === 'Artist Liaison');
    const lager = artist.products.find((p) => p.productName === 'Test Lager');
    const key = overrideStorageKey(artist.recipientId, lager);

    const priced = applyRecipientReportPricing(base, {
      markupByRecipient: { [artist.recipientId]: 10 },
      unitPriceOverrides: { [key]: 20 },
    });
    const row = priced.recipientRows.find((r) => r.recipientName === 'Artist Liaison');
    const lagerPriced = row.products.find((p) => p.productName === 'Test Lager');

    // 20 override × 1.10 markup = 22 charged unit; qty 8 → 176
    expect(lagerPriced.overrideUnitPrice).toBe(20);
    expect(lagerPriced.unitPrice).toBe(22);
    expect(lagerPriced.cost).toBe(176);
    expect(row.markupPct).toBe(10);
  });

  it('leaves invoice-facing lines without a separate markup row', () => {
    const base = buildRecipientTransferReport({ transfers, event, caseSizes: [] });
    const priced = applyRecipientReportPricing(base, {
      markupByRecipient: { r1: 25 },
    });
    const artist = priced.recipientRows.find((r) => r.recipientName === 'Artist Liaison');
    expect(artist.products.every((p) => p.productName !== 'Markup')).toBe(true);
    // Gin base 16 × 1.25 = 20; qty 2 → 40
    expect(artist.products.find((p) => p.productName === 'Gin').unitPrice).toBe(20);
  });
});
