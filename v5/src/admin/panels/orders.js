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
  createForecastImport,
  deleteForecastImport,
  isCocktailSchemaMissing,
  isEventPricingLocked,
  isForecastSchemaMissing,
  isPlanningSchemaMissing,
  listEventCocktails,
  listForecastImports,
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
  orderPayable,
  orderVatFigures,
  orderedByProduct,
  plannedProductCases,
  preferredSupplierId,
} from '../../lib/order-compare.js';
import { letterheadLines, loadLetterhead } from '../../lib/document-from.js';
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
import { formatWhat3Words } from '../../lib/delivery-details.js';
import { readTillFile } from '../../lib/till-import.js';
import { bindMapLinePicks, closeMapLineMenu, salesWizardBody, salesWizardFoot } from '../order-sales-wizard.js';
import {
  buildForecastLines,
  forecastFromImports,
  forecastTotals,
  groupForecastLines,
  groupSalesItems,
  importLinesFromMix,
  keepMixServes,
  mixFromSales,
  plannedOrderCost,
  scaleCategoryServes,
  sellingPrice,
  servesForMix,
  servesFromMix,
  suggestSaleMappings,
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
    imports: [],
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
      .reduce((sum, po) => sum + orderPayable(po.purchase_order_lines, po.delivery_cost).net, 0);
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
      <button type="button" class="topbar-tool" aria-label="Raise PO" title="${escapeHtml(raiseTitle)}" ${raiseAttrs}>${icon('shopping-cart', { size: 16 })}</button>
      <button type="button" class="topbar-tool" aria-label="Confirm order" title="${escapeHtml(confirmTitle)}" ${confirmAttrs}>${icon('clipboard-check', { size: 16 })}</button>
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
      ? rows.map((r) => rowHtml(r)).join('')
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

  function shortWhen(d) {
    if (!d) return '';
    const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
    if (!y || !m || !day) return '';
    const dt = new Date(y, m - 1, day);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: y === new Date().getFullYear() ? undefined : 'numeric',
    });
  }

  function orderBucket(status) {
    if (status === 'sent' || status === 'confirmed' || status === 'cancelled') return status;
    return 'draft';
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
    if (po.status === 'draft') {
      buttons.push(`<button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-po-action="sent" data-po-id="${escapeHtml(po.id)}" ${needsLine}>Mark sent</button>`);
    }
    if (po.status === 'draft' || po.status === 'sent') {
      buttons.push(`<button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-po-action="confirm" data-po-id="${escapeHtml(po.id)}" ${needsLine}>Confirm</button>`);
    }
    if (po.status === 'draft') {
      buttons.push(`<button type="button" class="topbar-tool" data-po-action="delete" data-po-id="${escapeHtml(po.id)}" aria-label="Delete order" title="Delete order">${icon('trash', { size: 14 })}</button>`);
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

  function orderValue(po) {
    return orderPayable(po.purchase_order_lines, po.delivery_cost).net;
  }

  function orderCardHtml(po) {
    const sup = ctx.supplierById.get(po.supplier_id);
    const t = orderLinesTotal(po.purchase_order_lines);
    const cases = (po.purchase_order_lines || []).reduce((s, l) => s + Number(l.qty_cases || 0), 0);
    const actions = orderActionButtons(po);
    const bucket = orderBucket(po.status);
    const deliver = shortWhen(po.delivery_date);
    const slot = po.delivery_time === 'am' || po.delivery_time === 'pm' ? po.delivery_time.toUpperCase() : '';
    const deliverLabel = deliver ? `Deliver ${deliver}${slot ? `, ${slot}` : ''}` : '';
    const unpriced = t.lines > t.priced ? `${t.lines - t.priced} unpriced` : '';
    const caseCount = Number(cases);
    const bits = [
      po.reference || 'New order',
      `${t.lines} line${t.lines === 1 ? '' : 's'}`,
      `${qty(cases)} case${caseCount === 1 ? '' : 's'}`,
      deliverLabel,
      unpriced,
    ].filter(Boolean);
    const meta = bits.map((bit, i) => {
      const cls = i === 0 ? ' class="ord-rail-ref"' : '';
      return `<span${cls}>${escapeHtml(bit)}</span>`;
    }).join('');
    const unnamed = !sup?.name;
    const net = orderValue(po);
    const amount = t.lines > 0 && t.priced === 0 && !(Number(po.delivery_cost) > 0)
      ? '<p class="ord-rail-amount ord-rail-amount--empty" title="No prices on this order">—</p>'
      : `<p class="ord-rail-amount">${money(net)}</p>`;
    const cancelled = bucket === 'cancelled' ? '<p class="ord-rail-cancelled">Cancelled</p>' : '';
    return `<article class="ord-rail-row ord-rail-row--${bucket}${bucket === 'cancelled' ? ' ord-rail-row--cancelled' : ''}" data-open-po="${escapeHtml(po.id)}">
      <div class="ord-rail-ident">
        <h3 class="ord-rail-sup${unnamed ? ' ord-rail-sup--empty' : ''}">${escapeHtml(sup?.name || 'Unknown supplier')}</h3>
        <p class="ord-rail-meta">${meta}</p>
        ${cancelled}
      </div>
      <div class="ord-rail-side">
        ${amount}
        ${actions ? `<div class="ord-rail-actions">${actions}</div>` : ''}
      </div>
    </article>`;
  }

  function ordersRailHtml() {
    const q = ctx.query.trim();
    const matched = ctx.orders.slice().reverse().filter(orderMatchesQuery);
    if (!matched.length) {
      const title = q ? 'No matching orders' : 'No purchase orders yet';
      const copy = q
        ? 'Nothing in this list matches that search.'
        : 'Generate orders for every shortfall, or start a new order.';
      return `<div class="ord-ledger-empty">
        <p class="ord-ledger-empty-title">${title}</p>
        <p class="ord-ledger-empty-copy">${copy}</p>
      </div>`;
    }

    const buckets = [
      { id: 'draft', label: 'Draft' },
      { id: 'sent', label: 'Sent' },
      { id: 'confirmed', label: 'Confirmed' },
      { id: 'cancelled', label: 'Cancelled' },
    ].map((group) => {
      const rows = matched.filter((po) => orderBucket(po.status) === group.id);
      const total = rows.reduce((sum, po) => sum + orderValue(po), 0);
      return { ...group, rows, total };
    });

    const stats = buckets.filter((group) => group.id !== 'cancelled' || group.rows.length);
    const summary = `<div class="ord-ledger-summary" aria-label="Order totals">${stats.map((group) => {
      const n = group.rows.length;
      const value = n ? money(group.total) : '—';
      const sub = `${group.label} · ${n}`;
      return `<div class="ord-ledger-stat${n ? '' : ' is-empty'}">
        <span class="ord-ledger-stat-value">${value}</span>
        <span class="ord-ledger-stat-label">${escapeHtml(sub)}</span>
      </div>`;
    }).join('')}</div>`;

    const sections = buckets.filter((group) => group.rows.length).map((group) => {
      const n = group.rows.length;
      return `<section class="ord-ledger-group">
        <header class="ord-ledger-group-head">
          <h2 class="ord-ledger-group-label">${escapeHtml(group.label)}</h2>
          <p class="ord-ledger-group-meta">${n} ${n === 1 ? 'order' : 'orders'} · ${money(group.total)}</p>
        </header>
        <div class="ord-ledger-stack">${group.rows.map(orderCardHtml).join('')}</div>
      </section>`;
    }).join('');

    return summary + sections;
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

  function importChipsInner() {
    const imports = ctx.imports || [];
    if (!imports.length) return '';
    const chips = imports.map((row) => `
      <span class="ord-import-chip">${escapeHtml(row.name)}
        <button type="button" data-remove-import="${escapeHtml(row.id)}" aria-label="${escapeHtml(`Remove ${row.name}`)}" ${locked() ? 'disabled' : ''}>×</button>
      </span>`).join('');
    const note = imports.length === 1
      ? 'Import another sales file to average it with this one.'
      : `The forecast is the average of these ${imports.length} imports.`;
    return `${chips}<span class="ord-import-note muted">${note}</span>`;
  }

  function syncImportChrome() {
    const slot = $('ordImports');
    if (slot) slot.innerHTML = importChipsInner();
    const btn = $('ordImportCsv');
    if (btn) btn.textContent = (ctx.imports || []).length ? 'Import another' : 'Import sales CSV';
  }

  function forecastHeadHtml() {
    const dis = locked() ? 'disabled' : '';
    const importLabel = (ctx.imports || []).length ? 'Import another' : 'Import sales CSV';
    return `
      <div class="ord-forecast-head">
        <label class="admin-field plan-field">
          <span class="admin-label">Target revenue (£)</span>
          <input type="text" inputmode="decimal" autocomplete="off" class="admin-input num-math" id="ordTarget"
            value="${escapeHtml(ctx.target != null ? String(ctx.target) : '')}" placeholder="e.g. 350000" ${dis}>
        </label>
        <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="ordKeepMix" ${showKeepMix() && !locked() ? '' : 'hidden'}>Keep this mix</button>
        <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="ordImportCsv" ${dis}>${importLabel}</button>
        <input type="file" id="ordCsvFile" accept=".csv,.tsv,.xlsx,.xls,.txt" hidden>
      </div>
      <div class="ord-import-row" id="ordImports">${importChipsInner()}</div>
      <p class="ord-forecast-note muted">Each line’s share of the target, divided by its menu price. A blank price uses the price needed to hit the target GP. Import a sales file and name it. Import another and the forecast is the average of every named import. With no target yet, the average of the mapped takings becomes the target.</p>
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

  function zeroServeUpdates(menuLines, keys) {
    const byKey = new Map((menuLines || []).map((line) => [line.key, line]));
    return [...new Set(keys || [])].map((key) => {
      const line = byKey.get(key);
      if (!line || !(Number(line.projectedServes) > 0)) return null;
      return {
        key: line.key,
        kind: line.kind,
        itemId: line.itemId,
        productId: line.productId || null,
        serves: 0,
      };
    }).filter(Boolean);
  }

  async function applyAveragedForecast(imports, { dropKeys = [] } = {}) {
    const menuLines = forecastLines();
    const hasTarget = Number(ctx.target) > 0;
    const preview = forecastFromImports(imports, { fallbackTarget: hasTarget ? Number(ctx.target) : null });
    const covered = new Set();
    let applied = [];
    let skipped = [];
    if (preview.lines.length && preview.target > 0) {
      const fresh = servesForMix(menuLines, preview.lines, preview.target);
      applied = fresh.applied;
      skipped = fresh.skipped;
      applied.forEach((row) => covered.add(row.key));
    }
    const zeros = zeroServeUpdates(menuLines, dropKeys.filter((key) => !covered.has(key)));
    const updates = [...applied, ...zeros];
    if (imports.length && !applied.length) throw new Error('No mapped lines have a price');
    if (!hasTarget && preview.target > 0 && imports.length) {
      await updateEventPricing(ctx.eventId, { target_revenue: preview.target });
      invalidateEventCache(ctx.eventId);
      ctx.target = preview.target;
      if (ctx.event) ctx.event.target_revenue = preview.target;
      const input = $('ordTarget');
      if (input) input.value = String(preview.target);
    }
    if (updates.length) {
      rememberServes(updates);
      ctx.anchorTarget = ctx.target;
      await persistServes(updates);
    }
    syncImportChrome();
    return { applied, skipped, target: preview.target, fromFile: !hasTarget && imports.length };
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
            ${lockChip() ? `<div class="plan-settings-meta">${lockChip()}</div>` : ''}
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
      includeVat: po?.include_vat !== false,
      deliveryCost: po?.delivery_cost == null || po?.delivery_cost === '' ? null : Number(po.delivery_cost),
      deliveryInvalid: false,
    };
    const status = po?.status || 'draft';
    const editable = !locked() && (status === 'draft' || status === 'sent');
    const headerEditable = !locked() && status !== 'confirmed' && status !== 'cancelled';
    const dis = editable ? '' : 'disabled';
    const hdis = headerEditable ? '' : 'disabled';
    const meta = STATUS_META[status];

    const ev = ctx.event || {};
    const collection = ev.end_date || ev.start_date || '';
    const contactBits = [ev.delivery_contact_name, ev.delivery_contact_phone].filter(Boolean);
    const deliverLines = [
      ev.venue,
      ev.venue_postcode,
      formatWhat3Words(ev.what3words),
      contactBits.length ? `On site  ${contactBits.join(' · ')}` : '',
    ].filter(Boolean);
    const factLink = ev.delivery_fact_sheet_url
      ? `<a class="ord-doc-fact" href="${escapeHtml(ev.delivery_fact_sheet_url)}" target="_blank" rel="noopener noreferrer">${icon('file-text', { size: 14 })} ${escapeHtml(ev.delivery_fact_sheet_name || 'Delivery fact sheet')}</a>`
      : '';
    const statusWhen = [
      po?.sent_at ? `Sent ${fmtDate(po.sent_at)}` : '',
      po?.confirmed_at ? `Confirmed ${fmtDate(po.confirmed_at)}` : '',
      po?.cancelled_at ? `Cancelled ${fmtDate(po.cancelled_at)}` : '',
    ].filter(Boolean);
    const dateDis = status === 'cancelled' || locked() ? 'disabled' : '';
    const fromLines = letterheadLines(await loadLetterhead());

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
                <dt>Delivery date</dt>
                <dd class="ord-doc-slot-row">
                  <input type="date" class="ord-doc-field" id="ordDelivery" value="${escapeHtml(po?.delivery_date || ev.start_date || '')}" ${dateDis}>
                  <select class="ord-doc-field ord-doc-slot" id="ordDeliveryTime" aria-label="Delivery time" ${dateDis}>
                    <option value="">AM/PM</option>
                    <option value="am"${po?.delivery_time === 'am' ? ' selected' : ''}>AM</option>
                    <option value="pm"${po?.delivery_time === 'pm' ? ' selected' : ''}>PM</option>
                  </select>
                </dd>
                <dt>Collection date</dt>
                <dd class="ord-doc-slot-row">
                  <input type="date" class="ord-doc-field" id="ordCollection" value="${escapeHtml(collection)}" disabled>
                  <select class="ord-doc-field ord-doc-slot" id="ordCollectionTime" aria-label="Collection time" ${dateDis}>
                    <option value="">AM/PM</option>
                    <option value="am"${po?.collection_time === 'am' ? ' selected' : ''}>AM</option>
                    <option value="pm"${po?.collection_time === 'pm' ? ' selected' : ''}>PM</option>
                  </select>
                </dd>
                <dt>Your ref</dt>
                <dd><input type="text" class="ord-doc-field" id="ordSupRef" maxlength="80" value="${escapeHtml(po?.supplier_ref || '')}" placeholder="Confirmation no." ${dateDis}></dd>
              </dl>
            </div>
            <address class="ord-doc-from">
              <img class="ord-doc-logo" src="/assets/img/logo.png" alt="Measured">
              ${fromLines.map((line) => `<span>${escapeHtml(line)}</span>`).join('')}
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
              <div class="ord-doc-party-lines">${deliverLines.map((l) => `<span>${escapeHtml(l)}</span>`).join('')}${factLink}</div>
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

    function payableNow() {
      return orderPayable(state.lines, state.deliveryCost);
    }

    function valueRowsHtml() {
      const vat = orderVatFigures(payableNow().net, state.includeVat);
      const vatPct = Math.round(vat.rate * 100);
      return vat.includeVat
        ? `<div class="ord-doc-total"><span>Order value <em>ex VAT</em></span><strong>${money(vat.ex)}</strong></div>
        <div class="ord-doc-total"><span>VAT <em>${vatPct}%</em></span><strong>${money(vat.vat)}</strong></div>
        <div class="ord-doc-total ord-doc-total--due"><span>Order value <em>inc VAT</em></span><strong>${money(vat.inc)}</strong></div>`
        : `<div class="ord-doc-total ord-doc-total--due"><span>Order value</span><strong>${money(vat.ex)}</strong></div>`;
    }

    function paintTotal() {
      const t = orderLinesTotal(state.lines);
      const cases = state.lines.reduce((s, l) => s + (Number(l.qty_cases) || 0), 0);
      const el = $('ordLinesTotal');
      if (!el) return;
      const unpriced = t.priced < t.lines
        ? `<div class="ord-doc-total"><span>Unpriced lines</span><strong>${t.lines - t.priced}</strong></div>`
        : '';
      const vatSwitch = `
        <div class="ord-doc-total ord-doc-vat">
          <span>VAT</span>
          <button type="button" class="access-switch${state.includeVat ? ' is-on' : ''}${editable ? '' : ' is-locked'}" id="ordVat" role="switch" aria-checked="${state.includeVat ? 'true' : 'false'}" aria-label="Include VAT" ${editable ? '' : 'disabled'}>
            <span class="access-switch-knob"></span>
          </button>
        </div>`;
      const deliveryLabel = state.includeVat ? 'Delivery cost <em>ex VAT</em>' : 'Delivery cost';
      el.innerHTML = `
        ${vatSwitch}
        <div class="ord-doc-total"><span>Total cases</span><strong>${qty(cases)}</strong></div>
        ${unpriced}
        <div class="ord-doc-total">
          <span>${deliveryLabel}</span>
          <label class="ord-doc-money"><span>£</span><input type="text" inputmode="decimal" class="num-math plan-cell-input" id="ordDeliveryCost" value="${escapeHtml(state.deliveryCost ?? '')}" aria-label="Delivery cost" ${dis}></label>
        </div>
        <div class="ord-doc-value-rows">${valueRowsHtml()}</div>`;
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
    $('ordLinesTotal')?.addEventListener('input', (e) => {
      if (e.target.id !== 'ordDeliveryCost') return;
      const parsed = parsePlanningNumber(e.target.value, { max: 1000000 });
      e.target.classList.toggle('is-invalid', !parsed.ok);
      state.deliveryInvalid = !parsed.ok;
      if (!parsed.ok) return;
      state.deliveryCost = parsed.value;
      const rows = $('ordLinesTotal')?.querySelector('.ord-doc-value-rows');
      if (rows) rows.innerHTML = valueRowsHtml();
    });
    $('ordLinesTotal')?.addEventListener('click', (e) => {
      if (!editable || !e.target.closest('#ordVat')) return;
      const next = !state.includeVat;
      state.includeVat = next;
      paintTotal();
      if (!po?.id) return;
      updatePurchaseOrder(po.id, { include_vat: next }).then((saved) => {
        if (saved) po = { ...po, ...saved, include_vat: next };
      }).catch((err) => {
        state.includeVat = !next;
        paintTotal();
        showErr(err.message || 'Could not update VAT');
      });
    });
    paintLines();

    function readHeader() {
      return {
        supplier_id: state.supplierId || $('ordSupplier')?.value || null,
        order_date: $('ordDate')?.value || null,
        delivery_date: $('ordDelivery')?.value || null,
        delivery_time: $('ordDeliveryTime')?.value || null,
        collection_time: $('ordCollectionTime')?.value || null,
        supplier_ref: $('ordSupRef')?.value.trim() || null,
        notes: $('ordNotes')?.value.trim() || null,
        include_vat: state.includeVat,
        delivery_cost: state.deliveryCost,
      };
    }

    function validate() {
      const h = readHeader();
      if (!h.supplier_id) return 'Choose a supplier';
      if (!h.order_date) return 'Order date is required';
      if (state.deliveryInvalid) return 'Delivery cost needs a number';
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
        saved = await updatePurchaseOrder(po.id, { delivery_date: h.delivery_date, delivery_time: h.delivery_time, collection_time: h.collection_time, supplier_ref: h.supplier_ref, notes: h.notes });
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
      else if ((r.changed_cols || []).includes('include_vat')) what = r.new_data?.include_vat === false ? 'VAT turned off' : 'VAT turned on';
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

  async function openCsvPreview(file) {
    let rows;
    try {
      rows = await readTillFile(file);
    } catch (err) {
      toast(err.message || 'Could not read that file', true);
      return;
    }
    const lines = forecastLines();
    const items = groupSalesItems(rows);
    if (!items.length) {
      toast('No item sales in that file', true);
      return;
    }
    const matchOptions = {
      recipes: ctx.recipes,
      products: ctx.products,
      caseSizes: ctx.caseSizes,
    };
    const suggestions = suggestSaleMappings(items, lines, matchOptions);
    const mappings = Object.fromEntries(suggestions.map((row) => [
      row.saleKey,
      (row.confidence === 'auto' || row.confidence === 'suggest') ? (row.lineKey || '') : '',
    ]));
    const state = {
      step: suggestions.length && suggestions.every((row) => row.confidence === 'auto') ? 'name' : 'map',
      filter: Object.values(mappings).some((value) => !value) ? 'todo' : 'all',
      query: '',
      name: '',
      manual: new Set(),
      mappings,
    };

    function mappedMix(menuLines) {
      return mixFromSales(rows, menuLines, { ...matchOptions, mappings: state.mappings });
    }

    function previewImports(mix) {
      return [...(ctx.imports || []), {
        name: state.name.trim(),
        total: mix.matchedAmount || 0,
        lines: importLinesFromMix(mix),
      }];
    }

    function applyPlan(menuLines = lines) {
      const mix = mappedMix(menuLines);
      const hasTarget = Number(ctx.target) > 0;
      const preview = forecastFromImports(previewImports(mix), {
        fallbackTarget: hasTarget ? Number(ctx.target) : null,
      });
      const { applied } = preview.target > 0 ? servesForMix(menuLines, preview.lines, preview.target) : { applied: [] };
      return { mix, hasTarget, preview, applied };
    }

    function viewModel() {
      const plan = applyPlan();
      const others = (ctx.imports || []).length;
      return {
        step: state.step,
        fileName: file.name || 'Sales file',
        importName: state.name,
        savedImports: ctx.imports || [],
        items,
        lines,
        mappings: state.mappings,
        manual: [...state.manual],
        suggestions,
        query: state.query,
        filter: state.filter,
        mix: plan.mix,
        previewTarget: plan.preview.target,
        target: Number(ctx.target) || 0,
        hasTarget: plan.hasTarget,
        canApply: importLinesFromMix(plan.mix).length > 0 && plan.applied.length > 0 && Boolean(state.name.trim()),
        applyLabel: others ? 'Average into forecast' : 'Save import',
      };
    }

    const el = openModal({
      title: 'Import sales',
      tall: true,
      bodyHtml: '<div></div>',
      footHtml: '<div></div>',
      onClose: () => closeMapLineMenu(),
    });

    function paint() {
      closeMapLineMenu();
      const queryFocused = document.activeElement?.matches?.('[data-map-query]');
      const nameFocused = document.activeElement?.matches?.('[data-import-name]');
      const caret = (queryFocused || nameFocused) ? document.activeElement.selectionStart : null;
      const scroll = el.querySelector('[data-map-list]')?.scrollTop || 0;
      const model = viewModel();
      el.querySelector('.admin-modal-body').innerHTML = salesWizardBody(model);
      el.querySelector('.admin-modal-foot').innerHTML = salesWizardFoot(model);
      const list = el.querySelector('[data-map-list]');
      if (list) list.scrollTop = scroll;
      const input = el.querySelector('[data-map-query]');
      if (queryFocused && input) {
        input.focus();
        const pos = caret ?? input.value.length;
        input.setSelectionRange(pos, pos);
      }
      const nameInput = el.querySelector('[data-import-name]');
      if (nameInput && !queryFocused) {
        nameInput.focus();
        const pos = nameFocused ? (caret ?? nameInput.value.length) : nameInput.value.length;
        nameInput.setSelectionRange(pos, pos);
      }
      bindWizard();
    }

    function goTo(step) {
      const mapped = Object.values(state.mappings).some(Boolean);
      if ((step === 'name' || step === 'review') && !mapped) return;
      if (step === 'review' && !state.name.trim()) {
        if (state.step !== 'name') {
          state.step = 'name';
          paint();
        }
        return;
      }
      if (step === state.step) return;
      state.step = step;
      paint();
    }

    async function applyMappedMix() {
      const btn = el.querySelector('[data-ok]');
      if (btn) btn.disabled = true;
      const name = state.name.trim();
      try {
        if (!name) throw new Error('Name this import');
        if (name.length > 80) throw new Error('Keep the name under 80 characters');
        await flushSaves();
        const mix = mappedMix(forecastLines());
        const stored = importLinesFromMix(mix);
        if (!stored.length) throw new Error('Nothing in this file is mapped to the menu');
        let saved;
        try {
          saved = await createForecastImport({
            event_id: ctx.eventId,
            name,
            total: mix.matchedAmount || 0,
            lines: stored,
          });
        } catch (err) {
          if (isForecastSchemaMissing(err)) {
            throw new Error('Sales imports are not set up on this project yet', { cause: err });
          }
          throw err;
        }
        const previous = ctx.imports || [];
        ctx.imports = [...previous, saved];
        let result;
        try {
          result = await applyAveragedForecast(ctx.imports);
        } catch (err) {
          ctx.imports = previous;
          await deleteForecastImport(saved.id).catch(() => {});
          throw err;
        }
        closeModal();
        const count = ctx.imports.length;
        const skipped = result.skipped.length ? ` · ${result.skipped.length} skipped, no price` : '';
        const lead = result.fromFile ? `Target set to ${money(result.target)} · ` : '';
        const tail = count === 1
          ? `${name} saved`
          : `${name} averaged with ${count - 1} other import${count === 2 ? '' : 's'}`;
        toast(`${lead}${tail}${skipped}`);
      } catch (err) {
        if (btn) btn.disabled = false;
        reportError(err, { source: 'admin.orders.csv-mix', silent: true });
        toast(err.message || 'Could not save the import', true);
      }
    }

    function bindWizard() {
      el.querySelector('[data-cancel]')?.addEventListener('click', closeModal);
      el.querySelector('[data-next]')?.addEventListener('click', () => goTo(state.step === 'map' ? 'name' : 'review'));
      el.querySelector('[data-back]')?.addEventListener('click', () => goTo(state.step === 'review' ? 'name' : 'map'));
      el.querySelector('[data-ok]')?.addEventListener('click', () => { void applyMappedMix(); });
      el.querySelector('[data-map-auto]')?.addEventListener('click', () => {
        let filled = 0;
        suggestions.forEach((row) => {
          if (state.manual.has(row.saleKey) || state.mappings[row.saleKey]) return;
          if (row.confidence !== 'guess' || !row.lineKey) return;
          state.mappings[row.saleKey] = row.lineKey;
          filled += 1;
        });
        if (filled) state.filter = 'all';
        paint();
        toast(filled
          ? `Lined up ${filled} product${filled === 1 ? '' : 's'}`
          : 'Nothing else lined up. Choose the rest by hand.');
      });
      el.querySelectorAll('[data-map-goto]').forEach((btn) => {
        btn.addEventListener('click', () => goTo(btn.dataset.mapGoto));
      });
      el.querySelectorAll('[data-map-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (state.filter === btn.dataset.mapFilter) return;
          state.filter = btn.dataset.mapFilter;
          paint();
        });
      });
      const query = el.querySelector('[data-map-query]');
      if (query) {
        query.addEventListener('input', () => {
          state.query = query.value;
          paint();
        });
      }
      const name = el.querySelector('[data-import-name]');
      if (name) {
        name.addEventListener('input', () => {
          state.name = name.value;
          paint();
        });
      }
      bindMapLinePicks(el, {
        lines,
        onPick: (saleKey, lineKey) => {
          state.manual.add(saleKey);
          state.mappings[saleKey] = lineKey;
          paint();
        },
      });
    }

    paint();
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

  async function deleteOrderQuick(poId) {
    const po = ctx.orders.find((row) => row.id === poId);
    if (!po || locked() || po.status !== 'draft') return false;
    const ok = await confirmDialog({
      title: 'Delete order',
      message: `Delete ${po.reference}? This can’t be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return false;
    await deletePurchaseOrder(po.id);
    toast('Order deleted');
    return true;
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

  async function onPanelClick(e) {
    const actionBtn = e.target.closest('[data-po-action]');
    if (actionBtn && panel.contains(actionBtn)) {
      e.stopPropagation();
      const action = actionBtn.dataset.poAction;
      const supplierId = actionBtn.dataset.supplierId;
      const poId = actionBtn.dataset.poId;
      actionBtn.disabled = true;
      const run = action === 'raise'
        ? raiseForSupplier(supplierId)
        : action === 'sent'
          ? markOrderSent(poId)
          : action === 'delete'
            ? deleteOrderQuick(poId)
            : confirmOrderQuick(poId);
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
    const removeImport = e.target.closest('[data-remove-import]');
    if (removeImport && panel.contains(removeImport)) {
      if (locked()) { toast('Orders are locked for this event', true); return; }
      const id = removeImport.dataset.removeImport;
      const imp = (ctx.imports || []).find((row) => row.id === id);
      if (!imp) return;
      const others = (ctx.imports || []).length - 1;
      const ok = await confirmDialog({
        title: 'Remove import',
        message: others
          ? `Remove ${imp.name}? The forecast is averaged again without it.`
          : `Remove ${imp.name}? Projected serves from this import are cleared.`,
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
      try {
        await flushSaves();
        const dropKeys = (imp.lines || []).map((line) => line.key);
        await deleteForecastImport(id);
        ctx.imports = (ctx.imports || []).filter((row) => row.id !== id);
        await applyAveragedForecast(ctx.imports, { dropKeys });
        toast(`Removed ${imp.name}`);
      } catch (err) {
        reportError(err, { source: 'admin.orders.remove-import', silent: true });
        toast(err.message || 'Could not remove that import', true);
        void reload();
      }
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
    const [event, pricing, items, orders, buffer, products, suppliers, caseSizes, categories, deliveries, cocktails, recipes, imports] = await Promise.all([
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
      listForecastImports(ctx.eventId).catch((err) => {
        if (isForecastSchemaMissing(err)) return [];
        throw err;
      }),
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
    ctx.imports = imports || [];
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
