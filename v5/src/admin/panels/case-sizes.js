/**
 * Admin case sizes panel — global pack catalogue (list + detail, sheet to edit).
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { getDB, loadCaseSizes, loadLibraryProducts } from '../../db.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';

const STOCK_UNIT_OPTS = [
  { value: 'case', label: 'Cases' },
  { value: 'single', label: 'Singles' },
  { value: 'bottle', label: 'Bottles' },
  { value: 'keg', label: 'Kegs' },
  { value: 'unit', label: 'Units' },
];

function stockUnitLabel(value) {
  return STOCK_UNIT_OPTS.find((o) => o.value === value)?.label || value || '—';
}

function caseSizeSummary(cs) {
  if (!cs) return '';
  const parts = [];
  if (cs.units_per_case != null) parts.push(`${cs.units_per_case} per case`);
  if (cs.stock_unit) parts.push(stockUnitLabel(cs.stock_unit).toLowerCase());
  if (cs.servings_per_unit != null) parts.push(`${cs.servings_per_unit} servings`);
  return parts.join(' · ') || cs.label || '';
}

function linkedProducts(csId, products) {
  return (products || []).filter((p) =>
    p.case_size_id === csId ||
    p.stock_case_size_id === csId ||
    (p.product_suppliers || []).some((ps) => ps.purchase_case_size_id === csId))
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function isCaseSizeLinked(csId, products) {
  return linkedProducts(csId, products).length > 0;
}

function preferredSupplier(p) {
  const offers = p.product_suppliers || [];
  const pref = offers.find((o) => o.is_preferred) || offers[0];
  return pref?.supplier?.name || p.supplier?.name || '—';
}

function renderShell() {
  return `
    <div class="admin-page cs-panel">
      <div class="catalog-layout">
        <aside class="catalog-list-card admin-surface">
          <div class="catalog-list-head">
            <input type="search" class="admin-input" id="csSearch"
              placeholder="Search case sizes…" autocomplete="off" aria-label="Search case sizes">
          </div>
          <div class="catalog-list" id="csList">
            <div class="catalog-list-empty muted">Loading case sizes…</div>
          </div>
        </aside>
        <section class="catalog-detail admin-surface" id="csDetail">
          <div class="catalog-detail-empty" id="csDetailEmpty">
            ${icon('package', { size: 32, strokeWidth: 1.5 })}
            <p>Select a case size to view details, or add a new one from the toolbar.</p>
          </div>
          <div id="csDetailBody" hidden></div>
        </section>
      </div>
    </div>`;
}

function renderListItems(caseSizes, selectedId, query) {
  const q = (query || '').trim().toLowerCase();
  const list = (caseSizes || [])
    .filter((cs) => {
      if (!q) return true;
      const hay = [
        cs.label,
        cs.stock_unit,
        cs.notes,
        caseSizeSummary(cs),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    })
    .slice()
    .sort((a, b) => (a.sort_order - b.sort_order) || (a.label || '').localeCompare(b.label || ''));

  if (!list.length) {
    return `<div class="catalog-list-empty">${caseSizes?.length
      ? 'No case sizes match your search.'
      : 'No case sizes yet. Add your first one.'}</div>`;
  }

  return list.map((cs) => {
    const active = cs.id === selectedId ? ' catalog-list-item--active' : '';
    return `
      <button type="button" class="catalog-list-item${active}" data-cs-id="${escapeHtml(cs.id)}">
        <span class="catalog-list-name">${escapeHtml(cs.label || 'Case size')}</span>
        <span class="catalog-list-meta">${escapeHtml(caseSizeSummary(cs))}</span>
      </button>`;
  }).join('');
}

function roValue(val) {
  const has = val != null && String(val).trim() !== '';
  return has ? escapeHtml(val) : '<span class="catalog-ro-empty">—</span>';
}

function renderDetail(cs, products) {
  if (!cs) return '';

  const rows = linkedProducts(cs.id, products);
  const productTable = rows.length
    ? `<div class="catalog-table-wrap">
        <table class="catalog-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Supplier</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((p) => `<tr>
              <td><span class="catalog-table-primary">${escapeHtml(p.name || 'Product')}</span></td>
              <td>${escapeHtml(p.category?.name || '—')}</td>
              <td>${escapeHtml(preferredSupplier(p))}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`
    : '<div class="catalog-list-empty">No products use this case size yet.</div>';

  return `
    <div class="catalog-detail-head">
      <div class="catalog-detail-head-main">
        <h2 class="del-card-pill-title"><span class="del-card-pill-name">${escapeHtml(cs.label || 'Case size')}</span></h2>
        <p class="catalog-detail-meta">${escapeHtml(caseSizeSummary(cs))}</p>
      </div>
      <button type="button" class="topbar-tool topbar-tool--label topbar-tool--primary" id="csEditBtn"
        title="Edit case size" aria-label="Edit case size">
        ${icon('pencil', { size: 16, strokeWidth: 2.5 })}<span>Edit</span>
      </button>
    </div>
    <div class="catalog-ro-grid">
      <div class="catalog-ro-field">
        <span class="catalog-ro-label">Units per case</span>
        <span class="catalog-ro-value">${cs.units_per_case != null ? escapeHtml(String(cs.units_per_case)) : '—'}</span>
      </div>
      <div class="catalog-ro-field">
        <span class="catalog-ro-label">Count as</span>
        <span class="catalog-ro-value">${escapeHtml(stockUnitLabel(cs.stock_unit))}</span>
      </div>
      <div class="catalog-ro-field">
        <span class="catalog-ro-label">Servings per unit</span>
        <span class="catalog-ro-value">${cs.servings_per_unit != null ? escapeHtml(String(cs.servings_per_unit)) : '—'}</span>
      </div>
      <div class="catalog-ro-field">
        <span class="catalog-ro-label">Sort order</span>
        <span class="catalog-ro-value">${cs.sort_order != null ? escapeHtml(String(cs.sort_order)) : '0'}</span>
      </div>
      <div class="catalog-ro-field catalog-ro-field--full">
        <span class="catalog-ro-label">Notes</span>
        <span class="catalog-ro-value">${roValue(cs.notes)}</span>
      </div>
    </div>
    <div class="catalog-detail-section">
      <h3 class="catalog-section-title">Products (${rows.length})</h3>
      ${productTable}
    </div>`;
}

export function renderCaseSizesShell() {
  return renderShell();
}

export function mountCaseSizesPanel() {
  const listEl = $('csList');
  const detailEmpty = $('csDetailEmpty');
  const detailBody = $('csDetailBody');
  const searchEl = $('csSearch');
  if (!listEl) return () => {};

  let caseSizes = [];
  let products = [];
  let selectedId = null;
  let searchQuery = '';

  function paintList() {
    listEl.innerHTML = renderListItems(caseSizes, selectedId, searchQuery);
    listEl.querySelectorAll('[data-cs-id]').forEach((btn) => {
      btn.onclick = () => selectCaseSize(btn.dataset.csId);
    });
  }

  function paintDetail() {
    const cs = selectedId ? caseSizes.find((x) => x.id === selectedId) : null;
    if (!cs) {
      detailEmpty.hidden = false;
      detailBody.hidden = true;
      detailBody.innerHTML = '';
      return;
    }
    detailEmpty.hidden = true;
    detailBody.hidden = false;
    detailBody.innerHTML = renderDetail(cs, products);
    $('csEditBtn')?.addEventListener('click', () => openCaseSizeForm(cs.id));
  }

  function selectCaseSize(id) {
    selectedId = id;
    paintList();
    paintDetail();
  }

  async function refresh() {
    [caseSizes, products] = await Promise.all([
      loadCaseSizes(),
      loadLibraryProducts(),
    ]);
    if (selectedId && !caseSizes.some((cs) => cs.id === selectedId)) {
      selectedId = caseSizes[0]?.id || null;
    }
    if (!selectedId && caseSizes.length === 1) {
      selectedId = caseSizes[0].id;
    }
    paintList();
    paintDetail();
  }

  async function saveCaseSize(editId) {
    const label = ($('csLabel')?.value || '').trim();
    if (!label) {
      $('csErr').textContent = 'Label is required.';
      return;
    }

    const unitsRaw = ($('csUnitsPerCase')?.value || '').trim();
    const units_per_case = unitsRaw === '' ? NaN : Number(unitsRaw);
    if (!Number.isFinite(units_per_case) || units_per_case <= 0) {
      $('csErr').textContent = 'Units per case must be greater than zero.';
      return;
    }

    const stock_unit = $('csStockUnit')?.value || 'case';
    let servings_per_unit = null;
    if ($('csServings')?.value !== '') {
      servings_per_unit = Number($('csServings').value);
      if (!Number.isFinite(servings_per_unit) || servings_per_unit <= 0) {
        $('csErr').textContent = 'Servings per unit must be a positive number.';
        return;
      }
    }

    let sort_order = 0;
    if ($('csSortOrder')?.value !== '') {
      sort_order = Number($('csSortOrder').value);
      if (!Number.isFinite(sort_order)) sort_order = 0;
    }

    const patch = {
      label,
      units_per_case,
      stock_unit,
      servings_per_unit,
      sort_order: Math.round(sort_order),
      notes: ($('csNotes')?.value || '').trim() || null,
    };

    const btn = $('csSave');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const DB = getDB();
      if (editId) {
        await DB.caseSizes.update(editId, patch);
      } else {
        const created = await DB.caseSizes.create(patch);
        if (created?.id) selectedId = created.id;
      }
      closeSheet();
      await refresh();
      toast(editId ? 'Case size updated' : 'Case size created');
    } catch (err) {
      $('csErr').textContent = err.message || 'Save failed';
    } finally {
      btn.disabled = false;
      btn.textContent = editId ? 'Update case size' : 'Save case size';
    }
  }

  async function deleteCaseSize(id) {
    if (!confirm('Delete this case size? This cannot be undone.')) return;
    if (isCaseSizeLinked(id, products)) {
      toast('Can\'t delete — products still use this case size. Reassign them first.', true);
      return;
    }
    try {
      await getDB().caseSizes.remove(id);
      if (selectedId === id) selectedId = null;
      closeSheet();
      await refresh();
      toast('Case size deleted');
    } catch (err) {
      toast(err.message || 'Delete failed', true);
    }
  }

  function openCaseSizeForm(editId) {
    const cs = editId ? caseSizes.find((x) => x.id === editId) : null;
    const suOpts = STOCK_UNIT_OPTS.map((o) =>
      `<option value="${escapeHtml(o.value)}"${o.value === (cs?.stock_unit || 'case') ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');

    openSheet({
      title: cs ? 'Edit case size' : 'New case size',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="csErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="csLabel">Label</label>
            <input class="admin-input" type="text" id="csLabel" required placeholder="e.g. 24×330ml, 70cl, 50L Keg">
          </div>
          <div class="admin-field-grid">
            <div class="admin-field">
              <label class="admin-label" for="csUnitsPerCase">Units per case</label>
              <input class="admin-input" type="number" min="0" step="any" id="csUnitsPerCase" placeholder="1">
            </div>
            <div class="admin-field">
              <label class="admin-label" for="csStockUnit">Count as</label>
              <select class="admin-select" id="csStockUnit">${suOpts}</select>
            </div>
          </div>
          <div class="admin-field-grid">
            <div class="admin-field">
              <label class="admin-label" for="csServings">Servings per unit</label>
              <input class="admin-input" type="number" min="0" step="any" id="csServings" placeholder="Optional">
            </div>
            <div class="admin-field">
              <label class="admin-label" for="csSortOrder">Sort order</label>
              <input class="admin-input" type="number" step="1" id="csSortOrder" placeholder="0">
            </div>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="csNotes">Notes</label>
            <textarea class="admin-textarea" id="csNotes" rows="3" placeholder="Optional"></textarea>
          </div>
          <p class="wst-form-hint muted">Products pick up pack label, units, count-as, and servings from the case size they use.</p>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          ${cs ? '<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="csDelete">Delete</button>' : '<span></span>'}
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="csCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="csSave">${cs ? 'Update case size' : 'Save case size'}</button>
          </div>
        </div>`,
    });

    if (cs) {
      $('csLabel').value = cs.label || '';
      $('csUnitsPerCase').value = cs.units_per_case != null ? String(cs.units_per_case) : '';
      $('csServings').value = cs.servings_per_unit != null ? String(cs.servings_per_unit) : '';
      $('csSortOrder').value = cs.sort_order != null ? String(cs.sort_order) : '';
      $('csNotes').value = cs.notes || '';
    }

    $('csCancel').onclick = closeSheet;
    $('csSave').onclick = () => saveCaseSize(editId || null);
    if (cs) $('csDelete').onclick = () => deleteCaseSize(cs.id);
  }

  searchEl?.addEventListener('input', () => {
    searchQuery = searchEl.value;
    paintList();
  });

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'new-case-size') {
      e.detail.handled = true;
      openCaseSizeForm();
    }
  };
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);

  refresh().catch((err) => {
    listEl.innerHTML = `<div class="catalog-list-empty del-empty--err">${escapeHtml(err.message || 'Failed to load')}</div>`;
  });

  return () => {
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  };
}
