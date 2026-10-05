/**
 * Orders — planned vs ordered vs delivered for one event, plus the
 * purchase order ledger. Orders record what was asked of suppliers; only
 * deliveries create stock.
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { loadingWidget } from '../../components/loading-widget.js';
import { errorState, bindEmptyRetry } from '../../components/empty-state.js';
import { reportError } from '../../lib/client-errors.js';
import { getDB, loadCaseSizes, loadCategories, loadEventLite, loadLibraryProducts, loadSuppliers } from '../../db.js';
import { openModal, closeModal, confirmDialog } from '../../components/modal.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { mountProductSearch, productSupplierSearchText } from '../../components/product-search.js';
import { mountSupplierSearch } from '../../components/supplier-search.js';
import { navigate } from '../router.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import { ADMIN_TABLE_FILTER, getTableFilterValues, setTableFilterContext } from '../table-filter.js';
import { countedInFromDeliveries } from '../../lib/opening-stock.js';
import { listAccounts } from '../../lib/accounts-data.js';
import { primaryContact } from '../../lib/accounts.js';
import { findOfferForSupplier } from '../../pack-metrics.js';
import { parsePlanningNumber, resolveMenuLine } from '../../lib/planning-menu.js';
import {
  isEventPricingLocked,
  isPlanningSchemaMissing,
  listEventMenu,
  loadEventPricing,
  upsertEventMenuItem,
} from '../../lib/planning-data.js';
import {
  compareOrders,
  compareSummary,
  draftOrdersFromShortfalls,
  orderLinesTotal,
  orderedByProduct,
  plannedCases,
  preferredSupplierId,
} from '../../lib/order-compare.js';
import {
  confirmPurchaseOrder,
  createPurchaseOrder,
  deletePurchaseOrder,
  getPurchaseOrder,
  isOrdersSchemaMissing,
  listPurchaseOrders,
  loadOrderBuffer,
  orderHistory,
  saveOrderBuffer,
  savePurchaseOrderLines,
  updatePurchaseOrder,
} from '../../lib/orders-data.js';

const SAVE_DEBOUNCE_MS = 450;

const STATUS_META = {
  draft: { label: 'Draft', cls: 'lta-neutral' },
  sent: { label: 'Sent', cls: 'plan-gp--amber' },
  confirmed: { label: 'Confirmed', cls: 'lta-ok' },
  cancelled: { label: 'Cancelled', cls: 'ord-status--cancelled' },
};

const GAP_META = {
  short: { label: 'Short', cls: 'lta-over' },
  over: { label: 'Over', cls: 'plan-gp--amber' },
  ok: { label: 'Matched', cls: 'lta-ok' },
  unplanned: { label: 'Unplanned', cls: 'lta-neutral' },
  none: { label: '—', cls: 'lta-neutral' },
};

function money(n) {
  const v = Number(n);
  if (n == null || !Number.isFinite(v)) return '—';
  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function qty(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Math.round(Number(n) * 10) / 10;
  return v.toLocaleString('en-GB');
}

function signed(n) {
  if (n == null) return '—';
  const v = Math.round(n * 10) / 10;
  return v > 0 ? `+${v}` : String(v);
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function packLabel(product, supplierId) {
  const offer = findOfferForSupplier(product, supplierId);
  return offer?.pack_size || product?.case_size || '';
}

export function renderOrdersShell() {
  return `
    <div class="dist-panel ord-panel" id="ordPanel">
      ${loadingWidget('Loading orders…')}
    </div>`;
}

export function mountOrdersPanel(route) {
  const panel = $('ordPanel');
  if (!panel) return null;

  const ctx = {
    eventId: route.eventId,
    event: null,
    pricing: null,
    items: new Map(),
    products: [],
    productById: new Map(),
    supplierById: new Map(),
    suppliers: [],
    categories: [],
    caseSizes: [],
    orders: [],
    rows: [],
    buffer: 0,
    filter: getTableFilterValues('orders') || {},
    query: getLastProductFilter().query || '',
    saveTimers: {},
    abort: false,
  };

  const locked = () => isEventPricingLocked(ctx.pricing);

  // ---------- derived ------------------------------------------------

  function plannedFor(pid) {
    const item = ctx.items.get(pid);
    if (!item) return { cases: null, source: null };
    const product = ctx.productById.get(pid);
    const line = resolveMenuLine(item, {
      product,
      event: ctx.pricing,
      caseSizes: ctx.caseSizes,
    });
    return plannedCases(item, line, product, ctx.caseSizes, ctx.buffer);
  }

  function recompute() {
    const ids = new Set();
    ctx.items.forEach((item, pid) => {
      if (item.included !== false || item.planned_qty_override != null) ids.add(pid);
    });
    ctx.orders.forEach((po) => (po.purchase_order_lines || []).forEach((l) => ids.add(l.product_id)));
    (ctx.event?.event_products || []).forEach((ep) => {
      if (Number(ep.qty_ordered) > 0 || Number(ep.delivered_qty) > 0) ids.add(ep.product_id);
    });
    const planned = new Map();
    ctx.plannedSource = new Map();
    ids.forEach((pid) => {
      const p = plannedFor(pid);
      planned.set(pid, p.cases);
      ctx.plannedSource.set(pid, p.source);
    });
    ctx.rows = compareOrders({
      productIds: [...ids].filter((pid) => ctx.productById.has(pid)),
      planned,
      ordered: orderedByProduct(ctx.orders),
      eventProducts: ctx.event?.event_products || [],
      countedIn: ctx.countedIn,
    });
  }

  function visibleRows() {
    const status = ctx.filter.status || 'all';
    const supplier = ctx.filter.supplier || '';
    const q = ctx.query.trim().toLowerCase();
    const rows = ctx.rows.filter((r) => {
      if (status === 'attention' ? !(r.status === 'short' || r.status === 'over') : (status !== 'all' && r.status !== status)) return false;
      const p = ctx.productById.get(r.productId);
      if (supplier && preferredSupplierId(p) !== supplier) return false;
      if (q) {
        const hay = [p?.name, p?.menu_name, p?.sku, productSupplierSearchText(p)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const name = (r) => ctx.productById.get(r.productId)?.name || '';
    const cat = (r) => ctx.productById.get(r.productId)?.category?.name || 'Uncategorised';
    const sort = ctx.filter.sort || 'gap';
    if (sort === 'name') rows.sort((a, b) => name(a).localeCompare(name(b)));
    else if (sort === 'category') rows.sort((a, b) => cat(a).localeCompare(cat(b)) || name(a).localeCompare(name(b)));
    else rows.sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0) || name(a).localeCompare(name(b)));
    return rows;
  }

  // ---------- rendering ----------------------------------------------

  function badge(meta, extra = '') {
    return `<span class="lta-badge ${meta.cls}" ${extra}>${escapeHtml(meta.label)}</span>`;
  }

  function kpisHtml() {
    const s = compareSummary(ctx.rows);
    const value = ctx.orders
      .filter((po) => po.status === 'confirmed')
      .reduce((sum, po) => sum + orderLinesTotal(po.purchase_order_lines).total, 0);
    return `
      <div class="plan-kpi"><span class="plan-kpi-label">Planned</span><span class="plan-kpi-value">${qty(s.planned)}</span>
        <span class="plan-kpi-sub muted">cases from projected serves${ctx.buffer ? ` +${ctx.buffer}%` : ''}</span></div>
      <div class="plan-kpi"><span class="plan-kpi-label">Confirmed</span><span class="plan-kpi-value">${qty(s.confirmed)}</span>
        <span class="plan-kpi-sub muted">${money(value)} on confirmed orders</span></div>
      <div class="plan-kpi"><span class="plan-kpi-label">Pending</span><span class="plan-kpi-value">${qty(s.pending)}</span>
        <span class="plan-kpi-sub muted">on draft / sent orders</span></div>
      <div class="plan-kpi"><span class="plan-kpi-label">Delivered</span><span class="plan-kpi-value">${qty(s.countedIn)}</span>
        <span class="plan-kpi-sub muted">counted in from deliveries</span></div>
      <div class="plan-kpi"><span class="plan-kpi-label">Gaps</span><span class="plan-kpi-value">${s.short + s.over}</span>
        <span class="plan-kpi-sub muted">${s.short ? `<span class="plan-dot plan-dot--red"></span>${s.short} short ` : ''}${s.over ? `<span class="plan-dot plan-dot--amber"></span>${s.over} over` : ''}${!s.short && !s.over ? 'Orders match the plan' : ''}</span></div>`;
  }

  function settingsHtml() {
    const dis = locked() ? 'disabled' : '';
    return `
      <label class="admin-field plan-field plan-field--sm">
        <span class="admin-label">Order buffer %</span>
        <input type="text" inputmode="decimal" class="admin-input num-math" id="ordBuffer" value="${escapeHtml(ctx.buffer ? String(ctx.buffer) : '')}" placeholder="0" ${dis}>
      </label>
      <div class="plan-settings-meta">
        ${locked() ? `<span class="plan-chip plan-chip--locked">${icon('lock', { size: 12 })} Event ${escapeHtml(ctx.pricing.status)} — orders are read-only</span>` : ''}
        <span class="plan-chip">Orders never change stock — only deliveries do</span>
        <a href="/planning" class="plan-link" data-goto="planning">${icon('calculator', { size: 13 })} Menu & GP</a>
      </div>`;
  }

  function rowHtml(r) {
    const p = ctx.productById.get(r.productId);
    const supplier = ctx.supplierById.get(preferredSupplierId(p));
    const src = ctx.plannedSource.get(r.productId);
    const item = ctx.items.get(r.productId);
    const onMenu = !!item;
    const dis = locked() || !onMenu ? 'disabled' : '';
    const plannedInput = `<input type="text" inputmode="decimal" autocomplete="off" class="num-math plan-cell-input plan-cell-input--sm"
      data-planned="${escapeHtml(r.productId)}" value="${escapeHtml(item?.planned_qty_override != null ? String(item.planned_qty_override) : '')}"
      placeholder="${escapeHtml(src === 'projection' && r.planned != null ? String(r.planned) : '')}"
      title="${onMenu ? 'Override planned cases — leave blank to use projected serves' : 'Add to the event menu to plan this product'}"
      aria-label="Planned cases" ${dis}>`;
    const gapCls = GAP_META[r.status] || GAP_META.none;
    const refs = [...new Set(r.refs)].map((ref) => {
      const po = ctx.orders.find((o) => o.reference === ref);
      return po ? `<button type="button" class="ord-ref" data-open-po="${escapeHtml(po.id)}">${escapeHtml(ref)}</button>` : '';
    }).join('');
    return `<tr class="dist-prod-row ord-row" data-pid="${escapeHtml(r.productId)}">
      <th class="dist-sticky plan-col-product" scope="row">
        <div class="dist-item">
          <span class="dist-item-name" title="${escapeHtml(p?.name || '')}">${escapeHtml(p?.name || 'Unknown product')}</span>
          <span class="dist-item-meta">${escapeHtml([supplier?.name, packLabel(p, supplier?.id)].filter(Boolean).join(' · ') || 'No supplier')}</span>
        </div>
      </th>
      <td class="plan-cell">${plannedInput}</td>
      <td class="plan-cell plan-out">${qty(r.confirmed)}${r.confirmedSource === 'manual' ? ' <span class="dist-bar-tag" title="Entered on the event before purchase orders — not linked to an order">manual</span>' : ''}</td>
      <td class="plan-cell plan-out">${r.pending ? qty(r.pending) : '—'}</td>
      <td class="plan-cell plan-out">${qty(r.countedIn)}</td>
      <td class="plan-cell plan-cell--key plan-out">${badge(gapCls, `title="${escapeHtml(r.gap == null ? 'No plan' : `${signed(r.gap)} cases vs plan`)}"`)} <span class="ord-gap">${r.gap ? signed(r.gap) : ''}</span></td>
      <td class="plan-cell plan-out">${r.undelivered ? qty(r.undelivered) : '—'}</td>
      <td class="plan-cell ord-refs">${refs || '<span class="muted">—</span>'}</td>
    </tr>`;
  }

  function gridHtml() {
    const rows = visibleRows();
    const head = `<tr>
      <th class="dist-th dist-sticky plan-col-product"><div class="dist-bar-head dist-bar-head--left"><span class="dist-bar-name">Product</span></div></th>
      ${[
        ['Planned', 'Cases needed — projected serves ÷ serves per case, plus buffer'],
        ['Confirmed', 'Cases on confirmed purchase orders'],
        ['Pending', 'Cases on draft or sent orders'],
        ['Delivered', 'Cases counted in from deliveries'],
        ['Gap', 'Confirmed minus planned'],
        ['To arrive', 'Confirmed but not yet delivered'],
        ['Orders', 'Purchase orders including this product'],
      ].map(([l, t]) => `<th class="dist-th plan-th" title="${escapeHtml(t)}"><div class="dist-bar-head"><span class="dist-bar-name">${escapeHtml(l)}</span></div></th>`).join('')}
    </tr>`;
    const body = rows.length
      ? rows.map(rowHtml).join('')
      : `<tr><td colspan="8" class="dist-empty">${ctx.rows.length ? 'No products match the current filter.' : 'Nothing planned or ordered yet — add products to the event menu with projected serves, then generate orders.'}</td></tr>`;
    return `<thead id="ordHead">${head}</thead><tbody id="ordBody">${body}</tbody>`;
  }

  function ordersListHtml() {
    if (!ctx.orders.length) {
      return `<p class="muted ord-none">No purchase orders yet. Use <strong>Generate orders</strong> to draft one per supplier from the shortfalls, or <strong>New order</strong>.</p>`;
    }
    return ctx.orders.slice().reverse().map((po) => {
      const meta = STATUS_META[po.status] || STATUS_META.draft;
      const sup = ctx.supplierById.get(po.supplier_id);
      const t = orderLinesTotal(po.purchase_order_lines);
      const cases = (po.purchase_order_lines || []).reduce((s, l) => s + Number(l.qty_cases || 0), 0);
      return `<button type="button" class="ord-card${po.status === 'cancelled' ? ' ord-card--cancelled' : ''}" data-open-po="${escapeHtml(po.id)}">
        <span class="ord-card-top">
          <span class="ord-card-ref">${escapeHtml(po.reference)}</span>
          ${badge(meta)}
        </span>
        <span class="ord-card-sup">${escapeHtml(sup?.name || 'Unknown supplier')}</span>
        <span class="ord-card-meta">${t.lines} line${t.lines === 1 ? '' : 's'} · ${qty(cases)} cases · ${money(t.total)}</span>
        <span class="ord-card-meta muted">Ordered ${fmtDate(po.order_date)}${po.delivery_date ? ` · due ${fmtDate(po.delivery_date)}` : ''}${po.supplier_ref ? ` · ${escapeHtml(po.supplier_ref)}` : ''}</span>
      </button>`;
    }).join('');
  }

  function paint() {
    panel.innerHTML = `
      <section class="plan-head admin-surface">
        <div class="plan-settings" id="ordSettings">${settingsHtml()}</div>
        <div class="plan-kpis" id="ordKpis">${kpisHtml()}</div>
      </section>
      <div class="dist-grid-wrap plan-grid-wrap ord-grid-wrap">
        <table class="dist-grid plan-grid ord-grid" id="ordGrid">${gridHtml()}</table>
      </div>
      <section class="ord-list-wrap">
        <h3 class="ord-list-title">Purchase orders</h3>
        <div class="ord-list" id="ordList">${ordersListHtml()}</div>
      </section>`;
    syncTheadHeight();
  }

  function repaintData() {
    recompute();
    const grid = $('ordGrid');
    if (!grid) { paint(); return; }
    grid.innerHTML = gridHtml();
    const k = $('ordKpis');
    if (k) k.innerHTML = kpisHtml();
    const list = $('ordList');
    if (list) list.innerHTML = ordersListHtml();
    syncTheadHeight();
  }

  function repaintBody() {
    const body = $('ordBody');
    if (!body) return;
    body.outerHTML = gridHtml().replace(/^<thead[\s\S]*?<\/thead>/, '');
  }

  function syncTheadHeight() {
    requestAnimationFrame(() => {
      const wrap = panel.querySelector('.ord-grid-wrap');
      const row = panel.querySelector('#ordHead tr');
      if (wrap && row) wrap.style.setProperty('--dist-thead-h', `${row.getBoundingClientRect().height}px`);
    });
  }

  // ---------- saving -------------------------------------------------

  function queueSave(key, fn) {
    clearTimeout(ctx.saveTimers[key]?.timer);
    const run = () => fn().catch((err) => {
      reportError(err, { source: 'admin.orders.save', silent: true });
      toast(err.message || 'Save failed', true);
    });
    const timer = setTimeout(() => { delete ctx.saveTimers[key]; void run(); }, SAVE_DEBOUNCE_MS);
    ctx.saveTimers[key] = { timer, run };
  }

  function flushSaves() {
    const pending = Object.values(ctx.saveTimers);
    ctx.saveTimers = {};
    return Promise.all(pending.map(({ timer, run }) => { clearTimeout(timer); return run(); }));
  }

  function onPanelInput(e) {
    const t = e.target;
    if (t.id === 'ordBuffer') {
      const parsed = parsePlanningNumber(t.value, { max: 200 });
      t.classList.toggle('is-invalid', !parsed.ok);
      if (!parsed.ok) return;
      ctx.buffer = parsed.value || 0;
      repaintData();
      queueSave('buffer', () => saveOrderBuffer(ctx.eventId, ctx.buffer));
      return;
    }
    if (t.dataset.planned) {
      const pid = t.dataset.planned;
      const parsed = parsePlanningNumber(t.value, { max: 100000 });
      t.classList.toggle('is-invalid', !parsed.ok);
      if (!parsed.ok) return;
      const item = ctx.items.get(pid);
      if (!item) return;
      item.planned_qty_override = parsed.value;
      recompute();
      const k = $('ordKpis');
      if (k) k.innerHTML = kpisHtml();
      refreshRowOutputs(pid);
      queueSave(`planned:${pid}`, () => upsertEventMenuItem(ctx.eventId, pid, { planned_qty_override: parsed.value }));
    }
  }

  function refreshRowOutputs(pid) {
    const tr = panel.querySelector(`tr.ord-row[data-pid="${CSS.escape(pid)}"]`);
    const r = ctx.rows.find((x) => x.productId === pid);
    if (!tr || !r) return;
    const tmp = document.createElement('tbody');
    tmp.innerHTML = rowHtml(r);
    const fresh = tmp.firstElementChild;
    [...tr.children].forEach((cell, i) => {
      if (i === 1) return;
      cell.innerHTML = fresh.children[i].innerHTML;
    });
  }

  // ---------- purchase order sheet -----------------------------------

  async function openOrder(poId) {
    let po = poId ? ctx.orders.find((o) => o.id === poId) : null;
    if (poId) {
      try {
        po = (await getPurchaseOrder(poId)) || po;
      } catch (err) {
        toast(err.message || 'Could not load order', true);
        return;
      }
    }
    const isNew = !po;
    const state = {
      supplierId: po?.supplier_id || '',
      lines: (po?.purchase_order_lines || []).map((l) => ({ ...l })),
    };
    const status = po?.status || 'draft';
    const editable = !locked() && (status === 'draft' || status === 'sent');
    const headerEditable = !locked() && status !== 'confirmed' && status !== 'cancelled';
    const dis = editable ? '' : 'disabled';
    const hdis = headerEditable ? '' : 'disabled';
    const meta = STATUS_META[status];

    openSheet({
      title: isNew ? 'New purchase order' : `${po.reference}`,
      variant: 'admin-full',
      bodyHtml: `
        <div class="ord-sheet">
          ${isNew ? '' : `<div class="ord-sheet-status">${badge(meta)}
            ${po.sent_at ? `<span class="muted">Sent ${fmtDate(po.sent_at)}</span>` : ''}
            ${po.confirmed_at ? `<span class="muted">Confirmed ${fmtDate(po.confirmed_at)}</span>` : ''}
            ${po.cancelled_at ? `<span class="muted">Cancelled ${fmtDate(po.cancelled_at)}</span>` : ''}</div>`}
          <div class="ord-sheet-grid">
            <div class="admin-field"><span class="admin-label">Supplier</span><div id="ordSupplierMount"></div></div>
            <label class="admin-field"><span class="admin-label">Order date</span>
              <input type="date" class="admin-input" id="ordDate" value="${escapeHtml(po?.order_date || today())}" ${hdis}></label>
            <label class="admin-field"><span class="admin-label">Delivery date</span>
              <input type="date" class="admin-input" id="ordDelivery" value="${escapeHtml(po?.delivery_date || ctx.event?.start_date || '')}" ${status === 'cancelled' || locked() ? 'disabled' : ''}></label>
            <label class="admin-field"><span class="admin-label">Supplier reference</span>
              <input type="text" class="admin-input" id="ordSupRef" maxlength="80" value="${escapeHtml(po?.supplier_ref || '')}" placeholder="Their confirmation / order no." ${status === 'cancelled' || locked() ? 'disabled' : ''}></label>
          </div>
          <label class="admin-field"><span class="admin-label">Notes</span>
            <textarea class="admin-input ord-notes" id="ordNotes" rows="2" maxlength="1000" ${status === 'cancelled' || locked() ? 'disabled' : ''}>${escapeHtml(po?.notes || '')}</textarea></label>
          <div class="ord-lines-head">
            <span class="admin-label">Lines</span>
            <span class="muted" id="ordLinesTotal"></span>
          </div>
          <table class="ord-lines">
            <thead><tr><th>Product</th><th class="num">Planned</th><th class="num">Cases</th><th class="num">Case price</th><th class="num">Amount</th><th></th></tr></thead>
            <tbody id="ordLinesBody"></tbody>
          </table>
          ${editable ? '<div id="ordAddLine" class="ord-add-line"></div>' : ''}
          <p class="plan-form-err" id="ordErr" hidden></p>
          ${isNew ? '' : '<details class="ord-history" id="ordHistory"><summary>History</summary><div class="ord-history-body muted">Loading…</div></details>'}
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot ord-sheet-foot">
          ${!isNew && status === 'draft' && !locked() ? '<button type="button" class="admin-drawer-btn admin-drawer-btn--danger" id="ordDelete">Delete</button>' : ''}
          ${!isNew && status !== 'cancelled' && !locked() ? '<button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="ordCancel">Cancel order</button>' : ''}
          <span class="ord-foot-spacer"></span>
          ${!isNew ? `<button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="ordPdf">${icon('download', { size: 14 })} PDF</button>` : ''}
          ${status !== 'cancelled' && !locked() ? '<button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="ordSave">Save</button>' : ''}
          ${editable && status === 'draft' ? '<button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="ordSent">Mark sent</button>' : ''}
          ${editable ? '<button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="ordConfirm">Confirm order</button>' : ''}
        </div>`,
    });

    const err = $('ordErr');
    const showErr = (msg) => { err.textContent = msg; err.hidden = !msg; };

    mountSupplierSearch($('ordSupplierMount'), {
      suppliers: ctx.suppliers,
      value: state.supplierId,
      allowEmpty: false,
      dropdownFixed: true,
      hiddenId: 'ordSupplier',
      inputId: 'ordSupplierInput',
      placeholder: 'Search suppliers…',
      onSelect: ({ supplierId } = {}) => {
        state.supplierId = supplierId || '';
        state.lines.forEach((l) => {
          if (l.case_price == null) {
            const offer = findOfferForSupplier(ctx.productById.get(l.product_id), state.supplierId);
            if (offer?.supplier_id === state.supplierId && offer.case_price != null) l.case_price = Number(offer.case_price);
          }
        });
        paintLines();
      },
    });
    if (!headerEditable) {
      const inp = $('ordSupplierInput');
      if (inp) inp.disabled = true;
    }

    function paintLines() {
      const body = $('ordLinesBody');
      if (!body) return;
      if (!state.lines.length) {
        body.innerHTML = '<tr><td colspan="6" class="muted ord-lines-empty">No lines yet — search below to add products.</td></tr>';
      } else {
        body.innerHTML = state.lines.map((l, i) => {
          const p = ctx.productById.get(l.product_id);
          const row = ctx.rows.find((r) => r.productId === l.product_id);
          const amount = l.case_price != null && l.qty_cases != null ? Number(l.case_price) * Number(l.qty_cases) : null;
          return `<tr data-i="${i}">
            <td><span class="ord-line-name">${escapeHtml(p?.name || 'Unknown')}</span><span class="muted ord-line-pack">${escapeHtml(packLabel(p, state.supplierId))}</span></td>
            <td class="num muted">${row?.planned != null ? qty(row.planned) : '—'}</td>
            <td class="num"><input type="text" inputmode="decimal" class="num-math plan-cell-input plan-cell-input--sm" data-line-qty value="${escapeHtml(l.qty_cases ?? '')}" aria-label="Cases" ${dis}></td>
            <td class="num"><input type="text" inputmode="decimal" class="num-math plan-cell-input" data-line-price value="${escapeHtml(l.case_price ?? '')}" aria-label="Case price" ${dis}></td>
            <td class="num" data-line-amount>${money(amount)}</td>
            <td>${editable ? `<button type="button" class="ord-line-remove" data-line-remove aria-label="Remove line">${icon('x', { size: 14 })}</button>` : ''}</td>
          </tr>`;
        }).join('');
      }
      paintTotal();
    }

    function paintTotal() {
      const t = orderLinesTotal(state.lines);
      const cases = state.lines.reduce((s, l) => s + (Number(l.qty_cases) || 0), 0);
      const el = $('ordLinesTotal');
      if (el) el.textContent = `${t.lines} line${t.lines === 1 ? '' : 's'} · ${qty(cases)} cases · ${money(t.total)} ex VAT${t.priced < t.lines ? ` · ${t.lines - t.priced} unpriced` : ''}`;
    }

    $('ordLinesBody').addEventListener('input', (e) => {
      const tr = e.target.closest('tr[data-i]');
      if (!tr) return;
      const line = state.lines[Number(tr.dataset.i)];
      const isQty = e.target.hasAttribute('data-line-qty');
      if (!isQty && !e.target.hasAttribute('data-line-price')) return;
      const parsed = parsePlanningNumber(e.target.value, { max: isQty ? 100000 : 1000000 });
      const ok = parsed.ok && !(isQty && (parsed.value == null || parsed.value <= 0));
      e.target.classList.toggle('is-invalid', !ok);
      if (!ok) return;
      if (isQty) line.qty_cases = parsed.value;
      else line.case_price = parsed.value;
      const amount = line.case_price != null && line.qty_cases != null ? line.case_price * line.qty_cases : null;
      tr.querySelector('[data-line-amount]').textContent = money(amount);
      paintTotal();
    });
    $('ordLinesBody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-line-remove]');
      if (!btn) return;
      state.lines.splice(Number(btn.closest('tr').dataset.i), 1);
      paintLines();
    });

    if (editable) {
      mountProductSearch($('ordAddLine'), {
        products: ctx.products,
        categories: ctx.categories,
        caseSizes: ctx.caseSizes,
        placeholder: 'Add product…',
        onSelect: ({ productId }) => {
          if (state.lines.some((l) => l.product_id === productId)) {
            toast('Already on this order', true);
            return;
          }
          const row = ctx.rows.find((r) => r.productId === productId);
          const offer = findOfferForSupplier(ctx.productById.get(productId), state.supplierId || null);
          state.lines.push({
            product_id: productId,
            qty_cases: row?.shortfallAfterPending > 0 ? Math.ceil(row.shortfallAfterPending) : 1,
            case_price: offer && (!state.supplierId || offer.supplier_id === state.supplierId) && offer.case_price != null
              ? Number(offer.case_price) : null,
          });
          paintLines();
        },
      });
    }
    paintLines();

    function readHeader() {
      return {
        supplier_id: state.supplierId || $('ordSupplier')?.value || null,
        order_date: $('ordDate')?.value || null,
        delivery_date: $('ordDelivery')?.value || null,
        supplier_ref: $('ordSupRef')?.value.trim() || null,
        notes: $('ordNotes')?.value.trim() || null,
      };
    }

    function validate() {
      const h = readHeader();
      if (!h.supplier_id) return 'Choose a supplier';
      if (!h.order_date) return 'Order date is required';
      if (h.delivery_date && h.delivery_date < h.order_date) return 'Delivery date is before the order date';
      if (state.lines.some((l) => !(Number(l.qty_cases) > 0))) return 'Every line needs a quantity above zero';
      return '';
    }

    async function save() {
      const msg = validate();
      if (msg) { showErr(msg); return null; }
      showErr('');
      const h = readHeader();
      let saved = po;
      if (isNew && !saved) {
        saved = await createPurchaseOrder({ ...h, event_id: ctx.eventId, status: 'draft' });
        po = saved;
      } else if (headerEditable) {
        saved = await updatePurchaseOrder(po.id, h);
      } else {
        saved = await updatePurchaseOrder(po.id, { delivery_date: h.delivery_date, supplier_ref: h.supplier_ref, notes: h.notes });
      }
      if (editable) await savePurchaseOrderLines(po.id, state.lines, po.purchase_order_lines || []);
      return saved;
    }

    async function act(btnId, fn, success) {
      const btn = $(btnId);
      if (btn) btn.disabled = true;
      try {
        await fn();
        closeSheet();
        await reloadOrders();
        if (success) toast(success);
      } catch (e2) {
        if (btn) btn.disabled = false;
        showErr(e2.message || 'Something went wrong');
      }
    }

    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };

    on('ordSave', () => act('ordSave', async () => { if (!(await save())) throw new Error(err.textContent || 'Fix the errors above'); }, 'Order saved'));
    on('ordSent', () => act('ordSent', async () => {
      if (!state.lines.length) throw new Error('Add at least one line before sending');
      if (!(await save())) throw new Error(err.textContent);
      await updatePurchaseOrder(po.id, { status: 'sent' });
    }, 'Order marked as sent'));
    on('ordConfirm', async () => {
      if (!state.lines.length) { showErr('Add at least one line before confirming'); return; }
      const ok = await confirmDialog({
        title: 'Confirm order',
        message: 'Confirming locks the lines as the supplier’s agreed quantities. Stock only changes when the delivery is counted in.',
        confirmLabel: 'Confirm order',
        danger: false,
      });
      if (!ok) return;
      await act('ordConfirm', async () => {
        if (!(await save())) throw new Error(err.textContent);
        await confirmPurchaseOrder(po.id, $('ordSupRef')?.value.trim() || null);
      }, 'Order confirmed');
    });
    on('ordCancel', async () => {
      const ok = await confirmDialog({
        title: 'Cancel order',
        message: `Cancel ${po.reference}? It stays in the order history but no longer counts as ordered.`,
        confirmLabel: 'Cancel order',
      });
      if (!ok) return;
      await act('ordCancel', () => updatePurchaseOrder(po.id, { status: 'cancelled' }), 'Order cancelled');
    });
    on('ordDelete', async () => {
      const ok = await confirmDialog({
        title: 'Delete draft',
        message: `Delete draft ${po.reference}? This can’t be undone.`,
        confirmLabel: 'Delete',
      });
      if (!ok) return;
      await act('ordDelete', () => deletePurchaseOrder(po.id), 'Draft deleted');
    });
    on('ordPdf', async () => {
      const btn = $('ordPdf');
      btn.disabled = true;
      try {
        const { generatePurchaseOrderPDF } = await import('../../lib/purchase-order-pdf.js');
        const h = readHeader();
        const accounts = await listAccounts().catch(() => []);
        const account = (accounts || []).find((a) => a.supplier_id === h.supplier_id);
        const contact = primaryContact(account?.account_contacts, 'order');
        const sup = ctx.supplierById.get(h.supplier_id) || null;
        await generatePurchaseOrderPDF({
          po: { ...po, ...h },
          supplier: sup ? {
            ...sup,
            contact_name: contact?.name || sup.contact_name,
            email: contact?.email || sup.email,
            phone: contact?.phone || sup.phone,
          } : null,
          event: ctx.event,
          lines: state.lines.map((l) => {
            const p = ctx.productById.get(l.product_id);
            return { name: p?.name || 'Unknown', pack: packLabel(p, h.supplier_id), qty_cases: l.qty_cases, case_price: l.case_price };
          }),
        });
      } catch (e2) {
        toast(e2.message || 'PDF failed', true);
      } finally {
        btn.disabled = false;
      }
    });

    const hist = $('ordHistory');
    if (hist) {
      hist.addEventListener('toggle', async () => {
        if (!hist.open || hist.dataset.loaded) return;
        hist.dataset.loaded = '1';
        const body = hist.querySelector('.ord-history-body');
        try {
          const rows = await orderHistory(po.id);
          body.innerHTML = rows?.length ? `<ul class="ord-history-list">${rows.map(historyLine).join('')}</ul>` : 'No history recorded.';
        } catch (e2) {
          body.textContent = e2.message || 'Could not load history';
        }
      });
    }
  }

  function historyLine(r) {
    const when = new Date(r.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const who = r.actor_email || 'System';
    let what;
    if (r.table_name === 'purchase_orders') {
      if (r.op === 'INSERT') what = 'Created order';
      else if (r.op === 'DELETE') what = 'Deleted order';
      else if (r.old_data?.status !== r.new_data?.status) what = `Status ${r.old_data?.status} → ${r.new_data?.status}`;
      else what = `Updated ${(r.changed_cols || []).filter((c) => c !== 'updated_at').join(', ') || 'order'}`;
    } else {
      const data = r.new_data || r.old_data || {};
      const name = ctx.productById.get(data.product_id)?.name || 'product';
      if (r.op === 'INSERT') what = `Added ${name} × ${data.qty_cases}`;
      else if (r.op === 'DELETE') what = `Removed ${name}`;
      else what = `${name}: ${r.old_data?.qty_cases} → ${r.new_data?.qty_cases} cases${r.old_data?.case_price !== r.new_data?.case_price ? `, ${money(r.old_data?.case_price)} → ${money(r.new_data?.case_price)}` : ''}`;
    }
    return `<li><span class="ord-history-when">${escapeHtml(when)}</span> ${escapeHtml(what)} <span class="ord-history-who">${escapeHtml(who)}</span></li>`;
  }

  // ---------- toolbar ------------------------------------------------

  async function generateOrders() {
    if (locked()) { toast('Orders are locked for this event', true); return; }
    await flushSaves();
    const { orders, unassigned } = draftOrdersFromShortfalls(ctx.rows, ctx.productById);
    if (!orders.length && !unassigned.length) {
      toast('Nothing to order — confirmed and pending orders cover the plan');
      return;
    }
    const summary = orders.map((o) => {
      const sup = ctx.supplierById.get(o.supplierId);
      const cases = o.lines.reduce((s, l) => s + l.qty_cases, 0);
      return `<li><strong>${escapeHtml(sup?.name || 'Supplier')}</strong> — ${o.lines.length} product${o.lines.length === 1 ? '' : 's'}, ${cases} cases</li>`;
    }).join('');
    const missing = unassigned.length
      ? `<p class="muted">${unassigned.length} product${unassigned.length === 1 ? ' has' : 's have'} no supplier and will be skipped: ${escapeHtml(unassigned.slice(0, 6).map((u) => ctx.productById.get(u.productId)?.name || '?').join(', '))}${unassigned.length > 6 ? '…' : ''}</p>`
      : '';
    const el = openModal({
      title: 'Generate draft orders',
      bodyHtml: `
        <p class="admin-modal-confirm-msg">Creates one draft purchase order per preferred supplier for the cases still needed after confirmed and pending orders. Review and send each draft — nothing is ordered or added to stock yet.</p>
        ${orders.length ? `<ul class="ord-gen-list">${summary}</ul>` : ''}
        ${missing}`,
      footHtml: `
        <div class="admin-modal-confirm-foot">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-cancel>Cancel</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-ok ${orders.length ? '' : 'disabled'}>Create ${orders.length} draft${orders.length === 1 ? '' : 's'}</button>
        </div>`,
    });
    el.querySelector('[data-cancel]').onclick = closeModal;
    el.querySelector('[data-ok]').onclick = async () => {
      el.querySelector('[data-ok]').disabled = true;
      let made = 0;
      try {
        for (const o of orders) {
          const po = await createPurchaseOrder({
            event_id: ctx.eventId,
            supplier_id: o.supplierId,
            status: 'draft',
            order_date: today(),
            delivery_date: ctx.event?.start_date || null,
          });
          await savePurchaseOrderLines(po.id, o.lines, []);
          made += 1;
        }
        closeModal();
        await reloadOrders();
        toast(`${made} draft order${made === 1 ? '' : 's'} created`);
      } catch (e2) {
        closeModal();
        await reloadOrders();
        toast(`${made} created — ${e2.message || 'generation failed'}`, true);
      }
    };
  }

  function onToolbarAction(e) {
    const action = e.detail?.action;
    const handlers = {
      'orders-generate': generateOrders,
      'orders-new': () => {
        if (locked()) { toast('Orders are locked for this event', true); return; }
        void openOrder(null);
      },
    };
    if (!handlers[action]) return;
    e.detail.handled = true;
    void handlers[action]();
  }

  function onPanelClick(e) {
    const gotoEl = e.target.closest('[data-goto]');
    if (gotoEl) {
      e.preventDefault();
      navigate({ view: gotoEl.dataset.goto });
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    const open = e.target.closest('[data-open-po]');
    if (open) void openOrder(open.dataset.openPo);
  }

  function onTableFilter(e) {
    if (e.detail?.panel !== 'orders') return;
    ctx.filter = e.detail.values || {};
    repaintBody();
  }

  function onProductFilter(e) {
    ctx.query = e.detail?.query || '';
    repaintBody();
    if (e.detail?.productId) {
      panel.querySelector(`tr[data-pid="${CSS.escape(e.detail.productId)}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    if (e.detail) e.detail.handled = true;
  }

  // ---------- load ---------------------------------------------------

  async function reloadOrders() {
    const [orders, event] = await Promise.all([
      listPurchaseOrders(ctx.eventId),
      loadEventLite(ctx.eventId, { force: true }),
    ]);
    if (ctx.abort) return;
    ctx.orders = orders || [];
    if (event) ctx.event = event;
    repaintData();
  }

  async function reload() {
    await flushSaves();
    const DB = getDB();
    const [event, pricing, items, orders, buffer, products, suppliers, caseSizes, categories, deliveries] = await Promise.all([
      loadEventLite(ctx.eventId),
      loadEventPricing(ctx.eventId),
      listEventMenu(ctx.eventId),
      listPurchaseOrders(ctx.eventId),
      loadOrderBuffer(ctx.eventId),
      loadLibraryProducts(),
      loadSuppliers(),
      loadCaseSizes(),
      loadCategories(),
      DB.deliveries.forEvent(ctx.eventId).catch(() => []),
    ]);
    if (ctx.abort) return;
    if (!event || !pricing) throw new Error('Event not found');
    ctx.event = event;
    ctx.pricing = pricing;
    ctx.items = new Map((items || []).map((i) => [i.product_id, i]));
    ctx.orders = orders || [];
    ctx.buffer = buffer;
    ctx.products = (products || []).filter((p) => !p.archived && (p.product_kind || 'stock') === 'stock');
    ctx.productById = new Map((products || []).map((p) => [p.id, p]));
    ctx.suppliers = suppliers || [];
    ctx.supplierById = new Map(ctx.suppliers.map((s) => [s.id, s]));
    ctx.caseSizes = caseSizes || [];
    ctx.categories = categories || [];
    const hasLines = (deliveries || []).some((d) => (d.lines || []).length);
    ctx.countedIn = hasLines ? countedInFromDeliveries(deliveries, event.event_products, caseSizes) : null;
    recompute();
    const supplierIds = new Set(ctx.rows.map((r) => preferredSupplierId(ctx.productById.get(r.productId))).filter(Boolean));
    setTableFilterContext('orders', {
      suppliers: [...supplierIds]
        .map((id) => ({ value: id, label: ctx.supplierById.get(id)?.name || 'Unknown' }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    });
    paint();
  }

  function onLoadError(err) {
    reportError(err, { source: 'admin.orders.reload', silent: true });
    const missing = isOrdersSchemaMissing(err) || isPlanningSchemaMissing(err);
    panel.innerHTML = errorState({
      title: missing ? 'Orders aren’t set up yet' : 'Couldn’t load orders',
      copy: missing
        ? 'The planning or purchase order tables are missing. Apply migrations 068 and 069, then retry.'
        : (err.message || 'Failed to load'),
      variant: 'admin',
    });
    bindEmptyRetry(panel, () => reload().catch(onLoadError));
  }

  panel.addEventListener('input', onPanelInput);
  panel.addEventListener('click', onPanelClick);
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  document.addEventListener(ADMIN_TABLE_FILTER, onTableFilter);
  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);

  reload().catch(onLoadError);

  return () => {
    ctx.abort = true;
    void flushSaves();
    panel.removeEventListener('input', onPanelInput);
    panel.removeEventListener('click', onPanelClick);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
    document.removeEventListener(ADMIN_TABLE_FILTER, onTableFilter);
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
  };
}
