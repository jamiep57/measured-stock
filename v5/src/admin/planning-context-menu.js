/**
 * Right-click menu for a Menu & GP row.
 * Colour is local. The other actions edit the event menu.
 */

import { escapeHtml } from '../lib/util.js';
import { drinkKindMeta } from '../lib/menu-cocktails.js';
import { PLANNING_MARK_IDS } from '../lib/planning-marks.js';

const COLUMN_LABELS = {
  product: 'Product',
  size: 'Serve size',
  serve: 'Serves',
  cost: 'Cost',
  menu: 'Menu £',
  target: 'Target GP',
  required: 'Required price',
  suggested: 'Suggested price',
  gp: 'GP',
  serves: 'Target serves',
  revenue: 'Revenue',
  'gp-amount': 'GP £',
  deal: 'Deal cost',
  'deal-ref': 'Deal reference',
};

const PRODUCT_FIELDS = {
  size: 'serve_label',
  serve: 'serves_per_unit',
  menu: 'menu_price',
  target: 'target_gp_pct',
  suggested: 'suggested_price',
  serves: 'projected_serves',
  deal: 'unit_cost_override',
  'deal-ref': 'deal_ref',
};

const COCKTAIL_FIELDS = {
  size: 'serve_label',
  menu: 'menu_price',
  target: 'target_gp_pct',
  suggested: 'suggested_price',
  serves: 'projected_serves',
};

const MARK_LABELS = {
  '': 'None',
  sand: 'Sand',
  amber: 'Amber',
  green: 'Green',
  sky: 'Sky',
  rose: 'Rose',
  violet: 'Violet',
};

export function planningColumnLabel(colId) {
  if (typeof colId === 'string' && colId.startsWith('scenario:')) return 'Scenario';
  return COLUMN_LABELS[colId] || 'Cell';
}

/** Field written by Clear / Paste, or `scenario` for a scenario price. */
export function editablePlanningField(kind, colId) {
  if (typeof colId === 'string' && colId.startsWith('scenario:')) {
    return kind === 'product' ? 'scenario' : null;
  }
  const map = kind === 'cocktail' ? COCKTAIL_FIELDS : PRODUCT_FIELDS;
  return map[colId] || null;
}

/**
 * @returns {{ cell: object[], item: object[] }}
 */
export function planningContextActions({ kind, drinkKind, included, colId, locked, hasRequired }) {
  const cell = [];
  const item = [];
  const editable = !locked && !!editablePlanningField(kind, colId);
  const drink = drinkKindMeta(drinkKind).label.toLowerCase();
  if (!locked && hasRequired) {
    cell.push({ id: 'use-required', label: 'Use required price' });
  }
  if (editable) cell.push({ id: 'paste', label: 'Paste' });
  cell.push({ id: 'copy', label: 'Copy cell' });
  cell.push({ id: 'copy-name', label: 'Copy name' });
  if (editable) cell.push({ id: 'clear', label: 'Clear cell' });

  if (kind === 'cocktail') {
    item.push({ id: 'edit-cocktail', label: `Edit ${drink}`, note: 'Recipe, price and section' });
  } else if (!locked) {
    item.push({
      id: 'add-size',
      label: 'Add another size',
      note: 'Same product, its own price. A half is 0.5 of one serve.',
    });
    item.push({
      id: 'make-cocktail',
      label: 'Make into cocktail',
      note: 'One measure of this product. This line comes off the menu.',
    });
    item.push({
      id: 'make-spirit-mixer',
      label: 'Make into spirit & mixer',
      note: 'Spirit plus what it’s mixed with. This line comes off the menu.',
    });
  }
  if (!locked) {
    item.push({
      id: 'toggle-menu',
      label: included ? 'Remove from menu' : 'Put back on menu',
      danger: !!included,
      note: included
        ? (kind === 'cocktail' ? 'The recipe stays under Off menu.' : 'The product stays in the library.')
        : '',
    });
    if (kind === 'cocktail') {
      item.push({ id: 'delete-cocktail', label: `Delete ${drink}`, danger: true, note: 'Removes the recipe from this event.' });
    }
  }
  return { cell, item };
}

