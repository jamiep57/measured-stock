import { describe, it, expect } from 'vitest';
import {
  normalizeLabelCopies,
  pendingLabelQueueStats,
} from './kit-label-queue.js';

describe('kit-label-queue', () => {
  it('normalizes copies', () => {
    expect(normalizeLabelCopies()).toBe(1);
    expect(normalizeLabelCopies(0)).toBe(1);
    expect(normalizeLabelCopies(3.9)).toBe(3);
    expect(normalizeLabelCopies(100)).toBe(50);
  });

  it('sums pending stats', () => {
    expect(pendingLabelQueueStats([])).toEqual({ items: 0, copies: 0 });
    expect(pendingLabelQueueStats([{ copies: 1 }, { copies: 3 }]))
      .toEqual({ items: 2, copies: 4 });
  });
});
