import { describe, expect, it } from 'vitest';
import {
  planningCellMark,
  planningRowMark,
  readPlanningMarks,
  setPlanningMark,
  writePlanningMarks,
} from './planning-marks.js';

function memory() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

describe('planning marks', () => {
  it('sets a cell colour without wiping the row colour', () => {
    let marks = {};
    marks = setPlanningMark(marks, 'p:1', 'row', 'green');
    marks = setPlanningMark(marks, 'p:1', 'menu', 'amber');
    expect(planningRowMark(marks, 'p:1')).toBe('green');
    expect(planningCellMark(marks, 'p:1', 'menu')).toBe('amber');
    expect(planningCellMark(marks, 'p:1', 'gp')).toBe('');
  });

  it('drops a row once every colour is cleared', () => {
    let marks = setPlanningMark({}, 'c:2', 'gp', 'rose');
    marks = setPlanningMark(marks, 'c:2', 'gp', '');
    expect(marks).toEqual({});
  });

  it('ignores an unknown colour', () => {
    const marks = { 'p:1': { row: 'sky' } };
    expect(setPlanningMark(marks, 'p:1', 'menu', 'neon')).toBe(marks);
  });

  it('round-trips one event and ignores junk', () => {
    const storage = memory();
    writePlanningMarks(storage, 'event-a', {
      'p:1': { row: 'sand', cells: { menu: 'violet', nope: 'nope' } },
      bad: { row: 'green' },
    });
    writePlanningMarks(storage, 'event-b', { 'c:9': { cells: { cost: 'amber' } } });
    expect(readPlanningMarks(storage, 'event-a')).toEqual({
      'p:1': { row: 'sand', cells: { menu: 'violet' } },
    });
    expect(readPlanningMarks(storage, 'event-b')['c:9'].cells.cost).toBe('amber');
    writePlanningMarks(storage, 'event-a', {});
    writePlanningMarks(storage, 'event-b', {});
    expect(readPlanningMarks(storage, 'event-a')).toEqual({});
    expect(storage.getItem('v5PlanningMarks')).toBeNull();
  });
});
