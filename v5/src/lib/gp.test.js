import { describe, it, expect } from 'vitest';
import {
  costPerServe,
  gpPct,
  gpPerServe,
  gpStatus,
  mixGp,
  netFromGross,
  requiredPrice,
  roundUpToStep,
} from './gp.js';

describe('netFromGross', () => {
  it('strips 20% VAT', () => {
    expect(netFromGross(6, 0.2)).toBeCloseTo(5, 10);
  });
  it('defaults to 20% when VAT is missing or invalid', () => {
    expect(netFromGross(12)).toBeCloseTo(10, 10);
    expect(netFromGross(12, 'x')).toBeCloseTo(10, 10);
  });
  it('supports zero-rated items', () => {
    expect(netFromGross(5, 0)).toBe(5);
  });
});

describe('gpPct', () => {
  it('measures GP on the ex-VAT price', () => {
    // £6.00 inc VAT = £5.00 net; cost £1.50 → 70% GP
    expect(gpPct(6, 1.5, 0.2)).toBeCloseTo(70, 10);
  });
  it('is negative when cost exceeds net price', () => {
    expect(gpPct(1.2, 2, 0.2)).toBeCloseTo(-100, 10);
  });
  it('returns null for missing inputs or a zero price', () => {
    expect(gpPct(null, 1, 0.2)).toBeNull();
    expect(gpPct(6, null, 0.2)).toBeNull();
    expect(gpPct(0, 1, 0.2)).toBeNull();
  });
  it('gp per serve is net minus cost', () => {
    expect(gpPerServe(6, 1.5, 0.2)).toBeCloseTo(3.5, 10);
  });
});

describe('costPerServe', () => {
  it('divides unit cost by serves', () => {
    expect(costPerServe(88, 88)).toBe(1);
  });
  it('is null without positive serves', () => {
    expect(costPerServe(10, 0)).toBeNull();
    expect(costPerServe(10, null)).toBeNull();
  });
});

describe('requiredPrice', () => {
  it('prices to hit target GP inc VAT', () => {
    // cost 1.50, 70% target → net 5.00 → £6.00 inc VAT
    expect(requiredPrice(1.5, 70, 0.2)).toBe(6);
  });
  it('rounds up so the rounded price still meets target', () => {
    const price = requiredPrice(1.37, 72, 0.2);
    expect(price).toBe(5.9);
    expect(gpPct(price, 1.37, 0.2)).toBeGreaterThanOrEqual(72);
  });
  it('rejects impossible targets', () => {
    expect(requiredPrice(1, 100, 0.2)).toBeNull();
    expect(requiredPrice(null, 70, 0.2)).toBeNull();
  });
});

describe('roundUpToStep', () => {
  it('avoids float drift on exact multiples', () => {
    expect(roundUpToStep(6.9, 0.1)).toBe(6.9);
    expect(roundUpToStep(6.825, 0.1)).toBe(6.9);
    expect(roundUpToStep(6.81, 0.05)).toBe(6.85);
  });
});

describe('gpStatus', () => {
  it('green at or above target', () => {
    expect(gpStatus(70, 70, 5)).toBe('green');
    expect(gpStatus(75, 70, 5)).toBe('green');
  });
  it('amber within the band below target', () => {
    expect(gpStatus(66, 70, 5)).toBe('amber');
    expect(gpStatus(65, 70, 5)).toBe('amber');
  });
  it('red beyond the band', () => {
    expect(gpStatus(64.9, 70, 5)).toBe('red');
  });
  it('null when GP is unknown', () => {
    expect(gpStatus(null, 70, 5)).toBeNull();
  });
});

describe('mixGp', () => {
  it('weights GP by revenue, not a simple average of percentages', () => {
    const mix = mixGp([
      { price: 6, costPerServe: 1.5, serves: 1000 }, // net 5000, cost 1500
      { price: 12, costPerServe: 6, serves: 100 }, // net 1000, cost 600
    ], 0.2);
    expect(mix.revenueNet).toBe(6000);
    expect(mix.cost).toBe(2100);
    expect(mix.gpAmount).toBe(3900);
    expect(mix.gpPct).toBeCloseTo(65, 10);
    // simple average of 70% and 40% would wrongly give 55%
  });
  it('excludes lines with missing price or cost and counts them', () => {
    const mix = mixGp([
      { price: 6, costPerServe: 1.5, serves: 10 },
      { price: null, costPerServe: 1, serves: 10 },
      { price: 5, costPerServe: 1, serves: 0 },
    ], 0.2);
    expect(mix.included).toBe(1);
    expect(mix.excluded).toBe(1);
    expect(mix.gpPct).toBeCloseTo(70, 10);
  });
  it('returns null GP with no revenue', () => {
    expect(mixGp([], 0.2).gpPct).toBeNull();
  });
});
