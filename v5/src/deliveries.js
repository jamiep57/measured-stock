import { $, escapeHtml, rid, toast, nowLocalInput, fmtDateTime } from './lib/util.js';
import { getDB, productFromEvent } from './db.js';
import { entryMode, productStockPack } from './pack-metrics.js';
import { formToStored, storedToForm, hasQuantity, parseQty } from './stock-entry.js';
import { flushQueue } from './sync-queue.js';
import { openSheet, closeSheet } from './components/sheet.js';
import { mountSupplierSearch } from './components/supplier-search.js';
import { mountProductSearch } from './components/product-search.js';

const DELIVERY_BUCKET = 'delivery-photos';

let ctx = null;
let deliveries = [];
let editingId = null;
let delLines = [];
let delNote = null;
let delPhotos = [];
let delDamages = [];

export function initDeliveries(context) {
  ctx = context;
}

export async function loadDeliveriesView() {
  const el = $('view-deliveries');
  if (!ctx.eventId) {
    el.innerHTML = `
      <div class="empty empty--panel">
        <span class="empty-icon" aria-hidden="true"><i class="ph ph-calendar-blank"></i></span>
        <p class="empty-title">Choose an event</p>
        <p class="empty-copy">Select an event in the top bar to log deliveries.</p>
      </div>`;
    return;
  }

  try {
    deliveries = await getDB().deliveries.forEvent(ctx.eventId);
  } catch (err) {
    el.innerHTML = `
      <div class="empty empty--panel">
        <span class="empty-icon" aria-hidden="true"><i class="ph ph-warning-circle"></i></span>
        <p class="empty-title">Couldn’t load deliveries</p>
        <p class="empty-copy">${escapeHtml(err.message)}</p>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="page-hero page-hero--compact">
      <p class="page-kicker">Stock</p>
      <h1 class="page-title">Deliveries</h1>
      <p class="page-sub">Log what arrived for this event.</p>
    </div>
    <div id="delList" class="session-list"></div>
  `;
  renderDeliveryList();
}

function renderDeliveryList() {
  const list = $('delList');
  if (!list) return;
  if (!deliveries.length) {
    list.innerHTML = `
      <div class="empty empty--panel">
        <span class="empty-icon" aria-hidden="true"><i class="ph ph-shipping-container"></i></span>
        <p class="empty-title">No deliveries yet</p>
        <p class="empty-copy">Tap + to log the first delivery for this event.</p>
      </div>`;
    return;
  }
  list.innerHTML = `
    <h2 class="section-label">Recent</h2>
    ${deliveries.map((d) => {
    const sup = d.supplier?.name || '—';
    const lineCount = (d.lines || []).length;
    return `
      <div class="session-card">
        <button type="button" class="session-card-main" data-edit="${d.id}">
          <span class="session-card-title">${escapeHtml(sup)}</span>
          <span class="session-card-meta">${fmtDateTime(d.delivered_at)} · ${lineCount} product${lineCount !== 1 ? 's' : ''}${d.reference ? ' · ' + escapeHtml(d.reference) : ''}</span>
        </button>
        <button class="icon-btn session-card-del" type="button" data-del="${d.id}" aria-label="Delete">
          <i class="ph ph-trash"></i>
        </button>
      </div>`;
  }).join('')}`;

  list.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.onclick = () => openDeliveryForm(btn.dataset.edit);
  });
  list.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      deleteDelivery(btn.dataset.del);
    };
  });
}

function lineShowsDamaged(line) {
  return Boolean(line.showDamaged || parseQty(line.damagedQty));
}

