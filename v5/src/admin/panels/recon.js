/**
 * Financial recon — post-event supplier reconciliation grid.
 */

import {
  $, escapeHtml, toast, formatMoney,
} from '../../lib/util.js';
import { initIcons } from '../../lib/icons.js';
import {
  getDB, loadEventFull, loadCaseSizes, loadLibraryProducts, loadSuppliers,
} from '../../db.js';
import { parseQty, storedToForm, totalUnitsForProduct } from '../../stock-entry.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import {
  RECON_COLS,
  loadReconColVisibility,
  saveReconColVisibility,
  computeReconRows,
  filterReconRows,
  reconTotals,
  formatReconMoney,
  formatReconQty,
  varianceClass,
  resolveClosingCounts,
  reconClosingTotal,
  closingRowFor,
  roundN,
} from '../../lib/recon.js';

const STATUS_TITLES = {
  red: 'Action needed',
  yellow: 'Review',
  green: 'Done',
  blue: 'None returned',
};

function groupByCategory(rows) {
  const grouped = {};
  rows.forEach((r) => {
    const cat = r.p?.category?.name || 'Uncategorised';
    (grouped[cat] = grouped[cat] || []).push(r);
  });
  Object.values(grouped).forEach((list) => {
    list.sort((a, b) => (a.p.name || '').localeCompare(b.p.name || ''));
  });
  return grouped;
}

function readInlineDraft(pid, closingRows) {
  const invEl = document.getElementById(`rcn-inv-${pid}`);
  const casesEl = document.getElementById(`rcn-cl-cases-${pid}`);
  const singlesEl = document.getElementById(`rcn-cl-singles-${pid}`);
  const invRaw = invEl?.value.trim() ?? '';
  const invSet = invRaw !== '';
  const cl = closingRowFor(closingRows, pid) || {};
  const base = resolveClosingCounts(cl, null);
  const casesRaw = casesEl?.value.trim() ?? '';
  const singlesRaw = singlesEl?.value.trim() ?? '';
  return {
    invoiceSet: invSet,
    invoiced: invSet ? parseQty(invRaw) : 0,
    closingCases: casesRaw !== '' ? parseQty(casesRaw) : base.closingCases,
    closingSingles: singlesRaw !== '' ? parseQty(singlesRaw) : base.closingSingles,
  };
}

function renderInlineInput(pid, fieldId, value) {
  const shown = value != null && value !== '' ? String(value) : '';
  return `<input type="text" class="recon-cell-input num-math" id="${fieldId}"
    data-rcn-pid="${escapeHtml(pid)}" value="${shown ? escapeHtml(shown) : ''}"
    autocomplete="off" inputmode="decimal" placeholder="—">`;
}

function rcnTh(col, label, extraClass = '') {
  return `<th class="rcn-th dist-col-header ${extraClass}" data-rcn-col="${col}">
    <div class="dist-bar-head"><span class="dist-bar-name">${label}</span></div>
  </th>`;
}

function productMetaLine(r) {
  const bits = [];
  if (r.p?.case_size) bits.push(r.p.case_size);
  if (r.supplierName && r.supplierName !== '—') bits.push(r.supplierName);
  const price = formatReconMoney(r.rowPrice);
  if (price && price !== '—') bits.push(price);
  return bits.join(' · ');
}

