/**
 * Menu & GP cell and row colours.
 * Kept per event in localStorage, same place as column order.
 * A row mark tints the line. A cell mark covers that one column.
 */

export const PLANNING_MARKS_KEY = 'v5PlanningMarks';

export const PLANNING_MARK_IDS = ['sand', 'amber', 'green', 'sky', 'rose', 'violet'];

const COLORS = new Set(PLANNING_MARK_IDS);

export function isPlanningMark(color) {
  return color === '' || COLORS.has(color);
}

function cleanRow(row) {
  if (!row || typeof row !== 'object') return null;
  const out = {};
  if (COLORS.has(row.row)) out.row = row.row;
  const cells = {};
  if (row.cells && typeof row.cells === 'object') {
    Object.entries(row.cells).forEach(([col, color]) => {
      if (typeof col === 'string' && col && COLORS.has(color)) cells[col] = color;
    });
  }
  if (Object.keys(cells).length) out.cells = cells;
  return out.row || out.cells ? out : null;
}

export function readPlanningMarks(storage, eventId) {
  if (!storage || !eventId) return {};
  try {
    const all = JSON.parse(storage.getItem(PLANNING_MARKS_KEY) || '{}');
    const event = all?.[eventId];
    if (!event || typeof event !== 'object' || Array.isArray(event)) return {};
    const out = {};
    Object.entries(event).forEach(([key, row]) => {
      if (typeof key !== 'string' || !/^[pc]:/.test(key)) return;
      const clean = cleanRow(row);
      if (clean) out[key] = clean;
    });
    return out;
  } catch {
    return {};
  }
}

export function writePlanningMarks(storage, eventId, marks) {
  if (!storage || !eventId) return;
  try {
    const raw = JSON.parse(storage.getItem(PLANNING_MARKS_KEY) || '{}');
    const all = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    if (!marks || !Object.keys(marks).length) delete all[eventId];
    else all[eventId] = marks;
    if (Object.keys(all).length) storage.setItem(PLANNING_MARKS_KEY, JSON.stringify(all));
    else storage.removeItem(PLANNING_MARKS_KEY);
  } catch {
    /* private mode or a full quota */
  }
}

export function planningRowMark(marks, rowKey) {
  return marks?.[rowKey]?.row || '';
}

export function planningCellMark(marks, rowKey, colId) {
  return marks?.[rowKey]?.cells?.[colId] || '';
}

/** @param {string} target `row` or a column id. Empty color clears that mark. */
export function setPlanningMark(marks, rowKey, target, color) {
  if (!rowKey || !target || !isPlanningMark(color)) return marks || {};
  const source = marks || {};
  const cells = { ...(source[rowKey]?.cells) };
  const row = {};
  if (source[rowKey]?.row) row.row = source[rowKey].row;
  if (target === 'row') {
    if (color) row.row = color;
    else delete row.row;
  } else if (color) cells[target] = color;
  else delete cells[target];
  if (Object.keys(cells).length) row.cells = cells;
  const next = { ...source };
  if (row.row || row.cells) next[rowKey] = row;
  else delete next[rowKey];
  return next;
}