function qtyFieldsHtml(line) {
  const product = productFromEvent(ctx.event, line.productId);
  const mode = product
    ? entryMode(product, ctx.caseSizes)
    : { columnLabels: { primary: 'Cases', secondary: 'Singles' } };
  const primary = mode.columnLabels.primary;
  const secondary = mode.columnLabels.secondary;
  const lid = escapeHtml(line.lineId);
  const showDamaged = lineShowsDamaged(line);

  return `
    <div class="del-qty">
      <div class="del-qty-row del-qty-row--2">
        <div class="del-qty-field">
          <label>${escapeHtml(primary)}</label>
          <input type="text" inputmode="decimal" autocomplete="off" class="df-cases num-math" data-lid="${lid}"
            value="${escapeHtml(line.cases)}" placeholder="0" aria-label="${escapeHtml(primary)}">
        </div>
        <div class="del-qty-field">
          <label>${secondary ? escapeHtml(secondary) : '—'}</label>
          <input type="text" inputmode="decimal" autocomplete="off" class="df-singles num-math" data-lid="${lid}"
            value="${escapeHtml(line.singles)}" placeholder="0"
            aria-label="${secondary ? escapeHtml(secondary) : 'Singles'}"
            ${secondary ? '' : 'disabled'}>
        </div>
      </div>
      ${showDamaged ? `
      <div class="del-qty-field del-qty-field--dmg">
        <label>Damaged</label>
        <input type="text" inputmode="decimal" autocomplete="off" class="df-dmg num-math" data-lid="${lid}"
          value="${escapeHtml(line.damagedQty)}" placeholder="0" aria-label="Damaged">
      </div>` : ''}
      <div class="del-qty-invoice">
        <span class="del-qty-section">Invoice</span>
        <div class="del-qty-row del-qty-row--2">
          <div class="del-qty-field">
            <label>Inv ${escapeHtml(primary)}</label>
            <input type="text" inputmode="decimal" autocomplete="off" class="df-inv-cases num-math" data-lid="${lid}"
              value="${escapeHtml(line.invoiceCases)}" placeholder="0" aria-label="Invoice ${escapeHtml(primary)}">
          </div>
          <div class="del-qty-field">
            <label>Inv ${secondary ? escapeHtml(secondary) : '—'}</label>
            <input type="text" inputmode="decimal" autocomplete="off" class="df-inv-singles num-math" data-lid="${lid}"
              value="${escapeHtml(line.invoiceSingles)}" placeholder="0"
              aria-label="Invoice ${secondary ? escapeHtml(secondary) : 'singles'}"
              ${secondary ? '' : 'disabled'}>
          </div>
        </div>
      </div>
    </div>`;
}

function wireLineQtyInputs(root) {
  root.querySelectorAll('.df-cases, .df-singles, .df-dmg, .df-inv-cases, .df-inv-singles').forEach((inp) => {
    inp.oninput = () => {
      const line = delLines.find((l) => l.lineId === inp.dataset.lid);
      if (!line) return;
      if (inp.classList.contains('df-cases')) line.cases = inp.value;
      else if (inp.classList.contains('df-singles')) line.singles = inp.value;
      else if (inp.classList.contains('df-dmg')) line.damagedQty = inp.value;
      else if (inp.classList.contains('df-inv-cases')) line.invoiceCases = inp.value;
      else line.invoiceSingles = inp.value;
    };
  });
}

function renderDeliveryLines() {
  const wrap = $('dfLines');
  if (!wrap) return;

  if (!delLines.length) {
    wrap.innerHTML = `<p class="del-lines-empty">Search above to add products.</p>`;
    return;
  }

  wrap.innerHTML = delLines.map((line) => {
    const product = productFromEvent(ctx.event, line.productId);
    const name = product?.name || 'Product';
    const pack = productStockPack(product, ctx.caseSizes || []);
    const packLabel = pack?.label || product?.case_size || '';
    const showDamaged = lineShowsDamaged(line);
    return `
      <div class="del-line-card" data-lid="${line.lineId}">
        <div class="del-line-card-head">
          <div class="del-line-card-main">
            <div class="del-line-card-name">${escapeHtml(name)}</div>
            ${packLabel ? `<div class="del-line-card-pack">${escapeHtml(packLabel)}</div>` : ''}
          </div>
          <div class="del-line-menu">
            <button type="button" class="icon-btn del-line-more" data-lid="${line.lineId}"
              aria-label="More options" aria-haspopup="menu" aria-expanded="false">
              <i class="ph ph-dots-three-vertical"></i>
            </button>
            <div class="del-line-menu-pop" role="menu" hidden>
              ${showDamaged
                ? `<button type="button" class="del-line-menu-item" role="menuitem" data-action="hide-dmg" data-lid="${line.lineId}">Hide damaged</button>`
                : `<button type="button" class="del-line-menu-item" role="menuitem" data-action="show-dmg" data-lid="${line.lineId}">Add damaged</button>`}
              <button type="button" class="del-line-menu-item del-line-menu-item--danger" role="menuitem" data-action="remove" data-lid="${line.lineId}">Remove product</button>
            </div>
          </div>
        </div>
        ${qtyFieldsHtml(line)}
      </div>`;
  }).join('');

  wireLineQtyInputs(wrap);
  wireLineMenus(wrap);
}

function closeAllLineMenus(exceptPop = null) {
  document.querySelectorAll('.del-line-menu-pop').forEach((pop) => {
    if (pop === exceptPop) return;
    pop.hidden = true;
    pop.closest('.del-line-menu')?.querySelector('.del-line-more')?.setAttribute('aria-expanded', 'false');
  });
}

let lineMenuDocBound = false;

function ensureLineMenuDocClose() {
  if (lineMenuDocBound) return;
  lineMenuDocBound = true;
  document.addEventListener('click', (e) => {
    if (e.target.closest('.del-line-menu')) return;
    closeAllLineMenus();
  });
}

