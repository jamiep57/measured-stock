/**
 * Closing stock — end-of-event physical counts, SOR returns, carried over.
 * Grid layout mirrors Distribution / Products (dist-grid).
 */

import { $, escapeHtml, toast, nowLocalInput, isBoneYard } from '../../lib/util.js';
import {
  getDB, loadEventFull, loadCaseSizes, loadSuppliers,
} from '../../db.js';
import { parseQty } from '../../stock-entry.js';
import { productStockPack } from '../../pack-metrics.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { openModal, closeModal } from '../../components/modal.js';
import { icon } from '../../lib/icons.js';
import { loadingTableRow } from '../../components/loading-widget.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import {
  ADMIN_TABLE_FILTER,
  getTableFilterValues,
} from '../table-filter.js';
import {
  buildClosingRow,
  closingCountToForm,
  closingPatchFromDraft,
  computeClosingRows,
  exceedsMaxReturnable,
  filterClosingRows,
  groupClosingByCategory,
  returnAmountToForm,
} from '../../lib/closing-stock.js';
import { printClosingCountSheet } from '../../lib/count-sheets-print.js';
import { closingRowFor, preferredSupplierId, roundN } from '../../lib/recon.js';
import {
  generatePalletStickerPDF,
  splitPalletQtys,
} from '../../lib/pallet-sticker-pdf.js';
import { createGridCollabSession } from '../../lib/collab-presence.js';
import {
  closingCellKeyFromInput,
  closingFindCellEl,
} from '../../lib/grid-collab-keys.js';
import {
  mergeClosingRemoteRow,
  shouldApplyRemoteClosingEdit,
} from '../../lib/closing-live.js';
import { errorState, bindEmptyRetry } from '../../components/empty-state.js';
import { reportError } from '../../lib/client-errors.js';
const COL_COUNT = 12; // product (pack in meta) + 9 data cols + return + actions
const LOCAL_ECHO_MS = 1500;
const AUTOSAVE_MS = 180;
const VALUE_BROADCAST_MS = 40;

async function adjustWarehouseStock(warehouseId, productId, delta) {
  const DB = getDB();
  const rows = await DB.select(
    'warehouse_stock',
    `?warehouse_id=eq.${DB._.enc(warehouseId)}&product_id=eq.${DB._.enc(productId)}&select=qty_on_hand`,
  );
  const current = rows?.[0] ? Number(rows[0].qty_on_hand) || 0 : 0;
  const next = Math.round((current + delta) * 10) / 10;
  if (next < 0) throw new Error('Insufficient warehouse stock');
  await DB.warehouseStock.setQty(warehouseId, productId, next);
}

function fmtQty(n) {
  if (n == null || n === '' || !Number.isFinite(Number(n))) return '—';
  const v = roundN(Number(n), 2);
  return Number.isInteger(v) ? String(v) : String(v);
}

function rowFor(closingRows, pid) {
  return closingRowFor(closingRows, pid);
}

function fmtSor(sor) {
  return sor > 0 ? `${sor}%` : '—';
}

function fmtMax(n) {
  if (n == null) return '—';
  return fmtQty(n);
}

function renderInput(pid, field, value, aria) {
  // Keep "0" visible — only blank/null/undefined mean “not entered”.
  const shown = value != null && value !== '' ? String(value) : '';
  return `<input type="text" class="cl-pill-input num-math" id="cl-${field}-${escapeHtml(pid)}"
    data-cl-pid="${escapeHtml(pid)}" data-cl-field="${field}"
    value="${shown !== '' ? escapeHtml(shown) : ''}"
    autocomplete="off" inputmode="decimal" placeholder="-"
    aria-label="${escapeHtml(aria)}">`;
}

function th(label, extraClass = '', left = false) {
  return `<th class="dist-col-header ${extraClass}">
    <div class="dist-bar-head${left ? ' dist-bar-head--left' : ''}">
      <span class="dist-bar-name">${label}</span>
    </div>
  </th>`;
}

function renderRow(r) {
  const countForm = r.hasClosing
    ? {
      cases: String(r.closingCases ?? 0),
      singles: String(r.closingSingles ?? 0),
    }
    : { cases: '', singles: '' };
  const returnForm = (Number(r.returnCases) > 0 || Number(r.returnSingles) > 0)
    ? {
      cases: Number(r.returnCases) > 0 ? String(r.returnCases) : '',
      singles: Number(r.returnSingles) > 0 ? String(r.returnSingles) : '',
    }
    : { cases: '', singles: '' };
  const canTransfer = (Number(r.carriedOver) || 0) > 0;
  const canReturn = (Number(r.returnAmount) || 0) > 0;
  const canSticker = canReturn || canTransfer;

  const packLabel = r.packLabel || '';
  return `
    <tr class="dist-prod-row cl-row" data-cl-pid="${escapeHtml(r.pid)}"
      data-product-name="${escapeHtml((r.p.name || '').toLowerCase())}"
      data-supplier-name="${escapeHtml((r.supplierName && r.supplierName !== '—' ? r.supplierName : '').toLowerCase())}">
      <th class="dist-sticky cl-col-item" data-col="product" scope="row">
        <div class="cl-item">
          <div class="cl-item-top">
            <span class="cl-item-name" title="${escapeHtml(r.p.name || 'Product')}">${escapeHtml(r.p.name || 'Product')}</span>
          </div>
          ${packLabel ? `<span class="cl-item-meta">${escapeHtml(packLabel)}</span>` : ''}
        </div>
      </th>
      <td class="cl-prod-num muted" title="Supplier">${escapeHtml(r.supplierName)}</td>
      <td class="cl-prod-num cl-sor">${escapeHtml(fmtSor(r.sor))}</td>
      <td class="cl-prod-num cl-invoice" title="${escapeHtml(r.invoiceLabel)}">${escapeHtml(fmtQty(r.invoiceQty))}</td>
      <td class="cl-cell cl-cell--edit">${renderInput(r.pid, 'cases', countForm.cases, 'Closing cases')}</td>
      <td class="cl-cell cl-cell--edit">${renderInput(r.pid, 'singles', countForm.singles, 'Closing singles')}</td>
      <td class="cl-prod-num cl-max" id="cl-max-${escapeHtml(r.pid)}">${escapeHtml(fmtMax(r.maxReturnable))}</td>
      <td class="cl-cell cl-cell--edit">${renderInput(r.pid, 'return-cases', returnForm.cases, 'Return cases')}</td>
      <td class="cl-cell cl-cell--edit">${renderInput(r.pid, 'return-singles', returnForm.singles, 'Return singles')}</td>
      <td class="cl-prod-num cl-carried" id="cl-carried-${escapeHtml(r.pid)}" title="${escapeHtml(r.carriedLabel)}">${escapeHtml(fmtQty(r.carriedOver))}</td>
      <td class="cl-return-cell">
        <button type="button" class="cl-return-btn" data-cl-action="return"
          data-cl-pid="${escapeHtml(r.pid)}"
          title="Return to ${escapeHtml(r.supplierName || 'supplier')} and print pallet stickers"
          ${canReturn ? '' : 'disabled'}>
          ${icon('corner-up-left', { size: 14 })}
          <span>Return to supplier</span>
        </button>
      </td>
      <td class="cl-actions-cell">
        <div class="cl-row-actions">
          <button type="button" class="cl-row-btn" data-cl-action="transfer"
            data-cl-pid="${escapeHtml(r.pid)}"
            title="Transfer carried over to warehouse"
            aria-label="Transfer to warehouse"
            ${canTransfer ? '' : 'disabled'}>
            ${icon('warehouse', { size: 15 })}
          </button>
          <button type="button" class="cl-row-btn" data-cl-action="sticker"
            data-cl-pid="${escapeHtml(r.pid)}"
            title="Print pallet sticker"
            aria-label="Print pallet sticker"
            ${canSticker ? '' : 'disabled'}>
            ${icon('printer', { size: 15 })}
          </button>
        </div>
      </td>
    </tr>`;
}

