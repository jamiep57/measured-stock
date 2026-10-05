import { describe, expect, it } from 'vitest';
import { gridCellMark, gridRowMark, readGridMarks, setGridMark, writeGridMarks } from './grid-marks.js';

function memory() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

describe('grid marks', () => {
  it('keeps one page’s colours apart from another', () => {
    const storage = memory();
    let orders = setGridMark({}, 'id:1', 'i:2', 'amber');
    orders = setGridMark(orders, 'id:1', 'row', 'green');
    writeGridMarks(storage, '/events/a/orders', orders);
    writeGridMarks(storage, '/events/a/closing', setGridMark({}, 'id:1', 'row', 'rose'));
    expect(gridCellMark(readGridMarks(storage, '/events/a/orders'), 'id:1', 'i:2')).toBe('amber');
    expect(gridRowMark(readGridMarks(storage, '/events/a/orders'), 'id:1')).toBe('green');
    expect(gridRowMark(readGridMarks(storage, '/events/a/closing'), 'id:1')).toBe('rose');
    expect(readGridMarks(storage, '/events/a/orders')['id:1'].cells).toEqual({ 'i:2': 'amber' });
  });
});
