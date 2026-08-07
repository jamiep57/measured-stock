/**
 * Admin transfers panel — list + sheet form (source, destination, product lines).
 */

import {
  $, escapeHtml, rid, toast, nowLocalInput, fmtDateTime, isBoneYard,
} from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import {
  getDB, loadEventFull, loadCaseSizes, loadCategories, productFromEvent,
} from '../../db.js';
import {
  formToStored, storedToForm, hasQuantity, parseQty, totalUnitsForProduct,
} from '../../stock-entry.js';
import { productStockPack } from '../../pack-metrics.js';
import { generateDeliveryNotePDF } from '../../lib/delivery-note-pdf.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { mountProductSearch } from '../../components/product-search.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import {
  ADMIN_TABLE_FILTER,
  getTableFilterValues,
} from '../table-filter.js';
import { confirmDialog } from '../../components/modal.js';
import { emptyState, errorState, bindEmptyRetry } from '../../components/empty-state.js';
import { reportError } from '../../lib/client-errors.js';
import { loadingWidget } from '../../components/loading-widget.js';

async function loadWarehouses() {
  try {
    return await getDB().warehouses.list();
  } catch {
    return [];
  }
}

function inDateRange(iso, dates) {
  const from = dates?.from || '';
  const to = dates?.to || '';
  if (!from && !to) return true;
  if (!iso) return true;
  const day = String(iso).slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function sortByDate(list, sort, dateField) {
  const items = list.slice();
  const dir = sort === 'date-asc' ? 1 : -1;
  items.sort((a, b) => {
    const ta = new Date(a[dateField] || 0).getTime();
    const tb = new Date(b[dateField] || 0).getTime();
    return (ta - tb) * dir;
  });
  return items;
}

function parseSourceValue(val) {
  if (!val) return null;
  const i = val.indexOf(':');
  if (i < 0) return null;
  return { type: val.slice(0, i), id: val.slice(i + 1) };
}

function eventServingBars(event) {
  return (event?.bars || [])
    .filter((b) => !isBoneYard(b))
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function barNameById(event, barId) {
  const b = (event?.bars || []).find((x) => x.id === barId);
  return b?.name || 'Bar';
}

function isBoneYardDest(t, eventId) {
  if (!t || !eventId) return false;
  return t.to_event_id === eventId && !t.to_bar_id && !t.recipient_id && !t.to_warehouse_id;
}

function transferSourceFromSaved(t) {
  if (!t) return null;
  if (t.from_warehouse_id) return { type: 'warehouse', id: t.from_warehouse_id };
  if (t.from_bar_id) return { type: 'bar', id: t.from_bar_id };
  if (t.from_event_id) {
    if (t.recipient_id || t.to_warehouse_id) return { type: 'site', id: t.from_event_id };
    return { type: 'event', id: t.from_event_id };
  }
  return null;
}

function transferDestValueFromSaved(t) {
  if (!t) return '';
  if (t.recipient_id) return `recipient:${t.recipient_id}`;
  if (t.to_bar_id) return `bar:${t.to_bar_id}`;
  if (t.to_warehouse_id) return `warehouse:${t.to_warehouse_id}`;
  if (isBoneYardDest(t, t.to_event_id)) return `event:${t.to_event_id}`;
  return '';
}

function transferSourceLabel(t, event, warehouses) {
  if (t.from_bar_id) return barNameById(event, t.from_bar_id);
  if (t.from_event_id && !t.from_warehouse_id && (t.recipient_id || t.to_warehouse_id)) {
    return `${event?.name || 'Event'} — all locations`;
  }
  if (t.from_event_id) return `Bone Yard — ${event?.name || 'Event'}`;
  if (t.from_warehouse_id) {
    const w = warehouses.find((x) => x.id === t.from_warehouse_id);
    return w?.name || 'Warehouse';
  }
  return '—';
}

function transferDestLabel(t, event, warehouses) {
  if (t.to_bar_id) return barNameById(event, t.to_bar_id);
  if (isBoneYardDest(t, event?.id)) return `Bone Yard — ${event?.name || 'Event'}`;
  if (t.recipients?.name) return t.recipients.name;
  if (t.recipient_id) {
    const r = (event?.recipients || []).find((x) => x.id === t.recipient_id);
    return r?.name || 'Recipient';
  }
  if (t.to_warehouse_id) {
    const w = warehouses.find((x) => x.id === t.to_warehouse_id);
    return w?.name || 'Warehouse';
  }
  return '—';
}

function lineParts(l, event, caseSizes) {
  const p = productFromEvent(event, l.product_id);
  const name = p?.name || l.product?.name || 'Product';
  const pack = productStockPack(p, caseSizes);
  const packLabel = pack?.label || p?.case_size || '';
  const form = storedToForm(l);
  const parts = [];
  if (form.cases) parts.push(`${form.cases} cases`);
  if (form.singles) parts.push(`${form.singles} singles`);
  return { name, packLabel, qty: parts.join(', ') };
}

function renderLineList(lines, event, caseSizes) {
  const items = lines || [];
  if (!items.length) return '';
  return `
    <ul class="del-card-lines">
      ${items.map((l) => {
        const { name, packLabel, qty } = lineParts(l, event, caseSizes);
        return `<li class="del-card-line" data-pid="${escapeHtml(l.product_id || '')}"
          data-product-name="${escapeHtml((name || '').toLowerCase())}">
          <div class="del-card-line-main">
            <span class="del-card-line-name">${escapeHtml(name)}</span>
            ${packLabel ? `<span class="del-card-line-pack">${escapeHtml(packLabel)}</span>` : ''}
          </div>
          ${qty ? `<span class="del-card-line-qty">${escapeHtml(qty)}</span>` : ''}
        </li>`;
      }).join('')}
    </ul>`;
}

function productIds(transfer) {
  return (transfer.lines || []).map((l) => l.product_id).filter(Boolean);
}

function productNamesHaystack(lines, event) {
  return (lines || []).map((l) => {
    const p = productFromEvent(event, l.product_id);
    return (p?.name || l.product?.name || '').toLowerCase();
  }).join(' ');
}

function qtyFieldsRowHtml({ cases, singles, lineId }) {
  const lid = lineId ? ` data-lid="${escapeHtml(lineId)}"` : '';
  return `
    <div class="del-qty-fields del-qty-fields--row wst-qty-fields">
      <div class="del-qty-field">
        <label class="admin-label">Cases</label>
        <input type="text" inputmode="decimal" autocomplete="off" class="admin-input del-line-cases num-math"${lid}
          value="${escapeHtml(cases)}" placeholder="0" aria-label="Cases">
      </div>
      <div class="del-qty-field">
        <label class="admin-label">Singles</label>
        <input type="text" inputmode="decimal" autocomplete="off" class="admin-input del-line-singles num-math"${lid}
          value="${escapeHtml(singles)}" placeholder="0" aria-label="Singles">
      </div>
    </div>`;
}

function sourceSelectOptions(event, warehouses, current) {
  const bars = eventServingBars(event);
  const eventGroup = event
    ? `<optgroup label="${escapeHtml(event.name)}">` +
      `<option value="site:${event.id}">Whole event (all locations)</option>` +
      `<option value="event:${event.id}">Bone Yard (goods in)</option>` +
      bars.map((b) => `<option value="bar:${b.id}">${escapeHtml(b.name)}</option>`).join('') +
      '</optgroup>'
    : '';
  const whGroup = warehouses.length
    ? `<optgroup label="Warehouses">${warehouses.map((w) =>
      `<option value="warehouse:${w.id}">${escapeHtml(w.name)}</option>`).join('')}</optgroup>`
    : '';
  const cur = current ? `${current.type}:${current.id}` : '';
  return {
    html: '<option value="">— Select source —</option>' + eventGroup + whGroup,
    value: cur,
  };
}

function destSelectOptions(event, warehouses, xferSource, currentValue) {
  const recips = event?.recipients || [];
  const recipGroup = recips.length
    ? `<optgroup label="Recipients">${recips.map((r) =>
      `<option value="recipient:${r.id}">${escapeHtml(r.name)}</option>`).join('')}</optgroup>`
    : '';

  const srcIsBone = xferSource?.type === 'event';
  const srcIsSite = xferSource?.type === 'site';
  const srcBarId = xferSource?.type === 'bar' ? xferSource.id : null;
  const internalOpts = [];
  if (!srcIsSite) {
    if (event && !srcIsBone) {
      internalOpts.push(`<option value="event:${event.id}">Bone Yard (goods in)</option>`);
    }
    eventServingBars(event).forEach((b) => {
      if (b.id === srcBarId) return;
      internalOpts.push(`<option value="bar:${b.id}">${escapeHtml(b.name)}</option>`);
    });
  }
  const internalGroup = internalOpts.length
    ? `<optgroup label="Within ${escapeHtml(event?.name || 'event')}">${internalOpts.join('')}</optgroup>`
    : '';

  const srcWhId = xferSource?.type === 'warehouse' ? xferSource.id : null;
  const whOpts = warehouses
    .filter((w) => w.id !== srcWhId)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map((w) => `<option value="warehouse:${w.id}">${escapeHtml(w.name)}</option>`)
    .join('');
  const whGroup = whOpts ? `<optgroup label="Warehouses">${whOpts}</optgroup>` : '';

  return '<option value="">— Select destination —</option>' + recipGroup + internalGroup + whGroup;
}

function transferLineCases(line, event, caseSizes) {
  const p = productFromEvent(event, line.productId);
  return totalUnitsForProduct(parseQty(line.cases), parseQty(line.singles), p, caseSizes);
}

async function adjustWarehouseStock(warehouseId, productId, delta) {
  const DB = getDB();
  const rows = await DB.select(
    'warehouse_stock',
    '?warehouse_id=eq.' + DB._.enc(warehouseId) +
    '&product_id=eq.' + DB._.enc(productId) +
    '&select=qty_on_hand',
  );
  const current = rows?.[0] ? Number(rows[0].qty_on_hand) || 0 : 0;
  const next = Math.round((current + delta) * 10) / 10;
  if (next < 0) throw new Error('Insufficient warehouse stock');
  await DB.warehouseStock.setQty(warehouseId, productId, next);
}

function renderShell() {
  return `
    <div class="admin-page xfer-panel">
      <div class="del-list" id="xferList">
        <div class="del-loading">${loadingWidget('Loading transfers…')}</div>
      </div>
    </div>`;
}

function renderList(transfers, event, warehouses, caseSizes) {
  if (!transfers.length) {
    return emptyState({
      iconHtml: icon('arrow-left-right', { size: 22 }),
      title: 'No transfers yet',
      copy: 'Log the first transfer to move stock between locations.',
      variant: 'admin',
      ctaHtml: `<button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-empty-cta="log-transfer">Log transfer</button>`,
    });
  }

  return transfers.map((t) => {
    const dest = transferDestLabel(t, event, warehouses);
    const source = transferSourceLabel(t, event, warehouses);
    const lineCount = (t.lines || []).length;
    const lineList = renderLineList(t.lines, event, caseSizes);
    const ids = productIds(t).join(',');

    return `
      <article class="del-card xfer-card" data-transfer-id="${escapeHtml(t.id)}"
        data-product-ids="${escapeHtml(ids)}"
        data-product-names="${escapeHtml(productNamesHaystack(t.lines, event))}">
        <div class="del-card-main del-card-main--stacked">
          <div class="del-card-head">
            <div class="del-card-body">
              <h3 class="del-card-pill-title"><span class="del-card-pill-name">${escapeHtml(dest)}</span></h3>
              <p class="del-card-meta">
                From ${escapeHtml(source)}
                · ${escapeHtml(fmtDateTime(t.transferred_at))}
                · ${lineCount} product${lineCount !== 1 ? 's' : ''}
              </p>
            </div>
            <div class="del-card-actions">
              <button type="button" class="topbar-tool del-card-action" data-note="${escapeHtml(t.id)}"
                title="Download delivery note" aria-label="Download delivery note">
                ${icon('download', { size: 16 })}
              </button>
              <button type="button" class="topbar-tool del-card-action" data-edit="${escapeHtml(t.id)}"
                title="Edit transfer" aria-label="Edit transfer">
                ${icon('pencil', { size: 16 })}
              </button>
              <button type="button" class="topbar-tool del-card-action del-card-action--danger" data-del="${escapeHtml(t.id)}"
                title="Delete transfer" aria-label="Delete transfer">
                ${icon('trash', { size: 16 })}
              </button>
            </div>
          </div>
          ${lineList}
        </div>
      </article>`;
  }).join('');
}

export function renderTransfersShell() {
  return renderShell();
}

export function mountTransfersPanel(route) {
  const listEl = $('xferList');
  if (!listEl) return () => {};

  let event = null;
  let categories = [];
  let caseSizes = [];
  let warehouses = [];
  let transfers = [];
  let editingId = null;
  let xferSource = null;
  let xferLines = [];
  let dates = { from: '', to: '' };
  let sortKey = 'date-desc';

  const seeded = getTableFilterValues('transfers');
  if (seeded) {
    dates = {
      from: seeded.dates?.from || '',
      to: seeded.dates?.to || '',
    };
    sortKey = seeded.sort || 'date-desc';
  }

  function visibleTransfers() {
    let list = transfers.filter((t) => inDateRange(t.transferred_at, dates));
    return sortByDate(list, sortKey, 'transferred_at');
  }

  function applyProductFilter({ query, productId } = {}) {
    const q = (query || '').trim().toLowerCase();
    const filtering = Boolean(productId || q);
    listEl.querySelectorAll('.xfer-card').forEach((card) => {
      const lines = card.querySelectorAll('.del-card-line');
      let anyVisible = false;
      lines.forEach((line) => {
        const pid = line.dataset.pid || '';
        const name = line.dataset.productName || '';
        const match = productId
          ? pid === productId
          : (!q || name.includes(q));
        line.hidden = filtering && !match;
        if (match) anyVisible = true;
      });
      if (!lines.length) {
        const ids = (card.dataset.productIds || '').split(',').filter(Boolean);
        const names = card.dataset.productNames || '';
        card.hidden = productId
          ? !ids.includes(productId)
          : filtering && !names.includes(q);
        return;
      }
      card.hidden = filtering && !anyVisible;
    });
  }

  function wireLineQtyInputs(root) {
    root.querySelectorAll('.del-line-cases').forEach((inp) => {
      inp.oninput = () => {
        const line = xferLines.find((l) => l.lineId === inp.dataset.lid);
        if (line) line.cases = inp.value;
      };
    });
    root.querySelectorAll('.del-line-singles').forEach((inp) => {
      inp.oninput = () => {
        const line = xferLines.find((l) => l.lineId === inp.dataset.lid);
        if (line) line.singles = inp.value;
      };
    });
  }

  function renderCommittedLines() {
    const wrap = $('xfLines');
    if (!wrap) return;

    if (!xferLines.length) {
      wrap.innerHTML = '';
      wrap.hidden = true;
      return;
    }

    wrap.hidden = false;
    wrap.innerHTML = xferLines.map((line) => {
      const product = productFromEvent(event, line.productId);
      const name = product?.name || 'Product';
      const pack = productStockPack(product, caseSizes);
      const packLabel = pack?.label || product?.case_size || '';
      return `
        <div class="del-line-card" data-lid="${line.lineId}">
          <div class="del-line-card-head">
            <div class="del-line-card-main">
              <div class="del-line-card-name">${escapeHtml(name)}</div>
              ${packLabel ? `<div class="del-line-card-pack">${escapeHtml(packLabel)}</div>` : ''}
            </div>
            <button type="button" class="topbar-tool del-line-remove" data-lid="${line.lineId}"
              aria-label="Remove ${escapeHtml(name)}">
              ${icon('x', { size: 14 })}
            </button>
          </div>
          ${qtyFieldsRowHtml({
            cases: line.cases,
            singles: line.singles,
            lineId: line.lineId,
          })}
        </div>`;
    }).join('');

    wireLineQtyInputs(wrap);
    wrap.querySelectorAll('.del-line-remove').forEach((btn) => {
      btn.onclick = () => {
        xferLines = xferLines.filter((l) => l.lineId !== btn.dataset.lid);
        renderCommittedLines();
      };
    });
  }

  function refreshSourceSelect() {
    const sel = $('xfSource');
    if (!sel) return;
    const { html, value } = sourceSelectOptions(event, warehouses, xferSource);
    sel.innerHTML = html;
    if (value) sel.value = value;
  }

  function refreshDestSelect(preserveValue = true) {
    const sel = $('xfDest');
    if (!sel) return;
    const prev = preserveValue ? sel.value : '';
    sel.innerHTML = destSelectOptions(event, warehouses, xferSource, prev);
    if (preserveValue && prev) {
      const stillValid = Array.from(sel.options).some((o) => o.value === prev);
      sel.value = stillValid ? prev : '';
    }
  }

  function onSourceChange() {
    const sel = $('xfSource');
    xferSource = parseSourceValue(sel?.value);
    const destSel = $('xfDest');
    if (destSel && xferSource) {
      const dv = parseSourceValue(destSel.value);
      const siteCollision = xferSource.type === 'site' && dv && (dv.type === 'event' || dv.type === 'bar');
      if (dv && (siteCollision ||
          (dv.type === 'event' && xferSource.type === 'event') ||
          (dv.type === 'bar' && xferSource.type === 'bar' && dv.id === xferSource.id))) {
        destSel.value = '';
      }
    }
    refreshDestSelect(true);
    $('xfErr').textContent = '';
    if ($('xfProductSearch')) renderProductsSection();
  }

  async function createProductForTransfer({ name, category_id, case_size_id }) {
    const DB = getDB();
    const cs = caseSizes.find((c) => c.id === case_size_id);
    const category = categories.find((c) => c.id === category_id);
    const created = await DB.products.create({
      name: name.trim(),
      category_id: category_id || null,
      case_size_id: case_size_id || null,
      case_size: cs?.label || null,
      units_per_case: cs?.units_per_case ?? 1,
    });

    const ep = await DB.eventProducts.setForEvent(route.eventId, created.id, {});
    const product = {
      ...created,
      category: category
        ? { id: category.id, name: category.name, colour_key: category.colour_key }
        : null,
    };
    event.event_products = [...(event.event_products || []), {
      id: ep.id,
      event_id: route.eventId,
      product_id: created.id,
      product,
    }];

    return { productId: created.id, product };
  }

  function addProductLine(productId) {
    const lineId = rid('l');
    xferLines.push({ lineId, productId, cases: '', singles: '' });
    $('xfErr').textContent = '';
    renderCommittedLines();
    return lineId;
  }

  function mountProductComposer() {
    const el = $('xfProductSearch');
    if (!el) return;

    mountProductSearch(el, {
      products: event?.event_products || [],
      caseSizes,
      categories,
      value: '',
      placeholder: xferSource ? 'Search product to add…' : 'Select a source first…',
      allowCreate: !!xferSource,
      onCreateProduct: createProductForTransfer,
      onSelect: ({ productId }) => {
        const lineId = addProductLine(productId);
        mountProductComposer();
        requestAnimationFrame(() => {
          const input = el.querySelector('.product-search-input');
          const list = el.querySelector('.product-search-list');
          if (input) input.value = '';
          if (list) list.hidden = true;
          $('xfLines')?.querySelector(`.del-line-cases[data-lid="${lineId}"]`)?.focus();
        });
      },
    });
  }

  function renderProductsSection() {
    renderCommittedLines();
    mountProductComposer();
  }

  function productInfoForPdf(productId) {
    const p = productFromEvent(event, productId);
    const pack = productStockPack(p, caseSizes);
    return {
      name: p?.name || 'Product',
      size: pack?.label || p?.case_size || '',
    };
  }

  function destLabelFromValue(destValue) {
    const dest = parseSourceValue(destValue);
    if (!dest) return '';
    if (dest.type === 'recipient') {
      return (event?.recipients || []).find((r) => r.id === dest.id)?.name || 'Recipient';
    }
    if (dest.type === 'bar') return barNameById(event, dest.id);
    if (dest.type === 'warehouse') {
      return warehouses.find((w) => w.id === dest.id)?.name || 'Warehouse';
    }
    if (dest.type === 'event') return `Bone Yard — ${event?.name || 'Event'}`;
    return '';
  }

  function pdfLinesFromDbLines(lines) {
    return (lines || []).map((l) => ({
      productId: l.product_id,
      cases: Number(l.qty) || 0,
      singles: Number(l.singles) || 0,
    }));
  }

  function pdfLinesFromFormLines(valid) {
    return valid.map((l) => {
      const stored = formToStored({ cases: l.cases, singles: l.singles });
      return {
        productId: l.productId,
        cases: stored.qty,
        singles: stored.singles,
      };
    });
  }

  async function downloadTransferNote(transferId) {
    const t = transfers.find((x) => x.id === transferId);
    if (!t) {
      toast('Transfer not found', true);
      return;
    }
    try {
      await generateDeliveryNotePDF({
        eventName: event?.name || '',
        recipientName: transferDestLabel(t, event, warehouses),
        date: t.transferred_at ? new Date(t.transferred_at) : new Date(),
        lines: pdfLinesFromDbLines(t.lines),
        productInfo: productInfoForPdf,
      });
    } catch (err) {
      toast(err.message || 'PDF failed', true);
    }
  }

  async function saveTransfer(downloadPdf = false) {
    $('xfErr').textContent = '';
    if (!xferSource) {
      $('xfErr').textContent = 'Pick where the stock is coming from.';
      return;
    }
    const dest = parseSourceValue($('xfDest')?.value);
    if (!dest) {
      $('xfErr').textContent = 'Select where the stock is going.';
      return;
    }
    if (xferSource.type === 'site' && (dest.type === 'event' || dest.type === 'bar')) {
      $('xfErr').textContent = 'Destination must be outside the event — pick a recipient or warehouse.';
      return;
    }
    if ((dest.type === 'event' && xferSource.type === 'event') ||
        (dest.type === 'bar' && xferSource.type === 'bar' && dest.id === xferSource.id)) {
      $('xfErr').textContent = 'Source and destination are the same location.';
      return;
    }

    const valid = xferLines.filter((l) => l.productId && hasQuantity(l.cases, l.singles));
    if (!valid.length) {
      $('xfErr').textContent = 'Add at least one product with a quantity.';
      return;
    }

    const saveBtn = $('xfSave');
    const noteBtn = $('xfSaveNote');
    const activeBtn = downloadPdf ? noteBtn : saveBtn;
    if (saveBtn) saveBtn.disabled = true;
    if (noteBtn) noteBtn.disabled = true;
    if (activeBtn) activeBtn.textContent = 'Saving…';

    const isEdit = !!editingId;
    const prevTransfer = isEdit ? transfers.find((x) => x.id === editingId) : null;
    const isWarehouseSource = xferSource.type === 'warehouse';
    const isBarSource = xferSource.type === 'bar';
    const destIsRecipient = dest.type === 'recipient';
    const destIsBar = dest.type === 'bar';
    const destIsWarehouse = dest.type === 'warehouse';
    let transferType;
    if (destIsRecipient) transferType = isWarehouseSource ? 'warehouse_to_recipient' : 'event_to_recipient';
    else if (destIsWarehouse) transferType = isWarehouseSource ? 'warehouse_to_warehouse' : 'event_to_warehouse';
    else transferType = isWarehouseSource ? 'warehouse_to_event' : 'event_to_event';

    const transferredAt = $('xfDate').value
      ? new Date($('xfDate').value).toISOString()
      : new Date().toISOString();

    try {
      const DB = getDB();
      const payload = {
        transfer_type: transferType,
        from_event_id: isWarehouseSource ? null : route.eventId,
        from_warehouse_id: isWarehouseSource ? xferSource.id : null,
        from_bar_id: isBarSource ? xferSource.id : null,
        to_event_id: (destIsBar || dest.type === 'event') ? route.eventId : null,
        to_bar_id: destIsBar ? dest.id : null,
        to_warehouse_id: destIsWarehouse ? dest.id : null,
        recipient_id: destIsRecipient ? dest.id : null,
        unit: 'cases',
        transferred_at: transferredAt,
      };

      if (isEdit && prevTransfer) {
        if (prevTransfer.from_warehouse_id) {
          await Promise.all((prevTransfer.lines || []).map(async (l) => {
            const p = productFromEvent(event, l.product_id);
            const cases = totalUnitsForProduct(
              parseQty(storedToForm(l).cases),
              parseQty(storedToForm(l).singles),
              p,
              caseSizes,
            );
            await adjustWarehouseStock(prevTransfer.from_warehouse_id, l.product_id, cases);
          }));
        }
        if (prevTransfer.to_warehouse_id) {
          await Promise.all((prevTransfer.lines || []).map(async (l) => {
            const p = productFromEvent(event, l.product_id);
            const cases = totalUnitsForProduct(
              parseQty(storedToForm(l).cases),
              parseQty(storedToForm(l).singles),
              p,
              caseSizes,
            );
            await adjustWarehouseStock(prevTransfer.to_warehouse_id, l.product_id, -cases);
          }));
        }
      }

      let transferId = editingId;
      if (isEdit) {
        await DB.transfers.update(editingId, payload);
        await DB.transfers.clearLines(editingId);
      } else {
        const created = await DB.transfers.create(payload);
        transferId = created.id;
      }

      const lineRows = valid.map((l) => {
        const stored = formToStored({ cases: l.cases, singles: l.singles });
        return {
          transfer_id: transferId,
          product_id: l.productId,
          qty: stored.qty,
          singles: stored.singles,
          unit_cost: 0,
          chargeback_applied: false,
        };
      });

      let savedLines;
      try {
        savedLines = await DB.transfers.addLines(lineRows);
      } catch (lineErr) {
        const msg = String(lineErr?.message || lineErr);
        if (!/singles|constraint|check/i.test(msg)) throw lineErr;
        savedLines = await DB.transfers.addLines(valid.map((l) => ({
          transfer_id: transferId,
          product_id: l.productId,
          qty: Math.round(transferLineCases(l, event, caseSizes) * 10000) / 10000,
          unit_cost: 0,
          chargeback_applied: false,
        })));
      }

      if (isWarehouseSource) {
        await Promise.all(savedLines.map(async (l) => {
          const cases = transferLineCases(
            valid.find((v) => v.productId === l.product_id) || {},
            event,
            caseSizes,
          );
          await adjustWarehouseStock(xferSource.id, l.product_id, -cases);
        }));
      }
      if (destIsWarehouse) {
        await Promise.all(savedLines.map(async (l) => {
          const cases = transferLineCases(
            valid.find((v) => v.productId === l.product_id) || {},
            event,
            caseSizes,
          );
          await adjustWarehouseStock(dest.id, l.product_id, cases);
        }));
      }

      if (downloadPdf) {
        await generateDeliveryNotePDF({
          eventName: event?.name || '',
          recipientName: destLabelFromValue($('xfDest')?.value),
          date: new Date(transferredAt),
          lines: pdfLinesFromFormLines(valid),
          productInfo: productInfoForPdf,
        });
      }

      closeSheet();
      await refreshList();
      toast(isEdit ? 'Transfer updated' : 'Transfer saved');
    } catch (err) {
      $('xfErr').textContent = err.message || (isEdit ? 'Failed to update transfer' : 'Failed to log transfer');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? 'Update transfer' : 'Save transfer';
      }
      if (noteBtn) {
        noteBtn.disabled = false;
        noteBtn.textContent = isEdit ? 'Update & download note' : 'Save & download note';
      }
    }
  }

  function openTransferForm(editId) {
    editingId = editId || null;
    xferLines = [];

    if (editId) {
      const t = transfers.find((x) => x.id === editId);
      if (!t) return;
      xferSource = transferSourceFromSaved(t);
      xferLines = (t.lines || []).length
        ? t.lines.map((l) => {
          const form = storedToForm(l);
          return {
            lineId: rid('l'),
            productId: l.product_id,
            cases: form.cases,
            singles: form.singles,
          };
        })
        : [];
    } else {
      xferSource = event ? { type: 'event', id: event.id } : null;
    }

    openSheet({
      title: editingId ? 'Edit transfer' : 'Log transfer',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="xfErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="xfSource">Stock comes from</label>
            <select class="admin-select" id="xfSource"></select>
            <p class="wst-form-hint muted">Stock can't be created on a transfer — pick Bone Yard, a bar, the whole event, or a warehouse.</p>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="xfDest">Transfer to</label>
            <select class="admin-select" id="xfDest"></select>
            <p class="wst-form-hint muted">Send to a recipient, move internally between bars or Bone Yard, or ship to a warehouse.</p>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="xfDate">Transferred on</label>
            <input class="admin-input" type="datetime-local" id="xfDate">
          </div>
          <div class="admin-field">
            <span class="admin-label">Products</span>
            <p class="wst-form-hint muted">Enter whole cases, loose singles, or both for each product.</p>
            <div class="del-products">
              <div class="del-line-composer">
                <div id="xfProductSearch"></div>
              </div>
              <div id="xfLines" class="del-lines-committed" hidden></div>
            </div>
          </div>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot">
          <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="xfCancel">Cancel</button>
          <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="xfSave">${editingId ? 'Update transfer' : 'Save transfer'}</button>
          <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="xfSaveNote">${editingId ? 'Update & download note' : 'Save & download note'}</button>
        </div>`,
      onClose: () => {
        editingId = null;
        xferSource = null;
        xferLines = [];
      },
    });

    refreshSourceSelect();
    refreshDestSelect(false);

    const editTransfer = editId ? transfers.find((x) => x.id === editId) : null;
    if (editTransfer) {
      if (editTransfer.transferred_at) {
        const dt = new Date(editTransfer.transferred_at);
        $('xfDate').value = new Date(dt - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      }
      $('xfDest').value = transferDestValueFromSaved(editTransfer);
    } else {
      $('xfDate').value = nowLocalInput();
    }

    $('xfSource').onchange = onSourceChange;
    $('xfCancel').onclick = closeSheet;
    $('xfSave').onclick = () => saveTransfer(false);
    $('xfSaveNote').onclick = () => saveTransfer(true);
    renderProductsSection();
  }

  async function deleteTransfer(id) {
    if (!(await confirmDialog({ title: 'Confirm', message: 'Delete this transfer? Warehouse stock will be restored where applicable.', confirmLabel: 'Delete', danger: true }))) return;
    const t = transfers.find((x) => x.id === id);
    const lines = t?.lines || [];
    try {
      const DB = getDB();
      if (t?.from_warehouse_id) {
        await Promise.all(lines.map(async (l) => {
          const p = productFromEvent(event, l.product_id);
          const cases = totalUnitsForProduct(
            parseQty(storedToForm(l).cases),
            parseQty(storedToForm(l).singles),
            p,
            caseSizes,
          );
          await adjustWarehouseStock(t.from_warehouse_id, l.product_id, cases);
        }));
      }
      if (t?.to_warehouse_id) {
        await Promise.all(lines.map(async (l) => {
          const p = productFromEvent(event, l.product_id);
          const cases = totalUnitsForProduct(
            parseQty(storedToForm(l).cases),
            parseQty(storedToForm(l).singles),
            p,
            caseSizes,
          );
          await adjustWarehouseStock(t.to_warehouse_id, l.product_id, -cases);
        }));
      }
      await DB.transfers.clearLines(id);
      await DB.transfers.remove(id);
      transfers = transfers.filter((x) => x.id !== id);
      paintList();
      toast('Transfer deleted');
    } catch (err) {
      toast(err.message || 'Delete failed', true);
    }
  }

  function wireList() {
    listEl.querySelectorAll('[data-note]').forEach((btn) => {
      btn.onclick = () => downloadTransferNote(btn.dataset.note);
    });
    listEl.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.onclick = () => openTransferForm(btn.dataset.edit);
    });
    listEl.querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = () => deleteTransfer(btn.dataset.del);
    });
  }

  function paintList() {
    const visible = visibleTransfers();
    if (!visible.length && transfers.length) {
      listEl.innerHTML = emptyState({
        iconHtml: icon('search', { size: 22 }),
        title: 'No matches',
        copy: 'No transfers match your filter.',
        variant: 'admin',
      });
    } else {
      listEl.innerHTML = renderList(visible, event, warehouses, caseSizes);
      wireList();
      listEl.querySelector('[data-empty-cta="log-transfer"]')?.addEventListener('click', () => openTransferForm());
    }
    applyProductFilter(getLastProductFilter());
  }

  async function refreshList() {
    const DB = getDB();
    transfers = await DB.transfers.forEvent(route.eventId);
    paintList();
  }

  async function load() {
    try {
      [event, categories, caseSizes, warehouses] = await Promise.all([
        loadEventFull(route.eventId),
        loadCategories(),
        loadCaseSizes(),
        loadWarehouses(),
      ]);
      await refreshList();
    } catch (err) {
      listEl.innerHTML = errorState({
        title: 'Couldn’t load transfers',
        copy: err.message || 'Failed to load',
        variant: 'admin',
      });
      bindEmptyRetry(listEl, () => load());
      reportError(err, { source: 'admin.transfers.load', silent: true });
    }
  }

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'log-transfer') {
      e.detail.handled = true;
      openTransferForm();
    }
  };
  const onProductFilter = (e) => {
    applyProductFilter(e.detail || {});
  };
  const onTableFilter = (e) => {
    if (e.detail?.panel !== 'transfers') return;
    const values = e.detail?.values;
    if (!values) return;
    dates = {
      from: values.dates?.from || '',
      to: values.dates?.to || '',
    };
    sortKey = values.sort || 'date-desc';
    paintList();
  };
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
  document.addEventListener(ADMIN_TABLE_FILTER, onTableFilter);

  load();

  return () => {
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
    document.removeEventListener(ADMIN_TABLE_FILTER, onTableFilter);
  };
}