function renderRow(r) {
  const noteHint = r.reconNote
    ? `<span class="recon-note-hint" title="${escapeHtml(r.reconNote)}">${escapeHtml(r.reconNote)}</span>`
    : '';
  const invVal = r.hasInvoice ? String(r.invoiced ?? '') : '';
  const closingCasesVal = r.hasClosing ? String(r.closingCases ?? 0) : '';
  const closingSinglesVal = r.hasClosing ? String(r.closingSingles ?? 0) : '';
  const varCls = varianceClass(r.consumption, r.plu, r.variance);
  const varSign = r.variance > 0 ? '+' : '';
  const varPct = (r.consumption !== 0 || r.plu !== 0) ? ` (${r.variancePct}%)` : '';
  const meta = productMetaLine(r);

  return `
    <tr class="recon-row${r.reconHidden ? ' recon-row-hidden' : ''}${r.investigate ? ' row-investigate' : ''}"
      data-rcn-pid="${escapeHtml(r.pid)}" data-product-name="${escapeHtml((r.p.name || '').toLowerCase())}"
      data-rcn-status="${escapeHtml(r.reconStatus || '')}">
      <td class="rcn-sticky rcn-col-item" data-rcn-col="item">
        <div class="rcn-item">
          <div class="rcn-item-top">
            <span class="rcn-item-name" title="${escapeHtml(r.p.name || '')}">${escapeHtml(r.p.name || 'Product')}</span>
            <button type="button" class="recon-more-btn" data-rcn-edit="${escapeHtml(r.pid)}" title="Edit details" aria-label="Edit">⋯</button>
          </div>
          ${meta ? `<span class="rcn-item-meta">${escapeHtml(meta)}${r.multiOfferWarn ? ' <span class="recon-offer-warn" title="Multiple supplier offers with different pack or price">⚠</span>' : ''}</span>` : ''}
          ${noteHint}
        </div>
      </td>
      <td class="rcn-num rcn-meta" data-rcn-col="abv">${escapeHtml(r.p.abv != null && r.p.abv !== '' ? `${Number(r.p.abv).toFixed(1)}%` : '—')}</td>
      <td class="rcn-num rcn-num--money recon-drawer-cell" data-rcn-col="case_price" data-rcn-edit="${escapeHtml(r.pid)}" title="Edit price">${formatReconMoney(r.rowPrice)}</td>
      <td class="rcn-col-supplier" data-rcn-col="supplier" title="${escapeHtml(r.supplierName)}${r.multiOfferWarn ? ' — multiple supplier offers differ' : ''}">${escapeHtml(r.supplierName)}${r.multiOfferWarn ? ' <span class="recon-offer-warn" title="Multiple supplier offers with different pack or price">⚠</span>' : ''}</td>
      <td class="rcn-num rcn-meta" data-rcn-col="units_per_case">${r.ups || '—'}</td>
      <td class="rcn-num rcn-group-start" data-rcn-col="delivered">${formatReconQty(r.delivered)}</td>
      <td class="rcn-cell--edit" data-rcn-col="invoiced">${renderInlineInput(r.pid, `rcn-inv-${r.pid}`, invVal)}</td>
      <td class="rcn-cell--edit" data-rcn-col="closing_cases">${renderInlineInput(r.pid, `rcn-cl-cases-${r.pid}`, closingCasesVal)}</td>
      <td class="rcn-cell--edit" data-rcn-col="closing_units">${renderInlineInput(r.pid, `rcn-cl-singles-${r.pid}`, closingSinglesVal)}</td>
      <td class="rcn-num rcn-group-start recon-drawer-cell" data-rcn-col="returned_to_supplier" data-rcn-edit="${escapeHtml(r.pid)}" title="Returns (edit on Closing)">${formatReconQty(r.supplierReturns)}</td>
      <td class="rcn-num" data-rcn-col="transferred">${formatReconQty(r.transferred)}</td>
      <td class="rcn-num" data-rcn-col="wastage">${formatReconQty(r.wastage)}</td>
      <td class="rcn-num rcn-emphasis rcn-group-start" data-rcn-col="consumption">${formatReconQty(r.consumption)}</td>
      <td class="rcn-num rcn-emphasis" data-rcn-col="plu">${formatReconQty(r.plu)}</td>
      <td class="rcn-num" data-rcn-col="variance"><span class="${varCls}">${varSign}${formatReconQty(r.variance)}${varPct}</span></td>
      <td class="rcn-num rcn-num--money rcn-group-start" data-rcn-col="consumption_charge">${formatReconMoney(r.consumptionCharge)}</td>
      <td class="rcn-num rcn-num--money rcn-emphasis" data-rcn-col="consumption_loose">${formatReconMoney(r.consumptionLooseCharge)}</td>
      <td class="rcn-num rcn-num--money" data-rcn-col="plu_charge">${formatReconMoney(r.pluCharge)}</td>
      <td class="rcn-num rcn-num--money" data-rcn-col="invoice_charge">${formatReconMoney(r.invoiceCharge)}</td>
      <td class="rcn-num rcn-num--money rcn-budget" data-rcn-col="budget_cost">${formatReconMoney(r.budgetCost)}</td>
    </tr>`;
}

function renderTotalRow(totals) {
  const { totBudget, totConsLoose, totInvoice, totPlu, totVariance, totConsumption, totPluCases, totWastage } = totals;
  const varCls = varianceClass(totConsumption, totPluCases, totVariance);
  const varSign = totVariance > 0 ? '+' : '';
  const denom = Math.max(Math.abs(totConsumption), Math.abs(totPluCases), 0.01);
  const varPct = (totConsumption !== 0 || totPluCases !== 0)
    ? ` (${roundN((totVariance / denom) * 100, 1)}%)` : '';

  return `<tr class="recon-total-row">
    ${RECON_COLS.map((c) => {
      let val = '';
      let cls = 'rcn-num';
      if (c.id === 'item') { cls = 'rcn-col-item rcn-sticky'; val = 'Total'; }
      else if (c.id === 'variance') {
        cls += ' rcn-group-start';
        val = `<span class="${varCls}">${varSign}${formatReconQty(totVariance)}${varPct}</span>`;
      } else if (c.id === 'wastage') val = totWastage ? formatReconQty(totWastage) : '';
      else if (c.id === 'consumption_loose') { cls += ' rcn-num--money rcn-emphasis'; val = formatReconMoney(totConsLoose); }
      else if (c.id === 'plu_charge') { cls += ' rcn-num--money'; val = formatReconMoney(totPlu); }
      else if (c.id === 'invoice_charge') { cls += ' rcn-num--money'; val = formatReconMoney(totInvoice); }
      else if (c.id === 'budget_cost') { cls += ' rcn-num--money rcn-budget'; val = formatReconMoney(totBudget); }
      else if (c.id === 'delivered' || c.id === 'returned_to_supplier' || c.id === 'consumption' || c.id === 'consumption_charge') {
        cls += ' rcn-group-start';
      }
      return `<td class="${cls}" data-rcn-col="${c.id}">${val}</td>`;
    }).join('')}
  </tr>`;
}

function applyColVisibility(root, colVis) {
  RECON_COLS.forEach((c) => {
    const hide = colVis[c.id] === false;
    root.querySelectorAll(`[data-rcn-col="${c.id}"]`).forEach((el) => {
      el.classList.toggle('recon-col-hidden', hide);
    });
  });
}

