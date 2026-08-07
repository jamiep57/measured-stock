/**
 * Admin wastage panel — batch list + sheet form (reason, product lines, notes).
 */

import {
  $, escapeHtml, rid, toast, nowLocalInput, fmtDateTime,
} from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import {
  getDB, loadEventLite, loadCaseSizes, loadCategories, productFromEvent,
} from '../../db.js';
import {
  formToStored, storedToForm, hasQuantity, totalUnitsForProduct,
} from '../../stock-entry.js';
import { productStockPack } from '../../pack-metrics.js';
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

const WASTAGE_REASONS = [
  'Breakage / spillage',
  'Out of date',
  'Recipe testing',
  'Quality / unsellable',
  'Comp / staff drink',
  'Other',
];

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

function batchDate(b) {
  return b.recorded_at || b.created_at || '';
}

function sortBatches(list, sort) {
  const items = list.slice();
  const dir = sort === 'date-asc' ? 1 : -1;
  items.sort((a, b) => {
    const ta = new Date(batchDate(a) || 0).getTime();
    const tb = new Date(batchDate(b) || 0).getTime();
    return (ta - tb) * dir;
  });
  return items;
}

function fmtGbp(n) {
  if (n == null || !Number.isFinite(n)) return '£0';
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}

function lineParts(l, event, caseSizes) {
  const p = productFromEvent(event, l.product_id);
  const name = p?.name || 'Product';
  const pack = productStockPack(p, caseSizes);
  const packLabel = pack?.label || p?.case_size || '';
  const form = storedToForm(l);
  const parts = [];
  if (form.cases) parts.push(`${form.cases} cases`);
  if (form.singles) parts.push(`${form.singles} singles`);
  return { name, packLabel, qty: parts.join(', ') };
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

function productIds(batch) {
  return (batch.lines || []).map((l) => l.product_id).filter(Boolean);
}

function productNamesHaystack(lines, event) {
  return (lines || []).map((l) => {
    const p = productFromEvent(event, l.product_id);
    return (p?.name || '').toLowerCase();
  }).join(' ');
}

function batchCaseTotal(lines, event, caseSizes) {
  return (lines || []).reduce((sum, l) => {
    const p = productFromEvent(event, l.product_id);
    const form = storedToForm(l);
    return sum + totalUnitsForProduct(form.cases, form.singles, p, caseSizes);
  }, 0);
}

function batchValue(lines, event, caseSizes) {
  return (lines || []).reduce((sum, l) => {
    const p = productFromEvent(event, l.product_id);
    if (p?.case_price == null) return sum;
    const form = storedToForm(l);
    const cases = totalUnitsForProduct(form.cases, form.singles, p, caseSizes);
    return sum + cases * Number(p.case_price);
  }, 0);
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

function renderShell() {
  return `
    <div class="admin-page wst-panel">
      <div class="wst-stats" id="wstStats" hidden></div>
      <div class="del-list" id="wstList">
        <div class="del-loading">${loadingWidget('Loading wastage…')}</div>
      </div>
    </div>`;
}

function renderStats(batches, event, caseSizes) {
  const count = batches.length;
  const cases = batches.reduce((s, b) => s + batchCaseTotal(b.lines, event, caseSizes), 0);
  const value = batches.reduce((s, b) => s + batchValue(b.lines, event, caseSizes), 0);
  return `
    <div class="wst-stat">
      <span class="wst-stat-label">Entries</span>
      <span class="wst-stat-value">${count}</span>
    </div>
    <div class="wst-stat">
      <span class="wst-stat-label">Cases wasted</span>
      <span class="wst-stat-value">${Math.round(cases * 10) / 10}</span>
    </div>
    <div class="wst-stat">
      <span class="wst-stat-label">Value lost</span>
      <span class="wst-stat-value">${escapeHtml(fmtGbp(value))}</span>
    </div>`;
}

function renderList(batches, event, caseSizes) {
  if (!batches.length) {
    return emptyState({
      iconHtml: icon('trash', { size: 22 }),
      title: 'No wastage yet',
      copy: 'Log the first entry to record write-offs.',
      variant: 'admin',
      ctaHtml: `<button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-empty-cta="log-wastage">Log wastage</button>`,
    });
  }

  return batches.map((b) => {
    const reason = b.reason || 'Wastage';
    const lineCount = (b.lines || []).length;
    const lineList = renderLineList(b.lines, event, caseSizes);
    const ids = productIds(b).join(',');
    const cases = Math.round(batchCaseTotal(b.lines, event, caseSizes) * 10) / 10;
    const value = batchValue(b.lines, event, caseSizes);
    const when = b.recorded_at || b.created_at;

    return `
      <article class="del-card wst-card" data-batch-id="${escapeHtml(b.id)}"
        data-product-ids="${escapeHtml(ids)}"
        data-product-names="${escapeHtml(productNamesHaystack(b.lines, event))}">
        <div class="del-card-main del-card-main--stacked">
          <div class="del-card-head">
            <div class="del-card-body">
              <h3 class="del-card-title">${escapeHtml(reason)}</h3>
              <p class="del-card-meta">
                ${escapeHtml(fmtDateTime(when))}
                · ${lineCount} product${lineCount !== 1 ? 's' : ''}
                · ${cases} cases
                ${value > 0 ? ` · ${escapeHtml(fmtGbp(value))}` : ''}
              </p>
            </div>
            <div class="del-card-actions">
              <button type="button" class="topbar-tool del-card-action" data-edit="${escapeHtml(b.id)}"
                title="Edit wastage" aria-label="Edit wastage">
                ${icon('pencil', { size: 16 })}
              </button>
              <button type="button" class="topbar-tool del-card-action del-card-action--danger" data-del="${escapeHtml(b.id)}"
                title="Delete wastage" aria-label="Delete wastage">
                ${icon('trash', { size: 16 })}
              </button>
            </div>
          </div>
          ${lineList}
          ${b.notes ? `<p class="wst-card-notes">${escapeHtml(b.notes)}</p>` : ''}
        </div>
      </article>`;
  }).join('');
}

export function renderWastageShell() {
  return renderShell();
}

export function mountWastagePanel(route) {
  const listEl = $('wstList');
  const statsEl = $('wstStats');
  if (!listEl) return () => {};

  let event = null;
  let categories = [];
  let caseSizes = [];
  let batches = [];
  let editingId = null;
  let wstLines = [];
  let dates = { from: '', to: '' };
  let sortKey = 'date-desc';

  const seeded = getTableFilterValues('wastage');
  if (seeded) {
    dates = {
      from: seeded.dates?.from || '',
      to: seeded.dates?.to || '',
    };
    sortKey = seeded.sort || 'date-desc';
  }

  function visibleBatches() {
    let list = batches.filter((b) => inDateRange(batchDate(b), dates));
    return sortBatches(list, sortKey);
  }

  function applyProductFilter({ query, productId } = {}) {
    const q = (query || '').trim().toLowerCase();
    const filtering = Boolean(productId || q);
    listEl.querySelectorAll('.wst-card').forEach((card) => {
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
        const line = wstLines.find((l) => l.lineId === inp.dataset.lid);
        if (line) line.cases = inp.value;
      };
    });
    root.querySelectorAll('.del-line-singles').forEach((inp) => {
      inp.oninput = () => {
        const line = wstLines.find((l) => l.lineId === inp.dataset.lid);
        if (line) line.singles = inp.value;
      };
    });
  }

  function renderCommittedLines() {
    const wrap = $('wfLines');
    if (!wrap) return;

    if (!wstLines.length) {
      wrap.innerHTML = '';
      wrap.hidden = true;
      return;
    }

    wrap.hidden = false;
    wrap.innerHTML = wstLines.map((line) => {
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
        wstLines = wstLines.filter((l) => l.lineId !== btn.dataset.lid);
        renderCommittedLines();
      };
    });
  }

  async function createProductForWastage({ name, category_id, case_size_id }) {
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
    wstLines.push({
      lineId,
      productId,
      cases: '',
      singles: '',
    });
    $('wfErr').textContent = '';
    renderCommittedLines();
    return lineId;
  }

  function mountProductComposer() {
    const el = $('wfProductSearch');
    if (!el) return;

    mountProductSearch(el, {
      products: event?.event_products || [],
      caseSizes,
      categories,
      value: '',
      placeholder: 'Search product to add…',
      allowCreate: true,
      onCreateProduct: createProductForWastage,
      onSelect: ({ productId }) => {
        const lineId = addProductLine(productId);
        mountProductComposer();
        requestAnimationFrame(() => {
          const input = el.querySelector('.product-search-input');
          const list = el.querySelector('.product-search-list');
          if (input) input.value = '';
          if (list) list.hidden = true;
          $('wfLines')?.querySelector(`.del-line-cases[data-lid="${lineId}"]`)?.focus();
        });
      },
    });
  }

  function renderProductsSection() {
    renderCommittedLines();
    mountProductComposer();
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
      $('wfErr').textContent = 'Add at least one product with a quantity.';
      return;
    }

    const btn = $('wfSave');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const DB = getDB();
      const head = {
        event_id: route.eventId,
        unit: 'cases',
        reason: ($('wfReason').value || '').trim() || null,
        recorded_at: $('wfDate').value
          ? new Date($('wfDate').value).toISOString()
          : new Date().toISOString(),
        notes: ($('wfNotes').value || '').trim() || null,
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
          const p = productFromEvent(event, v.product_id);
          const ups = p?.units_per_case > 0 ? Number(p.units_per_case) : 1;
          return {
            batch_id: batchId,
            product_id: v.product_id,
            qty: v.qty + v.singles / ups,
          };
        }));
      }

      closeSheet();
      await refreshList();
      toast(editingId ? 'Wastage updated' : 'Wastage saved');
    } catch (err) {
      $('wfErr').textContent = err.message || 'Save failed';
    } finally {
      btn.disabled = false;
      btn.textContent = editingId ? 'Update wastage' : 'Save wastage';
    }
  }

  function openWastageForm(editId) {
    editingId = editId || null;
    wstLines = [];

    if (editId) {
      const b = batches.find((x) => x.id === editId);
      if (!b) return;
      wstLines = (b.lines || []).length
        ? b.lines.map((l) => {
          const form = storedToForm(l);
          return {
            lineId: rid('l'),
            productId: l.product_id,
            cases: form.cases,
            singles: form.singles,
          };
        })
        : [];
    }

    const reasonOptions = [
      '<option value="">— Select reason —</option>',
      ...WASTAGE_REASONS.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`),
    ].join('');

    openSheet({
      title: editingId ? 'Edit wastage' : 'Log wastage',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="wfErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="wfDate">Recorded on</label>
            <input class="admin-input" type="datetime-local" id="wfDate">
          </div>
          <div class="admin-field">
            <label class="admin-label" for="wfReason">Reason</label>
            <select class="admin-select" id="wfReason">${reasonOptions}</select>
          </div>
          <div class="admin-field">
            <span class="admin-label">Products wasted</span>
            <p class="wst-form-hint muted">Enter whole cases, loose singles, or both for each product.</p>
            <div class="del-products">
              <div class="del-line-composer">
                <div id="wfProductSearch"></div>
              </div>
              <div id="wfLines" class="del-lines-committed" hidden></div>
            </div>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="wfNotes">Notes</label>
            <textarea class="admin-textarea" id="wfNotes" rows="3" placeholder="Optional — e.g. dropped a tray, fridge failure…"></textarea>
          </div>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot">
          <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="wfCancel">Cancel</button>
          <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="wfSave">${editingId ? 'Update wastage' : 'Save wastage'}</button>
        </div>`,
      onClose: () => { editingId = null; },
    });

    const editBatch = editId ? batches.find((x) => x.id === editId) : null;
    if (editBatch) {
      if (editBatch.recorded_at || editBatch.created_at) {
        const dt = new Date(editBatch.recorded_at || editBatch.created_at);
        $('wfDate').value = new Date(dt - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      }
      const reasonSel = $('wfReason');
      if (editBatch.reason && !Array.from(reasonSel.options).some((o) => o.value === editBatch.reason)) {
        reasonSel.add(new Option(editBatch.reason, editBatch.reason));
      }
      reasonSel.value = editBatch.reason || '';
      $('wfNotes').value = editBatch.notes || '';
    } else {
      $('wfDate').value = nowLocalInput();
    }

    $('wfCancel').onclick = closeSheet;
    $('wfSave').onclick = saveWastage;
    renderProductsSection();
  }

  async function deleteWastage(id) {
    if (!(await confirmDialog({ title: 'Confirm', message: 'Delete this wastage entry?', confirmLabel: 'Delete', danger: true }))) return;
    try {
      const DB = getDB();
      await DB.wastage.clearLines(id);
      await DB.wastage.remove(id);
      batches = batches.filter((b) => b.id !== id);
      paintList();
      toast('Wastage deleted');
    } catch (err) {
      toast(err.message || 'Delete failed', true);
    }
  }

  function wireList() {
    listEl.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.onclick = () => openWastageForm(btn.dataset.edit);
    });
    listEl.querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = () => deleteWastage(btn.dataset.del);
    });
  }

  function paintList() {
    const visible = visibleBatches();
    if (statsEl) {
      if (visible.length) {
        statsEl.hidden = false;
        statsEl.innerHTML = renderStats(visible, event, caseSizes);
      } else {
        statsEl.hidden = true;
        statsEl.innerHTML = '';
      }
    }
    if (!visible.length && batches.length) {
      listEl.innerHTML = emptyState({
        iconHtml: icon('search', { size: 22 }),
        title: 'No matches',
        copy: 'No wastage entries match your filter.',
        variant: 'admin',
      });
    } else {
      listEl.innerHTML = renderList(visible, event, caseSizes);
      wireList();
      listEl.querySelector('[data-empty-cta="log-wastage"]')?.addEventListener('click', () => openWastageForm());
    }
    applyProductFilter(getLastProductFilter());
  }

  async function refreshList() {
    const DB = getDB();
    batches = await DB.wastage.forEvent(route.eventId);
    paintList();
  }

  async function load() {
    try {
      [event, categories, caseSizes] = await Promise.all([
        loadEventLite(route.eventId),
        loadCategories(),
        loadCaseSizes(),
      ]);
      await refreshList();
    } catch (err) {
      listEl.innerHTML = errorState({
        title: 'Couldn’t load wastage',
        copy: err.message || 'Failed to load',
        variant: 'admin',
      });
      bindEmptyRetry(listEl, () => load());
      reportError(err, { source: 'admin.wastage.load', silent: true });
    }
  }

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'log-wastage') {
      e.detail.handled = true;
      openWastageForm();
    }
  };
  const onProductFilter = (e) => {
    applyProductFilter(e.detail || {});
  };
  const onTableFilter = (e) => {
    if (e.detail?.panel !== 'wastage') return;
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
