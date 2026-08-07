/**
 * Stable cell-key adapters for spreadsheet-like admin grids.
 */

import { cellFocusKey } from './collab-presence.js';

/** @param {Element | null | undefined} input */
export function closingCellKeyFromInput(input) {
  if (!input) return null;
  return cellFocusKey(input.dataset?.clPid, input.dataset?.clField);
}

/** @param {string} cellKey @param {ParentNode} root */
export function closingFindCellEl(cellKey, root) {
  const [pid, ...fieldParts] = String(cellKey || '').split('::');
  const field = fieldParts.join('::');
  if (!pid || !field) return null;
  const input = root.querySelector?.(`#cl-${CSS.escape(field)}-${CSS.escape(pid)}`)
    || document.getElementById(`cl-${field}-${pid}`);
  return input?.closest('.cl-cell') || input?.closest('td') || null;
}

/** @param {Element | null | undefined} input */
export function distributionCellKeyFromInput(input) {
  if (!input) return null;
  const cell = input.closest?.('.dist-cell');
  return cellFocusKey(cell?.dataset?.bar, cell?.dataset?.pid);
}

/** @param {string} cellKey @param {ParentNode} root */
export function distributionFindCellEl(cellKey, root) {
  const [barId, pid] = String(cellKey || '').split('::');
  if (!barId || !pid) return null;
  return root.querySelector?.(
    `.dist-cell[data-bar="${CSS.escape(barId)}"][data-pid="${CSS.escape(pid)}"]`,
  ) || null;
}

/** @param {Element | null | undefined} input */
export function countsCellKeyFromInput(input) {
  if (!input) return null;
  const side = input.classList?.contains('cnt-inp--secondary') ? 'secondary' : 'primary';
  return cellFocusKey(input.dataset?.bar, input.dataset?.pid, side);
}

/** @param {string} cellKey @param {ParentNode} root */
export function countsFindCellEl(cellKey, root) {
  const [barId, pid, side] = String(cellKey || '').split('::');
  if (!barId || !pid || !side) return null;
  const cls = side === 'secondary' ? 'cnt-inp--secondary' : 'cnt-inp--primary';
  const input = root.querySelector?.(
    `.${cls}[data-bar="${CSS.escape(barId)}"][data-pid="${CSS.escape(pid)}"]`,
  );
  return input?.closest('td') || input?.closest('.cnt-cell') || input?.parentElement || null;
}

/** @param {Element | null | undefined} input */
export function reconCellKeyFromInput(input) {
  if (!input) return null;
  const pid = input.dataset?.rcnPid;
  const col = input.closest?.('[data-rcn-col]')?.dataset?.rcnCol
    || (input.id?.startsWith('rcn-') ? input.id.slice(4, input.id.lastIndexOf('-')) : '');
  return cellFocusKey(pid, col);
}

/** @param {string} cellKey @param {ParentNode} root */
export function reconFindCellEl(cellKey, root) {
  const [pid, ...colParts] = String(cellKey || '').split('::');
  const col = colParts.join('::');
  if (!pid || !col) return null;
  const cell = root.querySelector?.(
    `tr[data-rcn-pid="${CSS.escape(pid)}"] [data-rcn-col="${CSS.escape(col)}"]`,
  );
  return cell || null;
}

/** @param {Element | null | undefined} input */
export function productsCellKeyFromInput(input) {
  if (!input) return null;
  const pid = input.dataset?.pid
    || (input.id?.startsWith('epOrd-') ? input.id.slice('epOrd-'.length) : null)
    || input.closest?.('[data-pid]')?.dataset?.pid;
  return cellFocusKey(pid, 'ordered');
}

/** @param {string} cellKey @param {ParentNode} root */
export function productsFindCellEl(cellKey, root) {
  const [pid] = String(cellKey || '').split('::');
  if (!pid) return null;
  const input = root.querySelector?.(`#epOrd-${CSS.escape(pid)}`)
    || document.getElementById(`epOrd-${pid}`);
  return input?.closest('td') || input?.parentElement || null;
}

