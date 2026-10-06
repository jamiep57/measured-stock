import test from 'node:test';
import assert from 'node:assert/strict';
import { squareSetupProgress, feedTotals } from './square-setup.js';

const base = {
  connected: false,
  barCount: 4,
  linkedCount: 0,
  squareLines: 0,
  uploadLines: 0,
  salesSource: 'csv',
};

test('starts on connect when Square is not connected', () => {
  const p = squareSetupProgress(base);
  assert.equal(p.current, 0);
  assert.equal(p.doneCount, 0);
  assert.equal(p.complete, false);
});

test('linking needs every serving bar and at least one bar', () => {
  assert.equal(squareSetupProgress({ ...base, connected: true, linkedCount: 3 }).current, 1);
  assert.equal(squareSetupProgress({ ...base, connected: true, barCount: 0 }).current, 1);
  assert.equal(squareSetupProgress({ ...base, connected: true, linkedCount: 4 }).current, 2);
});

test('compare is skipped when there is no upload, otherwise needs a look', () => {
  const ready = { ...base, connected: true, linkedCount: 4, squareLines: 10 };
  assert.equal(squareSetupProgress(ready).current, 4);
  assert.equal(squareSetupProgress({ ...ready, uploadLines: 5 }).current, 3);
  assert.equal(squareSetupProgress({ ...ready, uploadLines: 5, compareSeen: true }).current, 4);
});

test('complete once projections use Square', () => {
  const p = squareSetupProgress({ ...base, connected: true, linkedCount: 4, squareLines: 10, uploadLines: 5, salesSource: 'square' });
  assert.equal(p.complete, true);
  assert.equal(p.doneCount, 5);
});

test('feedTotals sums items and net sales', () => {
  assert.deepEqual(
    feedTotals([{ items_sold: 2, net_sales: 13.9 }, { items_sold: 1, net_sales: 7.455 }]),
    { lines: 2, items: 3, net: 21.36 },
  );
  assert.deepEqual(feedTotals(null), { lines: 0, items: 0, net: 0 });
});