function wireLineMenus(root) {
  ensureLineMenuDocClose();
  root.querySelectorAll('.del-line-more').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const pop = btn.parentElement?.querySelector('.del-line-menu-pop');
      if (!pop) return;
      const open = pop.hidden;
      closeAllLineMenus(open ? pop : null);
      pop.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
  });

  root.querySelectorAll('.del-line-menu-item').forEach((item) => {
    item.onclick = (e) => {
      e.stopPropagation();
      const line = delLines.find((l) => l.lineId === item.dataset.lid);
      const action = item.dataset.action;
      closeAllLineMenus();

      if (action === 'remove') {
        delLines = delLines.filter((l) => l.lineId !== item.dataset.lid);
        renderDeliveryLines();
        return;
      }
      if (!line) return;
      if (action === 'show-dmg') {
        line.showDamaged = true;
        renderDeliveryLines();
        requestAnimationFrame(() => {
          $('dfLines')?.querySelector(`.df-dmg[data-lid="${line.lineId}"]`)?.focus();
        });
        return;
      }
      if (action === 'hide-dmg') {
        line.showDamaged = false;
        line.damagedQty = '';
        renderDeliveryLines();
      }
    };
  });
}

function addProductLine(productId) {
  if (!productId) return null;
  const existing = delLines.find((l) => l.productId === productId);
  if (existing) return existing.lineId;
  const lineId = rid('l');
  delLines.push({
    lineId,
    productId,
    cases: '',
    singles: '',
    damagedQty: '',
    showDamaged: false,
    invoiceCases: '',
    invoiceSingles: '',
  });
  const err = $('dfErr');
  if (err) err.textContent = '';
  renderDeliveryLines();
  return lineId;
}

function mountProductComposer() {
  const el = $('dfProductSearch');
  if (!el) return;

  mountProductSearch(el, {
    products: ctx.event?.event_products || [],
    caseSizes: ctx.caseSizes || [],
    value: '',
    placeholder: 'Search product to add…',
    dropdownFixed: false,
    onSelect: ({ productId }) => {
      if (!productId) return;
      const lineId = addProductLine(productId);
      mountProductComposer();
      requestAnimationFrame(() => {
        const input = el.querySelector('.product-search-input');
        const list = el.querySelector('.product-search-list');
        if (input) input.value = '';
        if (list) list.hidden = true;
        $('dfLines')?.querySelector(`.df-cases[data-lid="${lineId}"]`)?.focus();
      });
    },
  });
}

