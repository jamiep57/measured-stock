/**
 * Admin deliveries panel — list + sheet form (supplier, lines, photos).
 */

import {
  $, escapeHtml, rid, toast, nowLocalInput, fmtDateTime,
} from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import {
  getDB, loadEventFull, loadSuppliers, loadCaseSizes, loadCategories, productFromEvent,
} from '../../db.js';
import { formToStored, storedToForm, hasQuantity, totalUnitsForProduct, parseQty } from '../../stock-entry.js';
import { round1, countedInFromDeliveries, damagedFromDeliveries } from '../../lib/opening-stock.js';
import { productStockPack } from '../../pack-metrics.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { mountProductSearch } from '../../components/product-search.js';
import { mountSupplierSearch } from '../../components/supplier-search.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import { confirmDialog } from '../../components/modal.js';

const DELIVERY_BUCKET = 'delivery-photos';

function lineParts(l, event, caseSizes) {
  const p = productFromEvent(event, l.product_id);
  const name = p?.name || 'Product';
  const pack = productStockPack(p, caseSizes);
  const packLabel = pack?.label || p?.case_size || '';
  const form = storedToForm(l);
  const parts = [];
  if (form.cases) parts.push(`${form.cases} cases`);
  if (form.singles) parts.push(`${form.singles} singles`);
  if (l.damaged_qty) parts.push(`${l.damaged_qty} damaged`);
  if (l.invoice_qty != null || l.invoice_singles) {
    const invForm = storedToForm({ qty: l.invoice_qty, singles: l.invoice_singles });
    const invParts = [];
    if (invForm.cases) invParts.push(`${invForm.cases} inv cases`);
    if (invForm.singles) invParts.push(`${invForm.singles} inv singles`);
    if (invParts.length) parts.push(invParts.join(', '));
  }
  return { name, packLabel, qty: parts.join(', ') };
}

function invoiceToStored(invoiceCases, invoiceSingles) {
  if (!hasQuantity(invoiceCases, invoiceSingles)) {
    return { invoice_qty: null, invoice_singles: null };
  }
  const stored = formToStored({ cases: invoiceCases, singles: invoiceSingles });
  return { invoice_qty: stored.qty, invoice_singles: stored.singles };
}

function invoiceFromLine(line) {
  return storedToForm({ qty: line.invoice_qty, singles: line.invoice_singles });
}

