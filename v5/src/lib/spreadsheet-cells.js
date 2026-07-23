/**
 * Spreadsheet-style keyboard navigation + simple cell math for admin grids.
 * Arrow keys move between cells; Enter moves down; expressions like 4+10 evaluate on commit.
 */

import { parseQty } from '../stock-entry.js';

export const SPREADSHEET_INPUT_SELECTOR = [
  '.dist-pill-input',
  '.cnt-inp',
  '.recon-cell-input',
  '.ep-ordered-input',
  '.del-line-cases',
  '.del-line-singles',
  '.del-line-dmg',
  '.del-line-inv-cases',
  '.del-line-inv-singles',
  '.mod-ing-qty',
  '.fraction-input',
].join(',');

const MATH_EXPR = /[+\-*/()]/;

/**
 * Evaluate a cell expression for display. Returns numeric result when math was used.
 * @param {string} raw
 */
export function evalCellExpression(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { display: '', numeric: 0, evaluated: false };

  if (!MATH_EXPR.test(s)) {
    const numeric = parseQty(s);
    return { display: s, numeric, evaluated: false };
  }

  if (!/^[0-9+\-*/().\s]+$/.test(s)) {
    return { display: s, numeric: parseQty(s), evaluated: false };
  }

  try {
    const val = Function('"use strict";return (' + s + ')')();
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
      return { display: s, numeric: parseQty(s), evaluated: false };
    }
    const display = Number.isInteger(val) ? String(val) : String(Math.round(val * 1000) / 1000);
    return { display, numeric: val, evaluated: true };
  } catch {
    return { display: s, numeric: parseQty(s), evaluated: false };
  }
}

export function isSpreadsheetInput(el) {
  return !!(el?.matches?.(SPREADSHEET_INPUT_SELECTOR) && !el.disabled && !el.readOnly);
}

function isVisible(el) {
  return !!(el.offsetParent || el.getClientRects().length);
}

function collectRowInputs(rowEl) {
  return [...rowEl.querySelectorAll(SPREADSHEET_INPUT_SELECTOR)]
    .filter((el) => isSpreadsheetInput(el) && isVisible(el));
}

export function buildNavigationMatrix(input) {
  const table = input.closest('table');
  if (table) {
    const matrix = [];
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const row = collectRowInputs(tr);
      if (row.length) matrix.push(row);
    });
    if (matrix.length) return matrix;
  }

  const linesRoot = input.closest('.del-lines-committed, .del-lines, #dfLines, #wfLines, #xfLines');
  if (linesRoot) {
    const matrix = [];
    linesRoot.querySelectorAll('.del-line-card').forEach((card) => {
      const row = collectRowInputs(card);
      if (row.length) matrix.push(row);
    });
    if (matrix.length) return matrix;
  }

  const panel = input.closest('.admin-content, .dist-panel, .cnt-panel, .ep-panel, .mod-panel, .sales-panel, #sheetBody');
  if (panel) {
    const flat = [...panel.querySelectorAll(SPREADSHEET_INPUT_SELECTOR)]
      .filter((el) => isSpreadsheetInput(el) && isVisible(el));
    if (flat.length) return flat.map((el) => [el]);
  }

  return null;
}

export function locateInMatrix(matrix, input) {
  for (let r = 0; r < matrix.length; r += 1) {
    const c = matrix[r].indexOf(input);
    if (c >= 0) return { r, c };
  }
  return null;
}

function caretAtStart(input) {
  if (input.selectionStart == null) return true;
  return input.selectionStart === 0 && input.selectionEnd === 0;
}

function caretAtEnd(input) {
  if (input.selectionStart == null) return true;
  return input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
}

export function commitSpreadsheetCell(input) {
  if (!isSpreadsheetInput(input)) return false;
  if (input.matches('.fraction-input, .mod-ing-qty')) return false;

  const { display, evaluated } = evalCellExpression(input.value);
  if (!evaluated || display === input.value) return false;
  input.value = display;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function focusCell(matrix, r, c) {
  const row = matrix[r];
  if (!row?.length) return;
  const col = Math.max(0, Math.min(c, row.length - 1));
  const next = row[col];
  if (!next) return;
  next.focus();
  next.select?.();
}

function handleNavigationKey(e) {
  if (!isSpreadsheetInput(e.target)) return;

  const matrix = buildNavigationMatrix(e.target);
  if (!matrix?.length) return;

  const pos = locateInMatrix(matrix, e.target);
  if (!pos) return;

  let { r, c } = pos;
  let navigate = false;

  switch (e.key) {
    case 'Enter':
      e.preventDefault();
      commitSpreadsheetCell(e.target);
      r = Math.min(r + 1, matrix.length - 1);
      navigate = true;
      break;
    case 'ArrowDown':
      e.preventDefault();
      r = Math.min(r + 1, matrix.length - 1);
      navigate = true;
      break;
    case 'ArrowUp':
      e.preventDefault();
      r = Math.max(r - 1, 0);
      navigate = true;
      break;
    case 'ArrowRight':
      if (caretAtEnd(e.target)) {
        e.preventDefault();
        c = Math.min(c + 1, matrix[r].length - 1);
        navigate = true;
      }
      break;
    case 'ArrowLeft':
      if (caretAtStart(e.target)) {
        e.preventDefault();
        c = Math.max(c - 1, 0);
        navigate = true;
      }
      break;
    case 'Escape':
      e.target.blur();
      break;
    default:
      break;
  }

  if (navigate) {
    focusCell(matrix, r, c);
  }
}

/**
 * @param {ParentNode} root
 * @returns {() => void}
 */
export function initSpreadsheetCells(root = document) {
  const onKeyDown = (e) => handleNavigationKey(e);
  const onBlur = (e) => {
    if (!isSpreadsheetInput(e.target)) return;
    commitSpreadsheetCell(e.target);
  };

  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('blur', onBlur, true);

  return () => {
    root.removeEventListener('keydown', onKeyDown);
    root.removeEventListener('blur', onBlur, true);
  };
}
