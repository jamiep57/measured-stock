/**
 * Measured mobile Wastage tab — batch list + sheet form.
 */
import { $, escapeHtml, rid, toast, nowLocalInput, fmtDateTime } from './lib/util.js';
import { getDB, productFromEvent, loadCategories } from './db.js';
import { formToStored, storedToForm, hasQuantity } from './stock-entry.js';
import { entryMode } from './pack-metrics.js';
import { openSheet, closeSheet } from './components/sheet.js';
import { mountProductSearch } from './components/product-search.js';
import { confirmDialog } from './components/modal.js';

const WASTAGE_REASONS = [
  'Breakage / spillage',
  'Out of date',
  'Recipe testing',
  'Quality / unsellable',
  'Comp / staff drink',
  'Other',
];

/** @type {{ eventId: string, event: object | null, caseSizes?: any[] } | null} */
let ctx = null;
let batches = [];
let editingId = null;
/** @type {Array<{ lineId: string, productId: string, cases: string, singles: string }>} */
let wstLines = [];
let categories = [];

export function initWastage(context) {
  ctx = context;
}

export function startNewWastage() {
  if (!ctx?.eventId) {
    toast('Choose an event first', true);
    return;
  }
  openWastageForm();
}

export async function loadWastageView() {
  const el = $('view-wastage');
  if (!el) return;

  if (!ctx?.eventId) {
    el.innerHTML = `
      <div class="empty empty--panel">
        <span class="empty-icon" aria-hidden="true"><i class="ph ph-calendar-blank"></i></span>
        <p class="empty-title">Choose an event</p>
        <p class="empty-copy">Select an event in the top bar to log wastage.</p>
      </div>`;
    return;
  }

  try {
    batches = await getDB().wastage.forEvent(ctx.eventId);
  } catch (err) {
    el.innerHTML = `
      <div class="empty empty--panel">
        <span class="empty-icon" aria-hidden="true"><i class="ph ph-warning-circle"></i></span>
        <p class="empty-title">Couldn’t load wastage</p>
        <p class="empty-copy">${escapeHtml(err.message)}</p>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="page-hero page-hero--compact">
      <p class="page-kicker">Stock</p>
      <h1 class="page-title">Wastage</h1>
      <p class="page-sub">Log breakage, comps, and unsellable stock.</p>
    </div>
    <div id="wstList" class="session-list"></div>
  `;
  renderWastageList();
}

function renderWastageList() {
  const list = $('wstList');
  if (!list) return;
  if (!batches.length) {
    list.innerHTML = `
      <div class="empty empty--panel">
        <span class="empty-icon" aria-hidden="true"><i class="ph ph-trash"></i></span>
        <p class="empty-title">No wastage yet</p>
        <p class="empty-copy">Tap + to log the first write-off for this event.</p>
      </div>`;
    return;
  }

  list.innerHTML = `
    <h2 class="section-label">Recent</h2>
    ${batches.map((b) => {
      const reason = b.reason || 'Wastage';
      const lineCount = (b.lines || []).length;
      const when = b.recorded_at || b.created_at;
      return `
        <div class="session-card">
          <button type="button" class="session-card-main" data-edit="${escapeHtml(b.id)}">
            <span class="session-card-title">${escapeHtml(reason)}</span>
            <span class="session-card-meta">${fmtDateTime(when)} · ${lineCount} product${lineCount !== 1 ? 's' : ''}</span>
          </button>
          <button class="icon-btn session-card-del" type="button" data-del="${escapeHtml(b.id)}" aria-label="Delete">
            <i class="ph ph-trash"></i>
          </button>
        </div>`;
    }).join('')}`;

  list.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.onclick = async () => openWastageForm(btn.dataset.edit);
  });
  list.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      deleteWastage(btn.dataset.del);
    };
  });
}

