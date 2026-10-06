import { describe, expect, it } from 'vitest';
import { mergeModifierRows, pickSalesFeed, squareLinesToFeeds, unmatchedForEvent } from './sales-feed.js';

describe('pickSalesFeed', () => {
  const csv = { tillRows: [{ name: 'CSV' }], modifierRows: [{ modifier: 'Lime' }] };
  const square = { tillRows: [{ name: 'Live' }], modifierRows: [{ modifier: 'Salt' }] };

  it('defaults to the upload', () => {
    expect(pickSalesFeed('csv', csv, square).tillRows).toEqual(csv.tillRows);
    expect(pickSalesFeed(undefined, csv, square).source).toBe('csv');
  });

  it('uses Square only when the event asks for it', () => {
    const feed = pickSalesFeed('square', csv, square);
    expect(feed.source).toBe('square');
    expect(feed.tillRows).toEqual(square.tillRows);
    expect(feed.modifierRows).toEqual(square.modifierRows);
  });
});

describe('squareLinesToFeeds', () => {
  it('splits item and modifier lines into the shapes the grids already use', () => {
    const feeds = squareLinesToFeeds([
      { kind: 'item', name: 'Pint', variation: 'Regular', items_sold: 2, net_sales: 10, gross_sales: 12, location: 'Bar 1', sale_date: '2026-07-01' },
      { kind: 'modifier', modifier: 'Extra shot', modifier_set: 'Spirits', qty_sold: 2, net_sales: 2 },
    ]);
    expect(feeds.tillRows).toEqual([
      { name: 'Pint', variation: 'Regular', sku: null, category: null, items_sold: 2, net_sales: 10, gross_sales: 12, location: 'Bar 1', sale_date: '2026-07-01' },
    ]);
    expect(feeds.modifierRows[0]).toMatchObject({ modifier: 'Extra shot', modifier_set: 'Spirits', qty_sold: 2, net_sales: 2 });
  });
});

describe('mergeModifierRows', () => {
  it('sums the same modifier across orders', () => {
    const rows = mergeModifierRows([
      { modifier: 'Extra shot', modifier_set: 'Spirits', qty_sold: 1, net_sales: 1 },
      { modifier: 'Extra shot', modifier_set: 'Spirits', qty_sold: 2, net_sales: 2 },
    ]);
    expect(rows).toEqual([{ modifier: 'Extra shot', modifier_set: 'Spirits', qty_sold: 3, net_sales: 3 }]);
  });
});

describe('unmatchedForEvent', () => {
  const event = { start_date: '2026-07-01', end_date: '2026-07-03' };

  it('keeps overlap orders on this event\'s locations and dates', () => {
    const rows = unmatchedForEvent([
      { unmatched_reason: 'overlap', square_location_id: 'loc-a', closed_at: '2026-07-02T12:00:00Z' },
      { unmatched_reason: 'overlap', square_location_id: 'loc-b', closed_at: '2026-07-02T12:00:00Z' },
      { unmatched_reason: 'no_event', square_location_id: 'loc-a', closed_at: '2026-07-02T12:00:00Z' },
      { unmatched_reason: 'overlap', square_location_id: 'loc-a', closed_at: '2026-08-02T12:00:00Z' },
    ], event, ['loc-a']);
    expect(rows).toHaveLength(1);
  });
});
