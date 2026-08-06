/**
 * Closing stock — end-of-event physical counts, SOR returns, carried over.
 * Grid layout mirrors Distribution / Products (dist-grid).
 */

import { $, escapeHtml, toast, nowLocalInput } from '../../lib/util.js';
import {
  getDB, loadEventFull, loadCaseSizes, loadSuppliers,
} from '../../db.js';
import { parseQty } from '../../stock-entry.js';
import { productStockPack } from '../../pack-metrics.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { openModal, closeModal } from '../../components/modal.js';
import { icon } from '../../lib/icons.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
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
import { closingRowFor, roundN } from '../../lib/recon.js';
import {
  generatePalletStickerPDF,
  splitPalletQtys,
} from '../../lib/pallet-sticker-pdf.js';
import {
  getClientId,
  getDisplayName,
  setDisplayName,
} from '../../lib/session-identity.js';
import { getRealtimeClient } from '../../lib/realtime.js';
import {
  cellFocusOwners,
  flattenPresenceState,
  formatClosingPresence,
  mergeClosingRemoteRow,
  peerColor,
  shouldApplyRemoteClosingEdit,
} from '../../lib/closing-live.js';

const COL_COUNT = 13; // product + pack + 9 data cols + return + actions
const LOCAL_ECHO_MS = 1500;
const AUTOSAVE_MS = 180;
const VALUE_BROADCAST_MS = 40;
const PRESENCE_HEARTBEAT_MS = 2500;

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

  return `
    <tr class="dist-prod-row cl-row" data-cl-pid="${escapeHtml(r.pid)}"
      data-product-name="${escapeHtml((r.p.name || '').toLowerCase())}">
      <th class="dist-sticky dist-prod-name" data-col="product" scope="row">${escapeHtml(r.p.name || 'Product')}</th>
      <td class="dist-sticky dist-prod-pack muted" data-col="pack">${escapeHtml(r.packLabel)}</td>
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
    <th class="dist-sticky dist-col-header dist-col-product" data-col="product">
      <div class="dist-bar-head dist-bar-head--left"><span class="dist-bar-name">Product</span></div>
    </th>
    <th class="dist-sticky dist-col-header dist-col-pack" data-col="pack">
      <div class="dist-bar-head"><span class="dist-bar-name">Pack</span></div>
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
      <div class="cl-name-gate" id="clNameGate" hidden>
        <p class="cl-name-gate-copy">Enter your name so others can see which cell you’re editing.</p>
        <div class="cl-name-gate-row">
          <input type="text" class="admin-input" id="clNameInput" maxlength="40"
            autocomplete="nickname" placeholder="Your name" aria-label="Your name">
          <button type="button" class="cl-name-gate-btn" id="clNameSave">Continue</button>
        </div>
      </div>
      <div class="cl-live-bar" id="clLiveBar" hidden>
        <span class="cl-live-dot" aria-hidden="true"></span>
        <span class="cl-live-text" id="clLivePresence">Connecting…</span>
      </div>
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
            <tr><td colspan="${COL_COUNT}" class="dist-empty muted">Loading closing stock…</td></tr>
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
    suppliers: [],
    caseSizes: [],
    drafts: {},
    saveTimers: {},
    theadObserver: null,
    abort: false,
    overMaxPrompt: new Set(),
    liveChannel: null,
    recentLocalWrites: new Map(),
    focusPid: null,
    focusField: null,
    peerCells: {},
    presencePeers: [],
    focusBroadcast: {},
    presenceTimer: null,
    valueBroadcastTimer: null,
    liveReady: false,
    statusFilter: '',
    categoryFilter: '',
    supplierFilter: '',
    sortKey: 'name',
    searchQuery: getLastProductFilter().query || '',
  };

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
    const cl = rowFor(ctx.closingRows, pid) || {};
    const countBase = closingCountToForm(cl);
    const returnBase = returnAmountToForm(cl.return_amount);
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
    });
  }

  function visibleRows() {
    return filterClosingRows(allRows(), {
      statusFilter: ctx.statusFilter,
      categoryFilter: ctx.categoryFilter,
      supplierFilter: ctx.supplierFilter,
    });
  }

  function categoryOptions(rows) {
    return [...new Set((rows || []).map((r) => r.category || 'Uncategorised'))]
      .sort((a, b) => a.localeCompare(b));
  }

  function supplierOptions(rows) {
    const byId = new Map();
    let hasNone = false;
    (rows || []).forEach((r) => {
      if (!r.supplierId && !r.supplierName) {
        hasNone = true;
        return;
      }
      const key = r.supplierId || r.supplierName;
      if (!byId.has(key)) {
        byId.set(key, r.supplierName || 'Supplier');
      }
    });
    const list = [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (hasNone) list.push({ id: '__none__', name: 'No supplier' });
    return list;
  }

  function paintToolbar(sourceRows) {
    const toolbar = $('clToolbar');
    if (!toolbar) return;
    if (!sourceRows.length) {
      toolbar.hidden = true;
      toolbar.innerHTML = '';
      return;
    }
    toolbar.hidden = false;

    const cats = categoryOptions(sourceRows);
    if (ctx.categoryFilter && !cats.includes(ctx.categoryFilter)) {
      ctx.categoryFilter = '';
    }
    const suppliers = supplierOptions(sourceRows);
    if (
      ctx.supplierFilter
      && !suppliers.some((s) => s.id === ctx.supplierFilter)
    ) {
      ctx.supplierFilter = '';
    }

    const status = ctx.statusFilter || '';
    const sort = ctx.sortKey || 'name';
    const seg = (value, label) => {
      const on = status === value;
      return `<button type="button" class="projections-filter-btn${on ? ' is-active' : ''}"
        data-cl-filter="${escapeHtml(value)}" role="tab" aria-selected="${on}">${label}</button>`;
    };

    toolbar.innerHTML = `
      <div class="projections-filter" role="tablist" aria-label="Closing status">
        ${seg('', 'All')}
        ${seg('uncounted', 'Uncounted')}
        ${seg('counted', 'Counted')}
        ${seg('returning', 'Returning')}
        ${seg('carried', 'Carried over')}
        ${seg('over_sor', 'Over SOR')}
      </div>
      <select class="admin-select sales-toolbar-select" id="clCatFilter" aria-label="Category">
        <option value="">All categories</option>
        ${cats.map((g) => `<option value="${escapeHtml(g)}"${g === ctx.categoryFilter ? ' selected' : ''}>${escapeHtml(g)}</option>`).join('')}
      </select>
      <select class="admin-select sales-toolbar-select" id="clSupplierFilter" aria-label="Supplier">
        <option value="">All suppliers</option>
        ${suppliers.map((s) => `<option value="${escapeHtml(s.id)}"${s.id === ctx.supplierFilter ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
      </select>
      <select class="admin-select sales-toolbar-select" id="clSort" aria-label="Sort by">
        <option value="name"${sort === 'name' ? ' selected' : ''}>Name A–Z</option>
        <option value="invoice"${sort === 'invoice' ? ' selected' : ''}>Invoice ↓</option>
        <option value="closing"${sort === 'closing' ? ' selected' : ''}>Closing ↓</option>
        <option value="return"${sort === 'return' ? ' selected' : ''}>Return ↓</option>
        <option value="carried"${sort === 'carried' ? ' selected' : ''}>Carried ↓</option>
        <option value="sor"${sort === 'sor' ? ' selected' : ''}>SOR % ↓</option>
      </select>`;

    toolbar.querySelectorAll('[data-cl-filter]').forEach((btn) => {
      btn.onclick = () => {
        ctx.statusFilter = btn.dataset.clFilter || '';
        renderTable();
      };
    });
    const catSel = toolbar.querySelector('#clCatFilter');
    if (catSel) {
      catSel.onchange = () => {
        ctx.categoryFilter = catSel.value || '';
        renderTable();
      };
    }
    const supSel = toolbar.querySelector('#clSupplierFilter');
    if (supSel) {
      supSel.onchange = () => {
        ctx.supplierFilter = supSel.value || '';
        renderTable();
      };
    }
    const sortSel = toolbar.querySelector('#clSort');
    if (sortSel) {
      sortSel.onchange = () => {
        ctx.sortKey = sortSel.value || 'name';
        renderTable();
      };
    }
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
    paintToolbar(sourceRows);
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
        <td colspan="2" class="dist-cat-pinned"><span class="dist-bar-name">${escapeHtml(cat)}</span></td>
        <td colspan="${COL_COUNT - 2}" class="dist-cat-scroll"></td>
      </tr>`;
      grouped[cat].forEach((r) => { html += renderRow(r); });
    });
    body.innerHTML = html;
    syncPeerCellMarkers();
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
    ctx.recentLocalWrites.set(pid, Date.now());
    delete ctx.drafts[pid];

    const row = buildClosingRow({
      ep,
      closingRow: cl,
      suppliers: ctx.suppliers,
      caseSizes: ctx.caseSizes,
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
      tr.hidden = !(tr.dataset.productName || '').includes(q);
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

  function setNameGateVisible(show) {
    const gate = $('clNameGate');
    if (gate) gate.hidden = !show;
    const liveBar = $('clLiveBar');
    if (liveBar && show) liveBar.hidden = true;
  }

  function rebuildPeerCells() {
    const fromPresence = cellFocusOwners(ctx.presencePeers, getClientId());
    /** @type {Record<string, object>} */
    const merged = { ...fromPresence };
    const selfId = getClientId();
    Object.values(ctx.focusBroadcast || {}).forEach((info) => {
      if (!info || info.clientId === selfId) return;
      if (!info.productId || !info.field || !info.name) return;
      const key = `${info.productId}::${info.field}`;
      merged[key] = info;
    });
    ctx.peerCells = merged;
    syncPeerCellMarkers();
  }

  function updatePresenceUi(peers) {
    const liveBar = $('clLiveBar');
    const textEl = $('clLivePresence');
    if (!liveBar || !textEl) return;
    liveBar.hidden = false;
    ctx.presencePeers = peers || [];
    const fmt = formatClosingPresence(ctx.presencePeers, getClientId());
    textEl.textContent = fmt.text;
    rebuildPeerCells();
  }

  function syncPeerCellMarkers() {
    panel.querySelectorAll('.cl-cell--peer').forEach((cell) => {
      cell.classList.remove('cl-cell--peer');
      cell.style.removeProperty('--cl-peer-color');
      cell.querySelector('.cl-peer-tag')?.remove();
    });
    Object.values(ctx.peerCells || {}).forEach((info) => {
      if (!info?.productId || !info?.field || !info.name) return;
      const input = document.getElementById(`cl-${info.field}-${info.productId}`);
      const cell = input?.closest('.cl-cell') || input?.closest('td');
      if (!cell) return;
      cell.classList.add('cl-cell--peer');
      cell.style.setProperty('--cl-peer-color', info.color || '#2563eb');
      const tag = document.createElement('span');
      tag.className = 'cl-peer-tag';
      tag.textContent = info.name;
      cell.appendChild(tag);
    });
  }

  function applyRemoteRowToUi(pid, { flash = true } = {}) {
    const cl = rowFor(ctx.closingRows, pid) || {};
    const countForm = closingCountToForm(cl);
    const returnForm = returnAmountToForm(cl.return_amount);
    const casesEl = document.getElementById(`cl-cases-${pid}`);
    const singlesEl = document.getElementById(`cl-singles-${pid}`);
    const retCasesEl = document.getElementById(`cl-return-cases-${pid}`);
    const retSinglesEl = document.getElementById(`cl-return-singles-${pid}`);
    const active = document.activeElement;
    if (casesEl && active !== casesEl) casesEl.value = countForm.cases;
    if (singlesEl && active !== singlesEl) singlesEl.value = countForm.singles;
    if (retCasesEl && active !== retCasesEl) retCasesEl.value = returnForm.cases;
    if (retSinglesEl && active !== retSinglesEl) retSinglesEl.value = returnForm.singles;

    const ep = ctx.event?.event_products?.find((x) => x.product_id === pid);
    if (ep) {
      const row = buildClosingRow({
        ep,
        closingRow: cl,
        suppliers: ctx.suppliers,
        caseSizes: ctx.caseSizes,
      });
      const carriedEl = document.getElementById(`cl-carried-${pid}`);
      const maxEl = document.getElementById(`cl-max-${pid}`);
      if (carriedEl) {
        carriedEl.textContent = fmtQty(row.carriedOver);
        carriedEl.title = row.carriedLabel;
      }
      if (maxEl) maxEl.textContent = fmtMax(row.maxReturnable);
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
    syncPeerCellMarkers();
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

  function focusPayload(extra = {}) {
    const name = getDisplayName();
    const clientId = getClientId();
    const field = ctx.focusField;
    const productId = ctx.focusPid;
    let value;
    if (productId && field) {
      const el = document.getElementById(`cl-${field}-${productId}`);
      if (el) value = el.value;
    }
    return {
      name: name || 'Someone',
      clientId,
      productId,
      field,
      value,
      color: peerColor(clientId),
      at: Date.now(),
      ...extra,
    };
  }

  async function broadcastFocus(extra = {}) {
    const channel = ctx.liveChannel;
    if (!channel || !ctx.liveReady) return;
    try {
      await channel.send({
        type: 'broadcast',
        event: 'cell-focus',
        payload: focusPayload(extra),
      });
    } catch { /* ignore */ }
  }

  function scheduleValueBroadcast() {
    if (!ctx.liveReady || !ctx.focusPid || !ctx.focusField) return;
    clearTimeout(ctx.valueBroadcastTimer);
    ctx.valueBroadcastTimer = setTimeout(() => {
      ctx.valueBroadcastTimer = null;
      broadcastFocus({ live: true });
    }, VALUE_BROADCAST_MS);
  }

  async function trackPresence(patch = {}) {
    const channel = ctx.liveChannel;
    if (!channel || !ctx.liveReady) return;
    const name = getDisplayName();
    if (!name) return;
    try {
      await channel.track({
        name,
        clientId: getClientId(),
        focusPid: ctx.focusPid,
        focusField: ctx.focusField,
        at: Date.now(),
        ...patch,
      });
    } catch { /* ignore presence blips */ }
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

  function handleFocusBroadcast(payload) {
    if (ctx.abort || !payload) return;
    const clientId = payload.clientId;
    if (!clientId || clientId === getClientId()) return;
    if (!payload.productId || !payload.field) {
      delete ctx.focusBroadcast[clientId];
    } else {
      ctx.focusBroadcast[clientId] = {
        name: (payload.name || '').trim() || 'Someone',
        clientId,
        productId: payload.productId,
        field: payload.field,
        color: payload.color || peerColor(clientId),
      };
      applyRemoteDraftValue(payload);
    }
    rebuildPeerCells();
  }

  async function stopLive() {
    ctx.liveReady = false;
    if (ctx.presenceTimer) {
      clearInterval(ctx.presenceTimer);
      ctx.presenceTimer = null;
    }
    if (ctx.valueBroadcastTimer) {
      clearTimeout(ctx.valueBroadcastTimer);
      ctx.valueBroadcastTimer = null;
    }
    const channel = ctx.liveChannel;
    ctx.liveChannel = null;
    if (!channel) return;
    try {
      await channel.unsubscribe();
    } catch { /* ignore */ }
    try {
      getRealtimeClient()?.removeChannel(channel);
    } catch { /* ignore */ }
  }

  async function startLive() {
    if (ctx.abort || ctx.liveChannel) return;
    const name = getDisplayName();
    setNameGateVisible(!name);
    if (!name) return;

    const rt = getRealtimeClient();
    const liveBar = $('clLiveBar');
    const textEl = $('clLivePresence');
    if (!rt) {
      if (liveBar) liveBar.hidden = true;
      return;
    }
    if (liveBar) liveBar.hidden = false;
    if (textEl) textEl.textContent = 'Connecting…';

    const selfId = getClientId();
    const channel = rt.channel(`closing:${ctx.eventId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: selfId },
      },
    });
    ctx.liveChannel = channel;

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

    channel.on('broadcast', { event: 'cell-focus' }, ({ payload }) => {
      handleFocusBroadcast(payload);
    });

    const refreshPeers = () => {
      const peers = flattenPresenceState(channel.presenceState() || {});
      updatePresenceUi(peers);
    };

    channel.on('presence', { event: 'sync' }, refreshPeers);
    channel.on('presence', { event: 'join' }, refreshPeers);
    channel.on('presence', { event: 'leave' }, refreshPeers);

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        ctx.liveReady = true;
        await trackPresence();
        await broadcastFocus();
        refreshPeers();
        if (ctx.presenceTimer) clearInterval(ctx.presenceTimer);
        ctx.presenceTimer = setInterval(() => {
          trackPresence();
        }, PRESENCE_HEARTBEAT_MS);
        if (textEl && (textEl.textContent === 'Connecting…' || !textEl.textContent)) {
          textEl.textContent = 'Just you here';
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        ctx.liveReady = false;
        if (textEl) textEl.textContent = 'Live sync unavailable';
      }
    });
  }

  function saveDisplayNameFromGate() {
    const input = $('clNameInput');
    const name = setDisplayName(input?.value || '');
    if (!name) {
      toast('Enter your name (up to 40 characters)', true);
      input?.focus();
      return;
    }
    setNameGateVisible(false);
    startLive();
  }

  function onFocusIn(e) {
    const input = e.target?.closest?.('.cl-pill-input');
    if (!input) return;
    ctx.focusPid = input.dataset.clPid || null;
    ctx.focusField = input.dataset.clField || null;
    trackPresence();
    broadcastFocus();
  }

  function onFocusOut(e) {
    const input = e.target?.closest?.('.cl-pill-input');
    if (!input) return;
    window.setTimeout(() => {
      const active = document.activeElement?.closest?.('.cl-pill-input');
      if (active) {
        ctx.focusPid = active.dataset.clPid || null;
        ctx.focusField = active.dataset.clField || null;
      } else {
        ctx.focusPid = null;
        ctx.focusField = null;
      }
      trackPresence();
      broadcastFocus();
    }, 0);
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
      toast('Add a warehouse in Catalog → Warehouses first.', true);
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

  function handlePrintClosingSheet() {
    if (!ctx.event) {
      toast('Closing stock is still loading', true);
      return;
    }
    const result = printClosingCountSheet({
      event: ctx.event,
      caseSizes: ctx.caseSizes,
    });
    if (result.error) {
      toast(result.error, true);
      return;
    }
    toast(`Opened closing count sheet (${result.productCount} item${result.productCount === 1 ? '' : 's'})`);
  }

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'print-closing-count-sheet') {
      e.detail.handled = true;
      handlePrintClosingSheet();
    }
  };

  function onClick(e) {
    if (e.target.closest('#clNameSave')) {
      saveDisplayNameFromGate();
      return;
    }
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

  function onKeyDown(e) {
    if (e.key !== 'Enter') return;
    if (e.target?.id === 'clNameInput') {
      e.preventDefault();
      saveDisplayNameFromGate();
    }
  }

  panel.addEventListener('input', onInput);
  panel.addEventListener('change', onInput);
  panel.addEventListener('blur', onBlur, true);
  panel.addEventListener('focusin', onFocusIn);
  panel.addEventListener('focusout', onFocusOut);
  panel.addEventListener('keydown', onKeyDown);
  panel.addEventListener('click', onClick);
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
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
      const [event, caseSizes, suppliers, closing] = await Promise.all([
        loadEventFull(ctx.eventId),
        loadCaseSizes(),
        loadSuppliers(),
        DB.closing.forEvent(ctx.eventId),
      ]);
      if (ctx.abort) return;
      ctx.event = event;
      ctx.caseSizes = caseSizes || [];
      ctx.suppliers = suppliers || [];
      ctx.closingRows = closing || [];
      renderTable();
      applyProductFilter(getLastProductFilter());
      startLive();
    } catch (err) {
      const body = $('clBody');
      if (body) {
        body.innerHTML = `<tr><td colspan="${COL_COUNT}" class="dist-empty del-empty--err">${escapeHtml(err.message || 'Failed to load closing stock')}</td></tr>`;
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
    panel.removeEventListener('focusin', onFocusIn);
    panel.removeEventListener('focusout', onFocusOut);
    panel.removeEventListener('keydown', onKeyDown);
    panel.removeEventListener('click', onClick);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pagehide', onPageHide);
  };
}
