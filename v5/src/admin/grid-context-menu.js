/**
 * Right-click menu for every admin page except Menu & GP,
 * which has its own. Colour is kept on this browser, per page.
 * The other actions are the ones that page already knows how to do.
 */

import { toast } from '../lib/util.js';
import { PLANNING_MARK_IDS } from '../lib/planning-marks.js';
import {
  gridRowMark,
  readGridMarks,
  resolveGridCellMark,
  setGridMark,
  writeGridMarks,
} from '../lib/grid-marks.js';
import { navigate, parseRoute } from './router.js';
import { gridContextActions } from './grid-context-actions.js';
import { openPlanningContextMenu } from './planning-context-menu.js';

const SKIP_ROW = [
  '.plan-row',
  '.plan-sub-row',
  '.dist-cat-row',
  '.kit-lib-cat-row',
  '.kit-pack-cat-row',
  '.recon-total-row',
  '.reports-total-row',
  '.access-group',
].join(',');

const CARD = [
  'a.event-card',
  'button.ord-card',
  'article.del-card',
  'button.catalog-list-item',
  '.dash-stat',
  '.plan-kpi',
  '.wst-stat',
].join(',');

const LINE = 'li.del-card-line';

const ITEM = '.settings-row, .bug-row, article.wh-xfer-item, .wh-xfer-line';

const KEEP_OPEN = `#adminContent tbody tr, ${CARD}, ${LINE}, ${ITEM}`;

const NAME = [
  '.dist-item-name',
  '.ep-item-name',
  '.cnt-item-name',
  '.cl-item-name',
  '.rcn-item-name',
  '.lib-prod-name',
  '.mod-item-name',
  '.catalog-list-name',
  '.catalog-table-primary',
  '.event-card-name',
  '.ord-card-ref',
  '.del-record-supplier',
  '.del-card-title',
  '.del-card-pill-name',
  '.del-card-line-name',
  '.settings-row-name',
  '.bug-title',
  '.wh-xfer-line-name',
  '.kit-pack-item-name',
  '.dash-stat-label',
  '.plan-kpi-label',
  '.wst-stat-label',
  '.rcn-sub-label',
].join(',');

const MARK_CELL = ['plan-cell--mark', ...PLANNING_MARK_IDS.map((id) => `plan-cell--mark-${id}`)];
const MARK_ROW = ['plan-row--mark', ...PLANNING_MARK_IDS.map((id) => `plan-row--mark-${id}`)];

let installed = false;
let marks = {};
let applying = false;

function scopeId() {
  return location.pathname || '/';
}

function loadMarks() {
  marks = readGridMarks(typeof localStorage === 'undefined' ? null : localStorage, scopeId());
}

function saveMarks() {
  writeGridMarks(typeof localStorage === 'undefined' ? null : localStorage, scopeId(), marks);
}

