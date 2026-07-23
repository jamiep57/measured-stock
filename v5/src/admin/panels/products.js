/**
 * Event products + opening stock — single panel (catalogue, ordered, counted in, opening).
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import {
  getDB, loadEventFull, loadCaseSizes, loadCategories, loadLibraryProducts, loadSuppliers,
} from '../../db.js';
import { productStockPack } from '../../pack-metrics.js';
import {
  storedToForm, totalUnitsForProduct, parseQty,
} from '../../stock-entry.js';
import { epOpeningStock, round1 } from '../../lib/opening-stock.js';
import { mountProductSearch } from '../../components/product-search.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { openProductFormSheet } from '../product-form-sheet.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';

function fmtNum(n) {
  if (n == null || !Number.isFinite(Number(n)) || Number(n) === 0) return '—';
  const v = round1(Number(n));
  return Number.isInteger(v) ? String(v) : String(v);
}

function groupByCategory(eps) {
  const grouped = {};
  eps.forEach((ep) => {
    const cat = ep.product?.category?.name || 'Uncategorised';
    (grouped[cat] = grouped[cat] || []).push(ep);
  });
  Object.values(grouped).forEach((list) => {
    list.sort((a, b) => (a.product.name || '').localeCompare(b.product.name || ''));
  });
  return grouped;
}

function renderProductRow(ep, countedIn, damagedFromDeliveries, caseSizes, editingOrderedId) {
  const p = ep.product || {};
  const pid = ep.product_id;
  const pack = productStockPack(p, caseSizes);
  const cin = countedIn[pid] ?? (ep.delivered_qty != null ? Number(ep.delivered_qty) : 0);
  const ordered = Number(ep.qty_ordered) || 0;
  const opening = openingForProduct(pid, countedIn, damagedFromDeliveries, ep);
  const variance = round1(cin - ordered);
  const varCls = variance > 0 ? 'ep-var--pos' : variance < 0 ? 'ep-var--neg' : '';

  const orderedCell = editingOrderedId === pid
    ? `<td class="ep-prod-num ep-prod-ordered" onclick="event.stopPropagation()">
        <input class="ep-ordered-input" type="text" id="epOrd-${escapeHtml(pid)}" value="${ep.qty_ordered != null ? escapeHtml(String(ep.qty_ordered)) : ''}">
      </td>`
    : `<td class="ep-prod-num ep-prod-ordered ep-prod-ordered--edit" data-pid="${escapeHtml(pid)}" title="Edit ordered">${fmtNum(ordered)}</td>`;

  return `
    <tr class="dist-prod-row ep-prod-row" data-pid="${escapeHtml(pid)}" data-product-name="${escapeHtml((p.name || '').toLowerCase())}" tabindex="0" role="button" title="Edit product">
      <th class="dist-sticky dist-prod-name" scope="row">${escapeHtml(p.name || 'Product')}</th>
      <td class="dist-sticky dist-prod-pack muted">${escapeHtml(pack.label || p.case_size || '—')}</td>
      ${orderedCell}
      <td class="ep-prod-num ep-counted" data-pid="${escapeHtml(pid)}">${fmtNum(cin)}</td>
      <td class="ep-prod-num ep-var ${varCls}" data-pid="${escapeHtml(pid)}">${variance > 0 ? '+' : ''}${fmtNum(variance)}</td>
      <td class="ep-prod-num ep-opening" data-pid="${escapeHtml(pid)}">${fmtNum(opening)}</td>
    </tr>`;
}

function renderRows(eps, countedIn, damagedFromDeliveries, caseSizes, editingOrderedId) {
  if (!eps.length) return '';
  const grouped = groupByCategory(eps);
  let html = '';
  Object.keys(grouped).sort().forEach((cat) => {
    html += `<tr class="dist-cat-row">
      <td colspan="6" class="dist-cat-pinned"><span class="dist-bar-name">${escapeHtml(cat)}</span></td>
    </tr>`;
    grouped[cat].forEach((ep) => {
      html += renderProductRow(ep, countedIn, damagedFromDeliveries, caseSizes, editingOrderedId);
    });
  });
  return html;
}

function deliveryLineCases(line, product, caseSizes) {
  if (!product) return parseQty(line.qty);
  const form = storedToForm(line);
  return totalUnitsForProduct(form.cases, form.singles, product, caseSizes);
}

function countedInMap(deliveries, event, caseSizes) {
  const map = {};
  (deliveries || []).forEach((d) => {
    (d.lines || []).forEach((l) => {
      if (!l.product_id) return;
      const p = event?.event_products?.find((ep) => ep.product_id === l.product_id)?.product;
      map[l.product_id] = round1((map[l.product_id] || 0) + deliveryLineCases(l, p, caseSizes));
    });
  });
  return map;
}

function damagedFromDeliveriesMap(deliveries) {
  const map = {};
  (deliveries || []).forEach((d) => {
    (d.lines || []).forEach((l) => {
      if (!l.product_id) return;
      map[l.product_id] = round1((map[l.product_id] || 0) + parseQty(l.damaged_qty));
    });
  });
  return map;
}

function openingForProduct(pid, countedIn, damagedFromDeliveries, ep) {
  const cin = countedIn[pid] ?? (ep?.delivered_qty != null ? Number(ep.delivered_qty) : 0);
  const dmg = damagedFromDeliveries[pid] ?? 0;
  return epOpeningStock({ delivered_qty: cin, damaged_qty: dmg });
}

function renderShell() {
  return `
    <div class="ep-panel">
      <div class="ep-stats" id="epStats">
        <div class="wst-stat"><span class="wst-stat-label">Products</span><span class="wst-stat-value" id="epStatProducts">—</span></div>
        <div class="wst-stat"><span class="wst-stat-label">Cases ordered</span><span class="wst-stat-value" id="epStatOrdered">—</span></div>
        <div class="wst-stat"><span class="wst-stat-label">Counted in</span><span class="wst-stat-value" id="epStatCounted">—</span></div>
        <div class="wst-stat"><span class="wst-stat-label">Opening stock</span><span class="wst-stat-value" id="epStatOpening">—</span></div>
      </div>
      <p class="ep-hint muted">Add products from your library and set ordered quantities. <strong>Counted in</strong> and unusable stock come from deliveries; <strong>opening</strong> = counted in − delivery damages.</p>
      <div class="dist-grid-wrap ep-grid-wrap">
        <table class="dist-grid ep-grid" id="epTable">
          <thead>
            <tr>
              <th class="dist-sticky dist-col-header dist-col-product">
                <div class="dist-bar-head dist-bar-head--left"><span class="dist-bar-name">Product</span></div>
              </th>
              <th class="dist-sticky dist-col-header dist-col-pack">
                <div class="dist-bar-head"><span class="dist-bar-name">Pack</span></div>
              </th>
              <th class="dist-col-header ep-col-num">
                <div class="dist-bar-head"><span class="dist-bar-name">Ordered</span></div>
              </th>
              <th class="dist-col-header ep-col-num">
                <div class="dist-bar-head"><span class="dist-bar-name">Counted in</span></div>
              </th>
              <th class="dist-col-header ep-col-num">
                <div class="dist-bar-head"><span class="dist-bar-name">Variance</span></div>
              </th>
              <th class="dist-col-header ep-col-num">
                <div class="dist-bar-head"><span class="dist-bar-name">Opening</span></div>
              </th>
            </tr>
          </thead>
          <tbody id="epBody">
            <tr><td colspan="6" class="dist-empty muted">Loading…</td></tr>
          </tbody>
        </table>
        <div class="dist-empty ep-empty" id="epEmpty" hidden>No products on this event yet. Use <strong>Add product</strong> in the toolbar.</div>
      </div>
    </div>`;
}

export function renderProductsShell() {
  return renderShell();
}

export function mountProductsPanel(route) {
  const eventId = route.eventId;
  if (!eventId) return () => {};

  let event = null;
  let caseSizes = [];
  let library = [];
  let categories = [];
  let suppliers = [];
  let deliveries = [];
  let countedIn = {};
  let damagedFromDeliveries = {};
  let productFilter = getLastProductFilter();
  let editingOrderedId = null;

  function filteredEps() {
    const eps = (event?.event_products || [])
      .filter((ep) => ep.product?.name);
    const q = (productFilter.query || '').trim().toLowerCase();
    if (productFilter.productId) {
      return eps.filter((ep) => ep.product_id === productFilter.productId);
    }
    if (!q) return eps;
    return eps.filter((ep) => {
      const p = ep.product;
      const hay = [p.name, p.sku, p.case_size, p.category?.name].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function paintStats(eps) {
    const ordered = eps.reduce((s, ep) => s + (Number(ep.qty_ordered) || 0), 0);
    let counted = 0;
    let opening = 0;
    eps.forEach((ep) => {
      const cin = countedIn[ep.product_id] ?? (ep.delivered_qty != null ? Number(ep.delivered_qty) : 0);
      counted += cin;
      opening += openingForProduct(ep.product_id, countedIn, damagedFromDeliveries, ep);
    });
    $('epStatProducts').textContent = String(eps.length);
    $('epStatOrdered').textContent = fmtNum(ordered);
    $('epStatCounted').textContent = fmtNum(counted);
    $('epStatOpening').textContent = fmtNum(opening);
  }

  function paintTable() {
    const eps = filteredEps();
    const body = $('epBody');
    const empty = $('epEmpty');
    const table = $('epTable');
    if (!body) return;

    paintStats(event?.event_products?.filter((ep) => ep.product?.name) || []);

    if (!(event?.event_products || []).some((ep) => ep.product?.name)) {
      body.innerHTML = '';
      empty.hidden = false;
      table?.setAttribute('hidden', '');
      return;
    }

    empty.hidden = true;
    table?.removeAttribute('hidden');
    body.innerHTML = renderRows(eps, countedIn, damagedFromDeliveries, caseSizes, editingOrderedId) ||
      '<tr><td colspan="6" class="dist-empty">No products match your filter.</td></tr>';

    if (editingOrderedId) {
      const inp = $(`epOrd-${editingOrderedId}`);
      inp?.focus();
      inp?.select();
    }

    body.querySelectorAll('.ep-prod-ordered--edit').forEach((cell) => {
      cell.onclick = (e) => {
        e.stopPropagation();
        editingOrderedId = cell.dataset.pid;
        paintTable();
      };
    });

    body.querySelectorAll('.ep-prod-row[data-pid]').forEach((row) => {
      row.onclick = (e) => {
        if (e.target.closest('.ep-prod-ordered, .ep-ordered-input')) return;
        openEditProduct(row.dataset.pid);
      };
      row.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openEditProduct(row.dataset.pid);
        }
      };
    });

    const ordInp = editingOrderedId ? $(`epOrd-${editingOrderedId}`) : null;
    if (ordInp) {
      const saveOrd = async () => {
        const pid = editingOrderedId;
        const raw = ordInp.value.trim();
        const qty = raw === '' ? 0 : (parseFloat(raw) || 0);
        try {
          await getDB().eventProducts.setForEvent(eventId, pid, { qty_ordered: qty });
          const ep = event.event_products.find((x) => x.product_id === pid);
          if (ep) ep.qty_ordered = qty;
          editingOrderedId = null;
          paintTable();
        } catch (err) {
          toast(err.message || 'Save failed', true);
        }
      };
      ordInp.onkeydown = (e) => {
        if (e.key === 'Enter') saveOrd();
        if (e.key === 'Escape') { editingOrderedId = null; paintTable(); }
      };
      ordInp.onblur = saveOrd;
    }
  }

  async function refresh() {
    [event, caseSizes, library, categories, suppliers, deliveries] = await Promise.all([
      loadEventFull(eventId),
      loadCaseSizes(),
      loadLibraryProducts(),
      loadCategories(),
      loadSuppliers(),
      getDB().deliveries.forEvent(eventId).catch(() => []),
    ]);
    countedIn = countedInMap(deliveries, event, caseSizes);
    damagedFromDeliveries = damagedFromDeliveriesMap(deliveries);
    paintTable();
  }

  function openEditProduct(productId) {
    const ep = (event?.event_products || []).find((x) => x.product_id === productId);
    if (!ep?.product) return;

    const p = ep.product;
    // Prefer full library row (offers) when available
    const full = library.find((x) => x.id === productId) || p;
    const cin = countedIn[productId] ?? (ep.delivered_qty != null ? Number(ep.delivered_qty) : 0);
    const ordered = Number(ep.qty_ordered) || 0;
    const opening = openingForProduct(productId, countedIn, damagedFromDeliveries, ep);
    const variance = round1(cin - ordered);
    const varLabel = variance === 0 ? '—' : `${variance > 0 ? '+' : ''}${fmtNum(variance)}`;

    openProductFormSheet({
      product: full,
      categories,
      suppliers,
      caseSizes,
      allowDelete: false,
      eventContext: {
        qtyOrdered: ep.qty_ordered,
        countedIn: fmtNum(cin),
        variance: varLabel,
        opening: fmtNum(opening),
        onSaveOrdered: async (qty) => {
          await getDB().eventProducts.setForEvent(eventId, productId, { qty_ordered: qty });
        },
        onRemoveFromEvent: async () => {
          const DB = getDB();
          if (typeof DB.eventProducts.removeFromEvent === 'function') {
            await DB.eventProducts.removeFromEvent(eventId, productId);
          } else {
            await DB.eventProducts.removeForEvent(eventId, productId);
          }
          await refresh();
        },
      },
      onSaved: async () => { await refresh(); },
    });
  }

  function openAddProduct() {
    const onEvent = new Set((event?.event_products || []).map((ep) => ep.product_id));
    const available = library.filter((p) => !onEvent.has(p.id));

    openSheet({
      title: 'Add product to event',
      variant: 'admin-full',
      bodyHtml: '<div id="epAddSearch"></div>',
      footHtml: `
        <div class="admin-drawer-foot">
          <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="epAddCancel">Cancel</button>
        </div>`,
    });

    mountProductSearch($('epAddSearch'), {
      products: available,
      categories,
      caseSizes,
      placeholder: 'Search library to add…',
      onSelect: async ({ productId }) => {
        try {
          await getDB().eventProducts.setForEvent(eventId, productId, { qty_ordered: 0 });
          closeSheet();
          await refresh();
          toast('Product added to event');
        } catch (err) {
          toast(err.message || 'Add failed', true);
        }
      },
    });
    $('epAddCancel').onclick = closeSheet;
  }

  const onProductFilter = (e) => {
    productFilter = e.detail || {};
    paintTable();
    if (e.detail?.productId) e.detail.handled = true;
  };

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'add-event-product') {
      e.detail.handled = true;
      openAddProduct();
    }
  };

  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);

  refresh().catch((err) => {
    $('epBody').innerHTML = `<tr><td colspan="6" class="dist-empty del-empty--err">${escapeHtml(err.message || 'Failed to load')}</td></tr>`;
  });

  return () => {
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  };
}
