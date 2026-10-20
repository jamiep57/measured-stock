/**
 * Orders — plan this event’s cases, then raise purchase orders.
 * Orders record what was asked of suppliers; only deliveries create stock.
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { loadingWidget } from '../../components/loading-widget.js';
import { errorState, bindEmptyRetry } from '../../components/empty-state.js';
import { reportError } from '../../lib/client-errors.js';
import { getDB, invalidateEventCache, loadCaseSizes, loadCategories, loadEventLite, loadLibraryProducts, loadRecipesFull, loadSuppliers } from '../../db.js';
import { openModal, closeModal, confirmDialog } from '../../components/modal.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { mountProductSearch, productSupplierSearchText } from '../../components/product-search.js';
import { mountSupplierSearch } from '../../components/supplier-search.js';
import { hrefForRoute, navigate } from '../router.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TOOLBAR_ACTION, setTopbarFilterSuppressed } from '../topbar-toolbar.js';
import { ADMIN_TABLE_FILTER, getTableFilterValues, setTableFilterContext } from '../table-filter.js';
import { countedInFromDeliveries } from '../../lib/opening-stock.js';
import { findOfferForSupplier } from '../../pack-metrics.js';
import { parsePlanningNumber, resolveMenuLine } from '../../lib/planning-menu.js';
import { cocktailServesByProduct } from '../../lib/menu-cocktails.js';
import { groupMenuItems } from '../../lib/menu-serves.js';
import {
  isCocktailSchemaMissing,
  isEventPricingLocked,
  isPlanningSchemaMissing,
  listEventCocktails,
  listEventMenu,
  loadEventPricing,
  patchEventMenuItems,
  updateEventCocktail,
  updateEventMenuItem,
  updateEventPricing,
} from '../../lib/planning-data.js';
import {
  compareOrders,
  compareSummary,
  draftOrdersFromShortfalls,
  orderLinesTotal,
  orderValueVat,
  orderedByProduct,
  plannedProductCases,
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
import { readTillFile } from '../../lib/till-import.js';
import {
  buildForecastLines,
  forecastTotals,
  groupForecastLines,
  keepMixServes,
  matchedTakingsTarget,
  mixFromSales,
  mixSharesOfMatched,
  plannedOrderCost,
  scaleCategoryServes,
  sellingPrice,
  servesForMix,
  servesFromMix,
} from '../../lib/order-forecast.js';

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
    cocktails: [],
    cocktailServes: new Map(),
    products: [],
    productById: new Map(),
    supplierById: new Map(),
    suppliers: [],
    categories: [],
    caseSizes: [],
    orders: [],
    rows: [],
    buffer: 0,
    target: null,
    anchorTarget: null,
    recipes: [],
    tab: 'take',
    filter: getTableFilterValues('orders') || {},
    query: getLastProductFilter().query || '',
    saveTimers: {},
    abort: false,
  };

  const locked = () => isEventPricingLocked(ctx.pricing);

  // ---------- derived ------------------------------------------------

  function plannedFor(pid) {
    const list = ctx.items.get(pid) || [];
    const extra = ctx.cocktailServes.get(pid) || 0;
    if (!list.length && !(extra > 0)) return { cases: null, source: null };
    return plannedProductCases(list, extra, ctx.productById.get(pid), ctx.caseSizes, ctx.buffer);
  }

  function recompute() {
    ctx.cocktailServes = cocktailServesByProduct(ctx.cocktails);
    const ids = new Set();
    ctx.items.forEach((list, pid) => {
      if (list.some((item) => item.included !== false || item.planned_qty_override != null)) ids.add(pid);
    });
    ctx.orders.forEach((po) => (po.purchase_order_lines || []).forEach((l) => ids.add(l.product_id)));
    (ctx.event?.event_products || []).forEach((ep) => {
      if (Number(ep.qty_ordered) > 0 || Number(ep.delivered_qty) > 0) ids.add(ep.product_id);
    });
    ctx.cocktailServes.forEach((_serves, pid) => ids.add(pid));
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
    const supplierName = (r) => {
      const p = ctx.productById.get(r.productId);
      return ctx.supplierById.get(preferredSupplierId(p))?.name || '';
    };
    const sort = ctx.filter.sort || 'gap';
    if (sort === 'name') rows.sort((a, b) => name(a).localeCompare(name(b)));
    else if (sort === 'category') rows.sort((a, b) => cat(a).localeCompare(cat(b)) || name(a).localeCompare(name(b)));
    else if (sort === 'supplier') {
      rows.sort((a, b) => {
        const sa = supplierName(a);
        const sb = supplierName(b);
        if (!sa !== !sb) return sa ? -1 : 1;
        return sa.localeCompare(sb) || name(a).localeCompare(name(b));
      });
    } else rows.sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0) || name(a).localeCompare(name(b)));
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
      <div class="plan-kpi"><span class="plan-kpi-label">QTY to order</span><span class="plan-kpi-value">${qty(s.planned)}</span>
        <span class="plan-kpi-sub muted">cases from projected serves${ctx.buffer ? ` +${ctx.buffer}%` : ''}</span></div>
      <div class="plan-kpi"><span class="plan-kpi-label">Confirmed</span><span class="plan-kpi-value">${qty(s.confirmed)}</span>
        <span class="plan-kpi-sub muted">${money(value)} on confirmed orders</span></div>
      <div class="plan-kpi"><span class="plan-kpi-label">Pending</span><span class="plan-kpi-value">${qty(s.pending)}</span>
        <span class="plan-kpi-sub muted">on draft / sent orders</span></div>
      <div class="plan-kpi"><span class="plan-kpi-label">Variance</span><span class="plan-kpi-value">${s.short + s.over}</span>
        <span class="plan-kpi-sub muted">${s.short ? `<span class="plan-dot plan-dot--red"></span>${s.short} short ` : ''}${s.over ? `<span class="plan-dot plan-dot--amber"></span>${s.over} over` : ''}${!s.short && !s.over ? 'Orders match the plan' : ''}</span></div>`;
  }

  function lockChip() {
    if (!locked()) return '';
    return `<span class="plan-chip plan-chip--locked">${icon('lock', { size: 12 })} Event ${escapeHtml(ctx.pricing.status)} — orders are read-only</span>`;
  }

  function settingsHtml() {
    const dis = locked() ? 'disabled' : '';
    return `
      <label class="admin-field plan-field plan-field--sm">
        <span class="admin-label">Order buffer %</span>
        <input type="text" inputmode="decimal" class="admin-input num-math" id="ordBuffer" value="${escapeHtml(ctx.buffer ? String(ctx.buffer) : '')}" placeholder="0" ${dis}>
      </label>
      <div class="plan-settings-meta">
        ${lockChip()}
        <a href="${escapeHtml(hrefForRoute({ view: 'event', eventId: ctx.eventId, panel: 'planning' }))}" class="plan-link" data-goto="planning">${icon('calculator', { size: 13 })} Menu & GP</a>
      </div>`;
  }

  function orderSupplierOptions(product) {
    const current = preferredSupplierId(product);
    const seen = new Set();
    const options = [];
    (product?.product_suppliers || []).forEach((offer) => {
      if (!offer?.supplier_id || seen.has(offer.supplier_id)) return;
      seen.add(offer.supplier_id);
      options.push({
        id: offer.supplier_id,
        name: offer.supplier?.name || ctx.supplierById.get(offer.supplier_id)?.name || 'Supplier',
      });
    });
    // Legacy products can still carry supplier_id without an offer row.
    if (current && !seen.has(current) && current === product?.supplier_id) {
      options.push({
        id: current,
        name: ctx.supplierById.get(current)?.name || product?.supplier?.name || 'Supplier',
      });
    }
    options.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return { current, options };
  }

  function supplierSelectHtml(product) {
    const { current, options } = orderSupplierOptions(product);
    if (!options.length) return '<span class="muted" title="No suppliers linked to this product">—</span>';
    const dis = locked() ? 'disabled' : '';
    const opts = options.map((opt) => (
      `<option value="${escapeHtml(opt.id)}"${opt.id === current ? ' selected' : ''}>${escapeHtml(opt.name)}</option>`
    )).join('');
    const currentName = options.find((opt) => opt.id === current)?.name || '';
    return `<select class="ord-supplier-select" data-order-supplier="${escapeHtml(product?.id || '')}" aria-label="Supplier to order from" title="${escapeHtml(currentName || 'Suppliers linked to this product')}" ${dis}>${opts}</select>`;
  }

  function rowHtml(r) {
    const p = ctx.productById.get(r.productId);
    const supplier = ctx.supplierById.get(preferredSupplierId(p));
    const pack = packLabel(p, supplier?.id);
    const src = ctx.plannedSource.get(r.productId);
    const list = ctx.items.get(r.productId) || [];
    const item = list.find((row) => row.planned_qty_override != null) || list[0] || null;
    const onMenu = list.length > 0;
    const dis = locked() || !onMenu ? 'disabled' : '';
    const plannedInput = `<input type="text" inputmode="decimal" autocomplete="off" class="num-math plan-cell-input plan-cell-input--sm"
      data-planned="${escapeHtml(r.productId)}" value="${escapeHtml(item?.planned_qty_override != null ? String(item.planned_qty_override) : '')}"
      placeholder="${escapeHtml(src === 'projection' && r.planned != null ? String(r.planned) : '')}"
      title="${onMenu ? 'Override qty required — leave blank to use projected serves' : 'Add to the event menu to plan this product'}"
      aria-label="Qty to order" ${dis}>`;
    const gapCls = GAP_META[r.status] || GAP_META.none;
    const refs = [...new Set(r.refs)].map((ref) => {
      const po = ctx.orders.find((o) => o.reference === ref);
      return po ? `<button type="button" class="ord-ref" data-open-po="${escapeHtml(po.id)}">${escapeHtml(ref)}</button>` : '';
    }).join('');
    const marker = statusChip(productOrderStatus(r.productId));
    return `<tr class="dist-prod-row ord-row" data-pid="${escapeHtml(r.productId)}">
      <th class="dist-sticky plan-col-product" scope="row">
        <div class="dist-item">
          <span class="dist-item-name" title="${escapeHtml(p?.name || '')}">${escapeHtml(p?.name || 'Unknown product')}</span>
          ${pack ? `<span class="dist-item-meta">${escapeHtml(pack)}</span>` : ''}
        </div>
      </th>
      <td class="plan-cell ord-supplier">${p ? supplierSelectHtml(p) : '<span class="muted">—</span>'}</td>
      <td class="plan-cell">${plannedInput}</td>
      <td class="plan-cell plan-out">${qty(r.confirmed)}${r.confirmedSource === 'manual' ? ' <span class="dist-bar-tag" title="Entered on the event before purchase orders — not linked to an order">manual</span>' : ''}</td>
      <td class="plan-cell plan-out">${r.pending ? qty(r.pending) : '—'}</td>
      <td class="plan-cell plan-cell--key plan-out">${badge(gapCls, `title="${escapeHtml(r.gap == null ? 'No plan' : `${signed(r.gap)} cases vs qty required`)}"`)} <span class="ord-gap">${r.gap ? signed(r.gap) : ''}</span></td>
      <td class="plan-cell ord-status-cell">${marker}</td>
      <td class="plan-cell ord-refs">${refs || '<span class="muted">—</span>'}</td>
      <td class="plan-cell ord-actions">${rowActionHtml(r)}</td>
    </tr>`;
  }

  function openPoForProduct(productId) {
    const matches = ctx.orders.filter((po) => (
      (po.status === 'draft' || po.status === 'sent')
      && (po.purchase_order_lines || []).some((line) => line.product_id === productId)
    ));
    const drafts = matches.filter((po) => po.status === 'draft');
    const pool = drafts.length ? drafts : matches;
    return pool[pool.length - 1] || null;
  }

  function rowActionHtml(r) {
    const product = ctx.productById.get(r.productId);
    const supplierId = preferredSupplierId(product);
    const po = openPoForProduct(r.productId);
    const canRaise = !locked() && r.shortfallAfterPending > 0 && !!supplierId;
    const raiseTitle = locked()
      ? 'Orders are locked for this event'
      : (!supplierId
        ? 'Choose a supplier before raising an order'
        : (canRaise ? 'Raise PO for the cases still short' : 'Nothing left to order'));
    const confirmTitle = locked()
      ? 'Orders are locked for this event'
      : (po ? `Confirm ${po.reference}` : 'No draft or sent order to confirm');
    const raiseAttrs = canRaise
      ? `data-po-action="raise" data-supplier-id="${escapeHtml(supplierId)}"`
      : 'disabled';
    const confirmAttrs = po && !locked()
      ? `data-po-action="confirm" data-po-id="${escapeHtml(po.id)}"`
      : 'disabled';
    return `<div class="ord-row-actions">
      <button type="button" class="ord-icon-btn" aria-label="Raise PO" title="${escapeHtml(raiseTitle)}" ${raiseAttrs}>${icon('shopping-cart', { size: 14 })}</button>
      <button type="button" class="ord-icon-btn" aria-label="Confirm order" title="${escapeHtml(confirmTitle)}" ${confirmAttrs}>${icon('clipboard-check', { size: 14 })}</button>
    </div>`;
  }

  function gridHtml() {
    const rows = visibleRows();
    const head = `<tr>
      <th class="dist-th dist-sticky plan-col-product"><div class="dist-bar-head dist-bar-head--left"><span class="dist-bar-name">Product</span></div></th>
      <th class="dist-th plan-th plan-th--supplier" title="Who this product is ordered from. Purchase orders use this supplier."><div class="dist-bar-head dist-bar-head--left"><span class="dist-bar-name">Supplier</span></div></th>
      ${[
        ['QTY to order', 'Cases needed — projected serves ÷ serves per case, plus buffer', 'plan-th--qty'],
        ['Confirmed', 'Cases on confirmed purchase orders'],
        ['Pending', 'Cases on draft or sent orders'],
        ['Variance', 'Confirmed minus qty required'],
        ['Status', 'Current order status for this product'],
        ['Orders', 'Purchase orders including this product'],
      ].map(([l, t, extra]) => `<th class="dist-th plan-th${extra ? ` ${extra}` : ''}" title="${escapeHtml(t)}"><div class="dist-bar-head"><span class="dist-bar-name">${escapeHtml(l)}</span></div></th>`).join('')}
      <th class="dist-th plan-th ord-actions-th" aria-label="Actions"></th>
    </tr>`;
    const body = rows.length
      ? rows.map(rowHtml).join('')
      : `<tr><td colspan="9" class="dist-empty">${ctx.rows.length ? 'No products match the current filter.' : 'Nothing planned or ordered yet — add products to the event menu with projected serves, then raise a purchase order.'}</td></tr>`;
    return `<thead id="ordHead">${head}</thead><tbody id="ordBody">${body}</tbody>`;
  }

  const ORDER_STEPS = [
    { id: 'draft', label: 'Draft' },
    { id: 'sent', label: 'Sent' },
    { id: 'confirmed', label: 'Confirmed' },
  ];

  function productOrderStatus(productId) {
    const statuses = ctx.orders
      .filter((po) => po.status !== 'cancelled' && (po.purchase_order_lines || []).some((line) => line.product_id === productId))
      .map((po) => po.status);
    if (statuses.includes('draft')) return 'draft';
    if (statuses.includes('sent')) return 'sent';
    if (statuses.includes('confirmed')) return 'confirmed';
    return null;
  }

  function statusMarker(status) {
    if (!status || status === 'cancelled') return '<span class="muted">—</span>';
    const at = ORDER_STEPS.findIndex((step) => step.id === status);
    return `<ol class="ord-steps" aria-label="Order status">${ORDER_STEPS.map((step, i) => {
      const cls = i < at ? 'is-done' : (i === at ? 'is-current' : '');
      return `<li class="${cls}">${escapeHtml(step.label)}</li>`;
    }).join('')}</ol>`;
  }

  function statusChip(status) {
    if (!status || status === 'cancelled') return '<span class="muted">—</span>';
    const step = ORDER_STEPS.find((s) => s.id === status);
    if (!step) return '<span class="muted">—</span>';
    return `<ol class="ord-steps" aria-label="Order status"><li class="is-current">${escapeHtml(step.label)}</li></ol>`;
  }

  function shortfallGroups() {
    return draftOrdersFromShortfalls(ctx.rows, ctx.productById);
  }

  function draftForSupplier(supplierId) {
    return ctx.orders.find((po) => po.status === 'draft' && po.supplier_id === supplierId) || null;
  }

  function orderActionButtons(po) {
    if (locked() || po.status === 'cancelled' || po.status === 'confirmed') return '';
    const hasLines = (po.purchase_order_lines || []).length > 0;
    const needsLine = hasLines ? '' : 'disabled title="Add a line on the order first"';
    const extra = po.status === 'draft'
      ? shortfallGroups().orders.find((group) => group.supplierId === po.supplier_id)
      : null;
    const buttons = [];
    if (extra) {
      buttons.push(`<button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-po-action="raise" data-supplier-id="${escapeHtml(po.supplier_id)}">Raise PO</button>`);
    }
    if (po.status === 'draft' || po.status === 'sent') {
      buttons.push(`<button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-po-action="confirm" data-po-id="${escapeHtml(po.id)}" ${needsLine}>Confirm order</button>`);
    }
    if (po.status === 'draft') {
      buttons.push(`<button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-po-action="sent" data-po-id="${escapeHtml(po.id)}" ${needsLine}>Mark sent</button>`);
    }
    return buttons.join('');
  }

  function orderMatchesQuery(po) {
    const q = ctx.query.trim().toLowerCase();
    if (!q) return true;
    const sup = ctx.supplierById.get(po.supplier_id);
    const names = (po.purchase_order_lines || []).map((line) => ctx.productById.get(line.product_id)?.name || '');
    return [po.reference, po.status, sup?.name, ...names].join(' ').toLowerCase().includes(q);
  }

  function ordersRailHtml() {
    const q = ctx.query.trim().toLowerCase();
    const { orders: groups, unassigned } = shortfallGroups();
    const raiseRows = groups.filter((group) => !draftForSupplier(group.supplierId)).filter((group) => {
      if (!q) return true;
      const sup = ctx.supplierById.get(group.supplierId);
      return (sup?.name || '').toLowerCase().includes(q);
    }).map((group) => {
      const sup = ctx.supplierById.get(group.supplierId);
      const cases = group.lines.reduce((sum, line) => sum + line.qty_cases, 0);
      return `<article class="ord-rail-row">
        <div class="ord-rail-main">
          <span class="ord-rail-top"><span class="ord-rail-ref">Not raised</span></span>
          <span class="ord-rail-sup">${escapeHtml(sup?.name || 'Supplier')}</span>
          <span class="ord-rail-meta muted">${group.lines.length} product${group.lines.length === 1 ? '' : 's'} · ${qty(cases)} cases still short</span>
        </div>
        <div class="ord-rail-status"></div>
        <div class="ord-rail-actions">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-po-action="raise" data-supplier-id="${escapeHtml(group.supplierId)}">Raise PO</button>
        </div>
      </article>`;
    }).join('');
    const orderRows = ctx.orders.slice().reverse().filter(orderMatchesQuery).map((po) => {
      const meta = STATUS_META[po.status] || STATUS_META.draft;
      const sup = ctx.supplierById.get(po.supplier_id);
      const t = orderLinesTotal(po.purchase_order_lines);
      const cases = (po.purchase_order_lines || []).reduce((s, l) => s + Number(l.qty_cases || 0), 0);
      const actions = orderActionButtons(po);
      const marker = po.status === 'cancelled' ? badge(meta) : statusMarker(po.status);
      return `<article class="ord-rail-row${po.status === 'cancelled' ? ' ord-rail-row--cancelled' : ''}" data-open-po="${escapeHtml(po.id)}">
        <div class="ord-rail-main">
          <span class="ord-rail-top"><span class="ord-rail-ref">${escapeHtml(po.reference)}</span></span>
          <span class="ord-rail-sup">${escapeHtml(sup?.name || 'Unknown supplier')}</span>
          <span class="ord-rail-meta">${t.lines} line${t.lines === 1 ? '' : 's'} · ${qty(cases)} cases · ${money(t.total)}</span>
        </div>
        <div class="ord-rail-status">${marker}</div>
        ${actions ? `<div class="ord-rail-actions">${actions}</div>` : '<div class="ord-rail-actions"></div>'}
      </article>`;
    }).join('');
    const missing = unassigned.length
      ? `<p class="ord-rail-note muted">${unassigned.length} product${unassigned.length === 1 ? ' has' : 's have'} no supplier, so ${unassigned.length === 1 ? 'it can’t' : 'they can’t'} be raised from here.</p>`
      : '';
    if (!raiseRows && !orderRows) {
      const empty = q
        ? 'No purchase orders match this search.'
        : 'No purchase orders yet. Use <strong>Generate orders</strong> for every shortfall, or <strong>New order</strong>.';
      return `<p class="ord-rail-empty muted">${empty}</p>${q ? '' : missing}`;
    }
    return `${raiseRows}${orderRows}${missing}`;
  }

  function forecastLines() {
    return buildForecastLines({
      items: ctx.items,
      cocktails: ctx.cocktails,
      productById: ctx.productById,
      caseSizes: ctx.caseSizes,
      event: ctx.event,
    });
  }

  function pctInputValue(n) {
    if (n == null || !Number.isFinite(Number(n))) return '';
    const v = Math.round(Number(n) * 10) / 10;
    return String(v);
  }

  function showKeepMix() {
    const anchor = Number(ctx.anchorTarget);
    const target = Number(ctx.target);
    if (!(anchor > 0) || !(target > 0)) return false;
    if (Math.round(anchor * 100) === Math.round(target * 100)) return false;
    return forecastLines().some((line) => Number(line.projectedServes) > 0);
  }

  function caseCostFor(productId) {
    const product = ctx.productById.get(productId);
    return resolveMenuLine({ product_id: productId, included: true }, {
      product,
      caseSizes: ctx.caseSizes,
      event: ctx.event,
    }).caseCost;
  }

  function forecastStatsHtml() {
    const totals = forecastTotals(forecastLines(), ctx.target);
    const cost = plannedOrderCost(ctx.rows, caseCostFor);
    const share = ctx.target > 0 ? `${pctInputValue(totals.pct)}% of the target` : 'Set a target to see the mix';
    const missing = cost.unpriced ? ` · ${cost.unpriced} unpriced` : '';
    return `
      <div class="plan-kpi"><span class="plan-kpi-label">Allocated</span><span class="plan-kpi-value">${money(totals.revenue)}</span>
        <span class="plan-kpi-sub muted">${share}</span></div>
      <div class="plan-kpi"><span class="plan-kpi-label">Order cost</span><span class="plan-kpi-value">${money(cost.total)}</span>
        <span class="plan-kpi-sub muted">planned cases × case cost${missing}</span></div>`;
  }

  function forecastHeadHtml() {
    const dis = locked() ? 'disabled' : '';
    return `
      <div class="ord-forecast-head">
        <label class="admin-field plan-field">
          <span class="admin-label">Target revenue (£)</span>
          <input type="text" inputmode="decimal" autocomplete="off" class="admin-input num-math" id="ordTarget"
            value="${escapeHtml(ctx.target != null ? String(ctx.target) : '')}" placeholder="e.g. 350000" ${dis}>
        </label>
        <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="ordKeepMix" ${showKeepMix() && !locked() ? '' : 'hidden'}>Keep this mix</button>
        <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="ordImportCsv" ${dis}>Import sales CSV</button>
        <input type="file" id="ordCsvFile" accept=".csv,.tsv,.xlsx,.xls,.txt" hidden>
      </div>
      <p class="ord-forecast-note muted">Each line’s share of the target, divided by its menu price. A blank price uses the price needed to hit the target GP. Import a sales file to set the mix — with no target yet, the file’s matched takings become the target.</p>
      <div class="plan-kpis" id="ordForecastStats">${forecastStatsHtml()}</div>`;
  }

  function priceCell(line) {
    if (line.price == null) return '<span class="ord-forecast-need">Needs a price</span>';
    const note = line.priceSource === 'gp' ? '<span class="muted">from cost</span>' : '';
    return `<span class="ord-forecast-price">${money(line.price)}${note ? ` ${note}` : ''}</span>`;
  }

  function mixInput(attr, key, value, enabled, label) {
    const dis = enabled ? '' : 'disabled';
    return `<input type="text" inputmode="decimal" autocomplete="off" class="num-math plan-cell-input ord-forecast-pct"
      ${attr}="${escapeHtml(key)}" value="${escapeHtml(pctInputValue(value))}"
      aria-label="${escapeHtml(label)}" title="${escapeHtml(enabled ? label : 'Set a target, and a menu price or a cost, before editing the mix')}" ${dis}>`;
  }

  function forecastLineVisible(line) {
    const q = ctx.query.trim().toLowerCase();
    if (!q) return true;
    const hay = [line.name, line.menuName, line.productName, line.sku, line.serveLabel, line.category]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  }

  function forecastBodyHtml() {
    const groups = groupForecastLines(forecastLines(), ctx.target);
    if (!groups.length) {
      return '<p class="ord-forecast-empty muted">Nothing on the menu yet. Add products in Menu &amp; GP, then split the target across them or import a sales CSV.</p>';
    }
    const canEdit = !locked() && Number(ctx.target) > 0;
    const body = groups.map((group) => {
      const lines = group.lines.filter(forecastLineVisible);
      if (!lines.length) return '';
      const editable = canEdit && group.lines.some((line) => line.price != null);
      const head = `<tr class="ord-forecast-cat" data-forecast-cat="${escapeHtml(group.category)}">
        <th scope="row">${escapeHtml(group.category)}</th>
        <td class="num">${mixInput('data-cat-pct', group.category, group.pct, editable, `${group.category} percent of revenue`)}</td>
        <td class="num" data-rev>${money(group.revenue)}</td>
        <td></td>
        <td class="num" data-serves>${group.serves ? qty(group.serves) : '—'}</td>
        <td></td>
      </tr>`;
      const rows = lines.map((line) => {
        const detail = [line.serveLabel, line.caseSize].filter(Boolean).join(' · ');
        const size = detail ? `<span class="ord-forecast-size muted">${escapeHtml(detail)}</span>` : '';
        const casesTitle = line.kind === 'cocktail'
          ? 'Serves of this drink. The products inside it are planned on the order grid.'
          : 'This size’s share of a case, before sizes are added together and the order buffer is applied.';
        return `<tr data-forecast-line="${escapeHtml(line.key)}">
          <td><span class="ord-forecast-name">${escapeHtml(line.name)}</span>${size}</td>
          <td class="num">${mixInput('data-line-pct', line.key, line.mixPct, canEdit && line.price != null, `${line.name} percent of revenue`)}</td>
          <td class="num" data-rev>${money(line.revenue)}</td>
          <td class="num">${priceCell(line)}</td>
          <td class="num" data-serves>${line.projectedServes != null ? qty(line.projectedServes) : '—'}</td>
          <td class="num" data-cases title="${escapeHtml(casesTitle)}">${line.cases != null ? qty(line.cases) : '—'}</td>
        </tr>`;
      }).join('');
      return head + rows;
    }).join('');
    if (!body) {
      return '<p class="ord-forecast-empty muted">No menu lines match this search.</p>';
    }
    return `<table class="ord-forecast">
      <thead><tr>
        <th>Line</th>
        <th class="num">% of revenue</th>
        <th class="num">Takings</th>
        <th class="num">Price</th>
        <th class="num">Serves</th>
        <th class="num">Cases</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  function refreshForecastOutputs() {
    const groups = groupForecastLines(forecastLines(), ctx.target);
    const byKey = new Map();
    const canEdit = !locked() && Number(ctx.target) > 0;
    groups.forEach((group) => group.lines.forEach((line) => byKey.set(line.key, line)));
    panel.querySelectorAll('tr[data-forecast-line]').forEach((tr) => {
      const line = byKey.get(tr.dataset.forecastLine);
      if (!line) return;
      const pct = tr.querySelector('[data-line-pct]');
      if (pct) {
        pct.disabled = !(canEdit && line.price != null);
        if (document.activeElement !== pct) pct.value = pctInputValue(line.mixPct);
      }
      const rev = tr.querySelector('[data-rev]');
      if (rev) rev.textContent = money(line.revenue);
      const serves = tr.querySelector('[data-serves]');
      if (serves) serves.textContent = line.projectedServes != null ? qty(line.projectedServes) : '—';
      const cases = tr.querySelector('[data-cases]');
      if (cases) cases.textContent = line.cases != null ? qty(line.cases) : '—';
    });
    groups.forEach((group) => {
      const tr = panel.querySelector(`tr[data-forecast-cat="${CSS.escape(group.category)}"]`);
      if (!tr) return;
      const pct = tr.querySelector('[data-cat-pct]');
      if (pct) {
        pct.disabled = !(canEdit && group.lines.some((line) => line.price != null));
        if (document.activeElement !== pct) pct.value = pctInputValue(group.pct);
      }
      const rev = tr.querySelector('[data-rev]');
      if (rev) rev.textContent = money(group.revenue);
      const serves = tr.querySelector('[data-serves]');
      if (serves) serves.textContent = group.serves ? qty(group.serves) : '—';
    });
    const stats = $('ordForecastStats');
    if (stats) stats.innerHTML = forecastStatsHtml();
    const keep = $('ordKeepMix');
    if (keep) keep.hidden = locked() || !showKeepMix();
  }

  function productIdsForUpdates(updates) {
    const ids = new Set();
    (updates || []).forEach((update) => {
      if (update.productId) ids.add(update.productId);
      if (update.kind !== 'cocktail') return;
      const cocktail = ctx.cocktails.find((row) => row.id === update.itemId);
      (cocktail?.ingredients || []).forEach((ing) => {
        if (ing.product_id) ids.add(ing.product_id);
      });
    });
    return [...ids];
  }

  function rememberServes(updates) {
    (updates || []).forEach((update) => {
      if (update.kind === 'cocktail') {
        const cocktail = ctx.cocktails.find((row) => row.id === update.itemId);
        if (cocktail) cocktail.projected_serves = update.serves;
        return;
      }
      const list = ctx.items.get(update.productId) || [];
      const item = list.find((row) => row.id === update.itemId);
      if (item) item.projected_serves = update.serves;
    });
    productIdsForUpdates(updates).forEach((pid) => {
      (ctx.items.get(pid) || []).forEach((item) => { item.planned_qty_override = null; });
    });
  }

  async function persistServes(updates) {
    for (const update of updates || []) {
      if (update.kind === 'cocktail') {
        await updateEventCocktail(update.itemId, { projected_serves: update.serves });
      } else {
        await updateEventMenuItem(update.itemId, { projected_serves: update.serves });
      }
    }
    for (const pid of productIdsForUpdates(updates)) {
      await patchEventMenuItems(ctx.eventId, pid, { planned_qty_override: null });
    }
    recompute();
    const grid = $('ordGrid');
    if (grid) grid.innerHTML = gridHtml();
    const k = $('ordKpis');
    if (k) k.innerHTML = kpisHtml();
    refreshForecastOutputs();
    syncTheadHeight();
  }

  function tabsHtml() {
    const tab = ctx.tab;
    const count = ctx.orders.length ? ` (${ctx.orders.length})` : '';
    const button = (id, label) => `<button type="button" class="sales-tab${tab === id ? ' sales-tab--active' : ''}" data-ord-tab="${id}" role="tab" aria-selected="${tab === id}">${label}</button>`;
    return `
      <div class="sales-tabs ord-tabs" role="tablist">
        ${button('take', 'Projections')}
        ${button('orders', 'Purchase orders')}
        ${button('ledger', `Orders${count}`)}
      </div>`;
  }

  function searchPlaceholder() {
    if (ctx.tab === 'take') return 'Filter menu lines…';
    if (ctx.tab === 'ledger') return 'Filter purchase orders…';
    return 'Filter event products…';
  }

  function syncTabChrome() {
    setTopbarFilterSuppressed(ctx.tab !== 'orders');
    const input = document.querySelector('#topbarSearch .product-search-input');
    if (input) input.placeholder = searchPlaceholder();
  }

  function syncLedgerCount() {
    const ledgerTab = panel.querySelector('[data-ord-tab="ledger"]');
    if (!ledgerTab) return;
    const count = ctx.orders.length ? ` (${ctx.orders.length})` : '';
    ledgerTab.textContent = `Orders${count}`;
  }

  function setTab(tab) {
    if (tab !== 'take' && tab !== 'orders' && tab !== 'ledger') return;
    ctx.tab = tab;
    panel.querySelectorAll('[data-ord-tab]').forEach((btn) => {
      const on = btn.dataset.ordTab === tab;
      btn.classList.toggle('sales-tab--active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    syncLedgerCount();
    panel.querySelectorAll('[data-ord-pane]').forEach((pane) => {
      pane.hidden = pane.dataset.ordPane !== tab;
    });
    syncTabChrome();
    if (tab === 'orders') {
      const grid = $('ordGrid');
      if (grid) grid.innerHTML = gridHtml();
      syncTheadHeight();
    } else if (tab === 'ledger') {
      const list = $('ordList');
      if (list) list.innerHTML = ordersRailHtml();
    } else {
      const forecast = $('ordForecastBody');
      if (forecast) forecast.innerHTML = forecastBodyHtml();
      refreshForecastOutputs();
    }
  }

  function paint() {
    const tab = ctx.tab;
    panel.innerHTML = `
      <div class="ord-workspace">
        ${tabsHtml()}
        <div class="ord-tab-body" data-ord-pane="take" ${tab === 'take' ? '' : 'hidden'}>
          <section class="ord-take-head admin-surface">
            <div class="plan-settings" id="ordSettings">${settingsHtml()}</div>
            ${forecastHeadHtml()}
          </section>
          <div class="ord-forecast-wrap" id="ordForecastBody">${forecastBodyHtml()}</div>
        </div>
        <div class="ord-tab-body" data-ord-pane="orders" ${tab === 'orders' ? '' : 'hidden'}>
          <section class="plan-head admin-surface">
            <div class="plan-settings-meta">${lockChip()}<span class="plan-chip">Orders never change stock — only deliveries do</span></div>
            <div class="plan-kpis" id="ordKpis">${kpisHtml()}</div>
          </section>
          <div class="dist-grid-wrap plan-grid-wrap ord-grid-wrap">
            <table class="dist-grid plan-grid ord-grid" id="ordGrid">${gridHtml()}</table>
          </div>
        </div>
        <div class="ord-tab-body" data-ord-pane="ledger" ${tab === 'ledger' ? '' : 'hidden'}>
          <div class="ord-ledger" id="ordList">${ordersRailHtml()}</div>
        </div>
      </div>`;
    syncTabChrome();
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
    if (list) list.innerHTML = ordersRailHtml();
    syncLedgerCount();
    const forecast = $('ordForecastBody');
    if (forecast) forecast.innerHTML = forecastBodyHtml();
    refreshForecastOutputs();
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
    if (t.id === 'ordTarget') {
      const parsed = parsePlanningNumber(t.value, { max: 1000000000 });
      t.classList.toggle('is-invalid', !parsed.ok);
      if (!parsed.ok) return;
      ctx.target = parsed.value;
      if (ctx.event) ctx.event.target_revenue = parsed.value;
      refreshForecastOutputs();
      queueSave('target', async () => {
        await updateEventPricing(ctx.eventId, { target_revenue: ctx.target });
        invalidateEventCache(ctx.eventId);
      });
      return;
    }
    if (t.dataset.linePct) {
      const parsed = parsePlanningNumber(t.value, { max: 100.0001 });
      t.classList.toggle('is-invalid', !parsed.ok);
      if (!parsed.ok || !(Number(ctx.target) > 0)) return;
      const line = forecastLines().find((row) => row.key === t.dataset.linePct);
      if (!line || sellingPrice(line).price == null) return;
      const serves = servesFromMix(ctx.target, parsed.value ?? 0, sellingPrice(line).price);
      if (serves == null) return;
      const update = { ...line, serves };
      rememberServes([update]);
      ctx.anchorTarget = ctx.target;
      recompute();
      refreshForecastOutputs();
      const grid = $('ordGrid');
      if (grid) grid.innerHTML = gridHtml();
      const k = $('ordKpis');
      if (k) k.innerHTML = kpisHtml();
      const lineKey = line.key;
      queueSave(`mix:${lineKey}`, () => {
        const current = forecastLines().find((row) => row.key === lineKey);
        return current ? persistServes([{ ...current, serves: Number(current.projectedServes) || 0 }]) : Promise.resolve();
      });
      return;
    }
    if (t.dataset.catPct) {
      const parsed = parsePlanningNumber(t.value, { max: 100.0001 });
      t.classList.toggle('is-invalid', !parsed.ok);
      if (!parsed.ok || !(Number(ctx.target) > 0)) return;
      const category = t.dataset.catPct;
      const lines = forecastLines().filter((line) => (line.category || 'Uncategorised') === category);
      const updates = scaleCategoryServes(lines, parsed.value ?? 0, ctx.target);
      if (!updates.length) return;
      rememberServes(updates);
      ctx.anchorTarget = ctx.target;
      recompute();
      refreshForecastOutputs();
      const grid = $('ordGrid');
      if (grid) grid.innerHTML = gridHtml();
      const k = $('ordKpis');
      if (k) k.innerHTML = kpisHtml();
      const scaled = new Set(updates.map((row) => row.key));
      queueSave(`mix-cat:${category}`, () => {
        const current = forecastLines().filter((row) => scaled.has(row.key));
        return persistServes(current.map((row) => ({
          key: row.key,
          kind: row.kind,
          itemId: row.itemId,
          productId: row.productId,
          serves: Number(row.projectedServes) || 0,
        })));
      });
      return;
    }
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
      const list = ctx.items.get(pid) || [];
      if (!list.length) return;
      list.forEach((item) => { item.planned_qty_override = parsed.value; });
      recompute();
      const k = $('ordKpis');
      if (k) k.innerHTML = kpisHtml();
      refreshRowOutputs(pid);
      queueSave(`planned:${pid}`, () => patchEventMenuItems(ctx.eventId, pid, { planned_qty_override: parsed.value }));
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

  function openSupplierEmail(po, supplier) {
    const to = supplier?.email || '';
    const subject = `Purchase order ${po?.reference || ''}`.trim();
    const who = supplier?.name ? ` ${supplier.name}` : '';
    const body = `Hello${who},\n\nPlease find purchase order ${po?.reference || ''} attached.`;
    const el = openModal({
      title: 'Email supplier',
      bodyHtml: `
        <p class="ord-mix-note">The PDF will be attached. Sending from the app comes next.</p>
        <label class="admin-field">
          <span class="admin-label">To</span>
          <input class="admin-input" type="email" value="${escapeHtml(to)}" placeholder="No email on this supplier" disabled>
        </label>
        <label class="admin-field">
          <span class="admin-label">Subject</span>
          <input class="admin-input" type="text" value="${escapeHtml(subject)}" disabled>
        </label>
        <label class="admin-field">
          <span class="admin-label">Message</span>
          <textarea class="admin-input ord-notes" rows="5" disabled>${escapeHtml(body)}</textarea>
        </label>`,
      footHtml: `
        <div class="admin-modal-confirm-foot">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-cancel>Close</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" disabled>Send</button>
        </div>`,
    });
    el.querySelector('[data-cancel]').onclick = closeModal;
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

    const ev = ctx.event || {};
    const eventWhen = ev.start_date
      ? (ev.end_date && ev.end_date !== ev.start_date
        ? `${fmtDate(ev.start_date)} – ${fmtDate(ev.end_date)}`
        : fmtDate(ev.start_date))
      : '';
    const deliverLines = [ev.venue, ev.venue_postcode, eventWhen].filter(Boolean);
    const statusWhen = [
      po?.sent_at ? `Sent ${fmtDate(po.sent_at)}` : '',
      po?.confirmed_at ? `Confirmed ${fmtDate(po.confirmed_at)}` : '',
      po?.cancelled_at ? `Cancelled ${fmtDate(po.cancelled_at)}` : '',
    ].filter(Boolean);
    const dateDis = status === 'cancelled' || locked() ? 'disabled' : '';

    openSheet({
      title: isNew ? 'New purchase order' : `${po.reference}`,
      variant: 'admin-full',
      bodyHtml: `
        <article class="ord-doc">
          <header class="ord-doc-mast">
            <div class="ord-doc-ident">
              <h2 class="ord-doc-title">Purchase order</h2>
              <div class="ord-doc-mark" aria-hidden="true"></div>
              <div class="ord-doc-ref-row">
                ${isNew ? '' : `<span class="ord-doc-ref">${escapeHtml(po.reference)}</span>`}
                ${badge(meta)}
                ${statusWhen.length ? `<span class="ord-doc-when">${escapeHtml(statusWhen.join(' · '))}</span>` : ''}
              </div>
              <dl class="ord-doc-meta">
                <dt>Order date</dt>
                <dd><input type="date" class="ord-doc-field" id="ordDate" value="${escapeHtml(po?.order_date || today())}" ${hdis}></dd>
                <dt>Deliver by</dt>
                <dd><input type="date" class="ord-doc-field" id="ordDelivery" value="${escapeHtml(po?.delivery_date || ev.start_date || '')}" ${dateDis}></dd>
                <dt>Your ref</dt>
                <dd><input type="text" class="ord-doc-field" id="ordSupRef" maxlength="80" value="${escapeHtml(po?.supplier_ref || '')}" placeholder="Confirmation no." ${dateDis}></dd>
              </dl>
            </div>
            <address class="ord-doc-from">
              <img class="ord-doc-logo" src="/assets/img/logo.png" alt="Measured">
              <span>124 City Road</span>
              <span>London, EC1V 2NX</span>
              <span>live@measured.events</span>
              <span>measured.events</span>
            </address>
          </header>
          <div class="ord-doc-parties">
            <section>
              <h3>Supplier</h3>
              <div id="ordSupplierMount"></div>
              <div class="ord-doc-party-lines" id="ordSupplierDetail"></div>
            </section>
            <section>
              <h3>Deliver to</h3>
              <p class="ord-doc-party-name">${escapeHtml(ev.name || 'This event')}</p>
              <div class="ord-doc-party-lines">${deliverLines.map((l) => `<span>${escapeHtml(l)}</span>`).join('')}</div>
            </section>
          </div>
          <table class="ord-lines ord-doc-lines">
            <thead><tr>
              <th>Product</th>
              <th class="num" title="Cases the plan expects">QTY Required</th>
              <th class="num">Cases</th>
              <th class="num">Case price</th>
              <th class="num">Amount</th>
              <th></th>
            </tr></thead>
            <tbody id="ordLinesBody"></tbody>
          </table>
          ${editable ? '<div id="ordAddLine" class="ord-add-line"></div>' : ''}
          <div class="ord-doc-totals" id="ordLinesTotal"></div>
          <section class="ord-doc-notes-block">
            <h3>Notes</h3>
            <textarea class="ord-doc-notes" id="ordNotes" rows="2" maxlength="1000" placeholder="Shown on the purchase order" ${dateDis}>${escapeHtml(po?.notes || '')}</textarea>
          </section>
          <p class="plan-form-err" id="ordErr" hidden></p>
          ${isNew ? '' : '<details class="ord-history" id="ordHistory"><summary>History</summary><div class="ord-history-body muted">Loading…</div></details>'}
        </article>`,
      footHtml: `
        <div class="admin-drawer-foot ord-sheet-foot">
          ${!isNew && status === 'draft' && !locked() ? '<button type="button" class="admin-drawer-btn admin-drawer-btn--danger" id="ordDelete">Delete</button>' : ''}
          ${!isNew && status !== 'cancelled' && !locked() ? '<button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="ordCancel">Cancel order</button>' : ''}
          <span class="ord-foot-spacer"></span>
          ${!isNew ? `<button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="ordPdf">${icon('download', { size: 14 })} PDF</button>` : ''}
          ${!isNew ? `<button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="ordEmail">${icon('mail', { size: 14 })} Email supplier</button>` : ''}
          ${status !== 'cancelled' && !locked() ? '<button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="ordSave">Save</button>' : ''}
          ${editable && status === 'draft' ? '<button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="ordSent">Mark sent</button>' : ''}
          ${editable ? '<button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="ordConfirm">Confirm order</button>' : ''}
        </div>`,
    });
    $('sheet')?.classList.add('sheet--po');

    const err = $('ordErr');
    const showErr = (msg) => { err.textContent = msg; err.hidden = !msg; };

    function paintSupplierDetail() {
      const el = $('ordSupplierDetail');
      if (!el) return;
      const s = ctx.supplierById.get(state.supplierId);
      if (!s) {
        el.innerHTML = '<span class="muted">Who this order is for</span>';
        return;
      }
      const lines = [s.contact_name, s.email, s.phone, s.address].filter(Boolean);
      el.innerHTML = lines.length
        ? lines.map((line) => `<span>${escapeHtml(line)}</span>`).join('')
        : '<span class="muted">No contact details on file</span>';
    }

    mountSupplierSearch($('ordSupplierMount'), {
      suppliers: ctx.suppliers,
      value: state.supplierId,
      allowEmpty: false,
      dropdownFixed: true,
      hiddenId: 'ordSupplier',
      inputId: 'ordSupplierInput',
      inputClass: 'supplier-search-input ord-doc-field ord-doc-supplier',
      placeholder: 'Supplier name',
      onSelect: ({ supplierId } = {}) => {
        state.supplierId = supplierId || '';
        state.lines.forEach((l) => {
          if (l.case_price == null) {
            const offer = findOfferForSupplier(ctx.productById.get(l.product_id), state.supplierId);
            if (offer?.supplier_id === state.supplierId && offer.case_price != null) l.case_price = Number(offer.case_price);
          }
        });
        paintSupplierDetail();
        paintLines();
      },
    });
    if (!headerEditable) {
      const inp = $('ordSupplierInput');
      if (inp) inp.disabled = true;
    }
    paintSupplierDetail();

    function paintLines() {
      const body = $('ordLinesBody');
      if (!body) return;
      if (!state.lines.length) {
        body.innerHTML = '<tr><td colspan="6" class="muted ord-lines-empty">No lines yet — add a product below.</td></tr>';
      } else {
        body.innerHTML = state.lines.map((l, i) => {
          const p = ctx.productById.get(l.product_id);
          const row = ctx.rows.find((r) => r.productId === l.product_id);
          const pack = packLabel(p, state.supplierId);
          const amount = l.case_price != null && l.qty_cases != null ? Number(l.case_price) * Number(l.qty_cases) : null;
          return `<tr data-i="${i}">
            <td><span class="ord-line-product"><span class="ord-line-name">${escapeHtml(p?.name || 'Unknown')}</span>${pack ? `<span class="ord-doc-pack">${escapeHtml(pack)}</span>` : ''}</span></td>
            <td class="num muted">${row?.planned != null ? qty(row.planned) : '—'}</td>
            <td class="num"><input type="text" inputmode="decimal" class="num-math plan-cell-input ord-doc-qty" data-line-qty value="${escapeHtml(l.qty_cases ?? '')}" aria-label="Cases" ${dis}></td>
            <td class="num"><label class="ord-doc-money"><span>£</span><input type="text" inputmode="decimal" class="num-math plan-cell-input ord-doc-price" data-line-price value="${escapeHtml(l.case_price ?? '')}" aria-label="Case price" ${dis}></label></td>
            <td class="num ord-doc-amount" data-line-amount>${money(amount)}</td>
            <td>${editable ? `<button type="button" class="ord-line-remove" data-line-remove aria-label="Remove line">${icon('x', { size: 14 })}</button>` : ''}</td>
          </tr>`;
        }).join('');
      }
      paintTotal();
    }

    function paintTotal() {
      const t = orderLinesTotal(state.lines);
      const vat = orderValueVat(t.total);
      const vatPct = Math.round(vat.rate * 100);
      const cases = state.lines.reduce((s, l) => s + (Number(l.qty_cases) || 0), 0);
      const el = $('ordLinesTotal');
      if (!el) return;
      const unpriced = t.priced < t.lines
        ? `<div class="ord-doc-total"><span>Unpriced lines</span><strong>${t.lines - t.priced}</strong></div>`
        : '';
      el.innerHTML = `
        <div class="ord-doc-total"><span>Total cases</span><strong>${qty(cases)}</strong></div>
        ${unpriced}
        <div class="ord-doc-total"><span>Order value <em>ex VAT</em></span><strong>${money(t.total)}</strong></div>
        <div class="ord-doc-total"><span>VAT <em>${vatPct}%</em></span><strong>${money(vat.vat)}</strong></div>
        <div class="ord-doc-total ord-doc-total--due"><span>Order value <em>inc VAT</em></span><strong>${money(vat.inc)}</strong></div>`;
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
        placeholder: 'Add a product…',
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
        const sup = ctx.supplierById.get(h.supplier_id) || null;
        await generatePurchaseOrderPDF({
          po: { ...po, ...h },
          supplier: sup,
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
    on('ordEmail', () => {
      const h = readHeader();
      const sup = ctx.supplierById.get(h.supplier_id) || null;
      openSupplierEmail(po, sup);
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
        setTab('ledger');
        toast(`${made} draft order${made === 1 ? '' : 's'} created`);
      } catch (e2) {
        closeModal();
        await reloadOrders();
        toast(`${made} created — ${e2.message || 'generation failed'}`, true);
      }
    };
  }

  async function keepThisMix() {
    if (locked() || !showKeepMix()) return;
    const updates = keepMixServes(forecastLines(), ctx.anchorTarget, ctx.target);
    if (!updates.length) return;
    rememberServes(updates);
    ctx.anchorTarget = ctx.target;
    try {
      await persistServes(updates);
      toast('Serves scaled to the new target');
    } catch (err) {
      reportError(err, { source: 'admin.orders.keep-mix', silent: true });
      toast(err.message || 'Could not scale serves', true);
    }
  }

  function mixPreviewHtml(mix, fileName) {
    const lines = forecastLines();
    const byKey = new Map(lines.map((line) => [line.key, line]));
    const needsPrice = mix.lines.filter((row) => !sellingPrice(byKey.get(row.key) || {}).price);
    const cats = mix.categories.length
      ? `<ul class="ord-gen-list">${mix.categories.map((row) => `<li><strong>${escapeHtml(row.category)}</strong> — ${escapeHtml(pctInputValue(row.pct))}% · ${money(row.amount)}</li>`).join('')}</ul>`
      : '';
    const matched = mix.lines.length
      ? `<table class="ord-lines"><thead><tr><th>Line</th><th>Category</th><th class="num">Sales</th><th class="num">Mix</th></tr></thead><tbody>
        ${mix.lines.map((row) => `<tr><td>${escapeHtml(row.name)}${row.serveLabel ? ` · ${escapeHtml(row.serveLabel)}` : ''}</td><td>${escapeHtml(row.category)}</td><td class="num">${money(row.amount)}</td><td class="num">${escapeHtml(pctInputValue(row.pct))}%</td></tr>`).join('')}
        </tbody></table>`
      : '<p class="muted">Nothing in this file matched the menu.</p>';
    const labelOf = (row) => `${row.name}${row.variation && row.variation.toLowerCase() !== 'regular' ? ` (${row.variation})` : ''}`;
    const ambiguous = mix.unmatched.filter((row) => row.reason === 'ambiguous');
    const unknown = mix.unmatched.filter((row) => row.reason !== 'ambiguous');
    const listOf = (rows) => {
      const shown = rows.slice(0, 8).map(labelOf).join(', ');
      const more = rows.length > 8 ? ` and ${rows.length - 8} more` : '';
      return `${shown}${more}`;
    };
    const unmatched = [
      ambiguous.length ? `<p class="ord-mix-note">${escapeHtml(listOf(ambiguous))} ${ambiguous.length === 1 ? 'is' : 'are'} on the menu more than once, so the file could not choose a product.</p>` : '',
      unknown.length ? `<p class="ord-mix-note muted">${escapeHtml(pctInputValue(unknown.reduce((sum, row) => sum + row.pct, 0)))}% of the file is not on this menu: ${escapeHtml(listOf(unknown))}.</p>` : '',
    ].join('');
    const priceNote = needsPrice.length
      ? `<p class="ord-mix-note">${escapeHtml(needsPrice.map((row) => row.name).join(', '))} matched but ${needsPrice.length === 1 ? 'has' : 'have'} no price, so ${needsPrice.length === 1 ? 'it' : 'they'} will be skipped.</p>`
      : '';
    const fileTarget = matchedTakingsTarget(mix);
    const hasTarget = Number(ctx.target) > 0;
    const targetNote = hasTarget
      ? `<p class="ord-mix-note">This mix will be scaled to the current target of ${money(ctx.target)}.</p>`
      : (fileTarget
        ? `<p class="ord-mix-note">No target yet. Applying sets the target to ${money(fileTarget)} — the takings in this file that match the menu.</p>`
        : '<p class="ord-mix-note">Nothing in this file matched the menu, so there is no take to apply.</p>');
    return `
      <p class="ord-mix-note"><strong>${escapeHtml(fileName)}</strong> — ${escapeHtml(pctInputValue(mix.matchedPct))}% of ${money(mix.total)} matches the menu. Applying sets projected serves from that mix and clears planned-case overrides on those products.</p>
      ${targetNote}
      ${cats}
      <div class="ord-mix-preview">${matched}</div>
      ${unmatched}
      ${priceNote}`;
  }

  async function openCsvPreview(file) {
    let rows;
    try {
      rows = await readTillFile(file);
    } catch (err) {
      toast(err.message || 'Could not read that file', true);
      return;
    }
    const mix = mixFromSales(rows, forecastLines(), {
      recipes: ctx.recipes,
      products: ctx.products,
      caseSizes: ctx.caseSizes,
    });
    const lines = forecastLines();
    const fileTarget = matchedTakingsTarget(mix);
    const hasTarget = Number(ctx.target) > 0;
    const applyTarget = hasTarget ? Number(ctx.target) : fileTarget;
    const mixLines = hasTarget ? mix.lines : mixSharesOfMatched(mix.lines, applyTarget);
    const { applied } = applyTarget ? servesForMix(lines, mixLines, applyTarget) : { applied: [] };
    const replacing = applied.filter((update) => {
      const line = lines.find((row) => row.key === update.key);
      return line && Number(line.projectedServes) > 0;
    });
    const el = openModal({
      title: 'Sales mix',
      bodyHtml: mixPreviewHtml(mix, file.name || 'Sales file'),
      footHtml: `
        <div class="admin-modal-confirm-foot">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-cancel>Cancel</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-ok ${applied.length ? '' : 'disabled'}>${Number(ctx.target) > 0 ? (replacing.length ? 'Replace projected serves' : 'Apply mix') : 'Use this take'}</button>
        </div>`,
    });
    el.querySelector('[data-cancel]').onclick = closeModal;
    el.querySelector('[data-ok]').onclick = async () => {
      const btn = el.querySelector('[data-ok]');
      btn.disabled = true;
      try {
        await flushSaves();
        const fromFile = !(Number(ctx.target) > 0);
        let target = Number(ctx.target);
        let mixLines = mix.lines;
        if (fromFile) {
          target = matchedTakingsTarget(mix);
          if (!(target > 0)) throw new Error('Nothing in this file matched the menu');
          mixLines = mixSharesOfMatched(mix.lines, target);
          await updateEventPricing(ctx.eventId, { target_revenue: target });
          invalidateEventCache(ctx.eventId);
          ctx.target = target;
          ctx.anchorTarget = target;
          if (ctx.event) ctx.event.target_revenue = target;
          const input = $('ordTarget');
          if (input) input.value = String(target);
        }
        const fresh = servesForMix(forecastLines(), mixLines, target);
        if (!fresh.applied.length) throw new Error('No matched lines have a price');
        rememberServes(fresh.applied);
        ctx.anchorTarget = ctx.target;
        await persistServes(fresh.applied);
        closeModal();
        const skipped = fresh.skipped.length ? ` · ${fresh.skipped.length} skipped, no price` : '';
        const lead = fromFile ? `Target set to ${money(target)} · ` : '';
        toast(`${lead}Mix applied to ${fresh.applied.length} line${fresh.applied.length === 1 ? '' : 's'}${skipped}`);
      } catch (err) {
        btn.disabled = false;
        reportError(err, { source: 'admin.orders.csv-mix', silent: true });
        toast(err.message || 'Could not apply the mix', true);
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

  function onPanelFocusOut(e) {
    if (e.target.id !== 'ordTarget') return;
    if (!(Number(ctx.anchorTarget) > 0) && Number(ctx.target) > 0
      && forecastLines().some((line) => Number(line.projectedServes) > 0)) {
      ctx.anchorTarget = ctx.target;
    }
    refreshForecastOutputs();
  }

  function rememberPreferredSupplier(product, supplierId, offer) {
    const offers = product.product_suppliers || (product.product_suppliers = []);
    if (offer && !offers.some((row) => row.supplier_id === supplierId)) offers.push(offer);
    offers.forEach((row) => { row.is_preferred = row.supplier_id === supplierId; });
    const chosen = offers.find((row) => row.supplier_id === supplierId);
    product.supplier_id = supplierId;
    if (chosen?.case_price != null) product.case_price = chosen.case_price;
    if (chosen?.unit_price != null) product.unit_price = chosen.unit_price;
  }

  async function setOrderSupplier(productId, supplierId) {
    const product = ctx.productById.get(productId);
    if (!product || locked()) return;
    const previous = preferredSupplierId(product);
    if (!supplierId || supplierId === previous) return;
    const select = panel.querySelector(`[data-order-supplier="${CSS.escape(productId)}"]`);
    if (select) select.disabled = true;
    try {
      const DB = getDB();
      const existing = (product.product_suppliers || []).find((row) => row.supplier_id === supplierId);
      let offer = existing || null;
      if (existing?.id) {
        await DB.update('product_suppliers', `id=eq.${existing.id}`, { is_preferred: true });
      } else if (existing) {
        await DB.update('product_suppliers', `product_id=eq.${product.id}&supplier_id=eq.${supplierId}`, { is_preferred: true });
      } else {
        const current = (product.product_suppliers || []).find((row) => row.is_preferred)
          || (product.product_suppliers || [])[0]
          || null;
        offer = await DB.productSuppliers.create({
          product_id: product.id,
          supplier_id: supplierId,
          is_preferred: true,
          sku: current?.sku || product.sku || '',
          case_price: current?.case_price ?? product.case_price ?? null,
          unit_price: current?.unit_price ?? product.unit_price ?? null,
          pack_size: current?.pack_size || product.case_size || '',
          units_per_case: current?.units_per_case ?? product.units_per_case ?? null,
          ...(current?.purchase_case_size_id ? { purchase_case_size_id: current.purchase_case_size_id } : {}),
        });
        if (offer) offer.supplier = ctx.supplierById.get(supplierId) || null;
      }
      rememberPreferredSupplier(product, supplierId, offer);
      const supplierIds = new Set(ctx.rows.map((r) => preferredSupplierId(ctx.productById.get(r.productId))).filter(Boolean));
      setTableFilterContext('orders', {
        suppliers: [...supplierIds]
          .map((id) => ({ value: id, label: ctx.supplierById.get(id)?.name || 'Unknown' }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      });
      repaintBody();
    } catch (err) {
      reportError(err, { source: 'admin.orders.supplier', silent: true });
      toast(err.message || 'Could not change supplier', true);
      if (select) select.value = previous || '';
    } finally {
      const next = panel.querySelector(`[data-order-supplier="${CSS.escape(productId)}"]`);
      if (next) next.disabled = locked();
    }
  }

  function onPanelChange(e) {
    const supplierSelect = e.target.closest('[data-order-supplier]');
    if (supplierSelect) {
      void setOrderSupplier(supplierSelect.dataset.orderSupplier, supplierSelect.value);
      return;
    }
    if (e.target.id !== 'ordCsvFile') return;
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void openCsvPreview(file);
  }

  async function raiseForSupplier(supplierId) {
    if (locked()) { toast('Orders are locked for this event', true); return; }
    await flushSaves();
    const group = shortfallGroups().orders.find((row) => row.supplierId === supplierId);
    if (!group) { toast('Nothing left to order for this supplier'); return; }
    const draft = draftForSupplier(supplierId);
    if (draft) {
      const byProduct = new Map((draft.purchase_order_lines || []).map((line) => [line.product_id, {
        product_id: line.product_id,
        qty_cases: Number(line.qty_cases) || 0,
        case_price: line.case_price,
        notes: line.notes,
      }]));
      group.lines.forEach((line) => {
        const current = byProduct.get(line.product_id);
        if (current) current.qty_cases += line.qty_cases;
        else byProduct.set(line.product_id, { ...line });
      });
      await savePurchaseOrderLines(draft.id, [...byProduct.values()], draft.purchase_order_lines || []);
      toast(`Added to ${draft.reference}`);
      return;
    }
    const po = await createPurchaseOrder({
      event_id: ctx.eventId,
      supplier_id: supplierId,
      status: 'draft',
      order_date: today(),
      delivery_date: ctx.event?.start_date || null,
    });
    await savePurchaseOrderLines(po.id, group.lines, []);
    toast(`Raised ${po.reference || 'purchase order'}`);
  }

  async function markOrderSent(poId) {
    const po = ctx.orders.find((row) => row.id === poId);
    if (!po || locked()) return;
    if (!(po.purchase_order_lines || []).length) {
      toast('Add at least one line before sending', true);
      return;
    }
    await updatePurchaseOrder(po.id, { status: 'sent' });
    toast('Order marked as sent');
  }

  async function confirmOrderQuick(poId) {
    const po = ctx.orders.find((row) => row.id === poId);
    if (!po || locked()) return;
    if (!(po.purchase_order_lines || []).length) {
      toast('Add at least one line before confirming', true);
      return;
    }
    const ok = await confirmDialog({
      title: 'Confirm order',
      message: 'Confirming locks the lines as the supplier’s agreed quantities. Stock only changes when the delivery is counted in.',
      confirmLabel: 'Confirm order',
      danger: false,
    });
    if (!ok) return false;
    await confirmPurchaseOrder(po.id, po.supplier_ref || null);
    toast('Order confirmed');
    return true;
  }

  function onPanelClick(e) {
    const actionBtn = e.target.closest('[data-po-action]');
    if (actionBtn && panel.contains(actionBtn)) {
      e.stopPropagation();
      const action = actionBtn.dataset.poAction;
      const supplierId = actionBtn.dataset.supplierId;
      const poId = actionBtn.dataset.poId;
      actionBtn.disabled = true;
      const run = action === 'raise'
        ? raiseForSupplier(supplierId)
        : (action === 'sent' ? markOrderSent(poId) : confirmOrderQuick(poId));
      void run.then((changed) => {
        if (changed === false) {
          actionBtn.disabled = false;
          return null;
        }
        return reloadOrders();
      }).catch((err) => {
        actionBtn.disabled = false;
        reportError(err, { source: 'admin.orders.action', silent: true });
        toast(err.message || 'Something went wrong', true);
      });
      return;
    }
    if (e.target.closest('#ordImportCsv')) {
      if (locked()) { toast('Orders are locked for this event', true); return; }
      $('ordCsvFile')?.click();
      return;
    }
    if (e.target.closest('#ordKeepMix')) {
      void keepThisMix();
      return;
    }
    const gotoEl = e.target.closest('[data-goto]');
    if (gotoEl) {
      e.preventDefault();
      navigate({ view: 'event', eventId: ctx.eventId, panel: 'planning' });
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    const tabBtn = e.target.closest('[data-ord-tab]');
    if (tabBtn && panel.contains(tabBtn)) {
      setTab(tabBtn.dataset.ordTab);
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
    if (ctx.tab === 'take') {
      const forecast = $('ordForecastBody');
      if (forecast) forecast.innerHTML = forecastBodyHtml();
      refreshForecastOutputs();
      if (e.detail?.productId) {
        const line = forecastLines().find((row) => row.productId === e.detail.productId);
        if (line) {
          panel.querySelector(`tr[data-forecast-line="${CSS.escape(line.key)}"]`)?.scrollIntoView({ block: 'nearest' });
        }
      }
    } else if (ctx.tab === 'ledger') {
      const list = $('ordList');
      if (list) list.innerHTML = ordersRailHtml();
    } else {
      repaintBody();
      if (e.detail?.productId) {
        panel.querySelector(`tr[data-pid="${CSS.escape(e.detail.productId)}"]`)?.scrollIntoView({ block: 'nearest' });
      }
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
    const [event, pricing, items, orders, buffer, products, suppliers, caseSizes, categories, deliveries, cocktails, recipes] = await Promise.all([
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
      listEventCocktails(ctx.eventId).catch((err) => {
        if (isCocktailSchemaMissing(err)) return [];
        throw err;
      }),
      loadRecipesFull().catch(() => []),
    ]);
    if (ctx.abort) return;
    if (!event || !pricing) throw new Error('Event not found');
    ctx.event = event;
    ctx.pricing = pricing;
    ctx.items = groupMenuItems(items || []);
    ctx.cocktails = cocktails || [];
    ctx.orders = orders || [];
    ctx.buffer = buffer;
    ctx.recipes = recipes || [];
    const target = Number(event.target_revenue);
    ctx.target = Number.isFinite(target) && event.target_revenue != null && event.target_revenue !== '' ? target : null;
    ctx.anchorTarget = ctx.target;
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
  panel.addEventListener('focusout', onPanelFocusOut);
  panel.addEventListener('change', onPanelChange);
  panel.addEventListener('click', onPanelClick);
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  document.addEventListener(ADMIN_TABLE_FILTER, onTableFilter);
  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);

  reload().catch(onLoadError);

  return () => {
    ctx.abort = true;
    void flushSaves();
    panel.removeEventListener('input', onPanelInput);
    panel.removeEventListener('focusout', onPanelFocusOut);
    panel.removeEventListener('change', onPanelChange);
    panel.removeEventListener('click', onPanelClick);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
    document.removeEventListener(ADMIN_TABLE_FILTER, onTableFilter);
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
    setTopbarFilterSuppressed(false, { paint: false });
  };
}
