import { describe, expect, it } from 'vitest';
import { squareSetupProgress, feedTotals } from './square-setup.js';

const base = {
  connected: false,
  barCount: 4,
  linkedCount: 0,
  squareLines: 0,
  uploadLines: 0,
  salesSource: 'csv',
};

describe('squareSetupProgress', () => {
  it('starts on connect when Square is not connected', () => {
    const p = squareSetupProgress(base);
    expect(p.current).toBe(0);
    expect(p.doneCount).toBe(0);
    expect(p.complete).toBe(false);
  });

  it('linking needs every serving bar and at least one bar', () => {
    expect(squareSetupProgress({ ...base, connected: true, linkedCount: 3 }).current).toBe(1);
    expect(squareSetupProgress({ ...base, connected: true, barCount: 0 }).current).toBe(1);
    expect(squareSetupProgress({ ...base, connected: true, linkedCount: 4 }).current).toBe(2);
  });

  it('compare is skipped when there is no upload, otherwise needs a look', () => {
    const ready = { ...base, connected: true, linkedCount: 4, squareLines: 10 };
    expect(squareSetupProgress(ready).current).toBe(4);
    expect(squareSetupProgress({ ...ready, uploadLines: 5 }).current).toBe(3);
    expect(squareSetupProgress({ ...ready, uploadLines: 5, compareSeen: true }).current).toBe(4);
  });

  it('is complete once projections use Square', () => {
    const p = squareSetupProgress({ ...base, connected: true, linkedCount: 4, squareLines: 10, uploadLines: 5, salesSource: 'square' });
    expect(p.complete).toBe(true);
    expect(p.doneCount).toBe(5);
  });
});

describe('feedTotals', () => {
  it('sums items and net sales', () => {
    expect(feedTotals([{ items_sold: 2, net_sales: 13.9 }, { items_sold: 1, net_sales: 7.455 }]))
      .toEqual({ lines: 2, items: 3, net: 21.36 });
    expect(feedTotals(null)).toEqual({ lines: 0, items: 0, net: 0 });
  });
});
