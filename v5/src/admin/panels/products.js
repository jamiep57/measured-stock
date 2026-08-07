/**
 * Event products + opening stock — single panel (catalogue, ordered, counted in, opening).
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import {
  getDB, loadEventFull, loadCaseSizes, loadCategories, loadLibraryProducts, loadSuppliers,
} from '../../db.js';
import { productStockPack } from '../../pack-metrics.js';
import {
  epOpeningFromSources,
  round1,
  countedInFromDeliveries,
  damagedFromDeliveries as damagedFromDeliveriesMap,
} from '../../lib/opening-stock.js';
import { mountProductSearch, productSupplierSearchText } from '../../components/product-search.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { loadingTableRow } from '../../components/loading-widget.js';
import { openProductFormSheet } from '../product-form-sheet.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import { parseQty } from '../../stock-entry.js';

function fmtNum(n) {
  if (n == null || n === '' || !Number.isFinite(Number(n))) return '—';
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
  const packLabel = pack.label || p.case_size || '';
  const cin = countedIn[pid] ?? (ep.delivered_qty != null ? Number(ep.delivered_qty) : 0);
  const ordered = Number(ep.qty_ordered) || 0;
  const opening = openingForProduct(pid, countedIn, damagedFromDeliveries, ep);
  const variance = round1(cin - ordered);
  const varCls = variance > 0 ? 'ep-var--pos' : variance < 0 ? 'ep-var--neg' : '';

  const orderedCell = editingOrderedId === pid
    ? `<td class="ep-num ep-cell--edit ep-prod-ordered" onclick="event.stopPropagation()">
        <input class="ep-ordered-input num-math" type="text" inputmode="decimal" autocomplete="off"
          id="epOrd-${escapeHtml(pid)}" value="${ep.qty_ordered != null ? escapeHtml(String(ep.qty_ordered)) : ''}"
          placeholder="—">
      </td>`
    : `<td class="ep-num ep-cell--edit ep-prod-ordered ep-prod-ordered--edit" data-pid="${escapeHtml(pid)}" title="Edit ordered">${fmtNum(ordered)}</td>`;

  return `
    <tr class="ep-prod-row" data-pid="${escapeHtml(pid)}" data-product-name="${escapeHtml((p.name || '').toLowerCase())}" tabindex="0" role="button" title="Edit product">
      <th class="ep-sticky ep-col-item" scope="row">
        <div class="ep-item">
          <div class="ep-item-top">
            <span class="ep-item-name" title="${escapeHtml(p.name || 'Product')}">${escapeHtml(p.name || 'Product')}</span>
          </div>
          ${packLabel ? `<span class="ep-item-meta">${escapeHtml(packLabel)}</span>` : ''}
        </div>
      </th>
      ${orderedCell}
      <td class="ep-num ep-counted" data-pid="${escapeHtml(pid)}">${fmtNum(cin)}</td>
      <td class="ep-num ep-var ${varCls}" data-pid="${escapeHtml(pid)}">${variance > 0 ? '+' : ''}${fmtNum(variance)}</td>
      <td class="ep-num ep-num--emphasis ep-opening ep-group-start" data-pid="${escapeHtml(pid)}">${fmtNum(opening)}</td>
    </tr>`;
}

function renderRows(eps, countedIn, damagedFromDeliveries, caseSizes, editingOrderedId) {
  if (!eps.length) return '';
  const grouped = groupByCategory(eps);
  let html = '';
  Object.keys(grouped).sort().forEach((cat) => {
    html += `<tr class="dist-cat-row">
      <td class="dist-cat-pinned"><span class="dist-bar-name">${escapeHtml(cat)}</span></td>
      <td colspan="4" class="dist-cat-scroll"></td>
    </tr>`;
    grouped[cat].forEach((ep) => {
      html += renderProductRow(ep, countedIn, damagedFromDeliveries, caseSizes, editingOrderedId);
    });
  });
  return html;
}

function countedInMap(deliveries, event, caseSizes) {
  return countedInFromDeliveries(deliveries, event?.event_products, caseSizes);
}

function openingForProduct(pid, countedIn, damagedFromDeliveries, ep) {
  return epOpeningFromSources(ep, countedIn, damagedFromDeliveries);
}

function epTh(label, extraClass = '', title = '') {
  const tip = title || label;
  return `<th class="ep-th ${extraClass}" title="${escapeHtml(tip)}">
    <div class="dist-bar-head"><span class="dist-bar-name">${escapeHtml(label)}</span></div>
  </th>`;
}

function renderShell() {
  return `
    <div class="ep-panel">
      <p class="ep-hint muted">Add products from your library and set ordered quantities. <strong>Counted in</strong> and unusable stock come from deliveries; <strong>opening</strong> = counted in − delivery damages.</p>
      <div class="dist-grid-wrap ep-table-wrap">
        <table class="dist-grid ep-grid" id="epTable">
          <thead>
            <tr class="ep-head-row">
              ${epTh('Product', 'ep-sticky ep-col-item ep-th--item')}
              ${epTh('Ordered', 'ep-num ep-th--edit')}
              ${epTh('Counted in', 'ep-num', 'Counted in from deliveries')}
              ${epTh('Variance', 'ep-num', 'Counted in − ordered')}
              ${epTh('Opening', 'ep-num ep-group-start ep-th--emphasis', 'Opening stock')}
            </tr>
          </thead>
          <tbody id="epBody">
            ${loadingTableRow(5, 'Loading products…')}
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
      const hay = [
        p.name, p.sku, p.case_size, p.category?.name,
        productSupplierSearchText(p),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function paintTable() {
    const eps = filteredEps();
    const body = $('epBody');
    const empty = $('epEmpty');
    const table = $('epTable');
    if (!body) return;

    if (!(event?.event_products || []).some((ep) => ep.product?.name)) {
      body.innerHTML = '';
      empty.hidden = false;
      table?.setAttribute('hidden', '');
      return;
    }

    empty.hidden = true;
    table?.removeAttribute('hidden');
    body.innerHTML = renderRows(eps, countedIn, damagedFromDeliveries, caseSizes, editingOrderedId) ||
      '<tr><td colspan="5" class="dist-empty">No products match your filter.</td></tr>';

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
        const qty = raw === '' ? 0 : parseQty(raw);
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
    const varLabel = `${variance > 0 ? '+' : ''}${fmtNum(variance)}`;

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
    $('epBody').innerHTML = `<tr><td colspan="5" class="dist-empty del-empty--err">${escapeHtml(err.message || 'Failed to load')}</td></tr>`;
  });

  return () => {
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  };
}