function renderStats(rows) {
  const counted = rows.filter((r) => r.hasClosing).length;
  const returning = rows.filter((r) => r.returnAmount > 0).length;
  const carried = rows.reduce((s, r) => s + (Number(r.carriedOver) || 0), 0);
  return `
    <div class="wst-stat">
      <span class="wst-stat-label">Products</span>
      <span class="wst-stat-value">${rows.length}</span>
    </div>
    <div class="wst-stat">
      <span class="wst-stat-label">Counted</span>
      <span class="wst-stat-value">${counted}</span>
      <span class="wst-stat-label muted">with closing stock</span>
    </div>
    <div class="wst-stat">
      <span class="wst-stat-label">Returning</span>
      <span class="wst-stat-value">${returning}</span>
      <span class="wst-stat-label muted">with return qty</span>
    </div>
    <div class="wst-stat">
      <span class="wst-stat-label">Carried over</span>
      <span class="wst-stat-value">${roundN(carried, 1)}</span>
      <span class="wst-stat-label muted">stock units</span>
    </div>`;
}

function renderGridHead() {
  return `<tr>
    <th class="dist-sticky dist-col-header cl-col-item cl-th--item" data-col="product">
      <div class="dist-bar-head dist-bar-head--left"><span class="dist-bar-name">Product</span></div>
    </th>
    ${th('Supplier', 'cl-col-supplier', true)}
    ${th('SOR %', 'cl-col-num')}
    ${th('Invoice', 'cl-col-num')}
    ${th('Close C', 'cl-col-edit')}
    ${th('Close S', 'cl-col-edit')}
    ${th('Max ret.', 'cl-col-num')}
    ${th('Return C', 'cl-col-edit')}
    ${th('Return S', 'cl-col-edit')}
    ${th('Carried', 'cl-col-num')}
    ${th('Return', 'cl-col-return')}
    ${th('Actions', 'cl-col-actions')}
  </tr>`;
}

export function renderClosingShell() {
  return `
    <div class="cl-panel" id="closingPanel">
      <div class="wst-stats cl-stats" id="clStats" hidden></div>
      <p class="cl-hint muted">
        Counts <strong>auto-save as you type</strong> and update live for anyone else on Closing.
        Closing and return use each product’s stock unit
        (cases / singles, bottles, or kegs). <strong>Max returnable</strong> = invoice × supplier SOR %.
        Returns above that ask for confirmation. <strong>Carried over</strong> = close count − return amount.
        Use <strong>Return to supplier</strong> to print pallet stickers for the return qty.
        Cleared a number by mistake? Hit <strong>Undo</strong> (or ⌘Z / Ctrl+Z).
        When someone else clicks a cell, you’ll see it highlighted with their name.
      </p>
      <div class="sales-toolbar cl-toolbar" id="clToolbar" hidden></div>
      <div class="dist-grid-wrap cl-grid-wrap" id="clTableWrap">
        <table class="dist-grid cl-grid" id="clTable">
          <thead id="clGridHead">${renderGridHead()}</thead>
          <tbody id="clBody">
            ${loadingTableRow(COL_COUNT, 'Loading closing stock…')}
          </tbody>
        </table>
        <div class="dist-empty cl-empty" id="clEmpty" hidden>
          Add products to this event before entering closing stock.
        </div>
      </div>
    </div>`;
}

