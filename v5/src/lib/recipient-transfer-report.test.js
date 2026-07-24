import { describe, it, expect } from 'vitest';
import {
  buildRecipientTransferReport,
  formatTransferQtyLabel,
  recipientTransferCsv,
} from './recipient-transfer-report.js';

const lager = {
  id: 'p1',
  name: 'Test Lager',
  case_size: '24×330ml',
  units_per_case: 24,
};

const gin = {
  id: 'p2',
  name: 'Gin',
  stock_unit: 'bottle',
  units_per_case: 6,
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
  });
});

describe('recipientTransferCsv', () => {
  it('writes client product rows', () => {
    const report = buildRecipientTransferReport({ transfers, event });
    const { content, filename } = recipientTransferCsv(report, 'Gullies');
    expect(filename).toContain('Transfers by client');
    expect(content).toContain('Artist Liaison');
    expect(content).toContain('Test Lager');
  });
});