export function renderReconShell() {
  return `
    <div class="rcn-panel" id="rcnPanel">
      <p class="rcn-hint muted">Edit <strong>Invoiced</strong> and <strong>Closing</strong> inline, then hit <strong>Save changes</strong>. Click price, returns, or <strong>⋯</strong> for status and details. PLU comes from Square item sales.</p>
      <div class="rcn-stats" id="rcnStats"></div>
      <div class="rcn-toolbar" id="rcnFilterRow">
        <div class="rcn-seg" role="tablist" aria-label="Status filter">
          <button type="button" class="rcn-seg-btn is-active" data-rcn-filter="" role="tab" aria-selected="true">All</button>
          <button type="button" class="rcn-seg-btn" data-rcn-filter="red" role="tab" aria-selected="false">
            <span class="rcn-seg-dot rcn-seg-dot--red"></span> Action
          </button>
          <button type="button" class="rcn-seg-btn" data-rcn-filter="yellow" role="tab" aria-selected="false">
            <span class="rcn-seg-dot rcn-seg-dot--yellow"></span> Review
          </button>
          <button type="button" class="rcn-seg-btn" data-rcn-filter="green" role="tab" aria-selected="false">
            <span class="rcn-seg-dot rcn-seg-dot--green"></span> Done
          </button>
          <button type="button" class="rcn-seg-btn" data-rcn-filter="blue" role="tab" aria-selected="false">
            <span class="rcn-seg-dot rcn-seg-dot--blue"></span> None returned
          </button>
          <button type="button" class="rcn-seg-btn" data-rcn-filter="none" role="tab" aria-selected="false">Unmarked</button>
        </div>
        <select id="rcnCatFilter" class="admin-input rcn-cat-select" aria-label="Category">
          <option value="">All categories</option>
        </select>
        <button type="button" class="rcn-tool-btn" id="rcnHiddenToggle" title="Show products excluded from recon" aria-pressed="false">Hidden</button>
        <div class="rcn-col-picker" id="rcnColPicker">
          <button type="button" class="rcn-tool-btn" id="rcnColBtn" aria-expanded="false" aria-controls="rcnColMenu" title="Choose columns">
            <i data-lucide="columns"></i> Columns
          </button>
          <div class="rcn-col-menu" id="rcnColMenu" hidden></div>
        </div>
      </div>
      <div class="dist-grid-wrap rcn-table-wrap" id="rcnTableWrap">
        <table class="dist-grid rcn-grid" id="rcnTable">
          <thead>
            <tr class="rcn-head-row">
              ${rcnTh('item', 'Product', 'rcn-sticky rcn-col-item')}
              ${rcnTh('abv', 'ABV', 'rcn-meta')}
              ${rcnTh('case_price', 'Price', 'rcn-num--money')}
              ${rcnTh('supplier', 'Supplier', 'rcn-col-supplier')}
              ${rcnTh('units_per_case', 'Units / case', 'rcn-meta')}
              ${rcnTh('delivered', 'Delivered', 'rcn-group-start')}
              ${rcnTh('invoiced', 'Invoiced', 'rcn-th--edit')}
              ${rcnTh('closing_cases', 'Close C', 'rcn-th--edit')}
              ${rcnTh('closing_units', 'Close S', 'rcn-th--edit')}
              ${rcnTh('returned_to_supplier', 'Returns', 'rcn-group-start')}
              ${rcnTh('transferred', 'Xfer', '')}
              ${rcnTh('wastage', 'Waste', '')}
              ${rcnTh('consumption', 'Consumption', 'rcn-group-start rcn-emphasis')}
              ${rcnTh('plu', 'PLU', 'rcn-emphasis')}
              ${rcnTh('variance', 'Variance', '')}
              ${rcnTh('consumption_charge', 'Cons £', 'rcn-group-start rcn-num--money')}
              ${rcnTh('consumption_loose', 'Cons + loose', 'rcn-num--money rcn-emphasis')}
              ${rcnTh('plu_charge', 'PLU £', 'rcn-num--money')}
              ${rcnTh('invoice_charge', 'Invoice £', 'rcn-num--money')}
              ${rcnTh('budget_cost', 'Budget', 'rcn-num--money rcn-budget')}
            </tr>
          </thead>
          <tbody id="rcnBody"><tr><td colspan="${RECON_COLS.length}" class="dist-empty muted">Loading…</td></tr></tbody>
        </table>
      </div>
      <div class="rcn-save-bar" id="rcnSaveBar" hidden>
        <span class="rcn-save-bar-copy" id="rcnSaveBarMsg">Unsaved changes</span>
        <div class="rcn-save-bar-actions">
          <button type="button" class="rcn-save-bar-btn" id="rcnDiscardBtn">Discard</button>
          <button type="button" class="rcn-save-bar-btn rcn-save-bar-btn--primary" id="rcnSaveBtn">
            Save changes
          </button>
        </div>
      </div>
    </div>`;
}