function qtyFieldsHtml(line) {
  const product = productFromEvent(ctx.event, line.productId);
  const mode = product
    ? entryMode(product, ctx.caseSizes)
    : { columnLabels: { primary: 'Cases', secondary: 'Singles' } };
  const primary = mode.columnLabels.primary;
  const secondary = mode.columnLabels.secondary;
  const lid = escapeHtml(line.lineId);
  return `
    <div class="del-qty">
      <div class="del-qty-row del-qty-row--2">
        <div class="del-qty-field">
          <label>${escapeHtml(primary)}</label>
          <input type="text" inputmode="decimal" autocomplete="off" class="wf-cases num-math" data-lid="${lid}"
            value="${escapeHtml(line.cases)}" placeholder="0" aria-label="${escapeHtml(primary)}">
        </div>
        <div class="del-qty-field">
          <label>${secondary ? escapeHtml(secondary) : '—'}</label>
          <input type="text" inputmode="decimal" autocomplete="off" class="wf-singles num-math" data-lid="${lid}"
            value="${escapeHtml(line.singles)}" placeholder="0"
            aria-label="${secondary ? escapeHtml(secondary) : 'Singles'}"
            ${secondary ? '' : 'disabled'}>
        </div>
      </div>
    </div>`;
}

function renderLines() {
  const wrap = $('wfLines');
  if (!wrap) return;
  if (!wstLines.length) {
    wrap.innerHTML = `<p class="muted del-empty-lines">No products yet — search below to add.</p>`;
    return;
  }
  wrap.innerHTML = wstLines.map((line) => {
    const p = productFromEvent(ctx.event, line.productId);
    return `
      <div class="del-line" data-lid="${escapeHtml(line.lineId)}">
        <div class="del-line-head">
          <span class="del-line-name">${escapeHtml(p?.name || 'Product')}</span>
          <button type="button" class="icon-btn del-line-remove" data-lid="${escapeHtml(line.lineId)}" aria-label="Remove">
            <i class="ph ph-x"></i>
          </button>
        </div>
        ${qtyFieldsHtml(line)}
      </div>`;
  }).join('');

  wrap.querySelectorAll('.wf-cases').forEach((input) => {
    input.oninput = () => {
      const line = wstLines.find((l) => l.lineId === input.dataset.lid);
      if (line) line.cases = input.value;
    };
  });
  wrap.querySelectorAll('.wf-singles').forEach((input) => {
    input.oninput = () => {
      const line = wstLines.find((l) => l.lineId === input.dataset.lid);
      if (line) line.singles = input.value;
    };
  });
  wrap.querySelectorAll('.del-line-remove').forEach((btn) => {
    btn.onclick = async () => {
      wstLines = wstLines.filter((l) => l.lineId !== btn.dataset.lid);
      renderLines();
    };
  });
}

function mountProductComposer() {
  const mount = $('wfProductMount');
  if (!mount || !ctx.event) return;
  mountProductSearch(mount, {
    event: ctx.event,
    categories,
    placeholder: 'Add product…',
    onSelect: (productId) => {
      if (!productId) return;
      if (wstLines.some((l) => l.productId === productId)) {
        toast('Already on the list', true);
        return;
      }
      wstLines.push({
        lineId: rid('l'),
        productId,
        cases: '',
        singles: '',
      });
      renderLines();
      const input = mount.querySelector('input');
      const list = mount.querySelector('.product-search-list');
      if (input) input.value = '';
      if (list) list.hidden = true;
    },
  });
}

