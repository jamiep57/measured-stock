import { $, escapeHtml, rid, toast, nowLocalInput, fmtDateTime } from './lib/util.js';
import { getDB, productFromEvent } from './db.js';
import { entryMode } from './pack-metrics.js';
import { formToStored, storedToForm, hasQuantity, parseQty } from './stock-entry.js';
import { enqueueWrite, flushQueue } from './sync-queue.js';
import { openSheet, closeSheet } from './components/sheet.js';
import { mountSupplierSearch } from './components/supplier-search.js';

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
    el.innerHTML = '<div class="empty"><i class="ph ph-calendar-blank"></i><p>Select an event to log deliveries.</p></div>';
    return;
  }

  try {
    deliveries = await getDB().deliveries.forEvent(ctx.eventId);
  } catch (err) {
    el.innerHTML = `<div class="empty"><p>${escapeHtml(err.message)}</p></div>`;
    return;
  }

  el.innerHTML = `
    <button class="btn btn-primary btn-block btn-lg" type="button" id="newDelBtn"><i class="ph-bold ph-plus"></i> Log delivery</button>
    <div id="delList" style="margin-top:16px"></div>
  `;
  $('newDelBtn').onclick = () => openDeliveryForm();
  renderDeliveryList();
}

function renderDeliveryList() {
  const list = $('delList');
  if (!list) return;
  if (!deliveries.length) {
    list.innerHTML = '<div class="empty" style="padding:24px"><p>No deliveries yet.</p></div>';
    return;
  }
  list.innerHTML = deliveries.map((d) => {
    const sup = d.supplier?.name || '—';
    const lineCount = (d.lines || []).length;
    return `
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">${escapeHtml(sup)}</div>
            <div class="card-meta">${fmtDateTime(d.delivered_at)} · ${lineCount} product${lineCount !== 1 ? 's' : ''}${d.reference ? ' · ' + escapeHtml(d.reference) : ''}</div>
          </div>
          <div class="card-actions">
            <button class="btn btn-sm" type="button" data-edit="${d.id}"><i class="ph ph-pencil-simple"></i></button>
            <button class="btn btn-sm" type="button" data-del="${d.id}"><i class="ph ph-trash"></i></button>
          </div>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.onclick = () => openDeliveryForm(btn.dataset.edit);
  });
  list.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = () => deleteDelivery(btn.dataset.del);
  });
}

function productOptions() {
  return (ctx.event?.event_products || [])
    .map((ep) => ({
      id: ep.product_id,
      name: ep.product?.name || '(unknown)',
    }))
    .filter((o) => o.name && o.name !== '(unknown)')
    .sort((a, b) => a.name.localeCompare(b.name));
}

function lineHeaderHtml() {
  return `<div class="line-head"><span>Product</span><span style="text-align:center">Qty</span><span style="text-align:center">Extra</span><span style="text-align:center">Dmg</span><span style="text-align:center">Inv cs</span><span style="text-align:center">Inv sgl</span><span></span></div>`;
}

function renderDeliveryLines() {
  const wrap = $('dfLines');
  if (!wrap) return;
  const supplierId = $('dfSupplier')?.value || '';
  const opts = productOptions();

  wrap.innerHTML = delLines.map((line) => {
    const product = productFromEvent(ctx.event, line.productId);
    const mode = product ? entryMode(product, ctx.caseSizes) : { columnLabels: { primary: 'Cases', secondary: 'Singles' } };
    const primaryLabel = mode.columnLabels.primary.slice(0, 4);
    const secondaryLabel = mode.columnLabels.secondary ? mode.columnLabels.secondary.slice(0, 4) : '—';

    return `
      <div class="line-row" data-lid="${line.lineId}">
        <select class="df-product" data-lid="${line.lineId}">
          <option value="">— product —</option>
          ${opts.map((o) => `<option value="${o.id}"${o.id === line.productId ? ' selected' : ''}>${escapeHtml(o.name)}</option>`).join('')}
        </select>
        <input type="text" inputmode="decimal" autocomplete="off" class="df-cases num-math" data-lid="${line.lineId}" value="${escapeHtml(line.cases)}" placeholder="${escapeHtml(primaryLabel)}" title="${escapeHtml(mode.columnLabels.primary)}">
        <input type="text" inputmode="decimal" autocomplete="off" class="df-singles num-math" data-lid="${line.lineId}" value="${escapeHtml(line.singles)}" placeholder="${mode.columnLabels.secondary ? escapeHtml(secondaryLabel) : '—'}" ${mode.columnLabels.secondary ? '' : 'disabled'}>
        <input type="text" inputmode="decimal" autocomplete="off" class="df-dmg num-math" data-lid="${line.lineId}" value="${escapeHtml(line.damagedQty)}" placeholder="0">
        <input type="text" inputmode="decimal" autocomplete="off" class="df-inv-cases num-math" data-lid="${line.lineId}" value="${escapeHtml(line.invoiceCases)}" placeholder="0" title="Invoice cases">
        <input type="text" inputmode="decimal" autocomplete="off" class="df-inv-singles num-math" data-lid="${line.lineId}" value="${escapeHtml(line.invoiceSingles)}" placeholder="0" title="Invoice singles">
        <button type="button" class="btn btn-sm df-rm" data-lid="${line.lineId}">✕</button>
      </div>`;
  }).join('');

  wrap.querySelectorAll('.df-product').forEach((sel) => {
    sel.onchange = () => {
      const line = delLines.find((l) => l.lineId === sel.dataset.lid);
      if (line) line.productId = sel.value;
      renderDeliveryLines();
    };
  });
  wrap.querySelectorAll('.df-cases, .df-singles, .df-dmg, .df-inv-cases, .df-inv-singles').forEach((inp) => {
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
  wrap.querySelectorAll('.df-rm').forEach((btn) => {
    btn.onclick = () => {
      delLines = delLines.filter((l) => l.lineId !== btn.dataset.lid);
      if (!delLines.length) delLines.push(emptyLine());
      renderDeliveryLines();
    };
  });
}

function emptyLine() {
  return {
    lineId: rid('l'), productId: '', cases: '', singles: '', damagedQty: '', invoiceCases: '', invoiceSingles: '',
  };
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
        return {
          lineId: rid('l'),
          productId: l.product_id,
          cases: form.cases,
          singles: form.singles,
          damagedQty: l.damaged_qty ? String(l.damaged_qty) : '',
          invoiceCases: l.invoice_qty != null || l.invoice_singles
            ? storedToForm({ qty: l.invoice_qty, singles: l.invoice_singles }).cases
            : '',
          invoiceSingles: l.invoice_qty != null || l.invoice_singles
            ? storedToForm({ qty: l.invoice_qty, singles: l.invoice_singles }).singles
            : '',
        };
      })
      : [emptyLine()];
    delNote = d.delivery_note_url ? { url: d.delivery_note_url } : null;
    delPhotos = (d.photo_urls || []).map((u) => ({ id: rid('p'), url: u }));
    delDamages = (d.damages_photo_urls || []).map((u) => ({ id: rid('d'), url: u }));
  } else {
    delLines = [emptyLine()];
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
      <div class="field"><label>Products</label>
        ${lineHeaderHtml()}
        <div id="dfLines"></div>
        <button class="btn btn-sm" type="button" id="dfAddLine" style="margin-top:4px"><i class="ph ph-plus"></i> Add product</button>
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
      <button class="btn btn-block" type="button" id="dfCancel">Cancel</button>
      <button class="btn btn-primary btn-block" type="button" id="dfSave">Save delivery</button>`,
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
    onSelect: () => renderDeliveryLines(),
  });

  $('dfCancel').onclick = closeSheet;
  $('dfSave').onclick = saveDelivery;
  $('dfAddLine').onclick = () => { delLines.push(emptyLine()); renderDeliveryLines(); };
  $('dfNoteFile').onchange = onNoteFile;
  $('dfPhotosFile').onchange = onPhotosFile;

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
