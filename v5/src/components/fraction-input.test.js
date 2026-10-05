import { describe, it, expect } from 'vitest';
import { parseFractionQty, formatQtyAsFraction, displayFractionQty } from './fraction-input.js';

describe('parseFractionQty', () => {
  it('parses decimals', () => {
    expect(parseFractionQty('0.5')).toBe(0.5);
  });

  it('parses fractions without requiring display conversion', () => {
    expect(parseFractionQty('1/24')).toBeCloseTo(1 / 24, 6);
    expect(parseFractionQty('1/28')).toBeCloseTo(1 / 28, 6);
  });

  it('parses compound expressions', () => {
    expect(parseFractionQty('3/24+1/48')).toBeCloseTo(3 / 24 + 1 / 48, 6);
  });
});

describe('formatQtyAsFraction', () => {
  it('formats common bottle fractions', () => {
    expect(formatQtyAsFraction(1 / 24)).toBe('1/24');
    expect(formatQtyAsFraction(1 / 28)).toBe('1/28');
    expect(formatQtyAsFraction(1)).toBe('1');
    expect(formatQtyAsFraction(2)).toBe('2');
  });

  it('prefers stored author text', () => {
    expect(displayFractionQty({ qty: 0.041666, qty_text: '3/24+1/48' })).toBe('3/24+1/48');
    expect(displayFractionQty({ qty: 1 / 24 })).toBe('1/24');
  });
});
