import { describe, expect, it } from 'vitest';
import {
  eventsAffectedByPriceChange,
  priceChangeCopy,
  reconPriceChanged,
  reconPricesFromOffers,
} from './price-change-events.js';

describe('reconPricesFromOffers', () => {
  it('uses the preferred offer and splits a form price into case and unit', () => {
    expect(reconPricesFromOffers([
      { supplier_id: 's2', price: 30, is_preferred: false },
      { supplier_id: 's1', price: 24, is_preferred: true },
    ], 24, { fromForm: true })).toEqual({ casePrice: 24, unitPrice: 1 });
  });

  it('reads saved case and unit prices', () => {
    expect(reconPricesFromOffers([
      { is_preferred: true, case_price: 24, unit_price: 1 },
    ], 24)).toEqual({ casePrice: 24, unitPrice: 1 });
  });
});

describe('eventsAffectedByPriceChange', () => {
  const next = { casePrice: 30, unitPrice: 1.25 };

  it('lists open events still on the old captured price', () => {
    const rows = eventsAffectedByPriceChange([
      { id: 'ep1', case_price_snapshot: 24, unit_price_snapshot: 1, event: { name: 'Festival', status: 'active' } },
      { id: 'ep2', case_price_snapshot: 30, unit_price_snapshot: 1.25, event: { name: 'Already new', status: 'closing' } },
      { id: 'ep3', case_price_snapshot: 24, unit_price_snapshot: 1, event: { name: 'Old show', status: 'archived' } },
    ], next);
    expect(rows.map((r) => r.event.name)).toEqual(['Festival']);
  });
});

describe('priceChangeCopy', () => {
  it('names a single event on the update action', () => {
    const copy = priceChangeCopy([
      { event: { name: 'Festival' } },
    ]);
    expect(copy.message).toBe('This price change will update on Festival and affect the reconciliation.');
    expect(copy.keepLabel).toBe("Update product price and don't change event");
    expect(copy.applyLabel).toBe('Update product and update Festival');
    expect(copy.cancelLabel).toBe('Do not update');
  });

  it('counts several events', () => {
    const copy = priceChangeCopy([
      { event: { name: 'Festival' } },
      { event: { name: 'Warehouse' } },
    ]);
    expect(copy.message).toContain('Festival and Warehouse');
    expect(copy.applyLabel).toBe('Update product and update 2 events');
    expect(copy.keepLabel).toContain('events');
  });
});

describe('reconPriceChanged', () => {
  it('ignores an unchanged preferred price', () => {
    expect(reconPriceChanged(
      { casePrice: 24, unitPrice: 1 },
      { casePrice: 24, unitPrice: 1 },
    )).toBe(false);
    expect(reconPriceChanged(
      { casePrice: 24, unitPrice: 1 },
      { casePrice: 30, unitPrice: 1.25 },
    )).toBe(true);
  });
});
