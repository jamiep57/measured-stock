/**
 * Measured mobile Transfers tab — list, create, edit, delete.
 */
import { $, escapeHtml, rid, toast, nowLocalInput, fmtDateTime } from './lib/util.js';
import { getDB, productFromEvent, loadCategories } from './db.js';
import { entryMode, productStockPack } from './pack-metrics.js';
import { formToStored, storedToForm, hasQuantity } from './stock-entry.js';
import { openSheet, closeSheet } from './components/sheet.js';
import { mountProductSearch } from './components/product-search.js';
import { mountSearchSelect } from './components/search-select.js';
import {
import { confirmDialog } from 'components/modal.js';
  parseSourceValue,
  transferSourceFromSaved,
  transferDestValueFromSaved,
  transferSourceLabel,
  transferDestLabel,
  sourceSelectItems,
  destSelectItems,
  buildTransferPayload,
  lineCasesFromForm,
  lineCasesFromDb,
  adjustWarehouseStock,
  loadWarehousesList,
} from './lib/transfer-form.js';

/** @type {{ eventId: string, event: object | null, caseSizes?: any[] } | null} */
let ctx = null;
let transfers = [];
let warehouses = [];
let categories = [];
let editingId = null;
/** @type {{ type: string, id: string } | null} */
let xferSource = null;
/** @type {Array<{ lineId: string, productId: string, cases: string, singles: string }>} */
let xferLines = [];
/** @type {ReturnType<typeof mountSearchSelect> | null} */
let sourcePicker = null;
/** @type {ReturnType<typeof mountSearchSelect> | null} */
let destPicker = null;

export function initTransfers(context) {
  ctx = context;
}

export function startNewTransfer() {
  if (!ctx?.eventId) {
    toast('Choose an event first', true);
    return;
  }
  openTransferForm();
}

