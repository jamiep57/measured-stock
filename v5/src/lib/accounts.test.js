import { describe, it, expect } from 'vitest';
import {
  accountNameKey,
  agreementAppliesTo,
  contactsByRole,
  findDuplicateAccount,
  primaryContact,
  riderPricesFor,
  validateAccount,
  validateContact,
} from './accounts.js';

const accounts = [
  { id: 'a1', name: 'Brewer Co', is_supplier: true },
  { id: 'a2', name: 'Artist Liaison', is_client: true },
];

describe('duplicates', () => {
  it('normalises case and spaces like the database', () => {
    expect(accountNameKey('  Brewer CO ')).toBe('brewer co');
    expect(findDuplicateAccount(' brewer co', accounts)?.id).toBe('a1');
  });
  it('ignores the account being edited', () => {
    expect(findDuplicateAccount('Brewer Co', accounts, 'a1')).toBeNull();
  });
});

describe('validateAccount', () => {
  it('rejects duplicates, bad email and no kind', () => {
    const r = validateAccount({ name: 'brewer co', email: 'nope' }, accounts);
    expect(r.ok).toBe(false);
    expect(r.errors.name).toMatch(/already exists/);
    expect(r.errors.email).toBeTruthy();
    expect(r.errors.kind).toBeTruthy();
  });
  it('trims and nulls empty fields', () => {
    const r = validateAccount({ name: '  Ice Ltd ', is_supplier: true, phone: ' ' }, accounts);
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ name: 'Ice Ltd', phone: null, is_client: false, is_supplier: true });
  });
});

describe('contacts', () => {
  const contacts = [
    { id: 'c1', name: 'Sam', role: 'order', is_primary: false },
    { id: 'c2', name: 'Jo', role: 'order', is_primary: true },
    { id: 'c3', name: 'Al', role: 'transfer', is_primary: false },
  ];
  it('picks the primary contact for a role', () => {
    expect(primaryContact(contacts, 'order').id).toBe('c2');
    expect(primaryContact(contacts, 'transfer').id).toBe('c3');
    expect(primaryContact(contacts, 'accounts')).toBeNull();
  });
  it('groups by role with primary first', () => {
    expect(contactsByRole(contacts).get('order').map((c) => c.id)).toEqual(['c2', 'c1']);
  });
  it('rejects the same person twice in one role', () => {
    expect(validateContact({ name: 'sam ', role: 'order' }, contacts).ok).toBe(false);
    expect(validateContact({ name: 'Sam', role: 'transfer' }, contacts).ok).toBe(true);
  });
});

describe('rider pricing', () => {
  const event = { id: 'e1', start_date: '2026-07-01', end_date: '2026-07-03' };
  const general = { id: 'g', status: 'active', valid_from: '2026-01-01', rider_price_lines: [{ product_id: 'p1', price: 5 }, { product_id: 'p2', price: 3 }] };
  const specific = { id: 's', status: 'active', event_id: 'e1', rider_price_lines: [{ product_id: 'p1', price: 4.2 }] };

  it('checks status, event and dates', () => {
    expect(agreementAppliesTo(general, event)).toBe(true);
    expect(agreementAppliesTo({ ...general, status: 'draft' }, event)).toBe(false);
    expect(agreementAppliesTo({ ...specific, event_id: 'other' }, event)).toBe(false);
    expect(agreementAppliesTo({ ...general, valid_from: '2026-07-04' }, event)).toBe(false);
    expect(agreementAppliesTo({ ...general, valid_to: '2026-06-30' }, event)).toBe(false);
  });
  it('event-specific prices win, general fills the rest', () => {
    const prices = riderPricesFor([general, specific], event);
    expect(prices.get('p1')).toMatchObject({ price: 4.2, agreementId: 's' });
    expect(prices.get('p2')).toMatchObject({ price: 3, agreementId: 'g' });
  });
});
