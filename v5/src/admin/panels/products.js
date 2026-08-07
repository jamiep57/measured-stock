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
import { createGridCollabSession } from '../../lib/collab-presence.js';
import {
  productsCellKeyFromInput,
  productsFindCellEl,
} from '../../lib/grid-collab-keys.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import {
  ADMIN_TABLE_FILTER,
  getTableFilterValues,
} from '../table-filter.js';
import { parseQty } from '../../stock-entry.js';
import { emptyState, errorState, bindEmptyRetry } from '../../components/empty-state.js';
import { reportError } from '../../lib/client-errors.js';

const SAVE_DEBOUNCE_MS = 400;
const VALUE_BROADCAST_MS = 120;
const LOCAL_ECHO_MS = 3000;

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

function sortEventProducts(eps, sort) {
  const items = eps.slice();
  if (sort === 'name') {
    items.sort((a, b) => (a.product.name || '').localeCompare(b.product.name || ''));
  } else if (sort === 'name-desc') {
    items.sort((a, b) => (b.product.name || '').localeCompare(a.product.name || ''));
  } else {
    items.sort((a, b) => {
      const ca = a.product?.category?.name || 'Uncategorised';
      const cb = b.product?.category?.name || 'Uncategorised';
      const catCmp = ca.localeCompare(cb);
      if (catCmp) return catCmp;
      return (a.product.name || '').localeCompare(b.product.name || '');
    });
  }
  return items;
}

function renderProductRow(ep, countedIn, damagedFromDeliveries, caseSizes) {
  const p = ep.product || {};
  const pid = ep.product_id;
  const pack = productStockPack(p, caseSizes);
  const packLabel = pack.label || p.case_size || '';
  const cin = countedIn[pid] ?? (ep.delivered_qty != null ? Number(ep.delivered_qty) : 0);
  const ordered = Number(ep.qty_ordered) || 0;
  const opening = openingForProduct(pid, countedIn, damagedFromDeliveries, ep);
  const variance = round1(cin - ordered);
  const varCls = variance > 0 ? 'ep-var--pos' : variance < 0 ? 'ep-var--neg' : '';
  const orderedShown = ep.qty_ordered != null && ep.qty_ordered !== ''
    ? String(ep.qty_ordered)
    : '';

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
      <td class="ep-num ep-cell--edit ep-prod-ordered">
        <input class="ep-ordered-input num-math" type="text" inputmode="decimal" autocomplete="off"
          id="epOrd-${escapeHtml(pid)}" value="${escapeHtml(orderedShown)}"
          data-pid="${escapeHtml(pid)}"
          placeholder="—" aria-label="Ordered quantity">
      </td>
      <td class="ep-num ep-counted" data-pid="${escapeHtml(pid)}">${fmtNum(cin)}</td>
      <td class="ep-num ep-var ${varCls}" data-pid="${escapeHtml(pid)}" id="epVar-${escapeHtml(pid)}">${variance > 0 ? '+' : ''}${fmtNum(variance)}</td>
      <td class="ep-num ep-num--emphasis ep-opening ep-group-start" data-pid="${escapeHtml(pid)}" id="epOpen-${escapeHtml(pid)}">${fmtNum(opening)}</td>
    </tr>`;
}

function renderRows(eps, countedIn, damagedFromDeliveries, caseSizes, sort = 'category') {
  if (!eps.length) return '';
  let html = '';
  if (sort === 'name' || sort === 'name-desc') {
    sortEventProducts(eps, sort).forEach((ep) => {
      html += renderProductRow(ep, countedIn, damagedFromDeliveries, caseSizes);
    });
    return html;
  }
  const grouped = groupByCategory(eps);
  Object.keys(grouped).sort().forEach((cat) => {
    html += `<tr class="dist-cat-row">
      <td class="dist-cat-pinned"><span class="dist-bar-name">${escapeHtml(cat)}</span></td>
      <td colspan="4" class="dist-cat-scroll"></td>
    </tr>`;
    grouped[cat].forEach((ep) => {
      html += renderProductRow(ep, countedIn, damagedFromDeliveries, caseSizes);
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
    <div class="ep-panel" id="epPanel">
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
        <div class="dist-empty ep-empty" id="epEmpty" hidden>
          ${emptyState({
            icon: 'package',
            title: 'No products on this event yet',
            copy: 'Use Add product in the toolbar to get started.',
            variant: 'admin',
            className: 'empty--inline',
          })}
        </div>
      </div>
    </div>`;
}

