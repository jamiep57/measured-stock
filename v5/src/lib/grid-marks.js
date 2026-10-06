/**
 * Cell and row colours for every admin grid except Menu & GP,
 * which keeps its own marks. One store per page address.
 */

import { isPlanningMark, setPlanningMark } from './planning-marks.js';

export const GRID_MARKS_KEY = 'v5GridMarks';

function cleanRow(row) {
  if (!row || typeof row !== 'object') return null;
  const out = {};
  if (isPlanningMark(row.row) && row.row) out.row = row.row;
  const cells = {};
  if (row.cells && typeof row.cells === 'object') {
    Object.entries(row.cells).forEach(([col, color]) => {
      if (typeof col === 'string' && col && isPlanningMark(color) && color) cells[col] = color;
    });
  }
  if (Object.keys(cells).length) out.cells = cells;
  return out.row || out.cells ? out : null;
}

export function readGridMarks(storage, scopeId) {
  if (!storage || !scopeId) return {};
  try {
    const all = JSON.parse(storage.getItem(GRID_MARKS_KEY) || '{}');
    const scope = all?.[scopeId];
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return {};
    const out = {};
    Object.entries(scope).forEach(([key, row]) => {
      if (typeof key !== 'string' || !key) return;
      const clean = cleanRow(row);
      if (clean) out[key] = clean;
    });
    return out;
  } catch {
    return {};
  }
}

export function writeGridMarks(storage, scopeId, marks) {
  if (!storage || !scopeId) return;
  try {
    const raw = JSON.parse(storage.getItem(GRID_MARKS_KEY) || '{}');
    const all = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    if (!marks || !Object.keys(marks).length) delete all[scopeId];
    else all[scopeId] = marks;
    if (Object.keys(all).length) storage.setItem(GRID_MARKS_KEY, JSON.stringify(all));
    else storage.removeItem(GRID_MARKS_KEY);
  } catch {
    /* private mode or a full quota */
  }
}

export function gridRowMark(marks, rowKey) {
  return marks?.[rowKey]?.row || '';
}

export function gridCellMark(marks, rowKey, colId) {
  return marks?.[rowKey]?.cells?.[colId] || '';
}

/**
 * Colour for one cell. `legacyColId` is the old column-index key (`i:2`).
 * A real column id wins. The index key is only a fallback so colours saved
 * before cells had their own ids still show, until that cell is coloured again.
 */
export function resolveGridCellMark(marks, rowKey, colId, legacyColId = '') {
  const direct = gridCellMark(marks, rowKey, colId);
  if (direct || !legacyColId || legacyColId === colId) return direct;
  return gridCellMark(marks, rowKey, legacyColId);
}

export function setGridMark(marks, rowKey, target, color) {
  return setPlanningMark(marks, rowKey, target, color);
}