export function mountClosingPanel(route) {
  const panel = $('closingPanel');
  if (!panel) return () => {};

  const ctx = {
    eventId: route.eventId,
    event: null,
    closingRows: [],
    supplierReturns: [],
    suppliers: [],
    caseSizes: [],
    drafts: {},
    saveTimers: {},
    theadObserver: null,
    abort: false,
    overMaxPrompt: new Set(),
    collab: null,
    recentLocalWrites: new Map(),
    focusPid: null,
    focusField: null,
    valueBroadcastTimer: null,
    statusFilter: '',
    categoryFilter: '',
    supplierFilter: '',
    sortKey: 'name',
    searchQuery: getLastProductFilter().query || '',
  };

  const seeded = getTableFilterValues('closing');
  if (seeded) {
    ctx.statusFilter = seeded.statusFilter || '';
    ctx.categoryFilter = seeded.categoryFilter || '';
    ctx.supplierFilter = seeded.supplierFilter || '';
    ctx.sortKey = seeded.sortKey || 'name';
  }

  function confirmOverSorReturn({ productName, returnAmount, maxReturnable, sorPct }) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        closeModal();
        resolve(ok);
      };
      openModal({
        title: 'Over SOR return limit',
        bodyHtml: `
          <p style="margin:0;font-size:14px;line-height:1.45">
            You’re returning <strong>${escapeHtml(fmtQty(returnAmount))}</strong> of
            <strong>${escapeHtml(productName || 'this product')}</strong>, which is above the SOR limit of
            <strong>${escapeHtml(fmtQty(maxReturnable))}</strong>${sorPct > 0 ? ` (${escapeHtml(fmtSor(sorPct))})` : ''}.
          </p>
          <p class="muted" style="margin:12px 0 0;font-size:13px;line-height:1.4">
            Do you want to continue with this return amount?
          </p>`,
        footHtml: `
          <div class="admin-modal-actions">
            <button type="button" class="admin-drawer-btn" id="clOverSorCancel">Use max returnable</button>
            <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="clOverSorContinue">Continue anyway</button>
          </div>`,
        onClose: () => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        },
      });
      $('clOverSorCancel')?.addEventListener('click', () => finish(false));
      $('clOverSorContinue')?.addEventListener('click', () => finish(true));
    });
  }

  function readDraft(pid) {
    const casesEl = document.getElementById(`cl-cases-${pid}`);
    const singlesEl = document.getElementById(`cl-singles-${pid}`);
    const retCasesEl = document.getElementById(`cl-return-cases-${pid}`);
    const retSinglesEl = document.getElementById(`cl-return-singles-${pid}`);
    const ep = ctx.event?.event_products?.find((x) => x.product_id === pid);
    const stored = ep
      ? buildClosingRow({
        ep,
        closingRow: rowFor(ctx.closingRows, pid) || {},
        suppliers: ctx.suppliers,
        caseSizes: ctx.caseSizes,
        event: ctx.event,
        supplierReturns: ctx.supplierReturns,
      })
      : null;
    const countBase = stored
      ? { cases: String(stored.closingCases ?? 0), singles: String(stored.closingSingles ?? 0) }
      : closingCountToForm(rowFor(ctx.closingRows, pid) || {});
    const returnBase = stored
      ? {
        cases: Number(stored.returnCases) > 0 ? String(stored.returnCases) : '',
        singles: Number(stored.returnSingles) > 0 ? String(stored.returnSingles) : '',
      }
      : returnAmountToForm(rowFor(ctx.closingRows, pid)?.return_amount);
    // Prefer live inputs when present (empty field = 0). Fall back to stored
    // values only if the row was re-rendered away mid-save.
    return {
      closingCases: casesEl ? parseQty(casesEl.value) : parseQty(countBase.cases),
      closingSingles: singlesEl ? parseQty(singlesEl.value) : parseQty(countBase.singles),
      returnCases: retCasesEl ? parseQty(retCasesEl.value) : parseQty(returnBase.cases),
      returnSingles: retSinglesEl ? parseQty(retSinglesEl.value) : parseQty(returnBase.singles),
    };
  }

  function allRows() {
    return computeClosingRows({
      event: ctx.event,
      closingRows: ctx.closingRows,
      suppliers: ctx.suppliers,
      caseSizes: ctx.caseSizes,
      drafts: ctx.drafts,
      supplierReturns: ctx.supplierReturns,
    });
  }

  function visibleRows() {
    return filterClosingRows(allRows(), {
      statusFilter: ctx.statusFilter,
      categoryFilter: ctx.categoryFilter,
      supplierFilter: ctx.supplierFilter,
    });
  }

  function paintToolbar() {
    const toolbar = $('clToolbar');
    if (!toolbar) return;
    toolbar.hidden = true;
    toolbar.innerHTML = '';
  }

  function syncGridLayout() {
    const wrap = $('clTableWrap');
    if (!wrap) return;
    const theadRow = panel.querySelector('.dist-grid thead tr');
    if (theadRow) {
      wrap.style.setProperty('--dist-thead-h', `${theadRow.getBoundingClientRect().height}px`);
    }
    wrap.classList.toggle('is-scrollable', wrap.scrollWidth > wrap.clientWidth + 8);
  }

  function layoutTableScroll() {
    const wrap = $('clTableWrap');
    if (!wrap || wrap.offsetParent === null) return;
    const top = wrap.getBoundingClientRect().top;
    wrap.style.maxHeight = `${Math.max(280, window.innerHeight - top - 24)}px`;
    syncGridLayout();
  }

  function renderTable() {
    const body = $('clBody');
    const empty = $('clEmpty');
    const table = $('clTable');
    const stats = $('clStats');
    if (!body) return;

    const sourceRows = allRows();
    paintToolbar();
    const rows = filterClosingRows(sourceRows, {
      statusFilter: ctx.statusFilter,
      categoryFilter: ctx.categoryFilter,
      supplierFilter: ctx.supplierFilter,
    });
    if (stats) {
      stats.hidden = !sourceRows.length;
      stats.innerHTML = sourceRows.length ? renderStats(rows) : '';
    }

    if (!sourceRows.length) {
      body.innerHTML = '';
      if (table) table.hidden = true;
      if (empty) {
        empty.hidden = false;
        empty.textContent = 'Add products to this event before entering closing stock.';
      }
      return;
    }

    if (table) table.hidden = false;
    if (empty) empty.hidden = true;

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${COL_COUNT}" class="dist-empty">No products match your filter.</td></tr>`;
      applyProductFilter({ query: ctx.searchQuery, productId: null });
      requestAnimationFrame(layoutTableScroll);
      return;
    }

    const grouped = groupClosingByCategory(rows, ctx.sortKey);
    let html = '';
    Object.keys(grouped).sort().forEach((cat) => {
      html += `<tr class="dist-cat-row">
        <td class="dist-cat-pinned"><span class="dist-bar-name">${escapeHtml(cat)}</span></td>
        <td colspan="${COL_COUNT - 1}" class="dist-cat-scroll"></td>
      </tr>`;
      grouped[cat].forEach((r) => { html += renderRow(r); });
    });
    body.innerHTML = html;
    ctx.collab?.repaint();
    applyProductFilter({ query: ctx.searchQuery, productId: getLastProductFilter().productId });
    requestAnimationFrame(layoutTableScroll);
  }

  async function persist(pid, opts = {}) {
    if (!ctx.event) return;
    if (ctx.overMaxPrompt.has(pid)) return;
    const draft = ctx.drafts[pid] || readDraft(pid);
    const ep = ctx.event.event_products.find((x) => x.product_id === pid);
    if (!ep) return;

    const preview = buildClosingRow({
      ep,
      closingRow: rowFor(ctx.closingRows, pid) || {},
      suppliers: ctx.suppliers,
      caseSizes: ctx.caseSizes,
      draft,
      event: ctx.event,
      supplierReturns: ctx.supplierReturns,
    });

    let allowOverMaxReturnable = !!opts.allowOverMaxReturnable;
    if (
      !allowOverMaxReturnable
      && exceedsMaxReturnable(preview.returnAmount, preview.maxReturnable)
    ) {
      ctx.overMaxPrompt.add(pid);
      try {
        allowOverMaxReturnable = await confirmOverSorReturn({
          productName: ep.product?.name || preview.p?.name,
          returnAmount: preview.returnAmount,
          maxReturnable: preview.maxReturnable,
          sorPct: preview.sor,
        });
      } finally {
        ctx.overMaxPrompt.delete(pid);
      }
    }

    const { capped, ...patch } = closingPatchFromDraft(ep.product, draft, ctx.caseSizes, {
      maxReturnable: preview.maxReturnable,
      allowOverMaxReturnable,
    });
    // Max-returnable is handled by the confirm dialog; still toast hard closing-count caps.
    const toastCaps = (capped || []).filter((c) => c !== 'max returnable');
    if (toastCaps.length) {
      toast(`Return capped to ${toastCaps.join(' / ')}`, true);
    }
    if (capped?.length) {
      const form = returnAmountToForm(patch.return_amount);
      ctx.drafts[pid] = {
        ...draft,
        returnCases: form.cases,
        returnSingles: form.singles,
      };
    }
    let cl = rowFor(ctx.closingRows, pid);
    if (!cl) {
      cl = { event_id: ctx.eventId, product_id: pid };
      ctx.closingRows.push(cl);
    }
    Object.assign(cl, patch);

    const DB = getDB();
    const saved = await DB.closing.setForEvent(ctx.eventId, pid, {
      ...patch,
      recon_status: cl.recon_status ?? null,
      recon_note: cl.recon_note ?? null,
      budget_method: cl.budget_method || 'auto',
      budget_override: cl.budget_override ?? null,
    });
    if (saved?.id) cl.id = saved.id;

    // Keep supplier_return_lines in sync so Recon and Closing share one return figure.
    const returnAmt = Number(patch.return_amount) || 0;
    const sid = preferredSupplierId(ep.product);
    try {
      const returnRows = (returnAmt > 0 && sid)
        ? [{
          event_id: ctx.eventId,
          product_id: pid,
          supplier_id: sid,
          qty: returnAmt,
          singles: 0,
        }]
        : [];
      await DB.supplierReturns.replaceForProduct(ctx.eventId, pid, returnRows);
      ctx.supplierReturns = (ctx.supplierReturns || [])
        .filter((r) => r.product_id !== pid)
        .concat(returnRows);
    } catch (retErr) {
      console.warn('closing persist supplier returns', retErr);
    }

    ctx.recentLocalWrites.set(pid, Date.now());
    delete ctx.drafts[pid];

    const row = buildClosingRow({
      ep,
      closingRow: cl,
      suppliers: ctx.suppliers,
      caseSizes: ctx.caseSizes,
      event: ctx.event,
      supplierReturns: ctx.supplierReturns,
    });
    const carriedEl = document.getElementById(`cl-carried-${pid}`);
    const maxEl = document.getElementById(`cl-max-${pid}`);
    const retCasesEl = document.getElementById(`cl-return-cases-${pid}`);
    const retSinglesEl = document.getElementById(`cl-return-singles-${pid}`);
    if (capped?.length) {
      const form = returnAmountToForm(patch.return_amount);
      if (retCasesEl) retCasesEl.value = form.cases;
      if (retSinglesEl) retSinglesEl.value = form.singles;
    }
    if (carriedEl) {
      carriedEl.textContent = fmtQty(row.carriedOver);
      carriedEl.title = row.carriedLabel;
    }
    if (maxEl) maxEl.textContent = fmtMax(row.maxReturnable);
    const stats = $('clStats');
    if (stats) stats.innerHTML = renderStats(visibleRows());
    syncRowActions(pid);
  }

  function previewCarried(pid, draft) {
    const ep = ctx.event?.event_products?.find((x) => x.product_id === pid);
    if (!ep) return;
    const preview = buildClosingRow({
      ep,
      closingRow: rowFor(ctx.closingRows, pid) || {},
      suppliers: ctx.suppliers,
      caseSizes: ctx.caseSizes,
      draft,
      event: ctx.event,
      supplierReturns: ctx.supplierReturns,
    });
    const carriedEl = document.getElementById(`cl-carried-${pid}`);
    if (carriedEl) {
      carriedEl.textContent = fmtQty(preview.carriedOver);
      carriedEl.title = preview.carriedLabel;
    }
    // Keep drafts in sync so syncRowActions sees live return/carried.
    ctx.drafts[pid] = draft;
    syncRowActions(pid);
  }

  function dirtyCount() {
    return Object.keys(ctx.drafts).length + Object.keys(ctx.saveTimers).length;
  }

  /** Debounced autosave — draft values also broadcast live while typing. */
  function scheduleSave(pid) {
    if (!pid) return;
    clearTimeout(ctx.saveTimers[pid]);
    ctx.drafts[pid] = readDraft(pid);
    previewCarried(pid, ctx.drafts[pid]);
    scheduleValueBroadcast();
    ctx.saveTimers[pid] = setTimeout(() => {
      delete ctx.saveTimers[pid];
      persist(pid).catch((e) => toast(e.message || 'Save failed', true));
    }, AUTOSAVE_MS);
  }

  /** Flush one product immediately (blur / undo / action prep). */
  function flushSave(pid, { reread = true } = {}) {
    if (!pid) return Promise.resolve();
    clearTimeout(ctx.saveTimers[pid]);
    delete ctx.saveTimers[pid];
    if (reread || !ctx.drafts[pid]) {
      ctx.drafts[pid] = readDraft(pid);
    }
    previewCarried(pid, ctx.drafts[pid]);
    return persist(pid).catch((e) => {
      toast(e.message || 'Save failed', true);
    });
  }

  /** Persist every in-flight draft so navigation / actions do not drop counts. */
  async function flushAllPending() {
    const pids = [...new Set([
      ...Object.keys(ctx.saveTimers),
      ...Object.keys(ctx.drafts),
    ])];
    Object.values(ctx.saveTimers).forEach(clearTimeout);
    ctx.saveTimers = {};
    // Sequential so over-SOR confirms don’t stack multiple modals.
    for (const pid of pids) {
      await flushSave(pid, { reread: false });
    }
  }

  function applyProductFilter({ query, productId } = {}) {
    const q = (query || '').trim().toLowerCase();
    ctx.searchQuery = q;
    panel.querySelectorAll('.cl-row[data-cl-pid]').forEach((tr) => {
      if (productId) {
        tr.hidden = tr.dataset.clPid !== productId;
        return;
      }
      if (!q) {
        tr.hidden = false;
        return;
      }
      const name = tr.dataset.productName || '';
      const supplier = tr.dataset.supplierName || '';
      tr.hidden = !(name.includes(q) || supplier.includes(q));
    });
    panel.querySelectorAll('.dist-cat-row').forEach((tr) => {
      let next = tr.nextElementSibling;
      let anyVisible = false;
      while (next && next.classList.contains('cl-row')) {
        if (!next.hidden) anyVisible = true;
        next = next.nextElementSibling;
      }
      tr.hidden = !anyVisible;
    });
  }

  function onInput(e) {
    const input = e.target.closest('.cl-pill-input');
    if (!input) return;
    scheduleSave(input.dataset.clPid);
  }

  function onBlur(e) {
    if (!e.target?.matches?.('.cl-pill-input')) return;
    flushSave(e.target.dataset.clPid);
  }

  function onPageHide() {
    // Best-effort flush — browsers may cancel async work on hide.
    if (dirtyCount()) flushAllPending();
  }

  function rowByPid(pid) {
    return allRows().find((r) => r.pid === pid) || null;
  }

  function syncRowActions(pid) {
    const row = rowByPid(pid);
    if (!row) return;
    const canTransfer = (Number(row.carriedOver) || 0) > 0;
    const canReturn = (Number(row.returnAmount) || 0) > 0;
    const canSticker = canReturn || canTransfer;
    const tr = panel.querySelector(`.cl-row[data-cl-pid="${CSS.escape(pid)}"]`);
    if (!tr) return;
    const returnBtn = tr.querySelector('[data-cl-action="return"]');
    const xferBtn = tr.querySelector('[data-cl-action="transfer"]');
    const stickerBtn = tr.querySelector('[data-cl-action="sticker"]');
    if (returnBtn) returnBtn.disabled = !canReturn;
    if (xferBtn) xferBtn.disabled = !canTransfer;
    if (stickerBtn) stickerBtn.disabled = !canSticker;
  }

  function applyRemoteRowToUi(pid, { flash = true } = {}) {
    const cl = rowFor(ctx.closingRows, pid) || {};
    const ep = ctx.event?.event_products?.find((x) => x.product_id === pid);
    const stored = ep
      ? buildClosingRow({
        ep,
        closingRow: cl,
        suppliers: ctx.suppliers,
        caseSizes: ctx.caseSizes,
        event: ctx.event,
        supplierReturns: ctx.supplierReturns,
      })
      : null;
    const countForm = stored
      ? {
        cases: stored.hasClosing ? String(stored.closingCases ?? 0) : '',
        singles: stored.hasClosing ? String(stored.closingSingles ?? 0) : '',
      }
      : closingCountToForm(cl);
    const returnForm = stored
      ? {
        cases: Number(stored.returnCases) > 0 ? String(stored.returnCases) : '',
        singles: Number(stored.returnSingles) > 0 ? String(stored.returnSingles) : '',
      }
      : returnAmountToForm(cl.return_amount);
    const casesEl = document.getElementById(`cl-cases-${pid}`);
    const singlesEl = document.getElementById(`cl-singles-${pid}`);
    const retCasesEl = document.getElementById(`cl-return-cases-${pid}`);
    const retSinglesEl = document.getElementById(`cl-return-singles-${pid}`);
    const active = document.activeElement;
    if (casesEl && active !== casesEl) casesEl.value = countForm.cases;
    if (singlesEl && active !== singlesEl) singlesEl.value = countForm.singles;
    if (retCasesEl && active !== retCasesEl) retCasesEl.value = returnForm.cases;
    if (retSinglesEl && active !== retSinglesEl) retSinglesEl.value = returnForm.singles;

    if (stored) {
      const carriedEl = document.getElementById(`cl-carried-${pid}`);
      const maxEl = document.getElementById(`cl-max-${pid}`);
      if (carriedEl) {
        carriedEl.textContent = fmtQty(stored.carriedOver);
        carriedEl.title = stored.carriedLabel;
      }
      if (maxEl) maxEl.textContent = fmtMax(stored.maxReturnable);
      syncRowActions(pid);
    }

    const stats = $('clStats');
    if (stats) stats.innerHTML = renderStats(visibleRows());

    if (flash) {
      const tr = panel.querySelector(`.cl-row[data-cl-pid="${CSS.escape(pid)}"]`);
      if (tr) {
        tr.classList.add('cl-row--live');
        window.setTimeout(() => tr.classList.remove('cl-row--live'), 900);
      }
    }
    ctx.collab?.repaint();
  }

  function handleRemoteClosingChange(payload) {
    if (ctx.abort) return;
    const remote = payload?.new || payload?.old;
    if (!remote?.product_id) return;
    if (payload.eventType === 'DELETE') {
      ctx.closingRows = (ctx.closingRows || []).filter((r) => r.product_id !== remote.product_id);
      if (!ctx.drafts[remote.product_id]) applyRemoteRowToUi(remote.product_id);
      return;
    }
    const decision = shouldApplyRemoteClosingEdit({
      productId: remote.product_id,
      dirtyPids: ctx.drafts,
      recentLocalWrites: ctx.recentLocalWrites,
      focusedPid: ctx.focusPid,
      localEchoMs: LOCAL_ECHO_MS,
    });
    const merged = mergeClosingRemoteRow(ctx.closingRows, remote);
    ctx.closingRows = merged.rows;
    if (!decision.apply) return;
    if (merged.created && !document.getElementById(`cl-cases-${remote.product_id}`)) {
      renderTable();
      applyProductFilter(getLastProductFilter());
      return;
    }
    applyRemoteRowToUi(remote.product_id);
  }

  function scheduleValueBroadcast() {
    if (!ctx.collab?.isReady() || !ctx.focusPid || !ctx.focusField) return;
    clearTimeout(ctx.valueBroadcastTimer);
    ctx.valueBroadcastTimer = setTimeout(() => {
      ctx.valueBroadcastTimer = null;
      let value;
      const el = document.getElementById(`cl-${ctx.focusField}-${ctx.focusPid}`);
      if (el) value = el.value;
      ctx.collab?.broadcastFocus({ live: true, value, productId: ctx.focusPid, field: ctx.focusField });
    }, VALUE_BROADCAST_MS);
  }

  function applyRemoteDraftValue(payload) {
    if (!payload?.productId || !payload?.field) return;
    if (payload.value == null) return;
    if (ctx.drafts[payload.productId]) return;
    if (ctx.focusPid === payload.productId) return;
    const el = document.getElementById(`cl-${payload.field}-${payload.productId}`);
    if (!el || document.activeElement === el) return;
    if (el.value === String(payload.value)) return;
    el.value = String(payload.value);
    // Keep carried preview in sync without marking local drafts dirty.
    const draft = readDraft(payload.productId);
    previewCarried(payload.productId, draft);
    delete ctx.drafts[payload.productId];
  }

  async function stopLive() {
    if (ctx.valueBroadcastTimer) {
      clearTimeout(ctx.valueBroadcastTimer);
      ctx.valueBroadcastTimer = null;
    }
    const session = ctx.collab;
    ctx.collab = null;
    if (session) await session.destroy();
  }

  function startLive() {
    if (ctx.abort || ctx.collab) return;

    ctx.collab = createGridCollabSession({
      channelName: `collab:closing:${ctx.eventId}`,
      root: panel,
      inputSelector: '.cl-pill-input',
      cellKeyFromInput: closingCellKeyFromInput,
      findCellEl: closingFindCellEl,
      onLocalFocusChange: (key) => {
        if (!key) {
          ctx.focusPid = null;
          ctx.focusField = null;
          return;
        }
        const [pid, ...fieldParts] = String(key).split('::');
        ctx.focusPid = pid || null;
        ctx.focusField = fieldParts.join('::') || null;
      },
      onRemoteFocus: (payload) => {
        applyRemoteDraftValue(payload);
      },
      onChannel: (channel) => {
        channel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'closing_stock',
            filter: `event_id=eq.${ctx.eventId}`,
          },
          (payload) => handleRemoteClosingChange(payload),
        );
      },
      extraBroadcastPayload: () => {
        let value;
        if (ctx.focusPid && ctx.focusField) {
          const el = document.getElementById(`cl-${ctx.focusField}-${ctx.focusPid}`);
          if (el) value = el.value;
        }
        return { value, productId: ctx.focusPid, field: ctx.focusField };
      },
    });
  }

  async function openTransferToWarehouseSheet(pid) {
    await flushAllPending();
    const row = rowByPid(pid);
    if (!row || !(Number(row.carriedOver) || 0)) {
      toast('No carried-over stock on this product.', true);
      return;
    }

    let warehouses = [];
    try {
      warehouses = (await getDB().warehouses.list()) || [];
    } catch (err) {
      toast(err.message || 'Failed to load warehouses', true);
      return;
    }
    if (!warehouses.length) {
      toast('Add a warehouse in Home → Warehouses first.', true);
      return;
    }

    const warehouseOpts = warehouses
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map((w) => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)}</option>`)
      .join('');

    openSheet({
      title: `Transfer ${row.p.name || 'product'} to warehouse`,
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="clXferErr"></div>
          <p class="muted">Moves <strong>${escapeHtml(fmtQty(row.carriedOver))}</strong>
            ${escapeHtml(row.packLabel || 'cases')} carried over into a warehouse.</p>
          <div class="admin-field">
            <label class="admin-label" for="clXferWarehouse">Warehouse</label>
            <select class="admin-select" id="clXferWarehouse">${warehouseOpts}</select>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="clXferDate">Transferred at</label>
            <input class="admin-input" type="datetime-local" id="clXferDate" value="${escapeHtml(nowLocalInput())}">
          </div>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot">
          <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="clXferCancel">Cancel</button>
          <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="clXferSave">Transfer</button>
        </div>`,
    });

    $('clXferCancel').onclick = closeSheet;
    $('clXferSave').onclick = async () => {
      const errEl = $('clXferErr');
      if (errEl) errEl.textContent = '';
      const warehouseId = $('clXferWarehouse')?.value;
      if (!warehouseId) {
        if (errEl) errEl.textContent = 'Pick a warehouse.';
        return;
      }
      const btn = $('clXferSave');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Transferring…';
      }
      try {
        const DB = getDB();
        const transferredAt = $('clXferDate')?.value
          ? new Date($('clXferDate').value).toISOString()
          : new Date().toISOString();
        const qty = roundN(Number(row.carriedOver) || 0, 4);
        if (!(qty > 0)) {
          if (errEl) errEl.textContent = 'No carried-over stock to transfer.';
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Transfer';
          }
          return;
        }
        const pack = productStockPack(row.p, ctx.caseSizes);
        const unit = pack?.stockUnit === 'bottle' ? 'bottles'
          : pack?.stockUnit === 'keg' ? 'kegs'
            : 'cases';
        const returnAmt = roundN(Number(row.returnAmount) || 0, 4);
        const newClose = roundN(Math.max(0, (Number(row.closeCount) || 0) - qty), 4);
        const created = await DB.transfers.create({
          transfer_type: 'event_to_warehouse',
          from_event_id: ctx.eventId,
          from_warehouse_id: null,
          from_bar_id: null,
          to_event_id: null,
          to_bar_id: null,
          to_warehouse_id: warehouseId,
          recipient_id: null,
          unit,
          transferred_at: transferredAt,
        });
        const lineRow = {
          transfer_id: created.id,
          product_id: row.pid,
          qty,
          singles: 0,
          unit_cost: 0,
          chargeback_applied: false,
        };
        try {
          await DB.transfers.addLines([lineRow]);
        } catch (lineErr) {
          const msg = String(lineErr?.message || lineErr);
          if (!/singles|constraint|check/i.test(msg)) throw lineErr;
          const { singles, ...rest } = lineRow;
          await DB.transfers.addLines([rest]);
        }
        await adjustWarehouseStock(warehouseId, row.pid, qty);

        // Clear carried-over so the transfer cannot be repeated and Recon
        // doesn't treat the same stock as both remaining and transferred.
        // Keep return_amount; reduce close count by the transferred qty.
        const patch = {
          closing_cases: newClose,
          closing_singles: 0,
          close_count: newClose,
          return_amount: returnAmt,
          carried_over: 0,
        };
        const saved = await DB.closing.setForEvent(ctx.eventId, row.pid, patch);
        let cl = rowFor(ctx.closingRows, row.pid);
        if (!cl) {
          cl = { event_id: ctx.eventId, product_id: row.pid };
          ctx.closingRows.push(cl);
        }
        Object.assign(cl, patch);
        if (saved?.id) cl.id = saved.id;

        const whName = warehouses.find((w) => w.id === warehouseId)?.name || 'warehouse';
        closeSheet();
        toast(`Transferred ${fmtQty(qty)} to ${whName}`);
        renderTable();
      } catch (err) {
        if (errEl) errEl.textContent = err.message || 'Transfer failed';
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Transfer';
        }
      }
    };
  }

  function renderPalletPreview(qty, perPallet) {
    const wrap = $('clStickerPreview');
    if (!wrap) return;
    const pallets = splitPalletQtys(qty, perPallet);
    if (!pallets.length) {
      wrap.innerHTML = '<p class="muted">Enter a quantity to preview pallets.</p>';
      return;
    }
    const total = roundN(pallets.reduce((a, b) => a + b, 0), 2);
    const chips = pallets.map((q, i) => `
      <div class="cl-pallet-chip">
        <div class="cl-pallet-chip-label">Pallet ${i + 1} of ${pallets.length}</div>
        <div class="cl-pallet-chip-qty">${escapeHtml(fmtQty(q))} cases</div>
      </div>`).join('');
    wrap.innerHTML = `
      <p class="cl-pallet-summary">Printing <strong>${escapeHtml(fmtQty(total))}</strong> cases across
        <strong>${pallets.length}</strong> pallet${pallets.length === 1 ? '' : 's'}.</p>
      <div class="cl-pallet-chips">${chips}</div>`;
  }

  async function openPalletStickerSheet(pid, { forceMode = null } = {}) {
    await flushAllPending();
    const row = rowByPid(pid);
    if (!row) {
      toast('Product not found.', true);
      return;
    }
    const returnQty = Number(row.returnAmount) || 0;
    const carriedQty = Number(row.carriedOver) || 0;
    if (forceMode === 'return' && returnQty <= 0) {
      toast('Enter a return amount for this product first.', true);
      return;
    }
    if (returnQty <= 0 && carriedQty <= 0) {
      toast('Enter a return amount or carried-over stock first.', true);
      return;
    }

    const mode = forceMode === 'return' || (forceMode !== 'warehouse' && returnQty > 0)
      ? 'return'
      : 'warehouse';
    const defaultQty = mode === 'return' ? returnQty : carriedQty;
    let warehouses = [];
    if (mode === 'warehouse') {
      try {
        warehouses = (await getDB().warehouses.list()) || [];
      } catch (_) { /* optional */ }
    }
    const warehouseField = mode === 'warehouse' ? `
      <div class="admin-field">
        <label class="admin-label" for="clStickerWarehouse">Warehouse</label>
        <select class="admin-select" id="clStickerWarehouse">
          ${warehouses.length
    ? warehouses.map((w) => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)}</option>`).join('')
    : '<option value="">—</option>'}
        </select>
      </div>` : '';
    const pack = productStockPack(row.p, ctx.caseSizes);

    openSheet({
      title: `Pallet stickers — ${row.p.name || 'Product'}`,
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="clStickerErr"></div>
          <p class="muted">${mode === 'return'
    ? 'Split this supplier return across pallets and download one A4 sticker per pallet.'
    : 'Split carried-over stock across pallets for the warehouse transfer.'}</p>
          ${warehouseField}
          <div class="admin-field">
            <label class="admin-label" for="clStickerQty">Cases to print</label>
            <input class="admin-input num-math" type="text" inputmode="decimal" autocomplete="off"
              id="clStickerQty" value="${escapeHtml(String(defaultQty))}">
          </div>
          <div class="admin-field">
            <label class="admin-label" for="clStickerPer">Cases per pallet</label>
            <input class="admin-input num-math" type="text" inputmode="numeric" autocomplete="off"
              id="clStickerPer" placeholder="e.g. 48"
              value="${pack?.casesPerPallet ? escapeHtml(String(pack.casesPerPallet)) : ''}">
            <p class="wst-form-hint muted">Used to split the quantity across pallets.</p>
          </div>
          <div class="admin-field" id="clStickerPreview"></div>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot">
          <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="clStickerCancel">Cancel</button>
          <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="clStickerPdf">Download PDF</button>
        </div>`,
    });

    const qtyEl = $('clStickerQty');
    const perEl = $('clStickerPer');

    const refreshPreview = () => renderPalletPreview(parseQty(qtyEl.value), parseQty(perEl.value));
    qtyEl.oninput = refreshPreview;
    perEl.oninput = refreshPreview;
    refreshPreview();

    function stickerCtx(pallets) {
      const whId = $('clStickerWarehouse')?.value;
      const whName = warehouses.find((w) => w.id === whId)?.name || '';
      return {
        destinationLabel: mode === 'return' ? (row.supplierName || '—') : (whName || 'Warehouse'),
        productName: row.p.name || 'Product',
        caseSize: row.packLabel || row.p.case_size || '',
        pallets,
      };
    }

    function readPalletsOrError() {
      const errEl = $('clStickerErr');
      if (errEl) errEl.textContent = '';
      const qty = parseQty(qtyEl.value);
      const per = parseQty(perEl.value);
      const pallets = splitPalletQtys(qty, per);
      if (!pallets.length) {
        if (errEl) errEl.textContent = 'Enter a quantity greater than 0.';
        return null;
      }
      return pallets;
    }

    $('clStickerCancel').onclick = closeSheet;

    $('clStickerPdf').onclick = async () => {
      const pallets = readPalletsOrError();
      if (!pallets) return;
      const btn = $('clStickerPdf');
      const prev = btn?.textContent;
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Generating…';
      }
      try {
        await generatePalletStickerPDF(stickerCtx(pallets));
        closeSheet();
        toast(`Downloaded ${pallets.length} A4 pallet sticker${pallets.length === 1 ? '' : 's'}`);
      } catch (err) {
        const errEl = $('clStickerErr');
        if (errEl) errEl.textContent = err.message || 'Failed to generate stickers';
        if (btn) {
          btn.disabled = false;
          btn.textContent = prev || 'Download PDF';
        }
      }
    };
  }

  const onProductFilter = (e) => applyProductFilter(e.detail || getLastProductFilter());
  const onResize = () => layoutTableScroll();

  function servingBarsForPrint() {
    return (ctx.event?.bars || [])
      .filter((b) => !isBoneYard(b))
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  function runPrintClosingSheet({ scope, barId }) {
    const result = printClosingCountSheet({
      event: ctx.event,
      caseSizes: ctx.caseSizes,
      barProducts: ctx.event?.bar_products || [],
      scope,
      barId,
    });
    if (result.error) {
      toast(result.error, true);
      return;
    }
    if (scope === 'all' || (scope === 'bar' && result.barCount > 0)) {
      const n = result.barCount || 1;
      toast(`Opened ${n} closing count sheet${n === 1 ? '' : 's'} (${result.productCount} item${result.productCount === 1 ? '' : 's'})`);
      return;
    }
    toast(`Opened closing count sheet (${result.productCount} item${result.productCount === 1 ? '' : 's'})`);
  }

  function openPrintClosingSheetDialog() {
    if (!ctx.event) {
      toast('Closing stock is still loading', true);
      return;
    }
    const bars = servingBarsForPrint();
    const barOptions = bars
      .map((b) => `<option value="bar:${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`)
      .join('');

    openSheet({
      title: 'Print closing sheet',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <p class="wst-form-hint muted" style="margin:0 0 4px">
            Choose what to print — all locations, the whole event, or a single bar.
          </p>
          <div class="admin-field">
            <label class="admin-label" for="clPrintScope">Location</label>
            <select class="admin-select" id="clPrintScope">
              <option value="all" selected>All locations (one sheet per bar)</option>
              <option value="event">Whole event (full catalogue)</option>
              ${barOptions
                ? `<optgroup label="One bar">${barOptions}</optgroup>`
                : '<option value="" disabled>No bars yet</option>'}
            </select>
          </div>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="clPrintCancel">Cancel</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="clPrintGo">Print</button>
        </div>`,
    });

    $('clPrintCancel')?.addEventListener('click', () => closeSheet());
    $('clPrintGo')?.addEventListener('click', () => {
      const raw = $('clPrintScope')?.value || 'event';
      let scope = 'event';
      let barId;
      if (raw === 'all') scope = 'all';
      else if (raw === 'event') scope = 'event';
      else if (raw.startsWith('bar:')) {
        scope = 'bar';
        barId = raw.slice(4);
      }
      if (scope === 'bar' && !barId) {
        toast('Choose a bar to print', true);
        return;
      }
      // Open print while still in the click gesture, then close the drawer.
      runPrintClosingSheet({ scope, barId });
      closeSheet();
    });
  }

  function handlePrintClosingSheet() {
    openPrintClosingSheetDialog();
  }

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'print-closing-count-sheet') {
      e.detail.handled = true;
      handlePrintClosingSheet();
    }
  };

  const onTableFilter = (e) => {
    if (e.detail?.panel !== 'closing') return;
    const values = e.detail?.values;
    if (!values) return;
    ctx.statusFilter = values.statusFilter || '';
    ctx.categoryFilter = values.categoryFilter || '';
    ctx.supplierFilter = values.supplierFilter || '';
    ctx.sortKey = values.sortKey || 'name';
    renderTable();
  };

  function onClick(e) {
    const btn = e.target.closest('[data-cl-action]');
    if (!btn || btn.disabled) return;
    const pid = btn.dataset.clPid;
    if (!pid) return;
    if (btn.dataset.clAction === 'return') {
      openPalletStickerSheet(pid, { forceMode: 'return' });
      return;
    }
    if (btn.dataset.clAction === 'transfer') {
      openTransferToWarehouseSheet(pid);
      return;
    }
    if (btn.dataset.clAction === 'sticker') {
      openPalletStickerSheet(pid);
    }
  }

  panel.addEventListener('input', onInput);
  panel.addEventListener('change', onInput);
  panel.addEventListener('blur', onBlur, true);
  panel.addEventListener('click', onClick);
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
  document.addEventListener(ADMIN_TABLE_FILTER, onTableFilter);
  window.addEventListener('resize', onResize);
  window.addEventListener('pagehide', onPageHide);

  const wrap = $('clTableWrap');
  const thead = $('clGridHead');
  if (wrap && thead && typeof ResizeObserver !== 'undefined') {
    ctx.theadObserver = new ResizeObserver(syncGridLayout);
    ctx.theadObserver.observe(thead);
  }

  (async () => {
    try {
      const DB = getDB();
      const [event, caseSizes, suppliers, closing, supplierReturns] = await Promise.all([
        loadEventFull(ctx.eventId),
        loadCaseSizes(),
        loadSuppliers(),
        DB.closing.forEvent(ctx.eventId),
        DB.supplierReturns.forEvent(ctx.eventId).catch(() => []),
      ]);
      if (ctx.abort) return;
      ctx.event = event;
      ctx.caseSizes = caseSizes || [];
      ctx.suppliers = suppliers || [];
      ctx.closingRows = closing || [];
      ctx.supplierReturns = supplierReturns || [];
      renderTable();
      applyProductFilter(getLastProductFilter());
      startLive();
    } catch (err) {
      const body = $('clBody');
      if (body) {
        reportError(err, { source: 'admin.closing.load', silent: true });
        body.innerHTML = `<tr><td colspan="${COL_COUNT}">${errorState({
          title: 'Couldn’t load closing stock',
          copy: err.message || 'Failed to load closing stock',
          variant: 'admin',
        })}</td></tr>`;
      }
      toast(err.message || 'Failed to load closing stock', true);
    }
  })();

  return () => {
    ctx.abort = true;
    flushAllPending();
    stopLive();
    ctx.theadObserver?.disconnect();
    panel.removeEventListener('input', onInput);
    panel.removeEventListener('change', onInput);
    panel.removeEventListener('blur', onBlur, true);
    panel.removeEventListener('click', onClick);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
    document.removeEventListener(ADMIN_TABLE_FILTER, onTableFilter);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pagehide', onPageHide);
  };
}
