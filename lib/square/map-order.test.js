import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignOrderToEvent,
  eventClosedAtRange,
  londonTimeToUtc,
  mapSquareOrder,
  saleDateLondon,
} from './map-order.js';

const events = [
  { id: 'e1', start_date: '2026-07-01', end_date: '2026-07-03', locationIds: ['loc-a'] },
  { id: 'e2', start_date: '2026-07-02', end_date: '2026-07-02', locationIds: ['loc-a', 'loc-b'] },
];

test('sale date uses the London calendar day', () => {
  assert.equal(saleDateLondon('2026-07-14T23:30:00Z'), '2026-07-15');
  assert.equal(saleDateLondon('2026-01-15T00:30:00Z'), '2026-01-15');
});

test('London midnight converts for GMT and BST', () => {
  assert.equal(londonTimeToUtc('2026-01-15', '00:00:00').toISOString(), '2026-01-15T00:00:00.000Z');
  assert.equal(londonTimeToUtc('2026-07-15', '00:00:00').toISOString(), '2026-07-14T23:00:00.000Z');
  const range = eventClosedAtRange('2026-07-01', '2026-07-01');
  assert.equal(range.start_at, '2026-06-30T23:00:00.000Z');
  assert.equal(range.end_at, '2026-07-01T22:59:59.000Z');
});

test('partial return scales quantity and money, and keeps the modifier', () => {
  const mapped = mapSquareOrder({
    state: 'COMPLETED',
    closed_at: '2026-07-01T18:00:00Z',
    location_id: 'loc-a',
    line_items: [{
      uid: 'line1',
      name: 'Vodka Redbull',
      variation_name: 'Double',
      quantity: '2',
      gross_sales_money: { amount: 2000, currency: 'GBP' },
      total_discount_money: { amount: 200, currency: 'GBP' },
      modifiers: [{
        uid: 'mod1',
        name: 'Extra shot',
        catalog_object_id: 'mod-cat',
        quantity: '2',
        base_price_money: { amount: 100, currency: 'GBP' },
        total_price_money: { amount: 200, currency: 'GBP' },
      }],
    }],
    returns: [{
      return_line_items: [{ source_line_item_uid: 'line1', quantity: '1' }],
    }],
  }, { locationName: 'Bar 1' });

  assert.equal(mapped.lines.length, 2);
  const item = mapped.lines[0];
  assert.equal(item.kind, 'item');
  assert.equal(item.name, 'Vodka Redbull');
  assert.equal(item.variation, 'Double');
  assert.equal(item.items_sold, 1);
  assert.equal(item.net_sales, 9);
  assert.equal(item.gross_sales, 10);
  assert.equal(item.location, 'Bar 1');
  assert.equal(item.sale_date, '2026-07-01');
  const mod = mapped.lines[1];
  assert.equal(mod.kind, 'modifier');
  assert.equal(mod.modifier, 'Extra shot');
  assert.equal(mod.qty_sold, 1);
  assert.equal(mod.net_sales, 1);
  assert.equal(mod.line_uid, 'line1:mod1');
});

test('a canceled order contributes no lines', () => {
  const mapped = mapSquareOrder({
    state: 'CANCELED',
    closed_at: '2026-07-01T18:00:00Z',
    line_items: [{ uid: 'line1', name: 'Pint', quantity: '1', gross_sales_money: { amount: 600 } }],
  });
  assert.deepEqual(mapped.lines, []);
});

test('a fully returned line is omitted', () => {
  const mapped = mapSquareOrder({
    state: 'COMPLETED',
    closed_at: '2026-07-01T12:00:00Z',
    line_items: [{ uid: 'line1', name: 'Pint', quantity: '1', gross_sales_money: { amount: 600 } }],
    returns: [{ return_line_items: [{ source_line_item_uid: 'line1', quantity: '1' }] }],
  });
  assert.deepEqual(mapped.lines, []);
});

test('assignment picks one event, flags overlap, and skips other days', () => {
  assert.deepEqual(
    assignOrderToEvent({ locationId: 'loc-b', closedAt: '2026-07-02T12:00:00Z', events }),
    { eventId: 'e2', reason: null },
  );
  assert.deepEqual(
    assignOrderToEvent({ locationId: 'loc-a', closedAt: '2026-07-02T20:00:00Z', events }),
    { eventId: null, reason: 'overlap' },
  );
  assert.deepEqual(
    assignOrderToEvent({ locationId: 'loc-a', closedAt: '2026-08-01T12:00:00Z', events }),
    { eventId: null, reason: 'no_event' },
  );
});