/** Open a blank delivery form (requires an event). */
export function startNewDelivery() {
  if (!ctx?.eventId) {
    toast('Choose an event first', true);
    return false;
  }
  openDeliveryForm();
  return true;
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
        const damagedQty = l.damaged_qty ? String(l.damaged_qty) : '';
        return {
          lineId: rid('l'),
          productId: l.product_id,
          cases: form.cases,
          singles: form.singles,
          damagedQty,
          showDamaged: Boolean(damagedQty),
          invoiceCases: l.invoice_qty != null || l.invoice_singles
            ? storedToForm({ qty: l.invoice_qty, singles: l.invoice_singles }).cases
            : '',
          invoiceSingles: l.invoice_qty != null || l.invoice_singles
            ? storedToForm({ qty: l.invoice_qty, singles: l.invoice_singles }).singles
            : '',
        };
      })
      : [];
    delNote = d.delivery_note_url ? { url: d.delivery_note_url } : null;
    delPhotos = (d.photo_urls || []).map((u) => ({ id: rid('p'), url: u }));
    delDamages = (d.damages_photo_urls || []).map((u) => ({ id: rid('d'), url: u }));
  } else {
    delLines = [];
  }

  const suppliers = ctx.suppliers || [];
  openSheet({
    title: editingId ? 'Edit delivery' : 'Log delivery',
    bodyHtml: `
      <div class="err" id="dfErr"></div>
      <div class="field"><label>Date & time</label><input type="datetime-local" id="dfDate"></div>
      <div class="field"><label for="dfSupplierInput">Supplier</label>
        <div id="dfSupplierSearch"></div>
      </div>
      <div class="field"><label>Reference / invoice</label><input type="text" id="dfReference" placeholder="Optional"></div>
      <div class="field del-products">
        <label>Products</label>
        <div id="dfProductSearch" class="del-line-composer"></div>
        <div id="dfLines" class="del-lines-committed"></div>
      </div>
      <div class="photo-group">
        <div class="photo-group-label">Delivery note</div>
        <div class="thumbs" id="dfNotePreview"></div>
        <label class="photo-add"><i class="ph ph-camera"></i> Note<input type="file" accept="image/*" id="dfNoteFile"></label>
      </div>
      <div class="photo-group">
        <div class="photo-group-label">Photos</div>
        <div class="thumbs" id="dfPhotosPreview"></div>
        <label class="photo-add"><i class="ph ph-camera"></i> Add<input type="file" accept="image/*" multiple id="dfPhotosFile"></label>
      </div>
      <div class="field"><label>Notes</label><textarea id="dfNotes" placeholder="Optional…"></textarea></div>`,
    footHtml: `
      <div class="sheet-foot-row">
        <button class="btn" type="button" id="dfCancel">Cancel</button>
        <button class="btn btn-primary" type="button" id="dfSave">Save delivery</button>
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
    inputClass: 'supplier-search-input',
    dropdownFixed: false,
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
      if (!ctx.suppliers.some((s) => s.id === created.id)) {
        ctx.suppliers = [...ctx.suppliers, created];
      }
      toast('Supplier created');
      return { supplierId: created.id, supplier: created };
    },
  });

  $('dfCancel').onclick = closeSheet;
  $('dfSave').onclick = saveDelivery;
  $('dfNoteFile').onchange = onNoteFile;
  $('dfPhotosFile').onchange = onPhotosFile;

  mountProductComposer();
  renderDeliveryLines();
  renderPhotoPreviews();
}

function renderPhotoPreviews() {
  const noteEl = $('dfNotePreview');
  if (noteEl) {
    noteEl.innerHTML = delNote?.url
      ? `<img class="thumb" src="${escapeHtml(delNote.url)}" alt="">`
      : delNote?.preview ? `<img class="thumb" src="${delNote.preview}" alt="">` : '';
  }
  const photosEl = $('dfPhotosPreview');
  if (photosEl) {
    photosEl.innerHTML = delPhotos.map((p) =>
      `<img class="thumb" src="${escapeHtml(p.url || p.preview)}" alt="">`
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
  const files = [...(e.target.files || [])];
  files.forEach((file) => {
    delPhotos.push({ id: rid('p'), file, preview: URL.createObjectURL(file) });
  });
  renderPhotoPreviews();
}

async function saveDelivery() {
  const supplierId = $('dfSupplier').value || null;
  const valid = delLines
    .filter((l) => l.productId && (
      hasQuantity(l.cases, l.singles)
      || parseQty(l.damagedQty)
      || hasQuantity(l.invoiceCases, l.invoiceSingles)
    ))
    .map((l) => {
      const stored = formToStored({ cases: l.cases, singles: l.singles });
      const invoice = hasQuantity(l.invoiceCases, l.invoiceSingles)
        ? formToStored({ cases: l.invoiceCases, singles: l.invoiceSingles })
        : null;
      return {
        product_id: l.productId,
        qty: stored.qty,
        singles: stored.singles,
        damaged_qty: parseQty(l.damagedQty),
        invoice_qty: invoice ? invoice.qty : null,
        invoice_singles: invoice ? invoice.singles : null,
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
      event_id: ctx.eventId,
      supplier_id: supplierId,
      delivered_at: $('dfDate').value ? new Date($('dfDate').value).toISOString() : new Date().toISOString(),
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

    closeSheet();
    deliveries = await DB.deliveries.forEvent(ctx.eventId);
    loadDeliveriesView();
    toast(editingId ? 'Delivery updated' : 'Delivery saved');
  } catch (err) {
    $('dfErr').textContent = err.message || 'Save failed';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save delivery';
  }
}

async function uploadPhotosAsync(deliveryId) {
  const DB = getDB();
  const patch = {};
  if (delNote?.file) {
    patch.delivery_note_url = await DB.uploadImage(
      DELIVERY_BUCKET,
      `${ctx.eventId}/${deliveryId}/note-${Date.now()}.jpg`,
      delNote.file
    );
  }
  const photoUrls = [];
  for (let i = 0; i < delPhotos.length; i++) {
    const p = delPhotos[i];
    if (p.file) {
      photoUrls.push(await DB.uploadImage(
        DELIVERY_BUCKET,
        `${ctx.eventId}/${deliveryId}/photo-${i}-${Date.now()}.jpg`,
        p.file
      ));
    } else if (p.url) photoUrls.push(p.url);
  }
  if (photoUrls.length) patch.photo_urls = photoUrls;
  if (Object.keys(patch).length) await DB.deliveries.update(deliveryId, patch);
}

async function deleteDelivery(id) {
  if (!confirm('Delete this delivery?')) return;
  try {
    const DB = getDB();
    await DB.deliveries.clearLines(id);
    await DB.deliveries.remove(id);
    deliveries = deliveries.filter((d) => d.id !== id);
    loadDeliveriesView();
    toast('Delivery deleted');
  } catch (err) {
    toast(err.message || 'Delete failed', true);
  }
}

export async function flushPendingDeliveries() {
  await flushQueue(getDB());
}
