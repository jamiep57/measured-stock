import { describe, expect, it } from 'vitest';
import { missingEventProductIds } from './planning-data.js';

describe('missingEventProductIds', () => {
  it('keeps products that are not on the event yet', () => {
    expect(missingEventProductIds(['a', 'b'], [{ product_id: 'a' }])).toEqual(['b']);
  });

  it('skips blanks and repeats', () => {
    expect(missingEventProductIds(['a', '', null, 'a'], [])).toEqual(['a']);
  });

  it('leaves an event that already has every product alone', () => {
    expect(missingEventProductIds(['a'], [{ product_id: 'a' }, { product_id: 'b' }])).toEqual([]);
  });
});