/** @param {Element | null | undefined} input */
export function kitCellKeyFromInput(input) {
  if (!input) return null;
  const row = input.closest?.('[data-item-id], [data-pid]');
  const itemId = row?.dataset?.itemId || row?.dataset?.pid || input.dataset?.itemId;
  const field = input.dataset?.field || 'qty';
  return cellFocusKey(itemId, field);
}

/** @param {string} cellKey @param {ParentNode} root */
export function kitFindCellEl(cellKey, root) {
  const [itemId, field] = String(cellKey || '').split('::');
  if (!itemId || !field) return null;
  const input = root.querySelector?.(
    `.kit-pack-inp[data-field="${CSS.escape(field)}"]`,
  );
  // Prefer matching row when multiple pack inputs share a field name pattern
  const candidates = root.querySelectorAll?.(
    `.kit-pack-inp[data-field="${CSS.escape(field)}"]`,
  ) || [];
  for (const el of candidates) {
    const row = el.closest('[data-item-id], [data-pid]');
    const id = row?.dataset?.itemId || row?.dataset?.pid;
    if (id === itemId) return el.closest('td') || el.parentElement;
  }
  return input?.closest('td') || input?.parentElement || null;
}

/** @param {Element | null | undefined} input */
export function salesCellKeyFromInput(input) {
  if (!input) return null;
  const row = input.closest?.('tr');
  if (!row) return null;
  const stack = input.closest('.mod-portion-cell') || row;
  const qtys = [...(stack.querySelectorAll?.('.mod-ing-qty') || [])];
  const idx = Math.max(0, qtys.indexOf(input));
  if (row.dataset?.tillName != null) {
    return cellFocusKey('till', row.dataset.tillName, row.dataset.tillVar || '', String(idx));
  }
  if (row.dataset?.modSet != null || row.dataset?.modName != null) {
    return cellFocusKey('mod', row.dataset.modSet || '', row.dataset.modName || '', String(idx));
  }
  return null;
}

/** @param {string} cellKey @param {ParentNode} root */
export function salesFindCellEl(cellKey, root) {
  const parts = String(cellKey || '').split('::');
  const kind = parts[0];
  const idx = Number(parts[3]) || 0;
  if (kind === 'till') {
    const [, name, variant] = parts;
    const row = [...(root.querySelectorAll?.('tr[data-till-name]') || [])].find((tr) => (
      tr.dataset.tillName === name && (tr.dataset.tillVar || '') === (variant || '')
    ));
    if (!row) return null;
    const input = row.querySelectorAll('.mod-portion-cell .mod-ing-qty')[idx]
      || row.querySelectorAll('.mod-ing-qty')[idx];
    return input?.closest('td') || input?.parentElement || null;
  }
  if (kind === 'mod') {
    const [, set, name] = parts;
    const row = [...(root.querySelectorAll?.('tr[data-mod-name], tr[data-mod-set]') || [])].find((tr) => (
      (tr.dataset.modSet || '') === (set || '') && (tr.dataset.modName || '') === (name || '')
    ));
    if (!row) return null;
    const input = row.querySelectorAll('.mod-portion-cell .mod-ing-qty')[idx]
      || row.querySelectorAll('.mod-ing-qty')[idx];
    return input?.closest('td') || input?.parentElement || null;
  }
  return null;
}

/** @param {Element | null | undefined} input */
export function reportsCellKeyFromInput(input) {
  if (!input) return null;
  if (input.classList?.contains('reports-markup-input')) {
    return cellFocusKey('markup', input.dataset?.markupRecipient || 'default');
  }
  if (input.classList?.contains('reports-price-input')) {
    return cellFocusKey('price', input.dataset?.priceKey || input.dataset?.priceRecipient || '');
  }
  return null;
}

/** @param {string} cellKey @param {ParentNode} root */
export function reportsFindCellEl(cellKey, root) {
  const [kind, id] = String(cellKey || '').split('::');
  if (kind === 'markup') {
    const input = root.querySelector?.(
      `.reports-markup-input[data-markup-recipient="${CSS.escape(id)}"]`,
    );
    return input?.closest('label') || input?.closest('td') || input?.parentElement || null;
  }
  if (kind === 'price') {
    const input = root.querySelector?.(
      `.reports-price-input[data-price-key="${CSS.escape(id)}"]`,
    );
    return input?.closest('td') || input?.parentElement || null;
  }
  return null;
}