function renderLineList(lines, event, caseSizes) {
  const items = (lines || []);
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

function productIds(delivery) {
  return (delivery.lines || []).map((l) => l.product_id).filter(Boolean);
}

function productNamesHaystack(lines, event) {
  return (lines || []).map((l) => {
    const p = productFromEvent(event, l.product_id);
    return p?.name || '';
  }).join(' ').toLowerCase();
}

function renderShell() {
  return `
    <div class="admin-page del-panel">
      <div class="del-list" id="delList">
        <div class="del-loading muted">Loading deliveries…</div>
      </div>
    </div>`;
}

function photoThumbHtml(label, url) {
  if (!url) return '';
  return `<button type="button" class="del-card-photo" data-lightbox="${escapeHtml(url)}"
    title="${escapeHtml(label)}" aria-label="View ${escapeHtml(label)}">
    <img src="${escapeHtml(url)}" alt="${escapeHtml(label)}">
  </button>`;
}

function renderCardExtras(d) {
  const notes = d.notes
    ? `<p class="del-card-notes">${escapeHtml(d.notes)}</p>`
    : '';
  const noteThumb = d.delivery_note_url
    ? `<span class="del-card-photo-label">Note</span>${photoThumbHtml('Delivery note', d.delivery_note_url)}`
    : '';
  const photoThumbs = (d.photo_urls || []).length
    ? `<span class="del-card-photo-label">Photos</span>${(d.photo_urls || []).map((u) => photoThumbHtml('Photo', u)).join('')}`
    : '';
  const dmgThumbs = (d.damages_photo_urls || []).length
    ? `<span class="del-card-photo-label">Damages</span>${(d.damages_photo_urls || []).map((u) => photoThumbHtml('Damage', u)).join('')}`
    : '';
  const photosBlock = (noteThumb || photoThumbs || dmgThumbs)
    ? `<div class="del-card-photos">${noteThumb}${photoThumbs}${dmgThumbs}</div>`
    : '';
  if (!notes && !photosBlock) return '';
  return `<div class="del-card-extra">${notes}${photosBlock}</div>`;
}

function renderList(deliveries, event, caseSizes) {
  if (!deliveries.length) {
    return '<div class="del-empty">No deliveries yet. Log the first delivery to record stock in.</div>';
  }

  return deliveries.map((d) => {
    const sup = d.supplier?.name || 'No supplier';
    const lineCount = (d.lines || []).length;
    const lineList = renderLineList(d.lines, event, caseSizes);
    const ids = productIds(d).join(',');
    const extras = renderCardExtras(d);

    return `
      <article class="del-card" data-delivery-id="${escapeHtml(d.id)}"
        data-product-ids="${escapeHtml(ids)}"
        data-product-names="${escapeHtml(productNamesHaystack(d.lines, event))}"
        data-supplier-name="${escapeHtml((sup || '').toLowerCase())}"
        data-reference="${escapeHtml((d.reference || '').toLowerCase())}"
        data-notes="${escapeHtml((d.notes || '').toLowerCase())}">
        <div class="del-card-main del-card-main--stacked">
          <div class="del-card-head">
            <div class="del-card-body">
              <h3 class="del-card-pill-title"><span class="del-card-pill-name">${escapeHtml(sup)}</span></h3>
              <p class="del-card-meta">
                ${escapeHtml(fmtDateTime(d.delivered_at))}
                · ${lineCount} product${lineCount !== 1 ? 's' : ''}
                ${d.reference ? ` · ${escapeHtml(d.reference)}` : ''}
              </p>
            </div>
            <div class="del-card-actions">
              <button type="button" class="topbar-tool del-card-action" data-edit="${escapeHtml(d.id)}"
                title="Edit delivery" aria-label="Edit delivery">
                ${icon('pencil', { size: 16 })}
              </button>
              <button type="button" class="topbar-tool del-card-action del-card-action--danger" data-del="${escapeHtml(d.id)}"
                title="Delete delivery" aria-label="Delete delivery">
                ${icon('trash', { size: 16 })}
              </button>
            </div>
          </div>
          ${lineList}
          ${extras}
        </div>
      </article>`;
  }).join('');
}

function qtyFieldsRowHtml({
  cases, singles, damagedQty, invoiceCases, invoiceSingles, lineId,
}) {
  const lid = lineId ? ` data-lid="${escapeHtml(lineId)}"` : '';

  return `
    <div class="del-qty-fields">
      <div class="del-qty-fields del-qty-fields--row">
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
        <div class="del-qty-field">
          <label class="admin-label">Damaged</label>
          <input type="text" inputmode="decimal" autocomplete="off" class="admin-input del-line-dmg num-math"${lid}
            value="${escapeHtml(damagedQty)}" placeholder="0" aria-label="Damaged">
        </div>
      </div>
      <div class="del-qty-fields del-qty-fields--invoice">
        <span class="admin-label del-qty-section-label">Invoice</span>
        <div class="del-qty-fields del-qty-fields--row del-qty-fields--row-invoice">
          <div class="del-qty-field">
            <label class="admin-label">Cases</label>
            <input type="text" inputmode="decimal" autocomplete="off" class="admin-input del-line-inv-cases num-math"${lid}
              value="${escapeHtml(invoiceCases)}" placeholder="0" aria-label="Invoice cases">
          </div>
          <div class="del-qty-field">
            <label class="admin-label">Singles</label>
            <input type="text" inputmode="decimal" autocomplete="off" class="admin-input del-line-inv-singles num-math"${lid}
              value="${escapeHtml(invoiceSingles)}" placeholder="0" aria-label="Invoice singles">
          </div>
        </div>
      </div>
    </div>`;
}

export function renderDeliveriesShell() {
  return renderShell();
}

export function mountDeliveriesPanel(route) {
  const listEl = $('delList');
  if (!listEl) return () => {};

  let event = null;
  let suppliers = [];
  let categories = [];
  let caseSizes = [];
  let deliveries = [];
  let editingId = null;
  let delLines = [];
  let delNote = null;
  let delPhotos = [];
  let delDamages = [];

  function applyProductFilter({ query, productId } = {}) {
    const q = (query || '').trim().toLowerCase();
    const filtering = Boolean(productId || q);
    listEl.querySelectorAll('.del-card').forEach((card) => {
      const supplier = card.dataset.supplierName || '';
      const reference = card.dataset.reference || '';
      const notes = card.dataset.notes || '';
      const cardMetaMatch = !productId && q
        && (supplier.includes(q) || reference.includes(q) || notes.includes(q));

      const lines = card.querySelectorAll('.del-card-line');
      let anyLineVisible = false;
      lines.forEach((line) => {
        const pid = line.dataset.pid || '';
        const name = line.dataset.productName || '';
        const match = productId
          ? pid === productId
          : (!q || name.includes(q) || cardMetaMatch);
        line.hidden = filtering && !match;
        if (match) anyLineVisible = true;
      });
      if (!lines.length) {
        const ids = (card.dataset.productIds || '').split(',').filter(Boolean);
        const names = card.dataset.productNames || '';
        card.hidden = productId
          ? !ids.includes(productId)
          : filtering && !names.includes(q) && !cardMetaMatch;
        return;
      }
      card.hidden = filtering && !anyLineVisible;
    });
  }

  function closeLightbox() {
    document.getElementById('delLightbox')?.remove();
  }

  function openLightbox(url) {
    if (!url) return;
    closeLightbox();
    const overlay = document.createElement('div');
    overlay.id = 'delLightbox';
    overlay.className = 'del-lightbox';
    overlay.innerHTML = `
      <div class="del-lightbox-frame">
        <button type="button" class="del-lightbox-close" aria-label="Close">${icon('x', { size: 18 })}</button>
        <img src="${escapeHtml(url)}" alt="Delivery photo">
      </div>`;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('.del-lightbox-close')) closeLightbox();
    });
    document.body.appendChild(overlay);
  }

  function wireLineQtyInputs(root) {
    root.querySelectorAll('.del-line-cases').forEach((inp) => {
      inp.oninput = () => {
        const line = delLines.find((l) => l.lineId === inp.dataset.lid);
        if (line) line.cases = inp.value;
      };
    });
    root.querySelectorAll('.del-line-singles').forEach((inp) => {
      inp.oninput = () => {
        const line = delLines.find((l) => l.lineId === inp.dataset.lid);
        if (line) line.singles = inp.value;
      };
    });
    root.querySelectorAll('.del-line-dmg').forEach((inp) => {
      inp.oninput = () => {
        const line = delLines.find((l) => l.lineId === inp.dataset.lid);
        if (line) line.damagedQty = inp.value;
      };
    });
    root.querySelectorAll('.del-line-inv-cases').forEach((inp) => {
      inp.oninput = () => {
        const line = delLines.find((l) => l.lineId === inp.dataset.lid);
        if (line) line.invoiceCases = inp.value;
      };
    });
    root.querySelectorAll('.del-line-inv-singles').forEach((inp) => {
      inp.oninput = () => {
        const line = delLines.find((l) => l.lineId === inp.dataset.lid);
        if (line) line.invoiceSingles = inp.value;
      };
    });
  }

  function renderCommittedLines() {
    const wrap = $('dfLines');
    if (!wrap) return;

    if (!delLines.length) {
      wrap.innerHTML = '';
      wrap.hidden = true;
      return;
    }

    wrap.hidden = false;
    wrap.innerHTML = delLines.map((line) => {
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
            damagedQty: line.damagedQty,
            invoiceCases: line.invoiceCases,
            invoiceSingles: line.invoiceSingles,
            lineId: line.lineId,
          })}
        </div>`;
    }).join('');

    wireLineQtyInputs(wrap);
    wrap.querySelectorAll('.del-line-remove').forEach((btn) => {
      btn.onclick = () => {
        delLines = delLines.filter((l) => l.lineId !== btn.dataset.lid);
        renderCommittedLines();
      };
    });
  }

  function addProductLine(productId) {
    const lineId = rid('l');
    delLines.push({
      lineId,
      productId,
      cases: '',
      singles: '',
      damagedQty: '',
      invoiceCases: '',
      invoiceSingles: '',
    });
    $('dfErr').textContent = '';
    renderCommittedLines();
    return lineId;
  }

  async function createProductForDelivery({ name, category_id, case_size_id }) {
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
    const entry = {
      id: ep.id,
      event_id: route.eventId,
      product_id: created.id,
      product,
    };
    event.event_products = [...(event.event_products || []), entry];

    return { productId: created.id, product };
  }

  function mountProductComposer() {
    const el = $('dfProductSearch');
    if (!el) return;

    mountProductSearch(el, {
      products: event?.event_products || [],
      caseSizes,
      categories,
      value: '',
      placeholder: 'Search product to add…',
      allowCreate: true,
      onCreateProduct: createProductForDelivery,
      onSelect: ({ productId }) => {
        const lineId = addProductLine(productId);
        mountProductComposer();
        requestAnimationFrame(() => {
          const input = el.querySelector('.product-search-input');
          const list = el.querySelector('.product-search-list');
          if (input) input.value = '';
          if (list) list.hidden = true;
          $('dfLines')?.querySelector(`.del-line-cases[data-lid="${lineId}"]`)?.focus();
        });
      },
    });
  }

  function renderProductsSection() {
    renderCommittedLines();
    mountProductComposer();
  }

  function renderDeliveryLines() {
    renderProductsSection();
  }

  function renderPhotoPreviews() {
    const noteEl = $('dfNotePreview');
    if (noteEl) {
      noteEl.innerHTML = delNote?.url
        ? `<img class="del-thumb" src="${escapeHtml(delNote.url)}" alt="">`
        : delNote?.preview ? `<img class="del-thumb" src="${delNote.preview}" alt="">` : '';
    }
    const photosEl = $('dfPhotosPreview');
    if (photosEl) {
      photosEl.innerHTML = delPhotos.map((p) =>
        `<img class="del-thumb" src="${escapeHtml(p.url || p.preview)}" alt="">`,
      ).join('');
    }
    const damagesEl = $('dfDamagesPreview');
    if (damagesEl) {
      damagesEl.innerHTML = delDamages.map((p) =>
        `<img class="del-thumb" src="${escapeHtml(p.url || p.preview)}" alt="">`,
      ).join('');
    }
  }

  function onNoteFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    delNote = { file, preview: URL.createObjectURL(file) };
    renderPhotoPreviews();
  }

  function onPhotosFile(e) {
    [...(e.target.files || [])].forEach((file) => {
      delPhotos.push({ id: rid('p'), file, preview: URL.createObjectURL(file) });
    });
    renderPhotoPreviews();
  }

  function onDamagesFile(e) {
    [...(e.target.files || [])].forEach((file) => {
      delDamages.push({ id: rid('d'), file, preview: URL.createObjectURL(file) });
    });
    renderPhotoPreviews();
  }

  async function uploadPhotosAsync(deliveryId) {
    const DB = getDB();
    const patch = {};
    if (delNote?.file) {
      patch.delivery_note_url = await DB.uploadImage(
        DELIVERY_BUCKET,
        `${route.eventId}/${deliveryId}/note-${Date.now()}.jpg`,
        delNote.file,
      );
    }
    const photoUrls = [];
    for (let i = 0; i < delPhotos.length; i++) {
      const p = delPhotos[i];
      if (p.file) {
        photoUrls.push(await DB.uploadImage(
          DELIVERY_BUCKET,
          `${route.eventId}/${deliveryId}/photo-${i}-${Date.now()}.jpg`,
          p.file,
        ));
      } else if (p.url) photoUrls.push(p.url);
    }
    if (photoUrls.length) patch.photo_urls = photoUrls;

    const damageUrls = [];
    for (let i = 0; i < delDamages.length; i++) {
      const p = delDamages[i];
      if (p.file) {
        damageUrls.push(await DB.uploadImage(
          DELIVERY_BUCKET,
          `${route.eventId}/${deliveryId}/damage-${i}-${Date.now()}.jpg`,
          p.file,
        ));
      } else if (p.url) damageUrls.push(p.url);
    }
    if (damageUrls.length) patch.damages_photo_urls = damageUrls;

    if (Object.keys(patch).length) await DB.deliveries.update(deliveryId, patch);
  }

  /** Persist summed delivery-line qty onto event_products (keeps aggregates close to live lines). */
  async function syncDeliveredFromDeliveries() {
    if (!event) return;
    const countedIn = countedInFromDeliveries(deliveries, event.event_products, caseSizes);
    const damagedMap = damagedFromDeliveries(deliveries);
    const DB = getDB();
    const updates = (event.event_products || []).map((ep) => {
      const counted = round1(countedIn[ep.product_id] || 0);
      const damaged = round1(damagedMap[ep.product_id] || 0);
      const curDelivered = ep.delivered_qty != null ? round1(ep.delivered_qty) : null;
      const curDamaged = ep.damaged_qty != null ? round1(ep.damaged_qty) : null;
      const patch = {};
      if (curDelivered !== counted) {
        ep.delivered_qty = counted;
        patch.delivered_qty = counted;
      }
      if (curDamaged !== damaged) {
        ep.damaged_qty = damaged;
        patch.damaged_qty = damaged;
      }
      if (!Object.keys(patch).length) return null;
      return DB.eventProducts.setForEvent(route.eventId, ep.product_id, patch)
        .then(() => ({ ok: true, productId: ep.product_id }))
        .catch((e) => {
          console.warn('syncDeliveredFromDeliveries', e);
          return { ok: false, productId: ep.product_id, error: e };
        });
    }).filter(Boolean);

    if (!updates.length) return;
    const results = await Promise.all(updates);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      toast(`Could not sync delivered qty for ${failed.length} product${failed.length === 1 ? '' : 's'}`, true);
    }
  }

  async function syncInvoiceFromDeliveries() {
    if (!event) return;
    const map = {};
    deliveries.forEach((d) => {
      (d.lines || []).forEach((l) => {
        if (!l.product_id || (l.invoice_qty == null && !l.invoice_singles)) return;
        const p = productFromEvent(event, l.product_id);
        const invForm = storedToForm({ qty: l.invoice_qty, singles: l.invoice_singles });
        const total = totalUnitsForProduct(invForm.cases, invForm.singles, p, caseSizes);
        map[l.product_id] = round1((map[l.product_id] || 0) + total);
      });
    });

    const DB = getDB();
    const updates = (event.event_products || []).map((ep) => {
      const total = map[ep.product_id];
      const next = total != null && total > 0 ? total : null;
      const cur = ep.invoice_qty != null ? round1(ep.invoice_qty) : null;
      if (cur === next) return null;
      ep.invoice_qty = next;
      return DB.eventProducts.setForEvent(route.eventId, ep.product_id, { invoice_qty: next })
        .catch((e) => console.warn('syncInvoiceFromDeliveries', e));
    }).filter(Boolean);

    if (updates.length) await Promise.allSettled(updates);
  }

  async function saveDelivery() {
    const supplierId = $('dfSupplier')?.value || null;
    const valid = delLines
      .filter((l) => l.productId && (
        hasQuantity(l.cases, l.singles)
        || parseQty(l.damagedQty)
        || hasQuantity(l.invoiceCases, l.invoiceSingles)
      ))
      .map((l) => {
        const stored = formToStored({ cases: l.cases, singles: l.singles });
        const invoice = invoiceToStored(l.invoiceCases, l.invoiceSingles);
        return {
          product_id: l.productId,
          qty: stored.qty,
          singles: stored.singles,
          damaged_qty: parseQty(l.damagedQty),
          invoice_qty: invoice.invoice_qty,
          invoice_singles: invoice.invoice_singles,
        };
      });

    if (!valid.length) {
      $('dfErr').textContent = 'Add at least one product with a quantity.';
      return;
    }

    const btn = $('dfSave');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const DB = getDB();
      const head = {
        event_id: route.eventId,
        supplier_id: supplierId,
        delivered_at: $('dfDate').value
          ? new Date($('dfDate').value).toISOString()
          : new Date().toISOString(),
        reference: ($('dfReference').value || '').trim() || null,
        notes: ($('dfNotes').value || '').trim() || null,
      };

      let deliveryId = editingId;
      if (editingId) {
        await DB.deliveries.update(deliveryId, head);
        await DB.deliveries.clearLines(deliveryId);
      } else {
        const created = await DB.deliveries.create(head);
        deliveryId = created.id;
      }

      await DB.deliveries.addLines(valid.map((v) => ({ delivery_id: deliveryId, ...v })));
      uploadPhotosAsync(deliveryId).catch((err) => console.warn('Photo upload', err));

      await refreshList();
      await syncDeliveredFromDeliveries();
      await syncInvoiceFromDeliveries();
      closeSheet();
      toast(editingId ? 'Delivery updated' : 'Delivery saved');
    } catch (err) {
      $('dfErr').textContent = err.message || 'Save failed';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save delivery';
    }
  }

  function openDeliveryForm(editId) {
    editingId = editId || null;
    delNote = null;
    delPhotos = [];
    delDamages = [];

    if (editId) {
      const d = deliveries.find((x) => x.id === editId);
      if (!d) return;
      delLines = (d.lines || []).length
        ? d.lines.map((l) => {
          const form = storedToForm(l);
          const invForm = invoiceFromLine(l);
          return {
            lineId: rid('l'),
            productId: l.product_id,
            cases: form.cases,
            singles: form.singles,
            damagedQty: l.damaged_qty ? String(l.damaged_qty) : '',
            invoiceCases: invForm.cases,
            invoiceSingles: invForm.singles,
          };
        })
        : [];
      delNote = d.delivery_note_url ? { url: d.delivery_note_url } : null;
      delPhotos = (d.photo_urls || []).map((u) => ({ id: rid('p'), url: u }));
      delDamages = (d.damages_photo_urls || []).map((u) => ({ id: rid('d'), url: u }));
    } else {
      delLines = [];
    }
    openSheet({
      title: editingId ? 'Edit delivery' : 'Log delivery',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="dfErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="dfDate">Date &amp; time</label>
            <input class="admin-input" type="datetime-local" id="dfDate">
          </div>
          <div class="admin-field">
            <label class="admin-label" for="dfSupplierInput">Supplier</label>
            <div id="dfSupplierSearch"></div>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="dfReference">Reference / invoice</label>
            <input class="admin-input" type="text" id="dfReference" placeholder="Optional">
          </div>
          <div class="admin-field">
            <span class="admin-label">Products</span>
            <div class="del-products">
              <div class="del-line-composer">
                <div id="dfProductSearch"></div>
              </div>
              <div id="dfLines" class="del-lines-committed" hidden></div>
            </div>
          </div>
          <div class="admin-field">
            <span class="admin-label">Delivery note</span>
            <div class="del-thumbs" id="dfNotePreview"></div>
            <label class="admin-drawer-btn del-photo-add">
              ${icon('camera', { size: 14 })}
              Attach note
              <input type="file" accept="image/*" id="dfNoteFile" hidden>
            </label>
          </div>
          <div class="admin-field">
            <span class="admin-label">Photos</span>
            <div class="del-thumbs" id="dfPhotosPreview"></div>
            <label class="admin-drawer-btn del-photo-add">
              ${icon('camera', { size: 14 })}
              Add photos
              <input type="file" accept="image/*" multiple id="dfPhotosFile" hidden>
            </label>
          </div>
          <div class="admin-field">
            <span class="admin-label">Damaged photos</span>
            <div class="del-thumbs" id="dfDamagesPreview"></div>
            <label class="admin-drawer-btn del-photo-add">
              ${icon('camera', { size: 14 })}
              Add damaged photos
              <input type="file" accept="image/*" multiple id="dfDamagesFile" hidden>
            </label>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="dfNotes">Notes</label>
            <textarea class="admin-textarea" id="dfNotes" rows="3" placeholder="Optional…"></textarea>
          </div>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot">
          <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="dfCancel">Cancel</button>
          <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="dfSave">Save delivery</button>
        </div>`,
      onClose: () => { editingId = null; },
    });

    const editDelivery = editId ? deliveries.find((x) => x.id === editId) : null;
    if (editDelivery) {
      if (editDelivery.delivered_at) {
        const dt = new Date(editDelivery.delivered_at);
        $('dfDate').value = new Date(dt - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      }
      $('dfReference').value = editDelivery.reference || '';
      $('dfNotes').value = editDelivery.notes || '';
    } else {
      $('dfDate').value = nowLocalInput();
    }

    mountSupplierSearch($('dfSupplierSearch'), {
      suppliers,
      value: editDelivery?.supplier_id || '',
      placeholder: 'Search suppliers…',
      emptyLabel: '— Optional —',
      allowCreate: true,
      onCreateSupplier: async (payload) => {
        const created = await getDB().suppliers.create({
          name: payload.name,
          contact_name: payload.contact_name || null,
          email: null,
          phone: null,
          address: null,
          default_sor_pct: payload.default_sor_pct ?? 0,
        });
        if (!created?.id) throw new Error('Supplier was not created.');
        if (!suppliers.some((s) => s.id === created.id)) {
          suppliers = [...suppliers, created];
        }
        toast('Supplier created');
        return { supplierId: created.id, supplier: created };
      },
    });

    $('dfCancel').onclick = closeSheet;
    $('dfSave').onclick = saveDelivery;
    $('dfNoteFile').onchange = onNoteFile;
    $('dfPhotosFile').onchange = onPhotosFile;
    $('dfDamagesFile').onchange = onDamagesFile;

    renderDeliveryLines();
    renderPhotoPreviews();
  }

  async function deleteDelivery(id) {
    if (!await confirmDialog({ title: 'Confirm', message: 'Delete this delivery?', confirmLabel: 'Delete', danger: true })) return;
    try {
      const DB = getDB();
      await DB.deliveries.clearLines(id);
      await DB.deliveries.remove(id);
      deliveries = deliveries.filter((d) => d.id !== id);
      await syncDeliveredFromDeliveries();
      await syncInvoiceFromDeliveries();
      paintList();
      toast('Delivery deleted');
    } catch (err) {
      toast(err.message || 'Delete failed', true);
    }
  }

  function wireList() {
    listEl.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.onclick = () => openDeliveryForm(btn.dataset.edit);
    });
    listEl.querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = () => deleteDelivery(btn.dataset.del);
    });
    listEl.querySelectorAll('[data-lightbox]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openLightbox(btn.dataset.lightbox);
      };
    });
  }

  function paintList() {
    listEl.innerHTML = renderList(deliveries, event, caseSizes);
    wireList();
    applyProductFilter(getLastProductFilter());
  }

  async function refreshList() {
    const DB = getDB();
    deliveries = await DB.deliveries.forEvent(route.eventId);
    deliveries.sort((a, b) => new Date(b.delivered_at) - new Date(a.delivered_at));
    paintList();
  }

  async function load() {
    try {
      [event, suppliers, categories, caseSizes] = await Promise.all([
        loadEventFull(route.eventId),
        loadSuppliers(),
        loadCategories(),
        loadCaseSizes(),
      ]);
      await refreshList();
    } catch (err) {
      listEl.innerHTML = `<div class="del-empty del-empty--err">${escapeHtml(err.message || 'Failed to load')}</div>`;
    }
  }

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'log-delivery') {
      e.detail.handled = true;
      openDeliveryForm();
    }
  };
  const onProductFilter = (e) => {
    applyProductFilter(e.detail || {});
  };
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);

  load();

  return () => {
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
    closeLightbox();
  };
}