export function mountReconPanel(route) {
  const panel = $('rcnPanel');
  if (!panel) return () => {};

  const ctx = {
    eventId: route.eventId,
    event: null,
    closingRows: [],
    tillRows: [],
    recipes: [],
    products: [],
    caseSizes: [],
    suppliers: [],
    wastageBatches: [],
    transfers: [],
    supplierReturns: [],
    deliveries: [],
    statusFilter: '',
    categoryFilter: '',
    showHidden: false,
    colVis: loadReconColVisibility(),
    drafts: {},
    saving: false,
    abort: false,
    drawerPid: null,
  };

  function dirtyCount() {
    return Object.keys(ctx.drafts).length;
  }

  function syncSaveBar() {
    const bar = $('rcnSaveBar');
    const msg = $('rcnSaveBarMsg');
    const saveBtn = $('rcnSaveBtn');
    const discardBtn = $('rcnDiscardBtn');
    const n = dirtyCount();
    const dirty = n > 0 || ctx.saving;
    if (bar) bar.hidden = !dirty;
    panel.classList.toggle('rcn-panel--dirty', dirty);
    if (msg) {
      msg.textContent = ctx.saving
        ? 'Saving…'
        : (n === 1 ? '1 unsaved change' : `${n} unsaved changes`);
    }
    if (saveBtn) saveBtn.disabled = ctx.saving || n === 0;
    if (discardBtn) discardBtn.disabled = ctx.saving || n === 0;
  }

  function allRows() {
    return computeReconRows({
      event: ctx.event,
      closingRows: ctx.closingRows,
      tillRows: ctx.tillRows,
      recipes: ctx.recipes,
      products: ctx.products,
      caseSizes: ctx.caseSizes,
      suppliers: ctx.suppliers,
      wastageBatches: ctx.wastageBatches,
      transfers: ctx.transfers,
      supplierReturns: ctx.supplierReturns,
      deliveries: ctx.deliveries,
      showHidden: ctx.showHidden,
      drafts: ctx.drafts,
    });
  }

  function visibleRows() {
    return filterReconRows(allRows(), {
      statusFilter: ctx.statusFilter,
      categoryFilter: ctx.categoryFilter,
    });
  }

  function refreshCatFilter() {
    const sel = $('rcnCatFilter');
    if (!sel) return;
    const cats = new Map();
    (ctx.event?.event_products || []).forEach((ep) => {
      const c = ep.product?.category;
      if (c?.id) cats.set(c.id, c.name);
    });
    const cur = ctx.categoryFilter;
    sel.innerHTML = '<option value="">All categories</option>'
      + [...cats.entries()].sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join('');
    if ([...cats.keys()].includes(cur)) sel.value = cur;
    else { sel.value = ''; ctx.categoryFilter = ''; }
  }

  function initColMenu() {
    const menu = $('rcnColMenu');
    if (!menu || menu.dataset.ready) return;
    menu.innerHTML = `
      <div class="rcn-col-menu-head">
        <span>Visible columns</span>
        <button type="button" id="rcnColReset">Show all</button>
      </div>
      ${RECON_COLS.map((c) => `
        <label class="rcn-col-option">
          <input type="checkbox" data-rcn-col-toggle="${c.id}"${ctx.colVis[c.id] !== false ? ' checked' : ''}>
          ${escapeHtml(c.label)}
        </label>`).join('')}`;
    menu.dataset.ready = '1';
  }

  function renderStats(rows) {
    const el = $('rcnStats');
    if (!el) return;
    const totals = reconTotals(rows);
    const sc = totals.statusCounts;
    el.innerHTML = `
      <div class="wst-stat rcn-stat--budget">
        <span class="wst-stat-label">Budget cost</span>
        <span class="wst-stat-value">${formatMoney(totals.totBudget)}</span>
        <span class="wst-stat-sub muted">Total to bill</span>
      </div>
      <div class="wst-stat">
        <span class="wst-stat-label">Action</span>
        <span class="wst-stat-value rcn-stat-value--red">${sc.red}</span>
      </div>
      <div class="wst-stat">
        <span class="wst-stat-label">Review</span>
        <span class="wst-stat-value rcn-stat-value--yellow">${sc.yellow}</span>
      </div>
      <div class="wst-stat">
        <span class="wst-stat-label">Done</span>
        <span class="wst-stat-value rcn-stat-value--green">${sc.green}</span>
      </div>
      <div class="wst-stat">
        <span class="wst-stat-label">None returned</span>
        <span class="wst-stat-value rcn-stat-value--blue">${sc.blue}</span>
      </div>
      <div class="wst-stat">
        <span class="wst-stat-label">Unmarked</span>
        <span class="wst-stat-value">${sc.none}</span>
      </div>`;
  }

  function renderTable() {
    const body = $('rcnBody');
    if (!body) return;
    const totalSource = (ctx.statusFilter || ctx.categoryFilter) ? visibleRows() : allRows().filter((r) => !r.reconHidden);
    renderStats(totalSource);

    const rows = visibleRows();
    const all = allRows();

    if (!all.length) {
      const msg = ctx.showHidden
        ? 'No products are excluded from recon.'
        : 'Add products and enter closing stock to begin.';
      body.innerHTML = `<tr><td colspan="${RECON_COLS.length}" class="dist-empty muted">${escapeHtml(msg)}</td></tr>`;
      applyColVisibility(panel, ctx.colVis);
      return;
    }
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${RECON_COLS.length}" class="dist-empty muted">No lines match this filter.</td></tr>`;
      applyColVisibility(panel, ctx.colVis);
      return;
    }

    const grouped = groupByCategory(rows);
    let html = '';
    Object.keys(grouped).sort().forEach((cat) => {
      html += `<tr class="dist-cat-row"><td colspan="${RECON_COLS.length}" class="dist-cat-pinned"><span class="dist-bar-name">${escapeHtml(cat)}</span></td></tr>`;
      grouped[cat].forEach((r) => { html += renderRow(r); });
    });
    html += renderTotalRow(reconTotals(totalSource));
    body.innerHTML = html;
    applyColVisibility(panel, ctx.colVis);
    initIcons(panel);
    layoutTableScroll();
  }

  function syncScrollHint() {
    const wrap = $('rcnTableWrap');
    if (!wrap) return;
    wrap.classList.toggle('is-scrollable', wrap.scrollWidth > wrap.clientWidth + 8);
  }

  function layoutTableScroll() {
    const wrap = $('rcnTableWrap');
    if (!wrap || wrap.offsetParent === null) return;
    const top = wrap.getBoundingClientRect().top;
    wrap.style.maxHeight = `${Math.max(280, window.innerHeight - top - 20)}px`;
    syncScrollHint();
  }

  function totalSourceRows() {
    return (ctx.statusFilter || ctx.categoryFilter)
      ? visibleRows()
      : allRows().filter((r) => !r.reconHidden);
  }

  function refreshStatsAndTotalRow() {
    const totalSource = totalSourceRows();
    renderStats(totalSource);
    const body = $('rcnBody');
    if (!body) return;
    const existing = body.querySelector('.recon-total-row');
    const html = renderTotalRow(reconTotals(totalSource));
    if (existing) existing.outerHTML = html;
    else if (body.querySelector('.recon-row')) body.insertAdjacentHTML('beforeend', html);
    applyColVisibility(panel, ctx.colVis);
  }

  /** Update derived cells for one product without rebuilding inputs (keeps focus). */
  function refreshRowDerived(pid) {
    const row = allRows().find((r) => r.pid === pid);
    if (!row) return;
    const tr = panel.querySelector(`.recon-row[data-rcn-pid="${CSS.escape(pid)}"]`);
    if (!tr) return;

    const setText = (col, text) => {
      const td = tr.querySelector(`[data-rcn-col="${col}"]`);
      if (td && !td.classList.contains('rcn-cell--edit')) td.textContent = text;
    };
    setText('consumption', formatReconQty(row.consumption));
    setText('plu', formatReconQty(row.plu));
    setText('transferred', formatReconQty(row.transferred));
    setText('wastage', formatReconQty(row.wastage));
    setText('returned_to_supplier', formatReconQty(row.supplierReturns));
    setText('delivered', formatReconQty(row.delivered));
    setText('consumption_charge', formatReconMoney(row.consumptionCharge));
    setText('consumption_loose', formatReconMoney(row.consumptionLooseCharge));
    setText('plu_charge', formatReconMoney(row.pluCharge));
    setText('invoice_charge', formatReconMoney(row.invoiceCharge));
    setText('budget_cost', formatReconMoney(row.budgetCost));

    const varTd = tr.querySelector('[data-rcn-col="variance"]');
    if (varTd) {
      const varCls = varianceClass(row.consumption, row.plu, row.variance);
      const varSign = row.variance > 0 ? '+' : '';
      const varPct = (row.consumption !== 0 || row.plu !== 0) ? ` (${row.variancePct}%)` : '';
      varTd.innerHTML = `<span class="${varCls}">${varSign}${formatReconQty(row.variance)}${varPct}</span>`;
    }
    tr.classList.toggle('row-investigate', !!row.investigate);
  }

  async function persistInline(pid) {
    if (!ctx.event) return;
    const draft = ctx.drafts[pid] || readInlineDraft(pid, ctx.closingRows);

    const ep = ctx.event.event_products.find((x) => x.product_id === pid);
    if (!ep) return;

    const cases = Math.max(0, draft.closingCases);
    const singles = Math.max(0, draft.closingSingles);
    const closeCount = roundN(reconClosingTotal(ep.product, cases, singles, ctx.caseSizes), 4);
    const returnAmt = roundN(
      (ctx.supplierReturns.filter((r) => r.product_id === pid).reduce((s, r) => {
        const form = storedToForm(r);
        return s + totalUnitsForProduct(form.cases ?? form.qty, form.singles, ep.product, ctx.caseSizes);
      }, 0))
      || (closingRowFor(ctx.closingRows, pid)?.return_amount != null
        ? Number(closingRowFor(ctx.closingRows, pid).return_amount) : 0),
      2,
    );

    // Empty invoiced field clears the override; calc then falls back to ordered.
    ep.invoice_qty = draft.invoiceSet ? roundN(draft.invoiced, 3) : null;

    let cl = closingRowFor(ctx.closingRows, pid);
    if (!cl) {
      cl = { event_id: ctx.eventId, product_id: pid };
      ctx.closingRows.push(cl);
    }
    cl.closing_cases = cases;
    cl.closing_singles = singles;
    cl.close_count = closeCount;
    cl.return_amount = returnAmt;
    cl.carried_over = roundN(Math.max(0, closeCount - returnAmt), 1);

    const DB = getDB();
    await DB.eventProducts.setForEvent(ctx.eventId, pid, { invoice_qty: ep.invoice_qty });
    await DB.closing.setForEvent(ctx.eventId, pid, {
      closing_cases: cl.closing_cases,
      closing_singles: cl.closing_singles,
      close_count: cl.close_count,
      return_amount: cl.return_amount,
      carried_over: cl.carried_over,
      recon_status: cl.recon_status ?? null,
      recon_note: cl.recon_note ?? null,
      budget_method: cl.budget_method || 'auto',
      budget_override: cl.budget_override ?? null,
    });
    delete ctx.drafts[pid];
    syncSaveBar();
  }

  function markDirty(pid) {
    if (!pid) return;
    ctx.drafts[pid] = readInlineDraft(pid, ctx.closingRows);
    refreshRowDerived(pid);
    refreshStatsAndTotalRow();
    syncSaveBar();
  }

  async function flushPid(pid, { reread = true } = {}) {
    if (!pid) return;
    if (reread || !ctx.drafts[pid]) {
      ctx.drafts[pid] = readInlineDraft(pid, ctx.closingRows);
    }
    await persistInline(pid);
    refreshRowDerived(pid);
    refreshStatsAndTotalRow();
  }

  async function flushAllPending() {
    const pids = Object.keys(ctx.drafts);
    // Do not re-read inputs on unmount — drafts were captured on each keystroke.
    await Promise.all(pids.map((pid) => flushPid(pid, { reread: false })));
  }

  async function saveAllChanges() {
    if (ctx.saving || !dirtyCount()) return;
    ctx.saving = true;
    syncSaveBar();
    try {
      await flushAllPending();
      if (!dirtyCount()) toast('Recon saved');
    } catch (e) {
      toast(e.message || 'Save failed', true);
    } finally {
      ctx.saving = false;
      syncSaveBar();
    }
  }

  function discardChanges() {
    if (ctx.saving || !dirtyCount()) return;
    ctx.drafts = {};
    renderTable();
    applyProductFilter(getLastProductFilter());
    syncSaveBar();
    toast('Changes discarded');
  }

  function openDrawer(pid) {
    const ep = ctx.event?.event_products?.find((x) => x.product_id === pid);
    if (!ep) return;
    ctx.drawerPid = pid;
    const cl = closingRowFor(ctx.closingRows, pid) || {};
    const p = ep.product;
    const curStatus = cl.recon_status || '';

    openSheet({
      title: `Edit recon — ${p?.name || 'Product'}`,
      bodyHtml: `
        <div class="rcn-drawer">
          <p class="muted">${escapeHtml(p?.case_size || '')} · ${escapeHtml(ep.product?.category?.name || '')}</p>
          <div class="admin-field">
            <label class="admin-label" for="rcnDrawerStatus">Status</label>
            <select class="admin-input" id="rcnDrawerStatus">
              <option value=""${!curStatus ? ' selected' : ''}>Unmarked</option>
              <option value="red"${curStatus === 'red' ? ' selected' : ''}>${STATUS_TITLES.red}</option>
              <option value="yellow"${curStatus === 'yellow' ? ' selected' : ''}>${STATUS_TITLES.yellow}</option>
              <option value="green"${curStatus === 'green' ? ' selected' : ''}>${STATUS_TITLES.green}</option>
              <option value="blue"${curStatus === 'blue' ? ' selected' : ''}>${STATUS_TITLES.blue}</option>
            </select>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="rcnDrawerCasePrice">Case price override (£)</label>
            <input class="admin-input num-math" type="text" inputmode="decimal" autocomplete="off" id="rcnDrawerCasePrice"
              value="${ep.order_price_override != null ? escapeHtml(String(ep.order_price_override)) : ''}" placeholder="Default from supplier offer">
          </div>
          <div class="admin-field">
            <label class="admin-label" for="rcnDrawerUnitPrice">Unit price override (£)</label>
            <input class="admin-input num-math" type="text" inputmode="decimal" autocomplete="off" id="rcnDrawerUnitPrice"
              value="${ep.order_unit_price_override != null ? escapeHtml(String(ep.order_unit_price_override)) : ''}" placeholder="Spirits — £/bottle">
          </div>
          <div class="admin-field">
            <label class="admin-label" for="rcnDrawerNote">Note</label>
            <textarea class="admin-input" id="rcnDrawerNote" rows="2" placeholder="Investigate, allowance, etc.">${escapeHtml(cl.recon_note || '')}</textarea>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="rcnDrawerBudget">Budget method</label>
            <select class="admin-input" id="rcnDrawerBudget">
              <option value="auto"${(cl.budget_method || 'auto') === 'auto' ? ' selected' : ''}>Auto</option>
              <option value="consumption"${cl.budget_method === 'consumption' ? ' selected' : ''}>Consumption charge</option>
              <option value="consumption_loose"${cl.budget_method === 'consumption_loose' ? ' selected' : ''}>Consumption + loose</option>
              <option value="plu"${cl.budget_method === 'plu' ? ' selected' : ''}>PLU charge</option>
              <option value="invoice"${cl.budget_method === 'invoice' ? ' selected' : ''}>Invoice charge</option>
              <option value="manual"${cl.budget_method === 'manual' ? ' selected' : ''}>Manual</option>
            </select>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="rcnDrawerBudgetManual">Manual budget (£)</label>
            <input class="admin-input num-math" type="text" inputmode="decimal" autocomplete="off" id="rcnDrawerBudgetManual"
              value="${cl.budget_override != null ? escapeHtml(String(cl.budget_override)) : ''}">
          </div>
          <label class="admin-check">
            <input type="checkbox" id="rcnDrawerHidden"${ep.recon_hidden ? ' checked' : ''}>
            Exclude from recon
          </label>
          <p class="rcn-drawer-note muted">Supplier returns are edited on Closing. This drawer is for status, prices, notes, and budget.</p>
        </div>`,
      footHtml: `
        <button type="button" class="btn btn-outline" id="rcnDrawerCancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="rcnDrawerSave">Save</button>`,
      variant: 'admin-full',
    });

    $('rcnDrawerCancel').onclick = closeSheet;
    $('rcnDrawerSave').onclick = async () => {
      try {
        const DB = getDB();
        const status = $('rcnDrawerStatus').value || null;
        const casePrice = $('rcnDrawerCasePrice').value.trim();
        const unitPrice = $('rcnDrawerUnitPrice').value.trim();
        const note = $('rcnDrawerNote').value.trim();
        const budgetMethod = $('rcnDrawerBudget').value;
        const budgetManual = $('rcnDrawerBudgetManual').value.trim();
        const hidden = $('rcnDrawerHidden').checked;

        await DB.eventProducts.setForEvent(ctx.eventId, pid, {
          order_price_override: casePrice === '' ? null : parseQty(casePrice),
          order_unit_price_override: unitPrice === '' ? null : parseQty(unitPrice),
          recon_hidden: hidden,
        });
        ep.order_price_override = casePrice === '' ? null : parseQty(casePrice);
        ep.order_unit_price_override = unitPrice === '' ? null : parseQty(unitPrice);
        ep.recon_hidden = hidden;

        let row = closingRowFor(ctx.closingRows, pid);
        if (!row) {
          row = { event_id: ctx.eventId, product_id: pid };
          ctx.closingRows.push(row);
        }
        row.recon_status = status;
        row.recon_note = note || null;
        row.budget_method = budgetMethod;
        row.budget_override = budgetMethod === 'manual' && budgetManual !== ''
          ? parseQty(budgetManual) : null;

        await DB.closing.setForEvent(ctx.eventId, pid, {
          recon_status: row.recon_status,
          recon_note: row.recon_note,
          budget_method: row.budget_method,
          budget_override: row.budget_override,
        });

        closeSheet();
        renderTable();
        toast('Recon line saved');
      } catch (e) {
        toast(e.message || 'Save failed', true);
      }
    };
  }

  function exportCsv() {
    const rows = allRows().filter((r) => !r.reconHidden);
    const headers = [
      'Status', 'Item', 'Case Size', 'ABV', 'Price', 'Supplier', 'Units per case',
      'Delivered', 'Invoiced', 'Closing (Cases)', 'Closing (Singles)',
      'Returned to supplier', 'Transferred', 'Wastage', 'Consumption', 'PLU', 'Variance', 'Variance %',
      'Consumption Charge', 'Consumption + Loose', 'PLU Charge', 'Invoice Charge', 'Budget Cost', 'Notes',
    ];
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.map(esc).join(',')];
    rows.forEach((r) => {
      lines.push([
        STATUS_TITLES[r.reconStatus] || '',
        r.p.name, r.p.case_size || '',
        r.p.abv != null ? `${Number(r.p.abv).toFixed(2)}%` : '',
        r.rowPrice ? r.rowPrice.toFixed(2) : '',
        r.supplierName, r.ups || '',
        r.delivered, r.invoiced, r.closingCases, r.closingSingles,
        r.supplierReturns, r.transferred, r.wastage, r.consumption, r.plu,
        r.variance, r.variancePct != null ? `${r.variancePct}%` : '',
        r.consumptionCharge, r.consumptionLooseCharge, r.pluCharge, r.invoiceCharge,
        r.budgetCost, r.reconNote,
      ].map(esc).join(','));
    });
    const totals = reconTotals(rows);
    lines.push(Array(headers.length - 1).fill('').concat([totals.totBudget.toFixed(2)]).map(esc).join(','));

    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(ctx.event?.name || 'event').replace(/[^\w\s.-]/g, '')} Post Event Recon.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function markReconciled() {
    if (!ctx.event) return;
    if (dirtyCount()) {
      try {
        await flushAllPending();
      } catch (e) {
        toast(e.message || 'Save failed', true);
        return;
      }
    }
    if (!confirm(`Mark "${ctx.event.name || 'this event'}" as financially reconciled?`)) return;
    try {
      const DB = getDB();
      await DB.events.update(ctx.eventId, { status: 'reconciled' });
      ctx.event.status = 'reconciled';
      toast('Event marked as reconciled');
    } catch (e) {
      toast(e.message || 'Failed to update status', true);
    }
  }

  function applyProductFilter({ query, productId } = {}) {
    const q = (query || '').trim().toLowerCase();
    panel.querySelectorAll('.recon-row[data-rcn-pid]').forEach((tr) => {
      if (productId) {
        tr.hidden = tr.dataset.rcnPid !== productId;
        return;
      }
      if (!q) {
        tr.hidden = false;
        return;
      }
      const name = tr.dataset.productName || '';
      tr.hidden = !name.includes(q);
    });
    panel.querySelectorAll('.dist-cat-row').forEach((tr) => {
      const next = tr.nextElementSibling;
      tr.hidden = next?.classList.contains('recon-row') && next.hidden;
    });
  }

  panel.addEventListener('click', (e) => {
    if (e.target.closest('#rcnSaveBtn')) {
      saveAllChanges();
      return;
    }
    if (e.target.closest('#rcnDiscardBtn')) {
      discardChanges();
      return;
    }
    const editBtn = e.target.closest('[data-rcn-edit]');
    if (editBtn) {
      openDrawer(editBtn.dataset.rcnEdit);
      return;
    }
    const filterBtn = e.target.closest('[data-rcn-filter]');
    if (filterBtn) {
      ctx.statusFilter = filterBtn.dataset.rcnFilter || '';
      panel.querySelectorAll('[data-rcn-filter]').forEach((b) => {
        const on = (b.dataset.rcnFilter || '') === ctx.statusFilter;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      renderTable();
      return;
    }
    if (e.target.closest('#rcnHiddenToggle')) {
      ctx.showHidden = !ctx.showHidden;
      const btn = $('rcnHiddenToggle');
      btn.classList.toggle('is-active', ctx.showHidden);
      btn.setAttribute('aria-pressed', ctx.showHidden ? 'true' : 'false');
      renderTable();
      return;
    }
    if (e.target.closest('#rcnColBtn')) {
      const menu = $('rcnColMenu');
      const open = menu.hasAttribute('hidden');
      menu.toggleAttribute('hidden', !open);
      $('rcnColBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }
    if (e.target.closest('#rcnColReset')) {
      ctx.colVis = Object.fromEntries(RECON_COLS.map((c) => [c.id, true]));
      saveReconColVisibility(ctx.colVis);
      const menu = $('rcnColMenu');
      if (menu) delete menu.dataset.ready;
      initColMenu();
      renderTable();
    }
  });

  panel.addEventListener('change', (e) => {
    const toggle = e.target.closest('[data-rcn-col-toggle]');
    if (toggle) {
      ctx.colVis[toggle.dataset.rcnColToggle] = toggle.checked;
      saveReconColVisibility(ctx.colVis);
      applyColVisibility(panel, ctx.colVis);
    }
    if (e.target.id === 'rcnCatFilter') {
      ctx.categoryFilter = e.target.value;
      renderTable();
    }
  });

  panel.addEventListener('input', (e) => {
    if (e.target.matches('.recon-cell-input')) {
      markDirty(e.target.dataset.rcnPid);
    }
  });

  const onPageHide = () => {
    if (dirtyCount()) flushAllPending();
  };
  const onBeforeUnload = (e) => {
    if (!dirtyCount()) return;
    e.preventDefault();
    e.returnValue = '';
  };

  const onDocClick = (e) => {
    const picker = $('rcnColPicker');
    if (picker && !picker.contains(e.target)) {
      $('rcnColMenu')?.setAttribute('hidden', '');
      $('rcnColBtn')?.setAttribute('aria-expanded', 'false');
    }
  };
  document.addEventListener('click', onDocClick);

  const onToolbar = (e) => {
    const action = e.detail?.action;
    if (action === 'export-recon') exportCsv();
    if (action === 'mark-reconciled') markReconciled();
  };

  const onProductFilter = (e) => applyProductFilter(e.detail || getLastProductFilter());

  const onResize = () => layoutTableScroll();
  window.addEventListener('resize', onResize);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('beforeunload', onBeforeUnload);
  $('rcnTableWrap')?.addEventListener('scroll', syncScrollHint, { passive: true });

  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbar);
  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);

  initIcons(panel);

  async function load() {
    const DB = getDB();
    const [event, caseSizes, products, suppliers, closing, tillImport, recipes, wastage, transfers, supplierReturns, deliveries] =
      await Promise.all([
        loadEventFull(ctx.eventId),
        loadCaseSizes(),
        loadLibraryProducts(),
        loadSuppliers(),
        DB.closing.forEvent(ctx.eventId),
        DB.tillImports.forEvent(ctx.eventId).catch(() => null),
        DB.recipes.listFull().catch(() => []),
        DB.wastage.forEvent(ctx.eventId).catch(() => []),
        DB.transfers.forEvent(ctx.eventId).catch(() => []),
        DB.supplierReturns.forEvent(ctx.eventId).catch(() => []),
        DB.deliveries.forEvent(ctx.eventId).catch(() => []),
      ]);
    if (ctx.abort) return;
    ctx.event = event;
    ctx.caseSizes = caseSizes;
    ctx.products = products;
    ctx.suppliers = suppliers;
    ctx.closingRows = closing || [];
    ctx.tillRows = tillImport?.rows || [];
    ctx.recipes = recipes || [];
    ctx.wastageBatches = wastage || [];
    ctx.transfers = transfers || [];
    ctx.supplierReturns = supplierReturns || [];
    ctx.deliveries = deliveries || [];
    refreshCatFilter();
    initColMenu();
    renderTable();
    applyProductFilter(getLastProductFilter());
  }

  load().catch((e) => {
    $('rcnBody').innerHTML = `<tr><td colspan="${RECON_COLS.length}" class="dist-empty del-empty--err">${escapeHtml(e.message || 'Failed to load')}</td></tr>`;
  });

  return () => {
    ctx.abort = true;
    if (dirtyCount()) flushAllPending();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbar);
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
  };
}