/** Keep a fixed menu inside the viewport. `point` is the preferred top-left. */
export function placeContextMenu(box, point, viewport, pad = 8) {
  const width = Number(box?.width) || 0;
  const height = Number(box?.height) || 0;
  const viewW = Number(viewport?.width) || 0;
  const viewH = Number(viewport?.height) || 0;
  let left = Number(point?.x) || 0;
  let top = Number(point?.y) || 0;
  if (left + width > viewW - pad) left = (Number(point?.x) || 0) - width;
  if (top + height > viewH - pad) top = (Number(point?.y) || 0) - height;
  const maxLeft = Math.max(pad, viewW - width - pad);
  const maxTop = Math.max(pad, viewH - height - pad);
  return {
    left: Math.min(Math.max(pad, left), maxLeft),
    top: Math.min(Math.max(pad, top), maxTop),
  };
}

function itemHtml(action) {
  const note = action.note
    ? `<span class="plan-ctx-note">${escapeHtml(action.note)}</span>`
    : '';
  const hint = action.hint
    ? `<span class="plan-ctx-hint">${escapeHtml(action.hint)}</span>`
    : '';
  return `<button type="button" class="plan-ctx-item${action.danger ? ' plan-ctx-item--danger' : ''}" role="menuitem" data-action="${escapeHtml(action.id)}">
    <span class="plan-ctx-item-copy"><span>${escapeHtml(action.label)}</span>${note}</span>
    ${hint}
  </button>`;
}

function swatchHtml(id, checked) {
  const none = id ? '' : ' plan-ctx-swatch--none';
  return `<button type="button" class="plan-ctx-swatch${none}" data-mark="${escapeHtml(id)}" role="radio" aria-checked="${checked ? 'true' : 'false'}" aria-label="${escapeHtml(MARK_LABELS[id] || id)}"></button>`;
}

let closeCurrent = null;

export function closePlanningContextMenu() {
  if (closeCurrent) closeCurrent();
}

/**
 * @param {{
 *   x: number,
 *   y: number,
 *   title: string,
 *   columnLabel: string,
 *   scope: 'cell'|'row',
 *   marks: { cell?: string, row?: string },
 *   actions: { cell: object[], item: object[] },
 *   anchor?: HTMLElement|null,
 *   onColor: (scope: 'cell'|'row', color: string) => void,
 *   onAction: (id: string) => void,
 *   onClose?: () => void,
 * }} opts
 */