export async function loadTransfersView() {
  const el = $('view-transfers');
  if (!el) return;

  if (!ctx?.eventId) {
    el.innerHTML = `
      <div class="empty empty--panel">
        <span class="empty-icon" aria-hidden="true"><i class="ph ph-calendar-blank"></i></span>
        <p class="empty-title">Choose an event</p>
        <p class="empty-copy">Select an event in the top bar to log transfers.</p>
      </div>`;
    return;
  }

  try {
    const DB = getDB();
    const [rows, wh] = await Promise.all([
      DB.transfers.forEvent(ctx.eventId),
      loadWarehousesList(),
    ]);
    transfers = rows || [];
    warehouses = wh || [];
  } catch (err) {
    el.innerHTML = `
      <div class="empty empty--panel">
        <span class="empty-icon" aria-hidden="true"><i class="ph ph-warning-circle"></i></span>
        <p class="empty-title">Couldn’t load transfers</p>
        <p class="empty-copy">${escapeHtml(err.message)}</p>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="page-hero page-hero--compact">
      <p class="page-kicker">Stock</p>
      <h1 class="page-title">Transfers</h1>
      <p class="page-sub">Move stock between bars and locations.</p>
    </div>
    <div id="xferList" class="session-list"></div>
  `;
  renderTransferList();
}

function renderTransferList() {
  const list = $('xferList');
  if (!list) return;
  if (!transfers.length) {
    list.innerHTML = `
      <div class="empty empty--panel">
        <span class="empty-icon" aria-hidden="true"><i class="ph ph-arrows-left-right"></i></span>
        <p class="empty-title">No transfers yet</p>
        <p class="empty-copy">Tap + to log the first transfer for this event.</p>
      </div>`;
    return;
  }

  list.innerHTML = `
    <h2 class="section-label">Recent</h2>
    ${transfers.map((t) => {
    const dest = transferDestLabel(t, ctx.event, warehouses);
    const source = transferSourceLabel(t, ctx.event, warehouses);
    const lineCount = (t.lines || []).length;
    return `
      <div class="session-card">
        <button type="button" class="session-card-main" data-edit="${escapeHtml(t.id)}">
          <span class="session-card-title">${escapeHtml(dest)}</span>
          <span class="session-card-meta">From ${escapeHtml(source)} · ${fmtDateTime(t.transferred_at)} · ${lineCount} product${lineCount !== 1 ? 's' : ''}</span>
        </button>
        <button class="icon-btn session-card-del" type="button" data-del="${escapeHtml(t.id)}" aria-label="Delete">
          <i class="ph ph-trash"></i>
        </button>
      </div>`;
  }).join('')}`;

  list.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.onclick = async () => openTransferForm(btn.dataset.edit);
  });
  list.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      deleteTransfer(btn.dataset.del);
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
          <input type="text" inputmode="decimal" autocomplete="off" class="xf-cases num-math" data-lid="${lid}"
            value="${escapeHtml(line.cases)}" placeholder="0" aria-label="${escapeHtml(primary)}">
        </div>
        <div class="del-qty-field">
          <label>${secondary ? escapeHtml(secondary) : '—'}</label>
          <input type="text" inputmode="decimal" autocomplete="off" class="xf-singles num-math" data-lid="${lid}"
            value="${escapeHtml(line.singles)}" placeholder="0"
            aria-label="${secondary ? escapeHtml(secondary) : 'Singles'}"
            ${secondary ? '' : 'disabled'}>
        </div>
      </div>
    </div>`;
}

function wireLineQtyInputs(root) {
  root.querySelectorAll('.xf-cases, .xf-singles').forEach((inp) => {
    inp.oninput = () => {
      const line = xferLines.find((l) => l.lineId === inp.dataset.lid);
      if (!line) return;
      if (inp.classList.contains('xf-cases')) line.cases = inp.value;
      else line.singles = inp.value;
    };
  });
}

function renderTransferLines() {
  const wrap = $('xfLines');
  if (!wrap) return;

  if (!xferLines.length) {
    wrap.innerHTML = `<p class="del-lines-empty">Search above to add products.</p>`;
    return;
  }

  wrap.innerHTML = xferLines.map((line) => {
    const product = productFromEvent(ctx.event, line.productId);
    const name = product?.name || 'Product';
    const pack = productStockPack(product, ctx.caseSizes || []);
    const packLabel = pack?.label || product?.case_size || '';
    return `
      <div class="del-line-card" data-lid="${line.lineId}">
        <div class="del-line-card-head">
          <div class="del-line-card-main">
            <div class="del-line-card-name">${escapeHtml(name)}</div>
            ${packLabel ? `<div class="del-line-card-pack">${escapeHtml(packLabel)}</div>` : ''}
          </div>
          <button type="button" class="icon-btn del-line-remove" data-lid="${line.lineId}"
            aria-label="Remove ${escapeHtml(name)}">
            <i class="ph ph-x"></i>
          </button>
        </div>
        ${qtyFieldsHtml(line)}
      </div>`;
  }).join('');

  wireLineQtyInputs(wrap);
  wrap.querySelectorAll('.del-line-remove').forEach((btn) => {
    btn.onclick = async () => {
      xferLines = xferLines.filter((l) => l.lineId !== btn.dataset.lid);
      renderTransferLines();
    };
  });
}

function currentSourceValue() {
  return xferSource ? `${xferSource.type}:${xferSource.id}` : '';
}

function currentDestValue() {
  return destPicker?.getValue?.() || $('xfDest')?.value || '';
}

function refreshSourceSelect() {
  const mount = $('xfSourceMount');
  if (!mount) return;
  const value = currentSourceValue();
  sourcePicker = mountSearchSelect(mount, {
    options: sourceSelectItems(ctx.event, warehouses),
    value,
    placeholder: 'Search source…',
    emptyLabel: '— Select source —',
    allowEmpty: true,
    hiddenId: 'xfSource',
    inputId: 'xfSourceInput',
    inputClass: 'search-select-input',
    onSelect: () => onSourceChange(),
  });
}

function refreshDestSelect(preserveValue = true) {
  const mount = $('xfDestMount');
  if (!mount) return;
  const prev = preserveValue ? currentDestValue() : '';
  const options = destSelectItems(ctx.event, warehouses, xferSource);
  const stillValid = prev && options.some((o) => o.value === prev);
  destPicker = mountSearchSelect(mount, {
    options,
    value: stillValid ? prev : '',
    placeholder: 'Search destination…',
    emptyLabel: '— Select destination —',
    allowEmpty: true,
    hiddenId: 'xfDest',
    inputId: 'xfDestInput',
    inputClass: 'search-select-input',
  });
}

function onSourceChange() {
  xferSource = parseSourceValue(sourcePicker?.getValue?.() || $('xfSource')?.value);
  const destVal = currentDestValue();
  if (xferSource && destVal) {
    const dv = parseSourceValue(destVal);
    const siteCollision = xferSource.type === 'site' && dv && (dv.type === 'event' || dv.type === 'bar');
    if (dv && (siteCollision
      || (dv.type === 'event' && xferSource.type === 'event')
      || (dv.type === 'bar' && xferSource.type === 'bar' && dv.id === xferSource.id))) {
      destPicker?.setValue?.('', { silent: true });
    }
  }
  refreshDestSelect(true);
  const err = $('xfErr');
  if (err) err.textContent = '';
  mountProductComposer();
}

async function createProductForTransfer({ name, category_id, case_size_id }) {
  const DB = getDB();
  const cs = (ctx.caseSizes || []).find((c) => c.id === case_size_id);
  const category = categories.find((c) => c.id === category_id);
  const created = await DB.products.create({
    name: name.trim(),
    category_id: category_id || null,
    case_size_id: case_size_id || null,
    case_size: cs?.label || null,
    units_per_case: cs?.units_per_case ?? 1,
  });

  const ep = await DB.eventProducts.setForEvent(ctx.eventId, created.id, {});
  const product = {
    ...created,
    category: category
      ? { id: category.id, name: category.name, colour_key: category.colour_key }
      : null,
  };
  if (ctx.event) {
    ctx.event.event_products = [...(ctx.event.event_products || []), {
      id: ep.id,
      event_id: ctx.eventId,
      product_id: created.id,
      product,
    }];
  }

  return { productId: created.id, product };
}

function addProductLine(productId) {
  const lineId = rid('l');
  xferLines.push({ lineId, productId, cases: '', singles: '' });
  const err = $('xfErr');
  if (err) err.textContent = '';
  renderTransferLines();
  return lineId;
}

function mountProductComposer() {
  const el = $('xfProductSearch');
  if (!el) return;

  mountProductSearch(el, {
    products: ctx.event?.event_products || [],
    caseSizes: ctx.caseSizes || [],
    categories,
    value: '',
    placeholder: xferSource ? 'Search product to add…' : 'Select a source first…',
    allowCreate: !!xferSource,
    createContextLabel: 'this transfer',
    dropdownFixed: false,
    onCreateProduct: createProductForTransfer,
    onSelect: ({ productId }) => {
      const lineId = addProductLine(productId);
      mountProductComposer();
      requestAnimationFrame(() => {
        const input = el.querySelector('.product-search-input');
        const list = el.querySelector('.product-search-list');
        if (input) input.value = '';
        if (list) list.hidden = true;
        $('xfLines')?.querySelector(`.xf-cases[data-lid="${lineId}"]`)?.focus();
      });
    },
  });
}

async function openTransferForm(editId) {
  editingId = editId || null;
  xferLines = [];

  if (!warehouses.length) {
    warehouses = await loadWarehousesList();
  }
  try {
    categories = await loadCategories();
  } catch {
    categories = [];
  }

  if (editId) {
    const t = transfers.find((x) => x.id === editId);
    if (!t) return;
    xferSource = transferSourceFromSaved(t);
    xferLines = (t.lines || []).map((l) => {
      const form = storedToForm(l);
      return {
        lineId: rid('l'),
        productId: l.product_id,
        cases: form.cases,
        singles: form.singles,
      };
    });
  } else {
    xferSource = ctx.event ? { type: 'event', id: ctx.event.id } : null;
  }

  openSheet({
    title: editingId ? 'Edit transfer' : 'Log transfer',
    bodyHtml: `
      <div class="err" id="xfErr"></div>
      <div class="field">
        <label for="xfSourceInput">Stock comes from</label>
        <div id="xfSourceMount"></div>
      </div>
      <div class="field">
        <label for="xfDestInput">Transfer to</label>
        <div id="xfDestMount"></div>
      </div>
      <div class="field">
        <label for="xfDate">Transferred on</label>
        <input type="datetime-local" id="xfDate">
      </div>
      <div class="field del-products">
        <label>Products</label>
        <div id="xfProductSearch" class="del-line-composer"></div>
        <div id="xfLines" class="del-lines-committed"></div>
      </div>`,
    footHtml: `
      <div class="sheet-foot-row">
        <button class="btn" type="button" id="xfCancel">Cancel</button>
        <button class="btn btn-primary" type="button" id="xfSave">${editingId ? 'Update transfer' : 'Save transfer'}</button>
      </div>`,
    onClose: () => {
      editingId = null;
      xferSource = null;
      xferLines = [];
      sourcePicker = null;
      destPicker = null;
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
    destPicker?.setValue?.(transferDestValueFromSaved(editTransfer), { silent: true });
  } else {
    $('xfDate').value = nowLocalInput();
  }

  $('xfCancel').onclick = closeSheet;
  $('xfSave').onclick = async () => saveTransfer();
  mountProductComposer();
  renderTransferLines();
}

async function saveTransfer() {
  const errEl = $('xfErr');
  if (errEl) errEl.textContent = '';

  if (!xferSource) {
    if (errEl) errEl.textContent = 'Pick where the stock is coming from.';
    return;
  }
  const dest = parseSourceValue(currentDestValue());
  if (!dest) {
    if (errEl) errEl.textContent = 'Select where the stock is going.';
    return;
  }
  if (xferSource.type === 'site' && (dest.type === 'event' || dest.type === 'bar')) {
    if (errEl) errEl.textContent = 'Destination must be outside the event — pick a recipient or warehouse.';
    return;
  }
  if ((dest.type === 'event' && xferSource.type === 'event')
    || (dest.type === 'bar' && xferSource.type === 'bar' && dest.id === xferSource.id)) {
    if (errEl) errEl.textContent = 'Source and destination are the same location.';
    return;
  }

  const valid = xferLines.filter((l) => l.productId && hasQuantity(l.cases, l.singles));
  if (!valid.length) {
    if (errEl) errEl.textContent = 'Add at least one product with a quantity.';
    return;
  }

  const saveBtn = $('xfSave');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
  }

  const isEdit = !!editingId;
  const prevTransfer = isEdit ? transfers.find((x) => x.id === editingId) : null;
  const isWarehouseSource = xferSource.type === 'warehouse';
  const destIsWarehouse = dest.type === 'warehouse';
  const transferredAt = $('xfDate').value
    ? new Date($('xfDate').value).toISOString()
    : new Date().toISOString();

  try {
    const DB = getDB();
    const payload = buildTransferPayload({
      eventId: ctx.eventId,
      xferSource,
      dest,
      transferredAt,
    });

    if (isEdit && prevTransfer) {
      if (prevTransfer.from_warehouse_id) {
        await Promise.all((prevTransfer.lines || []).map(async (l) => {
          await adjustWarehouseStock(
            prevTransfer.from_warehouse_id,
            l.product_id,
            lineCasesFromDb(l, ctx.event, ctx.caseSizes || []),
          );
        }));
      }
      if (prevTransfer.to_warehouse_id) {
        await Promise.all((prevTransfer.lines || []).map(async (l) => {
          await adjustWarehouseStock(
            prevTransfer.to_warehouse_id,
            l.product_id,
            -lineCasesFromDb(l, ctx.event, ctx.caseSizes || []),
          );
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
        qty: Math.round(lineCasesFromForm(l, ctx.event, ctx.caseSizes || []) * 10000) / 10000,
        unit_cost: 0,
        chargeback_applied: false,
      })));
    }

    if (isWarehouseSource) {
      await Promise.all(savedLines.map(async (l) => {
        const formLine = valid.find((v) => v.productId === l.product_id) || {};
        await adjustWarehouseStock(
          xferSource.id,
          l.product_id,
          -lineCasesFromForm(formLine, ctx.event, ctx.caseSizes || []),
        );
      }));
    }
    if (destIsWarehouse) {
      await Promise.all(savedLines.map(async (l) => {
        const formLine = valid.find((v) => v.productId === l.product_id) || {};
        await adjustWarehouseStock(
          dest.id,
          l.product_id,
          lineCasesFromForm(formLine, ctx.event, ctx.caseSizes || []),
        );
      }));
    }

    closeSheet();
    await loadTransfersView();
    toast(isEdit ? 'Transfer updated' : 'Transfer saved');
  } catch (err) {
    if (errEl) errEl.textContent = err.message || (isEdit ? 'Failed to update transfer' : 'Failed to log transfer');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? 'Update transfer' : 'Save transfer';
    }
  }
}

async function deleteTransfer(id) {
  if (!(await confirmDialog({ title: 'Confirm', message: 'Delete this transfer? Warehouse stock will be restored where applicable.', confirmLabel: 'Delete', danger: true }))) return;
  const t = transfers.find((x) => x.id === id);
  const lines = t?.lines || [];
  try {
    const DB = getDB();
    if (t?.from_warehouse_id) {
      await Promise.all(lines.map(async (l) => {
        await adjustWarehouseStock(
          t.from_warehouse_id,
          l.product_id,
          lineCasesFromDb(l, ctx.event, ctx.caseSizes || []),
        );
      }));
    }
    if (t?.to_warehouse_id) {
      await Promise.all(lines.map(async (l) => {
        await adjustWarehouseStock(
          t.to_warehouse_id,
          l.product_id,
          -lineCasesFromDb(l, ctx.event, ctx.caseSizes || []),
        );
      }));
    }
    await DB.transfers.clearLines(id);
    await DB.transfers.remove(id);
    transfers = transfers.filter((x) => x.id !== id);
    await loadTransfersView();
    toast('Transfer deleted');
  } catch (err) {
    toast(err.message || 'Delete failed', true);
  }
}
