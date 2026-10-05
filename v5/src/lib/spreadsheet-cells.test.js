import { describe, it, expect } from 'vitest';
import {
  evalCellExpression,
  locateInMatrix,
} from './spreadsheet-cells.js';

describe('evalCellExpression', () => {
  it('evaluates basic arithmetic', () => {
    const r = evalCellExpression('4+10');
    expect(r.evaluated).toBe(true);
    expect(r.display).toBe('14');
    expect(r.numeric).toBe(14);
  });

  it('evaluates chained operations', () => {
    const r = evalCellExpression('2*3+4');
    expect(r.evaluated).toBe(true);
    expect(r.display).toBe('10');
  });

  it('leaves plain numbers unchanged', () => {
    const r = evalCellExpression('12');
    expect(r.evaluated).toBe(false);
    expect(r.display).toBe('12');
  });

  it('handles empty input', () => {
    const r = evalCellExpression('');
    expect(r.display).toBe('');
    expect(r.numeric).toBe(0);
  });

  it('rejects invalid expressions', () => {
    const r = evalCellExpression('4+abc');
    expect(r.evaluated).toBe(false);
  });
});

describe('locateInMatrix', () => {
  it('finds row and column index', () => {
    const a = {};
    const b = {};
    const matrix = [[a, b], [b, a]];
    expect(locateInMatrix(matrix, b)).toEqual({ r: 0, c: 1 });
    expect(locateInMatrix(matrix, a)).toEqual({ r: 0, c: 0 });
  });
});