function itemName(el) {
  const named = el.querySelector?.(NAME) || (el.matches?.(NAME) ? el : null);
  const text = (named?.textContent || el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  return text;
}

function rowKey(el) {
  if (el.matches?.('.recon-sub-row')) {
    return `sub:${el.dataset.rcnPid || ''}:${el.querySelector('.rcn-sub-label')?.textContent?.trim() || ''}`;
  }
  if (el.matches?.(LINE)) {
    const card = el.closest('article');
    const parent = card?.dataset.deliveryId || card?.dataset.batchId || card?.dataset.transferId || '';
    return `line:${parent}:${el.dataset.pid || itemName(el)}`;
  }
  const id = el.dataset?.pid
    || el.dataset?.clPid
    || el.dataset?.rcnPid
    || el.dataset?.itemId
    || el.dataset?.deliveryId
    || el.dataset?.batchId
    || el.dataset?.transferId
    || el.dataset?.supId
    || el.dataset?.acctId
    || el.dataset?.whId
    || el.dataset?.vpKey
    || el.dataset?.userId
    || el.dataset?.bugId
    || el.dataset?.catId
    || el.dataset?.csId
    || el.dataset?.recipientId;
  if (id) return `id:${id}`;
  const href = el.getAttribute?.('href');
  if (href) return `h:${href}`;
  const name = itemName(el);
  return name ? `n:${name.slice(0, 80)}` : '';
}

function legacyColKey(cell, row) {
  const index = [...row.children].indexOf(cell);
  return `i:${index < 0 ? 0 : index}`;
}

function colKey(cell, row) {
  if (!cell || cell === row) return 'item';
  if (cell.dataset?.col) return cell.dataset.col;
  if (cell.dataset?.rcnCol) return cell.dataset.rcnCol;
  return legacyColKey(cell, row);
}

function cellMark(key, cell, row) {
  const legacy = cell?.dataset?.col ? legacyColKey(cell, row) : '';
  return resolveGridCellMark(marks, key, colKey(cell, row), legacy);
}

function columnLabel(cell, row) {
  const input = cell?.querySelector?.('input, textarea');
  const aria = input?.getAttribute('aria-label');
  if (aria) return aria;
  const table = row.closest?.('table');
  if (table && cell && cell !== row) {
    const index = [...row.children].indexOf(cell);
    const headRow = table.tHead?.rows?.[table.tHead.rows.length - 1];
    const th = headRow?.cells?.[index];
    const text = th?.innerText?.replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return 'Item';
}

function kindOf(el) {
  if (el.matches('.ord-row')) return 'orders';
  if (el.matches('.ord-card')) return 'order-card';
  if (el.matches('.ep-prod-row')) return 'products';
  if (el.matches('.cnt-prod-row')) return 'counts';
  if (el.matches('.cl-row')) return 'closing';
  if (el.matches('.recon-row, .recon-sub-row')) return 'recon';
  if (el.matches('.mod-row')) return 'sales';
  if (el.matches('.kit-pack-item-row')) return 'kit';
  if (el.matches('.kit-lib-item-row, .kit-lib-nested-row')) return 'kit-library';
  if (el.closest('.lib-table')) return 'library';
  if (el.matches('.dist-prod-row')) return 'distribution';
  if (el.matches('.event-card')) return 'event';
  if (el.matches('.bug-row')) return 'bug';
  if (el.matches('.settings-row--user') || el.dataset?.userId) return 'user';
  if (el.matches('.settings-row')) return 'settings';
  if (el.matches(LINE)) {
    const card = el.closest('article');
    if (card?.matches('.wst-card')) return 'wastage';
    if (card?.matches('.xfer-card')) return 'transfer';
    if (card?.matches('.del-record')) return 'delivery';
    return 'card';
  }
  if (el.matches('.wst-card')) return 'wastage';
  if (el.matches('.xfer-card')) return 'transfer';
  if (el.matches('.del-record')) return 'delivery';
  if (el.matches('.del-card')) return 'card';
  if (el.matches('.catalog-list-item')) return 'catalog';
  if (el.matches('.dash-stat, .plan-kpi, .wst-stat')) return 'stat';
  if (el.closest('.reports-table')) return 'reports';
  if (el.matches('.audit-row') || el.closest('.audit-table')) return 'audit';
  return 'row';
}

function enabledAction(row, action) {
  const btn = row.querySelector?.(`[data-cl-action="${action}"]`);
  return !!btn && !btn.disabled;
}

function resolveTarget(start) {
  if (!start || start.closest?.('.plan-ctx, .admin-topbar, .sidebar')) return null;
  if (start.closest?.('textarea')) return null;
  const cell = start.closest?.('td, th');
  const row = cell?.closest('tr');
  if (row && row.parentElement?.tagName !== 'THEAD' && !row.matches(SKIP_ROW) && !row.querySelector('.dist-empty')) {
    return { el: row, cell, card: false, input: start.closest?.('input') || null };
  }
  const line = start.closest?.(LINE);
  if (line) return { el: line, cell: line, card: true, input: null };
  const item = start.closest?.(ITEM);
  if (item) return { el: item, cell: item, card: true, input: null };
  const card = start.closest?.(CARD);
  if (card) {
    const input = start.closest?.('input:not([type="checkbox"]):not([type="radio"]):not([type="file"])');
    return { el: card, cell: card, card: true, input: input || null };
  }
  return null;
}

function setClasses(el, color, prefix, all) {
  const next = color ? [`${prefix}--mark`, `${prefix}--mark-${color}`] : [];
  const current = [...el.classList].filter((name) => all.includes(name));
  if (current.length === next.length && current.every((name, i) => name === next[i])) return;
  el.classList.remove(...all);
  if (next.length) el.classList.add(...next);
}

function paintHost(host) {
  if (!host || applying) return;
  applying = true;
  try {
    loadMarks();
    host.querySelectorAll(`tbody tr, ${CARD}, ${LINE}, ${ITEM}`).forEach((el) => {
      if (el.matches?.(SKIP_ROW) || el.parentElement?.tagName === 'THEAD') return;
      const key = rowKey(el);
      if (!key) return;
      const rowColor = gridRowMark(marks, key);
      if (el.matches('tr')) {
        setClasses(el, rowColor, 'plan-row', MARK_ROW);
        [...el.children].forEach((cell) => {
          if (cell.tagName !== 'TD' && cell.tagName !== 'TH') return;
          const color = cellMark(key, cell, el);
          setClasses(cell, color, 'plan-cell', MARK_CELL);
        });
      } else {
        setClasses(el, rowColor, 'plan-row', MARK_ROW);
      }
    });
  } finally {
    applying = false;
  }
}

function cellText(cell, input) {
  if (input) return input.value.trim();
  const value = cell.matches?.(CARD) || cell.matches?.(LINE)
    ? cell.querySelector?.('.dash-stat-value, .plan-kpi-value, .wst-stat-value, .del-card-line-qty')
    : null;
  if (value) return value.textContent.replace(/\s+/g, ' ').trim();
  const field = cell.querySelector?.('input:not([type="checkbox"]), textarea');
  if (field) return field.value.trim();
  const named = cell.querySelector?.(NAME);
  if (named) return named.textContent.replace(/\s+/g, ' ').trim();
  return (cell.innerText || cell.textContent || '').replace(/\s+/g, ' ').trim();
}

function rowText(el) {
  if (!el.matches?.('tr')) return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  return [...el.children].map((cell) => cellText(cell)).filter(Boolean).join('\t');
}

async function copyText(text) {
  const value = String(text || '').trim();
  if (!value || value === '—') {
    toast('Nothing to copy', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    toast('Copied');
  } catch {
    toast('Couldn’t copy', true);
  }
}

async function pasteInto(input) {
  if (!input || input.disabled) return;
  let text;
  try {
    text = String(await navigator.clipboard.readText()).trim();
  } catch {
    toast('Couldn’t read the clipboard', true);
    return;
  }
  input.focus();
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function clearInput(input) {
  if (!input || input.disabled) return;
  input.value = '';
  input.classList.remove('is-invalid');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function goPanel(panel) {
  const route = parseRoute();
  if (!route.eventId) {
    toast('Open an event first', true);
    return;
  }
  navigate({ view: 'event', eventId: route.eventId, panel });
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function clickAction(row, id) {
  if (id === 'open-order') row.querySelector('[data-open-po]')?.click();
  else if (id === 'open-card' || id === 'edit-row') row.click();
  else if (id === 'add-bar') row.querySelector('.dist-cell-add')?.click();
  else if (id === 'remove-bar') row.querySelector('.dist-cell-remove')?.click();
  else if (id === 'edit-recon') row.querySelector('[data-rcn-edit]')?.click();
  else if (id === 'edit-button') {
    const host = row.querySelector?.('[data-edit]') ? row : (row.closest?.('article') || row);
    host.querySelector('[data-edit]')?.click();
  } else if (id === 'edit-recipe') row.querySelector('[data-edit-cocktail]')?.click();
  else if (id === 'edit-user') row.querySelector('[data-act="edit"]')?.click();
  else if (id === 'activate-user') row.querySelector('[data-act="activate"]')?.click();
  else if (id === 'edit-bug') row.querySelector('[data-bug-edit]')?.click();
  else if (id === 'toggle-bug') row.querySelector('[data-bug-toggle]')?.click();
  else if (id === 'invoice') (row.closest('article') || row).querySelector('[data-invoice-recipient]')?.click();
  else if (id === 'return' || id === 'transfer' || id === 'sticker') {
    row.querySelector(`[data-cl-action="${id}"]`)?.click();
  } else if (id === 'goto-planning') goPanel('planning');
  else if (id === 'goto-products') goPanel('products');
  else if (id === 'goto-distribution') goPanel('distribution');
  else if (id === 'goto-closing') goPanel('closing');
  else if (id === 'goto-recon') goPanel('recon');
}

function openAt(target, point) {
  const { el, cell, card, input } = target;
  const key = rowKey(el);
  const col = colKey(cell, el);
  const kind = kindOf(el);
  const field = card
    ? input
    : (input || cell.querySelector?.('input:not([type="checkbox"]):not([disabled]), textarea:not([disabled])'));
  const anyField = input || cell.querySelector?.('input:not([type="checkbox"]), textarea');
  const onEvent = !!parseRoute().eventId;
  const actions = gridContextActions({
    kind,
    card,
    hasInput: card ? !!input : !!anyField,
    inputDisabled: !!anyField?.disabled || !!anyField?.readOnly,
    hasName: !!itemName(el),
    canOpenOrder: !!el.querySelector?.('[data-open-po]'),
    canAddBar: !!cell?.matches?.('.dist-cell--off') || !!cell?.querySelector?.('.dist-cell-add'),
    canRemoveBar: !!cell?.matches?.('.dist-cell--on'),
    canReturn: enabledAction(el, 'return'),
    canTransfer: enabledAction(el, 'transfer'),
    canSticker: enabledAction(el, 'sticker'),
    canEdit: !!el.querySelector?.('[data-edit], [data-rcn-edit]')
      || !!el.closest?.('article')?.querySelector?.('[data-edit]')
      || kind === 'products',
    canEditRecipe: !!el.querySelector?.('[data-edit-cocktail]'),
    canActivate: !!el.querySelector?.('[data-act="activate"]'),
    canInvoice: !!(el.closest?.('article') || el).querySelector?.('[data-invoice-recipient]'),
    toggleLabel: el.querySelector?.('[data-bug-toggle]')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    onEvent,
  });
  cell?.classList?.add('plan-cell--menu');
  openPlanningContextMenu({
    x: point.x,
    y: point.y,
    title: itemName(el) || 'Item',
    columnLabel: card ? kindLabel(kind) : columnLabel(cell, el),
    scope: 'cell',
    colorMode: card ? 'item' : 'cell',
    keepOpenSelector: KEEP_OPEN,
    marks: {
      cell: cellMark(key, cell, el),
      row: gridRowMark(marks, key),
    },
    actions,
    onClose: () => cell?.classList?.remove('plan-cell--menu'),
    onColor: (scope, color) => {
      if (!key) return;
      const targetId = scope === 'row' ? 'row' : col;
      marks = setGridMark(marks, key, targetId, color);
      if (scope !== 'row' && cell?.dataset?.col) {
        const legacy = legacyColKey(cell, el);
        if (legacy !== targetId) marks = setGridMark(marks, key, legacy, '');
      }
      saveMarks();
      paintHost(document.getElementById('adminContent'));
    },
    onAction: (id) => {
      if (id === 'copy') void copyText(cellText(cell, input));
      else if (id === 'copy-name') void copyText(itemName(el));
      else if (id === 'copy-row') void copyText(rowText(el));
      else if (id === 'paste') void pasteInto(field);
      else if (id === 'clear') clearInput(field);
      else clickAction(cell?.matches?.('.dist-cell') ? cell : el, id);
    },
  });
}

function kindLabel(kind) {
  if (kind === 'event') return 'Event';
  if (kind === 'order-card') return 'Purchase order';
  if (kind === 'delivery') return 'Delivery';
  if (kind === 'wastage') return 'Wastage';
  if (kind === 'transfer') return 'Transfer';
  if (kind === 'catalog') return 'Record';
  if (kind === 'stat') return 'Figure';
  if (kind === 'user') return 'User';
  if (kind === 'bug') return 'Report';
  if (kind === 'settings') return 'Setting';
  if (kind === 'card') return 'Record';
  return 'Item';
}

export function installGridContextMenu() {
  if (installed || typeof document === 'undefined') return;
  const host = document.getElementById('adminContent');
  if (!host) return;
  installed = true;
  loadMarks();
  host.addEventListener('contextmenu', (e) => {
    const target = resolveTarget(e.target);
    if (!target) return;
    e.preventDefault();
    const fromKeyboard = e.button === 0 && e.clientX === 0 && e.clientY === 0 && !e.ctrlKey && !e.metaKey;
    if (fromKeyboard) {
      const box = (target.cell || target.el).getBoundingClientRect();
      openAt(target, { x: box.left, y: box.bottom + 4 });
      return;
    }
    openAt(target, { x: e.clientX, y: e.clientY });
  });
  const observer = new MutationObserver(() => {
    if (applying) return;
    paintHost(host);
  });
  observer.observe(host, { childList: true, subtree: true });
  paintHost(host);
}
