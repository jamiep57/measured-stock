import { describe, it, expect } from 'vitest';
import { splitPalletQtys } from './pallet-sticker-pdf.js';

describe('splitPalletQtys', () => {
  it('returns empty when qty is 0', () => {
    expect(splitPalletQtys(0, 48)).toEqual([]);
  });

  it('puts all on one pallet when per-pallet unset', () => {
    expect(splitPalletQtys(20, 0)).toEqual([20]);
  });

  it('splits into full pallets plus remainder', () => {
    expect(splitPalletQtys(100, 48)).toEqual([48, 48, 4]);
  });

  it('handles exact multiples', () => {
    expect(splitPalletQtys(96, 48)).toEqual([48, 48]);
  });
});