export function renderProductsShell() {
  return renderShell();
}

export function mountProductsPanel(route) {
  const eventId = route.eventId;
  if (!eventId) return () => {};

  const panel = $('epPanel') || $('epBody')?.closest('.ep-panel');
  let collab = null;
  let event = null;
  let caseSizes = [];
  let library = [];
  let categories = [];
  let suppliers = [];
  let deliveries = [];
  let countedIn = {};
  let damagedFromDeliveries = {};
  let productFilter = getLastProductFilter();
  let categoriesFilter = [];
  let sortKey = 'category';
  /** @type {Record<string, ReturnType<typeof setTimeout>>} */
  const saveTimers = {};
  /** @type {Record<string, boolean>} */
  const dirty = {};
  /** @type {Map<string, number>} */
  const recentLocalWrites = new Map();
  let valueBroadcastTimer = null;
  let focusPid = null;
  let abort = false;

  const seeded = getTableFilterValues('products');
  if (seeded) {
    categoriesFilter = Array.isArray(seeded.categories) ? [...seeded.categories] : [];
    sortKey = seeded.sort || 'category';
  }

  function stopCollab() {
    if (valueBroadcastTimer) {
      clearTimeout(valueBroadcastTimer);
      valueBroadcastTimer = null;
    }
    const session = collab;
    collab = null;
    session?.destroy();
  }

  function startCollab() {
    if (!panel || collab || abort) return;
    collab = createGridCollabSession({
      channelName: `collab:products:${eventId}`,
      root: panel,
      inputSelector: '.ep-ordered-input',
      cellKeyFromInput: productsCellKeyFromInput,
      findCellEl: productsFindCellEl,
      onLocalFocusChange: (key) => {
        focusPid = key ? String(key).split('::')[0] || null : null;
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
            table: 'event_products',
            filter: `event_id=eq.${eventId}`,
          },
          (payload) => handleRemoteOrderedChange(payload),
        );
      },
      extraBroadcastPayload: () => {
        let value;
        if (focusPid) {
          const el = document.getElementById(`epOrd-${focusPid}`);
          if (el) value = el.value;
        }
        return { value, productId: focusPid, field: 'ordered' };
      },
    });
  }

  function filteredEps() {
    let eps = (event?.event_products || [])
      .filter((ep) => ep.product?.name);
    if (categoriesFilter.length) {
      const allowed = new Set(categoriesFilter);
      eps = eps.filter((ep) => {
        const cat = ep.product?.category?.name || 'Uncategorised';
        return allowed.has(cat);
      });
    }
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

  function updateDerivedCells(pid) {
    const ep = (event?.event_products || []).find((x) => x.product_id === pid);
    if (!ep) return;
    const cin = countedIn[pid] ?? (ep.delivered_qty != null ? Number(ep.delivered_qty) : 0);
    const ordered = Number(ep.qty_ordered) || 0;
    const variance = round1(cin - ordered);
    const opening = openingForProduct(pid, countedIn, damagedFromDeliveries, ep);
    const varEl = document.getElementById(`epVar-${pid}`);
    const openEl = document.getElementById(`epOpen-${pid}`);
    if (varEl) {
      varEl.textContent = `${variance > 0 ? '+' : ''}${fmtNum(variance)}`;
      varEl.classList.toggle('ep-var--pos', variance > 0);
      varEl.classList.toggle('ep-var--neg', variance < 0);
    }
    if (openEl) openEl.textContent = fmtNum(opening);
  }

  function paintTable({ preserveFocus = false } = {}) {
    const eps = filteredEps();
    const body = $('epBody');
    const empty = $('epEmpty');
    const table = $('epTable');
    if (!body) return;

    const active = preserveFocus && document.activeElement?.matches?.('.ep-ordered-input')
      ? {
        id: document.activeElement.id,
        start: document.activeElement.selectionStart,
        end: document.activeElement.selectionEnd,
      }
      : null;

    if (!(event?.event_products || []).some((ep) => ep.product?.name)) {
      body.innerHTML = '';
      empty.hidden = false;
      table?.setAttribute('hidden', '');
      return;
    }

    empty.hidden = true;
    table?.removeAttribute('hidden');
    body.innerHTML = renderRows(eps, countedIn, damagedFromDeliveries, caseSizes, sortKey) ||
      '<tr><td colspan="5" class="dist-empty">No products match your filter.</td></tr>';
    collab?.repaint();

    body.querySelectorAll('.ep-prod-row[data-pid]').forEach((row) => {
      row.onclick = (e) => {
        if (e.target.closest('.ep-prod-ordered, .ep-ordered-input')) return;
        openEditProduct(row.dataset.pid);
      };
      row.onkeydown = (e) => {
        if (e.target?.matches?.('.ep-ordered-input')) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openEditProduct(row.dataset.pid);
        }
      };
    });

    if (active?.id) {
      const inp = document.getElementById(active.id);
      if (inp) {
        inp.focus();
        try {
          inp.setSelectionRange(active.start ?? inp.value.length, active.end ?? inp.value.length);
        } catch { /* ignore */ }
      }
    }
  }

  function scheduleValueBroadcast() {
    if (!collab?.isReady() || !focusPid) return;
    clearTimeout(valueBroadcastTimer);
    valueBroadcastTimer = setTimeout(() => {
      valueBroadcastTimer = null;
      const el = document.getElementById(`epOrd-${focusPid}`);
      const value = el ? el.value : undefined;
      collab?.broadcastFocus({
        live: true,
        value,
        productId: focusPid,
        field: 'ordered',
      });
    }, VALUE_BROADCAST_MS);
  }

  function applyRemoteDraftValue(payload) {
    if (!payload?.productId || payload.field !== 'ordered') return;
    if (payload.value == null) return;
    if (dirty[payload.productId]) return;
    if (focusPid === payload.productId) return;
    const el = document.getElementById(`epOrd-${payload.productId}`);
    if (!el || document.activeElement === el) return;
    if (el.value === String(payload.value)) return;
    el.value = String(payload.value);
    const ep = (event?.event_products || []).find((x) => x.product_id === payload.productId);
    if (ep) {
      const raw = String(payload.value).trim();
      ep.qty_ordered = raw === '' ? 0 : parseQty(raw);
      updateDerivedCells(payload.productId);
    }
  }

  function handleRemoteOrderedChange(payload) {
    if (abort) return;
    const remote = payload?.new || payload?.old;
    if (!remote?.product_id) return;
    const pid = remote.product_id;

    if (payload.eventType === 'DELETE') {
      event.event_products = (event.event_products || []).filter((ep) => ep.product_id !== pid);
      paintTable({ preserveFocus: true });
      return;
    }

    if (dirty[pid] || focusPid === pid) return;
    const writtenAt = recentLocalWrites.get(pid) || 0;
    if (Date.now() - writtenAt < LOCAL_ECHO_MS) return;

    let ep = (event?.event_products || []).find((x) => x.product_id === pid);
    if (!ep) {
      // Another user added a product — full refresh is safest.
      refresh().catch(() => {});
      return;
    }
    ep.qty_ordered = remote.qty_ordered;
    const el = document.getElementById(`epOrd-${pid}`);
    if (el && document.activeElement !== el) {
      el.value = remote.qty_ordered != null && remote.qty_ordered !== ''
        ? String(remote.qty_ordered)
        : '';
    }
    updateDerivedCells(pid);
  }

  async function flushSave(pid) {
    clearTimeout(saveTimers[pid]);
    delete saveTimers[pid];
    const el = document.getElementById(`epOrd-${pid}`);
    if (!el) {
      delete dirty[pid];
      return;
    }
    const raw = el.value.trim();
    const qty = raw === '' ? 0 : parseQty(raw);
    try {
      await getDB().eventProducts.setForEvent(eventId, pid, { qty_ordered: qty });
      const ep = (event?.event_products || []).find((x) => x.product_id === pid);
      if (ep) ep.qty_ordered = qty;
      recentLocalWrites.set(pid, Date.now());
      delete dirty[pid];
      updateDerivedCells(pid);
    } catch (err) {
      toast(err.message || 'Save failed', true);
    }
  }

  function scheduleSave(pid) {
    dirty[pid] = true;
    clearTimeout(saveTimers[pid]);
    saveTimers[pid] = setTimeout(() => { flushSave(pid); }, SAVE_DEBOUNCE_MS);
  }

  async function flushAllPending() {
    const pids = Object.keys(saveTimers);
    await Promise.all(pids.map((pid) => flushSave(pid)));
  }

  function onPanelInput(e) {
    const input = e.target?.closest?.('.ep-ordered-input');
    if (!input || !panel.contains(input)) return;
    const pid = input.dataset.pid;
    if (!pid) return;
    focusPid = pid;
    const ep = (event?.event_products || []).find((x) => x.product_id === pid);
    if (ep) {
      const raw = input.value.trim();
      ep.qty_ordered = raw === '' ? 0 : parseQty(raw);
      updateDerivedCells(pid);
    }
    scheduleSave(pid);
    scheduleValueBroadcast();
  }

  function onPanelBlur(e) {
    const input = e.target?.closest?.('.ep-ordered-input');
    if (!input || !panel.contains(input)) return;
    const pid = input.dataset.pid;
    if (pid && dirty[pid]) flushSave(pid);
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
    if (abort) return;
    countedIn = countedInMap(deliveries, event, caseSizes);
    damagedFromDeliveries = damagedFromDeliveriesMap(deliveries);
    paintTable({ preserveFocus: true });
    startCollab();
  }

  function openEditProduct(productId) {
    const ep = (event?.event_products || []).find((x) => x.product_id === productId);
    if (!ep?.product) return;

    const p = ep.product;
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

  const onTableFilter = (e) => {
    if (e.detail?.panel !== 'products') return;
    const values = e.detail?.values;
    if (!values) return;
    categoriesFilter = Array.isArray(values.categories) ? [...values.categories] : [];
    sortKey = values.sort || 'category';
    paintTable();
  };

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'add-event-product') {
      e.detail.handled = true;
      openAddProduct();
    }
  };

  const onPageHide = () => { flushAllPending(); };

  panel?.addEventListener('input', onPanelInput);
  panel?.addEventListener('change', onPanelInput);
  panel?.addEventListener('blur', onPanelBlur, true);
  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
  document.addEventListener(ADMIN_TABLE_FILTER, onTableFilter);
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  window.addEventListener('pagehide', onPageHide);

  refresh().catch((err) => {
    const body = $('epBody');
    if (body) {
      reportError(err, { source: 'admin.products.load', silent: true });
      body.innerHTML = `<tr><td colspan="5">${errorState({
        title: 'Couldn’t load products',
        copy: err.message || 'Failed to load',
        variant: 'admin',
      })}</td></tr>`;
      bindEmptyRetry(body, () => refresh());
    }
  });

  return () => {
    abort = true;
    flushAllPending();
    stopCollab();
    panel?.removeEventListener('input', onPanelInput);
    panel?.removeEventListener('change', onPanelInput);
    panel?.removeEventListener('blur', onPanelBlur, true);
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
    document.removeEventListener(ADMIN_TABLE_FILTER, onTableFilter);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
    window.removeEventListener('pagehide', onPageHide);
  };
}