export function openPlanningContextMenu(opts) {
  closePlanningContextMenu();
  const itemOnly = opts.colorMode === 'item';
  const keepOpen = opts.keepOpenSelector || 'tr.plan-row, tr.plan-sub-row';
  const scopeState = { value: itemOnly || opts.scope === 'row' ? 'row' : 'cell' };
  const marks = { cell: opts.marks?.cell || '', row: opts.marks?.row || '' };
  const root = document.createElement('div');
  root.className = 'plan-ctx';
  root.setAttribute('role', 'menu');
  root.tabIndex = -1;
  root.setAttribute('aria-label', `${opts.title}, ${opts.columnLabel}`);

  const actions = opts.actions || { cell: [], item: [] };
  const cellItems = (actions.cell || []).map(itemHtml).join('');
  const itemItems = (actions.item || []).map(itemHtml).join('');
  root.innerHTML = `
    <div class="plan-ctx-head">
      <div class="plan-ctx-title">${escapeHtml(opts.title)}</div>
      <div class="plan-ctx-sub" data-sub></div>
    </div>
    <div class="plan-ctx-label">Colour</div>
    ${itemOnly ? '' : `<div class="plan-ctx-scope" role="radiogroup" aria-label="Where to apply the colour">
      <button type="button" data-scope="cell" role="radio">This cell</button>
      <button type="button" data-scope="row" role="radio">Whole row</button>
    </div>`}
    <div class="plan-ctx-swatches" role="radiogroup" aria-label="Colour">
      ${['', ...PLANNING_MARK_IDS].map((id) => swatchHtml(id, false)).join('')}
    </div>
    ${cellItems ? `<div class="plan-ctx-sep"></div>${cellItems}` : ''}
    ${itemItems ? `<div class="plan-ctx-sep"></div>${itemItems}` : ''}`;

  document.body.appendChild(root);
  if (opts.anchor) opts.anchor.setAttribute('aria-expanded', 'true');

  const sub = root.querySelector('[data-sub]');

  function paintScope() {
    root.querySelectorAll('[data-scope]').forEach((btn) => {
      const on = btn.dataset.scope === scopeState.value;
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    const current = itemOnly || scopeState.value === 'row' ? marks.row : marks.cell;
    root.querySelectorAll('.plan-ctx-swatch').forEach((btn) => {
      btn.setAttribute('aria-checked', btn.dataset.mark === current ? 'true' : 'false');
    });
    if (sub) {
      sub.textContent = itemOnly
        ? (opts.columnLabel || 'Item')
        : (scopeState.value === 'row' ? 'Whole row' : (opts.columnLabel || 'This cell'));
    }
  }

  function place() {
    const box = root.getBoundingClientRect();
    const pos = placeContextMenu(
      box,
      { x: opts.x, y: opts.y },
      { width: window.innerWidth, height: window.innerHeight },
    );
    root.style.left = `${pos.left}px`;
    root.style.top = `${pos.top}px`;
  }

  function close() {
    if (closeCurrent !== close) return;
    closeCurrent = null;
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', close);
    opts.anchor?.removeAttribute('aria-expanded');
    root.remove();
    opts.onClose?.();
  }

  function onPointerDown(e) {
    if (root.contains(e.target)) return;
    if (e.target.closest?.('[data-row-menu]')) return;
    if (e.button === 2 && keepOpen && e.target.closest?.(keepOpen)) return;
    close();
  }

  function onScroll(e) {
    if (root.contains(e.target)) return;
    close();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    const items = [...root.querySelectorAll('[role="menuitem"]')];
    const swatches = [...root.querySelectorAll('.plan-ctx-swatch')];
    const scopes = [...root.querySelectorAll('[data-scope]')];
    const active = document.activeElement;
    if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault();
      const i = items.indexOf(active);
      items[(i + 1) % items.length].focus();
    } else if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault();
      const i = items.indexOf(active);
      items[(i <= 0 ? items.length : i) - 1].focus();
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && swatches.includes(active)) {
      e.preventDefault();
      const i = swatches.indexOf(active);
      const next = e.key === 'ArrowRight' ? (i + 1) % swatches.length : (i - 1 + swatches.length) % swatches.length;
      swatches[next].focus();
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && scopes.includes(active)) {
      e.preventDefault();
      const next = scopes.find((btn) => btn !== active) || scopes[0];
      next.focus();
      next.click();
    }
  }

  root.addEventListener('click', (e) => {
    const scopeBtn = e.target.closest('[data-scope]');
    if (scopeBtn) {
      scopeState.value = scopeBtn.dataset.scope === 'row' ? 'row' : 'cell';
      paintScope();
      return;
    }
    const swatch = e.target.closest('.plan-ctx-swatch');
    if (swatch) {
      const color = swatch.dataset.mark || '';
      const scope = itemOnly || scopeState.value === 'row' ? 'row' : 'cell';
      if (scope === 'row') marks.row = color;
      else marks.cell = color;
      paintScope();
      opts.onColor(scope, color);
      return;
    }
    const action = e.target.closest('[data-action]');
    if (!action) return;
    close();
    opts.onAction(action.dataset.action);
  });

  closeCurrent = close;
  paintScope();
  place();
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', close);
  root.focus({ preventScroll: true });
  return { close };
}
