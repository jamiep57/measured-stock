import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeDestType,
  DEST_EVENT,
  loadStoredDestination,
  storeDestination,
  eventPackLines,
} from './kit-count-dest.js';

describe('kit-count-dest', () => {
  const mem = new Map();
  beforeEach(() => {
    mem.clear();
    globalThis.localStorage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => { mem.set(k, String(v)); },
      removeItem: (k) => { mem.delete(k); },
      clear: () => { mem.clear(); },
    };
  });

  it('normalizes destination types', () => {
    expect(normalizeDestType('event')).toBe(DEST_EVENT);
    expect(normalizeDestType('nope')).toBeNull();
    expect(normalizeDestType('library')).toBeNull();
  });

  it('stores and loads destination', () => {
    expect(loadStoredDestination()).toBeNull();
    storeDestination({ type: DEST_EVENT, eventId: 'e1', eventName: 'Gala' });
    expect(loadStoredDestination()).toEqual({
      type: DEST_EVENT,
      eventId: 'e1',
      eventName: 'Gala',
    });
  });

  it('builds event pack display lines', () => {
    const lines = eventPackLines([
      { product_id: 'a', qty_packed: 0, product: { name: 'A' } },
      { product_id: 'b', qty_packed: 2, product: { name: 'B' } },
    ]);
    expect(lines).toEqual([
      { product_id: 'b', qty: 2, product: { name: 'B' } },
    ]);
  });
});