async function saveWastage() {
  const valid = wstLines
    .filter((l) => l.productId && hasQuantity(l.cases, l.singles))
    .map((l) => {
      const stored = formToStored({ cases: l.cases, singles: l.singles });
      return {
        product_id: l.productId,
        qty: stored.qty,
        singles: stored.singles,
      };
    });

  if (!valid.length) {
    const err = $('wfErr');
    if (err) err.textContent = 'Add at least one product with a quantity.';
    return;
  }

  const btn = $('wfSave');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving…';
  }

  try {
    const DB = getDB();
    const head = {
      event_id: ctx.eventId,
      unit: 'cases',
      reason: ($('wfReason')?.value || '').trim() || null,
      recorded_at: $('wfDate')?.value
        ? new Date($('wfDate').value).toISOString()
        : new Date().toISOString(),
      notes: ($('wfNotes')?.value || '').trim() || null,
    };

    let batchId = editingId;
    if (editingId) {
      await DB.wastage.update(editingId, head);
      await DB.wastage.clearLines(editingId);
    } else {
      const created = await DB.wastage.create(head);
      batchId = created.id;
    }

    try {
      await DB.wastage.addLines(valid.map((v) => ({ batch_id: batchId, ...v })));
    } catch (lineErr) {
      const msg = String(lineErr?.message || lineErr);
      if (!/singles/i.test(msg)) throw lineErr;
      await DB.wastage.addLines(valid.map((v) => {
        const p = productFromEvent(ctx.event, v.product_id);
        const ups = p?.units_per_case > 0 ? Number(p.units_per_case) : 1;
        return {
          batch_id: batchId,
          product_id: v.product_id,
          qty: v.qty + v.singles / ups,
        };
      }));
    }

    closeSheet();
    toast(editingId ? 'Wastage updated' : 'Wastage saved');
    await loadWastageView();
  } catch (err) {
    const el = $('wfErr');
    if (el) el.textContent = err.message || 'Save failed';
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = editingId ? 'Update wastage' : 'Save wastage';
    }
  }
}

async function deleteWastage(id) {
  if (!(await confirmDialog({ title: 'Confirm', message: 'Delete this wastage entry?', confirmLabel: 'Delete', danger: true }))) return;
  try {
    const DB = getDB();
    await DB.wastage.clearLines(id);
    await DB.wastage.remove(id);
    toast('Wastage deleted');
    await loadWastageView();
  } catch (err) {
    toast(err.message || 'Delete failed', true);
  }
}

async function openWastageForm(editId) {
  editingId = editId || null;
  wstLines = [];

  if (editId) {
    const b = batches.find((x) => x.id === editId);
    if (!b) return;
    wstLines = (b.lines || []).map((l) => {
      const form = storedToForm(l);
      return {
        lineId: rid('l'),
        productId: l.product_id,
        cases: form.cases,
        singles: form.singles,
      };
    });
  }

  try {
    categories = await loadCategories();
  } catch {
    categories = [];
  }

  const reasonOptions = [
    '<option value="">— Select reason —</option>',
    ...WASTAGE_REASONS.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`),
  ].join('');

  const existing = editId ? batches.find((x) => x.id === editId) : null;

  openSheet({
    title: editingId ? 'Edit wastage' : 'Log wastage',
    bodyHtml: `
      <div class="del-form">
        <div class="del-form-err" id="wfErr"></div>
        <div class="field">
          <label for="wfDate">Recorded on</label>
          <input type="datetime-local" id="wfDate">
        </div>
        <div class="field">
          <label for="wfReason">Reason</label>
          <select id="wfReason">${reasonOptions}</select>
        </div>
        <div class="field">
          <label for="wfNotes">Notes</label>
          <textarea id="wfNotes" rows="2" placeholder="Optional">${escapeHtml(existing?.notes || '')}</textarea>
        </div>
        <div class="field">
          <label>Products</label>
          <div id="wfLines"></div>
          <div id="wfProductMount" class="del-product-mount"></div>
        </div>
      </div>`,
    footHtml: `
      <button type="button" class="btn btn-ghost" id="wfCancel">Cancel</button>
      <button type="button" class="btn btn-primary" id="wfSave">${editingId ? 'Update wastage' : 'Save wastage'}</button>`,
  });

  const dateEl = $('wfDate');
  if (dateEl) {
    if (existing?.recorded_at) {
      const dt = new Date(existing.recorded_at);
      dateEl.value = new Date(dt - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    } else {
      dateEl.value = nowLocalInput();
    }
  }
  if (existing?.reason) {
    const sel = $('wfReason');
    if (sel) sel.value = existing.reason;
  }

  $('wfCancel').onclick = closeSheet;
  $('wfSave').onclick = async () => saveWastage();
  renderLines();
  mountProductComposer();
}
