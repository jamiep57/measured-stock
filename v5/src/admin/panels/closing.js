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
import { icon } from '../../lib/icons.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import {
  buildClosingRow,
  closingCountToForm,
  closingPatchFromDraft,
  computeClosingRows,
  returnAmountToForm,
} from '../../lib/closing-stock.js';
import { closingRowFor, roundN } from '../../lib/recon.js';
import {
  generatePalletStickerPDF,
  splitPalletQtys,
} from '../../lib/pallet-sticker-pdf.js';

const COL_COUNT = 12; // product + pack + 9 data cols + actions

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

function groupByCategory(rows) {
  const grouped = {};
  rows.forEach((r) => {
    const cat = r.category || 'Uncategorised';
    (grouped[cat] = grouped[cat] || []).push(r);
  });
  Object.values(grouped).forEach((list) => {
    list.sort((a, b) => (a.p.name || '').localeCompare(b.p.name || ''));
  });
  return grouped;
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
  const canSticker = (Number(r.returnAmount) || 0) > 0 || canTransfer;

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
    ${th('Actions', 'cl-col-actions')}
  </tr>`;
}

export function renderClosingShell() {
  return `
    <div class="cl-panel" id="closingPanel">
      <div class="wst-stats cl-stats" id="clStats" hidden></div>
      <p class="cl-hint muted">
        Counts auto-save as you type. Closing and return use each product’s stock unit
        (cases / singles, bottles, or kegs). <strong>Max returnable</strong> = invoice × supplier SOR %.
        <strong>Carried over</strong> = close count − return amount.
      </p>
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
  };

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

    const rows = allRows();
    if (stats) {
      stats.hidden = !rows.length;
      stats.innerHTML = rows.length ? renderStats(rows) : '';
    }

    if (!rows.length) {
      body.innerHTML = '';
      if (table) table.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }

    if (table) table.hidden = false;
    if (empty) empty.hidden = true;

    const grouped = groupByCategory(rows);
    let html = '';
    Object.keys(grouped).sort().forEach((cat) => {
      html += `<tr class="dist-cat-row">
        <td colspan="2" class="dist-cat-pinned"><span class="dist-bar-name">${escapeHtml(cat)}</span></td>
        <td colspan="${COL_COUNT - 2}" class="dist-cat-scroll"></td>
      </tr>`;
      grouped[cat].forEach((r) => { html += renderRow(r); });
    });
    body.innerHTML = html;
    requestAnimationFrame(layoutTableScroll);
  }

  async function persist(pid) {
    if (!ctx.event) return;
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
    const { capped, ...patch } = closingPatchFromDraft(ep.product, draft, ctx.caseSizes, {
      maxReturnable: preview.maxReturnable,
    });
    if (capped?.length) {
      toast(`Return capped to ${capped.join(' / ')}`, true);
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
    if (stats) stats.innerHTML = renderStats(allRows());
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

  function scheduleSave(pid) {
    clearTimeout(ctx.saveTimers[pid]);
    ctx.drafts[pid] = readDraft(pid);
    previewCarried(pid, ctx.drafts[pid]);
    ctx.saveTimers[pid] = setTimeout(() => {
      delete ctx.saveTimers[pid];
      persist(pid).catch((e) => toast(e.message || 'Save failed', true));
    }, 400);
  }

  /** Flush one product immediately (blur / leave). */
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

  /** Persist every in-flight draft so navigation / refresh does not drop counts. */
  function flushAllPending() {
    const pids = new Set([
      ...Object.keys(ctx.saveTimers),
      ...Object.keys(ctx.drafts),
    ]);
    Object.values(ctx.saveTimers).forEach(clearTimeout);
    ctx.saveTimers = {};
    // Do not re-read inputs — on unmount the grid may already be gone;
    // drafts were captured on each keystroke.
    return Promise.all([...pids].map((pid) => flushSave(pid, { reread: false })));
  }

  function applyProductFilter({ query, productId } = {}) {
    const q = (query || '').trim().toLowerCase();
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
    flushAllPending();
  }

  function rowByPid(pid) {
    return allRows().find((r) => r.pid === pid) || null;
  }

  function syncRowActions(pid) {
    const row = rowByPid(pid);
    if (!row) return;
    const canTransfer = (Number(row.carriedOver) || 0) > 0;
    const canSticker = (Number(row.returnAmount) || 0) > 0 || canTransfer;
    const tr = panel.querySelector(`.cl-row[data-cl-pid="${CSS.escape(pid)}"]`);
    if (!tr) return;
    const xferBtn = tr.querySelector('[data-cl-action="transfer"]');
    const stickerBtn = tr.querySelector('[data-cl-action="sticker"]');
    if (xferBtn) xferBtn.disabled = !canTransfer;
    if (stickerBtn) stickerBtn.disabled = !canSticker;
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

  async function openPalletStickerSheet(pid) {
    await flushAllPending();
    const row = rowByPid(pid);
    if (!row) {
      toast('Product not found.', true);
      return;
    }
    const returnQty = Number(row.returnAmount) || 0;
    const carriedQty = Number(row.carriedOver) || 0;
    if (returnQty <= 0 && carriedQty <= 0) {
      toast('Enter a return amount or carried-over stock first.', true);
      return;
    }

    const mode = returnQty > 0 ? 'return' : 'warehouse';
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

  function onClick(e) {
    const btn = e.target.closest('[data-cl-action]');
    if (!btn || btn.disabled) return;
    const pid = btn.dataset.clPid;
    if (!pid) return;
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
    ctx.theadObserver?.disconnect();
    panel.removeEventListener('input', onInput);
    panel.removeEventListener('change', onInput);
    panel.removeEventListener('blur', onBlur, true);
    panel.removeEventListener('click', onClick);
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pagehide', onPageHide);
  };
}
